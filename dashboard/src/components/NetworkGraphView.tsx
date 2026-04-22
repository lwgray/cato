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
  isGhost: boolean;
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

  const tasks = useVisualizationStore((state) => state.getDagTasks());
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

    // Ghost (structural) nodes are filtered from display — their lineage is preserved via rawDepMap
    const visibleTasks = tasks.filter(task => task.display_role !== 'structural');
    const ghostIds = new Set(tasks.filter(t => t.display_role === 'structural').map(t => t.id));

    const nodes: GraphNode[] = visibleTasks.map(task => {
      const state = getTaskStateAtTime(task, currentAbsTime);
      return {
        id: task.id, task,
        status: state.status, progress: state.progress, isActive: state.isActive,
        isZombie: state.status === 'in_progress' && !task.assigned_agent_id,
        isBottleneck: (task.dependent_task_ids?.length || 0) >= 3,
        isGhost: false,
      };
    });

    const rawDepMap = new Map<string, Set<string>>();
    tasks.forEach(task => rawDepMap.set(task.id, new Set(task.dependency_ids || [])));

    // Bridge through ghost deps so visible tasks retain correct dependency structure
    const resolveGhostDeps = (depIds: string[], visited = new Set<string>()): Set<string> => {
      const resolved = new Set<string>();
      depIds.forEach(depId => {
        if (visited.has(depId)) return;
        visited.add(depId);
        if (ghostIds.has(depId)) {
          resolveGhostDeps(Array.from(rawDepMap.get(depId) || []), visited).forEach(id => resolved.add(id));
        } else {
          resolved.add(depId);
        }
      });
      return resolved;
    };

    const depMap = new Map<string, Set<string>>();
    visibleTasks.forEach(task => {
      depMap.set(task.id, resolveGhostDeps(Array.from(rawDepMap.get(task.id) || [])));
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

    // Compute reduced dependencies for each task (ghosts included)
    const reducedDeps = new Map<string, Set<string>>();
    visibleTasks.forEach(task => {
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

    // Create links using reduced dependencies only (hide redundant/transitive dependencies)
    const links: GraphLink[] = [];

    visibleTasks.forEach(task => {
      const reducedDepsForTask = reducedDeps.get(task.id) || new Set();

      reducedDepsForTask.forEach(depId => {
        if (nodes.find(n => n.id === depId)) {
          // Only add non-redundant links
          links.push({
            source: depId,
            target: task.id,
            isRedundant: false,
          });
        }
      });
    });

    // Drop orphaned nodes (no edges after ghost removal — e.g. planning artifacts)
    const connectedIds = new Set<string>();
    links.forEach(l => { connectedIds.add(l.source as string); connectedIds.add(l.target as string); });
    const visibleNodes = nodes.filter(n => connectedIds.has(n.id));
    nodesRef.current = visibleNodes;

    const allLinks = links;

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

    // Depth: Y position — how far from a root
    const calculateDepth = (nodeId: string, depthMap: Map<string, number>): number => {
      if (depthMap.has(nodeId)) return depthMap.get(nodeId)!;
      const deps = Array.from(depMap.get(nodeId) || []);
      if (deps.length === 0) { depthMap.set(nodeId, 0); return 0; }
      const depth = Math.max(...deps.map(d => calculateDepth(d, depthMap))) + 1;
      depthMap.set(nodeId, depth);
      return depth;
    };

    const depthMap = new Map<string, number>();
    visibleNodes.forEach(n => calculateDepth(n.id, depthMap));
    const maxDepth = Math.max(...Array.from(depthMap.values()));

    // Group nodes by which ghost task they originally depended on.
    // Ghost tasks encode the design stream each impl task came from —
    // they're filtered from the display but their lineage is still in rawDepMap.
    const nodeGhostGroup = new Map<string, string>(); // nodeId -> ghostId
    visibleNodes.forEach(node => {
      const originalDeps = Array.from(rawDepMap.get(node.id) || []);
      const ghostDep = originalDeps.find(depId => ghostIds.has(depId));
      if (ghostDep) nodeGhostGroup.set(node.id, ghostDep);
    });

    const ghostGroupIds = Array.from(new Set(nodeGhostGroup.values()));
    const numGroups = ghostGroupIds.length;

    const padding = 50;
    const verticalSpacing = (height - 100) / (maxDepth + 1);

    // Group all visible nodes by depth
    const byDepth = new Map<number, GraphNode[]>();
    visibleNodes.forEach(n => {
      const d = depthMap.get(n.id)!;
      if (!byDepth.has(d)) byDepth.set(d, []);
      byDepth.get(d)!.push(n);
    });

    byDepth.forEach((layerNodes, depth) => {
      const grouped = layerNodes.filter(n => nodeGhostGroup.has(n.id));
      const ungrouped = layerNodes.filter(n => !nodeGhostGroup.has(n.id));

      // Ungrouped nodes (roots, shared parents, convergence): center across full width
      if (ungrouped.length > 0) {
        const hSpacing = (width - padding * 2) / (ungrouped.length + 1);
        ungrouped.forEach((node, i) => {
          node.x = padding + hSpacing * (i + 1);
          node.y = padding + depth * verticalSpacing;
          node.fx = node.x;
          node.fy = node.y;
        });
      }

      // Grouped nodes: each ghost stream gets its own column slice
      if (grouped.length > 0 && numGroups > 0) {
        const groupWidth = (width - padding * 2) / numGroups;
        ghostGroupIds.forEach((ghostId, gIdx) => {
          const groupNodes = grouped.filter(n => nodeGhostGroup.get(n.id) === ghostId);
          if (groupNodes.length === 0) return;
          const colLeft = padding + gIdx * groupWidth;
          const hSpacing = groupWidth / (groupNodes.length + 1);
          groupNodes.forEach((node, i) => {
            node.x = colLeft + hSpacing * (i + 1);
            node.y = padding + depth * verticalSpacing;
            node.fx = node.x;
            node.fy = node.y;
          });
        });
      }
    });

    // Create node lookup map for link resolution
    const nodeMap = new Map<string, GraphNode>();
    visibleNodes.forEach(n => nodeMap.set(n.id, n));

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
    const simulation = d3.forceSimulation(visibleNodes);
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
      .data(visibleNodes)
      .enter().append('g')
      .attr('cursor', 'pointer')
      .attr('class', d => `node-${d.id}`);

    node.append('circle')
      .attr('class', 'node-circle')
      .attr('r', 20)
      .attr('fill', d => d.isGhost ? 'transparent' : statusColor(d.status, d.isActive))
      .attr('stroke', d => {
        if (d.isGhost) return '#64748b';
        if (d.id === selectedTaskId) return '#f59e0b';
        if (d.isZombie) return '#ef4444';
        if (d.isBottleneck) return '#f97316';
        return '#1e293b';
      })
      .attr('stroke-width', d => (d.isGhost || d.id === selectedTaskId) ? 2 : (d.isZombie || d.isBottleneck) ? 3 : 2)
      .attr('stroke-dasharray', d => d.isGhost ? '4,3' : 'none')
      .attr('opacity', d => d.isGhost ? 0.6 : 1)
      .on('click', (_, d) => {
        if (!d.isGhost) { selectTask(d.id); setLifecycleTask(d.task); }
      });

    node.append('text')
      .attr('class', 'node-label')
      .text(d => d.task.name.length > 20 ? d.task.name.substring(0, 20) + '...' : d.task.name)
      .attr('x', 0)
      .attr('y', 35)
      .attr('text-anchor', 'middle')
      .attr('fill', d => d.isGhost ? '#64748b' : '#e2e8f0')
      .attr('font-size', '11px')
      .attr('font-weight', '500')
      .attr('opacity', d => d.isGhost ? 0.6 : 1)
      .style('pointer-events', 'none');

    node.append('text')
      .attr('class', 'node-progress')
      .text(d => d.isGhost ? 'Design' : `${d.progress}%`)
      .attr('x', 0)
      .attr('y', 5)
      .attr('text-anchor', 'middle')
      .attr('fill', d => d.isGhost ? '#64748b' : 'white')
      .attr('font-size', '10px')
      .attr('font-weight', d => d.isGhost ? '500' : '700')
      .attr('font-style', d => d.isGhost ? 'italic' : 'normal')
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

    nodesRef.current.forEach(node => {
      if (node.isGhost) return;
      const state = getTaskStateAtTime(node.task, currentAbsTime);
      node.status = state.status;
      node.progress = state.progress;
      node.isActive = state.isActive;
      node.isZombie = state.status === 'in_progress' && !node.task.assigned_agent_id;
      node.isBottleneck = (node.task.dependent_task_ids?.length || 0) >= 3;
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

    svg.selectAll('.node-circle')
      .data(nodesRef.current)
      .attr('fill', d => d.isGhost ? 'transparent' : statusColor(d.status, d.isActive))
      .attr('stroke', d => {
        if (d.isGhost) return '#64748b';
        if (d.id === selectedTaskId) return '#f59e0b';
        if (d.isZombie) return '#ef4444';
        if (d.isBottleneck) return '#f97316';
        return '#1e293b';
      })
      .attr('stroke-width', d => {
        if (d.id === selectedTaskId) return 4;
        if (d.isZombie || d.isBottleneck) return 3;
        return 2;
      })
      .attr('class', d => `node-circle ${!d.isGhost && d.isActive ? 'pulsing-node' : ''}`);

    svg.selectAll('.node-progress')
      .data(nodesRef.current)
      .text(d => d.isGhost ? 'Design' : `${d.progress}%`);

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
          <div className="legend-title">Node Types</div>
          <div className="legend-item">
            <div className="legend-border" style={{ borderColor: '#64748b', borderStyle: 'dashed', opacity: 0.6 }}></div>
            <span>Design origin</span>
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
