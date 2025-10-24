import { useMemo } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';
import { Task } from '../services/dataService';
import './HealthCheckDashboard.css';

interface DiagnosticIssue {
  type: 'zombie' | 'bottleneck' | 'redundant_dep' | 'circular_dep' | 'state_inconsistency' | 'blocked_all';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  affectedTasks: Task[];
  recommendation: string;
}

const HealthCheckDashboard = () => {
  const snapshot = useVisualizationStore((state) => state.snapshot);
  const selectTask = useVisualizationStore((state) => state.selectTask);

  // Run diagnostics
  const diagnostics = useMemo(() => {
    if (!snapshot) return { issues: [], metrics: null };

    const issues: DiagnosticIssue[] = [];
    const tasks = snapshot.tasks;

    // 1. Detect zombie tasks
    const zombieTasks = tasks.filter(
      t => t.status === 'in_progress' && !t.assigned_agent_id
    );

    if (zombieTasks.length > 0) {
      issues.push({
        type: 'zombie',
        severity: 'high',
        title: `${zombieTasks.length} Zombie Task${zombieTasks.length > 1 ? 's' : ''}`,
        description: `Tasks marked IN_PROGRESS but no agent assigned. These tasks are stuck and won't make progress.`,
        affectedTasks: zombieTasks,
        recommendation: 'Reset to TODO status or assign to an available agent.',
      });
    }

    // 2. Detect bottleneck tasks
    const bottleneckTasks = tasks.filter(
      t => t.dependent_task_ids.length >= 3 && t.status !== 'done'
    );

    if (bottleneckTasks.length > 0) {
      issues.push({
        type: 'bottleneck',
        severity: 'medium',
        title: `${bottleneckTasks.length} Bottleneck Task${bottleneckTasks.length > 1 ? 's' : ''}`,
        description: `Tasks blocking 3+ other tasks. Delays here cascade to many downstream tasks.`,
        affectedTasks: bottleneckTasks,
        recommendation: 'Prioritize these tasks to unblock dependent work.',
      });
    }

    // 3. Detect redundant dependencies
    const redundantDeps: { task: Task; redundant: string[] }[] = [];

    tasks.forEach(task => {
      if (task.dependency_ids.length < 2) return;

      const directDeps = new Set(task.dependency_ids);
      const reachableTransitively = new Set<string>();

      // For each direct dependency, find what's reachable through it
      const findReachable = (depId: string, visited = new Set<string>()) => {
        if (visited.has(depId)) return;
        visited.add(depId);

        const depTask = tasks.find(t => t.id === depId);
        if (!depTask) return;

        depTask.dependency_ids.forEach(nextDep => {
          reachableTransitively.add(nextDep);
          findReachable(nextDep, visited);
        });
      };

      task.dependency_ids.forEach(dep => findReachable(dep));

      // Check if any direct dependency is also reachable transitively
      const redundant = Array.from(directDeps).filter(dep => reachableTransitively.has(dep));

      if (redundant.length > 0) {
        redundantDeps.push({ task, redundant });
      }
    });

    if (redundantDeps.length > 0) {
      issues.push({
        type: 'redundant_dep',
        severity: 'low',
        title: `${redundantDeps.length} Task${redundantDeps.length > 1 ? 's' : ''} with Redundant Dependencies`,
        description: `Dependencies that are already reachable through other paths. These add unnecessary complexity.`,
        affectedTasks: redundantDeps.map(rd => rd.task),
        recommendation: 'Remove redundant dependencies to simplify the dependency graph.',
      });
    }

    // 4. Detect circular dependencies (basic check)
    const detectCycles = () => {
      const visited = new Set<string>();
      const recStack = new Set<string>();
      let cycleFound = false;
      const cycleNodes: Task[] = [];

      const dfs = (taskId: string): boolean => {
        visited.add(taskId);
        recStack.add(taskId);

        const task = tasks.find(t => t.id === taskId);
        if (task) {
          for (const depId of task.dependency_ids) {
            if (!visited.has(depId)) {
              if (dfs(depId)) return true;
            } else if (recStack.has(depId)) {
              cycleFound = true;
              cycleNodes.push(task);
              return true;
            }
          }
        }

        recStack.delete(taskId);
        return false;
      };

      tasks.forEach(task => {
        if (!visited.has(task.id)) {
          dfs(task.id);
        }
      });

      return { cycleFound, cycleNodes };
    };

    const { cycleFound, cycleNodes } = detectCycles();
    if (cycleFound) {
      issues.push({
        type: 'circular_dep',
        severity: 'critical',
        title: 'Circular Dependency Detected',
        description: 'Tasks depend on each other in a cycle. This creates a deadlock where no task can start.',
        affectedTasks: cycleNodes,
        recommendation: 'Break the cycle by removing one dependency link.',
      });
    }

    // 5. Check if all TODO tasks are blocked
    const todoTasks = tasks.filter(t => t.status === 'todo');
    const blockedTodoTasks = todoTasks.filter(task => {
      const incompleteDeps = task.dependency_ids.filter(
        depId => {
          const depTask = tasks.find(t => t.id === depId);
          return depTask && depTask.status !== 'done';
        }
      );
      return incompleteDeps.length > 0;
    });

    if (todoTasks.length > 0 && blockedTodoTasks.length === todoTasks.length) {
      issues.push({
        type: 'blocked_all',
        severity: 'critical',
        title: 'All TODO Tasks Blocked',
        description: `All ${todoTasks.length} TODO tasks are blocked by dependencies. No forward progress possible.`,
        affectedTasks: blockedTodoTasks,
        recommendation: 'Check for circular dependencies or missing completed tasks.',
      });
    }

    // Calculate overall metrics
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === 'done').length;
    const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length;
    const blockedTasks = tasks.filter(t => t.status === 'blocked').length;
    const completionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    const criticalIssues = issues.filter(i => i.severity === 'critical').length;
    const highIssues = issues.filter(i => i.severity === 'high').length;
    const mediumIssues = issues.filter(i => i.severity === 'medium').length;
    const lowIssues = issues.filter(i => i.severity === 'low').length;

    const totalIssues = issues.length;
    const healthScore = Math.max(0, 100 - (criticalIssues * 30 + highIssues * 15 + mediumIssues * 7 + lowIssues * 3));

    const metrics = {
      totalTasks,
      completedTasks,
      inProgressTasks,
      blockedTasks,
      completionRate,
      healthScore,
      totalIssues,
      criticalIssues,
      highIssues,
      mediumIssues,
      lowIssues,
    };

    return { issues, metrics };
  }, [snapshot]);

  if (!snapshot) {
    return (
      <div className="health-dashboard">
        <div className="no-data">No project data available</div>
      </div>
    );
  }

  const { issues, metrics } = diagnostics;

  if (!metrics) {
    return (
      <div className="health-dashboard">
        <div className="no-data">Unable to calculate metrics</div>
      </div>
    );
  }

  const getHealthColor = (score: number) => {
    if (score >= 80) return '#10b981'; // Green
    if (score >= 60) return '#f59e0b'; // Orange
    return '#ef4444'; // Red
  };

  const getHealthLabel = (score: number) => {
    if (score >= 80) return 'Healthy';
    if (score >= 60) return 'Needs Attention';
    return 'Critical';
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical': return '🔴';
      case 'high': return '🟠';
      case 'medium': return '🟡';
      case 'low': return '🔵';
      default: return '⚪';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return '#ef4444';
      case 'high': return '#f97316';
      case 'medium': return '#f59e0b';
      case 'low': return '#3b82f6';
      default: return '#64748b';
    }
  };

  return (
    <div className="health-dashboard">
      {/* Header */}
      <div className="dashboard-header">
        <h2 className="dashboard-title">🏥 Project Health Check</h2>
        <p className="dashboard-subtitle">{snapshot.project_name}</p>
      </div>

      {/* Health Score */}
      <div className="health-score-card">
        <div className="score-circle" style={{ borderColor: getHealthColor(metrics.healthScore) }}>
          <div className="score-value">{Math.round(metrics.healthScore)}</div>
          <div className="score-label">Health Score</div>
        </div>
        <div className="score-status" style={{ color: getHealthColor(metrics.healthScore) }}>
          {getHealthLabel(metrics.healthScore)}
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-value">{metrics.totalTasks}</div>
          <div className="metric-label">Total Tasks</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">{metrics.completedTasks}</div>
          <div className="metric-label">Completed</div>
          <div className="metric-progress">
            <div className="progress-bar-small" style={{ width: `${metrics.completionRate}%` }}></div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-value">{metrics.inProgressTasks}</div>
          <div className="metric-label">In Progress</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">{metrics.blockedTasks}</div>
          <div className="metric-label">Blocked</div>
        </div>
      </div>

      {/* Issues Summary */}
      <div className="issues-summary">
        <h3 className="section-title">Issues Found: {metrics.totalIssues}</h3>
        {metrics.totalIssues === 0 ? (
          <div className="no-issues">
            ✅ No diagnostic issues found. Project is healthy!
          </div>
        ) : (
          <div className="issue-counts">
            {metrics.criticalIssues > 0 && (
              <span className="issue-count critical">
                🔴 {metrics.criticalIssues} Critical
              </span>
            )}
            {metrics.highIssues > 0 && (
              <span className="issue-count high">
                🟠 {metrics.highIssues} High
              </span>
            )}
            {metrics.mediumIssues > 0 && (
              <span className="issue-count medium">
                🟡 {metrics.mediumIssues} Medium
              </span>
            )}
            {metrics.lowIssues > 0 && (
              <span className="issue-count low">
                🔵 {metrics.lowIssues} Low
              </span>
            )}
          </div>
        )}
      </div>

      {/* Issues List */}
      {issues.length > 0 && (
        <div className="issues-list">
          {issues.map((issue, idx) => (
            <div key={idx} className="issue-card" style={{ borderLeftColor: getSeverityColor(issue.severity) }}>
              <div className="issue-header">
                <span className="issue-icon">{getSeverityIcon(issue.severity)}</span>
                <h4 className="issue-title">{issue.title}</h4>
                <span className="issue-severity" style={{ backgroundColor: getSeverityColor(issue.severity) }}>
                  {issue.severity}
                </span>
              </div>
              <p className="issue-description">{issue.description}</p>
              <div className="issue-recommendation">
                <strong>💡 Recommendation:</strong> {issue.recommendation}
              </div>
              {issue.affectedTasks.length > 0 && (
                <div className="affected-tasks">
                  <strong>Affected Tasks ({issue.affectedTasks.length}):</strong>
                  <div className="task-chips">
                    {issue.affectedTasks.slice(0, 5).map(task => (
                      <button
                        key={task.id}
                        className="task-chip"
                        onClick={() => selectTask(task.id)}
                        title={task.name}
                      >
                        {task.name.length > 30 ? task.name.substring(0, 30) + '...' : task.name}
                      </button>
                    ))}
                    {issue.affectedTasks.length > 5 && (
                      <span className="task-chip-more">
                        +{issue.affectedTasks.length - 5} more
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default HealthCheckDashboard;
