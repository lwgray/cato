import { useVisualizationStore } from '../store/visualizationStore';
import './ViewModeToggle.css';

const MODES: Array<{ key: 'subtasks' | 'parents' | 'all'; label: string }> = [
  { key: 'subtasks', label: 'Subtasks' },
  { key: 'parents', label: 'Parents' },
  { key: 'all', label: 'All' },
];

const ViewModeToggle = () => {
  const viewMode = useVisualizationStore((state) => state.viewMode);
  const setViewMode = useVisualizationStore((state) => state.setViewMode);

  return (
    <div className="view-mode-toggle" role="group" aria-label="Task view mode">
      <span className="view-mode-label">Show</span>
      {MODES.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          className={`view-mode-button ${viewMode === key ? 'active' : ''}`}
          onClick={() => viewMode !== key && setViewMode(key)}
          aria-pressed={viewMode === key}
        >
          {label}
        </button>
      ))}
    </div>
  );
};

export default ViewModeToggle;
