/**
 * Horizontal bar chart of per-agent spend in the active experiment.
 *
 * Renders one row per ``AgentSlice`` from the experiment summary, sorted
 * by ``cost_usd`` descending. Uses D3 to compute the scale and React to
 * render the SVG primitives — same hybrid the rest of Cato uses
 * (NetworkGraphView, AgentSwimLanesView).
 */

import { useMemo } from 'react';
import * as d3 from 'd3';
import type { AgentSlice } from '../services/costService';
import './AgentSpendBars.css';

interface Props {
  agents: AgentSlice[];
  /** Total height in px. Defaults to 32 × number of rows + margins. */
  height?: number;
  /** Click handler — frontend wires this to an agent drill-in panel. */
  onAgentClick?: (agentId: string) => void;
}

const MARGIN = { top: 8, right: 64, bottom: 8, left: 140 };
const ROW_HEIGHT = 28;

const ROLE_COLORS: Record<string, string> = {
  planner: '#7c3aed',     // purple
  worker: '#0ea5e9',      // sky
  creator: '#10b981',     // emerald
  monitor: '#f59e0b',     // amber
  subagent: '#8b5cf6',    // violet
};

function formatUsd(v: number): string {
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

const AgentSpendBars = ({ agents, height, onAgentClick }: Props) => {
  // Sort defensively — backend already orders by cost_usd DESC but the
  // parent may have remapped.
  const sorted = useMemo(
    () => [...agents].sort((a, b) => b.cost_usd - a.cost_usd),
    [agents],
  );

  const totalHeight =
    height ?? sorted.length * ROW_HEIGHT + MARGIN.top + MARGIN.bottom;
  const width = 640;
  const innerWidth = width - MARGIN.left - MARGIN.right;

  const xScale = useMemo(() => {
    const maxCost = d3.max(sorted, (d) => d.cost_usd) ?? 0.0001;
    return d3.scaleLinear().domain([0, maxCost]).range([0, innerWidth]);
  }, [sorted, innerWidth]);

  if (sorted.length === 0) {
    return (
      <div className="agent-spend-empty">
        No agent activity yet — events will appear when the next worker turn lands.
      </div>
    );
  }

  return (
    <svg
      className="agent-spend-bars"
      width="100%"
      height={totalHeight}
      viewBox={`0 0 ${width} ${totalHeight}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Per-agent spend"
    >
      <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
        {sorted.map((a, i) => {
          const y = i * ROW_HEIGHT;
          const barWidth = xScale(a.cost_usd);
          const color = ROLE_COLORS[a.role] ?? '#64748b';
          return (
            <g
              key={a.agent_id}
              className="agent-spend-row"
              transform={`translate(0,${y})`}
              onClick={() => onAgentClick?.(a.agent_id)}
              style={{ cursor: onAgentClick ? 'pointer' : 'default' }}
            >
              <text
                className="agent-label"
                x={-8}
                y={ROW_HEIGHT / 2}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {a.agent_id}
              </text>
              <rect
                x={0}
                y={4}
                width={barWidth}
                height={ROW_HEIGHT - 8}
                fill={color}
                opacity={0.85}
                rx={3}
              />
              <text
                className="agent-cost"
                x={barWidth + 8}
                y={ROW_HEIGHT / 2}
                dominantBaseline="middle"
              >
                {formatUsd(a.cost_usd)}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
};

export default AgentSpendBars;
