/**
 * Top-level cost dashboard page (Marcus issue #409).
 *
 * Project-first: project_id is the only universal identity in Marcus's
 * coordination model (Marcus CLAUDE.md GH-388, spawn_agents.py, and
 * the #503 project-axis refactor). Marcus's main code path doesn't
 * open MLflow experiments, so the experiment dimension is no longer
 * surfaced in the UI — every tab renders from project-level data.
 *
 * Sub-tabs (all keyed off the selected project):
 *   - Real-time  → live spend, agents working, per-role breakdown
 *   - Historical → cross-project totals + per-project time series
 *   - Budget     → cost so far vs. spend rate / projection
 *   - Pricing    → current rate table + insert form
 */

import { useEffect, useRef, useState } from 'react';
import {
  fetchProjects,
  fetchUnassignedTotals,
  triggerIngest,
  type ProjectRow,
  type UnassignedTotals,
} from '../services/costService';
import BudgetTab from './BudgetTab';
import HistoricalTab from './HistoricalTab';
import PricingTab from './PricingTab';
import RealTimeTab from './RealTimeTab';
import './CostDashboard.css';

type CostTab = 'realtime' | 'historical' | 'budget' | 'pricing';

function formatUsd(v: number, decimals = 2): string {
  return `$${v.toFixed(decimals)}`;
}

function formatTokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

const CostDashboard = () => {
  const [activeTab, setActiveTab] = useState<CostTab>('realtime');
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [unassigned, setUnassigned] = useState<UnassignedTotals | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);

  // First-paint perf: triggerIngest sweeps ~/.claude/projects/<sess>.jsonl
  // and was previously awaited *before* fetchProjects, which made the
  // initial load take 10+ seconds on accounts with many session files.
  // Now we fire ingest in the background and let the picker render
  // immediately from whatever is already in costs.db. The next poll
  // tick picks up any rows ingest added.
  const ingestInFlight = useRef(false);
  useEffect(() => {
    let cancelled = false;

    const fireIngestInBackground = () => {
      if (ingestInFlight.current) return;
      ingestInFlight.current = true;
      triggerIngest()
        .catch(() => {
          // non-fatal — picker still shows whatever was already in the DB
        })
        .finally(() => {
          ingestInFlight.current = false;
        });
    };

    const load = async () => {
      // Kick off ingest in parallel — do not await.
      fireIngestInBackground();

      try {
        const { projects: ps } = await fetchProjects();
        if (cancelled) return;
        setProjects(ps);
        setError(null);
        // Auto-select the most expensive project the first time we see
        // any. Functional setState avoids depending on selectedProject
        // in the effect's deps array.
        setSelectedProject((current) =>
          current === null && ps.length > 0 ? ps[0].project_id : current,
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setInitialLoading(false);
      }

      // Fetch unassigned totals independently; failure here is not
      // fatal — we just skip the banner this tick.
      try {
        const una = await fetchUnassignedTotals();
        if (!cancelled) setUnassigned(una);
      } catch {
        // intentionally swallowed
      }
    };

    void load();
    const id = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (error && projects.length === 0) {
    return (
      <div className="cost-dashboard cost-dashboard-error">
        <h2>Cost dashboard unavailable</h2>
        <p>{error}</p>
        <p className="hint">
          The cost backend may be disabled — check that Marcus is running and
          ~/.marcus/costs.db exists.
        </p>
      </div>
    );
  }

  return (
    <div className="cost-dashboard">
      <div className="cost-dashboard-header">
        <h2>Cost</h2>

        <div className="cost-pickers">
          <div className="cost-picker">
            <label htmlFor="cost-project-select">Project:</label>
            <select
              id="cost-project-select"
              value={selectedProject ?? ''}
              onChange={(e) => setSelectedProject(e.target.value || null)}
            >
              {projects.length === 0 && (
                <option value="">
                  {initialLoading ? '— loading… —' : '— none yet —'}
                </option>
              )}
              {projects.map((p) => (
                <option key={p.project_id} value={p.project_id}>
                  {/*
                    Name resolution: experiments.project_name (MLflow) →
                    Marcus project registry → truncated id. Most Marcus
                    runs don't use MLflow, so registry is the usual
                    source. See cost_routes._load_project_names.
                  */}
                  {p.project_name ?? `${p.project_id.slice(0, 12)}…`}
                  {' '}— {formatUsd(p.total_cost_usd)}
                  {' '}({formatTokens(p.total_tokens)} tokens)
                </option>
              ))}
            </select>
          </div>
        </div>

        {unassigned && unassigned.events > 0 && (
          <div
            className="cost-unassigned-banner"
            title="LLM calls Marcus made without an active project context. Usually a code path running outside the MCP request lifecycle, or a project-creation tool. Investigate the gap."
          >
            ⚠ Unassigned: {unassigned.events} events,{' '}
            {formatTokens(unassigned.total_tokens)} tokens,{' '}
            {formatUsd(unassigned.total_cost_usd, 4)}
          </div>
        )}
      </div>

      <div className="cost-tab-strip">
        <button
          className={activeTab === 'realtime' ? 'active' : ''}
          onClick={() => setActiveTab('realtime')}
        >
          Real-time
        </button>
        <button
          className={activeTab === 'historical' ? 'active' : ''}
          onClick={() => setActiveTab('historical')}
        >
          Historical
        </button>
        <button
          className={activeTab === 'budget' ? 'active' : ''}
          onClick={() => setActiveTab('budget')}
        >
          Budget
        </button>
        <button
          className={activeTab === 'pricing' ? 'active' : ''}
          onClick={() => setActiveTab('pricing')}
        >
          Pricing
        </button>
      </div>

      <div className="cost-tab-content">
        {activeTab === 'realtime' && selectedProject && (
          <RealTimeTab projectId={selectedProject} />
        )}
        {activeTab === 'realtime' && !selectedProject && (
          <div className="cost-empty">
            No projects yet. Run one with the marcus skill and it'll appear here.
          </div>
        )}
        {activeTab === 'historical' && <HistoricalTab />}
        {activeTab === 'budget' && selectedProject && (
          <BudgetTab projectId={selectedProject} />
        )}
        {activeTab === 'budget' && !selectedProject && (
          <div className="cost-empty">
            Select a project to see budget projection.
          </div>
        )}
        {activeTab === 'pricing' && <PricingTab />}
      </div>
    </div>
  );
};

export default CostDashboard;
