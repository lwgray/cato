/**
 * Tab 3 — Budget projection.
 *
 * Reads the active experiment's running totals plus its declared
 * ``budget_usd`` (set at experiment creation) and shows:
 * 1. Current spend / budget cap / remaining headroom
 * 2. Projected total based on elapsed-vs-completed ratio
 * 3. A threshold-crossing banner once spend exceeds 80% of budget
 *
 * No backend changes — derives everything from the experiment summary
 * already exposed by ``/api/cost/experiments/{id}``.
 */

import { useEffect, useState } from 'react';
import {
  fetchExperimentSummary,
  type ExperimentSummary,
} from '../services/costService';
import './BudgetTab.css';

interface Props {
  experimentId: string;
}

function formatUsd(v: number, decimals = 2): string {
  return `$${v.toFixed(decimals)}`;
}

function elapsedMinutes(startedAt: string, endedAt: string | null): number {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  return Math.max(0, (end - start) / 60000);
}

const BudgetTab = ({ experimentId }: Props) => {
  const [summary, setSummary] = useState<ExperimentSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await fetchExperimentSummary(experimentId);
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
    tick();
    const id = window.setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [experimentId]);

  if (error) return <div className="cost-error">⚠ {error}</div>;
  if (!summary) return <div className="cost-loading">Loading budget…</div>;

  // budget_usd is on the experiment metadata returned by the summary;
  // it is set at creation time (Marcus's Experiment dataclass field).
  const budget = (summary as unknown as { budget_usd: number | null }).budget_usd;
  const spent = summary.summary.total_cost_usd;
  const isRunning = summary.ended_at === null;

  // Projection: linear extrapolation from completed_tasks / total_tasks.
  // Falls back to "n/a" if neither is known.
  let projected: number | null = null;
  if (
    summary.completed_tasks != null &&
    summary.total_tasks != null &&
    summary.completed_tasks > 0
  ) {
    projected = spent * (summary.total_tasks / summary.completed_tasks);
  }

  const pct = budget && budget > 0 ? spent / budget : null;
  const remaining = budget != null ? budget - spent : null;
  const alertThreshold = pct != null && pct >= 0.8;
  const overBudget = pct != null && pct >= 1.0;

  const elapsed = elapsedMinutes(summary.started_at, summary.ended_at);

  return (
    <div className="cost-budget">
      {alertThreshold && (
        <div
          className={`budget-banner ${
            overBudget ? 'banner-over' : 'banner-warning'
          }`}
        >
          {overBudget
            ? `⚠ Over budget — spent ${formatUsd(spent)} of ${formatUsd(
                budget!,
              )} cap`
            : `⚠ At ${(pct! * 100).toFixed(0)}% of budget`}
        </div>
      )}

      <section className="budget-grid">
        <div className="budget-card">
          <span className="budget-label">Spent</span>
          <span className="budget-value">{formatUsd(spent)}</span>
        </div>
        <div className="budget-card">
          <span className="budget-label">Budget</span>
          <span className="budget-value">
            {budget != null ? formatUsd(budget) : '—'}
          </span>
        </div>
        <div className="budget-card">
          <span className="budget-label">Remaining</span>
          <span
            className={`budget-value ${
              remaining != null && remaining < 0 ? 'negative' : ''
            }`}
          >
            {remaining != null ? formatUsd(remaining) : '—'}
          </span>
        </div>
        <div className="budget-card">
          <span className="budget-label">Projected total</span>
          <span className="budget-value">
            {projected != null ? formatUsd(projected) : '—'}
          </span>
        </div>
      </section>

      {budget != null && budget > 0 && (
        <section className="budget-bar-row">
          <div className="budget-bar">
            <div
              className={`budget-bar-fill ${
                overBudget ? 'fill-over' : alertThreshold ? 'fill-warning' : ''
              }`}
              style={{ width: `${Math.min(pct! * 100, 100)}%` }}
            />
          </div>
          <div className="budget-bar-caption">
            {(pct! * 100).toFixed(1)}% of {formatUsd(budget)}
          </div>
        </section>
      )}

      <section className="budget-meta">
        <div>
          <span className="meta-label">Status</span>
          <span className="meta-value">{isRunning ? 'running' : 'done'}</span>
        </div>
        <div>
          <span className="meta-label">Elapsed</span>
          <span className="meta-value">{elapsed.toFixed(1)} min</span>
        </div>
        <div>
          <span className="meta-label">Tasks</span>
          <span className="meta-value">
            {summary.completed_tasks ?? '?'} / {summary.total_tasks ?? '?'}
          </span>
        </div>
      </section>

      {budget == null && (
        <p className="budget-hint">
          No budget set on this experiment. Add a <code>budget_usd</code> when
          you create the experiment to see projections and alerts.
        </p>
      )}
    </div>
  );
};

export default BudgetTab;
