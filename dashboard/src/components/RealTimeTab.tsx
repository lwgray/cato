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
  fetchOperationCatalog,
  fetchProjectFullSummary,
  type OperationCatalogEntry,
  type ProjectFullSummary,
} from '../services/costService';
import AgentSpendBars from './AgentSpendBars';
import AuditBanner from './AuditBanner';
import OperationsPanel from './OperationsPanel';
import TaskSpendPanel from './TaskSpendPanel';
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
  // Operation taxonomy (label + description per operation key). Loaded
  // once on first render; survives polling. Empty when Marcus is older
  // and lacks the operations module — falls through to raw keys.
  const [opCatalog, setOpCatalog] = useState<
    Record<string, OperationCatalogEntry>
  >({});

  useEffect(() => {
    let cancelled = false;
    fetchOperationCatalog()
      .then((c) => {
        if (!cancelled) setOpCatalog(c.operations);
      })
      .catch(() => {
        // intentionally swallowed — endpoint may not exist on old Marcus
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      <AuditBanner audit={summary.audit} />
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

      <TaskSpendPanel tasks={summary.by_task} />

      <OperationsPanel
        operations={summary.by_operation}
        catalog={opCatalog}
      />


      {summary.by_model.length > 0 && (
        <section className="cost-panel">
          <h3>
            Tokens by model{' '}
            <small className="cost-panel-hint">
              Each provider/model with its cache effectiveness.
            </small>
          </h3>
          <table className="cost-table cost-table-dense">
            <thead>
              <tr>
                <th>Model</th>
                <th>Provider</th>
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
              {summary.by_model.map((m) => (
                <tr key={`${m.model}-${m.provider}`}>
                  <td>{m.model}</td>
                  <td>{m.provider}</td>
                  <td>{m.events}</td>
                  <td>{formatTokens(m.input_tokens ?? 0)}</td>
                  <td>{formatTokens(m.cache_creation_tokens ?? 0)}</td>
                  <td>{formatTokens(m.cache_read_tokens ?? 0)}</td>
                  <td>{formatTokens(m.output_tokens ?? 0)}</td>
                  <td className={cacheCellClass(m.cache_hit_rate ?? 0)}>
                    {formatPct(m.cache_hit_rate ?? 0)}
                  </td>
                  <td>{formatUsd(m.cost_usd, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
};

/**
 * Color-code the cache-hit cell so low-cache rows pop out.
 * Below 30%: amber (the row that needs prompt-tightening attention).
 * 30–70%: neutral.
 * Above 70%: green (cache is working).
 */
function cacheCellClass(rate: number): string {
  if (rate < 0.3) return 'cache-cell cache-cold';
  if (rate > 0.7) return 'cache-cell cache-hot';
  return 'cache-cell';
}

export default RealTimeTab;
