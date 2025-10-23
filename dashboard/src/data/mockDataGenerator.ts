/**
 * Mock Data Generator for Multi-Agent Parallelization Visualization
 *
 * This generates realistic simulation data based on Marcus' actual data structures:
 * - Tasks with dependencies (from src/core/models.py)
 * - Agent/Worker states (WorkerStatus)
 * - Conversation messages (conversation_logger format)
 * - Events timeline for parallel execution visualization
 */

export enum TaskStatus {
  TODO = 'todo',
  IN_PROGRESS = 'in_progress',
  DONE = 'done',
  BLOCKED = 'blocked',
}

export enum Priority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export enum MessageType {
  INSTRUCTION = 'instruction',
  QUESTION = 'question',
  ANSWER = 'answer',
  STATUS_UPDATE = 'status_update',
  BLOCKER = 'blocker',
  TASK_REQUEST = 'task_request',
  TASK_ASSIGNMENT = 'task_assignment',
}

export interface Task {
  id: string;
  name: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  due_date: string | null;
  estimated_hours: number;
  actual_hours: number;
  dependencies: string[];
  labels: string[];
  project_id: string;
  project_name: string;
  is_subtask: boolean;
  parent_task_id: string | null;
  subtask_index: number | null;
  progress: number; // 0-100
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  skills: string[];
  current_tasks: string[];
  completed_tasks_count: number;
  capacity: number;
  performance_score: number;
  autonomy_score: number; // 0-1, how self-sufficient
}

export interface Message {
  id: string;
  timestamp: string;
  from: string; // 'marcus' or agent_id
  to: string;
  task_id: string | null;
  message: string;
  type: MessageType;
  parent_message_id: string | null;
  metadata: {
    blocking?: boolean;
    requires_response?: boolean;
    progress?: number;
    response_time?: number; // seconds
    resolves_blocker?: boolean;
  };
}

export interface Event {
  id: string;
  timestamp: string;
  event_type: string;
  agent_id: string | null;
  task_id: string | null;
  data: Record<string, any>;
}

export interface SimulationData {
  tasks: Task[];
  agents: Agent[];
  messages: Message[];
  events: Event[];
  metadata: {
    project_name: string;
    start_time: string;
    end_time: string;
    total_duration_minutes: number;
    parallelization_level: number; // max concurrent tasks
  };
}

/**
 * Generate realistic mock data for a parallel e-commerce project
 */
export function generateMockData(): SimulationData {
  const startTime = new Date('2025-01-15T09:00:00Z');

  // Define agents with varying skills and autonomy
  const agents: Agent[] = [
    {
      id: 'agent-1',
      name: 'Backend Senior Agent',
      role: 'Backend Developer',
      skills: ['python', 'django', 'postgres', 'api', 'authentication'],
      current_tasks: [],
      completed_tasks_count: 0,
      capacity: 40,
      performance_score: 1.2,
      autonomy_score: 0.92, // Very autonomous, asks few questions
    },
    {
      id: 'agent-2',
      name: 'Frontend Expert Agent',
      role: 'Frontend Developer',
      skills: ['react', 'typescript', 'css', 'responsive', 'ui'],
      current_tasks: [],
      completed_tasks_count: 0,
      capacity: 40,
      performance_score: 1.1,
      autonomy_score: 0.88,
    },
    {
      id: 'agent-3',
      name: 'Fullstack Junior Agent',
      role: 'Fullstack Developer',
      skills: ['python', 'react', 'database', 'api'],
      current_tasks: [],
      completed_tasks_count: 0,
      capacity: 40,
      performance_score: 0.9,
      autonomy_score: 0.65, // Asks more questions
    },
    {
      id: 'agent-4',
      name: 'Database Specialist Agent',
      role: 'Database Engineer',
      skills: ['postgres', 'database', 'migration', 'optimization'],
      current_tasks: [],
      completed_tasks_count: 0,
      capacity: 40,
      performance_score: 1.15,
      autonomy_score: 0.95,
    },
    {
      id: 'agent-5',
      name: 'DevOps Agent',
      role: 'DevOps Engineer',
      skills: ['docker', 'deployment', 'ci/cd', 'monitoring'],
      current_tasks: [],
      completed_tasks_count: 0,
      capacity: 40,
      performance_score: 1.0,
      autonomy_score: 0.85,
    },
  ];

  // Define project tasks with realistic dependencies
  const tasks: Task[] = [
    // Database tasks (can start immediately)
    {
      id: 'task-1',
      name: 'Design Database Schema',
      description: 'Design database schema for users, products, orders, and payments',
      status: TaskStatus.DONE,
      priority: Priority.HIGH,
      assigned_to: 'agent-4',
      created_at: new Date(startTime.getTime() + 0).toISOString(), // Starts immediately
      updated_at: new Date(startTime.getTime() + 45 * 60000).toISOString(),
      due_date: null,
      estimated_hours: 3,
      actual_hours: 2.5,
      dependencies: [],
      labels: ['database', 'design', 'foundation'],
      project_id: 'proj-ecommerce-001',
      project_name: 'E-Commerce Platform',
      is_subtask: false,
      parent_task_id: null,
      subtask_index: null,
      progress: 100,
    },
    {
      id: 'task-2',
      name: 'Create Database Migrations',
      description: 'Create initial migration files for all tables',
      status: TaskStatus.DONE,
      priority: Priority.HIGH,
      assigned_to: 'agent-4',
      created_at: new Date(startTime.getTime() + 45 * 60000).toISOString(), // Starts after task-1 completes
      updated_at: new Date(startTime.getTime() + 85 * 60000).toISOString(),
      due_date: null,
      estimated_hours: 2,
      actual_hours: 1.8,
      dependencies: ['task-1'],
      labels: ['database', 'migration'],
      project_id: 'proj-ecommerce-001',
      project_name: 'E-Commerce Platform',
      is_subtask: false,
      parent_task_id: null,
      subtask_index: null,
      progress: 100,
    },
    // Backend API tasks (depend on database)
    {
      id: 'task-3',
      name: 'Implement User Authentication API',
      description: 'Create JWT-based authentication with login, register, logout endpoints',
      status: TaskStatus.DONE,
      priority: Priority.URGENT,
      assigned_to: 'agent-1',
      created_at: new Date(startTime.getTime() + 85 * 60000).toISOString(), // Starts after task-2 completes
      updated_at: new Date(startTime.getTime() + 180 * 60000).toISOString(),
      due_date: null,
      estimated_hours: 8,
      actual_hours: 7.2,
      dependencies: ['task-2'],
      labels: ['backend', 'api', 'authentication', 'security'],
      project_id: 'proj-ecommerce-001',
      project_name: 'E-Commerce Platform',
      is_subtask: false,
      parent_task_id: null,
      subtask_index: null,
      progress: 100,
    },
    {
      id: 'task-4',
      name: 'Implement Product API',
      description: 'CRUD endpoints for products with search and filtering',
      status: TaskStatus.DONE,
      priority: Priority.HIGH,
      assigned_to: 'agent-3',
      created_at: new Date(startTime.getTime() + 85 * 60000).toISOString(), // Starts after task-2 completes (parallel with task-3)
      updated_at: new Date(startTime.getTime() + 195 * 60000).toISOString(),
      due_date: null,
      estimated_hours: 6,
      actual_hours: 7.5, // Took longer than estimated
      dependencies: ['task-2'],
      labels: ['backend', 'api', 'products'],
      project_id: 'proj-ecommerce-001',
      project_name: 'E-Commerce Platform',
      is_subtask: false,
      parent_task_id: null,
      subtask_index: null,
      progress: 100,
    },
    {
      id: 'task-5',
      name: 'Implement Shopping Cart API',
      description: 'Endpoints for cart management and checkout process',
      status: TaskStatus.IN_PROGRESS,
      priority: Priority.HIGH,
      assigned_to: 'agent-1',
      created_at: new Date(startTime.getTime() + 195 * 60000).toISOString(), // Starts after both task-3 and task-4 complete
      updated_at: new Date(startTime.getTime() + 220 * 60000).toISOString(), // Current simulation time (25 min elapsed)
      due_date: null,
      estimated_hours: 5,
      actual_hours: 3.0,
      dependencies: ['task-3', 'task-4'],
      labels: ['backend', 'api', 'cart', 'checkout'],
      project_id: 'proj-ecommerce-001',
      project_name: 'E-Commerce Platform',
      is_subtask: false,
      parent_task_id: null,
      subtask_index: null,
      progress: 65,
    },
    // Frontend tasks (depend on APIs)
    {
      id: 'task-6',
      name: 'Create Login/Register Components',
      description: 'React components for user authentication with form validation',
      status: TaskStatus.DONE,
      priority: Priority.HIGH,
      assigned_to: 'agent-2',
      created_at: new Date(startTime.getTime() + 180 * 60000).toISOString(), // Starts after task-3 completes
      updated_at: new Date(startTime.getTime() + 270 * 60000).toISOString(), // 90 min duration
      due_date: null,
      estimated_hours: 4,
      actual_hours: 4.2,
      dependencies: ['task-3'],
      labels: ['frontend', 'ui', 'authentication'],
      project_id: 'proj-ecommerce-001',
      project_name: 'E-Commerce Platform',
      is_subtask: false,
      parent_task_id: null,
      subtask_index: null,
      progress: 100,
    },
    {
      id: 'task-7',
      name: 'Create Product Listing Page',
      description: 'Product grid with search, filters, and pagination',
      status: TaskStatus.DONE,
      priority: Priority.MEDIUM,
      assigned_to: 'agent-2',
      created_at: new Date(startTime.getTime() + 195 * 60000).toISOString(), // Starts after task-4 completes
      updated_at: new Date(startTime.getTime() + 305 * 60000).toISOString(), // 110 min duration
      due_date: null,
      estimated_hours: 6,
      actual_hours: 5.8,
      dependencies: ['task-4'],
      labels: ['frontend', 'ui', 'products'],
      project_id: 'proj-ecommerce-001',
      project_name: 'E-Commerce Platform',
      is_subtask: false,
      parent_task_id: null,
      subtask_index: null,
      progress: 100,
    },
    {
      id: 'task-8',
      name: 'Create Shopping Cart UI',
      description: 'Interactive shopping cart with item management',
      status: TaskStatus.IN_PROGRESS,
      priority: Priority.HIGH,
      assigned_to: 'agent-3',
      created_at: new Date(startTime.getTime() + 210 * 60000).toISOString(), // Starts after task-5 completes
      updated_at: new Date(startTime.getTime() + 220 * 60000).toISOString(), // 10 min duration (still in progress)
      due_date: null,
      estimated_hours: 5,
      actual_hours: 2.5,
      dependencies: ['task-5'],
      labels: ['frontend', 'ui', 'cart'],
      project_id: 'proj-ecommerce-001',
      project_name: 'E-Commerce Platform',
      is_subtask: false,
      parent_task_id: null,
      subtask_index: null,
      progress: 45,
    },
    // DevOps tasks (can work in parallel)
    {
      id: 'task-9',
      name: 'Setup Docker Configuration',
      description: 'Docker compose for development and production environments',
      status: TaskStatus.DONE,
      priority: Priority.MEDIUM,
      assigned_to: 'agent-5',
      created_at: new Date(startTime.getTime() + 0).toISOString(), // Starts immediately (no dependencies)
      updated_at: new Date(startTime.getTime() + 120 * 60000).toISOString(),
      due_date: null,
      estimated_hours: 4,
      actual_hours: 3.8,
      dependencies: [],
      labels: ['devops', 'docker', 'infrastructure'],
      project_id: 'proj-ecommerce-001',
      project_name: 'E-Commerce Platform',
      is_subtask: false,
      parent_task_id: null,
      subtask_index: null,
      progress: 100,
    },
    {
      id: 'task-10',
      name: 'Configure CI/CD Pipeline',
      description: 'GitHub Actions for automated testing and deployment',
      status: TaskStatus.IN_PROGRESS,
      priority: Priority.MEDIUM,
      assigned_to: 'agent-5',
      created_at: new Date(startTime.getTime() + 120 * 60000).toISOString(), // Starts after task-9 completes
      updated_at: new Date(startTime.getTime() + 220 * 60000).toISOString(), // Current simulation time (100 min elapsed)
      due_date: null,
      estimated_hours: 6,
      actual_hours: 4.0,
      dependencies: ['task-9'],
      labels: ['devops', 'ci/cd', 'automation'],
      project_id: 'proj-ecommerce-001',
      project_name: 'E-Commerce Platform',
      is_subtask: false,
      parent_task_id: null,
      subtask_index: null,
      progress: 70,
    },
  ];

  // Generate realistic conversation timeline
  const messages: Message[] = [];
  const events: Event[] = [];
  let messageId = 1;
  let eventId = 1;
  let currentTime = startTime.getTime();

  // Helper function to add message and event
  const addMessage = (
    from: string,
    to: string,
    taskId: string | null,
    message: string,
    type: MessageType,
    metadata: Message['metadata'] = {},
    parentId: string | null = null,
    timeOffset: number = 0
  ) => {
    const msgTime = new Date(currentTime + timeOffset);
    const msg: Message = {
      id: `msg-${messageId++}`,
      timestamp: msgTime.toISOString(),
      from,
      to,
      task_id: taskId,
      message,
      type,
      parent_message_id: parentId,
      metadata,
    };
    messages.push(msg);

    // Create corresponding event
    events.push({
      id: `evt-${eventId++}`,
      timestamp: msgTime.toISOString(),
      event_type: type === MessageType.TASK_ASSIGNMENT ? 'task_assignment' : 'message',
      agent_id: from === 'marcus' ? to : from,
      task_id: taskId,
      data: { message_id: msg.id, type, from, to },
    });

    return msg.id;
  };

  // Simulate parallel task execution with realistic conversations

  // === Time 0-30min: Initial registrations and DB task start ===
  addMessage('agent-1', 'marcus', null, 'Registering as Backend Developer', MessageType.STATUS_UPDATE, {}, null, 0);
  addMessage('agent-2', 'marcus', null, 'Registering as Frontend Developer', MessageType.STATUS_UPDATE, {}, null, 30000);
  addMessage('agent-3', 'marcus', null, 'Registering as Fullstack Developer', MessageType.STATUS_UPDATE, {}, null, 60000);
  addMessage('agent-4', 'marcus', null, 'Registering as Database Engineer', MessageType.STATUS_UPDATE, {}, null, 90000);
  addMessage('agent-5', 'marcus', null, 'Registering as DevOps Engineer', MessageType.STATUS_UPDATE, {}, null, 120000);

  // Agent-4 and Agent-5 request tasks (can start immediately)
  currentTime += 5 * 60000; // +5min
  const req1 = addMessage('agent-4', 'marcus', null, 'Requesting next task', MessageType.TASK_REQUEST);
  addMessage('marcus', 'agent-4', 'task-1', 'Start implementing the database schema design. Design tables for users, products, orders, and payments with proper relationships.', MessageType.TASK_ASSIGNMENT, {}, req1, 5000);

  currentTime += 2 * 60000; // +7min
  const req2 = addMessage('agent-5', 'marcus', null, 'Requesting next task', MessageType.TASK_REQUEST);
  addMessage('marcus', 'agent-5', 'task-9', 'Setup Docker configuration for the project. Create docker-compose.yml for dev and prod environments.', MessageType.TASK_ASSIGNMENT, {}, req2, 3000);

  // === Time 30-45min: Agent-4 completes DB schema design ===
  currentTime += 25 * 60000; // +32min
  addMessage('agent-4', 'marcus', 'task-1', 'Progress update: Designed user and product tables with relationships', MessageType.STATUS_UPDATE, { progress: 50 }, null, 0);

  currentTime += 13 * 60000; // +45min
  addMessage('agent-4', 'marcus', 'task-1', 'Task completed! Database schema designed with 4 main tables and 2 junction tables.', MessageType.STATUS_UPDATE, { progress: 100 }, null, 0);

  // Agent-4 requests next task (migration)
  currentTime += 2 * 60000; // +47min
  const req3 = addMessage('agent-4', 'marcus', null, 'Requesting next task', MessageType.TASK_REQUEST);
  addMessage('marcus', 'agent-4', 'task-2', 'Create migration files for all database tables. Use the schema you just designed.', MessageType.TASK_ASSIGNMENT, {}, req3, 4000);

  // === Time 45-85min: Agent-4 works on migrations, Agent-5 on Docker ===
  currentTime += 20 * 60000; // +67min
  addMessage('agent-5', 'marcus', 'task-9', 'Progress update: Docker compose file created with postgres, redis, and app services', MessageType.STATUS_UPDATE, { progress: 60 }, null, 0);

  currentTime += 18 * 60000; // +85min
  addMessage('agent-4', 'marcus', 'task-2', 'Migration files completed and tested locally', MessageType.STATUS_UPDATE, { progress: 100 }, null, 0);

  // Now backend agents can start (DB ready)
  currentTime += 2 * 60000; // +87min
  const req4 = addMessage('agent-1', 'marcus', null, 'Requesting next task', MessageType.TASK_REQUEST);
  addMessage('marcus', 'agent-1', 'task-3', 'Implement user authentication API with JWT. Create login, register, and logout endpoints. Use the User table from migrations.', MessageType.TASK_ASSIGNMENT, {}, req4, 5000);

  const req5 = addMessage('agent-3', 'marcus', null, 'Requesting next task', MessageType.TASK_REQUEST);
  addMessage('marcus', 'agent-3', 'task-4', 'Implement Product API with CRUD operations. Add search and filtering capabilities.', MessageType.TASK_ASSIGNMENT, {}, req5, 6000);

  // === Time 90-120min: Multiple agents working in parallel ===
  currentTime += 10 * 60000; // +97min
  // Agent-3 (junior) asks question - demonstrating lower autonomy
  const quest1 = addMessage('agent-3', 'marcus', 'task-4', 'Should I implement pagination for the product list endpoint? The spec doesn\'t mention it.', MessageType.QUESTION, { blocking: true, requires_response: true }, null, 0);

  currentTime += 2 * 60000; // +99min
  addMessage('marcus', 'agent-3', 'task-4', 'Yes, implement pagination with default page size of 20. Add page and limit query parameters.', MessageType.ANSWER, { resolves_blocker: true, response_time: 120 }, quest1, 0);

  currentTime += 5 * 60000; // +104min
  addMessage('agent-3', 'marcus', 'task-4', 'Got it, implementing pagination now', MessageType.STATUS_UPDATE, {}, null, 0);

  currentTime += 16 * 60000; // +120min
  addMessage('agent-5', 'marcus', 'task-9', 'Docker configuration complete! All services starting correctly.', MessageType.STATUS_UPDATE, { progress: 100 }, null, 0);

  // Agent-5 requests next task
  currentTime += 1 * 60000; // +121min
  const req6 = addMessage('agent-5', 'marcus', null, 'Requesting next task', MessageType.TASK_REQUEST);
  addMessage('marcus', 'agent-5', 'task-10', 'Configure CI/CD pipeline with GitHub Actions. Set up automated testing and deployment.', MessageType.TASK_ASSIGNMENT, {}, req6, 4000);

  // === Time 150-180min: Agent-1 completes auth, Agent-3 encounters blocker ===
  currentTime += 30 * 60000; // +151min
  addMessage('agent-1', 'marcus', 'task-3', 'Progress: JWT generation and validation working, implementing password hashing', MessageType.STATUS_UPDATE, { progress: 65 }, null, 0);

  currentTime += 15 * 60000; // +166min
  // Agent-3 hits blocker
  const blocker1 = addMessage('agent-3', 'marcus', 'task-4', 'BLOCKER: Product search not working with special characters. Need to implement proper text escaping.', MessageType.BLOCKER, { blocking: true, requires_response: true }, null, 0);

  currentTime += 5 * 60000; // +171min
  addMessage('marcus', 'agent-3', 'task-4', 'Use parameterized queries to handle special characters safely. Check the database docs for proper escaping.', MessageType.ANSWER, { resolves_blocker: true, response_time: 300 }, blocker1, 0);

  currentTime += 9 * 60000; // +180min
  addMessage('agent-1', 'marcus', 'task-3', 'Authentication API complete! All endpoints tested and working.', MessageType.STATUS_UPDATE, { progress: 100 }, null, 0);

  // Frontend can start (auth API ready)
  currentTime += 2 * 60000; // +182min
  const req7 = addMessage('agent-2', 'marcus', null, 'Requesting next task', MessageType.TASK_REQUEST);
  addMessage('marcus', 'agent-2', 'task-6', 'Create Login/Register UI components. Use the authentication API endpoints that are now complete.', MessageType.TASK_ASSIGNMENT, {}, req7, 5000);

  // === Time 195min: Agent-3 completes products API ===
  currentTime += 13 * 60000; // +195min
  addMessage('agent-3', 'marcus', 'task-4', 'Product API complete with search, filters, and pagination!', MessageType.STATUS_UPDATE, { progress: 100 }, null, 0);

  // Agent-2 can now start product listing (product API ready)
  currentTime += 3 * 60000; // +198min
  const req8 = addMessage('agent-2', 'marcus', null, 'Requesting next task', MessageType.TASK_REQUEST);
  addMessage('marcus', 'agent-2', 'task-7', 'Create Product Listing page with grid layout, search bar, and filters.', MessageType.TASK_ASSIGNMENT, {}, req8, 4000);

  // Agent-1 starts cart API (depends on auth + products)
  const req9 = addMessage('agent-1', 'marcus', null, 'Requesting next task', MessageType.TASK_REQUEST);
  addMessage('marcus', 'agent-1', 'task-5', 'Implement Shopping Cart API. Integrate with auth and product APIs.', MessageType.TASK_ASSIGNMENT, {}, req9, 5000);

  // === Current time: ~210min, multiple tasks in progress ===
  currentTime += 12 * 60000; // +210min
  addMessage('agent-1', 'marcus', 'task-5', 'Progress: Cart CRUD endpoints working, implementing checkout logic', MessageType.STATUS_UPDATE, { progress: 65 }, null, 0);
  addMessage('agent-5', 'marcus', 'task-10', 'Progress: GitHub Actions configured, setting up deployment pipeline', MessageType.STATUS_UPDATE, { progress: 70 }, null, 0);

  currentTime += 5 * 60000; // +215min
  addMessage('agent-2', 'marcus', 'task-6', 'Login/Register components complete with validation', MessageType.STATUS_UPDATE, { progress: 100 }, null, 0);

  currentTime += 5 * 60000; // +220min
  addMessage('agent-3', 'marcus', 'task-8', 'Progress: Cart UI components built, integrating with API', MessageType.STATUS_UPDATE, { progress: 45 }, null, 0);
  addMessage('agent-2', 'marcus', 'task-7', 'Product listing page complete with all features!', MessageType.STATUS_UPDATE, { progress: 100 }, null, 0);

  // Final metadata
  const endTime = new Date(currentTime);
  const metadata = {
    project_name: 'E-Commerce Platform MVP',
    start_time: startTime.toISOString(),
    end_time: endTime.toISOString(),
    total_duration_minutes: Math.round((endTime.getTime() - startTime.getTime()) / 60000),
    parallelization_level: 5, // Max 5 agents working simultaneously
  };

  return {
    tasks,
    agents,
    messages,
    events,
    metadata,
  };
}

/**
 * Calculate metrics for the simulation
 */
export function calculateMetrics(data: SimulationData) {
  const completedTasks = data.tasks.filter(t => t.status === TaskStatus.DONE).length;
  const totalTasks = data.tasks.length;
  const completionRate = (completedTasks / totalTasks) * 100;

  // Calculate actual parallelization achieved
  const taskCompletionTimes = data.tasks
    .filter(t => t.status === TaskStatus.DONE)
    .map(t => ({
      start: new Date(t.created_at).getTime(),
      end: new Date(t.updated_at).getTime(),
    }));

  // Find max concurrent tasks at any point
  let maxConcurrent = 0;
  const timePoints = new Set<number>();
  taskCompletionTimes.forEach(({ start, end }) => {
    timePoints.add(start);
    timePoints.add(end);
  });

  Array.from(timePoints).sort((a, b) => a - b).forEach(time => {
    const concurrent = taskCompletionTimes.filter(
      ({ start, end }) => start <= time && end >= time
    ).length;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
  });

  // Calculate total actual hours vs estimated
  const totalEstimated = data.tasks.reduce((sum, t) => sum + t.estimated_hours, 0);
  const totalActual = data.tasks.reduce((sum, t) => sum + t.actual_hours, 0);

  // Calculate conversation metrics
  const totalMessages = data.messages.length;
  const blockerMessages = data.messages.filter(m => m.type === MessageType.BLOCKER).length;

  // Simulate single-agent timeline (sequential)
  const singleAgentDuration = totalActual * 60; // Convert hours to minutes
  const multiAgentDuration = data.metadata.total_duration_minutes;
  const speedup = singleAgentDuration / multiAgentDuration;

  return {
    completedTasks,
    totalTasks,
    completionRate,
    maxConcurrent,
    totalEstimatedHours: totalEstimated,
    totalActualHours: totalActual,
    estimateAccuracy: (totalActual / totalEstimated) * 100,
    totalMessages,
    blockerMessages,
    singleAgentDurationMinutes: Math.round(singleAgentDuration),
    multiAgentDurationMinutes: multiAgentDuration,
    speedupFactor: parseFloat(speedup.toFixed(2)),
  };
}
