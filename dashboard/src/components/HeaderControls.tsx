import { useCallback, useEffect, useRef, useState } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';
import { fetchSettings, updateSettings } from '../services/dataService';
import ExportButton from './ExportButton';
import HistoricalTab from './HistoricalTab';
import PricingTab from './PricingTab';

/** Full-screen overlay modal for cross-project / global cost views.
 *
 * Historical (lifetime cost rollup) and Pricing (rate table) used to
 * live inside the Cost dashboard tab strip. They were moved here so
 * the Cost view stays focused on the *active project*: Real-time +
 * Budget only. These two are global tools and belong with other
 * settings-level controls.
 */
const CostOverlay = ({
  kind,
  onClose,
}: {
  kind: 'historical' | 'pricing';
  onClose: () => void;
}) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '4vh',
        paddingBottom: '4vh',
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: '0.5rem',
          width: 'min(1100px, 95vw)',
          maxHeight: '92vh',
          overflowY: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.75rem 1.25rem',
            borderBottom: '1px solid #334155',
            position: 'sticky',
            top: 0,
            background: '#0f172a',
          }}
        >
          <h2 style={{ margin: 0, color: '#e2e8f0', fontSize: '1.1rem' }}>
            {kind === 'historical' ? '📊 Historical Cost' : '💲 Pricing Rates'}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: '1px solid #475569',
              color: '#e2e8f0',
              borderRadius: '0.25rem',
              padding: '0.25rem 0.65rem',
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            ✕ Close
          </button>
        </div>
        <div style={{ padding: '1rem 1.25rem' }}>
          {kind === 'historical' ? <HistoricalTab /> : <PricingTab />}
        </div>
      </div>
    </div>
  );
};

/**
 * Header controls component to prevent flickering during data refreshes.
 * Subscribes directly to store values to avoid prop reference changes.
 */
const HeaderControls = () => {
  // Subscribe to store values directly (Zustand handles stability)
  const isLoading = useVisualizationStore((state) => state.isLoading);
  const loadError = useVisualizationStore((state) => state.loadError);
  const loadingStatus = useVisualizationStore((state) => state.loadingStatus);
  const projects = useVisualizationStore((state) => state.projects);
  const selectedProjectId = useVisualizationStore((state) => state.selectedProjectId);

  // Get action functions from store (these are stable references)
  const loadProjects = useVisualizationStore((state) => state.loadProjects);
  const setSelectedProject = useVisualizationStore((state) => state.setSelectedProject);
  const refreshData = useVisualizationStore((state) => state.refreshData);
  const resetTimeOnTabSwitch = useVisualizationStore((state) => state.resetTimeOnTabSwitch);
  const setResetTimeOnTabSwitch = useVisualizationStore((state) => state.setResetTimeOnTabSwitch);

  const handleProjectChange = useCallback(
    async (event: React.ChangeEvent<HTMLSelectElement>) => {
      const projectId = event.target.value || null;
      await setSelectedProject(projectId);
    },
    [setSelectedProject]
  );

  const handleDropdownFocus = useCallback(async () => {
    if (!isLoading) {
      await loadProjects();
    }
  }, [isLoading, loadProjects]);

  // Settings panel state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cutoffDate, setCutoffDate] = useState<string>('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // Cost overlays launched from the settings panel. ``costOverlay``
  // is the only piece of state introduced for Change 2 — when set,
  // a full-screen modal renders Historical or Pricing on top of
  // everything else.
  const [costOverlay, setCostOverlay] = useState<
    'historical' | 'pricing' | null
  >(null);

  useEffect(() => {
    fetchSettings().then(s => setCutoffDate(s.history_cutoff_date ?? '')).catch(() => {});
  }, []);

  // Close panel on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    if (settingsOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [settingsOpen]);

  const handleSaveSettings = useCallback(async () => {
    setSettingsSaving(true);
    try {
      await updateSettings({ history_cutoff_date: cutoffDate || null });
      setSettingsOpen(false);
      await loadProjects();
    } catch (e) {
      console.error('Failed to save settings', e);
    } finally {
      setSettingsSaving(false);
    }
  }, [cutoffDate, loadProjects]);

  return (
    <>
      <div className="header-top">
        <h1>Cato - Multi-agent Workspace</h1>
        <div className="header-controls">
          {/* Project dropdown - on the left */}
          {projects.length > 0 ? (
            <select
              className="project-selector"
              value={selectedProjectId || ''}
              onChange={handleProjectChange}
              onFocus={handleDropdownFocus}
              title="Select project to visualize (auto-refreshes on open)"
            >
              {(() => {
                // Count occurrences of each name to detect duplicates
                const nameCounts: Record<string, number> = {};
                projects.forEach((p: any) => {
                  const n = p.project_name || p.name;
                  nameCounts[n] = (nameCounts[n] || 0) + 1;
                });
                return projects.map((project: any) => {
                  const projectId = project.project_id || project.id;
                  const projectName = project.project_name || project.name;
                  const isDuplicate = nameCounts[projectName] > 1;
                  let label = projectName;
                  if (isDuplicate && (project.created_at || project.last_used)) {
                    const ts = project.created_at || project.last_used;
                    const d = new Date(ts);
                    const dateStr = d.toLocaleString('en-US', {
                      month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit', hour12: false,
                    });
                    label = `${projectName} (${dateStr})`;
                  }
                  return (
                    <option key={projectId} value={projectId}>
                      {label}
                    </option>
                  );
                });
              })()}
            </select>
          ) : (
            <div className="project-selector loading" style={{
              padding: '0.5rem 1rem',
              background: '#1e293b',
              border: '2px solid #334155',
              borderRadius: '0.5rem',
              color: '#94a3b8',
              fontSize: '0.9rem'
            }}>
              {isLoading ? 'Loading projects...' : 'No projects found'}
            </div>
          )}

          {/* Refresh button - on the right */}
          <button
            className="refresh-button"
            onClick={refreshData}
            title="Refresh live data now"
          >
            🔄 Refresh
          </button>

          {/* Export button - on the right */}
          <ExportButton />

          {/* Settings */}
          <div style={{ position: 'relative' }} ref={settingsRef}>
            <button
              className="refresh-button"
              onClick={() => setSettingsOpen(o => !o)}
              title="Cato settings"
            >
              ⚙️
            </button>
            {settingsOpen && (
              <div style={{
                position: 'absolute', right: 0, top: '110%', zIndex: 100,
                background: '#1e293b', border: '1px solid #334155',
                borderRadius: '0.5rem', padding: '1rem', minWidth: '260px',
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              }}>
                <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: '0.75rem' }}>
                  Settings
                </div>
                <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                  Show history since
                </label>
                <input
                  type="date"
                  value={cutoffDate}
                  onChange={e => setCutoffDate(e.target.value)}
                  style={{
                    width: '100%', padding: '0.4rem', borderRadius: '0.25rem',
                    border: '1px solid #475569', background: '#0f172a',
                    color: '#e2e8f0', fontSize: '0.9rem', marginBottom: '0.75rem',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.75rem' }}>
                  Filters both the project list and log files. Leave blank to show all history.
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={resetTimeOnTabSwitch}
                    onChange={e => setResetTimeOnTabSwitch(e.target.checked)}
                    style={{ width: '1rem', height: '1rem', accentColor: '#3b82f6' }}
                  />
                  <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Reset timeline to 0 on tab switch</span>
                </label>
                <button
                  onClick={handleSaveSettings}
                  disabled={settingsSaving}
                  style={{
                    width: '100%', padding: '0.4rem', borderRadius: '0.25rem',
                    background: '#3b82f6', color: '#fff', border: 'none',
                    cursor: settingsSaving ? 'not-allowed' : 'pointer', fontSize: '0.9rem',
                  }}
                >
                  {settingsSaving ? 'Saving…' : 'Save'}
                </button>

                {/* Cross-project / global cost views. These used to live
                    in the Cost tab strip but were moved here so the
                    Cost view can stay focused on the active project
                    (Real-time + Budget only). */}
                <div style={{
                  marginTop: '0.75rem',
                  paddingTop: '0.75rem',
                  borderTop: '1px solid #334155',
                }}>
                  <div style={{ color: '#94a3b8', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.5rem' }}>
                    Cost tools
                  </div>
                  <button
                    onClick={() => {
                      setCostOverlay('historical');
                      setSettingsOpen(false);
                    }}
                    style={{
                      width: '100%', padding: '0.5rem 0.75rem',
                      borderRadius: '0.25rem', marginBottom: '0.4rem',
                      background: '#334155', border: '1px solid #475569',
                      color: '#e2e8f0', cursor: 'pointer', fontSize: '0.9rem',
                      textAlign: 'left',
                    }}
                  >
                    📊 Historical Cost
                  </button>
                  <button
                    onClick={() => {
                      setCostOverlay('pricing');
                      setSettingsOpen(false);
                    }}
                    style={{
                      width: '100%', padding: '0.5rem 0.75rem',
                      borderRadius: '0.25rem',
                      background: '#334155', border: '1px solid #475569',
                      color: '#e2e8f0', cursor: 'pointer', fontSize: '0.9rem',
                      textAlign: 'left',
                    }}
                  >
                    💲 Pricing Rates
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {loadError && (
        <div className="error-banner">
          ⚠️ Error loading data: {loadError}
        </div>
      )}
      {costOverlay && (
        <CostOverlay
          kind={costOverlay}
          onClose={() => setCostOverlay(null)}
        />
      )}
      {loadingStatus && (
        <div
          className="loading-banner"
          style={{
            background: 'linear-gradient(135deg, #1e3a8a 0%, #312e81 100%)',
            color: '#e0e7ff',
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            marginBottom: '1rem',
            fontSize: '0.9rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <span
            className="loading-spinner"
            style={{
              display: 'inline-block',
              width: '16px',
              height: '16px',
              border: '2px solid #e0e7ff',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          {loadingStatus}
        </div>
      )}
    </>
  );
};

export default HeaderControls;
