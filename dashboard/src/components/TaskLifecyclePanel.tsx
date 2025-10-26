import { useMemo } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';
import { Task } from '../services/dataService';
import './TaskLifecyclePanel.css';

interface TaskLifecyclePanelProps {
  task: Task | null;
  onClose: () => void;
}

const TaskLifecyclePanel = ({ task, onClose }: TaskLifecyclePanelProps) => {
  const snapshot = useVisualizationStore((state) => state.snapshot);
  const currentTime = useVisualizationStore((state) => state.currentTime);

  // Get messages related to this task
  const taskMessages = useMemo(() => {
    if (!task || !snapshot) return [];
    return snapshot.messages
      .filter(msg => msg.task_id === task.id)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [task, snapshot]);

  // Get timeline events for this task
  const taskEvents = useMemo(() => {
    if (!task || !snapshot) return [];
    return snapshot.timeline_events
      .filter(event => event.task_id === task.id)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [task, snapshot]);

  // Get dependent tasks
  const dependentTasks = useMemo(() => {
    if (!task || !snapshot) return [];
    return snapshot.tasks.filter(t => task.dependent_task_ids.includes(t.id));
  }, [task, snapshot]);

  // Get dependency tasks
  const dependencyTasks = useMemo(() => {
    if (!task || !snapshot) return [];
    return snapshot.tasks.filter(t => task.dependency_ids.includes(t.id));
  }, [task, snapshot]);

  if (!task || !snapshot) return null;

  const formatTime = (timestamp: string) => {
    if (!snapshot.start_time) return '0h';
    const date = new Date(timestamp);
    const startTime = new Date(snapshot.start_time);
    const diffHours = (date.getTime() - startTime.getTime()) / 3600000;
    return `${diffHours.toFixed(1)}h`;
  };

  const formatDate = (timestamp: string | null) => {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'done': return 'status-done';
      case 'in_progress': return 'status-in-progress';
      case 'blocked': return 'status-blocked';
      case 'todo': return 'status-todo';
      default: return '';
    }
  };

  const getPriorityBadgeClass = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'priority-urgent';
      case 'high': return 'priority-high';
      case 'medium': return 'priority-medium';
      case 'low': return 'priority-low';
      default: return '';
    }
  };

  const formatAgentName = (agentName: string) => {
    // Convert "system" or "marcus" to "Marcus" (capitalized)
    if (!agentName) return 'Unknown';
    const lowerName = agentName.toLowerCase();
    if (lowerName === 'system' || lowerName === 'marcus') {
      return 'Marcus';
    }
    return agentName;
  };

  // Calculate diagnostic flags
  const isZombie = task.status === 'in_progress' && !task.assigned_agent_id;
  const isBottleneck = task.dependent_task_ids.length >= 3;

  return (
    <div className="task-lifecycle-panel">
      <div className="panel-header">
        <div className="panel-title-section">
          <h2 className="panel-title">{task.name}</h2>
          <div className="task-badges">
            <span className={`status-badge ${getStatusBadgeClass(task.status)}`}>
              {task.status.replace('_', ' ')}
            </span>
            <span className={`priority-badge ${getPriorityBadgeClass(task.priority)}`}>
              {task.priority}
            </span>
            {isZombie && (
              <span className="diagnostic-badge zombie-badge" title="IN_PROGRESS but no agent assigned">
                🧟 Zombie
              </span>
            )}
            {isBottleneck && (
              <span className="diagnostic-badge bottleneck-badge" title="Blocking 3+ tasks">
                🚧 Bottleneck
              </span>
            )}
          </div>
        </div>
        <button className="close-button" onClick={onClose}>✕</button>
      </div>

      <div className="panel-content">
        {/* Basic Info */}
        <section className="panel-section">
          <h3 className="section-title">Overview</h3>
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Task ID:</span>
              <span className="info-value">{task.id}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Progress:</span>
              <div className="progress-bar-container">
                <div className="progress-bar" style={{ width: `${task.progress_percent}%` }}>
                  <span className="progress-text">{task.progress_percent}%</span>
                </div>
              </div>
            </div>
            <div className="info-item">
              <span className="info-label">Agent:</span>
              <span className="info-value">{task.assigned_agent_name || 'Unassigned'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Project:</span>
              <span className="info-value">{task.project_name}</span>
            </div>
            {task.parent_task_name && (
              <div className="info-item">
                <span className="info-label">Parent Task:</span>
                <span className="info-value">{task.parent_task_name}</span>
              </div>
            )}
          </div>
        </section>

        {/* Description */}
        {task.description && (
          <section className="panel-section">
            <h3 className="section-title">Description</h3>
            <p className="task-description">{task.description}</p>
          </section>
        )}

        {/* Timeline */}
        <section className="panel-section">
          <h3 className="section-title">Timeline</h3>
          <div className="timeline-grid">
            <div className="timeline-item">
              <span className="timeline-label">Created:</span>
              <span className="timeline-value">{formatDate(task.created_at)}</span>
            </div>
            <div className="timeline-item">
              <span className="timeline-label">Started:</span>
              <span className="timeline-value">{formatDate(task.started_at)}</span>
            </div>
            <div className="timeline-item">
              <span className="timeline-label">Completed:</span>
              <span className="timeline-value">{formatDate(task.completed_at)}</span>
            </div>
            <div className="timeline-item">
              <span className="timeline-label">Estimated:</span>
              <span className="timeline-value">{task.estimated_hours}h</span>
            </div>
            <div className="timeline-item">
              <span className="timeline-label">Actual:</span>
              <span className="timeline-value">{task.actual_hours}h</span>
            </div>
          </div>
        </section>

        {/* Dependencies */}
        {(dependencyTasks.length > 0 || dependentTasks.length > 0) && (
          <section className="panel-section">
            <h3 className="section-title">Dependencies</h3>
            {dependencyTasks.length > 0 && (
              <div className="dependency-group">
                <h4 className="dependency-title">Depends On ({dependencyTasks.length}):</h4>
                <div className="dependency-list">
                  {dependencyTasks.map(dep => (
                    <div key={dep.id} className="dependency-item">
                      <span className={`dep-status ${getStatusBadgeClass(dep.status)}`}>●</span>
                      <span className="dep-name">{dep.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {dependentTasks.length > 0 && (
              <div className="dependency-group">
                <h4 className="dependency-title">Blocking ({dependentTasks.length}):</h4>
                <div className="dependency-list">
                  {dependentTasks.map(dep => (
                    <div key={dep.id} className="dependency-item">
                      <span className={`dep-status ${getStatusBadgeClass(dep.status)}`}>●</span>
                      <span className="dep-name">{dep.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Events */}
        {taskEvents.length > 0 && (
          <section className="panel-section">
            <h3 className="section-title">Events ({taskEvents.length})</h3>
            <div className="events-list">
              {taskEvents.map(event => (
                <div key={event.id} className="event-item">
                  <span className="event-time">{formatTime(event.timestamp)}</span>
                  <span className="event-type">{event.event_type}</span>
                  {event.agent_name && (
                    <span className="event-agent">by {event.agent_name}</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Messages */}
        {taskMessages.length > 0 && (
          <section className="panel-section">
            <h3 className="section-title">Messages ({taskMessages.length})</h3>
            <div className="messages-list">
              {taskMessages.map(msg => (
                <div key={msg.id} className="message-item">
                  <div className="message-header-small">
                    <span className="message-time-small">{formatTime(msg.timestamp)}</span>
                    <span className="message-type-small">{msg.type}</span>
                  </div>
                  <div className="message-sender-small">
                    {formatAgentName(msg.from_agent_name)} → {formatAgentName(msg.to_agent_name)}
                  </div>
                  <div className="message-content-small">{msg.message}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Labels */}
        {task.labels && task.labels.length > 0 && (
          <section className="panel-section">
            <h3 className="section-title">Labels</h3>
            <div className="labels-list">
              {task.labels.map((label, idx) => (
                <span key={idx} className="label-tag">{label}</span>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default TaskLifecyclePanel;
