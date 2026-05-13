/**
 * Token-attribution audit banner (Marcus #527).
 *
 * Renders one line at the top of the Real-time tab telling the user
 * whether *every token recorded for this scope is attributed to a
 * known role*. A healthy audit shows a green check; an unhealthy one
 * shows the specific gap (rows missing task_id, tokens unattributed
 * to any role).
 *
 * The component is pure presentation — the audit dict comes from the
 * parent summary payload and is shaped by Marcus's
 * ``CostAggregator.run_audit`` / ``project_audit``.
 */

import type { CostAudit } from '../services/costService';

interface Props {
  audit: CostAudit | undefined;
}

function formatN(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const AuditBanner = ({ audit }: Props) => {
  if (!audit) {
    return null;
  }

  // Healthy: by-role tokens reconcile with the grand total AND no
  // worker row is missing its task_id (orphan). Anything else is a
  // gap the user should see.
  const healthy =
    audit.reconciles &&
    audit.worker_events_without_task_id === 0 &&
    audit.worker_events_without_agent_id === 0;

  const totalLine = `${formatN(audit.total_events)} events · ${formatN(
    audit.total_tokens,
  )} tokens (${formatN(audit.planner_events)} planner / ${formatN(
    audit.worker_events,
  )} worker)`;

  if (healthy) {
    return (
      <div
        className="cost-audit-banner cost-audit-healthy"
        role="status"
        aria-live="polite"
      >
        <span className="cost-audit-icon" aria-hidden="true">
          ✓
        </span>
        <span className="cost-audit-message">
          Every token attributed. {totalLine}.
        </span>
      </div>
    );
  }

  const gaps: string[] = [];
  if (!audit.reconciles) {
    gaps.push(
      `${formatN(audit.tokens_outside_known_roles)} tokens outside known roles`,
    );
  }
  if (audit.worker_events_without_task_id > 0) {
    gaps.push(
      `${formatN(audit.worker_events_without_task_id)} worker events missing task_id`,
    );
  }
  if (audit.worker_events_without_agent_id > 0) {
    gaps.push(
      `${formatN(audit.worker_events_without_agent_id)} worker events missing agent_id`,
    );
  }

  return (
    <div
      className="cost-audit-banner cost-audit-unhealthy"
      role="status"
      aria-live="polite"
    >
      <span className="cost-audit-icon" aria-hidden="true">
        ⚠
      </span>
      <span className="cost-audit-message">
        Token attribution gaps: {gaps.join('; ')}. {totalLine}.
      </span>
    </div>
  );
};

export default AuditBanner;
