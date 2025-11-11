import { useEffect } from 'react';
import { useVisualizationStore } from './store/visualizationStore';
import NetworkGraphView from './components/NetworkGraphView';
import AgentSwimLanesView from './components/AgentSwimLanesView';
import ConversationView from './components/ConversationView';
import HealthCheckDashboard from './components/HealthCheckDashboard';
import RetrospectiveDashboard from './components/RetrospectiveDashboard';
import TimelineControls from './components/TimelineControls';
import MetricsPanel from './components/MetricsPanel';
import HeaderControls from './components/HeaderControls';
import './App.css';

function App() {
  const currentLayer = useVisualizationStore((state) => state.currentLayer);
  const setCurrentLayer = useVisualizationStore((state) => state.setCurrentLayer);
  const viewMode = useVisualizationStore((state) => state.viewMode);

  // Actions for initialization
  const loadProjects = useVisualizationStore((state) => state.loadProjects);

  // Load projects and data on mount
  useEffect(() => {
    // Always use live mode - load projects first
    // loadProjects will auto-select first project and load its data
    // via setSelectedProject
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  return (
    <div className="app">
      <header className="app-header">
        <HeaderControls />

        {/* Conditional tabs based on mode */}
        {viewMode === 'live' ? (
          // Existing live mode tabs
          <div className="layer-tabs">
            <button
              className={currentLayer === 'network' ? 'active' : ''}
              onClick={() => setCurrentLayer('network')}
            >
              🔗 Network Graph
            </button>
            <button
              className={currentLayer === 'swimlanes' ? 'active' : ''}
              onClick={() => setCurrentLayer('swimlanes')}
            >
              📊 Agent Swim Lanes
            </button>
            <button
              className={currentLayer === 'conversations' ? 'active' : ''}
              onClick={() => setCurrentLayer('conversations')}
            >
              💬 Conversations
            </button>
            <button
              className={currentLayer === 'health' ? 'active' : ''}
              onClick={() => setCurrentLayer('health')}
            >
              🏥 Health Check
            </button>
          </div>
        ) : (
          // NEW: Historical mode tabs
          <div className="layer-tabs">
            <button
              className={currentLayer === 'retrospective' ? 'active' : ''}
              onClick={() => setCurrentLayer('retrospective')}
            >
              📈 Project Retrospective
            </button>
            <button
              className={currentLayer === 'fidelity' ? 'active' : ''}
              onClick={() => setCurrentLayer('fidelity')}
            >
              🎯 Requirement Fidelity
            </button>
            <button
              className={currentLayer === 'decisions' ? 'active' : ''}
              onClick={() => setCurrentLayer('decisions')}
            >
              🔀 Decision Impacts
            </button>
            <button
              className={currentLayer === 'failures' ? 'active' : ''}
              onClick={() => setCurrentLayer('failures')}
            >
              ⚠️ Failure Diagnosis
            </button>
          </div>
        )}
      </header>

      <div className="app-content">
        <div className="visualization-container">
          {/* Existing live mode views */}
          {viewMode === 'live' && currentLayer === 'network' && <NetworkGraphView />}
          {viewMode === 'live' && currentLayer === 'swimlanes' && <AgentSwimLanesView />}
          {viewMode === 'live' && currentLayer === 'conversations' && <ConversationView />}
          {viewMode === 'live' && currentLayer === 'health' && <HealthCheckDashboard />}

          {/* NEW: Historical mode views */}
          {viewMode === 'historical' && currentLayer === 'retrospective' && (
            <RetrospectiveDashboard />
          )}
          {viewMode === 'historical' && currentLayer === 'fidelity' && (
            <div>RequirementFidelityView component (coming next)</div>
          )}
          {viewMode === 'historical' && currentLayer === 'decisions' && (
            <div>DecisionImpactView component (coming next)</div>
          )}
          {viewMode === 'historical' && currentLayer === 'failures' && (
            <div>FailureDiagnosisView component (coming next)</div>
          )}
        </div>

        <MetricsPanel />
      </div>

      {/* Timeline controls (live mode only) */}
      {viewMode === 'live' && <TimelineControls />}
    </div>
  );
}

export default App;
