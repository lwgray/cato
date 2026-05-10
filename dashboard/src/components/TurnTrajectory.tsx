/**
 * Per-turn cost trajectory for a single Claude Code session.
 *
 * Renders a D3 line chart with turn_index on the x-axis and cost_usd
 * on the y-axis, plus a faint area under the line. Used in the
 * real-time tab to spot runaway loops — a session whose cost climbs
 * sharply across consecutive turns is usually stuck.
 */

import { useMemo } from 'react';
import * as d3 from 'd3';
import type { TurnPoint } from '../services/costService';
import './TurnTrajectory.css';

interface Props {
  turns: TurnPoint[];
  width?: number;
  height?: number;
}

const MARGIN = { top: 16, right: 16, bottom: 24, left: 48 };

const TurnTrajectory = ({ turns, width = 640, height = 220 }: Props) => {
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = height - MARGIN.top - MARGIN.bottom;

  const xScale = useMemo(() => {
    const maxTurn = d3.max(turns, (d) => d.turn_index) ?? 1;
    return d3.scaleLinear().domain([1, Math.max(maxTurn, 1)]).range([0, innerW]);
  }, [turns, innerW]);

  const yScale = useMemo(() => {
    const maxCost = d3.max(turns, (d) => d.cost_usd) ?? 0.001;
    return d3.scaleLinear().domain([0, maxCost * 1.1]).range([innerH, 0]);
  }, [turns, innerH]);

  const linePath = useMemo(() => {
    return d3
      .line<TurnPoint>()
      .x((d) => xScale(d.turn_index))
      .y((d) => yScale(d.cost_usd))
      .curve(d3.curveMonotoneX)(turns);
  }, [turns, xScale, yScale]);

  const areaPath = useMemo(() => {
    return d3
      .area<TurnPoint>()
      .x((d) => xScale(d.turn_index))
      .y0(innerH)
      .y1((d) => yScale(d.cost_usd))
      .curve(d3.curveMonotoneX)(turns);
  }, [turns, xScale, yScale, innerH]);

  if (turns.length === 0) {
    return (
      <div className="turn-trajectory-empty">
        Pick a session to see its per-turn cost.
      </div>
    );
  }

  // 5 horizontal gridlines.
  const yTicks = yScale.ticks(5);
  const xTicks = xScale.ticks(Math.min(turns.length, 8));

  return (
    <svg
      className="turn-trajectory"
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Per-turn cost trajectory"
    >
      <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
        {/* Gridlines */}
        {yTicks.map((t) => (
          <line
            key={`yg-${t}`}
            x1={0}
            x2={innerW}
            y1={yScale(t)}
            y2={yScale(t)}
            className="grid"
          />
        ))}

        {/* Area + line */}
        {areaPath && <path d={areaPath} className="area" />}
        {linePath && <path d={linePath} className="line" />}

        {/* Points */}
        {turns.map((t) => (
          <circle
            key={`p-${t.turn_index}`}
            cx={xScale(t.turn_index)}
            cy={yScale(t.cost_usd)}
            r={3}
            className="point"
          >
            <title>
              turn {t.turn_index} — ${t.cost_usd.toFixed(4)} ({t.total_tokens} tok)
            </title>
          </circle>
        ))}

        {/* Y axis labels */}
        {yTicks.map((t) => (
          <text
            key={`yl-${t}`}
            x={-8}
            y={yScale(t)}
            dominantBaseline="middle"
            textAnchor="end"
            className="axis-label"
          >
            ${t.toFixed(3)}
          </text>
        ))}

        {/* X axis labels */}
        {xTicks.map((t) => (
          <text
            key={`xl-${t}`}
            x={xScale(t)}
            y={innerH + 16}
            textAnchor="middle"
            className="axis-label"
          >
            {t}
          </text>
        ))}

        {/* X axis caption */}
        <text
          x={innerW / 2}
          y={innerH + 32}
          textAnchor="middle"
          className="axis-caption"
        >
          turn
        </text>
      </g>
    </svg>
  );
};

export default TurnTrajectory;
