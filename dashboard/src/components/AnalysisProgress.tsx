import { useState, useEffect, useRef } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';
import './AnalysisProgress.css';

interface LogEntry {
  timestamp: Date;
  message: string;
  type: 'log' | 'complete' | 'error';
}

interface ProgressInfo {
  current: number;
  total: number;
  percentage: number;
  message: string;
}

interface AnalysisProgressProps {
  projectId: string;
  onComplete?: (data: any) => void;
  onError?: (error: string) => void;
}

/**
 * Real-time analysis progress component using Server-Sent Events.
 *
 * Displays streaming logs from the backend as analysis progresses,
 * showing each step with timestamps in a terminal-style interface.
 */
const AnalysisProgress: React.FC<AnalysisProgressProps> = ({
  projectId,
  onComplete,
  onError,
}) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressInfo, setProgressInfo] = useState<ProgressInfo | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Parse progress from messages like "⟳ Analyzing task redundancy (2/3 - 67%)"
  // Only extract task-level progress, not sub-stage progress within each task
  const extractProgress = (message: string): ProgressInfo | null => {
    // Match pattern: (current/total - percentage%)
    const match = message.match(/\((\d+)\/(\d+)\s*-\s*(\d+)%\)/);
    if (!match) return null;

    const current = parseInt(match[1], 10);
    const total = parseInt(match[2], 10);
    const percentage = parseInt(match[3], 10);

    // Strategy: Only show progress for the MAIN task analysis phases
    // Filter out sub-stages like "Tracing", "Evaluating", etc. which happen within each task
    // Main task analysis typically has 3-5 phases (total <= 10)
    // Sub-stages within tasks would show progress like (5/100) for individual elements
    //
    // Additionally, check message content to ensure we're tracking the right level:
    // - Include: "Analyzing" messages (main phases)
    // - Exclude: "Tracing", "Evaluating", "Processing" (sub-stages within a task)
    const messageLower = message.toLowerCase();
    const isSubStage = messageLower.includes('tracing') ||
                       messageLower.includes('evaluating') ||
                       messageLower.includes('processing element');

    if (total > 10 || isSubStage) {
      return null; // Skip element-level or sub-stage progress
    }

    return {
      current,
      total,
      percentage,
      message: message.split('(')[0].trim(), // Get part before the progress
    };
  };

  // Auto-scroll to bottom when new logs appear
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Reset state when projectId changes
  useEffect(() => {
    console.log('[AnalysisProgress] Project changed, resetting state for:', projectId);
    setLogs([]);
    setIsComplete(false);
    setError(null);
    setProgressInfo(null);
  }, [projectId]);

  // Set up SSE connection when component mounts or projectId changes
  useEffect(() => {
    // Don't start a new connection if we're already complete
    if (isComplete) {
      return;
    }

    console.log('[AnalysisProgress] Setting up SSE for project:', projectId);

    const eventSource = new EventSource(
      `http://localhost:4301/api/historical/projects/${projectId}/analysis/stream`
    );
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[AnalysisProgress] Received event:', data);

        if (data.type === 'log') {
          // Extract progress info if present
          const progress = extractProgress(data.message);
          if (progress) {
            console.log('[AnalysisProgress] Extracted progress:', progress);
            setProgressInfo(progress);
          }

          setLogs((prev) => [
            ...prev,
            {
              timestamp: new Date(),
              message: data.message,
              type: 'log',
            },
          ]);
        } else if (data.type === 'complete') {
          console.log('[AnalysisProgress] Analysis complete!');
          setIsComplete(true);
          eventSource.close();

          // Cache the result in the store
          const state = useVisualizationStore.getState();
          const newCache = new Map(state.historicalAnalysisCache);
          newCache.set(projectId, {
            data: data.data,
            timestamp: Date.now(),
          });

          // Always update the store with the analysis result and cache
          useVisualizationStore.setState({
            historicalAnalysis: data.data,
            historicalAnalysisCache: newCache,
            isLoading: false,
          });

          // Also call the optional callback for any additional handling
          if (onComplete) {
            onComplete(data.data);
          }
        } else if (data.type === 'error') {
          console.error('[AnalysisProgress] Error:', data.message);
          setError(data.message);
          setIsComplete(true);
          eventSource.close();
          if (onError) {
            onError(data.message);
          }
        }
      } catch (err) {
        console.error('[AnalysisProgress] Failed to parse event:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('[AnalysisProgress] EventSource error:', err);
      setError('Connection lost. Please refresh and try again.');
      setIsComplete(true);
      eventSource.close();
      if (onError) {
        onError('Connection lost. Please refresh and try again.');
      }
    };

    // Cleanup on unmount
    return () => {
      console.log('[AnalysisProgress] Cleaning up SSE connection');
      eventSource.close();
    };
  }, [projectId, onComplete, onError, isComplete]);

  return (
    <div className="analysis-progress">
      {/* Sticky Header Section - Always Visible */}
      <div className="analysis-header-sticky">
        <div className="header-title">
          <h2>📊 Analyzing Project</h2>
        </div>

        {/* Main Progress Section */}
        {progressInfo && (
          <div className="progress-main">
            <div className="progress-bar-large-container">
              <div
                className="progress-bar-large-fill"
                style={{ width: `${progressInfo.percentage}%` }}
              >
                <span className="progress-percentage-large">{progressInfo.percentage}%</span>
              </div>
            </div>
            <div className="progress-status-row">
              <span className="task-count-main">
                Task {progressInfo.current} of {progressInfo.total} Complete
              </span>
              <span className="current-task-main">
                Currently: {progressInfo.message}
              </span>
            </div>
          </div>
        )}

        {!progressInfo && !isComplete && (
          <div className="progress-main">
            <div className="progress-status-row">
              <span className="task-count-main">Initializing analysis...</span>
            </div>
          </div>
        )}
      </div>

      {/* Scrollable Logs Section - Secondary */}
      <div className="log-container-secondary">
        <div className="log-header">Detailed Activity Log</div>
        {logs.length === 0 && !isComplete && (
          <div className="log-line">
            <span className="message">Connecting to analysis stream...</span>
          </div>
        )}
        {logs.map((log, i) => (
          <div key={i} className="log-line">
            <span className="timestamp">
              {log.timestamp.toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
            <span className="message">{log.message}</span>
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>

      {/* Status Messages */}
      {error && (
        <div className="error-message">
          ⚠️ {error}
        </div>
      )}

      {isComplete && !error && (
        <div className="complete-message">
          ✓ Analysis complete!
        </div>
      )}
    </div>
  );
};

export default AnalysisProgress;
