import { useState, useEffect } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';
import './RequirementFidelityView.css';

interface Divergence {
  requirement: string;
  implementation: string;
  severity: string;
  impact: string;
  citation: string;
}

interface RequirementDivergence {
  task_id: string;
  fidelity_score: number;
  divergences: Divergence[];
  recommendations: string[];
}

interface RequirementFidelityViewProps {
  projectId: string;
}

/**
 * Requirement Fidelity View Component
 *
 * Displays requirement divergence analysis showing how well implementation
 * matched requirements. Shows fidelity scores, divergences, and
 * recommendations.
 */
const RequirementFidelityView = ({ projectId: _projectId }: RequirementFidelityViewProps) => {
  const historicalAnalysis = useVisualizationStore((state) => state.historicalAnalysis);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (historicalAnalysis) {
      setLoading(false);
    }
  }, [historicalAnalysis]);

  if (loading) {
    return (
      <div className="requirement-fidelity-view loading">
        <div className="loading-spinner">Loading requirement fidelity analysis...</div>
      </div>
    );
  }

  if (!historicalAnalysis || !historicalAnalysis.requirement_divergences) {
    return (
      <div className="requirement-fidelity-view empty">
        <div className="empty-state">
          <h3>No Requirement Divergence Data</h3>
          <p>
            Requirement divergence analysis is not available for this project.
          </p>
        </div>
      </div>
    );
  }

  const divergences: RequirementDivergence[] = historicalAnalysis.requirement_divergences;

  // Calculate overall fidelity score
  const overallScore =
    divergences.length > 0
      ? divergences.reduce((sum, d) => sum + d.fidelity_score, 0) /
        divergences.length
      : 1.0;

  // Group by severity
  const severityCounts = divergences
    .flatMap((d) => d.divergences)
    .reduce(
      (acc, div) => {
        acc[div.severity] = (acc[div.severity] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

  return (
    <div className="requirement-fidelity-view">
      <div className="view-header">
        <h2>Requirement Fidelity Analysis</h2>
        <p>
          Analyzes how well implementation matched requirements across all tasks
        </p>
      </div>

      {/* Overall Metrics */}
      <section className="fidelity-metrics">
        <div className="metric-card overall-score">
          <div className="metric-label">Overall Fidelity Score</div>
          <div className="metric-value">
            <div className="score-circle">
              <svg viewBox="0 0 36 36" className="circular-chart">
                <path
                  className="circle-bg"
                  d="M18 2.0845
                    a 15.9155 15.9155 0 0 1 0 31.831
                    a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className="circle"
                  strokeDasharray={`${overallScore * 100}, 100`}
                  d="M18 2.0845
                    a 15.9155 15.9155 0 0 1 0 31.831
                    a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <text x="18" y="20.35" className="percentage">
                  {(overallScore * 100).toFixed(0)}%
                </text>
              </svg>
            </div>
          </div>
          <div className="metric-details">
            {divergences.length} tasks analyzed
          </div>
        </div>

        <div className="metric-card severity-breakdown">
          <div className="metric-label">Divergence Severity</div>
          <div className="severity-list">
            {Object.entries(severityCounts).map(([severity, count]) => (
              <div key={severity} className={`severity-item ${severity}`}>
                <span className="severity-label">{severity}</span>
                <span className="severity-count">{count}</span>
              </div>
            ))}
            {Object.keys(severityCounts).length === 0 && (
              <div className="no-divergences">No divergences detected</div>
            )}
          </div>
        </div>
      </section>

      {/* Task Divergences */}
      {divergences.length > 0 && (
        <section className="task-divergences">
          <h3>Task-Level Analysis ({divergences.length} tasks)</h3>
          <div className="divergences-list">
            {divergences.map((taskDiv, idx) => (
              <div key={idx} className="divergence-card">
                <div className="card-header">
                  <div className="task-info">
                    <span className="task-id">{taskDiv.task_id}</span>
                    <span className="fidelity-score">
                      Score: {(taskDiv.fidelity_score * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>

                {taskDiv.divergences.length > 0 && (
                  <div className="divergences-section">
                    <h4>Divergences ({taskDiv.divergences.length})</h4>
                    {taskDiv.divergences.map((div, divIdx) => (
                      <div
                        key={divIdx}
                        className={`divergence-item ${div.severity}`}
                      >
                        <div className="divergence-header">
                          <span className="severity-badge">{div.severity}</span>
                        </div>
                        <div className="divergence-content">
                          <div className="divergence-field">
                            <strong>Requirement:</strong>
                            <p>{div.requirement}</p>
                          </div>
                          <div className="divergence-field">
                            <strong>Implementation:</strong>
                            <p>{div.implementation}</p>
                          </div>
                          <div className="divergence-field">
                            <strong>Impact:</strong>
                            <p>{div.impact}</p>
                          </div>
                          {div.citation && (
                            <div className="divergence-citation">
                              <strong>Citation:</strong> {div.citation}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {taskDiv.recommendations.length > 0 && (
                  <div className="recommendations">
                    <h4>Recommendations</h4>
                    <ul>
                      {taskDiv.recommendations.map((rec, recIdx) => (
                        <li key={recIdx}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Raw Data (Collapsible) */}
                <details className="raw-data-section">
                  <summary>Raw Data</summary>
                  <pre className="raw-data">
                    {JSON.stringify(taskDiv, null, 2)}
                  </pre>
                </details>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default RequirementFidelityView;
