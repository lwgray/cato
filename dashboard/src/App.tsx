import { useEffect } from 'react';
import { useVisualizationStore } from './store/visualizationStore';
import NetworkGraphView from './components/NetworkGraphView';
import AgentSwimLanesView from './components/AgentSwimLanesView';
import ConversationView from './components/ConversationView';
import HealthCheckDashboard from './components/HealthCheckDashboard';
import QualityDashboard from './components/QualityDashboard';
import BoardView from './components/BoardView';
import TimelineControls from './components/TimelineControls';
import MetricsPanel from './components/MetricsPanel';
import ProjectInfoDrawer from './components/ProjectInfoDrawer';
import HeaderControls from './components/HeaderControls';
import TaskLifecyclePanel from './components/TaskLifecyclePanel';
import './App.css';

function App() {
  const currentLayer = useVisualizationStore((state) => state.currentLayer);
  const setCurrentLayer = useVisualizationStore((state) => state.setCurrentLayer);
  const isProjectInfoOpen = useVisualizationStore((state) => state.isProjectInfoOpen);
  const toggleProjectInfo = useVisualizationStore((state) => state.toggleProjectInfo);
  const contextTasks = useVisualizationStore((state) => state.getContextTasks());
  const snapshot = useVisualizationStore((state) => state.snapshot);
  const lifecycleTask = useVisualizationStore((state) => state.lifecycleTask);
  const setLifecycleTask = useVisualizationStore((state) => state.setLifecycleTask);

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
            className={currentLayer === 'board' ? 'active' : ''}
            onClick={() => setCurrentLayer('board')}
          >
            📋 Board
          </button>
          <button
            className={currentLayer === 'health' ? 'active' : ''}
            onClick={() => setCurrentLayer('health')}
          >
            🏥 Health Check
          </button>
          {snapshot?.quality_assessment && (
            <button
              className={currentLayer === 'quality' ? 'active' : ''}
              onClick={() => setCurrentLayer('quality')}
            >
              Quality
            </button>
          )}
          {contextTasks.length > 0 && (
            <button
              className={`project-info-trigger ${isProjectInfoOpen ? 'active' : ''}`}
              onClick={toggleProjectInfo}
              title="Project Info"
            >
              ℹ Project Info
            </button>
          )}
        </div>
      </header>

      <div className="app-content">
        <div className={`visualization-container ${currentLayer === 'quality' || currentLayer === 'board' ? 'full-width' : ''}`}>
          {/* Live mode views */}
          {currentLayer === 'network' && <NetworkGraphView />}
          {currentLayer === 'swimlanes' && <AgentSwimLanesView />}
          {currentLayer === 'conversations' && <ConversationView />}
          {currentLayer === 'board' && <BoardView />}
          {currentLayer === 'health' && <HealthCheckDashboard />}
          {currentLayer === 'quality' && <QualityDashboard />}
        </div>

        {/* Task Lifecycle Panel — inline sidebar, pushes content left */}
        {lifecycleTask && (
          <TaskLifecyclePanel
            task={lifecycleTask}
            onClose={() => setLifecycleTask(null)}
          />
        )}

        {/* Metrics panel — hidden on Quality tab and when lifecycle panel is open */}
        {currentLayer !== 'quality' && !lifecycleTask && <MetricsPanel />}

        {/* Project Info drawer */}
        <ProjectInfoDrawer />
      </div>

      {/* Timeline controls — hidden on Quality tab */}
      {currentLayer !== 'quality' && <TimelineControls />}
    </div>
  );
}

export default App;
