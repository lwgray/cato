import { useMemo } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';
import { Task } from '../services/dataService';
import './ProjectInfoDrawer.css';

const STATUS_CONFIG: Record<Task['status'], { label: string; color: string }> = {
  todo:        { label: 'Backlog',     color: '#64748b' },
  in_progress: { label: 'In Progress', color: '#3b82f6' },
  done:        { label: 'Done',        color: '#10b981' },
  blocked:     { label: 'Blocked',     color: '#ef4444' },
};

const DesignTaskCard = ({ task, subtasks }: { task: Task; subtasks: Task[] }) => {
  const done = subtasks.filter((s) => s.status === 'done').length;
  const total = subtasks.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const cfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.todo;

  return (
    <div className="pid-card">
      <div className="pid-card-header">
        <span className="pid-card-name">{task.name}</span>
        <span className="pid-status-badge" style={{ background: cfg.color }}>
          {cfg.label}
        </span>
      </div>

      {task.description && (
        <p className="pid-card-desc">{task.description}</p>
      )}

      {total > 0 && (
        <div className="pid-progress">
          <div className="pid-progress-meta">
            <span>{done}/{total} subtasks</span>
            <span>{pct}%</span>
          </div>
          <div className="pid-progress-track">
            <div className="pid-progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {task.labels.length > 0 && (
        <div className="pid-labels">
          {task.labels.slice(0, 6).map((l) => (
            <span key={l} className="pid-label">{l}</span>
          ))}
        </div>
      )}
    </div>
  );
};

const ProjectInfoDrawer = () => {
  const isOpen = useVisualizationStore((s) => s.isProjectInfoOpen);
  const toggleProjectInfo = useVisualizationStore((s) => s.toggleProjectInfo);
  const structuralTasks = useVisualizationStore((s) => s.getStructuralTasks());
  const snapshot = useVisualizationStore((s) => s.snapshot);

  const { parentTasks, subtasksByParent } = useMemo(() => {
    const allTasks = snapshot?.tasks ?? [];
    const byParent = new Map<string, Task[]>();

    for (const t of allTasks) {
      if (!t.parent_task_id) continue;
      if (!byParent.has(t.parent_task_id)) byParent.set(t.parent_task_id, []);
      byParent.get(t.parent_task_id)!.push(t);
    }

    const parents = structuralTasks.filter((t) => !t.parent_task_id);
    return { parentTasks: parents, subtasksByParent: byParent };
  }, [structuralTasks, snapshot]);

  if (!isOpen) return null;

  return (
    <div className="pid-drawer">
      <div className="pid-header">
        <div className="pid-header-left">
          <span className="pid-header-icon">🏗</span>
          <div>
            <h2 className="pid-title">Project Structure</h2>
            <p className="pid-subtitle">Design &amp; planning tasks</p>
          </div>
        </div>
        <button className="pid-close" onClick={toggleProjectInfo} aria-label="Close">✕</button>
      </div>

      <div className="pid-body">
        {parentTasks.length === 0 ? (
          <div className="pid-empty">
            <span className="pid-empty-icon">📋</span>
            <p>No design tasks found for this project.</p>
          </div>
        ) : (
          <>
            <div className="pid-count-row">
              <span className="pid-count-badge">{parentTasks.length} design task{parentTasks.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="pid-cards">
              {parentTasks.map((task) => (
                <DesignTaskCard
                  key={task.id}
                  task={task}
                  subtasks={subtasksByParent.get(task.id) ?? []}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ProjectInfoDrawer;
