import { useState, useEffect } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';
import './FailureDiagnosisView.css';

interface FailureCause {
  category: string;
  root_cause: string;
  contributing_factors: string[];
  evidence: string;
}

interface PreventionStrategy {
  strategy: string;
  rationale: string;
  effort: string;
  priority: string;
}

interface FailureDiagnosis {
  task_id: string;
  failure_causes: FailureCause[];
  prevention_strategies: PreventionStrategy[];
  lessons_learned: string[];
}

interface FailureDiagnosisViewProps {
  projectId: string;
}

/**
 * Failure Diagnosis View Component
 *
 * Shows failure root cause analysis for tasks. Displays failure causes,
 * prevention strategies, and lessons learned from project failures.
 */
const FailureDiagnosisView = ({ projectId: _projectId }: FailureDiagnosisViewProps) => {
  const historicalAnalysis = useVisualizationStore((state) => state.historicalAnalysis);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (historicalAnalysis) {
      setLoading(false);
    }
  }, [historicalAnalysis]);

  if (loading) {
    return (
      <div className="failure-diagnosis-view loading">
        <div className="loading-spinner">Loading failure diagnosis analysis...</div>
      </div>
    );
  }

  if (!historicalAnalysis || !historicalAnalysis.failure_diagnoses) {
    return (
      <div className="failure-diagnosis-view empty">
        <div className="empty-state">
          <h3>No Failure Diagnosis Data</h3>
          <p>
            Failure diagnosis analysis is not available for this project.
          </p>
        </div>
      </div>
    );
  }

  const diagnoses: FailureDiagnosis[] = historicalAnalysis.failure_diagnoses;

  // Calculate metrics
  const totalFailures = diagnoses.length;
  const totalCauses = diagnoses.reduce(
    (sum, d) => sum + d.failure_causes.length,
    0
  );
  const categoryCounts = diagnoses
    .flatMap((d) => d.failure_causes)
    .reduce(
      (acc, cause) => {
        acc[cause.category] = (acc[cause.category] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

  return (
    <div className="failure-diagnosis-view">
      <div className="view-header">
        <h2>Failure Diagnosis Analysis</h2>
        <p>
          Root cause analysis of task failures with prevention strategies and
          lessons learned
        </p>
      </div>

      {/* Overall Metrics */}
      <section className="diagnosis-metrics">
        <div className="metric-card">
          <div className="metric-icon">⚠️</div>
          <div className="metric-content">
            <div className="metric-label">Failed Tasks</div>
            <div className="metric-value">{totalFailures}</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon">🔍</div>
          <div className="metric-content">
            <div className="metric-label">Root Causes Identified</div>
            <div className="metric-value">{totalCauses}</div>
          </div>
        </div>

        <div className="metric-card category-breakdown">
          <div className="metric-label">Failure Categories</div>
          <div className="category-list">
            {Object.entries(categoryCounts).map(([category, count]) => (
              <div key={category} className="category-item">
                <span className="category-label">{category}</span>
                <span className="category-count">{count}</span>
              </div>
            ))}
            {Object.keys(categoryCounts).length === 0 && (
              <div className="no-categories">No failures categorized</div>
            )}
          </div>
        </div>
      </section>

      {/* Failure Diagnoses */}
      {diagnoses.length > 0 && (
        <section className="failure-diagnoses">
          <h3>Failure Analysis ({diagnoses.length} tasks)</h3>
          <div className="diagnoses-list">
            {diagnoses.map((diagnosis, idx) => (
              <div key={idx} className="diagnosis-card">
                <div className="card-header">
                  <span className="task-id">{diagnosis.task_id}</span>
                </div>

                {/* Failure Causes */}
                {diagnosis.failure_causes.length > 0 && (
                  <div className="causes-section">
                    <h4>Root Causes ({diagnosis.failure_causes.length})</h4>
                    {diagnosis.failure_causes.map((cause, causeIdx) => (
                      <div key={causeIdx} className="cause-item">
                        <div className="cause-header">
                          <span className="category-badge">{cause.category}</span>
                        </div>
                        <div className="cause-content">
                          <div className="cause-field">
                            <strong>Root Cause:</strong>
                            <p>{cause.root_cause}</p>
                          </div>
                          {cause.contributing_factors.length > 0 && (
                            <div className="cause-field">
                              <strong>Contributing Factors:</strong>
                              <ul>
                                {cause.contributing_factors.map((factor, factorIdx) => (
                                  <li key={factorIdx}>{factor}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {cause.evidence && (
                            <div className="cause-evidence">
                              <strong>Evidence:</strong> {cause.evidence}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Prevention Strategies */}
                {diagnosis.prevention_strategies.length > 0 && (
                  <div className="prevention-section">
                    <h4>
                      Prevention Strategies ({diagnosis.prevention_strategies.length})
                    </h4>
                    {diagnosis.prevention_strategies.map((strategy, stratIdx) => (
                      <div
                        key={stratIdx}
                        className={`strategy-item priority-${strategy.priority}`}
                      >
                        <div className="strategy-header">
                          <span className="strategy-title">{strategy.strategy}</span>
                          <div className="strategy-badges">
                            <span className="priority-badge">{strategy.priority}</span>
                            <span className="effort-badge">{strategy.effort}</span>
                          </div>
                        </div>
                        <div className="strategy-rationale">
                          <strong>Rationale:</strong> {strategy.rationale}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Lessons Learned */}
                {diagnosis.lessons_learned.length > 0 && (
                  <div className="lessons-section">
                    <h4>Lessons Learned</h4>
                    <ul>
                      {diagnosis.lessons_learned.map((lesson, lessonIdx) => (
                        <li key={lessonIdx}>{lesson}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Raw Data (Collapsible) */}
                <details className="raw-data-section">
                  <summary>Raw Data</summary>
                  <pre className="raw-data">
                    {JSON.stringify(diagnosis, null, 2)}
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

export default FailureDiagnosisView;
