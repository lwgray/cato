/**
 * Tab 3 — Budget view (project-scoped).
 *
 * Project-first (Marcus #503): renders cumulative spend, spend rate,
 * and projection for one project. When a project-level budget cap is
 * set (via the form in this tab), compares spend against cap and
 * surfaces threshold-crossing warnings — the same UX the old
 * experiment-level Budget tab had, lifted to the project axis.
 *
 * Budget caps persist in Marcus's cost DB via the ``project_budgets``
 * table and survive Cato restarts.
 */

import { useEffect, useState } from 'react';
import {
  fetchProjectBudget,
  fetchProjectFullSummary,
  setProjectBudget,
  type ProjectBudget,
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
  const [budget, setBudget] = useState<ProjectBudget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noActivity, setNoActivity] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Budget edit form state.
  const [editing, setEditing] = useState(false);
  const [draftCap, setDraftCap] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formMsg, setFormMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setNoActivity(false);
    setSummary(null);
    setBudget(null);

    const tick = async () => {
      try {
        const s = await fetchProjectFullSummary(projectId);
        if (!cancelled) {
          setSummary(s);
          setNoActivity(false);
          setError(null);
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('HTTP 404')) {
          setNoActivity(true);
          setError(null);
        } else {
          setError(msg);
        }
      }

      // Budget fetch runs even when summary 404s — user might be
      // setting a cap before the first LLM call.
      try {
        const b = await fetchProjectBudget(projectId);
        if (!cancelled) setBudget(b.budget);
      } catch {
        // non-fatal
      }

      if (!cancelled) setLoaded(true);
    };
    void tick();
    const id = window.setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [projectId]);

  const submitBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormMsg(null);
    try {
      const cap = Number(draftCap);
      if (Number.isNaN(cap)) {
        setFormMsg('Enter a number.');
        return;
      }
      const result = await setProjectBudget(
        projectId,
        cap,
        draftNote || undefined,
      );
      setBudget(result.budget);
      setEditing(false);
      setDraftCap('');
      setDraftNote('');
      setFormMsg(
        result.budget == null
          ? 'Cap cleared.'
          : `Cap set to ${formatUsd(result.budget.budget_usd)}.`,
      );
    } catch (err) {
      setFormMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (error) return <div className="cost-error">⚠ {error}</div>;

  // Show the budget form even when noActivity so users can set caps before
  // any LLM call lands. The trajectory section is hidden in that case.
  const headerSection = (
    <section className="budget-set-form">
      {!editing && (
        <div className="budget-current-cap">
          {budget != null ? (
            <>
              <span className="budget-cap-label">Cap:</span>
              <span className="budget-cap-value">
                {formatUsd(budget.budget_usd)}
              </span>
              {budget.note && (
                <span className="budget-cap-note">— {budget.note}</span>
              )}
            </>
          ) : (
            <span className="budget-cap-empty">No cap set for this project.</span>
          )}
          <button
            type="button"
            className="budget-edit-btn"
            onClick={() => {
              setEditing(true);
              setDraftCap(budget ? String(budget.budget_usd) : '');
              setDraftNote(budget?.note ?? '');
              setFormMsg(null);
            }}
          >
            {budget != null ? 'Edit' : 'Set cap'}
          </button>
        </div>
      )}
      {editing && (
        <form className="budget-form" onSubmit={submitBudget}>
          <label>
            <span>Cap ($)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              required
              value={draftCap}
              onChange={(e) => setDraftCap(e.target.value)}
              placeholder="e.g. 50"
            />
          </label>
          <label>
            <span>Note (optional)</span>
            <input
              type="text"
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
              placeholder="e.g. PoC budget"
            />
          </label>
          <div className="budget-form-actions">
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setFormMsg(null);
              }}
            >
              Cancel
            </button>
            <small className="budget-form-hint">
              Set to 0 to clear the cap.
            </small>
          </div>
          {formMsg && <p className="budget-form-msg">{formMsg}</p>}
        </form>
      )}
      {!editing && formMsg && (
        <p className="budget-form-msg success">{formMsg}</p>
      )}
    </section>
  );

  if (noActivity) {
    return (
      <div className="cost-budget">
        {headerSection}
        <div className="cost-empty">
          <p>No spend recorded for this project yet.</p>
          <p className="hint">
            Spend trajectory appears here once at least one LLM call has
            been attributed to this project. The cap above will apply as
            soon as costs start accruing.
          </p>
        </div>
      </div>
    );
  }

  if (!summary && !loaded) return <div className="cost-loading">Loading budget…</div>;
  if (!summary) return <div className="cost-empty">No data.</div>;

  const s = summary.summary;
  const spent = s.total_cost_usd;
  const elapsed = elapsedMinutes(s.first_event_at, s.last_event_at);
  const rate = elapsed > 0 ? spent / elapsed : 0;
  const oneHourProjection = spent + rate * 60;

  // Cap-comparison metrics.
  const cap = budget?.budget_usd ?? null;
  const pct = cap != null && cap > 0 ? spent / cap : null;
  const remaining = cap != null ? cap - spent : null;
  const overBudget = pct != null && pct >= 1.0;
  const alertThreshold = pct != null && pct >= 0.8;

  return (
    <div className="cost-budget">
      {headerSection}

      {alertThreshold && cap != null && (
        <div
          className={`budget-banner ${
            overBudget ? 'banner-over' : 'banner-warning'
          }`}
        >
          {overBudget
            ? `⚠ Over budget — spent ${formatUsd(spent)} of ${formatUsd(cap)} cap`
            : `⚠ At ${(pct! * 100).toFixed(0)}% of ${formatUsd(cap)} cap`}
        </div>
      )}

      <section className="budget-grid">
        <div className="budget-card">
          <span className="budget-label">Total spent</span>
          <span className="budget-value">{formatUsd(spent)}</span>
        </div>
        {cap != null && (
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
        )}
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

      {cap != null && cap > 0 && (
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
            {(pct! * 100).toFixed(1)}% of {formatUsd(cap)}
          </div>
        </section>
      )}

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
    </div>
  );
};

export default BudgetTab;
