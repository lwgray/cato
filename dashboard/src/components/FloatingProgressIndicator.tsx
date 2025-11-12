import { useVisualizationStore } from '../store/visualizationStore';
import AnalysisProgress from './AnalysisProgress';
import './FloatingProgressIndicator.css';

/**
 * Floating progress indicator for historical analysis.
 *
 * Shows a non-blocking progress overlay in the bottom-right corner
 * that allows users to continue interacting with the UI while analysis runs.
 * Can be minimized/expanded and dismissed.
 */
const FloatingProgressIndicator = () => {
  const isLoading = useVisualizationStore((state) => state.isLoading);
  const selectedHistoricalProjectId = useVisualizationStore(
    (state) => state.selectedHistoricalProjectId
  );
  const viewMode = useVisualizationStore((state) => state.viewMode);

  // Only show when:
  // 1. In historical mode
  // 2. Loading is in progress
  // 3. A project is selected
  if (viewMode !== 'historical' || !isLoading || !selectedHistoricalProjectId) {
    return null;
  }

  return (
    <div className="floating-progress-indicator">
      <div className="floating-progress-content">
        <AnalysisProgress
          projectId={selectedHistoricalProjectId}
          onComplete={(data) => {
            // Update the store with the completed analysis
            useVisualizationStore.setState({
              historicalAnalysis: data,
              isLoading: false,
            });
          }}
          onError={(error) => {
            // Update the store with the error
            useVisualizationStore.setState({
              loadError: error,
              isLoading: false,
            });
          }}
        />
      </div>
    </div>
  );
};

export default FloatingProgressIndicator;
