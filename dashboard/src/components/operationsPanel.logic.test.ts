/**
 * Unit tests for OperationsPanel's pure logic.
 *
 * Kaia review on PR #39 flagged the panel's branching as
 * uncovered. These tests exercise the helpers that don't require
 * React or DOM: ``coldCacheScore``, ``pickColdOffender``, and
 * ``bucketByCategory``. Run with ``npm test``.
 */

import { describe, expect, it } from 'vitest';
import type {
  OperationCatalogEntry,
  OperationSlice,
} from '../services/costService';
import {
  ALL_CATEGORIES,
  bucketByCategory,
  coldCacheScore,
  pickColdOffender,
  splitByRole,
} from './operationsPanel.logic';

// -----------------------------------------------------------------
// Test fixtures
// -----------------------------------------------------------------

function makeOp(over: Partial<OperationSlice>): OperationSlice {
  return {
    operation: 'decompose_prd',
    events: 1,
    tokens: 0,
    input_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    output_tokens: 0,
    cache_hit_rate: 0,
    cost_usd: 0,
    ...over,
  };
}

const CATALOG: Record<string, OperationCatalogEntry> = {
  decompose_prd: {
    label: 'Decompose PRD',
    description: 'parses the PRD',
    category: 'decomposition',
  },
  analyze_blocker: {
    label: 'Analyze blocker',
    description: 'reads a blocker report',
    category: 'runtime',
  },
  validate_work: {
    label: 'Validate work',
    description: 'validates an agent submission',
    category: 'monitoring',
  },
};

// -----------------------------------------------------------------
// coldCacheScore
// -----------------------------------------------------------------

describe('coldCacheScore', () => {
  it('returns 0 when there are no creation tokens', () => {
    expect(coldCacheScore(makeOp({ cache_creation_tokens: 0 }))).toBe(0);
  });

  it('returns 0 when hit rate is 100%', () => {
    expect(
      coldCacheScore(
        makeOp({ cache_creation_tokens: 5000, cache_hit_rate: 1.0 }),
      ),
    ).toBe(0);
  });

  it('returns the full creation cost when hit rate is 0%', () => {
    expect(
      coldCacheScore(
        makeOp({ cache_creation_tokens: 5000, cache_hit_rate: 0 }),
      ),
    ).toBe(5000);
  });

  it('scales linearly between extremes', () => {
    expect(
      coldCacheScore(
        makeOp({ cache_creation_tokens: 10000, cache_hit_rate: 0.4 }),
      ),
    ).toBeCloseTo(6000, 5);
  });

  it('treats missing fields as zero', () => {
    // OperationSlice fields are optional; the function must not blow
    // up on rows from older API versions.
    expect(coldCacheScore({ operation: 'x', events: 0, tokens: 0, cost_usd: 0 })).toBe(0);
  });
});

// -----------------------------------------------------------------
// pickColdOffender
// -----------------------------------------------------------------

describe('pickColdOffender', () => {
  it('returns null when no operations exceed the threshold', () => {
    const ops = [
      makeOp({ operation: 'decompose_prd', cache_creation_tokens: 500 }),
    ];
    expect(pickColdOffender(ops, CATALOG)).toBeNull();
  });

  it('returns the highest-scoring registered operation above threshold', () => {
    const ops = [
      makeOp({
        operation: 'decompose_prd',
        cache_creation_tokens: 12000,
        cache_hit_rate: 0,
      }),
      makeOp({
        operation: 'analyze_blocker',
        cache_creation_tokens: 5000,
        cache_hit_rate: 0,
      }),
    ];
    expect(pickColdOffender(ops, CATALOG)).toBe('decompose_prd');
  });

  it('skips unregistered (typo) operations even when they would win', () => {
    // Kaia review on PR #39: a typo'd op with huge spend should not
    // win the badge. The recorder already warned in logs; the UI
    // doesn't double down on the typo.
    const ops = [
      makeOp({
        operation: 'decopmose_prd', // typo — not in catalog
        cache_creation_tokens: 100_000,
        cache_hit_rate: 0,
      }),
      makeOp({
        operation: 'analyze_blocker',
        cache_creation_tokens: 5000,
        cache_hit_rate: 0,
      }),
    ];
    expect(pickColdOffender(ops, CATALOG)).toBe('analyze_blocker');
  });

  it('returns null when only unregistered operations are present', () => {
    const ops = [
      makeOp({
        operation: 'totally_made_up',
        cache_creation_tokens: 50_000,
        cache_hit_rate: 0,
      }),
    ];
    expect(pickColdOffender(ops, CATALOG)).toBeNull();
  });

  it('respects a custom threshold', () => {
    const ops = [
      makeOp({
        operation: 'decompose_prd',
        cache_creation_tokens: 500,
        cache_hit_rate: 0,
      }),
    ];
    // Score = 500. Default threshold (1000) excludes it; custom
    // threshold of 100 admits it.
    expect(pickColdOffender(ops, CATALOG)).toBeNull();
    expect(pickColdOffender(ops, CATALOG, 100)).toBe('decompose_prd');
  });

  it('ignores hot-cache operations regardless of size', () => {
    const ops = [
      makeOp({
        operation: 'decompose_prd',
        cache_creation_tokens: 100_000,
        cache_hit_rate: 1.0,
      }),
    ];
    expect(pickColdOffender(ops, CATALOG)).toBeNull();
  });
});

// -----------------------------------------------------------------
// bucketByCategory
// -----------------------------------------------------------------

describe('bucketByCategory', () => {
  it('returns an empty array when there are no operations', () => {
    expect(bucketByCategory([], CATALOG)).toEqual([]);
  });

  it('groups registered operations into their declared categories', () => {
    const ops = [
      makeOp({ operation: 'decompose_prd', cost_usd: 1.0, tokens: 100 }),
      makeOp({ operation: 'analyze_blocker', cost_usd: 0.5, tokens: 50 }),
    ];
    const groups = bucketByCategory(ops, CATALOG);
    const map = Object.fromEntries(groups.map((g) => [g.category, g]));
    expect(Object.keys(map).sort()).toEqual(
      ['decomposition', 'runtime'].sort(),
    );
    expect(map.decomposition.ops).toHaveLength(1);
    expect(map.runtime.ops).toHaveLength(1);
  });

  it('drops categories with zero operations', () => {
    // Only one decomposition op; other three categories must not
    // appear in the result.
    const ops = [makeOp({ operation: 'decompose_prd' })];
    const groups = bucketByCategory(ops, CATALOG);
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe('decomposition');
  });

  it("buckets unregistered operations into 'other'", () => {
    const ops = [makeOp({ operation: 'totally_made_up_op' })];
    const groups = bucketByCategory(ops, CATALOG);
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe('other');
    expect(groups[0].ops[0].operation).toBe('totally_made_up_op');
  });

  it('aggregates cost / tokens / calls per group', () => {
    const ops = [
      makeOp({
        operation: 'decompose_prd',
        events: 3,
        tokens: 1000,
        cost_usd: 0.5,
      }),
      makeOp({
        operation: 'decompose_prd',
        events: 2,
        tokens: 500,
        cost_usd: 0.25,
      }),
    ];
    const groups = bucketByCategory(ops, CATALOG);
    expect(groups[0].totalCalls).toBe(5);
    expect(groups[0].totalTokens).toBe(1500);
    expect(groups[0].totalCost).toBeCloseTo(0.75, 5);
  });

  it('preserves the canonical category order for stable rendering', () => {
    const ops = [
      makeOp({ operation: 'validate_work' }), // monitoring
      makeOp({ operation: 'decompose_prd' }), // decomposition
      makeOp({ operation: 'analyze_blocker' }), // runtime
    ];
    const groups = bucketByCategory(ops, CATALOG);
    // ``ALL_CATEGORIES`` defines decomposition → runtime → monitoring
    // → other; groups must follow that order regardless of input
    // order so the UI is deterministic across renders.
    const observed = groups.map((g) => g.category);
    const expected = ALL_CATEGORIES.filter((c) => observed.includes(c));
    expect(observed).toEqual(expected);
  });
});


// ---------------------------------------------------------------------
// splitByRole — Marcus #527 Phase 1
// ---------------------------------------------------------------------

describe('splitByRole', () => {
  it('puts planner rows into plannerOps and aggregates worker rows', () => {
    const ops: OperationSlice[] = [
      makeOp({ operation: 'parse_prd', role: 'planner', events: 1, tokens: 1500, cost_usd: 0.01 }),
      makeOp({ operation: 'decompose_prd', role: 'planner', events: 1, tokens: 2000, cost_usd: 0.02 }),
      makeOp({ operation: 'turn', role: 'worker', events: 67000, tokens: 7_000_000_000, cost_usd: 25.0 }),
    ];
    const { plannerOps, workerSummary } = splitByRole(ops);
    expect(plannerOps.map((o) => o.operation)).toEqual(['parse_prd', 'decompose_prd']);
    expect(workerSummary).toEqual({
      events: 67000,
      tokens: 7_000_000_000,
      cost: 25.0,
    });
  });

  it('aggregates multiple worker rows into one summary', () => {
    // Even if backend ever emits multiple worker buckets (e.g. by
    // tool_intent in #527 Phase 2), splitByRole collapses them so the
    // current panel keeps showing a single worker total.
    const ops: OperationSlice[] = [
      makeOp({ operation: 'turn', role: 'worker', events: 100, tokens: 1_000_000, cost_usd: 5.0 }),
      makeOp({ operation: 'turn', role: 'worker', events: 50, tokens: 500_000, cost_usd: 2.5 }),
    ];
    const { plannerOps, workerSummary } = splitByRole(ops);
    expect(plannerOps).toEqual([]);
    expect(workerSummary.events).toBe(150);
    expect(workerSummary.tokens).toBe(1_500_000);
    expect(workerSummary.cost).toBe(7.5);
  });

  it('treats role-less slices as planner for legacy compatibility', () => {
    // Pre-#527 backends emit by_operation without a ``role`` field.
    // The dashboard must keep working against an old Marcus until
    // both sides upgrade — treating missing role as planner means
    // the chart looks the same as before the split.
    const ops: OperationSlice[] = [
      makeOp({ operation: 'parse_prd', events: 1, tokens: 1500, cost_usd: 0.01 }),
    ];
    const { plannerOps, workerSummary } = splitByRole(ops);
    expect(plannerOps).toHaveLength(1);
    expect(workerSummary.events).toBe(0);
  });

  it('returns zero workerSummary when there are no worker rows', () => {
    const ops: OperationSlice[] = [
      makeOp({ operation: 'parse_prd', role: 'planner', events: 1, tokens: 1500, cost_usd: 0.01 }),
    ];
    const { workerSummary } = splitByRole(ops);
    expect(workerSummary).toEqual({ events: 0, tokens: 0, cost: 0 });
  });

  it('handles empty input', () => {
    const { plannerOps, workerSummary } = splitByRole([]);
    expect(plannerOps).toEqual([]);
    expect(workerSummary).toEqual({ events: 0, tokens: 0, cost: 0 });
  });
});
