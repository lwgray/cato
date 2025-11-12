import { useState, useEffect } from 'react';
import ProjectCard from './ProjectCard';
import './ArchiveBrowser.css';

interface Project {
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
}

interface ArchiveBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProject: (projectId: string) => void;
}

/**
 * Archive browser modal for accessing all historical projects.
 *
 * Displays active and archived projects in separate sections with
 * search functionality. Uses progressive disclosure pattern to keep
 * main UI clean while providing access to all project history.
 */
const ArchiveBrowser: React.FC<ArchiveBrowserProps> = ({
  isOpen,
  onClose,
  onSelectProject,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [allProjects, setAllProjects] = useState<{
    active: Project[];
    archived: Project[];
  }>({ active: [], archived: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch all projects when modal opens or search term changes
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const fetchProjects = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const searchParam = searchTerm ? `?search=${encodeURIComponent(searchTerm)}` : '';
        const response = await fetch(
          `http://localhost:4301/api/historical/projects/all${searchParam}`
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch projects: ${response.statusText}`);
        }

        const data = await response.json();
        setAllProjects({
          active: data.active || [],
          archived: data.archived || [],
        });
      } catch (err) {
        console.error('Error fetching projects:', err);
        setError(err instanceof Error ? err.message : 'Failed to load projects');
      } finally {
        setIsLoading(false);
      }
    };

    fetchProjects();
  }, [isOpen, searchTerm]);

  const handleSelectProject = (projectId: string) => {
    onSelectProject(projectId);
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="archive-browser-overlay" onClick={onClose}>
      <div className="archive-browser-modal" onClick={(e) => e.stopPropagation()}>
        <div className="archive-browser-header">
          <h2>Browse Project Archives</h2>
          <button className="close-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="archive-browser-search">
          <input
            type="text"
            placeholder="Search projects by name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>

        {error && (
          <div className="error-message">
            ⚠️ {error}
          </div>
        )}

        {isLoading ? (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Loading projects...</p>
          </div>
        ) : (
          <div className="archive-browser-content">
            <div className="projects-section">
              <h3 className="section-title">
                Active Projects ({allProjects.active.length})
              </h3>
              <div className="projects-grid">
                {allProjects.active.length === 0 ? (
                  <p className="empty-state">No active projects found</p>
                ) : (
                  allProjects.active.map((project) => (
                    <ProjectCard
                      key={project.project_id}
                      project={{ ...project, status: 'active' }}
                      badge="✓ Active"
                      onSelect={handleSelectProject}
                    />
                  ))
                )}
              </div>
            </div>

            <div className="projects-section">
              <h3 className="section-title">
                Archived Projects ({allProjects.archived.length})
              </h3>
              <div className="projects-grid">
                {allProjects.archived.length === 0 ? (
                  <p className="empty-state">No archived projects found</p>
                ) : (
                  allProjects.archived.map((project) => (
                    <ProjectCard
                      key={project.project_id}
                      project={{ ...project, status: 'archived' }}
                      badge="🗄️ Archived"
                      onSelect={handleSelectProject}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ArchiveBrowser;
