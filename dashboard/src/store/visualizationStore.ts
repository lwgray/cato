import { create } from 'zustand';
import { Snapshot, Task, Agent, Message, Metrics, Project, fetchSnapshot, fetchProjects } from '../services/dataService';

export type ViewLayer =
  | 'network'
  | 'swimlanes'
  | 'conversations'
  | 'health'
  | 'retrospective'
  | 'fidelity'
  | 'decisions'
  | 'failures';
export type TaskView = 'subtasks' | 'parents' | 'all';
export type ViewMode = 'live' | 'historical';

interface VisualizationState {
  // Mode state
  viewMode: ViewMode;

  // Snapshot data (denormalized, pre-calculated)
  snapshot: Snapshot | null;
  isLoading: boolean;
  loadError: string | null;
  loadingStatus: string | null; // Status message for what's being loaded

  // Projects list (live mode)
  projects: Project[];

  // Historical mode state
  historicalProjects: any[]; // TODO: Define HistoricalProject type
  selectedHistoricalProjectId: string | null;
  historicalAnalysis: any | null; // TODO: Define HistoricalAnalysis type

  // Caching state
  historicalProjectsCache: { data: any[]; timestamp: number } | null;
  historicalAnalysisCache: Map<string, { data: any; timestamp: number }>;
  cacheExpiryMs: number; // 30 days default

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
  setViewMode: (mode: ViewMode) => void;
  loadData: (projectId?: string) => Promise<void>;
  loadProjects: () => Promise<void>;
  loadHistoricalProjects: () => Promise<void>;
  setSelectedProject: (projectId: string | null) => void;
  setSelectedHistoricalProject: (projectId: string | null) => void;
  loadHistoricalAnalysis: (projectId: string) => Promise<void>;
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
    viewMode: 'live', // Default to live mode
    snapshot: null,
    isLoading: false,
    loadError: null,
    loadingStatus: null,
    projects: [],
    historicalProjects: [],
    selectedHistoricalProjectId: null,
    historicalAnalysis: null,
    historicalProjectsCache: null,
    historicalAnalysisCache: new Map(),
    cacheExpiryMs: 30 * 24 * 60 * 60 * 1000, // 30 days
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
          1.0, // Power scale exponent (linear timeline)
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

        // Sort projects by most recent (last_used or created_at)
        const sortedProjects = [...projects].sort((a, b) => {
          const aTime = new Date(a.last_used || a.created_at).getTime();
          const bTime = new Date(b.last_used || b.created_at).getTime();
          return bTime - aTime; // Most recent first
        });

        set({ projects: sortedProjects });
        console.log(`Loaded ${sortedProjects.length} projects (sorted by most recent)`);

        const currentState = get();
        const currentProjectId = currentState.selectedProjectId;

        // Check if currently selected project still exists
        const projectStillExists =
          currentProjectId && sortedProjects.some((p) => p.id === currentProjectId);

        // Auto-select most recent project if:
        // 1. No project is selected, OR
        // 2. Previously selected project no longer exists
        if (sortedProjects.length > 0 && (!currentProjectId || !projectStillExists)) {
          const newestProject = sortedProjects[0]; // First item is most recent
          if (!projectStillExists && currentProjectId) {
            console.log(
              `Previously selected project ${currentProjectId} no longer exists`
            );
          }
          console.log(`Auto-selecting newest project: ${newestProject.name}`);
          await get().setSelectedProject(newestProject.id);
        }

        // Start auto-refresh after initial load (only in live mode)
        const currentMode = get().viewMode;
        if (currentMode === 'live') {
          get().startAutoRefresh();
        }
      } catch (error) {
        console.error('Error loading projects:', error);
        set({ projects: [] });
      }
    },

    loadHistoricalProjects: async () => {
      const state = get();

      // Check cache first
      if (state.historicalProjectsCache) {
        const age = Date.now() - state.historicalProjectsCache.timestamp;
        if (age < state.cacheExpiryMs) {
          console.log(`[loadHistoricalProjects] Using cached data (age: ${Math.round(age / 1000)}s)`);
          set({
            historicalProjects: state.historicalProjectsCache.data,
            loadingStatus: null
          });

          // Auto-select if needed
          if (state.historicalProjectsCache.data.length > 0 && !state.selectedHistoricalProjectId) {
            const firstProject = state.historicalProjectsCache.data[0];
            console.log('[loadHistoricalProjects] Auto-selecting from cache:', firstProject.project_name);
            await get().setSelectedHistoricalProject(firstProject.project_id);
          }
          return;
        }
        console.log('[loadHistoricalProjects] Cache expired, fetching fresh data');
      }

      try {
        console.log('[loadHistoricalProjects] Using SSE streaming endpoint...');

        // Use SSE streaming endpoint for progress updates
        const eventSource = new EventSource('http://localhost:4301/api/historical/projects/stream');

        return new Promise((resolve, reject) => {
          eventSource.onmessage = async (event) => {
            try {
              const data = JSON.parse(event.data);
              console.log('[loadHistoricalProjects] SSE event:', data);

              if (data.type === 'log' || data.type === 'progress') {
                // Update loading status with progress message
                set({ loadingStatus: data.message });
              } else if (data.type === 'complete') {
                console.log('[loadHistoricalProjects] Loading complete!');
                eventSource.close();

                const historicalProjects = data.data?.projects || [];

                // Update cache and state
                set({
                  historicalProjects,
                  historicalProjectsCache: {
                    data: historicalProjects,
                    timestamp: Date.now()
                  },
                  loadingStatus: null
                });

                // Auto-select first project if available and none selected
                if (historicalProjects.length > 0 && !get().selectedHistoricalProjectId) {
                  const firstProject = historicalProjects[0];
                  console.log('[loadHistoricalProjects] Auto-selecting:', firstProject.project_name);
                  await get().setSelectedHistoricalProject(firstProject.project_id);
                  resolve();
                } else {
                  resolve();
                }
              } else if (data.type === 'error') {
                console.error('[loadHistoricalProjects] Error:', data.message);
                set({ historicalProjects: [], loadingStatus: null });
                eventSource.close();
                reject(new Error(data.message));
              }
            } catch (err) {
              console.error('[loadHistoricalProjects] Failed to parse SSE event:', err);
            }
          };

          eventSource.onerror = (err) => {
            console.error('[loadHistoricalProjects] EventSource error:', err);
            set({ historicalProjects: [], loadingStatus: null });
            eventSource.close();
            reject(new Error('Connection lost. Please refresh and try again.'));
          };
        });
      } catch (error) {
        console.error('[loadHistoricalProjects] Error:', error);
        set({ historicalProjects: [], loadingStatus: null });
      }
    },

    setSelectedProject: async (projectId: string | null) => {
      set({ selectedProjectId: projectId });

      // Reload data with the new project filter
      await get().loadData(projectId || undefined);
    },

    setSelectedHistoricalProject: async (projectId: string | null) => {
      set({ selectedHistoricalProjectId: projectId });

      // Load historical analysis for the selected project
      if (projectId) {
        await get().loadHistoricalAnalysis(projectId);
      } else {
        set({ historicalAnalysis: null });
      }
    },

    setViewMode: async (mode: ViewMode) => {
      console.log(`[setViewMode] Switching from ${get().viewMode} to ${mode}`);
      set({ viewMode: mode });

      // Switch to appropriate layer for the mode
      if (mode === 'live') {
        // Switch to network graph for live mode
        console.log('[setViewMode] Switching to live mode: setting layer to network');
        set({ currentLayer: 'network' });
        // Load live projects only if not already loaded
        const currentState = get();
        if (currentState.projects.length === 0) {
          console.log('[setViewMode] No cached projects, loading live projects...');
          await get().loadProjects();
        } else {
          console.log(`[setViewMode] Using cached projects (${currentState.projects.length} projects)`);
        }
      } else {
        // Switch to retrospective for historical mode
        console.log('[setViewMode] Switching to historical mode: setting layer to retrospective');
        set({ currentLayer: 'retrospective' });
        get().stopAutoRefresh(); // Historical data is static
        // Load historical projects only if not already loaded
        const currentState = get();
        if (currentState.historicalProjects.length === 0) {
          console.log('[setViewMode] No cached historical projects, loading...');
          await get().loadHistoricalProjects();
        } else {
          console.log(`[setViewMode] Using cached historical projects (${currentState.historicalProjects.length} projects)`);
        }
      }

      console.log(`[setViewMode] Mode switch complete: ${mode}`);
    },

    loadHistoricalAnalysis: async (projectId: string) => {
      const state = get();

      // Check if already loading this project (prevent duplicate calls)
      if (state.isLoading && state.selectedHistoricalProjectId === projectId) {
        console.log(`[loadHistoricalAnalysis] Already loading analysis for ${projectId}, skipping`);
        return;
      }

      // Check cache first
      const cached = state.historicalAnalysisCache.get(projectId);
      if (cached) {
        const age = Date.now() - cached.timestamp;
        if (age < state.cacheExpiryMs) {
          console.log(`[loadHistoricalAnalysis] Using cached analysis for ${projectId} (age: ${Math.round(age / 1000)}s)`);
          set({
            historicalAnalysis: cached.data,
            isLoading: false,
            loadingStatus: null,
            selectedHistoricalProjectId: projectId,
          });
          return;
        }
        console.log(`[loadHistoricalAnalysis] Cache expired for ${projectId}`);
      }

      // Set loading state - the AnalysisProgress component will handle
      // the actual SSE streaming and update the store when complete
      console.log(`[loadHistoricalAnalysis] Starting SSE stream for ${projectId}`);
      set({
        isLoading: true,
        loadError: null,
        loadingStatus: null,
        selectedHistoricalProjectId: projectId,
        historicalAnalysis: null, // Clear old data
      });
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
