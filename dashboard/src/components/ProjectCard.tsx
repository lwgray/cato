import React from 'react';
import './ProjectCard.css';

interface ProjectCardProps {
  project: {
    project_id: string;
    project_name: string;
    total_tasks: number;
    completed_tasks: number;
    completion_rate: number;
    blocked_tasks: number;
    total_decisions: number;
    project_duration_hours: number;
    is_active?: boolean;
    status?: string;
  };
  badge?: string;
  onSelect: (projectId: string) => void;
}

/**
 * Reusable project card component for displaying project summary information.
 *
 * Used in the archive browser to show project details with status badges
 * and key metrics in a visually appealing card format.
 */
const ProjectCard: React.FC<ProjectCardProps> = ({ project, badge, onSelect }) => {
  const handleClick = () => {
    onSelect(project.project_id);
  };

  // Calculate time ago for last activity
  const getTimeAgo = (hours: number): string => {
    if (hours === 0) return 'Recently';
    if (hours < 1) return `${Math.round(hours * 60)} min ago`;
    if (hours < 24) return `${Math.round(hours)} hours ago`;
    const days = Math.round(hours / 24);
    if (days === 1) return '1 day ago';
    if (days < 30) return `${days} days ago`;
    const months = Math.round(days / 30);
    return months === 1 ? '1 month ago' : `${months} months ago`;
  };

  return (
    <div
      className={`project-card ${project.status || ''}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyPress={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleClick();
        }
      }}
    >
      <div className="project-card-header">
        <h4 className="project-card-name">{project.project_name}</h4>
        {badge && <span className="project-badge">{badge}</span>}
      </div>

      <div className="project-card-stats">
        <div className="stat-item">
          <span className="stat-label">Tasks:</span>
          <span className="stat-value">
            {project.completed_tasks}/{project.total_tasks}
          </span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Completion:</span>
          <span className="stat-value">{project.completion_rate.toFixed(1)}%</span>
        </div>
        {project.blocked_tasks > 0 && (
          <div className="stat-item warning">
            <span className="stat-label">Blocked:</span>
            <span className="stat-value">{project.blocked_tasks}</span>
          </div>
        )}
      </div>

      <div className="project-card-footer">
        <span className="project-meta">
          {project.total_decisions} decisions
        </span>
        <span className="project-meta">
          Last: {getTimeAgo(project.project_duration_hours)}
        </span>
      </div>
    </div>
  );
};

export default ProjectCard;
