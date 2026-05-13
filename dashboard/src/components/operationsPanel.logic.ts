/**
 * Pure helpers for OperationsPanel — extracted for unit testability.
 *
 * Kaia review on PR #39 called out that the OperationsPanel's
 * filter/collapse/cold-offender branching has real surface area and
 * zero coverage. Cato's dashboard has Vitest configured but no
 * React-Testing-Library setup; rather than introduce that just to
 * test branching logic, we extract the pure functions (no React,
 * no DOM) into this file and exercise them directly. The component
 * keeps rendering responsibilities; this file owns the data
 * transformations.
 *
 * Functions here intentionally take only the data they need — no
 * Props or React state — so tests can construct inputs by hand
 * without mocking the component tree.
 */

import type {
  OperationCatalogEntry,
  OperationSlice,
} from '../services/costService';

export type CategoryKey =
  | 'decomposition'
  | 'runtime'
  | 'monitoring'
  | 'other';

export const ALL_CATEGORIES: CategoryKey[] = [
  'decomposition',
  'runtime',
  'monitoring',
  'other',
];

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  decomposition: 'Decomposition',
  runtime: 'Runtime',
  monitoring: 'Monitoring',
  other: 'Other',
};

export interface CategoryGroup {
  category: CategoryKey;
  ops: OperationSlice[];
  totalCost: number;
  totalTokens: number;
  totalCalls: number;
}

/**
 * Approximate the tokens we'd save by tightening the prompt of
 * ``op`` so it hits the cache window on every call.
 *
 * The heuristic is ``cache_creation_tokens × (1 - cache_hit_rate)``:
 * cache_creation_tokens captures how much we paid to set up the
 * prompt cache, and ``1 - hit_rate`` captures how often that
 * investment was wasted (i.e., a fresh creation rather than a hit).
 * Higher score = more headroom for optimization.
 */
export function coldCacheScore(op: OperationSlice): number {
  const creation = op.cache_creation_tokens ?? 0;
  const rate = op.cache_hit_rate ?? 0;
  return creation * (1 - rate);
}

/**
 * Identify the single biggest cold-cache offender, or ``null``.
 *
 * Two gates:
 * 1. Operations whose key isn't in ``catalog`` are skipped — Kaia
 *    review on PR #39 called out that landing the 🔥 badge on a
 *    typo'd operation just amplifies the typo. Marcus's recorder
 *    already warns about unregistered keys in dev logs.
 * 2. Score must exceed ``threshold`` (default 1000 tokens). Below
 *    that, "biggest offender" is noise. The threshold is exposed
 *    as an argument so tests can drive corner cases without
 *    constructing absurdly large mock data.
 *
 * Returns the operation key of the worst offender, or ``null``
 * when nothing meets the threshold.
 */
export function pickColdOffender(
  operations: OperationSlice[],
  catalog: Record<string, OperationCatalogEntry>,
  threshold = 1000,
): string | null {
  let bestKey: string | null = null;
  let bestScore = 0;
  for (const op of operations) {
    if (catalog[op.operation] == null) continue;
    const score = coldCacheScore(op);
    if (score > bestScore && score > threshold) {
      bestScore = score;
      bestKey = op.operation;
    }
  }
  return bestKey;
}

/**
 * Group operations by their catalog category, computing per-group
 * aggregates and dropping empty buckets.
 *
 * Operations whose key is not in the catalog fall into the
 * ``'other'`` bucket so they remain visible in the dashboard. The
 * recorder logs a WARNING for those (see Marcus
 * ``cost_recorder.py``), making the gap discoverable.
 */
export function bucketByCategory(
  operations: OperationSlice[],
  catalog: Record<string, OperationCatalogEntry>,
): CategoryGroup[] {
  const buckets: Record<CategoryKey, OperationSlice[]> = {
    decomposition: [],
    runtime: [],
    monitoring: [],
    other: [],
  };
  for (const op of operations) {
    const cat =
      (catalog[op.operation]?.category as CategoryKey | undefined) ?? 'other';
    buckets[cat].push(op);
  }
  return ALL_CATEGORIES.map((cat) => {
    const ops = buckets[cat];
    return {
      category: cat,
      ops,
      totalCost: ops.reduce((s, o) => s + o.cost_usd, 0),
      totalTokens: ops.reduce((s, o) => s + o.tokens, 0),
      totalCalls: ops.reduce((s, o) => s + o.events, 0),
    };
  }).filter((g) => g.ops.length > 0);
}

/**
 * Split a list of operation slices into planner rows and a single
 * aggregated worker summary (Marcus issue #527).
 *
 * The dashboard's per-operation chart only makes sense for planner
 * rows — for those, ``operation`` carries semantic meaning
 * (parse_prd, decompose_prd, ...). Worker rows always have
 * ``operation='turn'``; they would dominate the chart with one
 * useless bucket while drowning out the planner ops that are
 * actually informative. We split here so the panel can render
 * planner ops as the main view and surface the worker aggregate
 * separately.
 *
 * Slices without a ``role`` field are treated as planner so legacy
 * databases (pre-#527, before the GROUP BY agent_role) keep
 * rendering exactly as before.
 *
 * @param operations The full ``by_operation`` slice array.
 * @returns ``{plannerOps, workerSummary}`` where ``workerSummary``
 *          collapses all worker rows into one totals object.
 */
export function splitByRole(operations: OperationSlice[]): {
  plannerOps: OperationSlice[];
  workerSummary: { events: number; tokens: number; cost: number };
} {
  const planner: OperationSlice[] = [];
  let wEvents = 0;
  let wTokens = 0;
  let wCost = 0;
  for (const op of operations) {
    if (op.role === 'worker') {
      wEvents += op.events;
      wTokens += op.tokens;
      wCost += op.cost_usd;
    } else {
      planner.push(op);
    }
  }
  return {
    plannerOps: planner,
    workerSummary: { events: wEvents, tokens: wTokens, cost: wCost },
  };
}
