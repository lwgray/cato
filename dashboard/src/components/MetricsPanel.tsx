import { useVisualizationStore } from '../store/visualizationStore';
import './MetricsPanel.css';

const MetricsPanel = () => {
  const snapshot = useVisualizationStore((state) => state.snapshot);
  const getMetrics = useVisualizationStore((state) => state.getMetrics);
  const activeAgents = useVisualizationStore((state) => state.getActiveAgentsAtCurrentTime());

  const metrics = getMetrics();

  if (!snapshot || !metrics) {
    return (
      <div className="metrics-panel">
        <div className="panel-header">
          <h3>📊 Metrics Dashboard</h3>
        </div>
        <div className="metrics-content">
          <div className="no-data">No metrics available</div>
        </div>
      </div>
    );
  }

  return (
    <div className="metrics-panel">
      <div className="panel-header">
        <h3>📊 Metrics Dashboard</h3>
      </div>

      <div className="metrics-content">
        {/* Project Overview */}
        <div className="metric-section">
          <h4>Project Overview</h4>
          <div className="metric-item">
            <span className="metric-label">Project Name</span>
            <span className="metric-value">{snapshot.project_name}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Total Duration</span>
            <span className="metric-value">{snapshot.duration_minutes}m</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Tasks Completed</span>
            <span className="metric-value highlight">
              {metrics.completed_tasks}/{metrics.total_tasks}
            </span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Completion Rate</span>
            <span className="metric-value highlight">
              {(metrics.completion_rate * 100).toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Parallelization Metrics */}
        <div className="metric-section highlight-section">
          <h4>⚡ Parallelization</h4>
          <div className="metric-item large">
            <span className="metric-label">Peak Parallel Tasks</span>
            <span className="metric-value speedup">
              {metrics.peak_parallel_tasks}
            </span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Average Parallel</span>
            <span className="metric-value">{metrics.average_parallel_tasks.toFixed(1)}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Parallelization Efficiency</span>
            <span className="metric-value highlight">
              {(metrics.parallelization_efficiency * 100).toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Time Metrics */}
        <div className="metric-section">
          <h4>⏱️ Time Metrics</h4>
          <div className="metric-item">
            <span className="metric-label">Total Duration</span>
            <span className="metric-value">{metrics.total_duration_minutes}m</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Avg Task Duration</span>
            <span className="metric-value">{metrics.average_task_duration_hours.toFixed(1)}m</span>
          </div>
        </div>

        {/* Agent Metrics */}
        <div className="metric-section">
          <h4>👥 Agent Metrics</h4>
          <div className="metric-item">
            <span className="metric-label">Total Agents</span>
            <span className="metric-value">{metrics.total_agents}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Active Agents</span>
            <span className="metric-value">{metrics.active_agents}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Tasks per Agent</span>
            <span className="metric-value">{metrics.tasks_per_agent.toFixed(1)}</span>
          </div>
        </div>

        {/* Communication Metrics */}
        <div className="metric-section">
          <h4>💬 Communication</h4>
          <div className="metric-item">
            <span className="metric-label">Total Messages</span>
            <span className="metric-value">{snapshot.messages.length}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Blockers Reported</span>
            <span className={`metric-value ${metrics.total_blockers > 0 ? 'warning' : 'good'}`}>
              {metrics.total_blockers}
            </span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Blocked Tasks</span>
            <span className={`metric-value ${metrics.blocked_tasks > 0 ? 'warning' : 'good'}`}>
              {metrics.blocked_tasks} ({(metrics.blocked_task_percentage * 100).toFixed(1)}%)
            </span>
          </div>
        </div>

        {/* Active Agents */}
        <div className="metric-section">
          <h4>👥 Currently Active</h4>
          {activeAgents.length > 0 ? (
            activeAgents.map((agent) => (
              <div key={agent.id} className="active-agent-item">
                <span className="agent-icon">🔵</span>
                <span className="agent-name">{agent.name}</span>
                <span className="agent-role">{agent.role}</span>
              </div>
            ))
          ) : (
            <div className="no-active-agents">No active agents at this time</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MetricsPanel;
