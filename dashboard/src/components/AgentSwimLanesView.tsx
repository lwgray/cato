import { useState } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';
import { Task as SnapshotTask } from '../services/dataService';
import { getTaskStateAtTime, timeToLogScale } from '../utils/timelineUtils';
import TaskLifecyclePanel from './TaskLifecyclePanel';
import './AgentSwimLanesView.css';

type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked';

const AgentSwimLanesView = () => {
  const snapshot = useVisualizationStore((state) => state.snapshot);
  const currentTime = useVisualizationStore((state) => state.currentTime);
  const selectAgent = useVisualizationStore((state) => state.selectAgent);
  const selectTask = useVisualizationStore((state) => state.selectTask);

  const [lifecycleTask, setLifecycleTask] = useState<SnapshotTask | null>(null);

  if (!snapshot || !snapshot.start_time || !snapshot.end_time) {
    return (
      <div className="swimlanes-view">
        <div className="swimlanes-container">
          <div className="no-data">No snapshot data available</div>
        </div>
      </div>
    );
  }

  const startTime = new Date(snapshot.start_time).getTime();
  const endTime = new Date(snapshot.end_time).getTime();
  const totalDuration = endTime - startTime;
  const currentAbsTime = startTime + currentTime;

  const designTasks = snapshot.tasks.filter(
    (t) => t.display_role === 'structural'
  );

  const agentTasks = snapshot.agents
    .map((agent) => {
      const tasks = snapshot.tasks.filter(
        (t) => t.assigned_agent_id === agent.id && (t.display_role || 'work') === 'work'
      );
      return { agent, tasks };
    })
    .filter(({ tasks }) => tasks.length > 0);

  const getTaskPosition = (task: SnapshotTask) => {
    const taskStart = task.started_at
      ? new Date(task.started_at).getTime()
      : new Date(task.created_at).getTime();
    const taskEnd = new Date(task.updated_at).getTime();

    const taskStartRelative = taskStart - startTime;
    const taskEndRelative = taskEnd - startTime;

    const taskStartLog = timeToLogScale(taskStartRelative, totalDuration);
    const taskEndLog = timeToLogScale(taskEndRelative, totalDuration);

    const startPercent = (taskStartLog / totalDuration) * 100;
    const durationPercent = ((taskEndLog - taskStartLog) / totalDuration) * 100;

    return {
      left: `${startPercent}%`,
      width: `${Math.max(durationPercent, 0.5)}%`,
    };
  };

  const getTaskColor = (status: TaskStatus) => {
    switch (status) {
      case 'todo': return '#64748b';
      case 'in_progress': return '#3b82f6';
      case 'done': return '#10b981';
      case 'blocked': return '#ef4444';
      default: return '#64748b';
    }
  };

  const getMessagesForTask = (taskId: string) => {
    return snapshot.messages.filter(
      (m) => m.task_id === taskId && new Date(m.timestamp).getTime() <= currentAbsTime
    );
  };

  // Build parent context groups from all work subtasks (for the context lane above agents)
  const subtasksByParent = new Map<string, {
    name: string;
    tasks: SnapshotTask[];
    done: number;
    total: number;
  }>();

  for (const task of snapshot.tasks) {
    if ((task.display_role || 'work') !== 'work') continue;
    if (!task.parent_task_id) continue;
    const pid = task.parent_task_id;
    if (!subtasksByParent.has(pid)) {
      subtasksByParent.set(pid, {
        name: task.parent_task_name || 'Parent Task',
        tasks: [],
        done: 0,
        total: 0,
      });
    }
    const entry = subtasksByParent.get(pid)!;
    entry.tasks.push(task);
    entry.total++;
    const state = getTaskStateAtTime(task, currentAbsTime);
    if (state.status === 'done') entry.done++;
  }

  // Compute timeline span for each parent group
  const parentContextGroups = Array.from(subtasksByParent.entries())
    .filter(([, v]) => v.total >= 2)
    .map(([parentId, v]) => {
      const starts = v.tasks.map((t) => {
        const ts = t.started_at
          ? new Date(t.started_at).getTime()
          : new Date(t.created_at).getTime();
        return ts - startTime;
      });
      const ends = v.tasks.map((t) => {
        const state = getTaskStateAtTime(t, currentAbsTime);
        if (state.status === 'in_progress') return currentTime;
        return new Date(t.updated_at).getTime() - startTime;
      });

      const earliest = Math.max(0, Math.min(...starts));
      const latest = Math.min(totalDuration, Math.max(...ends, earliest + 1000));

      const startLog = timeToLogScale(earliest, totalDuration);
      const endLog = timeToLogScale(latest, totalDuration);

      return {
        parentId,
        name: v.name,
        done: v.done,
        total: v.total,
        left: `${(startLog / totalDuration) * 100}%`,
        width: `${Math.max(((endLog - startLog) / totalDuration) * 100, 1)}%`,
      };
    });

  const currentTimeScaled = timeToLogScale(currentTime, totalDuration);
  const currentTimePercent = (currentTimeScaled / totalDuration) * 100;

  return (
    <div className="swimlanes-view">
      <div className="swimlanes-container">
        <div className="swimlanes-content">
          {/* Time axis */}
          <div className="time-axis">
            {Array.from({ length: 13 }, (_, i) => i * 30).map((minutes) => {
              const timeMs = minutes * 60000;
              const timeScaledMs = timeToLogScale(timeMs, totalDuration);
              const position = (timeScaledMs / totalDuration) * 100;
              return (
                <div key={minutes} className="time-marker" style={{ left: `${position}%` }}>
                  <span>{minutes}m</span>
                </div>
              );
            })}
            <div
              className="current-time-line"
              style={{ left: `${currentTimePercent}%` }}
            >
              <div className="time-label">{Math.round(currentTime / 60000)}m</div>
            </div>
          </div>

          {/* Planning lane for design/structural tasks */}
          {designTasks.length > 0 && (
            <div className="agent-lane planning-lane">
              <div className="agent-info">
                <div className="agent-name">Marcus</div>
                <div className="agent-meta">
                  <span className="agent-role">Planning</span>
                  <span className="agent-autonomy">
                    Design: {designTasks.filter((t) => t.status === 'done').length}/{designTasks.length}
                  </span>
                </div>
              </div>

              <div className="lane-timeline">
                {designTasks.map((task) => {
                  const taskState = getTaskStateAtTime(task, currentAbsTime);
                  const isActive = taskState.isActive;
                  return (
                    <div
                      key={task.id}
                      className={`task-bar design-task-bar ${isActive ? 'active' : ''}`}
                      style={{
                        ...getTaskPosition(task),
                        backgroundColor: 'transparent',
                        borderColor: taskState.status === 'done' ? '#10b981' : '#8b5cf6',
                        borderStyle: 'dashed',
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        selectTask(task.id);
                        setLifecycleTask(task);
                      }}
                      title={task.name}
                    >
                      <div className="task-bar-content">
                        <span className="task-bar-name">{task.name}</span>
                        <span className="task-bar-progress">
                          {taskState.status === 'done' ? 'Design' : `${taskState.progress}%`}
                        </span>
                      </div>
                      {taskState.progress === 100 && (
                        <div className="completion-indicator" title="Design complete">✓</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Parent context lanes — one thin row per parent group, above agent lanes */}
          {parentContextGroups.length > 0 && (
            <div className="parent-context-section">
              {parentContextGroups.map(({ parentId, name, done, total, left, width }) => (
                <div key={parentId} className="parent-context-lane">
                  <div className="parent-context-info">
                    <span className="parent-context-name">{name}</span>
                    <span className={`parent-context-badge ${done === total ? 'all-done' : ''}`}>
                      {done}/{total} ✓
                    </span>
                  </div>
                  <div className="parent-context-timeline">
                    <div
                      className="parent-context-bar"
                      style={{ left, width }}
                      title={`${name}: ${done}/${total} subtasks done`}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Agent lanes */}
          {agentTasks.map(({ agent, tasks }) => (
            <div key={agent.id} className="agent-lane" onClick={() => selectAgent(agent.id)}>
              <div className="agent-info">
                <div className="agent-name">{agent.name}</div>
                <div className="agent-meta">
                  <span className="agent-role">{agent.role}</span>
                  <span className="agent-autonomy">
                    Tasks: {agent.completed_tasks_count}/{agent.completed_tasks_count + agent.current_task_ids.length}
                  </span>
                </div>
              </div>

              <div className="lane-timeline">
                {tasks.map((task) => {
                  const msgs = getMessagesForTask(task.id);
                  const questions = msgs.filter((m) => m.type === 'question');
                  const blockers = msgs.filter((m) => m.type === 'blocker');

                  const taskState = getTaskStateAtTime(task, currentAbsTime);
                  const isActive = taskState.isActive;

                  return (
                    <div
                      key={task.id}
                      className={`task-bar ${isActive ? 'active' : ''}`}
                      style={{
                        ...getTaskPosition(task),
                        backgroundColor: getTaskColor(taskState.status),
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        selectTask(task.id);
                        setLifecycleTask(task);
                      }}
                      title={task.name}
                    >
                      <div className="task-bar-content">
                        <span className="task-bar-name">{task.name}</span>
                        <span className="task-bar-progress">{taskState.progress}%</span>
                      </div>

                      {questions.map((q, idx) => {
                        const qTime = new Date(q.timestamp).getTime();
                        const qPercent =
                          ((qTime - new Date(task.created_at).getTime()) /
                            (new Date(task.updated_at).getTime() -
                              new Date(task.created_at).getTime())) *
                          100;
                        return (
                          <div
                            key={idx}
                            className="message-indicator question"
                            style={{ left: `${qPercent}%` }}
                            title="Question asked"
                          >
                            ❓
                          </div>
                        );
                      })}

                      {blockers.map((b, idx) => {
                        const bTime = new Date(b.timestamp).getTime();
                        const bPercent =
                          ((bTime - new Date(task.created_at).getTime()) /
                            (new Date(task.updated_at).getTime() -
                              new Date(task.created_at).getTime())) *
                          100;
                        return (
                          <div
                            key={idx}
                            className="message-indicator blocker"
                            style={{ left: `${bPercent}%` }}
                            title="Blocker reported"
                          >
                            🚫
                          </div>
                        );
                      })}

                      {taskState.progress === 100 && (
                        <div className="completion-indicator" title="Task completed">✓</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {lifecycleTask && (
        <TaskLifecyclePanel
          task={lifecycleTask}
          onClose={() => setLifecycleTask(null)}
        />
      )}
    </div>
  );
};

export default AgentSwimLanesView;
