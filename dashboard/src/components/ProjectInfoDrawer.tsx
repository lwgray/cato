import { useState, useMemo } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';
import { Task } from '../services/dataService';
import './ProjectInfoDrawer.css';

interface SectionProps {
  title: string;
  tasks: Task[];
  defaultOpen?: boolean;
}

const DrawerSection = ({ title, tasks, defaultOpen = true }: SectionProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (tasks.length === 0) return null;

  return (
    <div className="drawer-section">
      <div className="drawer-section-header" onClick={() => setIsOpen(!isOpen)}>
        <span className={`drawer-section-toggle ${isOpen ? '' : 'collapsed'}`}>&#9660;</span>
        <h3>{title}</h3>
        <span className="drawer-section-count">{tasks.length}</span>
      </div>
      {isOpen && tasks.map(task => (
        <div key={task.id} className="drawer-item">
          <div className="drawer-item-name">{task.name}</div>
          {task.description && (
            <div className="drawer-item-description">{task.description}</div>
          )}
          {task.labels.length > 0 && (
            <div className="drawer-item-labels">
              {task.labels.slice(0, 5).map(label => (
                <span key={label} className="drawer-item-label">{label}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const ProjectInfoDrawer = () => {
  const isOpen = useVisualizationStore((state) => state.isProjectInfoOpen);
  const toggleProjectInfo = useVisualizationStore((state) => state.toggleProjectInfo);
  const contextTasks = useVisualizationStore((state) => state.getContextTasks());

  // Partition context tasks into sections
  const { aboutTasks, designTasks, docTasks } = useMemo(() => {
    const about: Task[] = [];
    const design: Task[] = [];
    const docs: Task[] = [];

    for (const task of contextTasks) {
      if (task.name.startsWith('About:') || task.metadata?.source_type === 'project_about') {
        about.push(task);
      } else if (task.labels.includes('auto_completed') || task.labels.includes('design')) {
        design.push(task);
      } else if (task.name.includes('README')) {
        docs.push(task);
      } else {
        // Default bucket for other context tasks
        about.push(task);
      }
    }

    return { aboutTasks: about, designTasks: design, docTasks: docs };
  }, [contextTasks]);

  if (!isOpen) return null;

  return (
    <div className="project-info-drawer">
      <div className="drawer-header">
        <h2>Project Info</h2>
        <button className="drawer-close" onClick={toggleProjectInfo}>&times;</button>
      </div>
      <div className="drawer-content">
        {contextTasks.length === 0 ? (
          <div className="drawer-empty">
            No project info available for this project.
          </div>
        ) : (
          <>
            <DrawerSection title="About" tasks={aboutTasks} />
            <DrawerSection title="Design" tasks={designTasks} />
            <DrawerSection title="Documentation" tasks={docTasks} />
          </>
        )}
      </div>
    </div>
  );
};

export default ProjectInfoDrawer;
