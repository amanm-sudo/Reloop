import { describe, expect, it } from 'vitest';
import { everyDay } from '@/lib/hours';
import {
  needsColdChain,
  rankCandidates,
  scoreCandidate,
  type CandidateInput,
  type ScoringContext,
} from '@/agents/negotiation/scoring';

const NOW = new Date('2026-08-31T12:00:00.000Z'); // 17:30 IST
const HOUR = 3_600_000;

const context: ScoringContext = {
  category: 'produce_leafy_greens',
  quantityKg: 2,
  needsColdChain: false,
  now: NOW,
  freshnessDeadlineAt: new Date(NOW.getTime() + 8 * HOUR),
};

function candidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    recipientId: 'r1',
    orgName: 'Test Org',
    distanceKm: 2,
    coverageRadiusKm: 10,
    acceptedCategories: ['produce_leafy_greens', 'produce_tomatoes'],
    coldChainCapable: true,
    dailyCapacityKg: 50,
    capacityUsedTodayKg: 0,
    operatingHours: everyDay('00:00', '23:59'),
    ...overrides,
  };
}

describe('candidate eligibility', () => {
  it('rejects a recipient that does not accept the category', () => {
    const result = scoreCandidate(candidate({ acceptedCategories: ['dairy_milk'] }), context);
    expect(result.eligible).toBe(false);
    expect(result.rejectedReason).toBe('category-not-accepted');
    expect(result.score).toBe(0);
  });

  it('rejects a recipient beyond its own coverage radius', () => {
    const result = scoreCandidate(candidate({ distanceKm: 12, coverageRadiusKm: 10 }), context);
    expect(result.rejectedReason).toBe('outside-coverage');
  });

  it('rejects a recipient with no capacity left today', () => {
    const result = scoreCandidate(
      candidate({ dailyCapacityKg: 20, capacityUsedTodayKg: 20 }),
      context
    );
    expect(result.rejectedReason).toBe('no-capacity-today');
  });

  it('rejects a recipient closed for the whole freshness window', () => {
    // 03:00-04:00 IST, nowhere near the 17:30-01:30 window under test.
    const result = scoreCandidate(candidate({ operatingHours: everyDay('03:00', '04:00') }), context);
    expect(result.rejectedReason).toBe('closed-before-deadline');
  });

  it('rejects a recipient without cold chain when the food needs one', () => {
    const result = scoreCandidate(candidate({ coldChainCapable: false }), {
      ...context,
      needsColdChain: true,
    });
    expect(result.rejectedReason).toBe('needs-cold-chain');
  });
});

describe('candidate scoring', () => {
  it('prefers the closer of two otherwise identical recipients', () => {
    const near = scoreCandidate(candidate({ recipientId: 'near', distanceKm: 1 }), context);
    const far = scoreCandidate(candidate({ recipientId: 'far', distanceKm: 8 }), context);
    expect(near.score).toBeGreaterThan(far.score);
  });

  it('prefers real headroom over a recipient that barely fits the load', () => {
    const roomy = scoreCandidate(candidate({ dailyCapacityKg: 60 }), context);
    const tight = scoreCandidate(
      candidate({ dailyCapacityKg: 10, capacityUsedTodayKg: 8 }),
      context
    );
    expect(roomy.subScores.capacityHeadroom).toBeGreaterThan(tight.subScores.capacityHeadroom);
    expect(roomy.score).toBeGreaterThan(tight.score);
  });

  it('penalises a recipient that already turned this donor down today', () => {
    const clean = scoreCandidate(candidate(), context);
    const penalised = scoreCandidate(candidate({ declinedDonorToday: true }), context);
    expect(penalised.score).toBeLessThan(clean.score);
    expect(penalised.subScores.penalty).toBeGreaterThan(0);
  });

  it('keeps every score within 0..1', () => {
    const result = scoreCandidate(candidate({ distanceKm: 0, dailyCapacityKg: 10_000 }), context);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

describe('ranking', () => {
  it('puts eligible recipients ahead of ineligible ones regardless of score', () => {
    const ranked = rankCandidates(
      [
        candidate({ recipientId: 'blocked', orgName: 'Blocked', acceptedCategories: [] }),
        candidate({ recipientId: 'ok', orgName: 'Ok', distanceKm: 9 }),
      ],
      context
    );

    expect(ranked[0]?.orgName).toBe('Ok');
    expect(ranked[1]?.eligible).toBe(false);
  });

  it('breaks ties deterministically, so a re-run picks the same recipient', () => {
    const a = candidate({ recipientId: 'a', orgName: 'Beta' });
    const b = candidate({ recipientId: 'b', orgName: 'Alpha' });

    const first = rankCandidates([a, b], context);
    const second = rankCandidates([b, a], context);

    expect(first.map((c) => c.orgName)).toEqual(second.map((c) => c.orgName));
    // Equal score and equal distance falls through to name order.
    expect(first[0]?.orgName).toBe('Alpha');
  });

  it('returns an empty-but-explained list when nobody qualifies', () => {
    const ranked = rankCandidates([candidate({ acceptedCategories: [] })], context);
    expect(ranked.filter((c) => c.eligible)).toHaveLength(0);
    expect(ranked[0]?.rejectedReason).toBe('category-not-accepted');
  });

  it('handles no candidates at all', () => {
    expect(rankCandidates([], context)).toEqual([]);
  });
});

describe('cold chain requirement', () => {
  it('requires cold chain for perishables that cannot move within hours', () => {
    expect(needsColdChain('cooked_curry_veg', 12)).toBe(true);
    expect(needsColdChain('dairy_milk', 24)).toBe(true);
  });

  it('does not require it for an immediate handoff or for dry goods', () => {
    expect(needsColdChain('cooked_curry_veg', 3)).toBe(false);
    expect(needsColdChain('pulses_dry', 100)).toBe(false);
  });
});
