import { useVisualizationStore } from '../store/visualizationStore';
import AnalysisProgress from './AnalysisProgress';
import './RetrospectiveDashboard.css';

/**
 * Retrospective Dashboard component
 *
 * Displays high-level project summary and Phase 1 metrics for completed projects.
 * Shows task completion rates, decision counts, agent activity, and project timeline.
 * Uses SSE streaming to show real-time analysis progress.
 */
const RetrospectiveDashboard = () => {
  const historicalAnalysis = useVisualizationStore((state) => state.historicalAnalysis);
  const isLoading = useVisualizationStore((state) => state.isLoading);
  const loadError = useVisualizationStore((state) => state.loadError);
  const selectedHistoricalProjectId = useVisualizationStore(
    (state) => state.selectedHistoricalProjectId
  );

  // Show progress component while loading
  if (isLoading && selectedHistoricalProjectId) {
    return (
      <div className="retrospective-dashboard loading">
        <AnalysisProgress
          projectId={selectedHistoricalProjectId}
          onComplete={(data) => {
            // Update the store with the completed analysis
            useVisualizationStore.setState({
              historicalAnalysis: data,
              isLoading: false,
            });
          }}
          onError={(error) => {
            // Update the store with the error
            useVisualizationStore.setState({
              loadError: error,
              isLoading: false,
            });
          }}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="retrospective-dashboard loading">
        <div className="loading-spinner">Initializing...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="retrospective-dashboard error">
        <div className="error-message">
          <h3>⚠️ Error Loading Analysis</h3>
          <p>{loadError}</p>
        </div>
      </div>
    );
  }

  if (!historicalAnalysis) {
    return (
      <div className="retrospective-dashboard empty">
        <div className="empty-state">
          <h3>📊 Select a Project</h3>
          <p>Choose a completed project from the dropdown to view its retrospective analysis.</p>
        </div>
      </div>
    );
  }

  const {
    project_name,
    total_tasks,
    completed_tasks,
    blocked_tasks,
    completion_rate,
    total_decisions,
    total_artifacts,
    active_agents,
    project_duration_hours,
    analysis_timestamp,
    summary,
  } = historicalAnalysis;

  return (
    <div className="retrospective-dashboard">
      <div className="dashboard-header">
        <h2>📈 Project Retrospective: {project_name}</h2>
        <p className="analysis-timestamp">
          Analysis generated: {new Date(analysis_timestamp).toLocaleString()}
        </p>
      </div>

      {/* Executive Summary from Phase 2 LLM Analysis */}
      {summary && (
        <div className="executive-summary">
          <h3>Executive Summary</h3>
          <p>{summary}</p>
        </div>
      )}

      {/* Phase 1 Metrics Grid */}
      <div className="metrics-grid">
        <div className="metric-card completion">
          <div className="metric-icon">✅</div>
          <div className="metric-content">
            <div className="metric-label">Task Completion</div>
            <div className="metric-value">{completion_rate.toFixed(1)}%</div>
            <div className="metric-details">
              {completed_tasks} of {total_tasks} tasks completed
            </div>
          </div>
        </div>

        <div className="metric-card blocked">
          <div className="metric-icon">🚫</div>
          <div className="metric-content">
            <div className="metric-label">Blocked Tasks</div>
            <div className="metric-value">{blocked_tasks}</div>
            <div className="metric-details">
              {blocked_tasks > 0 ? 'Requires attention' : 'None'}
            </div>
          </div>
        </div>

        <div className="metric-card decisions">
          <div className="metric-icon">🔀</div>
          <div className="metric-content">
            <div className="metric-label">Architectural Decisions</div>
            <div className="metric-value">{total_decisions}</div>
            <div className="metric-details">Logged during project</div>
          </div>
        </div>

        <div className="metric-card artifacts">
          <div className="metric-icon">📦</div>
          <div className="metric-content">
            <div className="metric-label">Artifacts Created</div>
            <div className="metric-value">{total_artifacts}</div>
            <div className="metric-details">Specifications & docs</div>
          </div>
        </div>

        <div className="metric-card agents">
          <div className="metric-icon">🤖</div>
          <div className="metric-content">
            <div className="metric-label">Active Agents</div>
            <div className="metric-value">{active_agents}</div>
            <div className="metric-details">Participated in project</div>
          </div>
        </div>

        <div className="metric-card duration">
          <div className="metric-icon">⏱️</div>
          <div className="metric-content">
            <div className="metric-label">Project Duration</div>
            <div className="metric-value">{project_duration_hours.toFixed(1)}h</div>
            <div className="metric-details">
              {project_duration_hours < 1
                ? `${Math.round(project_duration_hours * 60)} minutes`
                : `${Math.floor(project_duration_hours)} hours ${Math.round(
                    (project_duration_hours % 1) * 60
                  )} min`}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Links to Other Views */}
      <div className="quick-links">
        <h3>Detailed Analysis</h3>
        <p>Explore specific aspects of this project:</p>
        <div className="links-grid">
          <button
            className="quick-link-btn"
            onClick={() => useVisualizationStore.getState().setCurrentLayer('fidelity')}
          >
            🎯 Requirement Fidelity
            <span className="link-description">
              Check how well implementation matched requirements
            </span>
          </button>
          <button
            className="quick-link-btn"
            onClick={() => useVisualizationStore.getState().setCurrentLayer('decisions')}
          >
            🔀 Decision Impacts
            <span className="link-description">See how decisions affected the project</span>
          </button>
          <button
            className="quick-link-btn"
            onClick={() => useVisualizationStore.getState().setCurrentLayer('failures')}
          >
            ⚠️ Failure Diagnosis
            <span className="link-description">Understand what went wrong and why</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default RetrospectiveDashboard;
