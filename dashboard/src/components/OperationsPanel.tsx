/**
 * Per-LLM-call drill-down panel for the Real-time tab.
 *
 * Renders the ``by_operation`` slice grouped by category
 * (decomposition / runtime / monitoring / other), with:
 *
 * - Filter pills at the top — toggle whole categories on/off.
 * - Collapsible category sections with per-category aggregates,
 *   so the table stays scannable past 40 operations.
 * - A 🔥 badge on the single worst cold-cache offender (the
 *   operation with the highest ``cache_creation_tokens *
 *   (1 - cache_hit_rate)``) — that's the prompt-tightening
 *   target Kaia called out in her review.
 *
 * The component is purely presentational: it owns its filter /
 * collapse UI state, but the data comes from a parent prop and the
 * catalog from a separate prop so it can be tested in isolation.
 */

import { useMemo, useState } from 'react';
import type {
  OperationCatalogEntry,
  OperationSlice,
} from '../services/costService';

type CategoryKey =
  | 'decomposition'
  | 'runtime'
  | 'monitoring'
  | 'other';

const ALL_CATEGORIES: CategoryKey[] = [
  'decomposition',
  'runtime',
  'monitoring',
  'other',
];

const CATEGORY_LABELS: Record<CategoryKey, string> = {
  decomposition: 'Decomposition',
  runtime: 'Runtime',
  monitoring: 'Monitoring',
  other: 'Other',
};

interface Props {
  operations: OperationSlice[];
  catalog: Record<string, OperationCatalogEntry>;
}

function formatUsd(v: number, decimals = 2): string {
  return `$${v.toFixed(decimals)}`;
}

function formatTokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

function formatPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function cacheCellClass(rate: number): string {
  if (rate < 0.3) return 'cache-cell cache-cold';
  if (rate > 0.7) return 'cache-cell cache-hot';
  return 'cache-cell';
}

/**
 * Compute the "cold-cache opportunity" for one operation.
 *
 * ``cache_creation_tokens * (1 - cache_hit_rate)`` approximates
 * tokens we'd save by tightening the prompt so it hits the cache.
 * The row with the highest score is the best prompt-tightening
 * target — heavy AND cold.
 */
function coldCacheScore(op: OperationSlice): number {
  const creation = op.cache_creation_tokens ?? 0;
  const rate = op.cache_hit_rate ?? 0;
  return creation * (1 - rate);
}

interface CategoryGroup {
  category: CategoryKey;
  ops: OperationSlice[];
  totalCost: number;
  totalTokens: number;
  totalCalls: number;
}

const OperationsPanel = ({ operations, catalog }: Props) => {
  // Default: all categories visible. Pills toggle off-states.
  const [visibleCategories, setVisibleCategories] = useState<
    Set<CategoryKey>
  >(new Set(ALL_CATEGORIES));
  // Default: all categories expanded. Headers toggle collapse.
  const [collapsed, setCollapsed] = useState<Set<CategoryKey>>(new Set());

  // Map operations into category groups. Operations whose key isn't
  // in the catalog fall into 'other' so they're still visible — the
  // recorder logs a WARNING for those, so they're rare and worth
  // surfacing.
  const groups = useMemo<CategoryGroup[]>(() => {
    const buckets: Record<CategoryKey, OperationSlice[]> = {
      decomposition: [],
      runtime: [],
      monitoring: [],
      other: [],
    };
    for (const op of operations) {
      const cat =
        (catalog[op.operation]?.category as CategoryKey | undefined) ??
        'other';
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
  }, [operations, catalog]);

  // Find the worst cold-cache offender across all visible operations.
  // Compute *before* filtering so the badge always points at the
  // global worst, even if the user has the relevant category off
  // (avoids the chip jumping around as filters change).
  const coldOffenderKey = useMemo<string | null>(() => {
    let bestKey: string | null = null;
    let bestScore = 0;
    for (const op of operations) {
      const score = coldCacheScore(op);
      // Threshold: only badge rows with > 1k saveable tokens. Below
      // that the "biggest offender" is noise.
      if (score > bestScore && score > 1000) {
        bestScore = score;
        bestKey = op.operation;
      }
    }
    return bestKey;
  }, [operations]);

  const toggleCategory = (cat: CategoryKey) => {
    setVisibleCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const toggleCollapsed = (cat: CategoryKey) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  if (operations.length === 0) return null;

  return (
    <section className="cost-panel">
      <h3>
        Tokens by operation{' '}
        <small className="cost-panel-hint">
          Grouped by category. Click a pill to filter, a header to collapse.
          🔥 marks the biggest cold-cache opportunity — the row where
          tightening the prompt would save the most tokens.
        </small>
      </h3>

      <div className="cost-operation-filters" role="toolbar">
        {groups.map((g) => {
          const active = visibleCategories.has(g.category);
          return (
            <button
              key={g.category}
              type="button"
              className={`cost-operation-pill cat-${g.category} ${
                active ? 'is-active' : 'is-inactive'
              }`}
              onClick={() => toggleCategory(g.category)}
              aria-pressed={active}
              title={`Toggle ${CATEGORY_LABELS[g.category]} (${g.ops.length} ops)`}
            >
              {CATEGORY_LABELS[g.category]}{' '}
              <span className="cost-operation-pill-count">
                {g.ops.length}
              </span>
            </button>
          );
        })}
      </div>

      {groups
        .filter((g) => visibleCategories.has(g.category))
        .map((g) => {
          const isCollapsed = collapsed.has(g.category);
          return (
            <div key={g.category} className="cost-operation-group">
              <button
                type="button"
                className={`cost-operation-group-header cat-${g.category}`}
                onClick={() => toggleCollapsed(g.category)}
                aria-expanded={!isCollapsed}
              >
                <span className="cost-operation-group-chevron">
                  {isCollapsed ? '▶' : '▼'}
                </span>
                <span className="cost-operation-group-title">
                  {CATEGORY_LABELS[g.category]}
                </span>
                <span className="cost-operation-group-stats">
                  {g.ops.length} ops · {g.totalCalls} calls ·{' '}
                  {formatTokens(g.totalTokens)} tokens ·{' '}
                  {formatUsd(g.totalCost, 4)}
                </span>
              </button>

              {!isCollapsed && (
                <table className="cost-table cost-table-dense">
                  <thead>
                    <tr>
                      <th>Operation</th>
                      <th>Calls</th>
                      <th>Input</th>
                      <th>Cache create</th>
                      <th>Cache read</th>
                      <th>Output</th>
                      <th>Cache %</th>
                      <th>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.ops.map((op) => {
                      const entry = catalog[op.operation];
                      const label = entry?.label ?? op.operation;
                      const tooltip = entry
                        ? `${entry.label} — ${entry.description}`
                        : `Unregistered operation '${op.operation}'. ` +
                          'Add it to Marcus operations.py for a description.';
                      const isColdOffender =
                        op.operation === coldOffenderKey;
                      return (
                        <tr
                          key={op.operation}
                          className={
                            isColdOffender ? 'cost-operation-cold-offender' : ''
                          }
                        >
                          <td>
                            <span
                              className="cost-operation-label"
                              title={tooltip}
                            >
                              {label}
                            </span>
                            {isColdOffender && (
                              <span
                                className="cost-operation-offender-badge"
                                title={
                                  'Highest cold-cache opportunity. ' +
                                  'Tightening this prompt to fit the ' +
                                  'cache window would save the most ' +
                                  'tokens of any operation.'
                                }
                              >
                                🔥
                              </span>
                            )}
                          </td>
                          <td>{op.events}</td>
                          <td>{formatTokens(op.input_tokens ?? 0)}</td>
                          <td>{formatTokens(op.cache_creation_tokens ?? 0)}</td>
                          <td>{formatTokens(op.cache_read_tokens ?? 0)}</td>
                          <td>{formatTokens(op.output_tokens ?? 0)}</td>
                          <td className={cacheCellClass(op.cache_hit_rate ?? 0)}>
                            {formatPct(op.cache_hit_rate ?? 0)}
                          </td>
                          <td>{formatUsd(op.cost_usd, 4)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
    </section>
  );
};

export default OperationsPanel;
