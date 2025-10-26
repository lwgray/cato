import { create } from 'zustand';
import { Snapshot, Task, Agent, Message, Metrics, Project, fetchSnapshot, fetchProjects, checkApiHealth } from '../services/dataService';
import { generateMockData } from '../data/mockDataGenerator';
import type { Task as MockTask, Agent as MockAgent, Message as MockMessage } from '../data/mockDataGenerator';

export type ViewLayer = 'network' | 'swimlanes' | 'conversations';
export type DataMode = 'live' | 'mock';
export type TaskView = 'subtasks' | 'parents' | 'all';

// Helper function to convert mock data to Snapshot format
function convertMockDataToSnapshot(mockData: ReturnType<typeof generateMockData>): { tasks: Task[], agents: Agent[], messages: Message[], metrics: Metrics } {
  const tasks: Task[] = mockData.tasks.map((mockTask: MockTask) => ({
    id: mockTask.id,
    name: mockTask.name,
    description: mockTask.description,
    status: mockTask.status as 'todo' | 'in_progress' | 'done' | 'blocked',
    priority: mockTask.priority as 'low' | 'medium' | 'high' | 'urgent',
    progress_percent: mockTask.progress,
    created_at: mockTask.created_at,
    started_at: null,
    completed_at: null,
    updated_at: mockTask.updated_at,
    estimated_hours: mockTask.estimated_hours,
    actual_hours: mockTask.actual_hours,
    parent_task_id: mockTask.parent_task_id,
    parent_task_name: null,
    is_subtask: mockTask.is_subtask,
    subtask_index: mockTask.subtask_index,
    project_id: mockTask.project_id,
    project_name: mockTask.project_name,
    assigned_agent_id: mockTask.assigned_to,
    assigned_agent_name: null,
    assigned_agent_role: null,
    dependency_ids: mockTask.dependencies || [],
    dependent_task_ids: [],
    timeline_linear_position: 0,
    timeline_scaled_position: 0,
    timeline_scale_exponent: 0.4,
    labels: mockTask.labels,
    metadata: {},
  }));

  const agents: Agent[] = mockData.agents.map((mockAgent: MockAgent) => ({
    id: mockAgent.id,
    name: mockAgent.name,
    role: mockAgent.role,
    skills: mockAgent.skills,
    current_task_ids: mockAgent.current_tasks,
    current_task_names: [],
    completed_task_ids: [],
    completed_tasks_count: mockAgent.completed_tasks_count,
    total_hours_worked: 0,
    average_task_duration_hours: 0,
    performance_score: mockAgent.performance_score,
    capacity_utilization: mockAgent.autonomy_score,
    messages_sent: 0,
    messages_received: 0,
    blockers_reported: 0,
  }));

  const messages: Message[] = mockData.messages.map((mockMsg: MockMessage) => ({
    id: mockMsg.id,
    timestamp: mockMsg.timestamp,
    message: mockMsg.message,
    type: mockMsg.type as 'instruction' | 'question' | 'answer' | 'status_update' | 'blocker' | 'task_assignment',
    from_agent_id: mockMsg.from,
    from_agent_name: mockMsg.from,
    to_agent_id: mockMsg.to,
    to_agent_name: mockMsg.to,
    task_id: mockMsg.task_id,
    task_name: null,
    parent_message_id: mockMsg.parent_message_id,
    metadata: mockMsg.metadata,
  }));

  // Create metrics from mock data
  const metrics: Metrics = {
    total_tasks: tasks.length,
    completed_tasks: tasks.filter(t => t.status === 'done').length,
    in_progress_tasks: tasks.filter(t => t.status === 'in_progress').length,
    blocked_tasks: tasks.filter(t => t.status === 'blocked').length,
    completion_rate: tasks.length > 0 ? (tasks.filter(t => t.status === 'done').length / tasks.length) * 100 : 0,
    total_duration_minutes: mockData.metadata.total_duration_minutes,
    average_task_duration_hours: 2.5,
    peak_parallel_tasks: mockData.metadata.parallelization_level,
    average_parallel_tasks: mockData.metadata.parallelization_level,
    parallelization_efficiency: 0.8,
    total_agents: agents.length,
    active_agents: agents.filter(a => a.current_task_ids.length > 0).length,
    tasks_per_agent: agents.length > 0 ? tasks.length / agents.length : 0,
    total_blockers: tasks.filter(t => t.status === 'blocked').length,
    blocked_task_percentage: tasks.length > 0 ? (tasks.filter(t => t.status === 'blocked').length / tasks.length) * 100 : 0,
  };

  return { tasks, agents, messages, metrics };
}

interface VisualizationState {
  // Snapshot data (denormalized, pre-calculated)
  snapshot: Snapshot | null;
  dataMode: DataMode;
  isLoading: boolean;
  loadError: string | null;

  // Projects list
  projects: Project[];

  // Project filtering (now handled by snapshot)
  selectedProjectId: string | null;

  // Playback state
  currentTime: number; // milliseconds since simulation start
  isPlaying: boolean;
  playbackSpeed: number; // 0.5, 1, 2, 5, 10
  animationIntervalId: number | null;

  // Auto-refresh state
  autoRefreshEnabled: boolean;
  autoRefreshIntervalId: number | null;
  autoRefreshInterval: number; // milliseconds (default 5000 = 5 seconds)

  // View state
  currentLayer: ViewLayer;
  taskView: TaskView;
  selectedTaskId: string | null;
  selectedAgentId: string | null;
  selectedMessageId: string | null;

  // Filter state (client-side filtering)
  showCompletedTasks: boolean;
  showBlockedTasks: boolean;
  filteredAgentIds: string[];

  // Actions
  loadData: (mode?: DataMode, projectId?: string) => Promise<void>;
  loadProjects: () => Promise<void>;
  setSelectedProject: (projectId: string | null) => void;
  startAutoRefresh: () => void;
  stopAutoRefresh: () => void;
  setAutoRefreshInterval: (interval: number) => void;
  setCurrentTime: (time: number) => void;
  play: () => void;
  pause: () => void;
  setPlaybackSpeed: (speed: number) => void;
  setCurrentLayer: (layer: ViewLayer) => void;
  setTaskView: (view: TaskView) => void;
  selectTask: (taskId: string | null) => void;
  selectAgent: (agentId: string | null) => void;
  selectMessage: (messageId: string | null) => void;
  toggleShowCompletedTasks: () => void;
  toggleShowBlockedTasks: () => void;
  setFilteredAgentIds: (agentIds: string[]) => void;
  reset: () => void;
  refreshData: () => Promise<void>;

  // Derived getters
  getVisibleTasks: () => Task[];
  getMessagesUpToCurrentTime: () => Message[];
  getActiveAgentsAtCurrentTime: () => Agent[];
  getMetrics: () => Metrics | null;
}

export const useVisualizationStore = create<VisualizationState>((set, get) => {
  return {
    snapshot: null,
    dataMode: 'mock',
    isLoading: false,
    loadError: null,
    projects: [],
    selectedProjectId: null,
    autoRefreshEnabled: false,
    autoRefreshIntervalId: null,
    autoRefreshInterval: 5000, // 5 seconds default
    currentTime: 0,
    isPlaying: false,
    playbackSpeed: 1,
    animationIntervalId: null,
    currentLayer: 'network',
    taskView: 'subtasks',
    selectedTaskId: null,
    selectedAgentId: null,
    selectedMessageId: null,
    showCompletedTasks: true,
    showBlockedTasks: true,
    filteredAgentIds: [],

    loadData: async (mode?: DataMode, projectId?: string) => {
      const dataMode = mode || (import.meta.env.VITE_DATA_MODE as DataMode) || 'mock';

      set({ isLoading: true, loadError: null });

      try {
        let newSnapshot: Snapshot;

        if (dataMode === 'live') {
          // Check if API is available
          const isApiHealthy = await checkApiHealth();

          if (!isApiHealthy) {
            console.warn('API not available, falling back to mock data');
            // Convert mock data to snapshot format
            const mockData = generateMockData();
            const converted = convertMockDataToSnapshot(mockData);
            newSnapshot = {
              snapshot_id: 'mock-snapshot',
              snapshot_version: 1,
              timestamp: new Date().toISOString(),
              project_id: null,
              project_name: 'Mock Project',
              project_filter_applied: false,
              included_project_ids: [],
              view_mode: get().taskView,
              tasks: converted.tasks,
              agents: converted.agents,
              messages: converted.messages,
              timeline_events: [],
              metrics: converted.metrics,
              start_time: mockData.metadata.start_time,
              end_time: mockData.metadata.end_time,
              duration_minutes: Math.round(
                (new Date(mockData.metadata.end_time).getTime() -
                  new Date(mockData.metadata.start_time).getTime()) /
                  60000
              ),
              task_dependency_graph: {},
              agent_communication_graph: {},
              timezone: 'UTC',
            };
            set({ dataMode: 'mock' });
          } else {
            // Fetch live snapshot from API
            console.log('Fetching live snapshot from API...');
            const { taskView } = get();
            newSnapshot = await fetchSnapshot(
              projectId,
              taskView,
              0.4, // Power scale exponent
              true // Use cache
            );
            set({ dataMode: 'live' });
          }
        } else {
          // Use mock data
          const mockData = generateMockData();
          const converted = convertMockDataToSnapshot(mockData);
          newSnapshot = {
            snapshot_id: 'mock-snapshot',
            snapshot_version: 1,
            timestamp: new Date().toISOString(),
            project_id: null,
            project_name: 'Mock Project',
            project_filter_applied: false,
            included_project_ids: [],
            view_mode: get().taskView,
            tasks: converted.tasks,
            agents: converted.agents,
            messages: converted.messages,
            timeline_events: [],
            metrics: converted.metrics,
            start_time: mockData.metadata.start_time,
            end_time: mockData.metadata.end_time,
            duration_minutes: Math.round(
              (new Date(mockData.metadata.end_time).getTime() -
                new Date(mockData.metadata.start_time).getTime()) /
                60000
            ),
            task_dependency_graph: {},
            agent_communication_graph: {},
            timezone: 'UTC',
          };
          set({ dataMode: 'mock' });
        }

        // Update store - preserve currentTime if animation is playing
        const currentState = get();
        set({
          snapshot: newSnapshot,
          isLoading: false,
          currentTime: currentState.isPlaying ? currentState.currentTime : 0,
        });

        console.log(`Snapshot loaded successfully in ${dataMode} mode`);

        // Start auto-refresh if in live mode and not already running
        const state = get();
        if (dataMode === 'live' && !state.autoRefreshEnabled) {
          get().startAutoRefresh();
        } else if (dataMode === 'mock' && state.autoRefreshEnabled) {
          get().stopAutoRefresh();
        }
      } catch (error) {
        console.error('Error loading snapshot:', error);

        // Fallback to mock data on error
        const mockData = generateMockData();
        const converted = convertMockDataToSnapshot(mockData);
        const mockSnapshot: Snapshot = {
          snapshot_id: 'mock-snapshot-error',
          snapshot_version: 1,
          timestamp: new Date().toISOString(),
          project_id: null,
          project_name: 'Mock Project (Error Fallback)',
          project_filter_applied: false,
          included_project_ids: [],
          view_mode: 'subtasks',
          tasks: converted.tasks,
          agents: converted.agents,
          messages: converted.messages,
          timeline_events: [],
          metrics: converted.metrics,
          start_time: mockData.metadata.start_time,
          end_time: mockData.metadata.end_time,
          duration_minutes: Math.round(
            (new Date(mockData.metadata.end_time).getTime() -
              new Date(mockData.metadata.start_time).getTime()) /
              60000
          ),
          task_dependency_graph: {},
          agent_communication_graph: {},
          timezone: 'UTC',
        };

        set({
          snapshot: mockSnapshot,
          dataMode: 'mock',
          isLoading: false,
          loadError: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },

    refreshData: async () => {
      const { dataMode, selectedProjectId } = get();
      await get().loadData(dataMode, selectedProjectId || undefined);
    },

    loadProjects: async () => {
      try {
        const projects = await fetchProjects();
        set({ projects });
        console.log(`Loaded ${projects.length} projects`);

        // Auto-select the first (most recent) project if none is selected
        const currentState = get();
        if (projects.length > 0 && !currentState.selectedProjectId) {
          const firstProject = projects[0];
          console.log(`Auto-selecting most recent project: ${firstProject.name}`);
          await get().setSelectedProject(firstProject.id);
        }
      } catch (error) {
        console.error('Error loading projects:', error);
        set({ projects: [] });
      }
    },

    setSelectedProject: async (projectId: string | null) => {
      set({ selectedProjectId: projectId });

      // Reload data with the new project filter
      const { dataMode } = get();
      if (dataMode === 'live') {
        await get().loadData(dataMode, projectId || undefined);
      }
    },

    startAutoRefresh: () => {
      const current = get();

      // Only enable for live data mode
      if (current.dataMode !== 'live') {
        console.log('Auto-refresh only available in live data mode');
        return;
      }

      // Clear any existing interval
      if (current.autoRefreshIntervalId) {
        window.clearInterval(current.autoRefreshIntervalId);
      }

      set({ autoRefreshEnabled: true });

      // Start polling
      const intervalId = window.setInterval(() => {
        const state = get();
        if (!state.autoRefreshEnabled || state.dataMode !== 'live') {
          get().stopAutoRefresh();
          return;
        }

        console.log('Auto-refreshing snapshot...');
        get().refreshData();
      }, current.autoRefreshInterval);

      set({ autoRefreshIntervalId: intervalId });
      console.log(`Auto-refresh started (polling every ${current.autoRefreshInterval}ms)`);
    },

    stopAutoRefresh: () => {
      const current = get();
      if (current.autoRefreshIntervalId) {
        window.clearInterval(current.autoRefreshIntervalId);
      }
      set({ autoRefreshEnabled: false, autoRefreshIntervalId: null });
      console.log('Auto-refresh stopped');
    },

    setAutoRefreshInterval: (interval: number) => {
      set({ autoRefreshInterval: interval });

      // Restart auto-refresh with new interval if it's running
      const current = get();
      if (current.autoRefreshEnabled) {
        get().stopAutoRefresh();
        get().startAutoRefresh();
      }
    },

    setCurrentTime: (time) => set({ currentTime: time }),

    play: () => {
      const current = get();
      const snapshot = current.snapshot;

      if (!snapshot || !snapshot.start_time || !snapshot.end_time) {
        console.warn('Cannot play: snapshot not loaded or missing time boundaries');
        return;
      }

      // Clear any existing interval first
      if (current.animationIntervalId) {
        window.clearInterval(current.animationIntervalId);
      }

      set({ isPlaying: true });

      // Animation loop
      const startTime = new Date(snapshot.start_time).getTime();
      const endTime = new Date(snapshot.end_time).getTime();
      const totalDuration = endTime - startTime;
      const targetPlaybackDuration = 150000; // 150 seconds at 1x speed
      const tickInterval = 50; // 50ms per tick
      const timePerTick = (totalDuration / targetPlaybackDuration) * tickInterval;

      const animationInterval = window.setInterval(() => {
        const state = get();
        if (!state.isPlaying) {
          window.clearInterval(animationInterval);
          set({ animationIntervalId: null });
          return;
        }

        const newTime = state.currentTime + timePerTick * state.playbackSpeed;

        if (newTime >= totalDuration) {
          set({ currentTime: totalDuration, isPlaying: false, animationIntervalId: null });
          window.clearInterval(animationInterval);
        } else {
          set({ currentTime: newTime });
        }
      }, tickInterval);

      set({ animationIntervalId: animationInterval });
    },

    pause: () => {
      const current = get();
      if (current.animationIntervalId) {
        window.clearInterval(current.animationIntervalId);
      }
      set({ isPlaying: false, animationIntervalId: null });
    },

    setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),

    setCurrentLayer: (layer) => set({ currentLayer: layer }),

    setTaskView: async (view) => {
      set({ taskView: view });

      // Reload data with the new task view
      const { dataMode, selectedProjectId } = get();
      if (dataMode === 'live') {
        await get().loadData(dataMode, selectedProjectId || undefined);
      }
    },

    selectTask: (taskId) => set({ selectedTaskId: taskId }),

    selectAgent: (agentId) => set({ selectedAgentId: agentId }),

    selectMessage: (messageId) => set({ selectedMessageId: messageId }),

    toggleShowCompletedTasks: () =>
      set((state) => ({ showCompletedTasks: !state.showCompletedTasks })),

    toggleShowBlockedTasks: () =>
      set((state) => ({ showBlockedTasks: !state.showBlockedTasks })),

    setFilteredAgentIds: (agentIds) => set({ filteredAgentIds: agentIds }),

    reset: () => {
      const current = get();
      if (current.animationIntervalId) {
        window.clearInterval(current.animationIntervalId);
      }
      set({
        currentTime: 0,
        isPlaying: false,
        animationIntervalId: null,
        selectedTaskId: null,
        selectedAgentId: null,
        selectedMessageId: null,
      });
    },

    getVisibleTasks: () => {
      const state = get();
      const snapshot = state.snapshot;

      if (!snapshot) return [];

      let tasks = snapshot.tasks;

      if (!state.showCompletedTasks) {
        tasks = tasks.filter((t) => t.status !== 'done');
      }

      if (!state.showBlockedTasks) {
        tasks = tasks.filter((t) => t.status !== 'blocked');
      }

      if (state.filteredAgentIds.length > 0) {
        tasks = tasks.filter(
          (t) => t.assigned_agent_id && state.filteredAgentIds.includes(t.assigned_agent_id)
        );
      }

      return tasks;
    },

    getMessagesUpToCurrentTime: () => {
      const state = get();
      const snapshot = state.snapshot;

      if (!snapshot || !snapshot.start_time) return [];

      const startTime = new Date(snapshot.start_time).getTime();
      const currentAbsTime = startTime + state.currentTime;

      return snapshot.messages.filter((msg) => {
        const msgTime = new Date(msg.timestamp).getTime();
        return msgTime <= currentAbsTime;
      });
    },

    getActiveAgentsAtCurrentTime: () => {
      const state = get();
      const snapshot = state.snapshot;

      if (!snapshot || !snapshot.start_time) return [];

      const startTime = new Date(snapshot.start_time).getTime();
      const currentAbsTime = startTime + state.currentTime;

      // Determine which agents have active tasks at current time
      const activeTasks = snapshot.tasks.filter((task) => {
        const taskStart = new Date(task.created_at).getTime();
        const taskEnd = new Date(task.updated_at).getTime();
        return (
          taskStart <= currentAbsTime &&
          taskEnd >= currentAbsTime &&
          task.status === 'in_progress'
        );
      });

      const activeAgentIds = new Set(
        activeTasks.map((t) => t.assigned_agent_id).filter(Boolean) as string[]
      );

      return snapshot.agents.filter((agent) => activeAgentIds.has(agent.id));
    },

    getMetrics: () => {
      const state = get();
      return state.snapshot?.metrics || null;
    },
  };
});
