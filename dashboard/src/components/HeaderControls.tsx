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
  const loadingStatus = useVisualizationStore((state) => state.loadingStatus);
  const projects = useVisualizationStore((state) => state.projects);
  const historicalProjects = useVisualizationStore((state) => state.historicalProjects);
  const selectedProjectId = useVisualizationStore((state) => state.selectedProjectId);
  const selectedHistoricalProjectId = useVisualizationStore((state) => state.selectedHistoricalProjectId);

  // NEW: Mode state
  const viewMode = useVisualizationStore((state) => state.viewMode);

  // Determine which project list and selection to use based on mode
  const currentProjects = viewMode === 'historical' ? historicalProjects : projects;
  const currentSelectedId = viewMode === 'historical' ? selectedHistoricalProjectId : selectedProjectId;

  // Debug logging
  console.log('[HeaderControls] Render state:', {
    viewMode,
    projectsCount: projects.length,
    historicalProjectsCount: historicalProjects.length,
    currentProjectsCount: currentProjects.length,
    selectedProjectId,
    selectedHistoricalProjectId,
    currentSelectedId,
  });

  // Get action functions from store (these are stable references)
  const loadProjects = useVisualizationStore((state) => state.loadProjects);
  const loadHistoricalProjects = useVisualizationStore((state) => state.loadHistoricalProjects);
  const setSelectedProject = useVisualizationStore((state) => state.setSelectedProject);
  const refreshData = useVisualizationStore((state) => state.refreshData);

  // NEW: Mode actions
  const setViewMode = useVisualizationStore((state) => state.setViewMode);
  const setSelectedHistoricalProject = useVisualizationStore(
    (state) => state.setSelectedHistoricalProject
  );

  const handleProjectChange = useCallback(
    async (event: React.ChangeEvent<HTMLSelectElement>) => {
      const projectId = event.target.value || null;

      if (viewMode === 'live') {
        await setSelectedProject(projectId);
      } else {
        await setSelectedHistoricalProject(projectId);
      }
    },
    [viewMode, setSelectedProject, setSelectedHistoricalProject]
  );

  const handleDropdownFocus = useCallback(async () => {
    // Refresh projects list when user opens the dropdown
    // This ensures new projects are immediately visible
    if (!isLoading) {
      console.log('Refreshing projects list on dropdown focus...');
      if (viewMode === 'historical') {
        await loadHistoricalProjects();
      } else {
        await loadProjects();
      }
    }
  }, [isLoading, viewMode, loadProjects, loadHistoricalProjects]);

  // NEW: Mode toggle handler
  const handleModeToggle = useCallback(async () => {
    console.log('=== Mode Toggle Clicked ===');
    console.log('Current mode:', viewMode);
    console.log('selectedProjectId:', selectedProjectId);
    console.log('selectedHistoricalProjectId:', selectedHistoricalProjectId);

    const newMode = viewMode === 'live' ? 'historical' : 'live';
    console.log('Switching to mode:', newMode);

    // Switch mode first (this will load historical projects if going to historical)
    await setViewMode(newMode);

    // After mode switch, reload data for the appropriate project
    // Use the project ID that was active in the OLD mode (before switch)
    const projectId = viewMode === 'live' ? selectedProjectId : selectedHistoricalProjectId;
    console.log('Project ID from old mode:', projectId);

    if (projectId) {
      if (newMode === 'live') {
        console.log('Loading live data for project:', projectId);
        await setSelectedProject(projectId);
      } else {
        console.log('Loading historical analysis for project:', projectId);
        // Historical projects should already be loaded by setViewMode
        // Just select the project to trigger analysis load
        await setSelectedHistoricalProject(projectId);
      }
    } else {
      console.log('No project ID available, relying on auto-selection');
    }
  }, [viewMode, selectedProjectId, selectedHistoricalProjectId, setViewMode, setSelectedProject, setSelectedHistoricalProject]);

  return (
    <>
      <div className="header-top">
        <h1>Cato - Marcus Parallelization Visualization</h1>
        <div className="header-controls">
          {/* Project dropdown - on the left */}
          {currentProjects.length > 0 ? (
            <select
              className="project-selector"
              value={currentSelectedId || ''}
              onChange={handleProjectChange}
              onFocus={handleDropdownFocus}
              disabled={isLoading}
              title={
                viewMode === 'historical'
                  ? 'Select project for historical analysis'
                  : 'Select project to visualize (auto-refreshes on open)'
              }
            >
              {currentProjects.map((project: any) => {
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

          {/* Mode toggle - in the middle */}
          <button
            className={`mode-toggle ${viewMode === 'historical' ? 'historical' : 'live'}`}
            onClick={handleModeToggle}
            disabled={isLoading}
            title={
              viewMode === 'live'
                ? 'Click to view historical project analysis'
                : 'Click to view live monitoring'
            }
          >
            {viewMode === 'live' ? '📊 View Historical' : '🟢 Live Monitoring'}
          </button>

          {/* Refresh button - on the right (live mode only) */}
          {viewMode === 'live' && (
            <button
              className="refresh-button"
              onClick={refreshData}
              disabled={isLoading}
              title="Refresh live data now"
            >
              🔄 Refresh
            </button>
          )}
        </div>
      </div>
      {loadError && (
        <div className="error-banner">
          ⚠️ Error loading data: {loadError}
        </div>
      )}
      {loadingStatus && (
        <div className="loading-banner" style={{
          background: 'linear-gradient(135deg, #1e3a8a 0%, #312e81 100%)',
          color: '#e0e7ff',
          padding: '0.5rem 1rem',
          borderRadius: '4px',
          marginBottom: '1rem',
          fontSize: '0.9rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <span className="loading-spinner" style={{
            display: 'inline-block',
            width: '16px',
            height: '16px',
            border: '2px solid #e0e7ff',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite'
          }} />
          {loadingStatus}
        </div>
      )}
    </>
  );
};

export default HeaderControls;
