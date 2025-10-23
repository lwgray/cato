"""
Denormalized Data Models for Cato Visualization.

This module defines the snapshot-based data structures that replace the
multi-layered transformation pipeline. All relationships are pre-joined and
all metrics are pre-calculated to eliminate runtime transformations.

Key principles:
- ALL timestamps must be timezone-aware (UTC)
- ALL relationships are denormalized (no joins needed)
- ALL metrics are pre-calculated (no runtime aggregation)
- Snapshots are immutable (create new snapshot for updates)
"""

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional


@dataclass
class Metrics:
    """
    Pre-calculated metrics for entire project.

    All metrics are calculated once during snapshot creation and stored
    immutably. No recalculation needed at render time.

    Notes
    -----
    - Removed inapplicable metrics (questions, response time, autonomy)
    - Added Marcus-specific metrics (parallelization, blockers)
    - All percentages are 0.0-1.0 floats
    """

    # Task metrics
    total_tasks: int
    completed_tasks: int
    in_progress_tasks: int
    blocked_tasks: int
    completion_rate: float  # 0.0-1.0

    # Time metrics
    total_duration_minutes: int
    average_task_duration_hours: float

    # Parallelization metrics (Marcus's core value proposition)
    peak_parallel_tasks: int  # Max tasks running simultaneously
    average_parallel_tasks: float
    parallelization_efficiency: float  # actual/theoretical max

    # Agent metrics
    total_agents: int
    active_agents: int
    tasks_per_agent: float

    # Marcus-specific metrics
    total_blockers: int  # Agents use report_blocker(), not questions
    blocked_task_percentage: float  # 0.0-1.0


@dataclass
class Task:
    """
    Denormalized task with all relationships embedded.

    No runtime lookups needed - all parent, project, and agent info is
    embedded directly in the task.

    Parameters
    ----------
    id : str
        Unique task identifier
    name : str
        Task name/title
    description : str
        Task description
    status : str
        One of: 'todo', 'in_progress', 'done', 'blocked'
    priority : str
        One of: 'low', 'medium', 'high', 'urgent'
    progress_percent : int
        0-100 completion percentage
    created_at : datetime
        When task was created (must be timezone-aware UTC)
    started_at : Optional[datetime]
        When task started (must be timezone-aware UTC if set)
    completed_at : Optional[datetime]
        When task completed (must be timezone-aware UTC if set)
    updated_at : datetime
        Last update time (must be timezone-aware UTC)
    estimated_hours : float
        Estimated effort in hours
    actual_hours : float
        Actual time spent in hours
    parent_task_id : Optional[str]
        ID of parent task (if this is a subtask)
    parent_task_name : Optional[str]
        Name of parent task (embedded, no join needed)
    is_subtask : bool
        True if this is a subtask
    subtask_index : Optional[int]
        Index among siblings if subtask
    project_id : str
        ID of containing project
    project_name : str
        Name of containing project (embedded, no join needed)
    assigned_agent_id : Optional[str]
        ID of assigned agent
    assigned_agent_name : Optional[str]
        Name of assigned agent (embedded, no join needed)
    assigned_agent_role : Optional[str]
        Role of assigned agent (embedded, no join needed)
    dependency_ids : List[str]
        IDs of tasks this depends on
    dependent_task_ids : List[str]
        IDs of tasks that depend on this (reverse dependencies)
    timeline_linear_position : float
        Linear timeline position 0.0-1.0 (based on created_at)
    timeline_scaled_position : float
        Power-scaled timeline position 0.0-1.0 (for visualization)
    timeline_scale_exponent : float
        Exponent used for power scaling (default 0.4)
    labels : List[str]
        Task labels/tags
    metadata : Dict[str, Any]
        Additional task metadata
    """

    # Core fields
    id: str
    name: str
    description: str
    status: Literal["todo", "in_progress", "done", "blocked"]
    priority: Literal["low", "medium", "high", "urgent"]
    progress_percent: int  # 0-100

    # Time tracking (ALL must be timezone-aware)
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    estimated_hours: float = 0.0
    actual_hours: float = 0.0

    # Embedded parent info (NO JOIN NEEDED)
    parent_task_id: Optional[str] = None
    parent_task_name: Optional[str] = None
    is_subtask: bool = False
    subtask_index: Optional[int] = None

    # Embedded project info (NO JOIN NEEDED)
    project_id: str = ""
    project_name: str = ""

    # Embedded agent info (NO JOIN NEEDED)
    assigned_agent_id: Optional[str] = None
    assigned_agent_name: Optional[str] = None
    assigned_agent_role: Optional[str] = None

    # Dependencies (IDs only, can look up in snapshot.tasks if needed)
    dependency_ids: List[str] = field(default_factory=list)
    dependent_task_ids: List[str] = field(default_factory=list)

    # Pre-calculated timeline positions (saves frontend math)
    timeline_linear_position: float = 0.0  # 0.0-1.0 linear position
    timeline_scaled_position: float = 0.0  # 0.0-1.0 power-scale position
    timeline_scale_exponent: float = 0.4  # Configurable

    # Labels and metadata
    labels: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        """Validate timezone-aware timestamps."""
        if self.created_at.tzinfo is None:
            raise ValueError(f"Task {self.id}: created_at must be timezone-aware")
        if self.updated_at.tzinfo is None:
            raise ValueError(f"Task {self.id}: updated_at must be timezone-aware")
        if self.started_at and self.started_at.tzinfo is None:
            raise ValueError(f"Task {self.id}: started_at must be timezone-aware")
        if self.completed_at and self.completed_at.tzinfo is None:
            raise ValueError(f"Task {self.id}: completed_at must be timezone-aware")


@dataclass
class Agent:
    """
    Denormalized agent with embedded metrics and task info.

    All agent metrics are pre-calculated during snapshot creation.

    Parameters
    ----------
    id : str
        Unique agent identifier
    name : str
        Agent name
    role : str
        Agent role/type
    skills : List[str]
        Agent capabilities
    current_task_ids : List[str]
        IDs of currently assigned tasks
    current_task_names : List[str]
        Names of currently assigned tasks (embedded)
    completed_task_ids : List[str]
        IDs of completed tasks
    completed_tasks_count : int
        Number of completed tasks
    total_hours_worked : float
        Total hours worked
    average_task_duration_hours : float
        Average time per task
    performance_score : float
        0.0-1.0 performance metric
    capacity_utilization : float
        0.0-1.0 capacity usage
    messages_sent : int
        Number of messages sent
    messages_received : int
        Number of messages received
    blockers_reported : int
        Number of blockers reported
    """

    id: str
    name: str
    role: str
    skills: List[str] = field(default_factory=list)

    # Embedded task info (NO JOIN NEEDED)
    current_task_ids: List[str] = field(default_factory=list)
    current_task_names: List[str] = field(default_factory=list)  # Embedded for display
    completed_task_ids: List[str] = field(default_factory=list)

    # Pre-calculated metrics (NO RECALCULATION NEEDED)
    completed_tasks_count: int = 0
    total_hours_worked: float = 0.0
    average_task_duration_hours: float = 0.0
    performance_score: float = 0.0  # 0-1
    capacity_utilization: float = 0.0  # 0-1

    # Communication stats
    messages_sent: int = 0
    messages_received: int = 0
    blockers_reported: int = 0  # Marcus-specific (not questions)


@dataclass
class Message:
    """
    Denormalized message with embedded context.

    All agent and task context is embedded to avoid lookups.

    Parameters
    ----------
    id : str
        Unique message identifier
    timestamp : datetime
        When message was sent (must be timezone-aware UTC)
    message : str
        Message content
    type : str
        Message type (instruction, question, answer, status_update, blocker,
        task_assignment)
    from_agent_id : str
        Sender agent ID
    from_agent_name : str
        Sender agent name (embedded)
    to_agent_id : str
        Recipient agent ID
    to_agent_name : str
        Recipient agent name (embedded)
    task_id : Optional[str]
        Related task ID
    task_name : Optional[str]
        Related task name (embedded)
    parent_message_id : Optional[str]
        Parent message ID for threading
    metadata : Dict[str, Any]
        Additional message metadata
    """

    id: str
    timestamp: datetime
    message: str
    type: Literal[
        "instruction",
        "question",
        "answer",
        "status_update",
        "blocker",
        "task_assignment",
    ]

    # Embedded agent info (NO JOIN NEEDED)
    from_agent_id: str
    from_agent_name: str
    to_agent_id: str
    to_agent_name: str

    # Embedded task info (NO JOIN NEEDED)
    task_id: Optional[str] = None
    task_name: Optional[str] = None

    # Metadata
    parent_message_id: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    # Duplicate detection
    is_duplicate: bool = False
    duplicate_group_id: Optional[str] = None
    duplicate_count: int = 0

    def __post_init__(self) -> None:
        """Validate timezone-aware timestamp."""
        if self.timestamp.tzinfo is None:
            raise ValueError(f"Message {self.id}: timestamp must be timezone-aware")


@dataclass
class Event:
    """
    Denormalized timeline event with embedded context.

    Parameters
    ----------
    id : str
        Unique event identifier
    timestamp : datetime
        When event occurred (must be timezone-aware UTC)
    event_type : str
        Type of event
    agent_id : Optional[str]
        Related agent ID
    agent_name : Optional[str]
        Related agent name (embedded)
    task_id : Optional[str]
        Related task ID
    task_name : Optional[str]
        Related task name (embedded)
    data : Dict[str, Any]
        Event-specific data
    """

    id: str
    timestamp: datetime
    event_type: str

    # Embedded references (NO JOIN NEEDED)
    agent_id: Optional[str] = None
    agent_name: Optional[str] = None
    task_id: Optional[str] = None
    task_name: Optional[str] = None

    # Event data
    data: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        """Validate timezone-aware timestamp."""
        if self.timestamp.tzinfo is None:
            raise ValueError(f"Event {self.id}: timestamp must be timezone-aware")


@dataclass
class Snapshot:
    """
    Immutable snapshot of entire Marcus state for visualization.

    All relationships are pre-joined, all metrics are pre-calculated.
    Snapshots are versioned to enable incremental updates via SSE.

    Parameters
    ----------
    snapshot_id : str
        Unique snapshot identifier
    snapshot_version : int
        Incrementing version number for diff calculation
    timestamp : datetime
        When snapshot was created (must be timezone-aware UTC)
    project_id : Optional[str]
        Specific project filter (None = all projects)
    project_name : str
        Project name
    project_filter_applied : bool
        Whether project filtering was applied
    included_project_ids : List[str]
        Which projects are included in this snapshot
    view_mode : str
        View mode: 'subtasks', 'parents', or 'all'
    tasks : List[Task]
        Pre-joined tasks with all relationships embedded
    agents : List[Agent]
        Pre-calculated agent metrics
    messages : List[Message]
        Pre-joined messages with context
    timeline_events : List[Event]
        Pre-joined timeline events
    metrics : Metrics
        Pre-calculated project metrics
    start_time : datetime
        Project/timeline start time (timezone-aware UTC)
    end_time : datetime
        Project/timeline end time (timezone-aware UTC)
    duration_minutes : int
        Total duration in minutes
    task_dependency_graph : Dict[str, List[str]]
        Pre-built dependency graph (task_id -> [dependency_ids])
    agent_communication_graph : Dict[str, List[str]]
        Pre-built communication graph (agent_id -> [communicates_with])
    timezone : str
        Timezone indicator (always "UTC")
    """

    # Metadata
    snapshot_id: str
    snapshot_version: int
    timestamp: datetime
    project_id: Optional[str] = None
    project_name: str = ""
    project_filter_applied: bool = False
    included_project_ids: List[str] = field(default_factory=list)
    view_mode: Literal["subtasks", "parents", "all"] = "subtasks"

    # Pre-joined entities (denormalized)
    tasks: List[Task] = field(default_factory=list)
    agents: List[Agent] = field(default_factory=list)
    messages: List[Message] = field(default_factory=list)
    timeline_events: List[Event] = field(default_factory=list)

    # Pre-calculated metrics (no recalculation needed)
    metrics: Optional[Metrics] = None

    # Time boundaries (ALL timezone-aware)
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    duration_minutes: int = 0

    # Pre-built graph structures
    task_dependency_graph: Dict[str, List[str]] = field(default_factory=dict)
    agent_communication_graph: Dict[str, List[str]] = field(default_factory=dict)

    # Timezone metadata
    timezone: str = "UTC"  # Always UTC for consistency

    def __post_init__(self) -> None:
        """Validate timezone-aware timestamps."""
        if self.timestamp.tzinfo is None:
            raise ValueError("Snapshot timestamp must be timezone-aware")
        if self.start_time and self.start_time.tzinfo is None:
            raise ValueError("Snapshot start_time must be timezone-aware")
        if self.end_time and self.end_time.tzinfo is None:
            raise ValueError("Snapshot end_time must be timezone-aware")

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert snapshot to JSON-serializable dictionary.

        Returns
        -------
        dict
            JSON-serializable representation
        """

        def serialize_datetime(dt: Optional[datetime]) -> Optional[str]:
            return dt.isoformat() if dt else None

        return {
            "snapshot_id": self.snapshot_id,
            "snapshot_version": self.snapshot_version,
            "timestamp": serialize_datetime(self.timestamp),
            "project_id": self.project_id,
            "project_name": self.project_name,
            "project_filter_applied": self.project_filter_applied,
            "included_project_ids": self.included_project_ids,
            "view_mode": self.view_mode,
            "tasks": [
                {
                    **{
                        k: (serialize_datetime(v) if isinstance(v, datetime) else v)
                        for k, v in vars(task).items()
                    }
                }
                for task in self.tasks
            ],
            "agents": [vars(agent) for agent in self.agents],
            "messages": [
                {
                    **{
                        k: (serialize_datetime(v) if isinstance(v, datetime) else v)
                        for k, v in vars(msg).items()
                    }
                }
                for msg in self.messages
            ],
            "timeline_events": [
                {
                    **{
                        k: (serialize_datetime(v) if isinstance(v, datetime) else v)
                        for k, v in vars(event).items()
                    }
                }
                for event in self.timeline_events
            ],
            "metrics": vars(self.metrics) if self.metrics else None,
            "start_time": serialize_datetime(self.start_time),
            "end_time": serialize_datetime(self.end_time),
            "duration_minutes": self.duration_minutes,
            "task_dependency_graph": self.task_dependency_graph,
            "agent_communication_graph": self.agent_communication_graph,
            "timezone": self.timezone,
        }

    def to_json(self) -> str:
        """
        Convert snapshot to JSON string.

        Returns
        -------
        str
            JSON string representation
        """
        return json.dumps(self.to_dict(), indent=2)
