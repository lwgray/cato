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

export interface RunRow {
  run_id: string;
  project_id: string;
  project_name: string | null;
  /**
   * Entry point that produced this run. ``'direct'`` for human MCP
   * users, ``'marcus'`` for ``/marcus`` runs, ``'posidonius'`` for
   * Posidonius automated trials, ``'unknown'`` for legacy rows.
   * Renamed from the old ExperimentRow shape in coordination with
   * Marcus's ``experiments`` → ``runs`` rename.
   */
  path: string;
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
  /**
   * Human-readable kanban task name (Marcus #530). Snapshotted from
   * Marcus's task_metadata into costs.db::task_names at the moment
   * the task is created on the kanban. NULL when the task_id was
   * never paired with a name (e.g. historical rows whose source
   * marcus.db entry is gone, or subtask IDs that couldn't be
   * derived from a parent). Dashboard falls back to truncated task_id.
   */
  task_name?: string | null;
  events: number;
  tokens: number;
  cost_usd: number;
}

export interface OperationSlice {
  operation: string;
  /**
   * ``'planner'`` or ``'worker'``. Lets the dashboard split planner
   * rows (where ``operation`` carries semantic meaning like
   * ``parse_prd``) from worker rows (which are always ``'turn'`` and
   * are better attributed via ``by_task`` / ``by_agent``). See
   * Marcus issue #527.
   */
  role?: string;
  events: number;
  tokens: number;
  /**
   * Full token-type split (Marcus #513 followup): lets users see
   * which operations are heavy on uncached input vs. cache reads.
   * cache_hit_rate is computed server-side as
   * cache_read / (input + cache_creation + cache_read).
   */
  input_tokens?: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  output_tokens?: number;
  cache_hit_rate?: number;
  cost_usd: number;
}

/**
 * Token-attribution audit for a run or project (Marcus issue #527).
 *
 * Answers the question *"is every token recorded for this scope
 * accounted for?"*. A healthy audit shows ``reconciles=true`` and
 * zero ``worker_events_without_task_id``. The dashboard's
 * ``AuditBanner`` renders this as a single line.
 */
export interface CostAudit {
  total_events: number;
  total_tokens: number;
  by_role_total_tokens: number;
  reconciles: boolean;
  tokens_outside_known_roles: number;
  planner_events: number;
  worker_events: number;
  worker_events_without_task_id: number;
  worker_events_without_agent_id: number;
}

export interface ModelSlice {
  model: string;
  provider: string;
  events: number;
  tokens: number;
  input_tokens?: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  output_tokens?: number;
  cache_hit_rate?: number;
  cost_usd: number;
}

/**
 * Worker-only slice grouped by the Claude Code tool the agent invoked
 * on each turn (Marcus issue #527 Phase 2). Populated by the JSONL
 * parser; null on planner rows.
 *
 * Values for ``tool_intent``:
 * - ``worker_marcus_call`` — talking to Marcus via MCP (coordination tax)
 * - ``worker_mcp_call`` — non-Marcus MCP servers
 * - ``worker_edit`` — Edit / Write / NotebookEdit
 * - ``worker_bash`` — Bash (tests, builds, git)
 * - ``worker_search`` — Grep / Glob / ToolSearch
 * - ``worker_read`` — Read
 * - ``worker_text`` — text-only response, no tool use
 */
export interface ToolSlice {
  tool_intent: string;
  events: number;
  tokens: number;
  cost_usd: number;
}

export interface RunSummary {
  run_id: string;
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
  /** Marcus #527 Phase 2: per-tool worker spend breakdown. */
  by_tool?: ToolSlice[];
  /** Marcus #527: token-attribution audit inline on the summary. */
  audit?: CostAudit;
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
 * List runs with token + cost totals attached.
 *
 * Renamed from ``fetchExperiments`` in coordination with Marcus's
 * ``runs`` table rename (Simon ``7ed3074d``); the term "experiment"
 * was colliding with MLflow's separate concept.
 *
 * @param projectId Optional project filter.
 * @param limit Cap at 1000. Default 100.
 */
export async function fetchRuns(
  projectId?: string,
  limit = 100,
): Promise<{ runs: RunRow[]; count: number }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (projectId) params.set('project_id', projectId);
  return _get(`/api/cost/runs?${params}`);
}

/** Full per-run breakdown (summary + by_role / agent / task / etc.). */
export async function fetchRunSummary(
  runId: string,
): Promise<RunSummary> {
  return _get(`/api/cost/runs/${encodeURIComponent(runId)}`);
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
   * Human-readable name. Resolved in order of preference:
   * 1. runs.project_name (the wrapper-recorded primary run)
   * 2. Marcus's project registry (data/marcus_state/projects.json),
   *    which is the same source the regular Cato projects panel uses
   * 3. NULL — picker falls back to a truncated project_id
   */
  project_name: string | null;
  events: number;
  runs: number;
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
    runs: number;
    events: number;
    total_tokens: number;
    total_cost_usd: number;
  };
  runs: RunRow[];
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

/**
 * Full per-project breakdown — drives the Real-time / Historical /
 * Budget tabs in the project-first dashboard.
 *
 * Same shape as :func:`fetchRunSummary` but scoped to project_id,
 * which is the only universal identity in Marcus's coordination
 * model (Marcus #503). Every cost event carries a project_id, so
 * this is the universal surface for cost data.
 */
export interface ProjectFullSummary {
  project_id: string;
  project_name: string | null;
  summary: {
    total_events: number;
    runs: number;
    agents: number;
    sessions: number;
    total_tokens: number;
    input_tokens: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
    output_tokens: number;
    total_cost_usd: number;
    cache_hit_rate: number;
    first_event_at: string;
    last_event_at: string;
  };
  by_role: RoleSlice[];
  by_agent: AgentSlice[];
  by_task: TaskSlice[];
  by_operation: OperationSlice[];
  by_model: ModelSlice[];
  /** Marcus #527 Phase 2: per-tool worker spend breakdown. */
  by_tool?: ToolSlice[];
  /** Marcus #527: token-attribution audit inline on the summary. */
  audit?: CostAudit;
}

export async function fetchProjectFullSummary(
  projectId: string,
): Promise<ProjectFullSummary> {
  return _get(
    `/api/cost/projects/${encodeURIComponent(projectId)}/summary`,
  );
}

// ---------------------------------------------------------------------------
// Operation taxonomy (per-LLM-call drill-down labels + descriptions)
// ---------------------------------------------------------------------------

/**
 * One entry in the operation catalog returned by ``/api/cost/operations``.
 *
 * Sourced from Marcus's ``src/cost_tracking/operations.py``. The
 * dashboard joins ``OperationSlice.operation`` keys against this
 * mapping to render hover-tooltips that explain what each LLM call
 * does and why it spent tokens.
 */
export interface OperationCatalogEntry {
  label: string;
  description: string;
  category: 'decomposition' | 'runtime' | 'monitoring' | 'other';
}

export interface OperationCatalog {
  operations: Record<string, OperationCatalogEntry>;
}

/**
 * Fetch the operation taxonomy once on page load.
 *
 * Older Marcus checkouts may not ship the operations module — in
 * that case the endpoint returns ``{operations: {}}`` and the UI
 * falls back to the raw operation key as the label.
 */
export async function fetchOperationCatalog(): Promise<OperationCatalog> {
  return _get('/api/cost/operations');
}

// ---------------------------------------------------------------------------
// Project budget caps
// ---------------------------------------------------------------------------

export interface ProjectBudget {
  budget_usd: number;
  set_at: string;
  note: string | null;
}

export interface ProjectBudgetResponse {
  project_id: string;
  /** Null when no cap is set. */
  budget: ProjectBudget | null;
}

/** Read the budget cap (if any) for a project. */
export async function fetchProjectBudget(
  projectId: string,
): Promise<ProjectBudgetResponse> {
  return _get(`/api/cost/projects/${encodeURIComponent(projectId)}/budget`);
}

/**
 * Set (or clear) a project's budget cap.
 *
 * Pass ``budget_usd <= 0`` to remove the cap entirely. The Marcus side
 * upserts in place — the cap survives across Cato restarts since it
 * persists to costs.db.
 */
export async function setProjectBudget(
  projectId: string,
  budgetUsd: number,
  note?: string,
): Promise<ProjectBudgetResponse> {
  const resp = await fetch(
    `${API_BASE_URL}/api/cost/projects/${encodeURIComponent(projectId)}/budget`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ budget_usd: budgetUsd, note: note ?? null }),
    },
  );
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} (set budget)`);
  }
  return resp.json();
}

/**
 * Trigger a worker JSONL ingestion sweep on the backend.
 *
 * Marcus's WorkerJSONLIngester reads ~/.claude/projects/<dir>/<session>.jsonl
 * files and writes token_events rows. Calling this is idempotent (UUID
 * dedup), so the dashboard hits it on mount and on every poll tick to
 * keep worker cost current without a background daemon.
 */
export async function triggerIngest(): Promise<{
  ingested: number;
  files: number;
  skipped_unbound: number;
}> {
  const resp = await fetch(`${API_BASE_URL}/api/cost/ingest`, {
    method: 'POST',
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} (ingest)`);
  }
  return resp.json();
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
