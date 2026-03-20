import { useEffect } from 'react';
import { useVisualizationStore } from './store/visualizationStore';
import NetworkGraphView from './components/NetworkGraphView';
import AgentSwimLanesView from './components/AgentSwimLanesView';
import ConversationView from './components/ConversationView';
import HealthCheckDashboard from './components/HealthCheckDashboard';
import TimelineControls from './components/TimelineControls';
import MetricsPanel from './components/MetricsPanel';
import HeaderControls from './components/HeaderControls';
import './App.css';

function App() {
  const currentLayer = useVisualizationStore((state) => state.currentLayer);
  const setCurrentLayer = useVisualizationStore((state) => state.setCurrentLayer);

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

        {/* Live mode tabs */}
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
      </header>

      <div className="app-content">
        <div className="visualization-container">
          {/* Live mode views */}
          {currentLayer === 'network' && <NetworkGraphView />}
          {currentLayer === 'swimlanes' && <AgentSwimLanesView />}
          {currentLayer === 'conversations' && <ConversationView />}
          {currentLayer === 'health' && <HealthCheckDashboard />}
        </div>

        {/* Metrics panel */}
        <MetricsPanel />
      </div>

      {/* Timeline controls */}
      <TimelineControls />
    </div>
  );
}

export default App;
