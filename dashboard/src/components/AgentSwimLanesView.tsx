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

  // Local state for lifecycle panel
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

  // Group tasks by agent and filter out agents with no tasks
  const agentTasks = snapshot.agents
    .map((agent) => {
      const tasks = snapshot.tasks.filter((t) => t.assigned_agent_id === agent.id);
      return { agent, tasks };
    })
    .filter(({ tasks }) => tasks.length > 0);

  const getTaskPosition = (task: SnapshotTask) => {
    // Use started_at if available (when task actually began execution),
    // otherwise fall back to created_at (when task was created/planned)
    // This matches the logic in getTaskStateAtTime to ensure alignment
    const taskStart = task.started_at
      ? new Date(task.started_at).getTime()
      : new Date(task.created_at).getTime();
    const taskEnd = new Date(task.updated_at).getTime();

    // Convert to relative time from start
    const taskStartRelative = taskStart - startTime;
    const taskEndRelative = taskEnd - startTime;

    // Apply logarithmic scale
    const taskStartLog = timeToLogScale(taskStartRelative, totalDuration);
    const taskEndLog = timeToLogScale(taskEndRelative, totalDuration);

    const startPercent = (taskStartLog / totalDuration) * 100;
    const durationPercent = ((taskEndLog - taskStartLog) / totalDuration) * 100;

    return {
      left: `${startPercent}%`,
      width: `${Math.max(durationPercent, 0.5)}%`, // Minimum width for visibility
    };
  };

  const getTaskColor = (status: TaskStatus) => {
    switch (status) {
      case 'todo':
        return '#64748b';
      case 'in_progress':
        return '#3b82f6';
      case 'done':
        return '#10b981';
      case 'blocked':
        return '#ef4444';
      default:
        return '#64748b';
    }
  };

  // Get messages for task at current time
  const getMessagesForTask = (taskId: string) => {
    return snapshot.messages.filter(
      (m) => m.task_id === taskId && new Date(m.timestamp).getTime() <= currentAbsTime
    );
  };

  // Apply power scale to indicator position to match task bar positions
  const currentTimeScaled = timeToLogScale(currentTime, totalDuration);
  const currentTimePercent = (currentTimeScaled / totalDuration) * 100;

  return (
    <div className="swimlanes-view">
      <div className="swimlanes-container">
        <div className="swimlanes-content">
          {/* Time axis */}
          <div className="time-axis">
            {Array.from({ length: 13 }, (_, i) => i * 30).map((minutes) => {
              // Convert minutes to milliseconds, apply power scale
              const timeMs = minutes * 60000;
              const timeScaledMs = timeToLogScale(timeMs, totalDuration);
              const position = (timeScaledMs / totalDuration) * 100;

              return (
                <div key={minutes} className="time-marker" style={{ left: `${position}%` }}>
                  <span>{minutes}m</span>
                </div>
              );
            })}
          </div>

          {/* Current time indicator */}
          <div
            className="current-time-line"
            style={{ left: `calc(200px + ${currentTimePercent}%)` }}
          >
            <div className="time-label">{Math.round(currentTime / 60000)}m</div>
          </div>

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
                  const messages = getMessagesForTask(task.id);
                  const questions = messages.filter((m) => m.type === 'question');
                  const blockers = messages.filter((m) => m.type === 'blocker');

                  // Get dynamic state based on current time
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
                        setLifecycleTask(task); // Show lifecycle panel
                      }}
                      title={task.name}
                    >
                      <div className="task-bar-content">
                        <span className="task-bar-name">{task.name}</span>
                        <span className="task-bar-progress">{taskState.progress}%</span>
                      </div>

                      {/* Message indicators */}
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
                        <div className="completion-indicator" title="Task completed">
                          ✓
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Task Lifecycle Panel */}
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
