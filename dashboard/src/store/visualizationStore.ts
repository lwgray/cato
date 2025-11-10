import { create } from 'zustand';
import { Snapshot, Task, Agent, Message, Metrics, Project, fetchSnapshot, fetchProjects } from '../services/dataService';

export type ViewLayer = 'network' | 'swimlanes' | 'conversations';
export type TaskView = 'subtasks' | 'parents' | 'all';

interface VisualizationState {
  // Snapshot data (denormalized, pre-calculated)
  snapshot: Snapshot | null;
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

  // View state
  currentLayer: ViewLayer;
  selectedTaskId: string | null;
  selectedAgentId: string | null;
  selectedMessageId: string | null;

  // Filter state (client-side filtering)
  showCompletedTasks: boolean;
  showBlockedTasks: boolean;
  filteredAgentIds: string[];

  // Auto-refresh state
  autoRefreshIntervalId: number | null;
  autoRefreshInterval: number; // milliseconds

  // Actions
  loadData: (projectId?: string) => Promise<void>;
  loadProjects: () => Promise<void>;
  setSelectedProject: (projectId: string | null) => void;
  setCurrentTime: (time: number) => void;
  play: () => void;
  pause: () => void;
  setPlaybackSpeed: (speed: number) => void;
  setCurrentLayer: (layer: ViewLayer) => void;
  selectTask: (taskId: string | null) => void;
  selectAgent: (agentId: string | null) => void;
  selectMessage: (messageId: string | null) => void;
  toggleShowCompletedTasks: () => void;
  toggleShowBlockedTasks: () => void;
  setFilteredAgentIds: (agentIds: string[]) => void;
  reset: () => void;
  refreshData: () => Promise<void>;
  startAutoRefresh: () => void;
  stopAutoRefresh: () => void;

  // Derived getters
  getVisibleTasks: () => Task[];
  getMessagesUpToCurrentTime: () => Message[];
  getActiveAgentsAtCurrentTime: () => Agent[];
  getMetrics: () => Metrics | null;
}

export const useVisualizationStore = create<VisualizationState>((set, get) => {
  return {
    snapshot: null,
    isLoading: false,
    loadError: null,
    projects: [],
    selectedProjectId: null,
    currentTime: 0,
    isPlaying: false,
    playbackSpeed: 1,
    animationIntervalId: null,
    currentLayer: 'network',
    selectedTaskId: null,
    selectedAgentId: null,
    selectedMessageId: null,
    showCompletedTasks: true,
    showBlockedTasks: true,
    filteredAgentIds: [],
    autoRefreshIntervalId: null,
    autoRefreshInterval: 60000, // 60 seconds

    loadData: async (projectId?: string) => {
      set({ isLoading: true, loadError: null });

      try {
        // Fetch live snapshot from API
        console.log('Fetching live snapshot from API...');
        const newSnapshot = await fetchSnapshot(
          projectId,
          'subtasks', // Always use subtasks view
          0.4, // Power scale exponent
          true // Use cache
        );

        // Update store - preserve currentTime to avoid resetting playback position
        const currentState = get();
        set({
          snapshot: newSnapshot,
          isLoading: false,
          currentTime: currentState.currentTime,
        });

        console.log('Snapshot loaded successfully');
      } catch (error) {
        console.error('Error loading snapshot:', error);
        set({
          isLoading: false,
          loadError: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },

    refreshData: async () => {
      const { selectedProjectId } = get();

      // Reload projects list to detect new projects
      await get().loadProjects();
      await get().loadData(selectedProjectId || undefined);
    },

    loadProjects: async () => {
      try {
        const projects = await fetchProjects();
        set({ projects });
        console.log(`Loaded ${projects.length} projects`);

        const currentState = get();
        const currentProjectId = currentState.selectedProjectId;

        // Check if currently selected project still exists
        const projectStillExists =
          currentProjectId && projects.some((p) => p.id === currentProjectId);

        // Auto-select first project if:
        // 1. No project is selected, OR
        // 2. Previously selected project no longer exists
        if (projects.length > 0 && (!currentProjectId || !projectStillExists)) {
          const firstProject = projects[0];
          if (!projectStillExists && currentProjectId) {
            console.log(
              `Previously selected project ${currentProjectId} no longer exists`
            );
          }
          console.log(`Auto-selecting most recent project: ${firstProject.name}`);
          await get().setSelectedProject(firstProject.id);
        }

        // Start auto-refresh after initial load
        get().startAutoRefresh();
      } catch (error) {
        console.error('Error loading projects:', error);
        set({ projects: [] });
      }
    },

    setSelectedProject: async (projectId: string | null) => {
      set({ selectedProjectId: projectId });

      // Reload data with the new project filter
      await get().loadData(projectId || undefined);
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

    startAutoRefresh: () => {
      const current = get();

      // Don't start if already running
      if (current.autoRefreshIntervalId) {
        console.log('Auto-refresh already running');
        return;
      }

      console.log(`Starting auto-refresh with ${current.autoRefreshInterval / 1000}s interval`);

      const intervalId = window.setInterval(() => {
        console.log('Auto-refreshing data...');
        get().refreshData();
      }, current.autoRefreshInterval);

      set({
        autoRefreshIntervalId: intervalId,
      });
    },

    stopAutoRefresh: () => {
      const current = get();

      if (current.autoRefreshIntervalId) {
        console.log('Stopping auto-refresh');
        window.clearInterval(current.autoRefreshIntervalId);
        set({
          autoRefreshIntervalId: null,
        });
      }
    },
  };
});
