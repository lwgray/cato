/**
 * Tab 1 — Real-time project view.
 *
 * Project-first (Marcus #503): renders the cost breakdown for one
 * project across all agents, roles, sessions, and turns. Replaces the
 * old experiment-keyed view because Marcus's main code path doesn't
 * open MLflow experiments — project_id is the universal identity.
 *
 * Pulls from ``/api/cost/projects/{id}/summary`` which mirrors the
 * shape ``/api/cost/experiments/{id}`` used to return.
 */

import { useEffect, useState } from 'react';
import {
  fetchProjectFullSummary,
  type ProjectFullSummary,
} from '../services/costService';
import AgentSpendBars from './AgentSpendBars';
import './RealTimeTab.css';

interface Props {
  projectId: string;
  /** Poll interval in ms. Default 5000. Set to 0 to disable polling. */
  pollIntervalMs?: number;
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

const RealTimeTab = ({ projectId, pollIntervalMs = 5000 }: Props) => {
  const [summary, setSummary] = useState<ProjectFullSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 404 from /summary means the project exists in the picker (it has a
  // ProjectRow entry from /projects) but has zero token_events. Distinct
  // from a generic error — render a friendly empty state.
  const [noActivity, setNoActivity] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setNoActivity(false);
    setSummary(null);

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
        if (msg.includes("HTTP 404")) {
          setNoActivity(true);
          setError(null);
        } else {
          setError(msg);
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };

    void tick();
    if (pollIntervalMs > 0) {
      const id = window.setInterval(tick, pollIntervalMs);
      return () => {
        cancelled = true;
        window.clearInterval(id);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [projectId, pollIntervalMs]);

  if (error) {
    return <div className="cost-error">⚠ {error}</div>;
  }
  if (noActivity) {
    return (
      <div className="cost-empty">
        <p>No LLM activity recorded for this project yet.</p>
        <p className="hint">
          Cost data appears here as soon as Marcus or an agent makes its
          first LLM call against this project.
        </p>
      </div>
    );
  }
  if (!summary && !loaded) {
    return <div className="cost-loading">Loading cost data…</div>;
  }
  if (!summary) {
    return <div className="cost-empty">No data.</div>;
  }

  const s = summary.summary;

  return (
    <div className="cost-realtime">
      <header className="cost-headline">
        <div className="cost-headline-title">
          <span className="cost-experiment-name">
            {summary.project_name ?? summary.project_id}
          </span>
        </div>
        <div className="cost-headline-metrics">
          <div className="cost-stat">
            <span className="cost-stat-label">Total tokens</span>
            <span className="cost-stat-value">{formatTokens(s.total_tokens)}</span>
          </div>
          <div className="cost-stat cost-stat-primary">
            <span className="cost-stat-label">Total cost</span>
            <span className="cost-stat-value">{formatUsd(s.total_cost_usd, 2)}</span>
          </div>
          <div className="cost-stat">
            <span className="cost-stat-label">Cache hit rate</span>
            <span className="cost-stat-value">{formatPct(s.cache_hit_rate)}</span>
          </div>
          <div className="cost-stat">
            <span className="cost-stat-label">Events</span>
            <span className="cost-stat-value">{s.total_events}</span>
          </div>
          <div className="cost-stat">
            <span className="cost-stat-label">Agents</span>
            <span className="cost-stat-value">{s.agents}</span>
          </div>
        </div>
      </header>

      <section className="cost-tokens-row">
        <div className="cost-token-card">
          <span className="cost-token-label">Input</span>
          <span className="cost-token-value">{formatTokens(s.input_tokens)}</span>
        </div>
        <div className="cost-token-card">
          <span className="cost-token-label">Cache created</span>
          <span className="cost-token-value">
            {formatTokens(s.cache_creation_tokens)}
          </span>
        </div>
        <div className="cost-token-card">
          <span className="cost-token-label">Cache read</span>
          <span className="cost-token-value">
            {formatTokens(s.cache_read_tokens)}
          </span>
        </div>
        <div className="cost-token-card">
          <span className="cost-token-label">Output</span>
          <span className="cost-token-value">{formatTokens(s.output_tokens)}</span>
        </div>
      </section>

      <section className="cost-breakdown">
        <div className="cost-panel">
          <h3>Cost by role</h3>
          <ul className="cost-role-list">
            {summary.by_role.map((r) => (
              <li key={r.role}>
                <span className={`role-dot role-${r.role}`}></span>
                <span className="role-name">{r.role}</span>
                <span className="role-cost">{formatUsd(r.cost_usd, 4)}</span>
                <span className="role-events">({r.events} events)</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="cost-panel cost-panel-wide">
          <h3>Cost by agent</h3>
          <AgentSpendBars agents={summary.by_agent} />
        </div>
      </section>

      {summary.by_operation.length > 0 && (
        <section className="cost-panel">
          <h3>Cost by operation</h3>
          <table className="cost-table">
            <thead>
              <tr>
                <th>Operation</th>
                <th>Events</th>
                <th>Tokens</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {summary.by_operation.map((op) => (
                <tr key={op.operation}>
                  <td>{op.operation}</td>
                  <td>{op.events}</td>
                  <td>{formatTokens(op.tokens)}</td>
                  <td>{formatUsd(op.cost_usd, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
};

export default RealTimeTab;
