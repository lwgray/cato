"""
Unified Data Aggregator for Cato Visualization.

This module replaces the multi-layered transformation pipeline in data_loader.py
with a single aggregation function that creates denormalized snapshots.

The aggregator:
1. Loads data from all sources (projects, tasks, logs, events)
2. Denormalizes relationships (embeds parent/project/agent info)
3. Calculates all metrics once
4. Pre-calculates timeline positions
5. Returns immutable Snapshot

Performance:
- Target: < 100ms for typical project (vs 500-2000ms current)
- Single pass over data (vs 7+ transforms)
- All calculations done once (vs recalculated on every render)
"""

import json
import logging
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Set

from src.core.store import (
    Agent,
    Event,
    Message,
    Metrics,
    Snapshot,
    Task,
)

logger = logging.getLogger(__name__)


class ProjectMatcher:
    """
    Handle task-to-project assignment with multiple matching strategies.

    Supports:
    - exact: Task ID must exactly match project ID
    - fuzzy: Task ID within ±tolerance of project ID (handles Planka quirks)
    - timeframe: Task created within project timeframe
    """

    def __init__(self, tolerance: int = 20):
        """
        Initialize project matcher.

        Parameters
        ----------
        tolerance : int
            Fuzzy matching tolerance (default ±20)
        """
        self.tolerance = tolerance

    def match_task_to_project(
        self,
        task_id: str,
        project_id: str,
        strategy: Literal["exact", "fuzzy", "timeframe"] = "fuzzy",
        project_created: Optional[datetime] = None,
        project_last_used: Optional[datetime] = None,
        task_created: Optional[datetime] = None,
    ) -> bool:
        """
        Determine if task belongs to project.

        Parameters
        ----------
        task_id : str
            Task ID to match
        project_id : str
            Project ID to match against
        strategy : str
            Matching strategy ('exact', 'fuzzy', 'timeframe')
        project_created : Optional[datetime]
            When project was created (for timeframe strategy)
        project_last_used : Optional[datetime]
            When project was last used (for timeframe strategy)
        task_created : Optional[datetime]
            When task was created (for timeframe strategy)

        Returns
        -------
        bool
            True if task matches project
        """
        if strategy == "exact":
            return task_id == project_id or task_id.startswith(f"{project_id}_")

        elif strategy == "fuzzy":
            # Extract numeric portion of IDs
            try:
                task_num = int(task_id.split("_")[0])
                project_num = int(project_id)
                return abs(task_num - project_num) <= self.tolerance
            except (ValueError, IndexError):
                # Fallback to exact matching if numeric extraction fails
                return task_id == project_id or task_id.startswith(f"{project_id}_")

        else:  # strategy == "timeframe"
            # Match if task created within project timeframe
            if not all([project_created, project_last_used, task_created]):
                return False

            # All are confirmed not None by the check above
            assert project_created is not None
            assert project_last_used is not None
            assert task_created is not None
            return project_created <= task_created <= project_last_used


class Aggregator:
    """
    Unified aggregator that creates denormalized snapshots.

    This replaces the 7+ transformation layers in data_loader.py with a
    single aggregation function.
    """

    def __init__(self, marcus_root: Optional[Path] = None):
        """
        Initialize the aggregator.

        Parameters
        ----------
        marcus_root : Optional[Path]
            Path to Marcus root directory. If None, auto-detects from current location.
        """
        if marcus_root is None:
            # Auto-detect Marcus root (assumes viz is a subdirectory of Marcus)
            self.marcus_root = Path(__file__).parent.parent.parent
        else:
            self.marcus_root = Path(marcus_root)

        self.persistence_dir = self.marcus_root / "data" / "marcus_state"
        self.conversation_logs_dir = self.marcus_root / "logs" / "conversations"
        self.agent_events_dir = self.marcus_root / "logs" / "agent_events"

        self.project_matcher = ProjectMatcher(tolerance=20)
        self.snapshot_version_counter = 0

        logger.info(f"Initialized Aggregator with root: {self.marcus_root}")

    def create_snapshot(
        self,
        project_id: Optional[str] = None,
        view_mode: Literal["subtasks", "parents", "all"] = "subtasks",
        timeline_scale_exponent: float = 0.4,
    ) -> Snapshot:
        """
        Create a complete denormalized snapshot.

        This is the main entry point that replaces the entire data_loader pipeline.

        Parameters
        ----------
        project_id : Optional[str]
            Specific project to snapshot (None = all projects)
        view_mode : str
            View mode: 'subtasks' (default), 'parents', or 'all'
        timeline_scale_exponent : float
            Power scale exponent for timeline (default 0.4)

        Returns
        -------
        Snapshot
            Complete denormalized snapshot with all metrics pre-calculated
        """
        snapshot_start = datetime.now(timezone.utc)
        self.snapshot_version_counter += 1

        logger.info(
            f"Creating snapshot v{self.snapshot_version_counter}: "
            f"project_id={project_id}, view={view_mode}"
        )

        # Step 1: Load raw data from all sources
        projects_data = self._load_projects()
        raw_tasks = self._load_tasks(project_id)
        raw_messages = self._load_messages()
        raw_events = self._load_events()

        # Step 2: Filter tasks by view mode
        filtered_tasks = self._filter_tasks_by_view(raw_tasks, view_mode)

        # Step 3: Build lookup tables for denormalization
        projects_by_id = {p["id"]: p for p in projects_data if "id" in p}
        tasks_by_id = {t["id"]: t for t in filtered_tasks}
        agents_by_id = self._infer_agents(filtered_tasks, raw_messages)

        # Step 4: Calculate timeline boundaries
        timeline_start, timeline_end, duration_minutes = self._calculate_timeline(
            filtered_tasks, raw_messages
        )

        # Step 5: Build denormalized tasks with timeline positions
        tasks = self._build_tasks(
            filtered_tasks,
            projects_by_id,
            tasks_by_id,
            agents_by_id,
            timeline_start,
            timeline_end,
            timeline_scale_exponent,
        )

        # Step 6: Build denormalized agents with metrics
        agents = self._build_agents(agents_by_id, tasks, raw_messages)

        # Step 7: Build denormalized messages
        task_ids_set = {t.id for t in tasks}
        messages = self._build_messages(
            raw_messages, task_ids_set, tasks_by_id, agents_by_id
        )

        # Step 8: Build denormalized events
        events = self._build_events(raw_events, task_ids_set, tasks_by_id, agents_by_id)

        # Step 8a: Generate diagnostic events for timeline
        diagnostic_events = self._build_diagnostic_events(
            tasks, agents, timeline_start, timeline_end
        )
        # Merge diagnostic events with regular events
        all_events = events + diagnostic_events

        # Step 9: Calculate pre-computed metrics
        metrics = self._calculate_metrics(tasks, agents, messages)

        # Step 10: Build dependency graphs
        task_dependency_graph = self._build_dependency_graph(tasks)
        agent_communication_graph = self._build_communication_graph(messages)

        # Step 11: Get project metadata
        project_name = ""
        included_project_ids = []
        if project_id and project_id in projects_by_id:
            project_name = projects_by_id[project_id].get("name", "")
            included_project_ids = [project_id]
        else:
            # All projects
            included_project_ids = list(projects_by_id.keys())

        # Step 12: Create snapshot
        snapshot = Snapshot(
            snapshot_id=str(uuid.uuid4()),
            snapshot_version=self.snapshot_version_counter,
            timestamp=snapshot_start,
            project_id=project_id,
            project_name=project_name,
            project_filter_applied=project_id is not None,
            included_project_ids=included_project_ids,
            view_mode=view_mode,
            tasks=tasks,
            agents=agents,
            messages=messages,
            timeline_events=all_events,
            metrics=metrics,
            start_time=timeline_start,
            end_time=timeline_end,
            duration_minutes=duration_minutes,
            task_dependency_graph=task_dependency_graph,
            agent_communication_graph=agent_communication_graph,
            timezone="UTC",
        )

        snapshot_end = datetime.now(timezone.utc)
        elapsed_ms = (snapshot_end - snapshot_start).total_seconds() * 1000
        logger.info(
            f"Snapshot v{self.snapshot_version_counter} created in {elapsed_ms:.1f}ms: "
            f"{len(tasks)} tasks, {len(agents)} agents, "
            f"{len(messages)} messages"
        )

        return snapshot

    def _load_projects(self) -> List[Dict[str, Any]]:
        """Load projects from projects.json."""
        projects_file = self.persistence_dir / "projects.json"
        if not projects_file.exists():
            logger.warning(f"Projects file not found: {projects_file}")
            return []

        try:
            with open(projects_file, "r") as f:
                data = json.load(f)
                # Extract actual projects (skip metadata like "active_project")
                projects = []
                for key, value in data.items():
                    if key != "active_project" and isinstance(value, dict):
                        if "id" in value:
                            projects.append(value)
                logger.info(f"Loaded {len(projects)} projects")
                return projects
        except Exception as e:
            logger.error(f"Error loading projects: {e}")
            return []

    def _load_tasks(self, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Load tasks from subtasks.json, optionally filtered by project."""
        subtasks_file = self.persistence_dir / "subtasks.json"
        if not subtasks_file.exists():
            logger.warning(f"Subtasks file not found: {subtasks_file}")
            return []

        try:
            with open(subtasks_file, "r") as f:
                data = json.load(f)

                # Handle nested format: {"subtasks": {task_id: task_data}}
                if isinstance(data, dict) and "subtasks" in data:
                    all_tasks = list(data["subtasks"].values())
                # Handle both formats: {task_id: task_data} or [task1, task2, ...]
                elif isinstance(data, dict):
                    all_tasks = list(data.values())
                else:
                    all_tasks = data

                # Filter by project using fuzzy matching (±20 range)
                # Planka creates task IDs that are offset from board IDs
                if project_id:
                    # Load projects to get Planka board/project ID mapping
                    projects_data = self._load_projects()
                    project_info = next(
                        (p for p in projects_data if p.get("id") == project_id), None
                    )

                    if project_info and "provider_config" in project_info:
                        planka_project_id = project_info["provider_config"].get(
                            "project_id", ""
                        )
                        planka_board_id = project_info["provider_config"].get("board_id", "")

                        if planka_project_id or planka_board_id:
                            filtered_tasks = []

                            for task in all_tasks:
                                parent_id = str(task.get("parent_task_id", ""))

                                # Skip non-Planka IDs (e.g., "task-001")
                                if not parent_id or not parent_id[0].isdigit():
                                    continue

                                if len(parent_id) < 8:
                                    continue

                                # Check distance to board_id and project_id
                                best_match = False

                                for id_to_check in [planka_board_id, planka_project_id]:
                                    if id_to_check and len(id_to_check) >= 8:
                                        try:
                                            id_prefix = int(id_to_check[:8])
                                            parent_prefix = int(parent_id[:8])
                                            distance = abs(parent_prefix - id_prefix)

                                            # Use ±20 range for fuzzy matching
                                            if distance <= 20:
                                                best_match = True
                                                break
                                        except (ValueError, IndexError):
                                            # If conversion fails, try exact prefix match
                                            if parent_id.startswith(id_to_check[:8]):
                                                best_match = True
                                                break

                                if best_match:
                                    filtered_tasks.append(task)

                            logger.info(
                                f"Filtered {len(filtered_tasks)}/{len(all_tasks)} tasks "
                                f"for project {project_id} (Planka ID: {planka_project_id})"
                            )
                            return filtered_tasks
                        else:
                            logger.warning(
                                f"Project {project_id} has no Planka IDs, returning all tasks"
                            )
                    else:
                        logger.warning(
                            f"Project {project_id} not found, returning all tasks"
                        )

                logger.info(f"Loaded {len(all_tasks)} tasks (all projects)")
                return all_tasks

        except Exception as e:
            logger.error(f"Error loading tasks: {e}")
            return []

    def _load_messages(self) -> List[Dict[str, Any]]:
        """Load conversation messages from logs."""
        messages: List[Dict[str, Any]] = []
        if not self.conversation_logs_dir.exists():
            logger.warning(
                f"Conversation logs dir not found: {self.conversation_logs_dir}"
            )
            return messages

        for log_file in self.conversation_logs_dir.glob("*.jsonl"):
            try:
                with open(log_file, "r") as f:
                    for line in f:
                        try:
                            entry = json.loads(line.strip())
                            messages.append(entry)
                        except json.JSONDecodeError:
                            continue
            except Exception as e:
                logger.error(f"Error loading messages from {log_file}: {e}")

        logger.info(f"Loaded {len(messages)} messages")
        return messages

    def _load_events(self) -> List[Dict[str, Any]]:
        """Load agent events from logs."""
        events: List[Dict[str, Any]] = []
        if not self.agent_events_dir.exists():
            logger.warning(f"Agent events dir not found: {self.agent_events_dir}")
            return events

        for log_file in self.agent_events_dir.glob("*.jsonl"):
            try:
                with open(log_file, "r") as f:
                    for line in f:
                        try:
                            entry = json.loads(line.strip())
                            events.append(entry)
                        except json.JSONDecodeError:
                            continue
            except Exception as e:
                logger.error(f"Error loading events from {log_file}: {e}")

        logger.info(f"Loaded {len(events)} events")
        return events

    def _filter_tasks_by_view(
        self, tasks: List[Dict[str, Any]], view_mode: str
    ) -> List[Dict[str, Any]]:
        """Filter tasks based on view mode."""
        if view_mode == "subtasks":
            # Infer is_subtask from parent_task_id if not explicitly set
            return [t for t in tasks if t.get("is_subtask", bool(t.get("parent_task_id")))]
        elif view_mode == "parents":
            # Infer is_subtask from parent_task_id if not explicitly set
            return [t for t in tasks if not t.get("is_subtask", bool(t.get("parent_task_id")))]
        else:  # "all"
            return tasks

    def _infer_agents(
        self, tasks: List[Dict[str, Any]], messages: List[Dict[str, Any]]
    ) -> Dict[str, Dict[str, Any]]:
        """Infer agents from tasks and messages."""
        agents = {}

        # From tasks
        for task in tasks:
            agent_id = (
                task.get("assigned_agent_id")
                or task.get("agent_id")
                or task.get("assigned_to")
            )
            if agent_id and agent_id not in agents:
                agents[agent_id] = {
                    "id": agent_id,
                    "name": agent_id,  # Will be improved if we find better name
                    "role": "agent",
                    "skills": [],
                }

        # From messages (extract better names if available)
        for msg in messages:
            for id_field in ["from_agent_id", "to_agent_id", "agent_id"]:
                agent_id = msg.get(id_field)
                if agent_id and agent_id not in agents:
                    agents[agent_id] = {
                        "id": agent_id,
                        "name": agent_id,
                        "role": "agent",
                        "skills": [],
                    }

        logger.info(f"Inferred {len(agents)} agents")
        return agents

    def _calculate_timeline(
        self,
        tasks: List[Dict[str, Any]],
        messages: List[Dict[str, Any]],
    ) -> tuple[datetime, datetime, int]:
        """
        Calculate timeline boundaries from tasks and messages.

        Returns
        -------
        tuple
            (start_time, end_time, duration_minutes)
        """
        timestamps = []

        # Collect all timestamps from tasks
        for task in tasks:
            for field in ["created_at", "updated_at", "started_at", "completed_at"]:
                if field in task and task[field]:
                    ts_str = task[field]
                    try:
                        ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                        if ts.tzinfo is None:
                            ts = ts.replace(tzinfo=timezone.utc)
                        timestamps.append(ts)
                    except (ValueError, AttributeError):
                        continue

        # Collect timestamps from messages
        for msg in messages:
            if "timestamp" in msg and msg["timestamp"]:
                ts_str = msg["timestamp"]
                try:
                    ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                    timestamps.append(ts)
                except (ValueError, AttributeError):
                    continue

        if not timestamps:
            # No data, use current time
            now = datetime.now(timezone.utc)
            return now, now, 0

        start_time = min(timestamps)
        end_time = max(timestamps)
        duration_minutes = int((end_time - start_time).total_seconds() / 60)

        return start_time, end_time, duration_minutes

    def _calculate_power_scale_position(
        self, linear_pos: float, exponent: float = 0.4
    ) -> float:
        """
        Calculate power-scaled position.

        Parameters
        ----------
        linear_pos : float
            Linear position 0.0-1.0
        exponent : float
            Power scale exponent (< 1 expands early timeline)

        Returns
        -------
        float
            Scaled position 0.0-1.0
        """
        if linear_pos <= 0:
            return 0.0
        if linear_pos >= 1.0:
            return 1.0
        return float(linear_pos**exponent)

    def _build_tasks(
        self,
        task_dicts: List[Dict[str, Any]],
        projects_by_id: Dict[str, Dict[str, Any]],
        tasks_by_id: Dict[str, Dict[str, Any]],
        agents_by_id: Dict[str, Dict[str, Any]],
        timeline_start: datetime,
        timeline_end: datetime,
        timeline_scale_exponent: float,
    ) -> List[Task]:
        """Build denormalized Task objects with all relationships embedded."""
        tasks: List[Task] = []
        timeline_duration = (timeline_end - timeline_start).total_seconds()

        for task_data in task_dicts:
            # Parse timestamps
            created_at = self._parse_timestamp(task_data.get("created_at"))
            updated_at = self._parse_timestamp(
                task_data.get("updated_at", task_data.get("created_at"))
            )
            started_at = self._parse_timestamp(task_data.get("started_at"))
            completed_at = self._parse_timestamp(task_data.get("completed_at"))

            # Calculate timeline positions
            if timeline_duration > 0 and created_at:
                linear_pos = (
                    created_at - timeline_start
                ).total_seconds() / timeline_duration
                scaled_pos = self._calculate_power_scale_position(
                    linear_pos, timeline_scale_exponent
                )
            else:
                linear_pos = 0.0
                scaled_pos = 0.0

            # Embed parent info
            parent_id = task_data.get("parent_task_id")
            parent_name = None
            if parent_id and parent_id in tasks_by_id:
                parent_name = tasks_by_id[parent_id].get("name")

            # Embed project info
            project_id = task_data.get("project_id", "")
            project_name = ""
            if project_id and project_id in projects_by_id:
                project_name = projects_by_id[project_id].get("name", "")

            # Embed agent info
            agent_id = (
                task_data.get("assigned_agent_id")
                or task_data.get("agent_id")
                or task_data.get("assigned_to")
            )
            agent_name = None
            agent_role = None
            if agent_id and agent_id in agents_by_id:
                agent_name = agents_by_id[agent_id]["name"]
                agent_role = agents_by_id[agent_id]["role"]

            task = Task(
                id=task_data.get("id", ""),
                name=task_data.get("name", ""),
                description=task_data.get("description", ""),
                status=task_data.get("status", "todo"),
                priority=task_data.get("priority", "medium"),
                progress_percent=task_data.get("progress", 0),
                created_at=created_at or datetime.now(timezone.utc),
                started_at=started_at,
                completed_at=completed_at,
                updated_at=updated_at or datetime.now(timezone.utc),
                estimated_hours=task_data.get("estimated_hours", 0.0),
                actual_hours=task_data.get("actual_hours", 0.0),
                parent_task_id=parent_id,
                parent_task_name=parent_name,
                is_subtask=task_data.get("is_subtask", bool(parent_id)),
                subtask_index=task_data.get("subtask_index"),
                project_id=project_id,
                project_name=project_name,
                assigned_agent_id=agent_id,
                assigned_agent_name=agent_name,
                assigned_agent_role=agent_role,
                dependency_ids=task_data.get("dependencies", []),
                dependent_task_ids=[],  # Will be filled by reverse lookup
                timeline_linear_position=linear_pos,
                timeline_scaled_position=scaled_pos,
                timeline_scale_exponent=timeline_scale_exponent,
                labels=task_data.get("labels", []),
                metadata=task_data.get("metadata", {}),
            )
            tasks.append(task)

        # Fill reverse dependencies
        task_map = {t.id: t for t in tasks}
        for task in tasks:
            for dep_id in task.dependency_ids:
                if dep_id in task_map:
                    task_map[dep_id].dependent_task_ids.append(task.id)

        return tasks

    def _build_agents(
        self,
        agents_by_id: Dict[str, Dict[str, Any]],
        tasks: List[Task],
        messages: List[Dict[str, Any]],
    ) -> List[Agent]:
        """Build denormalized Agent objects with metrics."""
        agents: List[Agent] = []

        # Calculate per-agent metrics
        for agent_id, agent_data in agents_by_id.items():
            agent_tasks = [t for t in tasks if t.assigned_agent_id == agent_id]
            current_tasks = [
                t for t in agent_tasks if t.status in ["in_progress", "todo"]
            ]
            completed_tasks = [t for t in agent_tasks if t.status == "done"]

            total_hours = sum(t.actual_hours for t in completed_tasks)
            avg_hours = total_hours / len(completed_tasks) if completed_tasks else 0.0

            # Count messages
            messages_sent = sum(
                1 for m in messages if m.get("from_agent_id") == agent_id
            )
            messages_received = sum(
                1 for m in messages if m.get("to_agent_id") == agent_id
            )
            blockers_reported = sum(
                1
                for m in messages
                if m.get("from_agent_id") == agent_id and m.get("type") == "blocker"
            )

            agent = Agent(
                id=agent_id,
                name=agent_data["name"],
                role=agent_data["role"],
                skills=agent_data["skills"],
                current_task_ids=[t.id for t in current_tasks],
                current_task_names=[t.name for t in current_tasks],
                completed_task_ids=[t.id for t in completed_tasks],
                completed_tasks_count=len(completed_tasks),
                total_hours_worked=total_hours,
                average_task_duration_hours=avg_hours,
                performance_score=0.0,  # TODO: Calculate based on actual metrics
                capacity_utilization=0.0,  # TODO: Calculate based on actual metrics
                messages_sent=messages_sent,
                messages_received=messages_received,
                blockers_reported=blockers_reported,
            )
            agents.append(agent)

        return agents

    def _build_messages(
        self,
        message_dicts: List[Dict[str, Any]],
        task_ids: Set[str],
        tasks_by_id: Dict[str, Dict[str, Any]],
        agents_by_id: Dict[str, Dict[str, Any]],
    ) -> List[Message]:
        """Build denormalized Message objects."""
        messages: List[Message] = []

        for msg_data in message_dicts:
            # Skip if not related to our filtered tasks
            task_id = msg_data.get("task_id") or msg_data.get("metadata", {}).get(
                "task_id"
            )
            if task_id and task_id not in task_ids:
                continue

            timestamp = self._parse_timestamp(msg_data.get("timestamp"))
            if not timestamp:
                continue

            from_agent_id = msg_data.get("from_agent_id", "system")
            to_agent_id = msg_data.get("to_agent_id", "system")

            from_agent_name = agents_by_id.get(from_agent_id, {}).get(
                "name", from_agent_id
            )
            to_agent_name = agents_by_id.get(to_agent_id, {}).get("name", to_agent_id)

            task_name = None
            if task_id and task_id in tasks_by_id:
                task_name = tasks_by_id[task_id].get("name")

            msg = Message(
                id=msg_data.get("id", str(uuid.uuid4())),
                timestamp=timestamp,
                message=msg_data.get("message", msg_data.get("content", "")),
                type=msg_data.get("type", "status_update"),
                from_agent_id=from_agent_id,
                from_agent_name=from_agent_name,
                to_agent_id=to_agent_id,
                to_agent_name=to_agent_name,
                task_id=task_id,
                task_name=task_name,
                parent_message_id=msg_data.get("parent_message_id"),
                metadata=msg_data.get("metadata", {}),
            )
            messages.append(msg)

        # Detect and mark duplicates
        messages = self._detect_duplicates(messages)

        return messages

    def _detect_duplicates(
        self, messages: List[Message], time_threshold_seconds: float = 2.0
    ) -> List[Message]:
        """
        Detect and mark duplicate messages.

        Duplicates are identified as messages with:
        - Same content
        - Same timestamp (within threshold)
        - Same from/to agents
        - Same task_id
        - Same message type

        Parameters
        ----------
        messages : List[Message]
            Messages to analyze
        time_threshold_seconds : float
            Time window for duplicate detection (default 2 seconds)

        Returns
        -------
        List[Message]
            Messages with duplicate flags set
        """
        # Group potential duplicates by a similarity key
        groups = defaultdict(list)

        for msg in messages:
            # Create a key that groups similar messages
            # (content hash + agent pair + task + type)
            key = (
                hash(msg.message),  # Content
                msg.from_agent_id,
                msg.to_agent_id,
                msg.task_id or "",
                msg.type,
            )
            groups[key].append(msg)

        # Within each group, find duplicates by timestamp proximity
        group_counter = 0

        for key, group_messages in groups.items():
            if len(group_messages) < 2:
                continue  # No duplicates possible

            # Sort by timestamp
            sorted_messages = sorted(group_messages, key=lambda m: m.timestamp)

            # Find duplicates within time threshold
            i = 0
            while i < len(sorted_messages):
                current_msg = sorted_messages[i]
                duplicate_set = [current_msg]

                # Find all messages within time threshold
                j = i + 1
                while j < len(sorted_messages):
                    next_msg = sorted_messages[j]
                    time_diff = abs(
                        (next_msg.timestamp - current_msg.timestamp).total_seconds()
                    )

                    if time_diff <= time_threshold_seconds:
                        duplicate_set.append(next_msg)
                        j += 1
                    else:
                        break

                # If we found duplicates, mark them
                if len(duplicate_set) > 1:
                    group_counter += 1
                    group_id = f"dup_group_{group_counter}"

                    # First message is the original, rest are duplicates
                    for idx, msg in enumerate(duplicate_set):
                        msg.is_duplicate = idx > 0
                        msg.duplicate_group_id = group_id
                        msg.duplicate_count = len(duplicate_set)

                i = j if j > i + 1 else i + 1

        logger.info(f"Detected {group_counter} duplicate message groups")
        return messages

    def _build_events(
        self,
        event_dicts: List[Dict[str, Any]],
        task_ids: Set[str],
        tasks_by_id: Dict[str, Dict[str, Any]],
        agents_by_id: Dict[str, Dict[str, Any]],
    ) -> List[Event]:
        """Build denormalized Event objects."""
        events: List[Event] = []

        for event_data in event_dicts:
            # Skip if not related to our filtered tasks
            task_id = event_data.get("task_id")
            if task_id and task_id not in task_ids:
                continue

            timestamp = self._parse_timestamp(event_data.get("timestamp"))
            if not timestamp:
                continue

            agent_id = event_data.get("agent_id")
            agent_name = None
            if agent_id and agent_id in agents_by_id:
                agent_name = agents_by_id[agent_id]["name"]

            task_name = None
            if task_id and task_id in tasks_by_id:
                task_name = tasks_by_id[task_id].get("name")

            event = Event(
                id=event_data.get("id", str(uuid.uuid4())),
                timestamp=timestamp,
                event_type=event_data.get("event_type", "unknown"),
                agent_id=agent_id,
                agent_name=agent_name,
                task_id=task_id,
                task_name=task_name,
                data=event_data.get("data", {}),
            )
            events.append(event)

        return events

    def _build_diagnostic_events(
        self,
        tasks: List[Task],
        agents: List[Agent],
        timeline_start: Optional[datetime],
        timeline_end: Optional[datetime],
    ) -> List[Event]:
        """
        Build diagnostic events for timeline visualization.

        Detects issues like zombie tasks, circular dependencies, bottlenecks,
        and generates timeline events so they can be visualized during playback.

        Parameters
        ----------
        tasks : List[Task]
            Denormalized tasks
        agents : List[Agent]
            Denormalized agents
        timeline_start : Optional[datetime]
            Timeline start time
        timeline_end : Optional[datetime]
            Timeline end time

        Returns
        -------
        List[Event]
            Diagnostic events with timestamps
        """
        diagnostic_events: List[Event] = []

        if not timeline_start or not timeline_end:
            return diagnostic_events

        # Build task lookup for dependency checking
        tasks_by_id = {t.id: t for t in tasks}
        assigned_task_ids = {
            t_id
            for agent in agents
            for t_id in agent.current_task_ids
        }

        # 1. Detect zombie tasks (IN_PROGRESS with no agent assigned)
        for task in tasks:
            if task.status == "in_progress" and task.assigned_agent_id is None:
                # Use task's updated time as when the issue was detected
                # updated_at is already a datetime object, no parsing needed
                event_time = task.updated_at or timeline_end

                diagnostic_events.append(
                    Event(
                        id=f"diagnostic_zombie_{task.id}",
                        timestamp=event_time,
                        event_type="diagnostic:zombie_task",
                        agent_id=None,
                        agent_name=None,
                        task_id=task.id,
                        task_name=task.name,
                        data={
                            "severity": "high",
                            "description": f"Task '{task.name}' is marked IN_PROGRESS but has no assigned agent",
                            "recommendation": "Reset to TODO status or assign to an available agent",
                        },
                    )
                )

        # 2. Detect bottleneck tasks (blocking 3+ other tasks)
        dependent_count = defaultdict(int)
        for task in tasks:
            for dep_id in task.dependency_ids:
                dependent_count[dep_id] += 1

        for task_id, count in dependent_count.items():
            if count >= 3:
                task = tasks_by_id.get(task_id)
                if task and task.status != "done":
                    event_time = task.updated_at or timeline_end

                    diagnostic_events.append(
                        Event(
                            id=f"diagnostic_bottleneck_{task.id}",
                            timestamp=event_time,
                            event_type="diagnostic:bottleneck",
                            agent_id=task.assigned_agent_id,
                            agent_name=task.assigned_agent_name,
                            task_id=task.id,
                            task_name=task.name,
                            data={
                                "severity": "medium",
                                "description": f"Task '{task.name}' is blocking {count} other tasks",
                                "recommendation": f"Prioritize completing this task to unblock {count} tasks",
                                "blocks_count": count,
                            },
                        )
                    )

        # 3. Detect circular dependencies (basic check)
        visited: Set[str] = set()
        rec_stack: Set[str] = set()

        def has_cycle(task_id: str, path: List[str]) -> Optional[List[str]]:
            """DFS to detect cycles."""
            if task_id in rec_stack:
                # Found a cycle
                cycle_start_idx = path.index(task_id)
                return path[cycle_start_idx:] + [task_id]

            if task_id in visited or task_id not in tasks_by_id:
                return None

            visited.add(task_id)
            rec_stack.add(task_id)
            path.append(task_id)

            task = tasks_by_id[task_id]
            for dep_id in task.dependency_ids:
                cycle = has_cycle(dep_id, path[:])
                if cycle:
                    return cycle

            rec_stack.remove(task_id)
            return None

        detected_cycles: List[List[str]] = []
        for task in tasks:
            if task.id not in visited:
                cycle = has_cycle(task.id, [])
                if cycle:
                    # Avoid duplicate cycles
                    cycle_set = frozenset(cycle)
                    if not any(frozenset(c) == cycle_set for c in detected_cycles):
                        detected_cycles.append(cycle)

        for cycle in detected_cycles:
            # Use the latest updated time from tasks in the cycle
            cycle_tasks = [tasks_by_id[tid] for tid in cycle if tid in tasks_by_id]
            if cycle_tasks:
                latest_time = max(
                    (t.updated_at for t in cycle_tasks if t.updated_at),
                    default=timeline_end
                )

                cycle_names = [tasks_by_id[tid].name for tid in cycle[:3] if tid in tasks_by_id]

                diagnostic_events.append(
                    Event(
                        id=f"diagnostic_circular_{'_'.join(cycle[:2])}",
                        timestamp=latest_time or timeline_end,
                        event_type="diagnostic:circular_dependency",
                        agent_id=None,
                        agent_name=None,
                        task_id=cycle[0] if cycle else None,
                        task_name=None,
                        data={
                            "severity": "critical",
                            "description": f"Circular dependency detected: {' → '.join(cycle_names)}...",
                            "recommendation": "Break the cycle by removing one dependency link",
                            "cycle": cycle,
                            "cycle_length": len(cycle),
                        },
                    )
                )

        # 4. Detect redundant dependencies (transitive)
        for task in tasks:
            if len(task.dependency_ids) < 2:
                continue

            # Find what's reachable through dependencies
            reachable: Set[str] = set()

            def find_reachable(dep_id: str, visited_deps: Set[str]) -> None:
                """Find all tasks reachable from dep_id."""
                if dep_id in visited_deps or dep_id not in tasks_by_id:
                    return
                visited_deps.add(dep_id)
                dep_task = tasks_by_id[dep_id]
                for next_dep in dep_task.dependency_ids:
                    reachable.add(next_dep)
                    find_reachable(next_dep, visited_deps)

            for dep_id in task.dependency_ids:
                find_reachable(dep_id, set())

            # Check if any direct dependency is also reachable transitively
            redundant = set(task.dependency_ids) & reachable

            if redundant:
                event_time = task.updated_at or timeline_end
                for redundant_dep in redundant:
                    redundant_task = tasks_by_id.get(redundant_dep)
                    if redundant_task:
                        diagnostic_events.append(
                            Event(
                                id=f"diagnostic_redundant_{task.id}_{redundant_dep}",
                                timestamp=event_time,
                                event_type="diagnostic:redundant_dependency",
                                agent_id=None,
                                agent_name=None,
                                task_id=task.id,
                                task_name=task.name,
                                data={
                                    "severity": "low",
                                    "description": f"Task '{task.name}' has redundant dependency on '{redundant_task.name}'",
                                    "recommendation": "Remove redundant dependency to simplify graph",
                                    "redundant_dependency_id": redundant_dep,
                                    "redundant_dependency_name": redundant_task.name,
                                },
                            )
                        )

        logger.info(f"Generated {len(diagnostic_events)} diagnostic timeline events")
        return diagnostic_events

    def _calculate_metrics(
        self, tasks: List[Task], agents: List[Agent], messages: List[Message]
    ) -> Metrics:
        """Calculate all project metrics."""
        total_tasks = len(tasks)
        completed_tasks = len([t for t in tasks if t.status == "done"])
        in_progress_tasks = len([t for t in tasks if t.status == "in_progress"])
        blocked_tasks = len([t for t in tasks if t.status == "blocked"])
        completion_rate = completed_tasks / total_tasks if total_tasks > 0 else 0.0

        # Time metrics
        completed_task_durations = []
        for task in tasks:
            if task.completed_at and task.started_at:
                duration = (task.completed_at - task.started_at).total_seconds() / 3600
                completed_task_durations.append(duration)

        avg_duration = (
            sum(completed_task_durations) / len(completed_task_durations)
            if completed_task_durations
            else 0.0
        )

        # Parallelization metrics
        # TODO: Calculate peak parallelization by analyzing task overlap
        peak_parallel = max(
            len([t for t in tasks if t.status == "in_progress"]), in_progress_tasks
        )

        # Agent metrics
        total_agents = len(agents)
        active_agents = len([a for a in agents if a.current_task_ids])
        tasks_per_agent = total_tasks / total_agents if total_agents > 0 else 0.0

        # Blockers
        total_blockers = sum(a.blockers_reported for a in agents)
        blocked_percentage = blocked_tasks / total_tasks if total_tasks > 0 else 0.0

        return Metrics(
            total_tasks=total_tasks,
            completed_tasks=completed_tasks,
            in_progress_tasks=in_progress_tasks,
            blocked_tasks=blocked_tasks,
            completion_rate=completion_rate,
            total_duration_minutes=0,  # TODO: Calculate from timeline
            average_task_duration_hours=avg_duration,
            peak_parallel_tasks=peak_parallel,
            average_parallel_tasks=float(in_progress_tasks),
            parallelization_efficiency=0.0,  # TODO: Calculate
            total_agents=total_agents,
            active_agents=active_agents,
            tasks_per_agent=tasks_per_agent,
            total_blockers=total_blockers,
            blocked_task_percentage=blocked_percentage,
        )

    def _build_dependency_graph(self, tasks: List[Task]) -> Dict[str, List[str]]:
        """Build task dependency graph."""
        graph = {}
        for task in tasks:
            graph[task.id] = task.dependency_ids
        return graph

    def _build_communication_graph(
        self, messages: List[Message]
    ) -> Dict[str, List[str]]:
        """Build agent communication graph."""
        graph = defaultdict(set)
        for msg in messages:
            if msg.from_agent_id and msg.to_agent_id:
                graph[msg.from_agent_id].add(msg.to_agent_id)
        return {k: list(v) for k, v in graph.items()}

    def _parse_timestamp(self, ts_str: Optional[str]) -> Optional[datetime]:
        """Parse timestamp string to timezone-aware datetime."""
        if not ts_str:
            return None

        try:
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            return ts
        except (ValueError, AttributeError):
            return None
