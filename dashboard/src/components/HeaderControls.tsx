import { memo, useCallback, useEffect } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';
import type { Project } from '../services/dataService';

interface HeaderControlsProps {
  dataMode: 'live' | 'mock';
  isLoading: boolean;
  projects: Project[];
  selectedProjectId: string | null;
  autoRefreshEnabled: boolean;
  taskView: 'subtasks' | 'parents' | 'all';
  loadError: string | null;
}

/**
 * Memoized header controls to prevent flickering during data refreshes.
 * Only re-renders when control-specific props change, not when snapshot data updates.
 */
const HeaderControls = ({
  dataMode,
  isLoading,
  projects,
  selectedProjectId,
  autoRefreshEnabled,
  taskView,
  loadError,
}: HeaderControlsProps) => {
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

// Custom comparison function to prevent re-renders when array contents are the same
function arePropsEqual(
  prevProps: HeaderControlsProps,
  nextProps: HeaderControlsProps
): boolean {
  // Check primitive props
  if (
    prevProps.dataMode !== nextProps.dataMode ||
    prevProps.isLoading !== nextProps.isLoading ||
    prevProps.selectedProjectId !== nextProps.selectedProjectId ||
    prevProps.autoRefreshEnabled !== nextProps.autoRefreshEnabled ||
    prevProps.taskView !== nextProps.taskView ||
    prevProps.loadError !== nextProps.loadError
  ) {
    return false;
  }

  // Deep check projects array - compare IDs and length
  if (prevProps.projects.length !== nextProps.projects.length) {
    return false;
  }

  for (let i = 0; i < prevProps.projects.length; i++) {
    if (prevProps.projects[i].id !== nextProps.projects[i].id) {
      return false;
    }
  }

  return true;
}

export default memo(HeaderControls, arePropsEqual);
