/**
 * Data Service for Cato Visualization Dashboard
 *
 * Handles fetching unified snapshot data from the Cato backend API.
 * All data is pre-joined and pre-calculated in the snapshot.
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4301';

/**
 * Snapshot data structure matching backend store.py
 */
export interface Snapshot {
  // Metadata
  snapshot_id: string;
  snapshot_version: number;
  timestamp: string;
  project_id: string | null;
  project_name: string;
  project_filter_applied: boolean;
  included_project_ids: string[];
  view_mode: 'subtasks' | 'parents' | 'all';

  // Pre-joined entities (denormalized)
  tasks: Task[];
  agents: Agent[];
  messages: Message[];
  timeline_events: Event[];

  // Pre-calculated metrics
  metrics: Metrics | null;

  // Time boundaries
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number;

  // Pre-built graph structures
  task_dependency_graph: Record<string, string[]>;
  agent_communication_graph: Record<string, string[]>;

  // Timezone metadata
  timezone: string;
}

/**
 * Task with all relationships embedded
 */
export interface Task {
  // Core fields
  id: string;
  name: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done' | 'blocked';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  progress_percent: number;

  // Time tracking
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  estimated_hours: number;
  actual_hours: number;

  // Embedded parent info
  parent_task_id: string | null;
  parent_task_name: string | null;
  is_subtask: boolean;
  subtask_index: number | null;

  // Embedded project info
  project_id: string;
  project_name: string;

  // Embedded agent info
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  assigned_agent_role: string | null;

  // Dependencies
  dependency_ids: string[];
  dependent_task_ids: string[];

  // Pre-calculated timeline positions
  timeline_linear_position: number;
  timeline_scaled_position: number;
  timeline_scale_exponent: number;

  // Labels and metadata
  labels: string[];
  metadata: Record<string, any>;
}

/**
 * Agent with embedded metrics and task info
 */
export interface Agent {
  id: string;
  name: string;
  role: string;
  skills: string[];

  // Embedded task info
  current_task_ids: string[];
  current_task_names: string[];
  completed_task_ids: string[];

  // Pre-calculated metrics
  completed_tasks_count: number;
  total_hours_worked: number;
  average_task_duration_hours: number;
  performance_score: number;
  capacity_utilization: number;

  // Communication stats
  messages_sent: number;
  messages_received: number;
  blockers_reported: number;
}

/**
 * Message with embedded context
 */
export interface Message {
  id: string;
  timestamp: string;
  message: string;
  type: 'instruction' | 'question' | 'answer' | 'status_update' | 'blocker' | 'task_assignment';

  // Embedded agent info
  from_agent_id: string;
  from_agent_name: string;
  to_agent_id: string;
  to_agent_name: string;

  // Embedded task info
  task_id: string | null;
  task_name: string | null;

  // Metadata
  parent_message_id: string | null;
  metadata: Record<string, any>;

  // Duplicate detection
  is_duplicate?: boolean;
  duplicate_group_id?: string | null;
  duplicate_count?: number;
}

/**
 * Timeline event with embedded context
 */
export interface Event {
  id: string;
  timestamp: string;
  event_type: string;

  // Embedded references
  agent_id: string | null;
  agent_name: string | null;
  task_id: string | null;
  task_name: string | null;

  // Event data
  data: Record<string, any>;
}

/**
 * Pre-calculated metrics
 */
export interface Metrics {
  // Task metrics
  total_tasks: number;
  completed_tasks: number;
  in_progress_tasks: number;
  blocked_tasks: number;
  completion_rate: number;

  // Time metrics
  total_duration_minutes: number;
  average_task_duration_hours: number;

  // Parallelization metrics
  peak_parallel_tasks: number;
  average_parallel_tasks: number;
  parallelization_efficiency: number;

  // Agent metrics
  total_agents: number;
  active_agents: number;
  tasks_per_agent: number;

  // Marcus-specific metrics
  total_blockers: number;
  blocked_task_percentage: number;
}

/**
 * Fetch unified snapshot from backend API
 *
 * Parameters
 * ----------
 * projectId : string | undefined
 *     Specific project to snapshot (undefined = all projects)
 * view : 'subtasks' | 'parents' | 'all'
 *     View mode (default 'subtasks')
 * timelineScaleExponent : number
 *     Power scale exponent for timeline transformation (default 0.4)
 * useCache : boolean
 *     Whether to use cached snapshot if available (default true)
 *
 * Returns
 * -------
 * Promise<Snapshot>
 *     Complete denormalized snapshot with all relationships pre-joined
 */
export async function fetchSnapshot(
  projectId?: string,
  view: 'subtasks' | 'parents' | 'all' = 'subtasks',
  timelineScaleExponent: number = 0.4,
  useCache: boolean = true
): Promise<Snapshot> {
  try {
    const params = new URLSearchParams();
    if (projectId) params.append('project_id', projectId);
    params.append('view', view);
    params.append('timeline_scale_exponent', timelineScaleExponent.toString());
    params.append('use_cache', useCache.toString());

    const url = `${API_BASE_URL}/api/snapshot?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const snapshot = await response.json();
    console.log('Loaded snapshot from API:', {
      id: snapshot.snapshot_id,
      version: snapshot.snapshot_version,
      tasks: snapshot.tasks.length,
      agents: snapshot.agents.length,
      messages: snapshot.messages.length,
    });
    return snapshot as Snapshot;
  } catch (error) {
    console.error('Error fetching snapshot:', error);
    throw error;
  }
}

/**
 * Project metadata
 */
export interface Project {
  id: string;
  name: string;
  created_at: string;
  last_used?: string;
  description?: string;
}

/**
 * Fetch list of all projects
 *
 * Returns
 * -------
 * Promise<Project[]>
 *     List of all projects with metadata
 */
export async function fetchProjects(): Promise<Project[]> {
  try {
    const url = `${API_BASE_URL}/api/projects`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('Loaded projects from API:', data.projects.length);
    return data.projects as Project[];
  } catch (error) {
    console.error('Error fetching projects:', error);
    throw error;
  }
}

/**
 * Check if the backend API is available
 *
 * Returns
 * -------
 * Promise<boolean>
 *     True if API is healthy, false otherwise
 */
export async function checkApiHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    return response.ok;
  } catch (error) {
    console.warn('API health check failed:', error);
    return false;
  }
}
