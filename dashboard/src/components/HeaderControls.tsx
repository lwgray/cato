import { useCallback, useEffect, useRef, useState } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';
import { fetchSettings, updateSettings } from '../services/dataService';
import ExportButton from './ExportButton';

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
              {projects.map((project: any) => {
                const projectId = project.project_id || project.id;
                const projectName = project.project_name || project.name;
                return (
                  <option key={projectId} value={projectId}>
                    {projectName}
                  </option>
                );
              })}
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
