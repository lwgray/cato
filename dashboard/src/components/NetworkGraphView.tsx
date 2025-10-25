import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useVisualizationStore } from '../store/visualizationStore';
import { Task } from '../services/dataService';
import { getTaskStateAtTime } from '../utils/timelineUtils';
import TaskLifecyclePanel from './TaskLifecyclePanel';
import './NetworkGraphView.css';

type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked';

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  task: Task;
  status: TaskStatus;
  progress: number;
  isActive: boolean;
  isZombie: boolean;
  isBottleneck: boolean;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  isRedundant?: boolean;
}

const NetworkGraphView = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);

  const tasks = useVisualizationStore((state) => state.getVisibleTasks());
  const currentTime = useVisualizationStore((state) => state.currentTime);
  const selectTask = useVisualizationStore((state) => state.selectTask);
  const selectedTaskId = useVisualizationStore((state) => state.selectedTaskId);

  // Local state for lifecycle panel
  const [lifecycleTask, setLifecycleTask] = useState<Task | null>(null);

  // Build graph structure once when tasks change
  useEffect(() => {
    if (!svgRef.current) return;

    // Clear previous
    d3.select(svgRef.current).selectAll('*').remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    // Create container for zoom
    const g = svg.append('g');

    // Prepare static data
    const snapshot = useVisualizationStore.getState().snapshot;
    if (!snapshot || !snapshot.start_time) return;

    const startTime = new Date(snapshot.start_time).getTime();
    const currentAbsTime = startTime + currentTime;

    // Debug timeline at initialization (log once per snapshot change)
    if (tasks.length > 0 && currentTime === 0) {
      console.log('=== TIMELINE DEBUG (t=0) ===');
      console.log('Timeline start:', new Date(startTime).toISOString());
      console.log('Timeline end:', new Date(snapshot.end_time).toISOString());
      console.log('Current time offset:', currentTime, 'ms');
      console.log('Current absolute time:', new Date(currentAbsTime).toISOString());

      // Log first 3 tasks
      tasks.slice(0, 3).forEach((task, i) => {
        const state = getTaskStateAtTime(task, currentAbsTime);
        console.log(`\nTask ${i + 1}:`, task.name.substring(0, 40));
        console.log('  Task created:', task.created_at);
        console.log('  Task updated:', task.updated_at);
        console.log('  State at t=0:', state.status, `${state.progress}%`);
        console.log('  isActive:', state.isActive);
      });
      console.log('=== END DEBUG ===\n');
    }

    // Detect zombies and bottlenecks
    const nodes: GraphNode[] = tasks.map(task => {
      const state = getTaskStateAtTime(task, currentAbsTime);

      // Zombie: IN_PROGRESS but no agent assigned
      const isZombie = state.status === 'in_progress' && !task.assigned_agent_id;

      // Bottleneck: Many tasks depend on this (threshold: 3+)
      const isBottleneck = (task.dependent_task_ids?.length || 0) >= 3;

      return {
        id: task.id,
        task,
        status: state.status,
        progress: state.progress,
        isActive: state.isActive,
        isZombie,
        isBottleneck,
      };
    });

    nodesRef.current = nodes;

    // Build dependency map for transitive reduction
    const depMap = new Map<string, Set<string>>();
    tasks.forEach(task => {
      depMap.set(task.id, new Set(task.dependency_ids || []));
    });

    // Get all reachable nodes from a given task (including direct deps)
    const getAllReachable = (taskId: string, visited = new Set<string>()): Set<string> => {
      if (visited.has(taskId)) return new Set();
      visited.add(taskId);

      const directDeps = depMap.get(taskId) || new Set();
      const allReachable = new Set<string>();

      directDeps.forEach(depId => {
        allReachable.add(depId);
        const transitive = getAllReachable(depId, new Set(visited));
        transitive.forEach(td => allReachable.add(td));
      });

      return allReachable;
    };

    // Compute reduced dependencies for each task
    const reducedDeps = new Map<string, Set<string>>();
    tasks.forEach(task => {
      const directDeps = depMap.get(task.id) || new Set();
      const reduced = new Set<string>();

      // For each direct dependency, check if it's reachable via another direct dependency
      directDeps.forEach(depId => {
        let isTransitive = false;

        // Check if this dep is reachable through any OTHER direct dependency
        directDeps.forEach(otherDepId => {
          if (depId !== otherDepId) {
            const reachableFromOther = getAllReachable(otherDepId);
            if (reachableFromOther.has(depId)) {
              isTransitive = true;
            }
          }
        });

        // Only keep if it's not transitive
        if (!isTransitive) {
          reduced.add(depId);
        }
      });

      reducedDeps.set(task.id, reduced);
    });

    // Create links using reduced dependencies + redundant dependencies (for visualization)
    const links: GraphLink[] = [];
    const redundantLinks: GraphLink[] = [];

    tasks.forEach(task => {
      const directDeps = depMap.get(task.id) || new Set();
      const reducedDepsForTask = reducedDeps.get(task.id) || new Set();

      directDeps.forEach(depId => {
        if (nodes.find(n => n.id === depId)) {
          const isRedundant = !reducedDepsForTask.has(depId);

          if (isRedundant) {
            // Add as redundant link (will be shown as dashed red)
            redundantLinks.push({
              source: depId,
              target: task.id,
              isRedundant: true,
            });
          } else {
            // Add as normal link
            links.push({
              source: depId,
              target: task.id,
              isRedundant: false,
            });
          }
        }
      });
    });

    // Combine links: normal + redundant
    const allLinks = [...links, ...redundantLinks];

    // Color scale
    const statusColor = (status: TaskStatus, isActive: boolean) => {
      if (isActive) return '#3b82f6'; // Blue for active
      switch (status) {
        case 'todo': return '#64748b'; // Gray
        case 'in_progress': return '#3b82f6'; // Blue
        case 'done': return '#10b981'; // Green
        case 'blocked': return '#ef4444'; // Red
        default: return '#64748b';
      }
    };

    // Calculate hierarchical layout based on dependencies
    // This prevents line overlaps by organizing tasks in layers
    const calculateDepth = (nodeId: string, depthMap: Map<string, number>): number => {
      if (depthMap.has(nodeId)) {
        return depthMap.get(nodeId)!;
      }

      const node = nodes.find(n => n.id === nodeId);
      const deps = node?.task.dependency_ids || [];
      if (!node || deps.length === 0) {
        depthMap.set(nodeId, 0);
        return 0;
      }

      const maxDepDep = Math.max(
        ...deps.map(depId => calculateDepth(depId, depthMap))
      );
      const depth = maxDepDep + 1;
      depthMap.set(nodeId, depth);
      return depth;
    };

    const depthMap = new Map<string, number>();
    nodes.forEach(node => calculateDepth(node.id, depthMap));

    // Group nodes by depth (layer)
    const layers = new Map<number, GraphNode[]>();
    nodes.forEach(node => {
      const depth = depthMap.get(node.id)!;
      if (!layers.has(depth)) {
        layers.set(depth, []);
      }
      layers.get(depth)!.push(node);
    });

    // Position nodes in hierarchical layout
    const maxDepth = Math.max(...Array.from(depthMap.values()));
    const verticalSpacing = (height - 100) / (maxDepth || 1);
    const padding = 50;

    layers.forEach((layerNodes, depth) => {
      const horizontalSpacing = (width - padding * 2) / (layerNodes.length + 1);
      layerNodes.forEach((node, index) => {
        node.x = padding + horizontalSpacing * (index + 1);
        node.y = padding + depth * verticalSpacing;
        node.fx = node.x; // Fix position
        node.fy = node.y;
      });
    });

    // Create node lookup map for link resolution
    const nodeMap = new Map<string, GraphNode>();
    nodes.forEach(n => nodeMap.set(n.id, n));

    // Resolve link references from IDs to actual node objects
    allLinks.forEach(link => {
      if (typeof link.source === 'string') {
        link.source = nodeMap.get(link.source)!;
      }
      if (typeof link.target === 'string') {
        link.target = nodeMap.get(link.target)!;
      }
    });

    // No need for force simulation - we have explicit positions
    const simulation = d3.forceSimulation(nodes);
    simulationRef.current = simulation;

    // Draw links
    const link = g.append('g')
      .selectAll('line')
      .data(allLinks)
      .enter().append('line')
      .attr('stroke', d => d.isRedundant ? '#ef4444' : '#475569')
      .attr('stroke-width', d => d.isRedundant ? 1.5 : 2)
      .attr('stroke-opacity', d => d.isRedundant ? 0.5 : 0.6)
      .attr('stroke-dasharray', d => d.isRedundant ? '5,5' : 'none')
      .attr('marker-end', d => d.isRedundant ? 'url(#arrow-redundant)' : 'url(#arrow)');

    // Add arrow markers
    const defs = svg.append('defs');

    defs.append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 25)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#475569');

    defs.append('marker')
      .attr('id', 'arrow-redundant')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 25)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#ef4444');

    // Draw nodes
    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .enter().append('g')
      .attr('cursor', 'pointer')
      .attr('class', d => `node-${d.id}`);

    // Node circles
    node.append('circle')
      .attr('class', 'node-circle')
      .attr('r', 20)
      .attr('fill', d => statusColor(d.status, d.isActive))
      .attr('stroke', d => {
        if (d.id === selectedTaskId) return '#f59e0b';
        if (d.isZombie) return '#ef4444'; // Red for zombie
        if (d.isBottleneck) return '#f97316'; // Orange for bottleneck
        return '#1e293b';
      })
      .attr('stroke-width', d => {
        if (d.id === selectedTaskId) return 4;
        if (d.isZombie || d.isBottleneck) return 3;
        return 2;
      })
      .on('click', (_, d) => {
        selectTask(d.id);
        setLifecycleTask(d.task); // Show lifecycle panel
      });

    // Node labels
    node.append('text')
      .attr('class', 'node-label')
      .text(d => d.task.name.length > 20 ? d.task.name.substring(0, 20) + '...' : d.task.name)
      .attr('x', 0)
      .attr('y', 35)
      .attr('text-anchor', 'middle')
      .attr('fill', '#e2e8f0')
      .attr('font-size', '11px')
      .attr('font-weight', '500')
      .style('pointer-events', 'none');

    // Progress text
    node.append('text')
      .attr('class', 'node-progress')
      .text(d => `${d.progress}%`)
      .attr('x', 0)
      .attr('y', 5)
      .attr('text-anchor', 'middle')
      .attr('fill', 'white')
      .attr('font-size', '10px')
      .attr('font-weight', '700')
      .style('pointer-events', 'none');

    // Positions are already set explicitly in hierarchical layout
    // No simulation needed - just position the elements
    simulation.stop();

    // Position nodes and links based on hierarchical layout
    link
      .attr('x1', d => (d.source as GraphNode).x!)
      .attr('y1', d => (d.source as GraphNode).y!)
      .attr('x2', d => (d.target as GraphNode).x!)
      .attr('y2', d => (d.target as GraphNode).y!);

    node.attr('transform', d => `translate(${d.x},${d.y})`);

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    return () => {
      simulation.stop();
    };
  }, [tasks]); // Only re-run when tasks change (not selection!)

  // Update visual properties when time or selection changes
  useEffect(() => {
    if (!svgRef.current || nodesRef.current.length === 0) return;

    const snapshot = useVisualizationStore.getState().snapshot;
    if (!snapshot || !snapshot.start_time) return;

    const startTime = new Date(snapshot.start_time).getTime();
    const currentAbsTime = startTime + currentTime;

    const svg = d3.select(svgRef.current);

    // Update each node's visual state
    nodesRef.current.forEach(node => {
      const state = getTaskStateAtTime(node.task, currentAbsTime);
      node.status = state.status;
      node.progress = state.progress;
      node.isActive = state.isActive;

      // Update diagnostic flags
      node.isZombie = state.status === 'in_progress' && !node.task.assigned_agent_id;
      node.isBottleneck = (node.task.dependent_task_ids?.length || 0) >= 3;

      // Debug: log first node
      if (node.id === nodesRef.current[0].id) {
        console.log(`Time: ${(currentTime/60000).toFixed(1)}m, Node: ${node.task.name.substring(0, 20)}, Progress: ${node.progress}%, Status: ${node.status}, Active: ${node.isActive}`);
      }
    });

    const statusColor = (status: TaskStatus, isActive: boolean) => {
      if (isActive) return '#3b82f6';
      switch (status) {
        case 'todo': return '#64748b';
        case 'in_progress': return '#3b82f6';
        case 'done': return '#10b981';
        case 'blocked': return '#ef4444';
        default: return '#64748b';
      }
    };

    // Update circle colors and diagnostic borders
    svg.selectAll('.node-circle')
      .data(nodesRef.current)
      .attr('fill', d => statusColor(d.status, d.isActive))
      .attr('stroke', d => {
        if (d.id === selectedTaskId) return '#f59e0b';
        if (d.isZombie) return '#ef4444'; // Red for zombie
        if (d.isBottleneck) return '#f97316'; // Orange for bottleneck
        return '#1e293b';
      })
      .attr('stroke-width', d => {
        if (d.id === selectedTaskId) return 4;
        if (d.isZombie || d.isBottleneck) return 3;
        return 2;
      })
      .attr('class', d => `node-circle ${d.isActive ? 'pulsing-node' : ''}`);

    // Update progress text
    svg.selectAll('.node-progress')
      .data(nodesRef.current)
      .text(d => `${d.progress}%`);

  }, [currentTime, selectedTaskId]); // Re-run when time or selection changes

  return (
    <div className="network-graph-view">
      <svg ref={svgRef} className="network-svg" />
      <div className="legend">
        <div className="legend-section">
          <div className="legend-title">Status</div>
          <div className="legend-item">
            <div className="legend-color" style={{ backgroundColor: '#64748b' }}></div>
            <span>Backlog</span>
          </div>
          <div className="legend-item">
            <div className="legend-color" style={{ backgroundColor: '#3b82f6' }}></div>
            <span>In Progress</span>
          </div>
          <div className="legend-item">
            <div className="legend-color" style={{ backgroundColor: '#10b981' }}></div>
            <span>Done</span>
          </div>
          <div className="legend-item">
            <div className="legend-color" style={{ backgroundColor: '#ef4444' }}></div>
            <span>Blocked</span>
          </div>
        </div>
        <div className="legend-section">
          <div className="legend-title">Diagnostics</div>
          <div className="legend-item">
            <div className="legend-border" style={{ borderColor: '#ef4444', borderStyle: 'solid' }}></div>
            <span>Zombie (no agent)</span>
          </div>
          <div className="legend-item">
            <div className="legend-border" style={{ borderColor: '#f97316', borderStyle: 'solid' }}></div>
            <span>Bottleneck (3+ deps)</span>
          </div>
          <div className="legend-item">
            <div className="legend-line" style={{ borderTop: '2px dashed #ef4444' }}></div>
            <span>Redundant dep</span>
          </div>
        </div>
      </div>

      {/* Task Lifecycle Panel */}
      {lifecycleTask && (
        <TaskLifecyclePanel
          task={lifecycleTask}
          onClose={() => setLifecycleTask(null)}
        />
      )}
    </div>
  );
};

export default NetworkGraphView;
