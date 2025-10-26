import { memo, useCallback } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';

/**
 * Memoized header controls to prevent flickering during data refreshes.
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
  const taskView = useVisualizationStore((state) => state.taskView);

  // Get action functions from store (these are stable references)
  const loadData = useVisualizationStore((state) => state.loadData);
  const loadProjects = useVisualizationStore((state) => state.loadProjects);
  const setSelectedProject = useVisualizationStore((state) => state.setSelectedProject);
  const refreshData = useVisualizationStore((state) => state.refreshData);
  const startAutoRefresh = useVisualizationStore((state) => state.startAutoRefresh);
  const stopAutoRefresh = useVisualizationStore((state) => state.stopAutoRefresh);
  const setTaskView = useVisualizationStore((state) => state.setTaskView);

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

  const handleToggleAutoRefresh = useCallback(() => {
    if (autoRefreshEnabled) {
      stopAutoRefresh();
    } else {
      startAutoRefresh();
    }
  }, [autoRefreshEnabled, startAutoRefresh, stopAutoRefresh]);

  const handleToggleTaskView = useCallback(async () => {
    const newView = taskView === 'subtasks' ? 'parents' : 'subtasks';
    await setTaskView(newView);
  }, [taskView, setTaskView]);

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
              disabled={isLoading}
              title="Select project to visualize"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          )}
          {dataMode === 'live' && (
            <button
              className="task-view-toggle"
              onClick={handleToggleTaskView}
              disabled={isLoading}
              title={taskView === 'subtasks' ? 'Switch to parent tasks view' : 'Switch to subtasks view'}
            >
              {taskView === 'subtasks' ? '📝 Subtasks' : '📦 Parent Tasks'}
            </button>
          )}
          <button
            className="data-mode-toggle"
            onClick={handleToggleDataMode}
            disabled={isLoading}
          >
            {isLoading ? '⏳ Loading...' : dataMode === 'live' ? '🟢 Live Data' : '🔵 Mock Data'}
          </button>
          {dataMode === 'live' && (
            <button
              className={`auto-refresh-toggle ${autoRefreshEnabled ? 'enabled' : ''}`}
              onClick={handleToggleAutoRefresh}
              disabled={isLoading}
              title={autoRefreshEnabled ? 'Auto-refresh enabled (5s)' : 'Enable auto-refresh'}
            >
              {autoRefreshEnabled ? '🔄 Auto (5s)' : '⏸️ Manual'}
            </button>
          )}
          <button
            className="refresh-button"
            onClick={refreshData}
            disabled={isLoading || dataMode === 'mock'}
            title="Refresh live data now"
          >
            🔄 Refresh Now
          </button>
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
