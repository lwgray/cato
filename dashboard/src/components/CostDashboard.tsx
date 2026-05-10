/**
 * Top-level cost dashboard page (Marcus issue #409).
 *
 * Phase 7 ships only Tab 1 — Real-time. Tabs 2-4 (Historical, Budget,
 * Pricing) land in the next PR. The tab strip is rendered now so the
 * picker is in place when those land.
 */

import { useEffect, useState } from 'react';
import { fetchExperiments, type ExperimentRow } from '../services/costService';
import RealTimeTab from './RealTimeTab';
import './CostDashboard.css';

type CostTab = 'realtime' | 'historical' | 'budget' | 'pricing';

const CostDashboard = () => {
  const [activeTab, setActiveTab] = useState<CostTab>('realtime');
  const [experiments, setExperiments] = useState<ExperimentRow[]>([]);
  const [selectedExp, setSelectedExp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch experiment list on mount and refresh every 30s so a new run
  // appears in the picker without the user reloading the page.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const { experiments: exps } = await fetchExperiments();
        if (cancelled) return;
        setExperiments(exps);
        setError(null);
        if (selectedExp === null && exps.length > 0) {
          setSelectedExp(exps[0].experiment_id);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    load();
    const id = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [selectedExp]);

  if (error && experiments.length === 0) {
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
        <div className="cost-experiment-picker">
          <label htmlFor="cost-exp-select">Experiment:</label>
          <select
            id="cost-exp-select"
            value={selectedExp ?? ''}
            onChange={(e) => setSelectedExp(e.target.value || null)}
          >
            {experiments.length === 0 && <option value="">— none yet —</option>}
            {experiments.map((exp) => (
              <option key={exp.experiment_id} value={exp.experiment_id}>
                {exp.project_name ?? exp.experiment_id} — $
                {exp.total_cost_usd.toFixed(2)}
              </option>
            ))}
          </select>
        </div>
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
          disabled
          title="Coming in Phase 8"
        >
          Historical
        </button>
        <button
          className={activeTab === 'budget' ? 'active' : ''}
          onClick={() => setActiveTab('budget')}
          disabled
          title="Coming in Phase 8"
        >
          Budget
        </button>
        <button
          className={activeTab === 'pricing' ? 'active' : ''}
          onClick={() => setActiveTab('pricing')}
          disabled
          title="Coming in Phase 8"
        >
          Pricing
        </button>
      </div>

      <div className="cost-tab-content">
        {activeTab === 'realtime' && selectedExp && (
          <RealTimeTab experimentId={selectedExp} />
        )}
        {activeTab === 'realtime' && !selectedExp && (
          <div className="cost-empty">
            No experiments yet. Run one with the marcus skill and they'll appear here.
          </div>
        )}
      </div>
    </div>
  );
};

export default CostDashboard;
