import { useMemo, useState } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';
import { Task } from '../services/dataService';
import ArtifactPreviewModal from './ArtifactPreviewModal';
import './TaskLifecyclePanel.css';

interface TaskLifecyclePanelProps {
  task: Task | null;
  onClose: () => void;
}

const TaskLifecyclePanel = ({ task, onClose }: TaskLifecyclePanelProps) => {
  const snapshot = useVisualizationStore((state) => state.snapshot);
  const getDecisionsUpToCurrentTime = useVisualizationStore((state) => state.getDecisionsUpToCurrentTime);
  const getArtifactsUpToCurrentTime = useVisualizationStore((state) => state.getArtifactsUpToCurrentTime);

  // State for artifact preview modal
  const [previewArtifact, setPreviewArtifact] = useState<{
    artifactId: string;
    filename: string;
    artifactType: string;
  } | null>(null);

  // Only show artifacts/decisions/messages that belong to this specific task
  const relevantTaskIds = useMemo(() => {
    if (!task) return new Set<string>();
    return new Set<string>([task.id]);
  }, [task]);

  // Get messages related to this task
  const taskMessages = useMemo(() => {
    if (!task || !snapshot) return [];
    return snapshot.messages
      .filter(msg => msg.task_id && relevantTaskIds.has(msg.task_id))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [task, snapshot, relevantTaskIds]);

  // Get timeline events for this task
  const taskEvents = useMemo(() => {
    if (!task || !snapshot) return [];
    return snapshot.timeline_events
      .filter(event => event.task_id && relevantTaskIds.has(event.task_id))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [task, snapshot, relevantTaskIds]);

  // Get decisions for this task (filtered by timeline)
  const taskDecisions = useMemo(() => {
    if (!task) return [];
    const decisions = getDecisionsUpToCurrentTime();
    return decisions
      .filter(decision => relevantTaskIds.has(decision.task_id))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [task, relevantTaskIds, getDecisionsUpToCurrentTime]);

  // Get artifacts for this task (filtered by timeline)
  const taskArtifacts = useMemo(() => {
    if (!task) return [];
    const artifacts = getArtifactsUpToCurrentTime();
    return artifacts
      .filter(artifact => relevantTaskIds.has(artifact.task_id))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [task, relevantTaskIds, getArtifactsUpToCurrentTime]);

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
    if (!snapshot.start_time) return '0m';
    const date = new Date(timestamp);
    const startTime = new Date(snapshot.start_time);
    const diffMinutes = (date.getTime() - startTime.getTime()) / 60000;
    return `${Math.round(diffMinutes)}m`;
  };

  const formatDate = (timestamp: string | null) => {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    // Format with timezone abbreviation (e.g., "Oct 23, 2025, 1:53 AM PDT")
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    });
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

  // Calculate diagnostic flags
  const isZombie = task.status === 'in_progress' && !task.assigned_agent_id;
  const isBottleneck = task.dependent_task_ids.length >= 3;

  // Helper function for confidence color gradient
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return '#10b981'; // green
    if (confidence >= 0.6) return '#3b82f6'; // blue
    if (confidence >= 0.4) return '#f59e0b'; // amber
    return '#ef4444'; // red
  };

  // Helper function for artifact icon
  const getArtifactIcon = (artifactType: string) => {
    switch (artifactType.toLowerCase()) {
      case 'specification':
      case 'design':
        return '📄';
      case 'api':
      case 'code':
        return '🔧';
      case 'data':
      case 'analysis':
        return '📊';
      case 'documentation':
        return '📋';
      default:
        return '📦';
    }
  };

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
              <span className="timeline-value">{Math.round(task.estimated_hours * 60)}m</span>
            </div>
            <div className="timeline-item">
              <span className="timeline-label">Actual:</span>
              <span className="timeline-value">{Math.round(task.actual_hours * 60)}m</span>
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

        {/* Artifacts */}
        {taskArtifacts.length > 0 && (
          <section className="panel-section">
            <h3 className="section-title">📦 Artifacts Produced ({taskArtifacts.length})</h3>
            <div className="artifacts-list">
              {taskArtifacts.map(artifact => (
                <div
                  key={artifact.artifact_id}
                  className="artifact-card artifact-card-clickable"
                  onClick={() => setPreviewArtifact({
                    artifactId: artifact.artifact_id,
                    filename: artifact.filename,
                    artifactType: artifact.artifact_type
                  })}
                >
                  <div className="artifact-header">
                    <div className="artifact-title">
                      <span className="artifact-icon">{getArtifactIcon(artifact.artifact_type)}</span>
                      <span className="artifact-filename">{artifact.filename}</span>
                      <span className="preview-hint">👁️ Click to preview</span>
                    </div>
                    <div className="artifact-meta">
                      <span className="artifact-type">{artifact.artifact_type}</span>
                      <span className="artifact-agent">{artifact.agent_name}</span>
                    </div>
                  </div>
                  <div className="artifact-body">
                    <div className="artifact-info">
                      <span className="artifact-time">{formatTime(artifact.timestamp)}</span>
                      <span className="artifact-size">
                        {(artifact.file_size_bytes / 1024).toFixed(1)} KB
                      </span>
                    </div>
                    {artifact.description && (
                      <div className="artifact-description">{artifact.description}</div>
                    )}
                    {artifact.referenced_by_tasks.length > 0 && (
                      <div className="artifact-section">
                        <span className="artifact-label">Referenced by:</span>
                        <div className="referenced-tasks">
                          {artifact.referenced_by_tasks.map(taskId => {
                            const referencedTask = snapshot.tasks.find(t => t.id === taskId);
                            return (
                              <span key={taskId} className="referenced-task-chip">
                                {referencedTask?.name || taskId}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Decisions */}
        {taskDecisions.length > 0 && (
          <section className="panel-section">
            <h3 className="section-title">📋 Decisions Made ({taskDecisions.length})</h3>
            <div className="decisions-list">
              {taskDecisions.map(decision => (
                <div key={decision.decision_id} className="decision-card">
                  <div className="decision-header">
                    <div className="decision-title">{decision.what}</div>
                    <div className="decision-meta">
                      <span className="decision-agent">{decision.agent_name}</span>
                      <span className="decision-time">{formatTime(decision.timestamp)}</span>
                    </div>
                  </div>
                  <div className="decision-body">
                    <div className="decision-section">
                      <span className="decision-label">Why:</span>
                      <span className="decision-text">{decision.why}</span>
                    </div>
                    <div className="decision-section">
                      <span className="decision-label">Impact:</span>
                      <span className="decision-text">{decision.impact}</span>
                    </div>
                    <div className="decision-confidence">
                      <span className="decision-label">Confidence:</span>
                      <div className="confidence-bar-container">
                        <div
                          className="confidence-bar"
                          style={{
                            width: `${decision.confidence * 100}%`,
                            backgroundColor: getConfidenceColor(decision.confidence)
                          }}
                        />
                      </div>
                      <span className="confidence-text">{Math.round(decision.confidence * 100)}%</span>
                    </div>
                    {decision.affected_tasks.length > 0 && (
                      <div className="decision-section">
                        <span className="decision-label">Affects:</span>
                        <div className="affected-tasks">
                          {decision.affected_tasks.map(taskId => {
                            const affectedTask = snapshot.tasks.find(t => t.id === taskId);
                            return (
                              <span key={taskId} className="affected-task-chip">
                                {affectedTask?.name || taskId}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
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
                    {msg.from_agent_name} → {msg.to_agent_name}
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

      {/* Artifact Preview Modal */}
      {previewArtifact && (
        <ArtifactPreviewModal
          artifactId={previewArtifact.artifactId}
          filename={previewArtifact.filename}
          artifactType={previewArtifact.artifactType}
          onClose={() => setPreviewArtifact(null)}
        />
      )}
    </div>
  );
};

export default TaskLifecyclePanel;
