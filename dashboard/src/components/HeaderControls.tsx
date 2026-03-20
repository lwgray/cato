import { useCallback } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';
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
