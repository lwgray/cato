import { useCallback } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';

/**
 * Header controls component to prevent flickering during data refreshes.
 * Subscribes directly to store values to avoid prop reference changes.
 */
const HeaderControls = () => {
  // Subscribe to store values directly (Zustand handles stability)
  const dataMode = useVisualizationStore((state) => state.dataMode);
  const isLoading = useVisualizationStore((state) => state.isLoading);
  const loadError = useVisualizationStore((state) => state.loadError);
  const projects = useVisualizationStore((state) => state.projects);
  const selectedProjectId = useVisualizationStore((state) => state.selectedProjectId);
  const autoRefreshEnabled = useVisualizationStore((state) => state.autoRefreshEnabled);

  // Get action functions from store (these are stable references)
  const loadData = useVisualizationStore((state) => state.loadData);
  const loadProjects = useVisualizationStore((state) => state.loadProjects);
  const setSelectedProject = useVisualizationStore((state) => state.setSelectedProject);
  const refreshData = useVisualizationStore((state) => state.refreshData);
  const toggleAutoRefresh = useVisualizationStore((state) => state.toggleAutoRefresh);

  const handleToggleDataMode = useCallback(async () => {
    const newMode = dataMode === 'live' ? 'mock' : 'live';

    if (newMode === 'live') {
      await loadProjects();
    }

    const selectedId = useVisualizationStore.getState().selectedProjectId;
    await loadData(newMode, selectedId || undefined);
  }, [dataMode, loadData, loadProjects]);

  const handleProjectChange = useCallback(async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const projectId = event.target.value || null;
    await setSelectedProject(projectId);
  }, [setSelectedProject]);

  const handleDropdownFocus = useCallback(async () => {
    // Refresh projects list when user opens the dropdown
    // This ensures new projects are immediately visible
    if (dataMode === 'live' && !isLoading) {
      console.log('Refreshing projects list on dropdown focus...');
      await loadProjects();
    }
  }, [dataMode, isLoading, loadProjects]);

  return (
    <>
      <div className="header-top">
        <h1>Cato - Marcus Parallelization Visualization</h1>
        <div className="header-controls">
          {dataMode === 'live' && projects.length > 0 && (
            <select
              className="project-selector"
              value={selectedProjectId || ''}
              onChange={handleProjectChange}
              onFocus={handleDropdownFocus}
              disabled={isLoading}
              title="Select project to visualize (auto-refreshes on open)"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          )}
          <button
            className="data-mode-toggle"
            onClick={handleToggleDataMode}
            disabled={isLoading}
          >
            {isLoading ? '⏳ Loading...' : dataMode === 'live' ? '🟢 Live Data' : '🔵 Mock Data'}
          </button>
          {dataMode === 'live' && (
            <>
              <button
                className={`auto-refresh-toggle ${autoRefreshEnabled ? 'enabled' : ''}`}
                onClick={toggleAutoRefresh}
                disabled={isLoading}
                title={autoRefreshEnabled ? 'Auto-refresh enabled (60s)' : 'Auto-refresh disabled'}
              >
                {autoRefreshEnabled ? '🟢 Auto (60s)' : '⚪ Auto'}
              </button>
              <button
                className="refresh-button"
                onClick={refreshData}
                disabled={isLoading}
                title="Refresh live data now"
              >
                🔄 Refresh
              </button>
            </>
          )}
        </div>
      </div>
      {loadError && (
        <div className="error-banner">
          ⚠️ Error loading data: {loadError}. Falling back to mock data.
        </div>
      )}
    </>
  );
};

export default HeaderControls;
