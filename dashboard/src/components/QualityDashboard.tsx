import { useState } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';
import './QualityDashboard.css';

// ── Types ───────────────────────────────────────────────────────────

interface DimensionScore {
  score: number;
  grade: string;
  weight: number;
  justification: string;
  findings: Array<{ file: string; line: number; description: string; severity: string }>;
}

interface AgentGrade {
  agent_label: string;
  task_description: string;
  score: number;
  grade: string;
  feedback: string;
  net_contribution: string;
  process_modifier?: { adjustment: number; reason: string };
}

interface AgentContribution {
  agent_label: string;
  effective_pct: number;
  activity_pct: number;
  blame_pct: number;
  assessment: string;
}

interface RootCauseAttribution {
  problem: string;
  code_evidence: string;
  process_evidence: string;
  root_cause: string; // bad_coordination, bad_execution, ambiguous_spec
  blame: string;      // agent, spec, both
  agent_label?: string;
}

interface InstructionQuality {
  task_descriptions?: { rating: string; evidence: string };
  success_criteria?: { rating: string; evidence: string };
  dependency_info?: { rating: string; evidence: string };
  scope_boundaries?: { rating: string; evidence: string };
  technical_constraints?: { rating: string; evidence: string };
}

interface Recommendation {
  priority: number;
  scope: string;
  description: string;
  category: string;
  effort: string;
  marcus_improvement?: string;
}

interface SmokeFeature { feature: string; status: string; detail: string; }

interface QualityAssessment {
  project_id: string;
  audit_date: string;
  weighted_score: number;
  weighted_grade: string;
  scores: Record<string, DimensionScore>;
  agent_grades: AgentGrade[];
  coordination: {
    score: number; grade: string;
    coordination_failures: Array<{ failure: string; duration_minutes: number; root_cause: string; fixable: boolean }>;
    agent_utilization?: Array<{ agent_id: string; tasks_completed: number; active_minutes: number; idle_minutes: number; idle_reason: string }>;
  };
  contribution: { verdict: string; multi_agency_effective: boolean; agent_contributions: AgentContribution[] };
  issues: {
    critical: Array<any>;
    ghost_code: Array<{ description: string; file: string; severity: string; category?: string }>;
    cross_agent: Array<{ description: string; file: string; severity: string; category: string }>;
  };
  recommendations: Recommendation[];
  smoke_test: { verdict: string; features_verified: SmokeFeature[] };
  cohesiveness: { verdict: string; assessment: string; signals: Array<{ signal_name: string; divergent: boolean }> };
  metadata: Record<string, any>;
  // Process evidence (may be nested in the raw report)
  process_evidence?: {
    root_cause_attributions?: RootCauseAttribution[];
    instruction_quality?: InstructionQuality;
    process_findings?: Array<{ agent_label: string; description: string; signal_type: string; severity: string; affected_dimension: string }>;
  };
}

type SubTab = 'agents' | 'scores' | 'issues' | 'recommendations';

// ── Helpers ──────────────────────────────────────────────────────────

const GC: Record<string, string> = { A: '#10b981', B: '#3b82f6', C: '#f59e0b', D: '#ef4444', F: '#ef4444' };
function gc(g: string) { return GC[g?.charAt(0)?.toUpperCase()] ?? '#64748b'; }
function effColor(r: number) { return r > 0.8 ? '#10b981' : r > 0.5 ? '#f59e0b' : r > 0.2 ? '#f97316' : '#ef4444'; }
function titleCase(s: string) { return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

const ROOT_CAUSE_COLORS: Record<string, string> = {
  bad_coordination: '#f59e0b',
  bad_execution: '#ef4444',
  ambiguous_spec: '#8b5cf6',
};

const BLAME_LABELS: Record<string, string> = {
  agent: 'Agent',
  spec: 'Spec/Instructions',
  both: 'Shared',
};

const IQ_COLORS: Record<string, string> = {
  clear: '#10b981',
  ambiguous: '#f59e0b',
  missing: '#ef4444',
  contradictory: '#ef4444',
};

// ── Agents Tab (DEFAULT) ─────────────────────────────────────────────

function AgentsTab({ qa }: { qa: QualityAssessment }) {
  const contributions = qa.contribution?.agent_contributions ?? [];
  const agentGrades = qa.agent_grades ?? [];
  const verdict = qa.contribution?.verdict;
  const multiEffective = qa.contribution?.multi_agency_effective;
  const processEvidence = (qa.metadata as any)?.process_evidence ?? qa.process_evidence ?? {};
  const rootCauses: RootCauseAttribution[] = processEvidence.root_cause_attributions ?? [];

  return (
    <div className="qd-agents-tab">
      {/* Verdict banner */}
      <div className={`qd-verdict-banner ${multiEffective ? 'effective' : 'ineffective'}`}>
        <span className="qd-verdict-label">Multi-Agency:</span>
        <span className="qd-verdict-value">{multiEffective ? 'Effective' : 'Not Effective'}</span>
        <span className="qd-verdict-detail">{verdict?.replace(/_/g, ' ')}</span>
      </div>

      {/* Agent cards */}
      <div className="qd-agent-cards">
        {contributions.map((c) => {
          const grade = agentGrades.find(ag => ag.agent_label === c.agent_label);
          const ratio = c.activity_pct > 0 ? c.effective_pct / c.activity_pct : 0;
          const eColor = effColor(ratio);
          const wasted = c.effective_pct < c.activity_pct * 0.2;
          // Root causes attributed to this agent
          const agentCauses = rootCauses.filter(rc => rc.agent_label === c.agent_label);

          return (
            <div className={`qd-agent-card ${wasted ? 'wasted' : ''}`} key={c.agent_label}>
              <div className="qd-agent-card-header">
                <span className="qd-agent-card-name">{c.agent_label.replace('agent_', '')}</span>
                {grade && (
                  <span className="qd-agent-card-grade" style={{ color: gc(grade.grade) }}>
                    {grade.grade} ({grade.score}/5)
                  </span>
                )}
              </div>

              {grade && (
                <div className="qd-agent-card-meta">
                  <span>Contribution: <strong>{grade.net_contribution}</strong></span>
                  {grade.task_description && <span className="qd-muted"> · {grade.task_description}</span>}
                </div>
              )}

              {/* Bars */}
              <div className="qd-agent-bars">
                <div className="qd-agent-bar-row">
                  <span className="qd-bar-label">Activity</span>
                  <div className="qd-bar-track">
                    <div className="qd-bar-fill activity" style={{ width: `${Math.min(c.activity_pct, 100)}%` }} />
                  </div>
                  <span className="qd-bar-value">{c.activity_pct.toFixed(0)}%</span>
                </div>
                <div className="qd-agent-bar-row">
                  <span className="qd-bar-label">Effective</span>
                  <div className="qd-bar-track">
                    <div className="qd-bar-fill" style={{ width: `${Math.max(Math.min(c.effective_pct, 100), 1)}%`, backgroundColor: eColor }} />
                  </div>
                  <span className="qd-bar-value" style={{ color: eColor }}>{c.effective_pct.toFixed(1)}%</span>
                </div>
              </div>

              {wasted && (
                <div className="qd-wasted-banner">
                  Wasted effort — {c.activity_pct.toFixed(0)}% active but {c.effective_pct.toFixed(1)}% effective output
                </div>
              )}

              {c.assessment && <p className="qd-agent-card-assessment">{c.assessment}</p>}

              {grade?.feedback && (
                <div className="qd-agent-feedback">
                  <span className="qd-feedback-label">Feedback</span>
                  <p>{grade.feedback}</p>
                </div>
              )}

              {grade?.process_modifier && (
                <div className="qd-process-mod">
                  <span className={`qd-mod-adj ${grade.process_modifier.adjustment >= 0 ? 'positive' : 'negative'}`}>
                    {grade.process_modifier.adjustment >= 0 ? '+' : ''}{grade.process_modifier.adjustment}
                  </span>
                  <span>{grade.process_modifier.reason}</span>
                </div>
              )}

              {/* Root cause attributions for this agent */}
              {agentCauses.length > 0 && (
                <div className="qd-root-causes">
                  <span className="qd-rc-title">Root Cause Analysis</span>
                  {agentCauses.map((rc, i) => (
                    <div key={i} className="qd-rc-card" style={{ borderLeftColor: ROOT_CAUSE_COLORS[rc.root_cause] ?? '#64748b' }}>
                      <div className="qd-rc-header">
                        <span className="qd-rc-type" style={{ color: ROOT_CAUSE_COLORS[rc.root_cause] ?? '#64748b' }}>
                          {rc.root_cause.replace(/_/g, ' ')}
                        </span>
                        <span className="qd-rc-blame">Blame: {BLAME_LABELS[rc.blame] ?? rc.blame}</span>
                      </div>
                      <p className="qd-rc-problem">{rc.problem}</p>
                      {rc.code_evidence && <p className="qd-rc-evidence"><strong>Code:</strong> {rc.code_evidence}</p>}
                      {rc.process_evidence && <p className="qd-rc-evidence"><strong>Process:</strong> {rc.process_evidence}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Unattributed root causes (blame=spec or no agent_label) */}
      {rootCauses.filter(rc => !rc.agent_label || rc.blame === 'spec').length > 0 && (
        <div className="qd-panel" style={{ marginTop: '1rem' }}>
          <h3 className="qd-panel-title">Systemic Root Causes</h3>
          {rootCauses.filter(rc => !rc.agent_label || rc.blame === 'spec').map((rc, i) => (
            <div key={i} className="qd-rc-card" style={{ borderLeftColor: ROOT_CAUSE_COLORS[rc.root_cause] ?? '#64748b' }}>
              <div className="qd-rc-header">
                <span className="qd-rc-type" style={{ color: ROOT_CAUSE_COLORS[rc.root_cause] ?? '#64748b' }}>
                  {rc.root_cause.replace(/_/g, ' ')}
                </span>
                <span className="qd-rc-blame">Blame: {BLAME_LABELS[rc.blame] ?? rc.blame}</span>
              </div>
              <p className="qd-rc-problem">{rc.problem}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Scores Tab ───────────────────────────────────────────────────────

function ScoresTab({ qa }: { qa: QualityAssessment }) {
  const [expandedSmoke, setExpandedSmoke] = useState<number | null>(null);
  const dimensions = Object.entries(qa.scores ?? {})
    .filter(([n]) => n !== 'weighted_total')
    .sort(([, a], [, b]) => b.score - a.score);
  const features = qa.smoke_test?.features_verified ?? [];
  const passCount = features.filter(f => f.status === 'works').length;
  const coordination = qa.coordination;
  const execSummary = qa.metadata?.executive_summary ?? '';

  return (
    <div className="qd-scores-tab">
      {/* Executive summary at top of scores */}
      {execSummary && (
        <div className="qd-exec-summary">
          <p>{execSummary}</p>
        </div>
      )}

      <div className="qd-scores-grid">
        {/* Dimension Scores */}
        <div className="qd-panel">
          <h3 className="qd-panel-title">Dimension Scores</h3>
          <div className="qd-dim-list">
            {dimensions.map(([name, dim]) => {
              const pct = (dim.score / 5) * 100;
              const color = gc(dim.grade);
              return (
                <div className="qd-dim-row" key={name}>
                  <div className="qd-dim-header">
                    <span className="qd-dim-name">
                      {titleCase(name)}
                      {dim.weight > 0 && <span className="qd-dim-weight"> ({Math.round(dim.weight * 100)}%)</span>}
                    </span>
                    <span className="qd-dim-score">
                      {dim.score.toFixed(1)} <span style={{ color, fontWeight: 700 }}>{dim.grade}</span>
                    </span>
                  </div>
                  <div className="qd-dim-bar-track">
                    <div className="qd-dim-bar-fill" style={{ width: `${pct}%`, backgroundColor: color }} />
                  </div>
                  {dim.justification && <p className="qd-dim-justification">{dim.justification}</p>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="qd-scores-right">
          {/* Smoke Tests */}
          <div className="qd-panel">
            <h3 className="qd-panel-title">
              Smoke Tests
              <span className="qd-smoke-count">{passCount}/{features.length} passed</span>
            </h3>
            <div className="qd-smoke-list">
              {features.map((f, i) => {
                const pass = f.status === 'works';
                const isOpen = expandedSmoke === i;
                return (
                  <div key={i} className={`qd-smoke-item ${pass ? 'pass' : 'fail'}`}>
                    <button className="qd-smoke-row" onClick={() => setExpandedSmoke(isOpen ? null : i)}>
                      <span className={`qd-smoke-dot ${pass ? 'pass' : 'fail'}`} />
                      <span className="qd-smoke-feature">{f.feature}</span>
                      <span className={`qd-smoke-result ${pass ? 'pass' : 'fail'}`}>{pass ? 'PASS' : 'FAIL'}</span>
                    </button>
                    {isOpen && f.detail && <p className="qd-smoke-detail">{f.detail}</p>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Coordination */}
          {coordination && (
            <div className="qd-panel">
              <h3 className="qd-panel-title">
                Coordination
                <span className="qd-coord-grade" style={{ color: gc(coordination.grade) }}>{coordination.grade} ({coordination.score}/5)</span>
              </h3>
              {(coordination.coordination_failures ?? []).map((f, i) => (
                <div key={i} className="qd-coord-failure">
                  <p className="qd-coord-failure-text">{f.failure}</p>
                  <span className="qd-coord-failure-meta">
                    {f.duration_minutes}min · {f.root_cause.replace(/_/g, ' ')} · {f.fixable ? 'fixable' : 'structural'}
                  </span>
                </div>
              ))}
              {qa.cohesiveness && (
                <div className="qd-cohesiveness">
                  <span className="qd-cohesiveness-label">Authorship: </span>
                  <span className="qd-cohesiveness-verdict">{qa.cohesiveness.verdict?.replace(/_/g, ' ')}</span>
                  {qa.cohesiveness.assessment && <p className="qd-cohesiveness-text">{qa.cohesiveness.assessment}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Issues Tab ───────────────────────────────────────────────────────

function IssuesTab({ qa }: { qa: QualityAssessment }) {
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set());
  const toggleIssue = (key: string) => {
    setExpandedIssues((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  };

  const criticalCount = qa.issues?.critical?.length ?? 0;
  const ghostCount = qa.issues?.ghost_code?.length ?? 0;
  const crossAgentCount = qa.issues?.cross_agent?.length ?? 0;

  const allIssues: Array<{ key: string; label: string; severity: string; description: string; file?: string; category?: string; type: string }> = [];
  (qa.issues?.critical ?? []).forEach((item: any, i: number) => {
    allIssues.push({ key: `crit-${i}`, label: item?.description ?? 'Critical issue', severity: 'critical', description: item?.description ?? JSON.stringify(item), file: item?.file, type: 'Critical' });
  });
  (qa.issues?.ghost_code ?? []).forEach((item, i) => {
    allIssues.push({ key: `ghost-${i}`, label: item.description, severity: item.severity ?? 'medium', description: item.description, file: item.file, type: 'Ghost Code' });
  });
  (qa.issues?.cross_agent ?? []).forEach((item, i) => {
    allIssues.push({ key: `cross-${i}`, label: item.description, severity: item.severity ?? 'medium', description: item.description, file: item.file, category: item.category, type: 'Cross-Agent' });
  });

  const findings: Array<{ dimension: string; file: string; line: number; description: string; severity: string }> = [];
  Object.entries(qa.scores ?? {}).forEach(([name, dim]) => {
    (dim.findings ?? []).forEach(f => findings.push({ dimension: titleCase(name), ...f }));
  });

  return (
    <div className="qd-issues-tab">
      <div className="qd-issue-summary">
        <span className={`qd-issue-badge ${criticalCount === 0 ? 'success' : 'critical'}`}>{criticalCount} Critical</span>
        <span className="qd-issue-badge ghost">{ghostCount} Ghost Code</span>
        <span className="qd-issue-badge cross">{crossAgentCount} Cross-Agent</span>
        <span className="qd-issue-badge findings">{findings.length} Findings</span>
      </div>

      <div className="qd-issue-list">
        {allIssues.map((item) => {
          const isExp = expandedIssues.has(item.key);
          return (
            <div key={item.key} className={`qd-issue-card severity-${item.severity}`}>
              <button className="qd-issue-toggle" onClick={() => toggleIssue(item.key)}>
                <span className="qd-issue-arrow">{isExp ? '\u25BC' : '\u25B6'}</span>
                <span className="qd-issue-type-tag">{item.type}</span>
                <span className="qd-issue-text">{item.label}</span>
                <span className={`qd-severity-tag severity-${item.severity}`}>{item.severity}</span>
              </button>
              {isExp && (
                <div className="qd-issue-expanded">
                  {item.file && <code className="qd-issue-file">{item.file}</code>}
                  {item.category && <span className="qd-issue-category">{item.category}</span>}
                  <p className="qd-issue-desc">{item.description}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {findings.length > 0 && (
        <>
          <h3 className="qd-findings-title">Code Findings</h3>
          <div className="qd-findings-list">
            {findings.map((f, i) => (
              <div key={i} className={`qd-finding severity-${f.severity}`}>
                <div className="qd-finding-header">
                  <code className="qd-finding-file">{f.file}:{f.line}</code>
                  <span className="qd-finding-dim">{f.dimension}</span>
                  <span className={`qd-severity-tag severity-${f.severity}`}>{f.severity}</span>
                </div>
                <p className="qd-finding-desc">{f.description}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Recommendations Tab ──────────────────────────────────────────────

function RecommendationsTab({ qa }: { qa: QualityAssessment }) {
  const [scopeFilter, setScopeFilter] = useState<'all' | 'project' | 'global'>('all');
  const processEvidence = (qa.metadata as any)?.process_evidence ?? qa.process_evidence ?? {};
  const iq = processEvidence.instruction_quality as InstructionQuality | undefined;

  const recs = (qa.recommendations ?? [])
    .filter((r) => scopeFilter === 'all' || r.scope === scopeFilter || r.scope === 'both')
    .sort((a, b) => a.priority - b.priority);

  const iqEntries = iq ? Object.entries(iq).filter(([, v]) => v && typeof v === 'object') : [];

  return (
    <div className="qd-recs-tab">
      {/* Instruction Quality — drives systemic improvements */}
      {iqEntries.length > 0 && (
        <div className="qd-panel qd-iq-panel">
          <h3 className="qd-panel-title">Instruction Quality</h3>
          <p className="qd-iq-subtitle">How good were the inputs to the agents? Issues here are systemic — they affect every experiment.</p>
          <div className="qd-iq-grid">
            {iqEntries.map(([key, val]) => {
              const v = val as { rating: string; evidence: string };
              const color = IQ_COLORS[v.rating] ?? '#64748b';
              return (
                <div key={key} className="qd-iq-item">
                  <div className="qd-iq-header">
                    <span className="qd-iq-factor">{titleCase(key)}</span>
                    <span className="qd-iq-rating" style={{ color }}>{v.rating}</span>
                  </div>
                  <p className="qd-iq-evidence">{v.evidence}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="qd-filter-row">
        {(['all', 'project', 'global'] as const).map((s) => (
          <button key={s} className={`qd-filter-btn ${scopeFilter === s ? 'active' : ''}`} onClick={() => setScopeFilter(s)}>
            {s === 'all' ? 'All' : s === 'project' ? 'Project' : 'Global (Marcus)'}
          </button>
        ))}
      </div>
      <div className="qd-rec-list">
        {recs.map((rec, i) => {
          const borderColor = rec.priority <= 1 ? '#ef4444' : rec.priority <= 3 ? '#f59e0b' : '#3b82f6';
          const scopeColor = rec.scope === 'project' ? '#3b82f6' : rec.scope === 'global' ? '#8b5cf6' : '#f59e0b';
          return (
            <div key={i} className="qd-rec-card" style={{ borderLeftColor: borderColor }}>
              <div className="qd-rec-header">
                <span className="qd-rec-priority">P{rec.priority}</span>
                <span className="qd-scope-pill" style={{ backgroundColor: scopeColor }}>{rec.scope.toUpperCase()}</span>
                <span className="qd-rec-tags">
                  <span className="qd-tag">{rec.category}</span>
                  <span className="qd-tag">{rec.effort}</span>
                </span>
              </div>
              <p className="qd-rec-desc">{rec.description}</p>
              {rec.marcus_improvement && (
                <div className="qd-rec-marcus">
                  <span className="qd-rec-marcus-label">Marcus improvement</span>
                  <p>{rec.marcus_improvement}</p>
                </div>
              )}
            </div>
          );
        })}
        {recs.length === 0 && <div className="qd-empty">No recommendations for this filter</div>}
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

const QualityDashboard = () => {
  const snapshot = useVisualizationStore((state) => state.snapshot);
  const qa = snapshot?.quality_assessment as QualityAssessment | undefined;
  const [activeTab, setActiveTab] = useState<SubTab>('agents');

  if (!qa) {
    return <div className="qd-dashboard"><div className="qd-no-data">No quality assessment available. Run <code>/epictetus</code> on a completed project to generate one.</div></div>;
  }

  const criticalCount = qa.issues?.critical?.length ?? 0;
  const ghostCount = qa.issues?.ghost_code?.length ?? 0;
  const crossAgentCount = qa.issues?.cross_agent?.length ?? 0;
  const totalIssues = criticalCount + ghostCount + crossAgentCount;
  const features = qa.smoke_test?.features_verified ?? [];
  const passCount = features.filter(f => f.status === 'works').length;
  const agentCount = qa.contribution?.agent_contributions?.length ?? 0;
  const recCount = qa.recommendations?.length ?? 0;

  // Find the single most important finding for the top strip
  const crossAgentIssues = qa.issues?.cross_agent ?? [];
  const coordFailures = qa.coordination?.coordination_failures ?? [];
  const topFinding = crossAgentIssues[0]?.description
    ?? coordFailures[0]?.failure
    ?? (criticalCount > 0 ? `${criticalCount} critical issue${criticalCount > 1 ? 's' : ''} found` : null);

  return (
    <div className="qd-dashboard">
      {/* ── Top Strip: Traffic Light ───────────────────────────── */}
      <div className="qd-top-strip">
        <div className="qd-grade-block">
          <span className="qd-grade-letter" style={{ color: gc(qa.weighted_grade) }}>{qa.weighted_grade}</span>
          <div className="qd-grade-detail">
            <span className="qd-grade-score">{qa.weighted_score.toFixed(2)}<span className="qd-grade-max"> / 5.0</span></span>
            <span className="qd-grade-date">Audit {qa.audit_date}</span>
          </div>
        </div>

        <div className="qd-divider" />

        <div className="qd-top-stats">
          <div className="qd-stat-pill">
            <span className="qd-stat-value" style={{ color: passCount === features.length ? '#10b981' : '#f59e0b' }}>{passCount}/{features.length}</span>
            <span className="qd-stat-label">Smoke</span>
          </div>
          <div className="qd-stat-pill">
            <span className="qd-stat-value" style={{ color: criticalCount === 0 ? '#10b981' : '#ef4444' }}>{criticalCount}</span>
            <span className="qd-stat-label">Critical</span>
          </div>
          <div className="qd-stat-pill">
            <span className="qd-stat-value" style={{ color: '#8b5cf6' }}>{ghostCount}</span>
            <span className="qd-stat-label">Ghost</span>
          </div>
        </div>

        {topFinding && (
          <>
            <div className="qd-divider" />
            <p className="qd-top-finding">{topFinding}</p>
          </>
        )}
      </div>

      {/* ── Sub-tabs (Agents first) ────────────────────────────── */}
      <div className="qd-subtabs">
        <button className={activeTab === 'agents' ? 'active' : ''} onClick={() => setActiveTab('agents')}>
          Agents ({agentCount})
        </button>
        <button className={activeTab === 'scores' ? 'active' : ''} onClick={() => setActiveTab('scores')}>
          Scores
        </button>
        <button className={activeTab === 'issues' ? 'active' : ''} onClick={() => setActiveTab('issues')}>
          Issues {totalIssues > 0 && <span className="qd-subtab-badge">{totalIssues}</span>}
        </button>
        <button className={activeTab === 'recommendations' ? 'active' : ''} onClick={() => setActiveTab('recommendations')}>
          Recommendations {recCount > 0 && <span className="qd-subtab-badge">{recCount}</span>}
        </button>
      </div>

      {/* ── Tab Content ────────────────────────────────────────── */}
      <div className="qd-tab-content">
        {activeTab === 'agents' && <AgentsTab qa={qa} />}
        {activeTab === 'scores' && <ScoresTab qa={qa} />}
        {activeTab === 'issues' && <IssuesTab qa={qa} />}
        {activeTab === 'recommendations' && <RecommendationsTab qa={qa} />}
      </div>
    </div>
  );
};

export default QualityDashboard;
