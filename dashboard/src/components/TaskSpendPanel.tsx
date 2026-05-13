/**
 * Per-task token spend (Marcus #527 Phase 1).
 *
 * Surfaces ``by_task`` from the run/project summary. The data has
 * been fetched all along; this panel just renders it. For worker
 * rows, this is the natural attribution axis — not ``operation``,
 * which is always ``'turn'`` for workers.
 *
 * Each row shows the task_id (truncated for readability), the number
 * of LLM events that worker turns produced under that task, the
 * total tokens, and the estimated cost. Sorted server-side by cost
 * descending so the most-expensive task surfaces first — that's the
 * one to investigate.
 */

import type { TaskSlice } from '../services/costService';

interface Props {
  tasks: TaskSlice[];
}

function formatUsd(v: number, decimals = 4): string {
  return `$${v.toFixed(decimals)}`;
}

function formatTokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

function shortId(id: string): string {
  // task_ids are typically dashless UUIDs or long hex; show the
  // leading 8 chars so rows are scannable but still copy-clickable
  // via the full id in the title attribute.
  if (id.length > 12) return `${id.slice(0, 8)}…`;
  return id;
}

const TaskSpendPanel = ({ tasks }: Props) => {
  if (tasks.length === 0) {
    return null;
  }

  const total = tasks.reduce((sum, t) => sum + t.tokens, 0);

  return (
    <section className="cost-panel">
      <h3>
        Tokens by task{' '}
        <small className="cost-panel-hint">
          Where worker spend actually goes. The chart "Tokens by operation"
          is planner-only — workers are attributed by task here.
        </small>
      </h3>
      <table className="cost-table cost-table-dense">
        <thead>
          <tr>
            <th>Task</th>
            <th>Events</th>
            <th>Tokens</th>
            <th>Share</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const share = total > 0 ? t.tokens / total : 0;
            return (
              <tr key={t.task_id}>
                <td>
                  <span
                    className="cost-task-id"
                    title={t.task_id}
                  >
                    {shortId(t.task_id)}
                  </span>
                </td>
                <td>{t.events}</td>
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

export default TaskSpendPanel;
