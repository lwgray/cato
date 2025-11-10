import { useCallback } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';

/**
 * Header controls component to prevent flickering during data refreshes.
 * Subscribes directly to store values to avoid prop reference changes.
 */
const HeaderControls = () => {
  // Subscribe to store values directly (Zustand handles stability)
  const isLoading = useVisualizationStore((state) => state.isLoading);
  const loadError = useVisualizationStore((state) => state.loadError);
  const projects = useVisualizationStore((state) => state.projects);
  const selectedProjectId = useVisualizationStore((state) => state.selectedProjectId);

  // Get action functions from store (these are stable references)
  const loadProjects = useVisualizationStore((state) => state.loadProjects);
  const setSelectedProject = useVisualizationStore((state) => state.setSelectedProject);
  const refreshData = useVisualizationStore((state) => state.refreshData);

  const handleProjectChange = useCallback(async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const projectId = event.target.value || null;
    await setSelectedProject(projectId);
  }, [setSelectedProject]);

  const handleDropdownFocus = useCallback(async () => {
    // Refresh projects list when user opens the dropdown
    // This ensures new projects are immediately visible
    if (!isLoading) {
      console.log('Refreshing projects list on dropdown focus...');
      await loadProjects();
    }
  }, [isLoading, loadProjects]);

  return (
    <>
      <div className="header-top">
        <h1>Cato - Marcus Parallelization Visualization</h1>
        <div className="header-controls">
          {projects.length > 0 && (
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
            className="refresh-button"
            onClick={refreshData}
            disabled={isLoading}
            title="Refresh live data now"
          >
            🔄 Refresh
          </button>
        </div>
      </div>
      {loadError && (
        <div className="error-banner">
          ⚠️ Error loading data: {loadError}
        </div>
      )}
    </>
  );
};

export default HeaderControls;
