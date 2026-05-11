/**
 * Tab 2 — Historical view (project-first).
 *
 * Lifetime totals + per-project rollup pulled from
 * ``/api/cost/projects`` (the project picker's data source). Replaces
 * the old experiment-based aggregation because Marcus's main code
 * path doesn't open MLflow experiments — project_id is the universal
 * identity.
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchProjects, type ProjectRow } from '../services/costService';
import './HistoricalTab.css';

function formatUsd(v: number, decimals = 2): string {
  return `$${v.toFixed(decimals)}`;
}

function formatTokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const HistoricalTab = () => {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProjects(1000)
      .then(({ projects: ps }) => {
        if (!cancelled) {
          setProjects(ps);
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

  const { totalCost, totalTokens, totalEvents, totalAgents } = useMemo(() => {
    let totalCost = 0;
    let totalTokens = 0;
    let totalEvents = 0;
    const allAgents = new Set<string>();
    for (const p of projects) {
      totalCost += p.total_cost_usd;
      totalTokens += p.total_tokens;
      totalEvents += p.events;
      // p.agents is a count, not a list — sum is a fine approximation
      // here since agent IDs are scoped per-project anyway.
      allAgents.add(`${p.project_id}:agents:${p.agents}`);
    }
    // Use the sum of distinct agent counts as the metric — distinct
    // agent_ids aren't returned on the rollup, but per-project agent
    // counts summed is a useful "total work performed" metric.
    const agentSum = projects.reduce((acc, p) => acc + p.agents, 0);
    return {
      totalCost,
      totalTokens,
      totalEvents,
      totalAgents: agentSum,
    };
  }, [projects]);

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
          <span className="cost-stat-label">Events</span>
          <span className="cost-stat-value">{totalEvents}</span>
        </div>
        <div className="cost-stat">
          <span className="cost-stat-label">Projects</span>
          <span className="cost-stat-value">{projects.length}</span>
        </div>
        <div className="cost-stat">
          <span className="cost-stat-label">Agent runs</span>
          <span className="cost-stat-value">{totalAgents}</span>
        </div>
      </header>

      <section className="cost-panel">
        <h3>By project</h3>
        {projects.length === 0 ? (
          <p className="empty">No projects yet.</p>
        ) : (
          <table className="cost-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Events</th>
                <th>Agents</th>
                <th>Tokens</th>
                <th>Cost</th>
                <th>First seen</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.project_id}>
                  <td>
                    {p.project_name ?? (
                      <code className="project-id-code">
                        {p.project_id.slice(0, 12)}…
                      </code>
                    )}
                  </td>
                  <td>{p.events}</td>
                  <td>{p.agents}</td>
                  <td>{formatTokens(p.total_tokens)}</td>
                  <td className="cost-cell">{formatUsd(p.total_cost_usd)}</td>
                  <td>{formatDate(p.first_event_at)}</td>
                  <td>{formatDate(p.last_event_at)}</td>
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
