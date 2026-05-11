/**
 * Tab 3 — Budget view (project-scoped).
 *
 * Project-first (Marcus #503): renders cumulative spend, spend rate,
 * and time-extrapolated projection for one project. Budget caps were
 * an experiment-level field; for project view we surface spend
 * trajectory and let the user judge against their own target (a
 * project-level budget field can be added later if useful).
 *
 * Pulls from ``/api/cost/projects/{id}/summary``.
 */

import { useEffect, useState } from 'react';
import {
  fetchProjectFullSummary,
  type ProjectFullSummary,
} from '../services/costService';
import './BudgetTab.css';

interface Props {
  projectId: string;
}

function formatUsd(v: number, decimals = 2): string {
  return `$${v.toFixed(decimals)}`;
}

function elapsedMinutes(firstAt: string, lastAt: string): number {
  const start = new Date(firstAt).getTime();
  const end = new Date(lastAt).getTime();
  return Math.max(0, (end - start) / 60000);
}

const BudgetTab = ({ projectId }: Props) => {
  const [summary, setSummary] = useState<ProjectFullSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await fetchProjectFullSummary(projectId);
        if (!cancelled) {
          setSummary(s);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    void tick();
    const id = window.setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [projectId]);

  if (error) return <div className="cost-error">⚠ {error}</div>;
  if (!summary) return <div className="cost-loading">Loading budget…</div>;

  const s = summary.summary;
  const spent = s.total_cost_usd;
  const elapsed = elapsedMinutes(s.first_event_at, s.last_event_at);
  // Spend rate $/min. Guard against zero-elapsed runs (instant single-event).
  const rate = elapsed > 0 ? spent / elapsed : 0;
  // Projection: assume same rate for another hour. Crude but useful when
  // there's no declared budget cap to plan against.
  const oneHourProjection = spent + rate * 60;

  return (
    <div className="cost-budget">
      <section className="budget-grid">
        <div className="budget-card">
          <span className="budget-label">Total spent</span>
          <span className="budget-value">{formatUsd(spent)}</span>
        </div>
        <div className="budget-card">
          <span className="budget-label">Spend rate</span>
          <span className="budget-value">{formatUsd(rate, 4)}/min</span>
        </div>
        <div className="budget-card">
          <span className="budget-label">+1h projection</span>
          <span className="budget-value">{formatUsd(oneHourProjection)}</span>
        </div>
        <div className="budget-card">
          <span className="budget-label">Cache savings</span>
          <span className="budget-value">
            {(s.cache_hit_rate * 100).toFixed(1)}%
          </span>
        </div>
      </section>

      <section className="budget-meta">
        <div>
          <span className="meta-label">Events</span>
          <span className="meta-value">{s.total_events}</span>
        </div>
        <div>
          <span className="meta-label">Agents</span>
          <span className="meta-value">{s.agents}</span>
        </div>
        <div>
          <span className="meta-label">Sessions</span>
          <span className="meta-value">{s.sessions}</span>
        </div>
        <div>
          <span className="meta-label">Elapsed</span>
          <span className="meta-value">{elapsed.toFixed(1)} min</span>
        </div>
      </section>

      {summary.by_model.length > 0 && (
        <section className="cost-panel">
          <h3>Spend by model</h3>
          <table className="cost-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Provider</th>
                <th>Events</th>
                <th>Cost</th>
                <th>% of total</th>
              </tr>
            </thead>
            <tbody>
              {summary.by_model.map((m) => (
                <tr key={`${m.model}-${m.provider}`}>
                  <td>{m.model}</td>
                  <td>{m.provider}</td>
                  <td>{m.events}</td>
                  <td>{formatUsd(m.cost_usd, 4)}</td>
                  <td>
                    {spent > 0 ? ((m.cost_usd / spent) * 100).toFixed(1) : '0'}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="budget-hint">
        Spend rate is computed from first-to-last event timestamp for this
        project. Project-level budget caps are not yet a Marcus concept;
        when one lands, this view will surface a vs-cap comparison.
      </p>
    </div>
  );
};

export default BudgetTab;
