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
import sqlite3
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
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

        # Cache for projects data to avoid repeated file I/O
        self._projects_cache: Optional[List[Dict[str, Any]]] = None
        self._projects_cache_time: Optional[datetime] = None
        self._projects_cache_ttl = 60  # Cache for 60 seconds

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

        # Step 2: Inherit parent dependencies to first subtasks BEFORE filtering
        # (must happen before parent tasks are filtered out)
        raw_tasks = self._inherit_parent_dependencies_to_first_subtask(raw_tasks)

        # Step 3: Filter tasks by view mode
        filtered_tasks = self._filter_tasks_by_view(raw_tasks, view_mode)

        # Step 3: Pre-filter messages by project tasks (two-pass approach)
        # Create task_ids set early for message filtering
        task_ids_set = {t["id"] for t in filtered_tasks}

        # PASS 1: Filter messages directly related to project tasks
        task_related_messages = []
        for msg in raw_messages:
            task_id = msg.get("task_id") or msg.get("metadata", {}).get("task_id")
            if task_id and task_id in task_ids_set:
                task_related_messages.append(msg)

        # Infer project agents from tasks and task-related messages only
        project_agent_ids = set()

        # From tasks
        for task in filtered_tasks:
            agent_id = (
                task.get("assigned_agent_id")
                or task.get("agent_id")
                or task.get("assigned_to")
            )
            if agent_id:
                project_agent_ids.add(agent_id)

        # From task-related messages
        for msg in task_related_messages:
            from_agent = msg.get("from_agent_id")
            to_agent = msg.get("to_agent_id")
            if from_agent:
                project_agent_ids.add(from_agent)
            if to_agent:
                project_agent_ids.add(to_agent)

        logger.info(f"Identified {len(project_agent_ids)} project agents from tasks and messages")

        # PASS 2: Include all messages involving project agents
        filtered_messages = []
        for msg in raw_messages:
            task_id = msg.get("task_id") or msg.get("metadata", {}).get("task_id")
            from_agent = msg.get("from_agent_id")
            to_agent = msg.get("to_agent_id")

            # Include if: (1) related to project task, OR (2) involves project agents
            if (task_id and task_id in task_ids_set) or \
               (from_agent in project_agent_ids) or \
               (to_agent in project_agent_ids):
                filtered_messages.append(msg)

        logger.info(f"Pre-filtered messages: {len(filtered_messages)}/{len(raw_messages)} related to project")

        # Step 4: Build lookup tables for denormalization
        projects_by_id = {p["id"]: p for p in projects_data if "id" in p}
        # Use ALL tasks for lookup (including parents) so subtasks can find parent names
        all_tasks_by_id = {t["id"]: t for t in raw_tasks}
        tasks_by_id = {t["id"]: t for t in filtered_tasks}
        agents_by_id = self._infer_agents(filtered_tasks, filtered_messages)

        # Step 5: Enrich tasks with started_at and completed_at from messages
        self._enrich_tasks_with_message_timestamps(filtered_tasks, filtered_messages)

        # Step 5.5: Calculate synthetic start times based on dependencies
        # (for tasks without started_at but with dependencies)
        self._calculate_synthetic_start_times(filtered_tasks)

        # Step 6: Calculate timeline boundaries
        timeline_start, timeline_end, duration_minutes = self._calculate_timeline(
            filtered_tasks, filtered_messages
        )

        # Step 7: Build denormalized tasks with timeline positions
        tasks = self._build_tasks(
            filtered_tasks,
            projects_by_id,
            all_tasks_by_id,  # Use ALL tasks for parent lookup
            agents_by_id,
            timeline_start,
            timeline_end,
            timeline_scale_exponent,
        )

        # Step 8: Build denormalized agents with metrics
        agents = self._build_agents(agents_by_id, tasks, filtered_messages)

        # Step 9: Build denormalized messages (already filtered above)
        final_task_ids_set = {t.id for t in tasks}
        messages = self._build_messages(
            filtered_messages, final_task_ids_set, all_tasks_by_id, agents_by_id
        )

        # Step 9: Build denormalized events
        events = self._build_events(raw_events, final_task_ids_set, all_tasks_by_id, agents_by_id)

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
        """Load projects from projects.json with caching."""
        # Check cache first
        now = datetime.now(timezone.utc)
        if (
            self._projects_cache is not None
            and self._projects_cache_time is not None
            and (now - self._projects_cache_time).total_seconds() < self._projects_cache_ttl
        ):
            return self._projects_cache

        # Cache miss - load from file
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

                # Update cache
                self._projects_cache = projects
                self._projects_cache_time = now

                logger.info(f"Loaded {len(projects)} projects")
                return projects
        except Exception as e:
            logger.error(f"Error loading projects: {e}")
            return []

    def get_active_project_id(self) -> Optional[str]:
        """
        Get the ID of the currently active project from projects.json.

        Returns
        -------
        Optional[str]
            Active project ID if set, None otherwise
        """
        projects_file = self.persistence_dir / "projects.json"
        if not projects_file.exists():
            return None

        try:
            with open(projects_file, "r") as f:
                data = json.load(f)
                active_project = data.get("active_project", {})
                return active_project.get("project_id")
        except Exception as e:
            logger.error(f"Error loading active project: {e}")
            return None

    def get_parent_task_ids_from_conversations(
        self, project_id: str, board_id: str
    ) -> set[str]:
        """
        Query conversation logs (events) to find parent task IDs for a project.

        Parent tasks are logged in the events collection with project_id and board_id context.
        This method queries the marcus.db events to find all parent tasks (tasks without '_sub_' in ID)
        associated with the given project.

        Parameters
        ----------
        project_id : str
            The Marcus project UUID
        board_id : str
            The Planka board ID

        Returns
        -------
        set[str]
            Set of parent task IDs associated with this project
        """
        parent_task_ids = set()

        db_path = self.marcus_root / "data" / "marcus.db"
        if not db_path.exists():
            logger.warning(f"marcus.db not found at {db_path}")
            return parent_task_ids

        try:
            with sqlite3.connect(str(db_path)) as conn:
                cursor = conn.cursor()

                # Query events that contain task_assignment or task_request with project context
                cursor.execute(
                    """
                    SELECT data
                    FROM persistence
                    WHERE collection = 'events'
                    """
                )

                for (event_data_str,) in cursor.fetchall():
                    try:
                        event_data = json.loads(event_data_str)

                        # Check if event has data with project/board context
                        event_payload = event_data.get("data", {})

                        # Check for project_id or board_id match
                        event_project_id = event_payload.get("project_id")
                        event_board_id = event_payload.get("board_id")

                        if event_project_id == project_id or event_board_id == board_id:
                            # Extract task_id if present and it's a parent task (no _sub_)
                            task_id = event_payload.get("task_id")
                            if task_id and "_sub_" not in str(task_id):
                                parent_task_ids.add(str(task_id))

                    except (json.JSONDecodeError, KeyError) as e:
                        continue

                logger.info(
                    f"Found {len(parent_task_ids)} parent task IDs from conversation logs "
                    f"for project {project_id}"
                )

        except Exception as e:
            logger.error(f"Error querying conversation logs: {e}")

        return parent_task_ids

    def _resolve_slug_dependencies(
        self, tasks: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """
        Resolve slug-based dependency IDs to actual task IDs.

        Parent tasks use human-readable slugs (e.g., 'design_time_management')
        for dependencies, but we need numeric Planka IDs for the dependency graph.

        Parameters
        ----------
        tasks : list[dict[str, Any]]
            List of tasks with potentially slug-based dependency_ids

        Returns
        -------
        list[dict[str, Any]]
            Tasks with resolved dependency IDs
        """
        # Build slug-to-ID mapping from all tasks
        slug_to_id: dict[str, str] = {}
        for task in tasks:
            task_name = task.get("name", "")
            task_id = str(task.get("id", ""))
            if task_name and task_id:
                # Generate slug: lowercase, replace spaces with underscores
                slug = task_name.lower().replace(" ", "_")
                slug_to_id[slug] = task_id

        logger.info(f"Built slug-to-ID mapping with {len(slug_to_id)} entries")

        # Resolve dependency IDs
        resolutions = 0
        for task in tasks:
            dependency_ids = task.get("dependencies", [])
            if not dependency_ids:
                continue

            resolved_deps: list[str] = []
            for dep_id in dependency_ids:
                dep_str = str(dep_id)

                # Check if this is a slug (non-numeric)
                if not dep_str.isdigit():
                    # Try to resolve slug to actual ID
                    if dep_str in slug_to_id:
                        resolved_id = slug_to_id[dep_str]
                        resolved_deps.append(resolved_id)
                        resolutions += 1
                        logger.debug(
                            f"Resolved dependency '{dep_str}' → '{resolved_id}' "
                            f"for task {task.get('name', 'Unknown')}"
                        )
                    else:
                        # Slug not found, keep original
                        logger.warning(
                            f"Could not resolve dependency slug '{dep_str}' "
                            f"for task {task.get('name', 'Unknown')}"
                        )
                        resolved_deps.append(dep_str)
                else:
                    # Already numeric ID, keep as-is
                    resolved_deps.append(dep_str)

            # Update task with resolved dependencies
            task["dependencies"] = resolved_deps

        logger.info(f"Resolved {resolutions} slug-based dependencies to task IDs")
        return tasks

    def _add_parent_dependencies(
        self, tasks: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """
        Add parent task IDs to subtask dependency_ids for graph layering.

        Subtasks need to depend on their parent tasks to create proper
        graph hierarchy and dependency arrows.

        Parameters
        ----------
        tasks : list[dict[str, Any]]
            List of task dictionaries

        Returns
        -------
        list[dict[str, Any]]
            Tasks with updated dependency_ids
        """
        enriched_count = 0

        for task in tasks:
            parent_task_id = task.get("parent_task_id")

            # Only process subtasks that have a parent
            if not parent_task_id:
                continue

            # Get or initialize dependency_ids
            dependency_ids = task.get("dependency_ids", [])
            if not isinstance(dependency_ids, list):
                dependency_ids = []

            # Add parent to dependencies if not already present
            parent_id_str = str(parent_task_id)
            if parent_id_str not in [str(d) for d in dependency_ids]:
                dependency_ids.append(parent_id_str)
                task["dependency_ids"] = dependency_ids
                enriched_count += 1

        logger.info(
            f"Added parent dependencies to {enriched_count} subtasks "
            f"for graph layering"
        )
        return tasks

    def _inherit_parent_dependencies_to_first_subtask(
        self, tasks: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """
        Inherit parent dependencies to ONLY the first subtask for clean visualization.

        The first subtask is identified as the one with no inter-subtask dependencies.
        This creates a clean dependency flow: Parent Dependencies → First Subtask → Other Subtasks.

        Parameters
        ----------
        tasks : list[dict[str, Any]]
            List of task dictionaries

        Returns
        -------
        list[dict[str, Any]]
            Tasks with updated dependencies
        """
        # Build mapping of parent_id → parent task
        parent_tasks = {
            str(t["id"]): t for t in tasks if not t.get("parent_task_id")
        }

        # Group subtasks by their parent
        subtasks_by_parent: dict[str, list[dict[str, Any]]] = {}
        for task in tasks:
            parent_id = task.get("parent_task_id")
            if parent_id:
                parent_id_str = str(parent_id)
                if parent_id_str not in subtasks_by_parent:
                    subtasks_by_parent[parent_id_str] = []
                subtasks_by_parent[parent_id_str].append(task)

        inherited_count = 0

        # For each parent with subtasks
        for parent_id_str, subtasks in subtasks_by_parent.items():
            parent_task = parent_tasks.get(parent_id_str)
            if not parent_task:
                continue

            parent_deps = parent_task.get("dependencies", [])
            if not parent_deps:
                continue  # Parent has no dependencies to inherit

            # Find the "first" subtask - the one with NO dependencies
            # This is the subtask that can start immediately after parent deps
            first_subtasks = [
                t for t in subtasks if not t.get("dependencies", [])
            ]

            if not first_subtasks:
                # No subtask with empty dependencies, skip
                continue

            # Use the first one found (there should typically be only one)
            first_subtask = first_subtasks[0]

            # Add parent dependencies to first subtask
            subtask_deps = list(first_subtask.get("dependencies", []))

            # Add parent's dependencies to first subtask (avoid duplicates)
            for dep in parent_deps:
                dep_str = str(dep)
                if dep_str not in [str(d) for d in subtask_deps]:
                    subtask_deps.append(dep_str)
                    inherited_count += 1

            first_subtask["dependencies"] = subtask_deps

        logger.info(
            f"Inherited parent dependencies to {len([s for s in subtasks_by_parent.values() if s])} "
            f"first subtasks ({inherited_count} dependencies added)"
        )
        return tasks

    def _load_tasks(self, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Load tasks from both subtasks.json and marcus.db, optionally filtered by project.

        Parent tasks are stored in marcus.db (task_metadata collection).
        Subtasks are stored in subtasks.json.
        This method loads and merges both to provide a complete task list.
        """
        all_tasks = []

        # Load parent tasks from database
        parent_tasks = self.load_parent_tasks_from_db()
        all_tasks.extend(parent_tasks)
        print(f"[DEBUG] Loaded {len(parent_tasks)} parent tasks from database")
        logger.info(f"Loaded {len(parent_tasks)} parent tasks from database")

        # Load subtasks from JSON file
        subtasks_file = self.persistence_dir / "subtasks.json"
        if subtasks_file.exists():
            try:
                with open(subtasks_file, "r") as f:
                    data = json.load(f)

                    # Handle nested format: {"subtasks": {task_id: task_data}}
                    if isinstance(data, dict) and "subtasks" in data:
                        subtasks = list(data["subtasks"].values())
                    # Handle both formats: {task_id: task_data} or [task1, task2, ...]
                    elif isinstance(data, dict):
                        subtasks = list(data.values())
                    else:
                        subtasks = data

                    all_tasks.extend(subtasks)
                    logger.info(f"Loaded {len(subtasks)} subtasks from subtasks.json")
            except Exception as e:
                logger.error(f"Error loading subtasks.json: {e}")
        else:
            logger.warning(f"Subtasks file not found: {subtasks_file}")

        logger.info(f"Total tasks loaded (before filtering): {len(all_tasks)}")

        try:

                # Enrich tasks with actual timing data from marcus.db before filtering
                all_tasks = self.enrich_tasks_with_timing(all_tasks)

                # Filter by project using fuzzy matching (±20 range)
                # Planka creates task IDs that are offset from board IDs
                if project_id:
                    # Load projects to get Planka board/project ID mapping (uses cache)
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
                            # Pre-compute target prefixes for efficient comparison
                            target_prefixes = []
                            for id_to_check in [planka_board_id, planka_project_id]:
                                if id_to_check and len(id_to_check) >= 8:
                                    try:
                                        target_prefixes.append(int(id_to_check[:8]))
                                    except ValueError:
                                        pass

                            if not target_prefixes:
                                logger.warning(
                                    f"No valid Planka ID prefixes for project {project_id}"
                                )
                                return all_tasks

                            # Get project creation time for timestamp-based filtering
                            from datetime import datetime, timezone, timedelta
                            project_created_at = None
                            if project_info and "created_at" in project_info:
                                try:
                                    project_created_at = datetime.fromisoformat(
                                        project_info["created_at"].replace("Z", "+00:00")
                                    )
                                except Exception:
                                    pass

                            # First pass: Filter subtasks using Planka fuzzy ID matching
                            # and collect their parent IDs
                            filtered_tasks = []
                            parent_ids_to_include = set()

                            for task in all_tasks:
                                parent_task_id = task.get("parent_task_id")
                                is_parent_task = parent_task_id is None and not task.get("is_subtask", False)

                                # Skip parent tasks in first pass - we'll handle them after
                                if is_parent_task:
                                    continue

                                # Always check the task's own ID for initial matching
                                # Parent tasks will be included later via parent_ids_to_include
                                id_to_check = str(task.get("id", ""))

                                # Early exit: Skip non-Planka IDs
                                if not id_to_check or len(id_to_check) < 8 or not id_to_check[0].isdigit():
                                    continue

                                try:
                                    id_prefix = int(id_to_check[:8])

                                    # Check distance to any target prefix
                                    for target_prefix in target_prefixes:
                                        if abs(id_prefix - target_prefix) <= 20:
                                            filtered_tasks.append(task)
                                            # Extract parent ID from subtask ID (format: {parent_id}_sub_{index})
                                            task_id_str = str(task.get("id", ""))
                                            if "_sub_" in task_id_str:
                                                parent_id = task_id_str.split("_sub_")[0]
                                                parent_ids_to_include.add(parent_id)
                                            break  # Found match, no need to check other prefixes
                                except ValueError:
                                    # Fallback: try string prefix match
                                    for planka_id in [planka_board_id, planka_project_id]:
                                        if planka_id and id_to_check.startswith(planka_id[:8]):
                                            filtered_tasks.append(task)
                                            # Extract parent ID from subtask ID
                                            task_id_str = str(task.get("id", ""))
                                            if "_sub_" in task_id_str:
                                                parent_id = task_id_str.split("_sub_")[0]
                                                parent_ids_to_include.add(parent_id)
                                            break

                            # Collect dependency IDs from matched tasks to find bundled design tasks
                            dependency_ids_to_include = set()
                            for task in filtered_tasks:
                                deps = task.get("dependency_ids", [])
                                if deps:
                                    dependency_ids_to_include.update(str(d) for d in deps)

                            # Get parent task IDs from conversation logs
                            # This is the authoritative source for project→parent task mapping
                            conversation_parent_ids = self.get_parent_task_ids_from_conversations(
                                project_id=project_id,
                                board_id=planka_board_id
                            )

                            logger.info(
                                f"Collected {len(parent_ids_to_include)} parent IDs from subtasks, "
                                f"{len(dependency_ids_to_include)} from dependencies, "
                                f"{len(conversation_parent_ids)} from conversation logs"
                            )

                            # Second pass: Include parent tasks whose IDs were referenced
                            # Priority: conversation logs (authoritative) > subtasks > dependencies
                            for task in all_tasks:
                                parent_task_id = task.get("parent_task_id")
                                is_parent_task = parent_task_id is None and not task.get("is_subtask", False)

                                if is_parent_task:
                                    task_id = str(task.get("id", ""))
                                    # Include if referenced by conversation logs, subtasks, or dependencies
                                    if (task_id in conversation_parent_ids or
                                        task_id in parent_ids_to_include or
                                        task_id in dependency_ids_to_include):
                                        filtered_tasks.append(task)

                            logger.info(
                                f"Filtered {len(filtered_tasks)}/{len(all_tasks)} tasks "
                                f"for project {project_id} (Planka ID: {planka_project_id})"
                            )

                            # Resolve slug-based dependencies to actual task IDs
                            filtered_tasks = self._resolve_slug_dependencies(filtered_tasks)

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
        """
        Filter tasks based on view mode.

        For 'subtasks' view: return subtasks + parent tasks WITHOUT subtasks
        - Subtasks: tasks with parent_task_id set
        - Parent tasks WITHOUT subtasks: bundled design tasks, standalone tasks
        - Parent tasks WITH subtasks: excluded (their subtasks represent them)

        This creates clean parallelization visualization showing task execution flow.
        """
        if view_mode == "subtasks":
            # Build set of parent IDs that have subtasks
            parent_ids_with_subtasks = {
                str(t.get("parent_task_id"))
                for t in tasks
                if t.get("parent_task_id")
            }

            # Return: subtasks + parents WITHOUT subtasks
            return [
                t
                for t in tasks
                if t.get("parent_task_id")  # Is a subtask
                or str(t.get("id")) not in parent_ids_with_subtasks  # Parent without subtasks
            ]
        elif view_mode == "parents":
            # Infer is_subtask from parent_task_id if not explicitly set
            return [
                t
                for t in tasks
                if not t.get("is_subtask", bool(t.get("parent_task_id")))
            ]
        else:  # "all"
            return tasks

    def _infer_agents(
        self, tasks: List[Dict[str, Any]], messages: List[Dict[str, Any]]
    ) -> Dict[str, Dict[str, Any]]:
        """Infer agents from tasks and messages."""
        agents = {}

        def get_agent_name(agent_id: str) -> str:
            """Convert agent ID to display name. System/marcus becomes 'Marcus'."""
            if agent_id.lower() in ["system", "marcus"]:
                return "Marcus"
            return agent_id

        # Always include system agent
        agents["system"] = {
            "id": "system",
            "name": "Marcus",
            "role": "system",
            "skills": [],
        }

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
                    "name": get_agent_name(agent_id),
                    "role": "system" if agent_id.lower() in ["system", "marcus"] else "agent",
                    "skills": [],
                }

        # From messages (extract better names if available)
        for msg in messages:
            for id_field in ["from_agent_id", "to_agent_id", "agent_id"]:
                agent_id = msg.get(id_field)
                if agent_id and agent_id not in agents:
                    agents[agent_id] = {
                        "id": agent_id,
                        "name": get_agent_name(agent_id),
                        "role": "system" if agent_id.lower() in ["system", "marcus"] else "agent",
                        "skills": [],
                    }

        logger.info(f"Inferred {len(agents)} agents")
        return agents

    def _calculate_progress(self, task_data: Dict[str, Any]) -> int:
        """
        Calculate task progress percentage based on status and hours.

        Matches viz worktree implementation for accurate progress display.

        Parameters
        ----------
        task_data : Dict[str, Any]
            Raw task data from persistence

        Returns
        -------
        int
            Progress percentage (0-100)
        """
        status = task_data.get("status", "todo")

        if status == "done":
            return 100
        elif status == "in_progress":
            # Try to calculate from actual vs estimated hours
            estimated = task_data.get("estimated_hours", 0.0)
            actual = task_data.get("actual_hours", 0.0)
            if estimated > 0 and actual > 0:
                # Cap at 90% to leave room for review/completion
                return min(int((actual / estimated) * 100), 90)
            # Default to 50% if no hours tracked yet
            return 50
        elif status == "blocked":
            return 0
        else:  # todo or any other status
            return 0

    def load_parent_tasks_from_db(self) -> List[Dict[str, Any]]:
        """
        Load parent tasks from marcus.db (task_metadata collection).

        Parent tasks are stored in the database, while subtasks are in subtasks.json.
        This method loads the parent tasks and enriches them with outcome data.

        Returns
        -------
        List[Dict[str, Any]]
            List of parent task dictionaries with task metadata and outcomes.
        """
        import sqlite3

        db_path = self.marcus_root / "data" / "marcus.db"
        if not db_path.exists():
            logger.warning(f"marcus.db not found at {db_path}")
            return []

        try:
            conn = sqlite3.connect(str(db_path))
            cursor = conn.cursor()

            # Load task_metadata
            cursor.execute(
                """
                SELECT key, data FROM persistence
                WHERE collection = 'task_metadata'
                """
            )

            task_metadata_map = {}
            for task_id, data_json in cursor.fetchall():
                try:
                    task_data = json.loads(data_json)
                    task_metadata_map[task_id] = task_data
                except json.JSONDecodeError as e:
                    logger.warning(f"Failed to parse task_metadata for {task_id}: {e}")

            # Load task_outcomes to get completion data
            cursor.execute(
                """
                SELECT key, data FROM persistence
                WHERE collection = 'task_outcomes'
                """
            )

            task_outcomes_map = {}
            for outcome_key, data_json in cursor.fetchall():
                try:
                    outcome_data = json.loads(data_json)
                    # Outcome keys are like: "task_id_agent_id_timestamp"
                    # Extract the task_id part
                    actual_task_id = outcome_data.get("task_id", outcome_key.split("_")[0])
                    task_outcomes_map[actual_task_id] = outcome_data
                except json.JSONDecodeError as e:
                    logger.warning(f"Failed to parse task_outcomes for {outcome_key}: {e}")

            conn.close()

            # Merge metadata with outcomes and normalize fields
            parent_tasks = []
            for task_id, metadata in task_metadata_map.items():
                # Start with metadata
                task = metadata.copy()

                # Ensure id field
                if "task_id" in task and "id" not in task:
                    task["id"] = task["task_id"]

                # Get outcome data if available (match by task_id from metadata)
                actual_task_id = task.get("task_id", task_id)
                outcome = task_outcomes_map.get(actual_task_id, {})

                # Derive status from outcome data
                # task_outcomes schema: {success: bool, completed_at: str, started_at: str}
                # Use "done" for completed tasks to match _calculate_progress() expectations
                if outcome:
                    if outcome.get("completed_at"):
                        derived_status = "done"
                    elif outcome.get("started_at"):
                        derived_status = "in_progress"
                    else:
                        derived_status = "pending"
                else:
                    derived_status = "todo"

                # Add/normalize required fields
                task["status"] = derived_status
                task["updated_at"] = outcome.get("completed_at") or outcome.get("started_at") or task.get("created_at")
                task["started_at"] = outcome.get("started_at")
                task["completed_at"] = outcome.get("completed_at")
                task["actual_hours"] = outcome.get("actual_hours", 0.0)
                task["progress_percent"] = 100 if outcome.get("completed_at") else 0
                task["assigned_agent_id"] = outcome.get("agent_id")

                # Normalize dependencies field
                if "dependencies" in task:
                    task["dependency_ids"] = task["dependencies"]

                # Add missing fields with defaults
                task.setdefault("parent_task_id", None)
                task.setdefault("is_subtask", False)
                task.setdefault("assigned_agent_name", None)
                task.setdefault("project_id", None)
                task.setdefault("project_name", None)

                parent_tasks.append(task)

            logger.info(f"Loaded {len(parent_tasks)} parent tasks from marcus.db")
            return parent_tasks

        except Exception as e:
            logger.error(f"Error loading parent tasks from database: {e}")
            return []

    def load_task_outcomes_from_db(self) -> Dict[str, Dict[str, Any]]:
        """
        Load task outcomes from marcus.db (Memory system).

        Returns actual task durations and completion data from completed tasks.

        Returns
        -------
        Dict[str, Dict[str, Any]]
            Dictionary mapping task_id to outcome data with actual_hours,
            started_at, completed_at, etc.
        """
        import sqlite3

        db_path = self.marcus_root / "data" / "marcus.db"
        if not db_path.exists():
            logger.warning(f"marcus.db not found at {db_path}")
            return {}

        try:
            conn = sqlite3.connect(str(db_path))
            cursor = conn.cursor()

            # Query task_outcomes from persistence table
            cursor.execute(
                """
                SELECT key, data FROM persistence
                WHERE collection = 'task_outcomes'
            """
            )

            outcomes = {}
            for row in cursor.fetchall():
                task_id, data_json = row
                data = json.loads(data_json)

                # Extract key fields
                outcomes[task_id] = {
                    "task_id": task_id,
                    "task_name": data.get("task_name"),
                    "actual_hours": data.get("actual_hours", 0.0),
                    "estimated_hours": data.get("estimated_hours", 0.0),
                    "created_at": data.get("created_at"),
                    "started_at": data.get("started_at"),
                    "completed_at": data.get("completed_at"),
                    "status": "done",  # Outcomes are for completed tasks
                }

            conn.close()
            logger.info(f"Loaded {len(outcomes)} task outcomes from marcus.db")
            return outcomes

        except Exception as e:
            logger.error(f"Error loading task outcomes from db: {e}")
            return {}

    def load_task_timing_from_agent_events(self) -> Dict[str, Dict[str, Any]]:
        """
        Load task start/end times from events in marcus.db.

        Extracts timing data from task_completed events which contain
        both started_at and completed_at timestamps.

        Returns
        -------
        Dict[str, Dict[str, Any]]
            Dictionary mapping task_id to timing data with
            start_time, end_time, duration
        """
        import sqlite3

        timings: Dict[str, Any] = {}
        db_path = self.marcus_root / "data" / "marcus.db"

        if not db_path.exists():
            logger.warning(f"marcus.db not found at {db_path}")
            return timings

        try:
            conn = sqlite3.connect(str(db_path))
            cursor = conn.cursor()

            # Get task_completed events which contain started_at and completed_at
            cursor.execute(
                """
                SELECT data FROM persistence
                WHERE collection = 'events'
                  AND json_extract(data, '$.event_type') = 'task_completed'
            """
            )

            for row in cursor.fetchall():
                try:
                    event = json.loads(row[0])
                    event_data = event.get("data", {})

                    task_id = event_data.get("task_id")
                    started_at = event_data.get("started_at")
                    completed_at = event_data.get("completed_at")
                    task_name = event_data.get("task_name")

                    if task_id and started_at and completed_at:
                        # Ensure timestamps have timezone info for JavaScript compatibility
                        # Marcus events store timestamps without timezone, so add UTC
                        start_with_tz = (
                            started_at
                            if started_at.endswith(("Z", "+00:00"))
                            else started_at + "+00:00"
                        )
                        end_with_tz = (
                            completed_at
                            if completed_at.endswith(("Z", "+00:00"))
                            else completed_at + "+00:00"
                        )

                        timings[task_id] = {
                            "start_time": start_with_tz,
                            "end_time": end_with_tz,
                            "task_name": task_name,
                        }

                        # Calculate duration
                        try:
                            start = datetime.fromisoformat(
                                start_with_tz.replace("Z", "+00:00")
                            )
                            end = datetime.fromisoformat(
                                end_with_tz.replace("Z", "+00:00")
                            )
                            duration_seconds = (end - start).total_seconds()
                            timings[task_id]["duration_seconds"] = duration_seconds
                            timings[task_id]["duration_minutes"] = duration_seconds / 60
                            timings[task_id]["duration_hours"] = duration_seconds / 3600
                        except Exception as e:
                            logger.warning(
                                f"Error calculating duration for {task_id}: {e}"
                            )

                except json.JSONDecodeError as e:
                    logger.warning(f"Error parsing event JSON: {e}")
                    continue

            conn.close()
            logger.info(
                f"Loaded timing for {len(timings)} tasks from marcus.db events"
            )
            if timings:
                # Log first timing for debugging
                first_task_id = list(timings.keys())[0]
                logger.info(
                    f"Example timing: {first_task_id} -> {timings[first_task_id]}"
                )
            return timings

        except Exception as e:
            logger.error(f"Error loading task timing from marcus.db events: {e}")
            return {}

    def enrich_tasks_with_timing(
        self, tasks: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Enrich task data with actual timing from marcus.db.

        Loads timing data from task_outcomes and task_completed events,
        then updates task dictionaries with actual start/end times and durations.
        This enables smooth timeline animation.

        Parameters
        ----------
        tasks : List[Dict[str, Any]]
            Tasks from subtasks.json with potentially zero durations

        Returns
        -------
        List[Dict[str, Any]]
            Tasks enriched with actual start/end times and durations
        """
        # Load timing data from database
        outcomes = self.load_task_outcomes_from_db()
        timings = self.load_task_timing_from_agent_events()

        logger.info(
            f"Enriching {len(tasks)} tasks with {len(outcomes)} outcomes "
            f"and {len(timings)} timings"
        )

        # Enrich each task
        enriched_count = 0
        for task in tasks:
            task_id = task.get("id", "")

            # Add outcome data if available (try exact match first, then prefix match)
            if task_id in outcomes:
                outcome = outcomes[task_id]
                task["actual_hours"] = outcome["actual_hours"]
                if outcome["started_at"]:
                    task["created_at"] = outcome["started_at"]
                if outcome["completed_at"]:
                    task["updated_at"] = outcome["completed_at"]
            else:
                # Try prefix match (task IDs in marcus.db have agent suffix)
                for outcome_id, outcome in outcomes.items():
                    if outcome_id.startswith(task_id + "_"):
                        task["actual_hours"] = outcome["actual_hours"]
                        if outcome["started_at"]:
                            task["created_at"] = outcome["started_at"]
                        if outcome["completed_at"]:
                            task["updated_at"] = outcome["completed_at"]
                        break

            # Add timing data if available (try exact match first, then prefix match)
            matched_timing = None
            if task_id in timings:
                matched_timing = timings[task_id]
            else:
                # Try prefix match
                for timing_id, timing in timings.items():
                    if timing_id.startswith(task_id + "_"):
                        matched_timing = timing
                        break

            if matched_timing:
                if "start_time" in matched_timing:
                    task["created_at"] = matched_timing["start_time"]
                if "end_time" in matched_timing:
                    task["updated_at"] = matched_timing["end_time"]
                if "duration_hours" in matched_timing:
                    task["actual_hours"] = matched_timing["duration_hours"]
                enriched_count += 1

        logger.info(f"Enriched {enriched_count}/{len(tasks)} tasks with timing data")

        # Filter and prepare tasks for display
        # Keep all tasks including planned, pending, in-progress ones
        filtered_tasks = []
        for task in tasks:
            task_status = task.get("status", "").lower()
            created = task.get("created_at")
            updated = task.get("updated_at")

            # For incomplete tasks (todo, pending, in-progress, blocked),
            # add synthetic timestamps if missing
            incomplete_statuses = ["todo", "pending", "in-progress", "in_progress", "blocked"]
            if task_status in incomplete_statuses:
                # Keep incomplete tasks even without timing data
                if not created:
                    # Use current time as placeholder
                    task["created_at"] = datetime.now(timezone.utc).isoformat()
                if not updated:
                    # Set updated_at = created_at for zero-duration bar
                    task["updated_at"] = task.get("created_at")
                filtered_tasks.append(task)
                continue

            # For completed/failed tasks, try to keep them if they have timing
            if created:
                if not updated:
                    # If no updated_at, use created_at (zero-duration)
                    task["updated_at"] = created

                try:
                    created_dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                    updated_dt = datetime.fromisoformat(task["updated_at"].replace("Z", "+00:00"))
                    duration = (updated_dt - created_dt).total_seconds()

                    # Keep tasks with any duration OR that have actual_hours tracked
                    if duration >= 0 or task.get("actual_hours", 0.0) > 0:
                        filtered_tasks.append(task)
                except Exception as e:
                    logger.debug(f"Skipping task {task.get('id')} due to timestamp error: {e}")
                    continue

        removed_count = len(tasks) - len(filtered_tasks)
        logger.info(
            f"Filtered to {len(filtered_tasks)} tasks with valid timing "
            f"(removed {removed_count} zero-duration tasks, kept planned tasks)"
        )
        return filtered_tasks

    def _calculate_timeline(
        self,
        tasks: List[Dict[str, Any]],
        messages: List[Dict[str, Any]],
    ) -> tuple[datetime, datetime, int]:
        """
        Calculate timeline boundaries from filtered tasks only.

        Collects all available timestamps from tasks (created_at, updated_at,
        started_at, completed_at) and uses min/max to determine timeline.
        Excludes messages to ensure timeline matches the filtered task data.

        Returns
        -------
        tuple
            (start_time, end_time, duration_minutes)
        """
        # Collect all available timestamps from displayed tasks
        timestamps = []

        logger.info(f"Calculating timeline from {len(tasks)} tasks")

        for task in tasks:
            # Only use created_at and updated_at for timeline calculation
            # (started_at/completed_at from messages may have timezone issues)
            for field in ["created_at", "updated_at"]:
                if task.get(field):
                    try:
                        ts_str = task[field]
                        # Handle both ISO format with and without 'Z'
                        if isinstance(ts_str, str):
                            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                            if ts.tzinfo is None:
                                ts = ts.replace(tzinfo=timezone.utc)
                            timestamps.append(ts)
                    except (ValueError, AttributeError, TypeError) as e:
                        logger.warning(f"Failed to parse {field}: {task.get(field)}: {e}")
                        continue

        logger.info(f"Collected {len(timestamps)} timestamps from tasks")

        if not timestamps:
            # No data, use current time
            logger.warning("No valid timestamps found, using current time")
            now = datetime.now(timezone.utc)
            return now, now, 0

        # Use earliest timestamp as start, latest as end
        start_time = min(timestamps)
        end_time = max(timestamps)
        duration_minutes = int((end_time - start_time).total_seconds() / 60)

        logger.info(f"Timeline: {start_time} to {end_time}, duration={duration_minutes} minutes")

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

    def _enrich_tasks_with_message_timestamps(
        self, tasks: List[Dict[str, Any]], messages: List[Dict[str, Any]]
    ) -> None:
        """
        Enrich tasks with started_at and completed_at timestamps from messages.

        Parameters
        ----------
        tasks : List[Dict[str, Any]]
            Task dictionaries to enrich (modified in place)
        messages : List[Dict[str, Any]]
            Messages to extract timestamps from
        """
        # Build message index by task_id for faster lookup
        messages_by_task = {}
        for msg in messages:
            task_id = msg.get("task_id") or msg.get("metadata", {}).get("task_id")
            if task_id:
                if task_id not in messages_by_task:
                    messages_by_task[task_id] = []
                messages_by_task[task_id].append(msg)

        # Enrich each task
        for task in tasks:
            task_id = task.get("id")
            if not task_id or task_id not in messages_by_task:
                continue

            task_messages = messages_by_task[task_id]

            # Find started_at from task_assignment message
            assignment_msgs = [
                m for m in task_messages
                if m.get("type") == "task_assignment"
            ]
            if assignment_msgs:
                # Use earliest assignment
                earliest = min(assignment_msgs, key=lambda m: m.get("timestamp", ""))
                task["started_at"] = earliest.get("timestamp")

            # Find completed_at from worker progress messages
            progress_msgs = [
                m for m in task_messages
                if m.get("conversation_type") == "worker_to_pm"
            ]
            for msg in progress_msgs:
                content = msg.get("message", "")
                metadata = msg.get("metadata", {})
                # Check for 100% in message or status=completed in metadata
                if ("100%" in content or "COMPLETED" in content.upper() or
                    metadata.get("progress") == 100 or
                    metadata.get("status") == "completed"):
                    task["completed_at"] = msg.get("timestamp")
                    break

    def _calculate_synthetic_start_times(
        self, tasks: list[dict[str, Any]]
    ) -> None:
        """
        Calculate and correct start times for tasks based on dependencies.

        For tasks with dependencies:
        1. If no started_at: use max dependency completion time
        2. If started_at is BEFORE dependency completion: override with
           dependency completion time (fixes historical parallel execution bugs)

        This ensures the timeline visualization shows correct dependency ordering
        even when Marcus incorrectly ran tasks in parallel.

        Parameters
        ----------
        tasks : list[dict[str, Any]]
            Task dictionaries to enrich (modified in place)
        """
        from datetime import datetime, timezone

        # Build task lookup by ID
        tasks_by_id = {str(t["id"]): t for t in tasks}

        # Track synthetic timestamps for logging
        synthetic_count = 0

        def get_task_end_time(task: dict[str, Any]) -> datetime | None:
            """Get the end time of a task (completed_at or updated_at)."""
            # Prefer completed_at if available
            if task.get("completed_at"):
                return self._parse_timestamp(task["completed_at"])
            # Fall back to updated_at
            if task.get("updated_at"):
                return self._parse_timestamp(task["updated_at"])
            # If neither, use created_at as fallback
            if task.get("created_at"):
                return self._parse_timestamp(task["created_at"])
            return None

        # Track corrected timestamps for logging
        corrected_count = 0

        # Process all tasks with dependencies
        for task in tasks:
            # Get task dependencies
            dep_ids = task.get("dependencies", [])
            if not dep_ids:
                continue

            # Find latest completion time among dependencies
            latest_dep_end = None
            for dep_id in dep_ids:
                dep_id_str = str(dep_id)
                if dep_id_str not in tasks_by_id:
                    continue

                dep_task = tasks_by_id[dep_id_str]
                dep_end = get_task_end_time(dep_task)

                if dep_end and (latest_dep_end is None or dep_end > latest_dep_end):
                    latest_dep_end = dep_end

            if not latest_dep_end:
                continue

            # Case 1: No started_at - set synthetic start time
            if not task.get("started_at"):
                task["started_at"] = latest_dep_end.isoformat()
                synthetic_count += 1
                logger.debug(
                    f"Synthetic start time for task {task['id']}: "
                    f"{latest_dep_end.isoformat()} (no started_at, using dependency)"
                )
                continue

            # Case 2: started_at exists but is BEFORE dependency completed
            # This happens when Marcus incorrectly ran tasks in parallel
            task_start = self._parse_timestamp(task["started_at"])
            if task_start and task_start < latest_dep_end:
                logger.warning(
                    f"Task {task['id']} started at {task_start.isoformat()} "
                    f"BEFORE dependency completed at {latest_dep_end.isoformat()}. "
                    f"Correcting start time to respect dependency."
                )
                task["started_at"] = latest_dep_end.isoformat()
                corrected_count += 1

        if synthetic_count > 0 or corrected_count > 0:
            logger.info(
                f"Calculated {synthetic_count} synthetic start times, "
                f"corrected {corrected_count} invalid start times "
                f"(started before dependencies completed)"
            )

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
            # Use started_at if available (corrected by synthetic calculation),
            # otherwise fall back to created_at. This matches frontend logic.
            position_timestamp = started_at if started_at else created_at

            if timeline_duration > 0 and position_timestamp:
                linear_pos = (
                    position_timestamp - timeline_start
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
                progress_percent=self._calculate_progress(task_data),
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

            # Map conversation logger fields to expected format
            # Conversation logger uses: source/target, worker_id, conversation_type
            # We need: from_agent_id, to_agent_id
            from_agent_id = msg_data.get("from_agent_id")
            to_agent_id = msg_data.get("to_agent_id")

            # Fallback: try conversation logger format
            if not from_agent_id:
                from_agent_id = msg_data.get("source", "system")
            if not to_agent_id:
                to_agent_id = msg_data.get("target", "system")

            # Handle worker messages (worker_id + conversation_type)
            worker_id = msg_data.get("worker_id")
            conv_type = msg_data.get("conversation_type")
            if worker_id and conv_type:
                if conv_type == "worker_to_pm":
                    from_agent_id = worker_id
                    to_agent_id = "system"
                elif conv_type == "pm_to_worker":
                    from_agent_id = "system"
                    to_agent_id = worker_id

            # Normalize "marcus" to "system" for agent lookup
            if from_agent_id and from_agent_id.lower() == "marcus":
                from_agent_id = "system"
            if to_agent_id and to_agent_id.lower() == "marcus":
                to_agent_id = "system"

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

    def _calculate_parallelization_metrics(
        self, tasks: List[Task]
    ) -> tuple[int, float, float]:
        """
        Calculate parallelization metrics by analyzing task timeline overlap.

        Parameters
        ----------
        tasks : List[Task]
            Tasks to analyze

        Returns
        -------
        tuple[int, float, float]
            (peak_parallel_tasks, average_parallel_tasks, parallelization_efficiency)
        """
        if not tasks:
            return 0, 0.0, 0.0

        # Collect all time events (task starts and ends)
        events = []
        for task in tasks:
            if task.created_at and task.updated_at:
                start_time = task.created_at.timestamp()
                end_time = task.updated_at.timestamp()
                if end_time > start_time:  # Only valid duration tasks
                    events.append((start_time, 1))  # Task starts (+1)
                    events.append((end_time, -1))  # Task ends (-1)

        if not events:
            return 0, 0.0, 0.0

        # Sort events by time
        events.sort()

        # Calculate concurrent tasks at each event
        concurrent_counts = []
        current_count = 0
        last_time = events[0][0]
        total_task_time = 0.0

        for time, delta in events:
            if time > last_time and current_count > 0:
                duration = time - last_time
                total_task_time += duration * current_count
                concurrent_counts.append((duration, current_count))

            current_count += delta
            last_time = time

        if not concurrent_counts:
            return 0, 0.0, 0.0

        # Calculate metrics
        peak_parallel = max(count for _, count in concurrent_counts)

        # Average parallel = total task-time / total duration
        total_duration = events[-1][0] - events[0][0]
        average_parallel = total_task_time / total_duration if total_duration > 0 else 0.0

        # Efficiency = (actual parallel work) / (ideal serial time)
        # Ideal serial time = sum of all task durations
        total_task_duration = sum(
            (task.updated_at.timestamp() - task.created_at.timestamp())
            for task in tasks
            if task.created_at and task.updated_at
            and task.updated_at.timestamp() > task.created_at.timestamp()
        )

        # Efficiency = how much we compressed the work through parallelization
        # If we did all tasks in parallel perfectly, efficiency = 1.0
        # If we did all tasks serially, efficiency = 1/n where n is task count
        if total_duration > 0 and total_task_duration > 0:
            parallelization_efficiency = total_duration / total_task_duration
        else:
            parallelization_efficiency = 0.0

        return peak_parallel, average_parallel, min(parallelization_efficiency, 1.0)

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
        total_duration_seconds = 0.0

        # Find actual timeline boundaries from tasks
        task_times = []
        for task in tasks:
            if task.created_at:
                task_times.append(task.created_at.timestamp())
            if task.updated_at:
                task_times.append(task.updated_at.timestamp())

            # Calculate individual task durations (use created_at/updated_at, not started_at/completed_at)
            if task.created_at and task.updated_at:
                duration_seconds = (task.updated_at.timestamp() - task.created_at.timestamp())
                if duration_seconds > 0:
                    duration_minutes = duration_seconds / 60.0  # Convert to minutes
                    completed_task_durations.append(duration_minutes)

        # Calculate total project duration
        if task_times:
            total_duration_seconds = max(task_times) - min(task_times)
        total_duration_minutes = round(total_duration_seconds / 60.0)  # Round to whole number

        # Average task duration in minutes (note: field name says 'hours' but we use minutes for consistency)
        avg_duration_minutes = (
            sum(completed_task_durations) / len(completed_task_durations)
            if completed_task_durations
            else 0.0
        )

        # Parallelization metrics - analyze timeline overlap
        peak_parallel, average_parallel, parallelization_efficiency = (
            self._calculate_parallelization_metrics(tasks)
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
            total_duration_minutes=total_duration_minutes,
            average_task_duration_hours=avg_duration_minutes,  # Actually minutes, field name is misleading
            peak_parallel_tasks=peak_parallel,
            average_parallel_tasks=average_parallel,
            parallelization_efficiency=parallelization_efficiency,
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
                # Naive timestamps are treated as UTC (Marcus stores all timestamps in UTC)
                ts = ts.replace(tzinfo=timezone.utc)
            return ts
        except (ValueError, AttributeError):
            return None
