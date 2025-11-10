/**
 * Timeline utilities for calculating task states at specific points in time
 */

import { Task } from '../services/dataService';

type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked';

/**
 * Convert linear time to power scale for better visualization
 * This expands early times and compresses later times
 * Using exponent < 1 (e.g., 0.5 = square root) expands early timeline
 */
export function timeToPowerScale(linearTime: number, totalDuration: number, exponent: number = 0.4): number {
  if (totalDuration <= 0 || linearTime <= 0) return 0;
  if (linearTime >= totalDuration) return totalDuration;

  // Normalize to 0-1 range
  const normalized = linearTime / totalDuration;

  // Apply power transformation
  const scaled = Math.pow(normalized, exponent);

  // Scale back to duration
  return scaled * totalDuration;
}

/**
 * Convert power scale back to linear time
 */
export function powerScaleToTime(scaledTime: number, totalDuration: number, exponent: number = 0.4): number {
  if (totalDuration <= 0) return 0;
  if (scaledTime >= totalDuration) return totalDuration;

  // Normalize to 0-1 range
  const normalized = scaledTime / totalDuration;

  // Reverse power transformation
  const linear = Math.pow(normalized, 1 / exponent);

  // Scale back to duration
  return linear * totalDuration;
}

// Backward compatibility aliases
export const timeToLogScale = timeToPowerScale;
export const logScaleToTime = powerScaleToTime;

/**
 * Calculate what state a task should be in at a given time
 */
export function getTaskStateAtTime(task: Task, currentAbsTime: number): {
  status: TaskStatus;
  progress: number;
  isActive: boolean;
} {
  // Use started_at if available, otherwise fall back to created_at
  const taskStart = task.started_at
    ? new Date(task.started_at).getTime()
    : new Date(task.created_at).getTime();
  const taskEnd = new Date(task.updated_at).getTime();
  const taskDuration = taskEnd - taskStart;

  // Before task starts
  if (currentAbsTime < taskStart) {
    return {
      status: 'todo' as TaskStatus,
      progress: 0,
      isActive: false,
    };
  }

  // After task completes
  if (currentAbsTime >= taskEnd) {
    return {
      status: task.status as TaskStatus, // Final status (done or blocked)
      progress: task.progress_percent, // Backend calculates this correctly
      isActive: false,
    };
  }

  // During task execution - interpolate progress linearly from 0 to 100
  const elapsed = currentAbsTime - taskStart;
  // Handle zero-duration tasks (planned tasks with created_at == updated_at)
  const progressPercent = taskDuration > 0
    ? Math.min(100, (elapsed / taskDuration) * 100)
    : 0;

  return {
    status: 'in_progress' as TaskStatus,
    progress: Math.round(progressPercent),
    isActive: true,
  };
}

/**
 * Get all tasks with their current states at a given time
 */
export function getTasksAtTime(tasks: Task[], currentAbsTime: number): Array<Task & {
  currentStatus: TaskStatus;
  currentProgress: number;
  isActive: boolean;
}> {
  return tasks.map(task => {
    const state = getTaskStateAtTime(task, currentAbsTime);
    return {
      ...task,
      currentStatus: state.status,
      currentProgress: state.progress,
      isActive: state.isActive,
    };
  });
}
