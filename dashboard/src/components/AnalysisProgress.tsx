import { useState, useEffect, useRef } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';
import './AnalysisProgress.css';

interface LogEntry {
  timestamp: Date;
  message: string;
  type: 'log' | 'complete' | 'error';
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
  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Auto-scroll to bottom when new logs appear
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

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

          if (onComplete) {
            onComplete(data.data);
          }

          // Update cache in store
          useVisualizationStore.setState({
            historicalAnalysisCache: newCache,
          });
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
      <h3>Analyzing Project...</h3>

      <div className="log-container">
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
