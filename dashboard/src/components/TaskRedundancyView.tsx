import { useState, useEffect } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';
import './TaskRedundancyView.css';

interface RedundantPair {
  task_1_id: string;
  task_1_name: string;
  task_2_id: string;
  task_2_name: string;
  overlap_score: number;
  evidence: string;
  time_wasted: number;
}

interface TaskRedundancy {
  project_id: string;
  redundant_pairs: RedundantPair[];
  redundancy_score: number;
  total_time_wasted: number;
  over_decomposition_detected: boolean;
  recommended_complexity: string;
  raw_data: Record<string, unknown>;
  llm_interpretation: string;
  recommendations: string[];
}

interface TaskRedundancyViewProps {
  projectId: string;
}

/**
 * Task Redundancy View Component
 *
 * Detects duplicate and redundant work across tasks. Shows redundancy scores,
 * redundant task pairs, time wasted, and complexity recommendations.
 */
const TaskRedundancyView = ({ projectId: _projectId }: TaskRedundancyViewProps) => {
  const historicalAnalysis = useVisualizationStore((state) => state.historicalAnalysis);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (historicalAnalysis) {
      setLoading(false);
    }
  }, [historicalAnalysis]);

  if (loading) {
    return (
      <div className="task-redundancy-view loading">
        <div className="loading-spinner">Loading task redundancy analysis...</div>
      </div>
    );
  }

  if (!historicalAnalysis || !historicalAnalysis.task_redundancy) {
    return (
      <div className="task-redundancy-view empty">
        <div className="empty-state">
          <h3>No Task Redundancy Data</h3>
          <p>
            Task redundancy analysis is not available for this project.
          </p>
        </div>
      </div>
    );
  }

  const redundancyData: TaskRedundancy = historicalAnalysis.task_redundancy;

  return (
    <div className="task-redundancy-view">
      <div className="view-header">
        <h2>Task Redundancy Analysis</h2>
        <p>
          Detects duplicate and redundant work to identify optimization
          opportunities
        </p>
      </div>

      {/* Overall Metrics */}
      <section className="redundancy-metrics">
        <div className="metric-card">
          <div className="metric-label">Redundancy Score</div>
          <div className="score-display">
            <div className="circular-progress">
              <svg viewBox="0 0 36 36" className="circular-chart">
                <path
                  className="circle-bg"
                  d="M18 2.0845
                    a 15.9155 15.9155 0 0 1 0 31.831
                    a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className="circle"
                  strokeDasharray={`${redundancyData.redundancy_score * 100}, 100`}
                  d="M18 2.0845
                    a 15.9155 15.9155 0 0 1 0 31.831
                    a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <text x="18" y="20.35" className="percentage">
                  {(redundancyData.redundancy_score * 100).toFixed(0)}%
                </text>
              </svg>
            </div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Time Wasted</div>
          <div className="time-wasted">
            <span className="hours">{redundancyData.total_time_wasted.toFixed(1)}h</span>
            <span className="subtitle">on redundant work</span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Recommended Complexity</div>
          <div
            className={`complexity-badge ${redundancyData.recommended_complexity}`}
          >
            {redundancyData.recommended_complexity.toUpperCase()}
          </div>
          {redundancyData.over_decomposition_detected && (
            <div className="warning">⚠️ Over-decomposition detected</div>
          )}
        </div>
      </section>

      {/* Redundant Pairs */}
      {redundancyData.redundant_pairs.length > 0 && (
        <section className="redundant-pairs">
          <h3>
            Redundant Task Pairs ({redundancyData.redundant_pairs.length})
          </h3>
          <div className="pairs-list">
            {redundancyData.redundant_pairs.map((pair, idx) => (
              <div key={idx} className="redundant-pair-card">
                <div className="pair-header">
                  <div className="overlap-score">
                    <div className="circular-progress small">
                      <svg viewBox="0 0 36 36" className="circular-chart">
                        <path
                          className="circle-bg"
                          d="M18 2.0845
                            a 15.9155 15.9155 0 0 1 0 31.831
                            a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                        <path
                          className="circle"
                          strokeDasharray={`${pair.overlap_score * 100}, 100`}
                          d="M18 2.0845
                            a 15.9155 15.9155 0 0 1 0 31.831
                            a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                        <text x="18" y="20.35" className="percentage">
                          {(pair.overlap_score * 100).toFixed(0)}%
                        </text>
                      </svg>
                    </div>
                    <span className="overlap-label">overlap</span>
                  </div>
                  <div className="time-wasted-badge">
                    {pair.time_wasted.toFixed(1)}h wasted
                  </div>
                </div>

                <div className="pair-tasks">
                  <div className="task-info">
                    <span className="task-id">{pair.task_1_id}</span>
                    <span className="task-name">{pair.task_1_name}</span>
                  </div>
                  <div className="overlap-indicator">⟷</div>
                  <div className="task-info">
                    <span className="task-id">{pair.task_2_id}</span>
                    <span className="task-name">{pair.task_2_name}</span>
                  </div>
                </div>

                {/* Evidence (Collapsible) */}
                <details className="evidence-details">
                  <summary>Evidence & Citations</summary>
                  <div className="evidence-content">
                    <p>{pair.evidence}</p>
                  </div>
                </details>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* LLM Interpretation */}
      {redundancyData.llm_interpretation && (
        <section className="llm-interpretation">
          <h3>Analysis Summary</h3>
          <div className="interpretation-text">
            <p>{redundancyData.llm_interpretation}</p>
          </div>
        </section>
      )}

      {/* Recommendations */}
      {redundancyData.recommendations.length > 0 && (
        <section className="recommendations">
          <h3>Recommendations</h3>
          <ul className="recommendations-list">
            {redundancyData.recommendations.map((rec, idx) => (
              <li key={idx} className="recommendation-item">
                <span className="rec-icon">💡</span>
                {rec}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Raw Data (Collapsible) */}
      <section className="raw-data-section">
        <details>
          <summary>
            Raw Analysis Data ({Object.keys(redundancyData.raw_data).length}{' '}
            fields)
          </summary>
          <pre className="raw-data">
            {JSON.stringify(redundancyData.raw_data, null, 2)}
          </pre>
        </details>
      </section>
    </div>
  );
};

export default TaskRedundancyView;
