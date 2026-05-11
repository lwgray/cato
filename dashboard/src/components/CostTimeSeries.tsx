/**
 * Per-experiment cost time series.
 *
 * Renders one bar per experiment along an absolute time axis (started_at).
 * Bars are colored by project so multi-project history is legible at a
 * glance. Used by the Historical tab.
 */

import { useMemo } from 'react';
import * as d3 from 'd3';
import type { ExperimentRow } from '../services/costService';
import './CostTimeSeries.css';

interface Props {
  experiments: ExperimentRow[];
  width?: number;
  height?: number;
  onSelect?: (experimentId: string) => void;
}

const MARGIN = { top: 16, right: 16, bottom: 40, left: 56 };

function formatUsd(v: number): string {
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

const CostTimeSeries = ({
  experiments,
  width = 800,
  height = 260,
  onSelect,
}: Props) => {
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = height - MARGIN.top - MARGIN.bottom;

  const parsed = useMemo(
    () =>
      experiments
        .map((e) => ({
          ...e,
          ts: new Date(e.started_at).getTime(),
        }))
        .sort((a, b) => a.ts - b.ts),
    [experiments],
  );

  const xScale = useMemo(() => {
    const min = d3.min(parsed, (d) => d.ts) ?? Date.now();
    const max = d3.max(parsed, (d) => d.ts) ?? Date.now();
    return d3.scaleTime().domain([new Date(min), new Date(max)]).range([0, innerW]);
  }, [parsed, innerW]);

  const yScale = useMemo(() => {
    const max = d3.max(parsed, (d) => d.total_cost_usd) ?? 0.01;
    return d3.scaleLinear().domain([0, max * 1.1]).range([innerH, 0]);
  }, [parsed, innerH]);

  const projectColor = useMemo(() => {
    const projects = Array.from(new Set(parsed.map((d) => d.project_id)));
    const palette = d3.schemeTableau10;
    const map = new Map<string, string>();
    projects.forEach((p, i) => map.set(p, palette[i % palette.length]));
    return map;
  }, [parsed]);

  if (parsed.length === 0) {
    return (
      <div className="cost-timeseries-empty">
        No experiments to chart yet.
      </div>
    );
  }

  const yTicks = yScale.ticks(5);
  const xTicks = xScale.ticks(Math.min(parsed.length, 8));

  return (
    <svg
      className="cost-timeseries"
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Cost over time, by experiment"
    >
      <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
        {/* Horizontal grid */}
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

        {/* Bars */}
        {parsed.map((d) => {
          const x = xScale(d.ts);
          const y = yScale(d.total_cost_usd);
          const barW = Math.max(6, innerW / Math.max(parsed.length, 8) * 0.6);
          const barH = innerH - y;
          return (
            <g
              key={d.experiment_id}
              transform={`translate(${x - barW / 2},${y})`}
              onClick={() => onSelect?.(d.experiment_id)}
              style={{ cursor: onSelect ? 'pointer' : 'default' }}
              className="bar-group"
            >
              <rect
                width={barW}
                height={barH}
                fill={projectColor.get(d.project_id) ?? '#64748b'}
                opacity={0.85}
                rx={2}
              >
                <title>
                  {d.project_name ?? d.experiment_id}
                  {'\n'}
                  {new Date(d.ts).toLocaleString()}
                  {'\n'}
                  {formatUsd(d.total_cost_usd)} — {d.total_tokens.toLocaleString()} tok
                </title>
              </rect>
            </g>
          );
        })}

        {/* Y-axis labels */}
        {yTicks.map((t) => (
          <text
            key={`yl-${t}`}
            x={-8}
            y={yScale(t)}
            dominantBaseline="middle"
            textAnchor="end"
            className="axis-label"
          >
            {formatUsd(t)}
          </text>
        ))}

        {/* X-axis labels */}
        {xTicks.map((t) => (
          <text
            key={`xl-${t.getTime()}`}
            x={xScale(t)}
            y={innerH + 16}
            textAnchor="middle"
            className="axis-label"
          >
            {d3.timeFormat('%b %d')(t)}
          </text>
        ))}
      </g>
    </svg>
  );
};

export default CostTimeSeries;
