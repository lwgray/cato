/**
 * Top-level cost dashboard page (Marcus issue #409).
 *
 * Project-first (Marcus #503): project_id is the only universal
 * identity. The picker is unified with Cato's main header dropdown —
 * pick a project once at the top of the page and the Cost view
 * reflects that choice. There is no local picker.
 *
 * The view now contains only two tabs: Real-time (live spend +
 * per-call breakdown) and Budget (cap + projection). Historical and
 * Pricing are accessed from the settings gear in the header (full-
 * screen modals) since they're cross-project / global views, not
 * tied to the active project.
 */

import { useEffect, useRef, useState } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';
import {
  fetchUnassignedTotals,
  triggerIngest,
  type UnassignedTotals,
} from '../services/costService';
import BudgetTab from './BudgetTab';
import RealTimeTab from './RealTimeTab';
import './CostDashboard.css';

type CostTab = 'realtime' | 'budget';

function formatUsd(v: number, decimals = 2): string {
  return `$${v.toFixed(decimals)}`;
}

function formatTokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

/**
 * Normalize a project_id to the canonical (dashless hex) form the
 * cost DB uses. Cato's main picker emits Marcus's project_id in
 * whichever form the registry stored it (often dashed UUID); the
 * cost data is dashless. See Marcus canonical_project_id.
 */
function canonicalProjectId(pid: string | null): string | null {
  if (!pid) return null;
  return pid.replace(/-/g, '');
}

const CostDashboard = () => {
  const [activeTab, setActiveTab] = useState<CostTab>('realtime');
  const [unassigned, setUnassigned] = useState<UnassignedTotals | null>(null);
  const [unassignedOpen, setUnassignedOpen] = useState(false);

  // Unified picker: read the active project from the global store.
  // No local selectedProject state, no local <select>. Switching the
  // main header picker propagates here automatically.
  const globalProjectId = useVisualizationStore(
    (state) => state.selectedProjectId,
  );
  const projectId = canonicalProjectId(globalProjectId);

  // First-paint perf: triggerIngest sweeps ~/.claude/projects/<sess>.jsonl
  // and was previously awaited before initial render. Now we fire in
  // the background; the next 30s poll picks up any new rows.
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
      fireIngestInBackground();
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

  return (
    <div className="cost-dashboard">
      <div className="cost-dashboard-header">
        <h2>Cost</h2>

        {unassigned && unassigned.events > 0 && (
          <button
            type="button"
            className="cost-unassigned-icon"
            onClick={() => setUnassignedOpen((v) => !v)}
            title={
              'Unassigned cost — LLM calls Marcus made without an ' +
              'active project context. Click for details.'
            }
            aria-label="Unassigned cost details"
          >
            ⚠
          </button>
        )}

        {unassignedOpen && unassigned && (
          <div className="cost-unassigned-popover" role="dialog">
            <h4>Unassigned LLM activity</h4>
            <p className="hint">
              Calls Marcus made without an active project context — usually
              a code path running outside the MCP request lifecycle, or a
              project-creation tool. Historical view in Settings shows
              project-by-project breakdown including deleted projects.
            </p>
            <dl className="cost-unassigned-stats">
              <div>
                <dt>Events</dt>
                <dd>{unassigned.events}</dd>
              </div>
              <div>
                <dt>Tokens</dt>
                <dd>{formatTokens(unassigned.total_tokens)}</dd>
              </div>
              <div>
                <dt>Cost</dt>
                <dd>{formatUsd(unassigned.total_cost_usd, 4)}</dd>
              </div>
            </dl>
            <button
              type="button"
              className="cost-unassigned-close"
              onClick={() => setUnassignedOpen(false)}
            >
              Close
            </button>
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
          className={activeTab === 'budget' ? 'active' : ''}
          onClick={() => setActiveTab('budget')}
        >
          Budget
        </button>
      </div>

      <div className="cost-tab-content">
        {activeTab === 'realtime' && projectId && (
          <RealTimeTab projectId={projectId} />
        )}
        {activeTab === 'realtime' && !projectId && (
          <div className="cost-empty">
            <p>No project selected.</p>
            <p className="hint">
              Pick a project from the dropdown at the top of the page to
              see its live cost data. Historical totals (including deleted
              projects) are available in <strong>Settings → Historical
              Cost</strong>.
            </p>
          </div>
        )}
        {activeTab === 'budget' && projectId && (
          <BudgetTab projectId={projectId} />
        )}
        {activeTab === 'budget' && !projectId && (
          <div className="cost-empty">
            <p>No project selected.</p>
            <p className="hint">
              Pick a project at the top to see its budget cap and spend
              projection.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CostDashboard;
