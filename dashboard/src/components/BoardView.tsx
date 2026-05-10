import { useState, useMemo } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';
import { Task } from '../services/dataService';
import { getTaskStateAtTime } from '../utils/timelineUtils';
import ArtifactPreviewModal from './ArtifactPreviewModal';
import ViewModeToggle from './ViewModeToggle';
import './BoardView.css';

const COLUMNS: { key: Task['status']; label: string; color: string; icon: string }[] = [
  { key: 'todo', label: 'Backlog', color: '#eab308', icon: '📋' },
  { key: 'in_progress', label: 'In Progress', color: '#3b82f6', icon: '⚡' },
  { key: 'blocked', label: 'Blocked', color: '#ef4444', icon: '🚫' },
  { key: 'done', label: 'Done', color: '#10b981', icon: '✓' },
];

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#64748b',
};

const BoardView = () => {
  const snapshot = useVisualizationStore((state) => state.snapshot);
  const currentTime = useVisualizationStore((state) => state.currentTime);
  const messages = useVisualizationStore((state) => state.getMessagesUpToCurrentTime());
  const getDecisionsUpToCurrentTime = useVisualizationStore((state) => state.getDecisionsUpToCurrentTime);
  const getArtifactsUpToCurrentTime = useVisualizationStore((state) => state.getArtifactsUpToCurrentTime);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [previewArtifact, setPreviewArtifact] = useState<{
    artifactId: string;
    filename: string;
    artifactType: string;
  } | null>(null);

  const { grouped, metrics, parentProgress } = useMemo(() => {
    if (!snapshot || !snapshot.start_time) {
      return {
        grouped: { todo: [], in_progress: [], blocked: [], done: [] } as Record<Task['status'], Task[]>,
        metrics: { total: 0, done: 0, blocked: 0, pct: 0, agents: 0 },
        parentProgress: new Map<string, { name: string; done: number; total: number }>(),
      };
    }

    const startTime = new Date(snapshot.start_time).getTime();
    const currentAbsTime = startTime + currentTime;

    const g: Record<Task['status'], Task[]> = {
      todo: [],
      in_progress: [],
      blocked: [],
      done: [],
    };

    const workTasks = snapshot.tasks.filter(
      (t) => (t.display_role || 'work') === 'work'
    );

    for (const task of workTasks) {
      const state = getTaskStateAtTime(task, currentAbsTime);
      const status = state.status as Task['status'];
      if (g[status]) {
        g[status].push(task);
      }
    }

    const total = workTasks.length;
    const done = g.done.length;
    const blocked = g.blocked.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const agents = new Set(
      g.in_progress
        .map((t) => t.assigned_agent_id)
        .filter(Boolean)
    ).size;

    // Build cross-column parent progress map (done/total across ALL statuses)
    const parentProgress = new Map<string, { name: string; done: number; total: number }>();
    for (const task of workTasks) {
      if (!task.parent_task_id) continue;
      const state = getTaskStateAtTime(task, currentAbsTime);
      const pid = task.parent_task_id;
      if (!parentProgress.has(pid)) {
        parentProgress.set(pid, {
          name: task.parent_task_name || 'Parent Task',
          done: 0,
          total: 0,
        });
      }
      const entry = parentProgress.get(pid)!;
      entry.total++;
      if (state.status === 'done') entry.done++;
    }

    return {
      grouped: g,
      metrics: { total, done, blocked, pct, agents },
      parentProgress,
    };
  }, [snapshot, currentTime]);

  const selectedTask = useMemo(() => {
    if (!selectedCard || !snapshot) return null;
    return snapshot.tasks.find((t) => t.id === selectedCard) || null;
  }, [selectedCard, snapshot]);

  const taskMessages = useMemo(() => {
    if (!selectedCard) return [];
    return messages.filter((m) => m.task_id === selectedCard);
  }, [selectedCard, messages]);

  const taskDecisions = useMemo(() => {
    if (!selectedCard) return [];
    const task = snapshot?.tasks.find((t) => t.id === selectedCard);
    const relevantIds = new Set([selectedCard]);
    if (task?.parent_task_id) relevantIds.add(task.parent_task_id);
    return getDecisionsUpToCurrentTime()
      .filter((d) => relevantIds.has(d.task_id))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [selectedCard, snapshot, getDecisionsUpToCurrentTime]);

  const taskArtifacts = useMemo(() => {
    if (!selectedCard) return [];
    const task = snapshot?.tasks.find((t) => t.id === selectedCard);
    const relevantIds = new Set([selectedCard]);
    if (task?.parent_task_id) relevantIds.add(task.parent_task_id);
    return getArtifactsUpToCurrentTime()
      .filter((a) => relevantIds.has(a.task_id))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [selectedCard, snapshot, getArtifactsUpToCurrentTime]);

  const subtasks = useMemo(() => {
    if (!selectedCard || !snapshot) return [];
    return snapshot.tasks.filter((t) => t.parent_task_id === selectedCard);
  }, [selectedCard, snapshot]);

  if (!snapshot) {
    return (
      <div className="board-view">
        <ViewModeToggle />
        <div className="board-empty">No data available</div>
      </div>
    );
  }

  const formatTime = (timestamp: string) => {
    if (!snapshot.start_time) return timestamp;
    const start = new Date(snapshot.start_time).getTime();
    const t = new Date(timestamp).getTime();
    const diffMin = Math.round((t - start) / 60000);
    if (diffMin < 60) return `${diffMin}m`;
    const hours = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    return `${hours}h${mins > 0 ? ` ${mins}m` : ''}`;
  };

  const toggleExpanded = (parentId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  };

  const renderCard = (task: Task, col: typeof COLUMNS[number]) => (
    <div
      key={task.id}
      className={`board-card ${selectedCard === task.id ? 'selected' : ''}`}
      style={{
        borderLeftColor:
          task.assigned_agent_id
            ? agentColor(task.assigned_agent_id, snapshot.agents)
            : col.color,
      }}
      onClick={() =>
        setSelectedCard(selectedCard === task.id ? null : task.id)
      }
    >
      <div className="card-header">
        <span className="card-id">#{task.id.substring(0, 8)}</span>
        <span
          className="card-priority"
          style={{ color: PRIORITY_COLORS[task.priority] || '#64748b' }}
        >
          {task.priority === 'urgent' || task.priority === 'high'
            ? task.priority.toUpperCase()
            : ''}
        </span>
      </div>
      <div className="card-name">{task.name}</div>
      {task.description && (
        <div className="card-desc">
          {task.description.split('\n')[0].replace(/^[#*]+\s*/, '').slice(0, 80)}
          {task.description.split('\n')[0].length > 80 ? '…' : ''}
        </div>
      )}
      <div className="card-meta">
        {task.assigned_agent_name && (
          <span className="card-agent">{task.assigned_agent_name}</span>
        )}
        {task.estimated_hours > 0 && (
          <span className="card-hours">
            {Math.round(task.estimated_hours * 60)}m
          </span>
        )}
      </div>
      {task.progress_percent > 0 && task.progress_percent < 100 && (
        <div className="card-progress-bar">
          <div
            className="card-progress-fill"
            style={{
              width: `${task.progress_percent}%`,
              backgroundColor: col.color,
            }}
          />
        </div>
      )}
      {task.labels.length > 0 && (
        <div className="card-labels">
          {task.labels.slice(0, 3).map((lbl) => (
            <span key={lbl} className="card-label">{lbl}</span>
          ))}
          {task.labels.length > 3 && (
            <span className="card-label card-label-more">
              +{task.labels.length - 3}
            </span>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className={`board-view ${selectedTask ? 'with-detail' : ''}`}>
      <ViewModeToggle />
      {/* Board columns */}
      <div className="board-columns">
        {COLUMNS.map((col) => {
          const tasks = grouped[col.key];

          const standalone = tasks.filter((t) => !t.parent_task_id);
          const byParent = new Map<string, Task[]>();
          for (const t of tasks) {
            if (!t.parent_task_id) continue;
            const pid = t.parent_task_id;
            if (!byParent.has(pid)) byParent.set(pid, []);
            byParent.get(pid)!.push(t);
          }

          return (
            <div key={col.key} className="board-column">
              <div
                className="column-header"
                style={{ borderBottomColor: col.color }}
              >
                <span className="column-icon">{col.icon}</span>
                <span className="column-label">{col.label}</span>
                <span
                  className="column-count"
                  style={{ backgroundColor: col.color }}
                >
                  {tasks.length}
                </span>
              </div>

              <div className="column-cards">
                {tasks.length === 0 && (
                  <div className="card-empty">No tasks</div>
                )}

                {/* Standalone tasks (no parent) */}
                {standalone.map((task) => renderCard(task, col))}

                {/* Subtask groups */}
                {Array.from(byParent.entries()).map(([parentId, ptasks]) => {
                  const MAX_VISIBLE = 3;
                  const prog = parentProgress.get(parentId);
                  const name =
                    prog?.name ?? ptasks[0]?.parent_task_name ?? 'Parent Task';
                  const done = prog?.done ?? 0;
                  const total = prog?.total ?? ptasks.length;
                  const pct = total > 0 ? (done / total) * 100 : 0;
                  const isExpanded = expandedGroups.has(parentId);
                  // Truncate based on this column's card count, not cross-column total
                  const visibleCards = isExpanded ? ptasks : ptasks.slice(0, MAX_VISIBLE);
                  const hiddenCount = ptasks.length - MAX_VISIBLE;

                  return (
                    <div key={parentId} className="parent-group">
                      <div className="parent-group-header">
                        <span className="parent-group-name">{name}</span>
                        <span
                          className={`parent-group-badge ${done === total ? 'all-done' : ''}`}
                        >
                          {done}/{total} ✓
                        </span>
                      </div>
                      <div className="parent-group-pbar">
                        <div
                          className="parent-group-pbar-fill"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="parent-group-cards">
                        {visibleCards.map((task) => renderCard(task, col))}
                      </div>
                      {ptasks.length > MAX_VISIBLE && (
                        <button
                          className={`parent-group-expand ${isExpanded ? 'expanded' : ''}`}
                          onClick={() => toggleExpanded(parentId)}
                        >
                          {isExpanded
                            ? '▴  Show less'
                            : `▾  Show ${hiddenCount} more task${hiddenCount !== 1 ? 's' : ''}…`}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail panel (slides in on card click) */}
      {selectedTask && (
        <div className="board-detail">
          <div className="detail-header">
            <h3>{selectedTask.name}</h3>
            <button
              className="detail-close"
              onClick={() => setSelectedCard(null)}
            >
              ✕
            </button>
          </div>

          <div className="detail-body">
            {/* Status & assignment */}
            <div className="detail-section">
              <div className="detail-row">
                <span className="detail-label">Status</span>
                <span
                  className="detail-status-badge"
                  style={{
                    backgroundColor:
                      COLUMNS.find((c) => c.key === selectedTask.status)
                        ?.color || '#64748b',
                  }}
                >
                  {selectedTask.status.replace('_', ' ')}
                </span>
              </div>
              {selectedTask.assigned_agent_name && (
                <div className="detail-row">
                  <span className="detail-label">Agent</span>
                  <span className="detail-value">
                    {selectedTask.assigned_agent_name}
                  </span>
                </div>
              )}
              <div className="detail-row">
                <span className="detail-label">Priority</span>
                <span
                  className="detail-value"
                  style={{
                    color: PRIORITY_COLORS[selectedTask.priority] || '#94a3b8',
                  }}
                >
                  {selectedTask.priority.toUpperCase()}
                </span>
              </div>
              {selectedTask.estimated_hours > 0 && (
                <div className="detail-row">
                  <span className="detail-label">Estimate</span>
                  <span className="detail-value">
                    {Math.round(selectedTask.estimated_hours * 60)}m
                  </span>
                </div>
              )}
              {selectedTask.progress_percent > 0 && (
                <div className="detail-row">
                  <span className="detail-label">Progress</span>
                  <div className="detail-progress">
                    <div className="detail-progress-bar">
                      <div
                        className="detail-progress-fill"
                        style={{
                          width: `${selectedTask.progress_percent}%`,
                        }}
                      />
                    </div>
                    <span className="detail-progress-text">
                      {selectedTask.progress_percent}%
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Labels */}
            {selectedTask.labels.length > 0 && (
              <div className="detail-section">
                <h4>Labels</h4>
                <div className="detail-labels">
                  {selectedTask.labels.map((lbl) => (
                    <span key={lbl} className="detail-label-tag">
                      {lbl}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Dependencies */}
            {(selectedTask.dependency_ids.length > 0 ||
              selectedTask.dependent_task_ids.length > 0) && (
              <div className="detail-section">
                <h4>Dependencies</h4>
                {selectedTask.dependency_ids.length > 0 && (
                  <div className="detail-deps">
                    <span className="dep-direction">Depends on:</span>
                    {selectedTask.dependency_ids.map((depId) => {
                      const dep = snapshot.tasks.find((t) => t.id === depId);
                      return (
                        <span
                          key={depId}
                          className="dep-link"
                          onClick={() => setSelectedCard(depId)}
                        >
                          {dep ? dep.name : `#${depId.substring(0, 8)}`}
                        </span>
                      );
                    })}
                  </div>
                )}
                {selectedTask.dependent_task_ids.length > 0 && (
                  <div className="detail-deps">
                    <span className="dep-direction">Blocks:</span>
                    {selectedTask.dependent_task_ids.map((depId) => {
                      const dep = snapshot.tasks.find((t) => t.id === depId);
                      return (
                        <span
                          key={depId}
                          className="dep-link"
                          onClick={() => setSelectedCard(depId)}
                        >
                          {dep ? dep.name : `#${depId.substring(0, 8)}`}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Subtasks */}
            {subtasks.length > 0 && (
              <div className="detail-section">
                <h4>
                  Subtasks ({subtasks.filter((s) => s.status === 'done').length}
                  /{subtasks.length})
                </h4>
                <div className="detail-subtasks">
                  {subtasks.map((st) => (
                    <div
                      key={st.id}
                      className="subtask-row"
                      onClick={() => setSelectedCard(st.id)}
                    >
                      <span
                        className={`subtask-check ${st.status === 'done' ? 'done' : ''}`}
                      >
                        {st.status === 'done' ? '✓' : '○'}
                      </span>
                      <span className="subtask-name">{st.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Coordination trail (messages) */}
            {taskMessages.length > 0 && (
              <div className="detail-section">
                <h4>Coordination Trail</h4>
                <div className="detail-trail">
                  {taskMessages.map((msg) => (
                    <div key={msg.id} className="trail-entry">
                      <span className="trail-time">
                        {formatTime(msg.timestamp)}
                      </span>
                      <span className="trail-type">
                        {messageIcon(msg.type)}
                      </span>
                      <span className="trail-text">
                        {msg.message.length > 200
                          ? msg.message.substring(0, 200) + '…'
                          : msg.message}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Blocker AI Suggestions */}
            {selectedTask.status === 'blocked' && selectedTask.blocker_ai_suggestions && (
              <div className="detail-section blocker-ai">
                <h4>🤖 AI Suggestions</h4>
                {selectedTask.blocker_ai_suggestions.root_cause && (
                  <div className="ai-row">
                    <span className="ai-label">Root cause</span>
                    <span className="ai-value">{selectedTask.blocker_ai_suggestions.root_cause}</span>
                  </div>
                )}
                {selectedTask.blocker_ai_suggestions.escalation_needed !== undefined && (
                  <div className="ai-row">
                    <span className="ai-label">Escalate</span>
                    <span className={`ai-badge ${selectedTask.blocker_ai_suggestions.escalation_needed ? 'escalate-yes' : 'escalate-no'}`}>
                      {selectedTask.blocker_ai_suggestions.escalation_needed ? 'Yes' : 'No'}
                    </span>
                  </div>
                )}
                {selectedTask.blocker_ai_suggestions.resolution_steps && selectedTask.blocker_ai_suggestions.resolution_steps.length > 0 && (
                  <div className="ai-steps">
                    <span className="ai-label">Resolution steps</span>
                    <ol className="ai-steps-list">
                      {selectedTask.blocker_ai_suggestions.resolution_steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </div>
                )}
                {selectedTask.blocker_ai_suggestions.estimated_hours !== undefined && (
                  <div className="ai-row">
                    <span className="ai-label">Est. to resolve</span>
                    <span className="ai-value">{selectedTask.blocker_ai_suggestions.estimated_hours}h</span>
                  </div>
                )}
              </div>
            )}

            {/* Artifacts */}
            {taskArtifacts.length > 0 && (
              <div className="detail-section">
                <h4>📦 Artifacts ({taskArtifacts.length})</h4>
                <div className="detail-artifacts">
                  {taskArtifacts.map((artifact) => (
                    <div
                      key={artifact.artifact_id}
                      className="detail-artifact-card"
                      onClick={() => setPreviewArtifact({
                        artifactId: artifact.artifact_id,
                        filename: artifact.filename,
                        artifactType: artifact.artifact_type,
                      })}
                    >
                      <span className="artifact-filename">{artifact.filename}</span>
                      <span className="artifact-type-tag">{artifact.artifact_type}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Decisions */}
            {taskDecisions.length > 0 && (
              <div className="detail-section">
                <h4>📋 Decisions ({taskDecisions.length})</h4>
                <div className="detail-decisions">
                  {taskDecisions.map((decision) => (
                    <div key={decision.decision_id} className="detail-decision-card">
                      <div className="decision-what">{decision.what}</div>
                      {decision.why && (
                        <div className="decision-why">
                          <span className="decision-label">Why:</span> {decision.why}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Description */}
            {selectedTask.description && (
              <div className="detail-section">
                <h4>Description</h4>
                <p className="detail-description">
                  {selectedTask.description}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {previewArtifact && (
        <ArtifactPreviewModal
          artifactId={previewArtifact.artifactId}
          filename={previewArtifact.filename}
          artifactType={previewArtifact.artifactType}
          onClose={() => setPreviewArtifact(null)}
        />
      )}

      {/* Summary bar */}
      <div className="board-summary">
        <span className="summary-item">
          <strong>{metrics.total}</strong> tasks
        </span>
        <span className="summary-divider">·</span>
        <span className="summary-item summary-done">
          <strong>{metrics.pct}%</strong> complete
        </span>
        <span className="summary-divider">·</span>
        <span className="summary-item summary-agents">
          <strong>{metrics.agents}</strong> agents active
        </span>
        {metrics.blocked > 0 && (
          <>
            <span className="summary-divider">·</span>
            <span className="summary-item summary-blocked">
              <strong>{metrics.blocked}</strong> blocker
              {metrics.blocked !== 1 ? 's' : ''}
            </span>
          </>
        )}
      </div>
    </div>
  );
};

const AGENT_COLORS = [
  '#3b82f6', '#8b5cf6', '#06b6d4', '#f97316', '#10b981',
  '#ec4899', '#eab308', '#14b8a6', '#f43f5e', '#6366f1',
];

function agentColor(agentId: string, agents: { id: string }[]): string {
  const idx = agents.findIndex((a) => a.id === agentId);
  return AGENT_COLORS[idx >= 0 ? idx % AGENT_COLORS.length : 0];
}

function messageIcon(type: string): string {
  switch (type) {
    case 'task_assignment': return '📋';
    case 'status_update': return '📊';
    case 'blocker': return '🚫';
    case 'question': return '❓';
    case 'answer': return '💬';
    case 'instruction': return '📝';
    default: return '•';
  }
}

export default BoardView;
