import { useMemo } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';
import { Message } from '../services/dataService';
import './ConversationView.css';

const ConversationView = () => {
  const messages = useVisualizationStore((state) => state.getMessagesUpToCurrentTime());
  const snapshot = useVisualizationStore((state) => state.snapshot);
  const selectMessage = useVisualizationStore((state) => state.selectMessage);
  const selectedMessageId = useVisualizationStore((state) => state.selectedMessageId);

  if (!snapshot) {
    return (
      <div className="conversation-view">
        <div className="conversations-container">
          <div className="no-data">No conversation data available</div>
        </div>
      </div>
    );
  }

  // Group messages by task or general conversation
  const groupedMessages = useMemo(() => {
    const groups: { [key: string]: Message[] } = {
      general: [],
    };

    messages.forEach(msg => {
      if (msg.task_id) {
        if (!groups[msg.task_id]) {
          groups[msg.task_id] = [];
        }
        groups[msg.task_id].push(msg);
      } else {
        groups.general.push(msg);
      }
    });

    return groups;
  }, [messages]);

  const getMessageIcon = (type: string) => {
    switch (type) {
      case 'instruction': return '📋';
      case 'question': return '❓';
      case 'answer': return '✅';
      case 'status_update': return '📊';
      case 'blocker': return '🚫';
      case 'task_request': return '🙋';
      case 'task_assignment': return '📝';
      default: return '💬';
    }
  };

  const getMessageTypeLabel = (type: string) => {
    switch (type) {
      case 'instruction': return 'Instruction';
      case 'question': return 'Question';
      case 'answer': return 'Answer';
      case 'status_update': return 'Status Update';
      case 'blocker': return 'Blocker';
      case 'task_request': return 'Task Request';
      case 'task_assignment': return 'Task Assignment';
      default: return 'Message';
    }
  };

  const getAgentName = (agentId: string) => {
    if (agentId === 'marcus') return 'Marcus';
    const agent = snapshot.agents.find(a => a.id === agentId);
    return agent ? agent.name : agentId;
  };

  const getTaskName = (taskId: string) => {
    const task = snapshot.tasks.find(t => t.id === taskId);
    return task ? task.name : taskId;
  };

  const formatTime = (timestamp: string) => {
    if (!snapshot || !snapshot.start_time) return '0m';
    const date = new Date(timestamp);
    const startTime = new Date(snapshot.start_time);
    const diffMinutes = Math.round((date.getTime() - startTime.getTime()) / 60000);
    return `${diffMinutes}m`;
  };

  return (
    <div className="conversation-view">
      <div className="conversations-container">
        {Object.entries(groupedMessages).map(([taskId, msgs]) => {
          if (msgs.length === 0) return null;

          return (
            <div key={taskId} className="conversation-group">
              <div className="conversation-group-header">
                <h3>
                  {taskId === 'general' ? 'General System Messages' : getTaskName(taskId)}
                </h3>
                <span className="message-count">{msgs.length} messages</span>
              </div>

              <div className="messages-list">
                {msgs.map((msg, idx) => {
                  const isFromMarcus = msg.from_agent_id === 'marcus';
                  const prevMsg = idx > 0 ? msgs[idx - 1] : null;
                  const isThreaded = msg.parent_message_id === prevMsg?.id;

                  return (
                    <div
                      key={msg.id}
                      className={`message ${isFromMarcus ? 'from-marcus' : 'from-agent'} ${
                        msg.id === selectedMessageId ? 'selected' : ''
                      } ${isThreaded ? 'threaded' : ''}`}
                      onClick={() => selectMessage(msg.id)}
                    >
                      <div className="message-header">
                        <div className="message-sender">
                          <span className="sender-avatar">
                            {isFromMarcus ? '🤖' : '👤'}
                          </span>
                          <span className="sender-name">{getAgentName(msg.from_agent_id)}</span>
                          <span className="message-arrow">→</span>
                          <span className="receiver-name">{getAgentName(msg.to_agent_id)}</span>
                        </div>
                        <div className="message-meta">
                          <span className="message-time">{formatTime(msg.timestamp)}</span>
                          <span className="message-type-badge">
                            {getMessageIcon(msg.type)} {getMessageTypeLabel(msg.type)}
                          </span>
                        </div>
                      </div>

                      <div className="message-body">
                        {msg.message}
                      </div>

                      {msg.metadata && Object.keys(msg.metadata).length > 0 && (
                        <div className="message-metadata">
                          {msg.metadata.blocking && (
                            <span className="meta-badge blocking">Blocking</span>
                          )}
                          {msg.metadata.requires_response && (
                            <span className="meta-badge requires-response">Requires Response</span>
                          )}
                          {msg.metadata.progress !== undefined && (
                            <span className="meta-badge progress">Progress: {msg.metadata.progress}%</span>
                          )}
                          {msg.metadata.response_time && (
                            <span className="meta-badge response-time">
                              Response: {msg.metadata.response_time}s
                            </span>
                          )}
                          {msg.metadata.resolves_blocker && (
                            <span className="meta-badge resolves">Resolves Blocker</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ConversationView;
