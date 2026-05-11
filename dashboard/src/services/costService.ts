/**
 * Cost-tracking data service for the Cato dashboard (Marcus issue #409).
 *
 * Wraps the /api/cost/* endpoints exposed by backend/cost_routes.py with
 * typed fetchers. Response shapes mirror Marcus's CostAggregator return
 * values exactly, so React components consume them directly.
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4301';

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface ExperimentRow {
  experiment_id: string;
  project_id: string;
  project_name: string | null;
  started_at: string;
  ended_at: string | null;
  num_agents: number | null;
  total_tasks: number | null;
  completed_tasks: number | null;
  blocked_tasks: number | null;
  total_tokens: number;
  total_cost_usd: number;
}

export interface RoleSlice {
  role: string;
  events: number;
  tokens: number;
  cost_usd: number;
}

export interface AgentSlice {
  agent_id: string;
  role: string;
  events: number;
  tokens: number;
  cost_usd: number;
  tasks_worked: number;
  sessions: number;
  turns: number;
}

export interface TaskSlice {
  task_id: string;
  events: number;
  tokens: number;
  cost_usd: number;
}

export interface OperationSlice {
  operation: string;
  events: number;
  tokens: number;
  cost_usd: number;
}

export interface ModelSlice {
  model: string;
  provider: string;
  events: number;
  tokens: number;
  cost_usd: number;
}

export interface ExperimentSummary {
  experiment_id: string;
  project_id: string;
  project_name: string | null;
  started_at: string;
  ended_at: string | null;
  num_agents: number | null;
  total_tasks: number | null;
  completed_tasks: number | null;
  blocked_tasks: number | null;
  summary: {
    total_events: number;
    total_tokens: number;
    input_tokens: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
    output_tokens: number;
    total_cost_usd: number;
    cache_hit_rate: number;
  };
  by_role: RoleSlice[];
  by_agent: AgentSlice[];
  by_task: TaskSlice[];
  by_operation: OperationSlice[];
  by_model: ModelSlice[];
}

export interface TurnPoint {
  turn_index: number;
  total_tokens: number;
  cost_usd: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

async function _get<T>(path: string): Promise<T> {
  const resp = await fetch(`${API_BASE_URL}${path}`);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText} (${path})`);
  }
  return resp.json() as Promise<T>;
}

/**
 * List experiments with token + cost totals attached.
 *
 * @param projectId Optional project filter.
 * @param limit Cap at 1000. Default 100.
 */
export async function fetchExperiments(
  projectId?: string,
  limit = 100,
): Promise<{ experiments: ExperimentRow[]; count: number }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (projectId) params.set('project_id', projectId);
  return _get(`/api/cost/experiments?${params}`);
}

/** Full per-experiment breakdown (summary + by_role / agent / task / etc.). */
export async function fetchExperimentSummary(
  experimentId: string,
): Promise<ExperimentSummary> {
  return _get(`/api/cost/experiments/${encodeURIComponent(experimentId)}`);
}

/** Per-turn cost trajectory for one Claude Code session. */
export async function fetchSessionTurns(
  sessionId: string,
): Promise<{ session_id: string; turns: TurnPoint[] }> {
  return _get(`/api/cost/sessions/${encodeURIComponent(sessionId)}/turns`);
}

// ---------------------------------------------------------------------------
// Projects (primary axis — Marcus #409)
// ---------------------------------------------------------------------------

export interface ProjectRow {
  project_id: string;
  /**
   * Human-readable name pulled from the experiments table when an
   * MLflow run was registered for this project. NULL for projects
   * whose runs never called start_experiment — the picker falls back
   * to a truncated project_id in that case.
   */
  project_name: string | null;
  events: number;
  experiments: number;
  agents: number;
  total_tokens: number;
  total_cost_usd: number;
  first_event_at: string;
  last_event_at: string;
}

export interface UnassignedTotals {
  events: number;
  total_tokens: number;
  total_cost_usd: number;
}

export interface ProjectSummary {
  project_id: string;
  totals: {
    experiments: number;
    events: number;
    total_tokens: number;
    total_cost_usd: number;
  };
  experiments: ExperimentRow[];
}

/** List projects with cost rollups (primary picker for the dashboard). */
export async function fetchProjects(
  limit = 100,
): Promise<{ projects: ProjectRow[]; count: number }> {
  return _get(`/api/cost/projects?limit=${limit}`);
}

/** Totals for events without an active PlannerContext. */
export async function fetchUnassignedTotals(): Promise<UnassignedTotals> {
  return _get('/api/cost/projects/unassigned');
}

/** Project rollup + per-experiment list. */
export async function fetchProjectSummary(
  projectId: string,
): Promise<ProjectSummary> {
  return _get(`/api/cost/projects/${encodeURIComponent(projectId)}`);
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export interface ModelPriceRow {
  model: string;
  provider: string;
  effective_from: string;
  input_per_million: number;
  output_per_million: number;
  cache_creation_per_million: number | null;
  cache_read_per_million: number | null;
  source: string | null;
}

export interface PriceCreatePayload {
  model: string;
  provider: string;
  effective_from?: string; // ISO; defaults to "now" server-side
  input_per_million: number;
  output_per_million: number;
  cache_creation_per_million?: number | null;
  cache_read_per_million?: number | null;
  source?: string;
}

/** Current pricing table (latest ``effective_from`` per model+provider). */
export async function fetchCurrentPrices(): Promise<{ prices: ModelPriceRow[] }> {
  return _get('/api/cost/prices');
}

/** Full price history, optionally filtered to one model. */
export async function fetchPriceHistory(
  model?: string,
): Promise<{ prices: ModelPriceRow[] }> {
  const params = new URLSearchParams();
  if (model) params.set('model', model);
  const qs = params.toString();
  return _get(`/api/cost/prices/history${qs ? `?${qs}` : ''}`);
}

/** Insert a new versioned price row. Throws on 409 (duplicate effective_from). */
export async function createPrice(
  payload: PriceCreatePayload,
): Promise<{ status: string; effective_from: string }> {
  const resp = await fetch(`${API_BASE_URL}/api/cost/prices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${detail}`);
  }
  return resp.json();
}
