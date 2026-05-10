/**
 * Tab 2 — Historical view.
 *
 * Aggregates every experiment in the cost store and renders:
 * 1. Headline totals (lifetime cost, total tokens, experiment count).
 * 2. A time-series bar chart of cost per experiment.
 * 3. Per-project rollup table.
 *
 * No new backend endpoint needed — derives everything from
 * ``/api/cost/experiments`` (no project filter, capped at 1000).
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchExperiments, type ExperimentRow } from '../services/costService';
import CostTimeSeries from './CostTimeSeries';
import './HistoricalTab.css';

interface Props {
  onSelectExperiment?: (id: string) => void;
}

function formatUsd(v: number, decimals = 2): string {
  return `$${v.toFixed(decimals)}`;
}

function formatTokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

const HistoricalTab = ({ onSelectExperiment }: Props) => {
  const [experiments, setExperiments] = useState<ExperimentRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchExperiments(undefined, 1000)
      .then(({ experiments: exps }) => {
        if (!cancelled) {
          setExperiments(exps);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Totals + per-project rollup, computed in-memory.
  const { totalCost, totalTokens, byProject } = useMemo(() => {
    let totalCost = 0;
    let totalTokens = 0;
    const byProject = new Map<
      string,
      { project_name: string | null; cost: number; tokens: number; count: number }
    >();
    for (const e of experiments) {
      totalCost += e.total_cost_usd;
      totalTokens += e.total_tokens;
      const cur = byProject.get(e.project_id) ?? {
        project_name: e.project_name,
        cost: 0,
        tokens: 0,
        count: 0,
      };
      cur.cost += e.total_cost_usd;
      cur.tokens += e.total_tokens;
      cur.count += 1;
      byProject.set(e.project_id, cur);
    }
    const rows = Array.from(byProject.entries())
      .map(([project_id, v]) => ({ project_id, ...v }))
      .sort((a, b) => b.cost - a.cost);
    return { totalCost, totalTokens, byProject: rows };
  }, [experiments]);

  if (error) {
    return <div className="cost-error">⚠ {error}</div>;
  }

  return (
    <div className="cost-historical">
      <header className="historical-stats">
        <div className="cost-stat cost-stat-primary">
          <span className="cost-stat-label">Lifetime cost</span>
          <span className="cost-stat-value">{formatUsd(totalCost)}</span>
        </div>
        <div className="cost-stat">
          <span className="cost-stat-label">Total tokens</span>
          <span className="cost-stat-value">{formatTokens(totalTokens)}</span>
        </div>
        <div className="cost-stat">
          <span className="cost-stat-label">Experiments</span>
          <span className="cost-stat-value">{experiments.length}</span>
        </div>
      </header>

      <section className="cost-panel">
        <h3>Cost per experiment</h3>
        <CostTimeSeries
          experiments={experiments}
          onSelect={onSelectExperiment}
        />
      </section>

      <section className="cost-panel">
        <h3>By project</h3>
        {byProject.length === 0 ? (
          <p className="empty">No experiments yet.</p>
        ) : (
          <table className="cost-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Runs</th>
                <th>Tokens</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {byProject.map((p) => (
                <tr key={p.project_id}>
                  <td>{p.project_name ?? p.project_id}</td>
                  <td>{p.count}</td>
                  <td>{formatTokens(p.tokens)}</td>
                  <td className="cost-cell">{formatUsd(p.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};

export default HistoricalTab;
