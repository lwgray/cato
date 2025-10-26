import { useMemo, useState } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';
import { Message } from '../services/dataService';
import './ConversationView.css';

const ConversationView = () => {
  const messages = useVisualizationStore((state) => state.getMessagesUpToCurrentTime());
  const snapshot = useVisualizationStore((state) => state.snapshot);
  const selectMessage = useVisualizationStore((state) => state.selectMessage);
  const selectedMessageId = useVisualizationStore((state) => state.selectedMessageId);

  // Filter state
  const [filterTaskId, setFilterTaskId] = useState<string>('');
  const [filterAgentId, setFilterAgentId] = useState<string>('');
  const [filterEventType, setFilterEventType] = useState<string>('');
  const [searchPattern, setSearchPattern] = useState<string>('');
  const [showDuplicates, setShowDuplicates] = useState<boolean>(true);
  const [filtersExpanded, setFiltersExpanded] = useState<boolean>(false);

  if (!snapshot) {
    return (
      <div className="conversation-view">
        <div className="conversations-container">
          <div className="no-data">No conversation data available</div>
        </div>
      </div>
    );
  }

  // Apply filters to messages
  const filteredMessages = useMemo(() => {
    let filtered = messages;

    // Filter by task_id
    if (filterTaskId) {
      filtered = filtered.filter(msg => msg.task_id === filterTaskId);
    }

    // Filter by agent_id (from or to)
    if (filterAgentId) {
      filtered = filtered.filter(
        msg => msg.from_agent_id === filterAgentId || msg.to_agent_id === filterAgentId
      );
    }

    // Filter by event type
    if (filterEventType) {
      filtered = filtered.filter(msg => msg.type === filterEventType);
    }

    // Filter by search pattern
    if (searchPattern) {
      const pattern = searchPattern.toLowerCase();
      filtered = filtered.filter(msg =>
        msg.message.toLowerCase().includes(pattern) ||
        msg.from_agent_name.toLowerCase().includes(pattern) ||
        msg.to_agent_name.toLowerCase().includes(pattern)
      );
    }

    // Filter duplicates
    if (!showDuplicates) {
      filtered = filtered.filter(msg => !msg.is_duplicate);
    }

    return filtered;
  }, [messages, filterTaskId, filterAgentId, filterEventType, searchPattern, showDuplicates]);

  // Group messages by task or general conversation
  const groupedMessages = useMemo(() => {
    const groups: { [key: string]: Message[] } = {
      general: [],
    };

    filteredMessages.forEach(msg => {
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
  }, [filteredMessages]);

  // Get unique task IDs for filter dropdown
  const uniqueTaskIds = useMemo(() => {
    const taskIds = new Set(messages.filter(m => m.task_id).map(m => m.task_id!));
    return Array.from(taskIds).sort();
  }, [messages]);

  // Get unique agent IDs for filter dropdown
  const uniqueAgentIds = useMemo(() => {
    const agentIds = new Set<string>();
    messages.forEach(m => {
      agentIds.add(m.from_agent_id);
      agentIds.add(m.to_agent_id);
    });
    return Array.from(agentIds).sort();
  }, [messages]);

  // Get unique event types for filter dropdown
  const uniqueEventTypes = useMemo(() => {
    const types = new Set(messages.map(m => m.type));
    return Array.from(types).sort();
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

  const clearFilters = () => {
    setFilterTaskId('');
    setFilterAgentId('');
    setFilterEventType('');
    setSearchPattern('');
    setShowDuplicates(true);
  };

  const activeFilterCount = [filterTaskId, filterAgentId, filterEventType, searchPattern].filter(Boolean).length + (showDuplicates ? 0 : 1);

  // Count duplicates
  const duplicateCount = messages.filter(m => m.is_duplicate).length;

  return (
    <div className="conversation-view">
      {/* Filter Panel */}
      <div className="conversation-filters">
        <div className="filters-header">
          <button
            className="filters-toggle"
            onClick={() => setFiltersExpanded(!filtersExpanded)}
          >
            🔍 Filters {activeFilterCount > 0 && `(${activeFilterCount} active)`}
            <span className={`arrow ${filtersExpanded ? 'expanded' : ''}`}>▼</span>
          </button>
          {activeFilterCount > 0 && (
            <button className="clear-filters" onClick={clearFilters}>Clear All</button>
          )}
          <div className="filter-stats">
            {filteredMessages.length} / {messages.length} messages
            {duplicateCount > 0 && ` • ${duplicateCount} duplicates`}
          </div>
        </div>

        {filtersExpanded && (
          <div className="filters-content">
            <div className="filter-row">
              <div className="filter-group">
                <label>Task:</label>
                <select
                  value={filterTaskId}
                  onChange={(e) => setFilterTaskId(e.target.value)}
                >
                  <option value="">All Tasks</option>
                  {uniqueTaskIds.map(id => (
                    <option key={id} value={id}>{getTaskName(id)}</option>
                  ))}
                </select>
              </div>

              <div className="filter-group">
                <label>Agent:</label>
                <select
                  value={filterAgentId}
                  onChange={(e) => setFilterAgentId(e.target.value)}
                >
                  <option value="">All Agents</option>
                  {uniqueAgentIds.map(id => (
                    <option key={id} value={id}>{getAgentName(id)}</option>
                  ))}
                </select>
              </div>

              <div className="filter-group">
                <label>Type:</label>
                <select
                  value={filterEventType}
                  onChange={(e) => setFilterEventType(e.target.value)}
                >
                  <option value="">All Types</option>
                  {uniqueEventTypes.map(type => (
                    <option key={type} value={type}>{getMessageTypeLabel(type)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="filter-row">
              <div className="filter-group search-group">
                <label>Search:</label>
                <input
                  type="text"
                  placeholder="Search messages, agents..."
                  value={searchPattern}
                  onChange={(e) => setSearchPattern(e.target.value)}
                />
              </div>

              <div className="filter-group checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={showDuplicates}
                    onChange={(e) => setShowDuplicates(e.target.checked)}
                  />
                  Show duplicates
                </label>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Messages Container */}
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
                      } ${isThreaded ? 'threaded' : ''} ${
                        msg.is_duplicate ? 'duplicate' : ''
                      }`}
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
                          {msg.is_duplicate && (
                            <span className="duplicate-badge" title={`Duplicate group: ${msg.duplicate_group_id} (${msg.duplicate_count} total)`}>
                              🔄 Duplicate
                            </span>
                          )}
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

        {filteredMessages.length === 0 && (
          <div className="no-data">
            No messages match the current filters.
            <button className="clear-filters-link" onClick={clearFilters}>Clear filters</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConversationView;
