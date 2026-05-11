/**
 * Top-level cost dashboard page (Marcus issue #409).
 *
 * Project is the primary axis (per Marcus CLAUDE.md GH-388 and
 * spawn_agents.py) — experiment is a secondary tracking handle that
 * may or may not be set depending on whether the run opted into
 * MLflow tracking. The picker leads with project; once a project is
 * selected, the user can optionally drill into a specific experiment
 * (MLflow run) within it.
 *
 * Sub-tabs:
 *   - Real-time  → live view of the active MLflow run (when one exists)
 *   - Historical → cross-project totals + per-experiment time series
 *   - Budget     → projection vs. cap for the active run
 *   - Pricing    → current rate table + insert form
 */

import { useEffect, useState } from 'react';
import {
  fetchProjectSummary,
  fetchProjects,
  fetchUnassignedTotals,
  type ProjectRow,
  type ProjectSummary,
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
  const [projectSummary, setProjectSummary] = useState<ProjectSummary | null>(null);
  const [selectedExp, setSelectedExp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll project list + unassigned totals every 30s so new runs appear
  // without a page reload and the unassigned indicator stays current.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [{ projects: ps }, una] = await Promise.all([
          fetchProjects(),
          fetchUnassignedTotals(),
        ]);
        if (cancelled) return;
        setProjects(ps);
        setUnassigned(una);
        setError(null);
        if (selectedProject === null && ps.length > 0) {
          setSelectedProject(ps[0].project_id);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    void load();
    const id = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [selectedProject]);

  // When the selected project changes, fetch its summary (totals +
  // experiment list) and auto-select the most recent experiment for
  // the Real-time tab.
  useEffect(() => {
    if (!selectedProject) {
      setProjectSummary(null);
      setSelectedExp(null);
      return;
    }
    let cancelled = false;
    fetchProjectSummary(selectedProject)
      .then((s) => {
        if (cancelled) return;
        setProjectSummary(s);
        if (s.experiments.length > 0) {
          setSelectedExp(s.experiments[0].experiment_id);
        } else {
          setSelectedExp(null);
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
  }, [selectedProject]);

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
                <option value="">— none yet —</option>
              )}
              {projects.map((p) => (
                <option key={p.project_id} value={p.project_id}>
                  {p.project_id.slice(0, 12)} — {formatUsd(p.total_cost_usd)}
                  {' '}({p.experiments} {p.experiments === 1 ? 'run' : 'runs'})
                </option>
              ))}
            </select>
          </div>

          {projectSummary && projectSummary.experiments.length > 0 && (
            <div className="cost-picker">
              <label htmlFor="cost-exp-select">Run:</label>
              <select
                id="cost-exp-select"
                value={selectedExp ?? ''}
                onChange={(e) => setSelectedExp(e.target.value || null)}
              >
                {projectSummary.experiments.map((exp) => (
                  <option key={exp.experiment_id} value={exp.experiment_id}>
                    {exp.experiment_id.slice(0, 16)} — {formatUsd(exp.total_cost_usd)}
                  </option>
                ))}
              </select>
            </div>
          )}
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
        {activeTab === 'realtime' && selectedExp && (
          <RealTimeTab experimentId={selectedExp} />
        )}
        {activeTab === 'realtime' && !selectedExp && selectedProject && (
          <div className="cost-empty">
            This project has events but no MLflow run was registered.
            See the project totals on the Historical tab.
          </div>
        )}
        {activeTab === 'realtime' && !selectedProject && (
          <div className="cost-empty">
            No projects yet. Run one with the marcus skill and it'll appear here.
          </div>
        )}
        {activeTab === 'historical' && (
          <HistoricalTab
            onSelectExperiment={(id) => {
              setSelectedExp(id);
              setActiveTab('realtime');
            }}
          />
        )}
        {activeTab === 'budget' && selectedExp && (
          <BudgetTab experimentId={selectedExp} />
        )}
        {activeTab === 'budget' && !selectedExp && (
          <div className="cost-empty">
            Select a project (and an MLflow run inside it) to see budget
            projection.
          </div>
        )}
        {activeTab === 'pricing' && <PricingTab />}
      </div>
    </div>
  );
};

export default CostDashboard;
