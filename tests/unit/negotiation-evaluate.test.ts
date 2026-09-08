import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { negotiationAgent, type EvaluateDecision } from '@/agents/negotiation';
import { makeContext } from '@/agents/registry';

/**
 * How the donor side judges a counter-offer.
 *
 * Deliberately deterministic: whether a proposed time falls before food stops being safe is a
 * fact, not a judgement call, and it is the one decision in the exchange that must never vary
 * between runs of the same demo.
 */

const NOW = new Date('2026-08-31T12:00:00.000Z');
const HOUR = 3_600_000;

const ctx = makeContext({
  agentId: 'negotiation',
  runId: new Types.ObjectId(),
  userId: new Types.ObjectId(),
});

async function evaluate(overrides: {
  altStartOffsetH?: number;
  partialQtyKg?: number;
  deadlineOffsetH?: number;
  escalationsSoFar?: number;
  hasNextCandidate?: boolean;
}): Promise<EvaluateDecision> {
  const deadline = new Date(NOW.getTime() + (overrides.deadlineOffsetH ?? 6) * HOUR);
  const altStart =
    overrides.altStartOffsetH == null
      ? undefined
      : new Date(NOW.getTime() + overrides.altStartOffsetH * HOUR);

  const result = await negotiationAgent.run(
    {
      step: 'evaluate',
      counter: {
        message: 'Could we make it later?',
        reason: 'timing',
        altWindow: altStart ? { start: altStart, end: new Date(altStart.getTime() + 30 * 60_000) } : undefined,
        partialQtyKg: overrides.partialQtyKg,
      },
      orgName: 'Test Org',
      quantityKg: 10,
      freshnessDeadlineAt: deadline,
      escalationsSoFar: overrides.escalationsSoFar ?? 0,
      hasNextCandidate: overrides.hasNextCandidate ?? true,
      now: NOW,
    },
    ctx
  );

  return result.output as EvaluateDecision;
}

describe('evaluating a counter-offer', () => {
  it('accepts a later time that still lands inside the safe window', async () => {
    const decision = await evaluate({ altStartOffsetH: 3, deadlineOffsetH: 6 });
    expect(decision.action).toBe('ACCEPT');
  });

  it('escalates when the proposed time is past the deadline and someone else is available', async () => {
    const decision = await evaluate({
      altStartOffsetH: 9,
      deadlineOffsetH: 6,
      hasNextCandidate: true,
    });
    expect(decision.action).toBe('ESCALATE');
  });

  it('composts when the time will not work and there is nobody else', async () => {
    const decision = await evaluate({
      altStartOffsetH: 9,
      deadlineOffsetH: 6,
      hasNextCandidate: false,
    });
    expect(decision.action).toBe('COMPOST');
  });

  it('stops escalating once the cap is reached', async () => {
    const decision = await evaluate({
      altStartOffsetH: 9,
      deadlineOffsetH: 6,
      hasNextCandidate: true,
      escalationsSoFar: 2,
    });
    expect(decision.action).toBe('COMPOST');
  });

  it('accepts a partial quantity that is still worth a trip', async () => {
    const decision = await evaluate({ altStartOffsetH: 2, partialQtyKg: 6 });
    expect(decision.action).toBe('ACCEPT');
    if (decision.action === 'ACCEPT') expect(decision.acceptedQtyKg).toBe(6);
  });

  it('looks elsewhere when the partial offer is a token amount', async () => {
    // 1 kg of 10 kg leaves 9 kg still heading for a bin, so try for the whole lot first.
    const decision = await evaluate({ altStartOffsetH: 2, partialQtyKg: 1 });
    expect(decision.action).toBe('ESCALATE');
  });

  it('takes the token amount anyway when there is no alternative', async () => {
    const decision = await evaluate({
      altStartOffsetH: 2,
      partialQtyKg: 1,
      hasNextCandidate: false,
    });
    expect(decision.action).toBe('ACCEPT');
  });

  it('accepts a counter with no time change at all', async () => {
    const decision = await evaluate({});
    expect(decision.action).toBe('ACCEPT');
    if (decision.action === 'ACCEPT') expect(decision.acceptedQtyKg).toBe(10);
  });

  it('always explains itself in plain language', async () => {
    const decision = await evaluate({ altStartOffsetH: 9, hasNextCandidate: false });
    expect(decision.message.length).toBeGreaterThan(20);
    expect(decision.message).not.toMatch(/[{}[\]]/);
  });
});
