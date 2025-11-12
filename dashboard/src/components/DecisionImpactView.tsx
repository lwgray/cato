import { useState, useEffect } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';
import './DecisionImpactView.css';

interface ImpactChain {
  decision_summary: string;
  direct_impacts: string[];
  indirect_impacts: string[];
  depth: number;
  citation: string;
}

interface UnexpectedImpact {
  affected_task: string;
  anticipated: string;
  actual_impact: string;
  severity: string;
}

interface DecisionImpact {
  decision_id: string;
  impact_chains: ImpactChain[];
  unexpected_impacts: UnexpectedImpact[];
  recommendations: string[];
}

interface DecisionImpactViewProps {
  projectId: string;
}

/**
 * Decision Impact View Component
 *
 * Visualizes decision impact chains showing how architectural decisions
 * affected tasks. Displays direct/indirect impacts and unexpected impacts.
 */
const DecisionImpactView = ({ projectId: _projectId }: DecisionImpactViewProps) => {
  const historicalAnalysis = useVisualizationStore((state) => state.historicalAnalysis);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (historicalAnalysis) {
      setLoading(false);
    }
  }, [historicalAnalysis]);

  if (loading) {
    return (
      <div className="decision-impact-view loading">
        <div className="loading-spinner">Loading decision impact analysis...</div>
      </div>
    );
  }

  if (!historicalAnalysis || !historicalAnalysis.decision_impacts) {
    return (
      <div className="decision-impact-view empty">
        <div className="empty-state">
          <h3>No Decision Impact Data</h3>
          <p>
            Decision impact analysis is not available for this project.
          </p>
        </div>
      </div>
    );
  }

  const impacts: DecisionImpact[] = historicalAnalysis.decision_impacts;

  // Calculate metrics
  const totalUnexpectedImpacts = impacts.reduce(
    (sum, d) => sum + d.unexpected_impacts.length,
    0
  );
  const maxDepth = Math.max(
    ...impacts.flatMap((d) => d.impact_chains.map((ic) => ic.depth)),
    0
  );

  return (
    <div className="decision-impact-view">
      <div className="view-header">
        <h2>Decision Impact Analysis</h2>
        <p>
          Traces how architectural decisions affected tasks throughout the project
        </p>
      </div>

      {/* Overall Metrics */}
      <section className="impact-metrics">
        <div className="metric-card">
          <div className="metric-icon">🔀</div>
          <div className="metric-content">
            <div className="metric-label">Decisions Analyzed</div>
            <div className="metric-value">{impacts.length}</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon">⚠️</div>
          <div className="metric-content">
            <div className="metric-label">Unexpected Impacts</div>
            <div className="metric-value">{totalUnexpectedImpacts}</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon">🌊</div>
          <div className="metric-content">
            <div className="metric-label">Max Impact Depth</div>
            <div className="metric-value">{maxDepth}</div>
            <div className="metric-details">levels of cascading impact</div>
          </div>
        </div>
      </section>

      {/* Decision Impacts */}
      {impacts.length > 0 && (
        <section className="decision-impacts">
          <h3>Decision Impact Analysis ({impacts.length} decisions)</h3>
          <div className="impacts-list">
            {impacts.map((decision, idx) => (
              <div key={idx} className="impact-card">
                <div className="card-header">
                  <span className="decision-id">{decision.decision_id}</span>
                </div>

                {/* Impact Chains */}
                {decision.impact_chains.length > 0 && (
                  <div className="impact-chains-section">
                    <h4>Impact Chains ({decision.impact_chains.length})</h4>
                    {decision.impact_chains.map((chain, chainIdx) => (
                      <div key={chainIdx} className="impact-chain">
                        <div className="chain-header">
                          <span className="depth-badge">Depth: {chain.depth}</span>
                          <p className="decision-summary">{chain.decision_summary}</p>
                        </div>

                        {chain.direct_impacts.length > 0 && (
                          <div className="impacts-section direct">
                            <h5>Direct Impacts</h5>
                            <ul>
                              {chain.direct_impacts.map((impact, impactIdx) => (
                                <li key={impactIdx}>{impact}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {chain.indirect_impacts.length > 0 && (
                          <div className="impacts-section indirect">
                            <h5>Indirect Impacts</h5>
                            <ul>
                              {chain.indirect_impacts.map((impact, impactIdx) => (
                                <li key={impactIdx}>{impact}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {chain.citation && (
                          <div className="chain-citation">
                            <strong>Citation:</strong> {chain.citation}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Unexpected Impacts */}
                {decision.unexpected_impacts.length > 0 && (
                  <div className="unexpected-impacts-section">
                    <h4>
                      Unexpected Impacts ({decision.unexpected_impacts.length})
                    </h4>
                    {decision.unexpected_impacts.map((unexpected, unexpIdx) => (
                      <div
                        key={unexpIdx}
                        className={`unexpected-impact ${unexpected.severity}`}
                      >
                        <div className="unexpected-header">
                          <span className="affected-task">
                            {unexpected.affected_task}
                          </span>
                          <span className="severity-badge">
                            {unexpected.severity}
                          </span>
                        </div>
                        <div className="unexpected-content">
                          <div className="impact-field">
                            <strong>Anticipated:</strong>
                            <p>{unexpected.anticipated}</p>
                          </div>
                          <div className="impact-field">
                            <strong>Actual Impact:</strong>
                            <p>{unexpected.actual_impact}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Recommendations */}
                {decision.recommendations.length > 0 && (
                  <div className="recommendations">
                    <h4>Recommendations</h4>
                    <ul>
                      {decision.recommendations.map((rec, recIdx) => (
                        <li key={recIdx}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Raw Data (Collapsible) */}
                <details className="raw-data-section">
                  <summary>Raw Data</summary>
                  <pre className="raw-data">
                    {JSON.stringify(decision, null, 2)}
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

export default DecisionImpactView;
