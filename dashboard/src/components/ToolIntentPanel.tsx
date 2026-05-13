/**
 * Per-tool worker spend breakdown (Marcus #527 Phase 2).
 *
 * Renders ``summary.by_tool`` as a table. Worker rows are bucketed
 * by what tool the agent invoked on each LLM call — coordination
 * with Marcus (``worker_marcus_call``), editing code
 * (``worker_edit``), running tests (``worker_bash``), and so on.
 *
 * The most valuable bucket here is ``worker_marcus_call``: it's the
 * coordination tax (tokens spent talking to Marcus through MCP),
 * the metric every user wants to optimize but nobody could see
 * before the parser landed.
 */

import type { ToolSlice } from '../services/costService';

interface Props {
  tools: ToolSlice[] | undefined;
}

const INTENT_LABELS: Record<string, string> = {
  worker_marcus_call: 'Marcus MCP (coordination)',
  worker_mcp_call: 'Other MCP servers',
  worker_edit: 'Edit / Write code',
  worker_bash: 'Bash (tests, builds, git)',
  worker_search: 'Grep / Glob / search',
  worker_read: 'Read files',
  worker_text: 'Text reasoning (no tool)',
  unknown: 'Unclassified',
};

function formatUsd(v: number, decimals = 4): string {
  return `$${v.toFixed(decimals)}`;
}

function formatTokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

const ToolIntentPanel = ({ tools }: Props) => {
  if (!tools || tools.length === 0) {
    return null;
  }
  const total = tools.reduce((sum, t) => sum + t.tokens, 0);

  return (
    <section className="cost-panel">
      <h3>
        Tokens by tool intent{' '}
        <small className="cost-panel-hint">
          What the agent was doing on each LLM call. The{' '}
          <strong>Marcus MCP</strong> bucket is the coordination tax —
          tokens spent talking to Marcus, not on actual work.
        </small>
      </h3>
      <table className="cost-table cost-table-dense">
        <thead>
          <tr>
            <th>Tool intent</th>
            <th>Events</th>
            <th>Tokens</th>
            <th>Share</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {tools.map((t) => {
            const share = total > 0 ? t.tokens / total : 0;
            const label = INTENT_LABELS[t.tool_intent] ?? t.tool_intent;
            return (
              <tr key={t.tool_intent}>
                <td>
                  <span
                    className={`cost-tool-badge cost-tool-${t.tool_intent.replace(/_/g, '-')}`}
                  >
                    {label}
                  </span>
                </td>
                <td>{t.events.toLocaleString()}</td>
                <td>{formatTokens(t.tokens)}</td>
                <td>{(share * 100).toFixed(1)}%</td>
                <td>{formatUsd(t.cost_usd)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
};

export default ToolIntentPanel;
