import { useEffect } from 'react';
import { useVisualizationStore } from './store/visualizationStore';
import NetworkGraphView from './components/NetworkGraphView';
import AgentSwimLanesView from './components/AgentSwimLanesView';
import ConversationView from './components/ConversationView';
import HealthCheckDashboard from './components/HealthCheckDashboard';
import TimelineControls from './components/TimelineControls';
import MetricsPanel from './components/MetricsPanel';
import TaskDetailPanel from './components/TaskDetailPanel';
import HeaderControls from './components/HeaderControls';
import './App.css';

function App() {
  const currentLayer = useVisualizationStore((state) => state.currentLayer);
  const setCurrentLayer = useVisualizationStore((state) => state.setCurrentLayer);
  const selectedTaskId = useVisualizationStore((state) => state.selectedTaskId);

  // Actions for initialization
  const loadData = useVisualizationStore((state) => state.loadData);
  const loadProjects = useVisualizationStore((state) => state.loadProjects);

  // Load projects and data on mount
  useEffect(() => {
    const mode = (import.meta.env.VITE_DATA_MODE || 'mock') as 'live' | 'mock';

    // Load projects first if in live mode
    if (mode === 'live') {
      loadProjects().then(() => {
        loadData(mode);
      });
    } else {
      loadData(mode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  return (
    <div className="app">
      <header className="app-header">
        <HeaderControls />
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
          {currentLayer === 'network' && <NetworkGraphView />}
          {currentLayer === 'swimlanes' && <AgentSwimLanesView />}
          {currentLayer === 'conversations' && <ConversationView />}
          {currentLayer === 'health' && <HealthCheckDashboard />}
        </div>

        {selectedTaskId && <TaskDetailPanel />}

        <MetricsPanel />
      </div>

      <TimelineControls />
    </div>
  );
}

export default App;
