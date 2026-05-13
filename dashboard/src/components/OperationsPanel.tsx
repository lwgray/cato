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
 * Marcus #527: worker rows are filtered OUT of this panel. The
 * ``operation`` column only carries semantic meaning for planner
 * rows; for workers it's always ``'turn'``, and the right
 * attribution axes are task_id / agent_id / session_id — surfaced
 * by ``TaskSpendPanel`` and ``AgentSpendBars``. Worker totals are
 * still shown as a one-line summary at the bottom of this panel
 * so spending isn't invisible.
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
import {
  ALL_CATEGORIES,
  CATEGORY_LABELS,
  bucketByCategory,
  pickColdOffender,
  splitByRole,
  type CategoryKey,
} from './operationsPanel.logic';

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

const OperationsPanel = ({ operations, catalog }: Props) => {
  // Default: all categories visible. Pills toggle off-states.
  const [visibleCategories, setVisibleCategories] = useState<
    Set<CategoryKey>
  >(new Set(ALL_CATEGORIES));
  // Default: all categories expanded. Headers toggle collapse.
  const [collapsed, setCollapsed] = useState<Set<CategoryKey>>(new Set());

  // Marcus #527: separate planner from worker rows. The chart only
  // makes sense for planner ops (operation column is semantic there);
  // worker rows are surfaced as a one-line summary at the bottom so
  // total spend stays visible without polluting the breakdown. Pure
  // logic lives in operationsPanel.logic so it can be unit-tested
  // without DOM/React.
  const { plannerOps, workerSummary } = useMemo(
    () => splitByRole(operations),
    [operations],
  );

  // Map operations into category groups. Pure logic in
  // ``operationsPanel.logic.ts`` — see that file's docstring for the
  // ``'other'`` fallback semantics and the rationale for empty-bucket
  // filtering.
  const groups = useMemo(
    () => bucketByCategory(plannerOps, catalog),
    [plannerOps, catalog],
  );

  // Find the worst cold-cache offender across all operations.
  // Compute *before* visibility filtering so the badge always points
  // at the global worst, even if the user has the relevant category
  // off (avoids the chip jumping around as filters change). The
  // pure logic is in ``operationsPanel.logic.ts``; it skips
  // unregistered/typo operations and applies the 1000-token
  // threshold. Scoped to plannerOps for the same reason this whole
  // panel is — see #527.
  const coldOffenderKey = useMemo(
    () => pickColdOffender(plannerOps, catalog),
    [plannerOps, catalog],
  );

  // ID prefix for table elements so aria-controls on each group
  // header points at the correct table. Using a stable per-category
  // suffix means the relationship is stable across re-renders.
  const tableIdFor = (cat: CategoryKey) => `cost-operations-table-${cat}`;

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
          <strong>Planner only.</strong> Worker turns are aggregated below —
          see <em>Tokens by task</em> and <em>Cost by agent</em> for worker
          attribution. Grouped by category. Click a pill to filter, a header
          to collapse. 🔥 marks the biggest cold-cache opportunity.
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

      {(() => {
        const visibleGroups = groups.filter((g) =>
          visibleCategories.has(g.category),
        );
        if (visibleGroups.length === 0) {
          // All categories filtered off — keep the toolbar usable but
          // tell the user why the table area is empty. Kaia review on
          // PR #39.
          return (
            <p className="cost-panel-hint cost-operation-empty">
              No operations match the active filters. Click a category
              pill above to bring its rows back.
            </p>
          );
        }
        if (plannerOps.length === 0) {
          // Edge case: the run made worker calls but zero planner
          // calls. Don't show an empty planner chart — surface the
          // worker total directly so the user knows where to look.
          return null;
        }
        return visibleGroups.map((g) => {
          const isCollapsed = collapsed.has(g.category);
          const tableId = tableIdFor(g.category);
          return (
            <div key={g.category} className="cost-operation-group">
              <button
                type="button"
                className={`cost-operation-group-header cat-${g.category}`}
                onClick={() => toggleCollapsed(g.category)}
                aria-expanded={!isCollapsed}
                aria-controls={tableId}
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
                <table
                  id={tableId}
                  className="cost-table cost-table-dense"
                >
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
        });
      })()}

      {workerSummary.events > 0 && (
        <div className="cost-operation-worker-summary">
          <span className="cost-operation-worker-summary-label">
            Worker turns (one bucket, all agents):
          </span>{' '}
          <strong>{workerSummary.events.toLocaleString()}</strong> events ·{' '}
          <strong>{formatTokens(workerSummary.tokens)}</strong> tokens ·{' '}
          <strong>{formatUsd(workerSummary.cost, 4)}</strong>
          <p className="cost-panel-hint">
            For per-task and per-agent breakdown of worker spend, see the
            panels above. Per-tool breakdown is planned (#527 Phase 2).
          </p>
        </div>
      )}
    </section>
  );
};

export default OperationsPanel;
