/**
 * Tab 1 — Real-time experiment view.
 *
 * Polls Cato's ``/api/cost/experiments/{id}`` every 5s for the active
 * experiment and renders the headline numbers plus two D3 charts:
 * per-agent spend bars and a per-turn cost trajectory for the most
 * recent session.
 *
 * Why polling, not SSE: Marcus's coordination model is board-mediated
 * and pull-based; polling fits that paradigm and is much simpler to
 * debug. We can layer SSE on later if real time matters more.
 */

import { useEffect, useState } from 'react';
import {
  fetchExperimentSummary,
  fetchSessionTurns,
  type ExperimentSummary,
  type TurnPoint,
} from '../services/costService';
import AgentSpendBars from './AgentSpendBars';
import TurnTrajectory from './TurnTrajectory';
import './RealTimeTab.css';

interface Props {
  experimentId: string;
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

const RealTimeTab = ({ experimentId, pollIntervalMs = 5000 }: Props) => {
  const [summary, setSummary] = useState<ExperimentSummary | null>(null);
  const [turns, setTurns] = useState<TurnPoint[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll the experiment summary.
  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const s = await fetchExperimentSummary(experimentId);
        if (!cancelled) {
          setSummary(s);
          setError(null);
          // Pick the agent with the most turns as default session source.
          // This is a heuristic — we surface a session picker once
          // sessions become a first-class concept in the UI.
          if (selectedSession === null) {
            const topAgent = s.by_agent.find((a) => a.sessions > 0);
            if (topAgent) {
              // Use the agent_id-keyed convention: agents working a task
              // commonly run one session. The session list isn't in the
              // summary today; the trajectory chart stays empty until
              // the user picks one via /api/cost/sessions/{id}/turns.
              // For Phase 7, we leave selectedSession null until the
              // session picker lands in Tabs 2-4.
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    tick();
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
  }, [experimentId, pollIntervalMs, selectedSession]);

  // Fetch turns when a session is selected.
  useEffect(() => {
    if (!selectedSession) {
      setTurns([]);
      return;
    }
    let cancelled = false;
    fetchSessionTurns(selectedSession)
      .then((d) => {
        if (!cancelled) setTurns(d.turns);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSession]);

  if (error) {
    return <div className="cost-error">⚠ {error}</div>;
  }
  if (!summary) {
    return <div className="cost-loading">Loading cost data…</div>;
  }

  const s = summary.summary;
  const isRunning = summary.ended_at === null;

  return (
    <div className="cost-realtime">
      {/* Headline strip */}
      <header className="cost-headline">
        <div className="cost-headline-title">
          <span className="cost-experiment-name">
            {summary.project_name ?? summary.experiment_id}
          </span>
          <span
            className={`cost-status-pill ${isRunning ? 'running' : 'done'}`}
          >
            {isRunning ? '● running' : '✓ done'}
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
        </div>
      </header>

      {/* Token breakdown row */}
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

      {/* Role + agent breakdowns */}
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
          <AgentSpendBars
            agents={summary.by_agent}
            onAgentClick={(agentId) => {
              // First-pass: clicking an agent sets the session source
              // to the agent_id. The session_id is not in the summary
              // payload today; for Phase 7 we leave the chart empty
              // until the session-picker lands in Tabs 2-4.
              setSelectedSession(agentId);
            }}
          />
        </div>
      </section>

      {/* Turn trajectory */}
      <section className="cost-panel">
        <h3>
          Per-turn trajectory
          {selectedSession && (
            <span className="cost-session-hint">session: {selectedSession}</span>
          )}
        </h3>
        <TurnTrajectory turns={turns} />
      </section>
    </div>
  );
};

export default RealTimeTab;
