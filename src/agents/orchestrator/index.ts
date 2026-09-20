import { Types } from 'mongoose';
import { THRESHOLDS, isTerminal, kindOf, type MatchState } from '@/lib/domain';
import { env } from '@/lib/env';
import { recordEvent } from '@/lib/agent-log';
import { haversineKm } from '@/lib/geo';
import type { Window } from '@/lib/hours';
import { formatMass } from '@/lib/units';
import { AgentRun } from '@/models/agent-run';
import { Match } from '@/models/match';
import { RecipientProfile } from '@/models/recipient-profile';
import { InventoryItem } from '@/models/inventory-item';
import { ImpactLog } from '@/models/impact-log';
import { makeContext } from '@/agents/registry';
import { negotiationAgent, type RankOutput, type EvaluateDecision, type OfferOutput } from '@/agents/negotiation';
import { needsColdChain, type CandidateInput } from '@/agents/negotiation/scoring';
import { logisticsAgent, type LogisticsOutput } from '@/agents/logistics';
import { impactAgent } from '@/agents/impact';
import { simulatedPartnerAgent } from '@/agents/partner';
import type { PartnerDecision } from '@/agents/partner/types';
import { sendOffer as sendTelegramOffer } from '@/agents/partner/telegram';
import {
  loadDonor,
  loadItems,
  loadMatch,
  loadNearbyRecipients,
  loadRecipient,
  summariseItems,
  type MatchView,
} from '@/agents/orchestrator/blackboard';

/**
 * The orchestrator.
 *
 * `advance()` performs exactly ONE state transition per call. That single constraint is what makes
 * the system survivable on serverless: a function timeout can never strand a run mid-flight, the
 * cron sweep resumes anything whose `nextActionAt` has passed, and the UI can drive a run forward
 * on demand. A long-running loop walking the whole machine would give up all three.
 *
 * Mutual exclusion is a `lockedUntil` lease taken with an atomic findOneAndUpdate. Work happens
 * only after the lease is held, so a duplicate call is a genuine no-op rather than a second set of
 * events — which is the difference between an idempotent step and a feed full of duplicates.
 */

const LEASE_MS = 45_000;
const MAX_ATTEMPTS = 5;

export type AdvanceOutcome =
  | { advanced: true; from: MatchState; to: MatchState; done: boolean; nextActionAt: Date | null }
  | { advanced: false; reason: 'not-found' | 'locked' | 'terminal' | 'too-many-attempts' | 'error'; message?: string };

type Logger = (input: {
  agentId: Parameters<typeof recordEvent>[0]['agentId'];
  kind: string;
  summary: string;
  detail?: unknown;
  latencyMs?: number;
  costUsd?: number;
  fixture?: boolean;
  fallback?: string | undefined;
}) => Promise<void>;

type StepContext = {
  runId: Types.ObjectId;
  userId: Types.ObjectId;
  matchId: Types.ObjectId;
  match: MatchView;
  now: Date;
  log: Logger;
};

type StepResult = {
  nextState: MatchState;
  /** How long before this run should be picked up again. 0 means immediately. */
  delayMs?: number;
  costUsd?: number;
};

// ---------------------------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------------------------

/** PREDICTED → CANDIDATES_RANKED (or straight to compost when nobody can take it). */
async function stepRank(ctx: StepContext): Promise<StepResult> {
  const [donor, items] = await Promise.all([
    loadDonor(ctx.match.donorId),
    loadItems(ctx.match.itemIds),
  ]);

  if (!donor || items.length === 0) {
    await ctx.log({
      agentId: 'negotiation',
      kind: 'rank_aborted',
      summary: 'Cannot match this without a home location on the account.',
    });
    return { nextState: 'FAILED' };
  }

  const primary = items[0];
  if (!primary) return { nextState: 'FAILED' };

  const recipients = await loadNearbyRecipients(donor.coordinates, { maxKm: 15 });
  const remainingHours = (ctx.match.freshnessDeadlineAt.getTime() - ctx.now.getTime()) / 3_600_000;

  const candidates: CandidateInput[] = recipients.map((r) => ({
    recipientId: String(r.id),
    orgName: r.orgName,
    distanceKm: haversineKm(donor.coordinates, r.coordinates),
    coverageRadiusKm: r.coverageRadiusKm,
    acceptedCategories: r.acceptedCategories,
    coldChainCapable: r.coldChainCapable,
    dailyCapacityKg: r.dailyCapacityKg,
    capacityUsedTodayKg: r.capacityUsedTodayKg,
    operatingHours: r.operatingHours,
  }));

  const result = await negotiationAgent.run(
    {
      step: 'rank',
      candidates,
      itemSummary: summariseItems(items),
      context: {
        category: primary.category,
        quantityKg: ctx.match.quantityKg,
        needsColdChain: needsColdChain(primary.category, remainingHours),
        now: ctx.now,
        freshnessDeadlineAt: ctx.match.freshnessDeadlineAt,
      },
    },
    makeContext({ agentId: 'negotiation', runId: ctx.runId, userId: ctx.userId, matchId: ctx.matchId })
  );

  const output = result.output as RankOutput;

  await Match.updateOne(
    { _id: ctx.matchId },
    {
      $set: {
        candidates: output.ranked.map((c, index) => ({
          recipientId: new Types.ObjectId(c.recipientId),
          orgName: c.orgName,
          rank: index + 1,
          score: c.score,
          subScores: c.subScores,
          distanceKm: c.distanceKm,
          rejectedReason: c.rejectedReason ?? undefined,
        })),
        justification: output.justification || undefined,
      },
    }
  );

  await ctx.log({
    agentId: 'negotiation',
    kind: output.chosen ? 'candidates_ranked' : 'no_recipient_available',
    summary: result.rationale,
    detail: {
      considered: output.ranked.length,
      ranked: output.ranked.map((c) => ({
        orgName: c.orgName,
        score: c.score,
        distanceKm: c.distanceKm,
        eligible: c.eligible,
        rejectedReason: c.rejectedReason ?? null,
        subScores: c.subScores,
      })),
    },
    latencyMs: result.meta.latencyMs,
    costUsd: result.meta.costUsd,
    fixture: result.meta.fixture,
    fallback: result.fallback,
  });

  if (!output.chosen) return { nextState: 'COMPOST_DIVERTED', costUsd: result.meta.costUsd };

  await Match.updateOne(
    { _id: ctx.matchId },
    { $set: { recipientId: new Types.ObjectId(output.chosen.recipientId) } }
  );

  return { nextState: 'CANDIDATES_RANKED', delayMs: 0, costUsd: result.meta.costUsd };
}

/** CANDIDATES_RANKED → NEGOTIATING. Logistics works out the route and the offerable windows. */
async function stepPlanPickup(ctx: StepContext): Promise<StepResult> {
  const [donor, recipient] = await Promise.all([
    loadDonor(ctx.match.donorId),
    ctx.match.recipientId ? loadRecipient(ctx.match.recipientId) : Promise.resolve(null),
  ]);

  if (!donor || !recipient) return { nextState: 'FAILED' };

  const result = await logisticsAgent.run(
    {
      donorCoordinates: donor.coordinates,
      recipientCoordinates: recipient.coordinates,
      recipientHours: recipient.operatingHours,
      freshnessDeadlineAt: ctx.match.freshnessDeadlineAt,
      now: ctx.now,
    },
    makeContext({ agentId: 'logistics', runId: ctx.runId, userId: ctx.userId, matchId: ctx.matchId })
  );

  const output = result.output as LogisticsOutput;

  await Match.updateOne(
    { _id: ctx.matchId },
    {
      $set: {
        'pickup.windows': output.windows,
        'pickup.distanceKm': output.distanceKm,
        'pickup.durationMin': output.durationMin,
        'pickup.method': output.method,
      },
    }
  );

  await ctx.log({
    agentId: 'logistics',
    kind: output.windows.length > 0 ? 'windows_proposed' : 'no_window',
    summary: result.rationale,
    detail: {
      distanceKm: output.distanceKm,
      durationMin: output.durationMin,
      method: output.method,
      windows: output.windows.map((w) => w.start.toISOString()),
    },
    latencyMs: result.meta.latencyMs,
    fixture: result.meta.fixture,
    fallback: result.fallback,
  });

  // Nobody is open before the food turns. That is a real-world outcome, not an error.
  if (output.windows.length === 0) return { nextState: 'COMPOST_DIVERTED' };

  return { nextState: 'NEGOTIATING', delayMs: 0 };
}

/** NEGOTIATING → OUTREACH_SENT. The donor side puts the offer. */
async function stepSendOffer(ctx: StepContext): Promise<StepResult> {
  const [donor, recipient, items] = await Promise.all([
    loadDonor(ctx.match.donorId),
    ctx.match.recipientId ? loadRecipient(ctx.match.recipientId) : Promise.resolve(null),
    loadItems(ctx.match.itemIds),
  ]);

  if (!donor || !recipient) return { nextState: 'FAILED' };

  const distanceKm = haversineKm(donor.coordinates, recipient.coordinates);
  const isRevisedOffer = ctx.match.transcriptLength > 0;

  const result = await negotiationAgent.run(
    {
      step: 'offer',
      itemSummary: summariseItems(items),
      quantityKg: ctx.match.quantityKg,
      orgName: recipient.orgName,
      distanceKm,
      freshnessDeadlineAt: ctx.match.freshnessDeadlineAt,
      windows: ctx.match.pickupWindows,
      isRevisedOffer,
    },
    makeContext({ agentId: 'negotiation', runId: ctx.runId, userId: ctx.userId, matchId: ctx.matchId })
  );

  const output = result.output as OfferOutput;
  const turn = ctx.match.transcriptLength + 1;

  await Match.updateOne(
    { _id: ctx.matchId },
    {
      $push: {
        transcript: {
          turn,
          from: 'DONOR_AGENT',
          intent: 'OFFER',
          message: output.message,
          payload: { quantityKg: ctx.match.quantityKg, isRevisedOffer },
          at: ctx.now,
        },
      },
    }
  );

  await ctx.log({
    agentId: 'negotiation',
    kind: 'offer_sent',
    summary: `→ ${recipient.orgName}: ${output.message}`,
    detail: { turn, message: output.message, distanceKm },
    latencyMs: result.meta.latencyMs,
    costUsd: result.meta.costUsd,
    fixture: result.meta.fixture,
  });

  // A real partner on Telegram gets the message and we wait. A simulated one answers next tick.
  if (!recipient.isSimulated && recipient.telegramChatId) {
    const delivered = await sendTelegramOffer({
      chatId: recipient.telegramChatId,
      matchId: String(ctx.matchId),
      message: output.message,
      quantityKg: ctx.match.quantityKg,
      windows: ctx.match.pickupWindows,
    });

    await ctx.log({
      agentId: 'partner',
      kind: delivered ? 'awaiting_human_reply' : 'telegram_unavailable',
      summary: delivered
        ? `Sent to ${recipient.orgName} on Telegram — waiting for their reply.`
        : `Could not reach ${recipient.orgName} on Telegram, so their agent will answer instead.`,
      fallback: delivered ? undefined : 'simulated_recipient',
    });

    if (delivered) {
      // The webhook advances this run when the human taps a button.
      return { nextState: 'OUTREACH_SENT', delayMs: 5 * 60_000, costUsd: result.meta.costUsd };
    }
  }

  return { nextState: 'OUTREACH_SENT', delayMs: 0, costUsd: result.meta.costUsd };
}

/** OUTREACH_SENT → AGREED | COUNTERED | escalate | compost. The counterparty answers. */
async function stepPartnerResponds(ctx: StepContext): Promise<StepResult> {
  const [recipient, items] = await Promise.all([
    ctx.match.recipientId ? loadRecipient(ctx.match.recipientId) : Promise.resolve(null),
    loadItems(ctx.match.itemIds),
  ]);

  if (!recipient) return { nextState: 'FAILED' };

  const donor = await loadDonor(ctx.match.donorId);
  const primary = items[0];
  if (!donor || !primary) return { nextState: 'FAILED' };

  const result = await simulatedPartnerAgent.run(
    {
      offer: {
        matchId: String(ctx.matchId),
        itemSummary: summariseItems(items),
        category: primary.category,
        quantityKg: ctx.match.quantityKg,
        isCooked: primary.isCooked,
        freshnessDeadlineAt: ctx.match.freshnessDeadlineAt,
        proposedWindows: ctx.match.pickupWindows,
        distanceKm: haversineKm(donor.coordinates, recipient.coordinates),
        turn: ctx.match.transcriptLength + 1,
        isRevisedOffer: ctx.match.transcriptLength > 2,
      },
      state: {
        recipientId: String(recipient.id),
        orgName: recipient.orgName,
        orgType: recipient.orgType,
        acceptedCategories: recipient.acceptedCategories,
        coldChainCapable: recipient.coldChainCapable,
        dailyCapacityKg: recipient.dailyCapacityKg,
        capacityUsedTodayKg: recipient.capacityUsedTodayKg,
        operatingHours: recipient.operatingHours,
        disposition: recipient.disposition ?? undefined,
      },
      now: ctx.now,
    },
    makeContext({ agentId: 'partner', runId: ctx.runId, userId: ctx.userId, matchId: ctx.matchId })
  );

  return applyPartnerDecision(ctx, result.output as PartnerDecision, recipient.orgName, {
    latencyMs: result.meta.latencyMs,
    costUsd: result.meta.costUsd,
    fixture: result.meta.fixture,
  });
}

/**
 * Shared by the simulated partner and the Telegram webhook, so a real human's tap and a partner
 * agent's decision land on the blackboard through exactly the same code.
 */
export async function applyPartnerDecision(
  ctx: StepContext,
  decision: PartnerDecision,
  orgName: string,
  meta: { latencyMs?: number; costUsd?: number; fixture?: boolean }
): Promise<StepResult> {
  const turn = ctx.match.transcriptLength + 1;
  const intent =
    decision.kind === 'ACCEPT' ? 'ACCEPT' : decision.kind === 'COUNTER' ? 'COUNTER' : 'DECLINE';

  await Match.updateOne(
    { _id: ctx.matchId },
    {
      $push: {
        transcript: {
          turn,
          from: 'PARTNER_AGENT',
          intent,
          message: decision.message,
          payload: {
            reason: decision.reason ?? null,
            partialQtyKg: decision.partialQtyKg ?? null,
            altStart: decision.altWindow?.start ?? null,
          },
          at: ctx.now,
        },
      },
    }
  );

  await ctx.log({
    agentId: 'partner',
    kind: `partner_${decision.kind.toLowerCase()}`,
    summary: `← ${orgName}: ${decision.message}`,
    detail: {
      turn,
      kind: decision.kind,
      reason: decision.reason ?? null,
      partialQtyKg: decision.partialQtyKg ?? null,
      altStart: decision.altWindow?.start?.toISOString() ?? null,
    },
    latencyMs: meta.latencyMs,
    costUsd: meta.costUsd,
    fixture: meta.fixture,
  });

  if (decision.kind === 'ACCEPT') {
    await commitAgreement(ctx, ctx.match.quantityKg, decision.altWindow);
    return { nextState: 'AGREED', delayMs: 0, costUsd: meta.costUsd };
  }

  if (decision.kind === 'COUNTER') return { nextState: 'COUNTERED', delayMs: 0, costUsd: meta.costUsd };

  // Declined outright: try the next candidate, or divert.
  return nextAfterRefusal(ctx, orgName);
}

/** COUNTERED → AGREED | NEGOTIATING (revised offer) | next candidate | compost. */
async function stepEvaluateCounter(ctx: StepContext): Promise<StepResult> {
  const doc = await Match.findById(ctx.matchId).lean();
  const lastTurn = doc?.transcript.at(-1);
  const recipient = ctx.match.recipientId ? await loadRecipient(ctx.match.recipientId) : null;

  if (!doc || !lastTurn || !recipient) return { nextState: 'FAILED' };

  const payload = (lastTurn.payload ?? {}) as {
    partialQtyKg?: number | null;
    altStart?: Date | string | null;
    reason?: string | null;
  };

  const altStart = payload.altStart ? new Date(payload.altStart) : null;
  const altWindow: Window | undefined =
    altStart && !Number.isNaN(altStart.getTime())
      ? { start: altStart, end: new Date(altStart.getTime() + 30 * 60_000) }
      : undefined;

  const eligible = ctx.match.candidates.filter((c) => !c.rejectedReason);
  const hasNextCandidate = eligible.length > ctx.match.escalations + 1;

  const result = await negotiationAgent.run(
    {
      step: 'evaluate',
      counter: {
        altWindow,
        partialQtyKg: payload.partialQtyKg ?? undefined,
        reason: payload.reason ?? undefined,
        message: lastTurn.message,
      },
      orgName: recipient.orgName,
      quantityKg: ctx.match.quantityKg,
      freshnessDeadlineAt: ctx.match.freshnessDeadlineAt,
      escalationsSoFar: ctx.match.escalations,
      hasNextCandidate,
      now: ctx.now,
    },
    makeContext({ agentId: 'negotiation', runId: ctx.runId, userId: ctx.userId, matchId: ctx.matchId })
  );

  const decision = result.output as EvaluateDecision;

  await ctx.log({
    agentId: 'negotiation',
    kind: `counter_${decision.action.toLowerCase()}`,
    summary: result.rationale,
    detail: {
      action: decision.action,
      altStart: altWindow?.start.toISOString() ?? null,
      partialQtyKg: payload.partialQtyKg ?? null,
      deadline: ctx.match.freshnessDeadlineAt.toISOString(),
    },
    latencyMs: result.meta.latencyMs,
    fixture: result.meta.fixture,
  });

  if (decision.action === 'ACCEPT') {
    await commitAgreement(ctx, decision.acceptedQtyKg, decision.window);
    return { nextState: 'AGREED', delayMs: 0 };
  }

  if (decision.action === 'COUNTER') {
    return { nextState: 'NEGOTIATING', delayMs: 0 };
  }

  if (decision.action === 'ESCALATE') {
    return escalate(ctx);
  }

  return { nextState: 'COMPOST_DIVERTED', delayMs: 0 };
}

async function nextAfterRefusal(ctx: StepContext, orgName: string): Promise<StepResult> {
  const eligible = ctx.match.candidates.filter((c) => !c.rejectedReason);
  const hasNext = eligible.length > ctx.match.escalations + 1;

  if (hasNext && ctx.match.escalations < THRESHOLDS.MAX_ESCALATIONS) {
    return escalate(ctx);
  }

  await ctx.log({
    agentId: 'negotiation',
    kind: 'all_recipients_exhausted',
    summary: `${orgName} was the last option in range — diverting to compost so it does not reach landfill.`,
  });

  return { nextState: 'COMPOST_DIVERTED', delayMs: 0 };
}

async function escalate(ctx: StepContext): Promise<StepResult> {
  const eligible = ctx.match.candidates.filter((c) => !c.rejectedReason);
  const next = eligible[ctx.match.escalations + 1];

  if (!next) return { nextState: 'COMPOST_DIVERTED', delayMs: 0 };

  await Match.updateOne(
    { _id: ctx.matchId },
    { $set: { recipientId: next.recipientId }, $inc: { escalations: 1 } }
  );

  await ctx.log({
    agentId: 'negotiation',
    kind: 'escalated',
    summary: `Moving on to ${next.orgName}, ${next.distanceKm.toFixed(1)} km away — next best on the ranking.`,
    detail: { escalation: ctx.match.escalations + 1, orgName: next.orgName },
  });

  // Re-plan the route and windows for the new recipient before offering.
  return { nextState: 'CANDIDATES_RANKED', delayMs: 0 };
}

async function commitAgreement(
  ctx: StepContext,
  acceptedQtyKg: number,
  window: Window | undefined
): Promise<void> {
  const update: Record<string, unknown> = { quantityKg: acceptedQtyKg };
  if (window) update['pickup.chosen'] = window;

  await Match.updateOne({ _id: ctx.matchId }, { $set: update });

  // The recipient's day is now that much fuller — this feeds back into future scoring.
  if (ctx.match.recipientId) {
    await RecipientProfile.updateOne(
      { _id: ctx.match.recipientId },
      { $inc: { capacityUsedTodayKg: acceptedQtyKg } }
    );
  }
}

/** AGREED → SCHEDULED. Confirm the window and look for a trip to combine with. */
async function stepSchedule(ctx: StepContext): Promise<StepResult> {
  const [donor, recipient] = await Promise.all([
    loadDonor(ctx.match.donorId),
    ctx.match.recipientId ? loadRecipient(ctx.match.recipientId) : Promise.resolve(null),
  ]);
  if (!donor || !recipient) return { nextState: 'FAILED' };

  const doc = await Match.findById(ctx.matchId).lean();
  const chosen = doc?.pickup?.chosen;
  const agreedWindow: Window | undefined = chosen
    ? { start: chosen.start, end: chosen.end }
    : ctx.match.pickupWindows[0];

  // Other pickups this recipient already has, for trip combining.
  const siblings = await Match.find({
    recipientId: recipient.id,
    state: { $in: ['SCHEDULED', 'AGREED'] },
    _id: { $ne: ctx.matchId },
  })
    .limit(4)
    .lean();

  const result = await logisticsAgent.run(
    {
      donorCoordinates: donor.coordinates,
      recipientCoordinates: recipient.coordinates,
      recipientHours: recipient.operatingHours,
      freshnessDeadlineAt: ctx.match.freshnessDeadlineAt,
      now: ctx.now,
      agreedWindow,
      otherPickups: siblings.flatMap((sibling) => {
        const chosenWindow = sibling.pickup?.chosen;
        if (!chosenWindow) return [];
        return [
          {
            matchId: String(sibling._id),
            itemSummary: 'another pickup',
            donorCoordinates: donor.coordinates,
            window: { start: chosenWindow.start, end: chosenWindow.end },
          },
        ];
      }),
    },
    makeContext({ agentId: 'logistics', runId: ctx.runId, userId: ctx.userId, matchId: ctx.matchId })
  );

  const output = result.output as LogisticsOutput;

  await Match.updateOne(
    { _id: ctx.matchId },
    {
      $set: {
        'pickup.chosen': output.chosen ?? undefined,
        'pickup.distanceKm': output.distanceKm,
        'pickup.durationMin': output.durationMin,
        'pickup.method': output.method,
        ...(output.multiStop ? { 'pickup.multiStop': output.multiStop } : {}),
      },
    }
  );

  await ctx.log({
    agentId: 'logistics',
    kind: 'pickup_scheduled',
    summary: result.rationale,
    detail: {
      chosen: output.chosen?.start.toISOString() ?? null,
      distanceKm: output.distanceKm,
      durationMin: output.durationMin,
      method: output.method,
      multiStop: output.multiStop ?? null,
    },
    latencyMs: result.meta.latencyMs,
    fixture: result.meta.fixture,
    fallback: result.fallback,
  });

  await InventoryItem.updateMany({ _id: { $in: ctx.match.itemIds } }, { $set: { state: 'POSTED' } });

  // In demo mode the handoff is treated as happening shortly after, so the full loop is visible
  // inside a 90-second walkthrough. In live mode it waits for someone to confirm collection.
  return { nextState: 'SCHEDULED', delayMs: env().DEMO_MODE ? 2000 : 24 * 3600_000 };
}

/** SCHEDULED → COMPLETED. */
async function stepComplete(ctx: StepContext): Promise<StepResult> {
  await InventoryItem.updateMany(
    { _id: { $in: ctx.match.itemIds } },
    { $set: { state: 'DIVERTED' } }
  );

  await Match.updateOne({ _id: ctx.matchId }, { $set: { outcome: 'REDISTRIBUTED' } });

  await ctx.log({
    agentId: 'logistics',
    kind: 'handoff_complete',
    summary: `Collected — ${formatMass(ctx.match.quantityKg)} handed over.`,
    fixture: env().DEMO_MODE,
  });

  return { nextState: 'COMPLETED', delayMs: 0 };
}

/** COMPOST_DIVERTED → COMPLETED, via the nearest compost or biogas partner that takes it. */
async function stepDivertToCompost(ctx: StepContext): Promise<StepResult> {
  const [donor, items] = await Promise.all([
    loadDonor(ctx.match.donorId),
    loadItems(ctx.match.itemIds),
  ]);
  const primary = items[0];
  if (!donor || !primary) return { nextState: 'FAILED' };

  const sinks = await loadNearbyRecipients(donor.coordinates, { maxKm: 25, onlyCompost: true });

  /*
   * The sink has to actually accept the category. Composting is a food route: sending textiles or
   * household goods to an organic waste plant is wrong operationally, and it would also let the
   * Impact Agent be handed a diversion it has no cited factor for. Filtering on the sink's own
   * declared categories keeps that impossible rather than merely discouraged.
   */
  const sink = sinks.find((candidate) => candidate.acceptedCategories.includes(primary.category));

  if (!sink) {
    const isMaterial = kindOf(primary.category) === 'MATERIAL';
    const pastDeadline = ctx.match.freshnessDeadlineAt.getTime() <= ctx.now.getTime();

    await ctx.log({
      agentId: 'negotiation',
      kind: 'diversion_failed',
      summary: isMaterial
        ? `No reuse partner in range takes ${primary.name.toLowerCase()} — composting is not a route for it, so it stays with you.`
        : pastDeadline
          ? 'No compost or biogas partner in range either — this one is a genuine loss.'
          : `No diversion route for ${primary.name.toLowerCase()} right now — it stays in your pantry and will be tried again.`,
      detail: { category: primary.category, isMaterial, pastDeadline },
      fallback: 'no_diversion_route',
    });

    await Match.updateOne({ _id: ctx.matchId }, { $set: { outcome: 'FAILED' } });

    /*
     * Only call it waste when it genuinely is. Unmatched clothes are not wasted, and food that is
     * still inside its window is not either — both go back to the pantry so they can be tried
     * again rather than being written off to make a state machine tidy.
     */
    await InventoryItem.updateMany(
      { _id: { $in: ctx.match.itemIds } },
      { $set: { state: !isMaterial && pastDeadline ? 'WASTED' : 'ACTIVE' } }
    );

    return { nextState: 'FAILED' };
  }

  const distanceKm = haversineKm(donor.coordinates, sink.coordinates);

  await Match.updateOne(
    { _id: ctx.matchId },
    { $set: { recipientId: sink.id, outcome: 'COMPOSTED', 'pickup.distanceKm': distanceKm } }
  );
  await InventoryItem.updateMany({ _id: { $in: ctx.match.itemIds } }, { $set: { state: 'DIVERTED' } });

  await ctx.log({
    agentId: 'logistics',
    kind: 'composted',
    summary: `Routed to ${sink.orgName} for composting, ${distanceKm.toFixed(1)} km away — kept out of landfill, though the food itself is lost.`,
    detail: { orgName: sink.orgName, distanceKm },
  });

  return { nextState: 'COMPLETED', delayMs: 0 };
}

/** COMPLETED → IMPACT_LOGGED. */
async function stepLogImpact(ctx: StepContext): Promise<StepResult> {
  const doc = await Match.findById(ctx.matchId).lean();
  const items = await loadItems(ctx.match.itemIds);
  const primary = items[0];

  if (!doc || !primary) return { nextState: 'FAILED' };

  const outcome = doc.outcome === 'COMPOSTED' ? 'COMPOSTED' : 'REDISTRIBUTED';

  const result = await impactAgent.run(
    { category: primary.category, quantityKg: ctx.match.quantityKg, outcome },
    makeContext({ agentId: 'impact', runId: ctx.runId, userId: ctx.userId, matchId: ctx.matchId })
  );

  const output = result.output;

  // Upsert so a re-run cannot double-count a saving.
  await ImpactLog.updateOne(
    { matchId: ctx.matchId },
    {
      $set: {
        userId: ctx.userId,
        quantityKg: output.quantityKg,
        category: primary.category,
        outcome: output.outcome,
        co2eKg: output.co2eKg ?? undefined,
        waterL: output.waterL ?? undefined,
        landM2: output.landM2 ?? undefined,
        notQuantified: output.notQuantified,
        notQuantifiedReason: output.notQuantifiedReason,
        factorSource: output.factorSource,
        at: ctx.now,
      },
    },
    { upsert: true }
  );

  await ctx.log({
    agentId: 'impact',
    kind: 'impact_logged',
    summary: result.rationale,
    detail: {
      outcome: output.outcome,
      co2eKg: output.co2eKg,
      waterL: output.waterL,
      landM2: output.landM2,
      notQuantified: output.notQuantified,
      factorSource: output.factorSource,
    },
    latencyMs: result.meta.latencyMs,
    fixture: result.meta.fixture,
    fallback: result.fallback,
  });

  return { nextState: 'IMPACT_LOGGED' };
}

const TRANSITIONS: Partial<Record<MatchState, (ctx: StepContext) => Promise<StepResult>>> = {
  PREDICTED: stepRank,
  CANDIDATES_RANKED: stepPlanPickup,
  NEGOTIATING: stepSendOffer,
  OUTREACH_SENT: stepPartnerResponds,
  COUNTERED: stepEvaluateCounter,
  AGREED: stepSchedule,
  SCHEDULED: stepComplete,
  COMPOST_DIVERTED: stepDivertToCompost,
  COMPLETED: stepLogImpact,
};

// ---------------------------------------------------------------------------------------------
// The one public entry point
// ---------------------------------------------------------------------------------------------

export async function advance(runId: Types.ObjectId, now = new Date()): Promise<AdvanceOutcome> {
  // Take the lease atomically. Anything already leased belongs to another worker.
  const run = await AgentRun.findOneAndUpdate(
    {
      _id: runId,
      $or: [{ lockedUntil: null }, { lockedUntil: { $exists: false } }, { lockedUntil: { $lte: now } }],
    },
    { $set: { lockedUntil: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 } },
    { new: true }
  );

  if (!run) {
    const exists = await AgentRun.exists({ _id: runId });
    return { advanced: false, reason: exists ? 'locked' : 'not-found' };
  }

  const state = run.state as MatchState;

  if (isTerminal(state)) {
    await AgentRun.updateOne({ _id: runId }, { $set: { lockedUntil: null } });
    return { advanced: false, reason: 'terminal' };
  }

  if (run.attempts > MAX_ATTEMPTS) {
    await AgentRun.updateOne(
      { _id: runId },
      { $set: { state: 'FAILED', lockedUntil: null, endedAt: now, lastError: 'retry limit reached' } }
    );
    return { advanced: false, reason: 'too-many-attempts' };
  }

  const handler = TRANSITIONS[state];
  if (!handler || !run.matchId) {
    await AgentRun.updateOne({ _id: runId }, { $set: { lockedUntil: null } });
    return { advanced: false, reason: 'terminal' };
  }

  const match = await loadMatch(run.matchId);
  if (!match) {
    await AgentRun.updateOne({ _id: runId }, { $set: { state: 'FAILED', lockedUntil: null, endedAt: now } });
    return { advanced: false, reason: 'not-found' };
  }

  // Threads causedBy through the whole run, not just this transition, so the feed can draw one
  // unbroken causal line from the first observation to the logged impact.
  let lastEventId: Types.ObjectId | undefined = run.lastEventId ?? undefined;
  const log: Logger = async (input) => {
    const recorded = await recordEvent({
      runId,
      userId: run.userId,
      matchId: run.matchId ?? undefined,
      agentId: input.agentId,
      kind: input.kind,
      summary: input.summary,
      detail: input.detail,
      causedBy: lastEventId,
      latencyMs: input.latencyMs ?? 0,
      costUsd: input.costUsd ?? 0,
      fixture: input.fixture ?? false,
      fallback: input.fallback,
    });
    lastEventId = recorded.id;
  };

  try {
    const result = await handler({
      runId,
      userId: run.userId,
      matchId: run.matchId,
      match,
      now,
      log,
    });

    const done = isTerminal(result.nextState);
    const nextActionAt = new Date(now.getTime() + (result.delayMs ?? 0));

    await Promise.all([
      Match.updateOne({ _id: run.matchId }, { $set: { state: result.nextState } }),
      AgentRun.updateOne(
        { _id: runId },
        {
          $set: {
            state: result.nextState,
            nextActionAt,
            lockedUntil: null,
            attempts: 0,
            ...(lastEventId ? { lastEventId } : {}),
            ...(done ? { endedAt: now } : {}),
          },
          $inc: { totalCostUsd: result.costUsd ?? 0 },
        }
      ),
    ]);

    return {
      advanced: true,
      from: state,
      to: result.nextState,
      done,
      nextActionAt: done ? null : nextActionAt,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[orchestrator] ${state} failed for run ${String(runId)}`, cause);

    // Release the lease and back off, so the cron sweep retries rather than the run wedging.
    await AgentRun.updateOne(
      { _id: runId },
      {
        $set: {
          lockedUntil: null,
          lastError: message.slice(0, 400),
          nextActionAt: new Date(now.getTime() + 10_000),
        },
      }
    );

    return { advanced: false, reason: 'error', message };
  }
}

/** Runs due for another step. Used by the cron sweep. */
export async function dueRuns(now = new Date(), limit = 10): Promise<Types.ObjectId[]> {
  const docs = await AgentRun.find({
    state: { $nin: ['IMPACT_LOGGED', 'FAILED'] },
    nextActionAt: { $lte: now },
    $or: [{ lockedUntil: null }, { lockedUntil: { $exists: false } }, { lockedUntil: { $lte: now } }],
  })
    .sort({ nextActionAt: 1 })
    .limit(limit)
    .select('_id')
    .lean();

  return docs.map((d) => d._id);
}

export type { StepContext, StepResult };

/**
 * A real recipient answered on Telegram.
 *
 * Deliberately routed through the same `applyPartnerDecision` the simulated partner uses, so a
 * human tapping "Accept" and a partner agent choosing `accept` produce identical blackboard writes
 * and identical feed events. The orchestrator genuinely cannot tell which kind of counterparty it
 * is dealing with, which is what makes the demo path and the production path the same path.
 */
export async function handlePartnerReply(
  matchId: Types.ObjectId,
  decision: PartnerDecision,
  now = new Date()
): Promise<AdvanceOutcome> {
  const match = await loadMatch(matchId);
  if (!match) return { advanced: false, reason: 'not-found' };

  const run = await AgentRun.findOneAndUpdate(
    {
      _id: match.runId,
      $or: [{ lockedUntil: null }, { lockedUntil: { $exists: false } }, { lockedUntil: { $lte: now } }],
    },
    { $set: { lockedUntil: new Date(now.getTime() + LEASE_MS) } },
    { new: true }
  );

  if (!run) return { advanced: false, reason: 'locked' };

  const from = run.state as MatchState;

  // Only meaningful while we are actually waiting on them. A late tap on a stale message must not
  // reopen a settled match.
  if (from !== 'OUTREACH_SENT') {
    await AgentRun.updateOne({ _id: run._id }, { $set: { lockedUntil: null } });
    return { advanced: false, reason: 'terminal' };
  }

  const recipient = match.recipientId ? await loadRecipient(match.recipientId) : null;

  let lastEventId: Types.ObjectId | undefined = run.lastEventId ?? undefined;
  const log: Logger = async (input) => {
    const recorded = await recordEvent({
      runId: run._id,
      userId: run.userId,
      matchId,
      agentId: input.agentId,
      kind: input.kind,
      summary: input.summary,
      detail: input.detail,
      causedBy: lastEventId,
      latencyMs: input.latencyMs ?? 0,
      costUsd: input.costUsd ?? 0,
      fixture: false,
      fallback: input.fallback,
    });
    lastEventId = recorded.id;
  };

  const ctx: StepContext = {
    runId: run._id,
    userId: run.userId,
    matchId,
    match,
    now,
    log,
  };

  try {
    // A human reply is by definition not simulated; record that on the match.
    await Match.updateOne({ _id: matchId }, { $set: { partnerWasSimulated: false } });

    const result = await applyPartnerDecision(
      ctx,
      decision,
      recipient?.orgName ?? 'The recipient',
      { fixture: false }
    );

    const done = isTerminal(result.nextState);
    const nextActionAt = new Date(now.getTime() + (result.delayMs ?? 0));

    await Promise.all([
      Match.updateOne({ _id: matchId }, { $set: { state: result.nextState } }),
      AgentRun.updateOne(
        { _id: run._id },
        {
          $set: {
            state: result.nextState,
            nextActionAt,
            lockedUntil: null,
            attempts: 0,
            ...(lastEventId ? { lastEventId } : {}),
            ...(done ? { endedAt: now } : {}),
          },
        }
      ),
    ]);

    return {
      advanced: true,
      from,
      to: result.nextState,
      done,
      nextActionAt: done ? null : nextActionAt,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error('[orchestrator] telegram reply failed', cause);
    await AgentRun.updateOne(
      { _id: run._id },
      { $set: { lockedUntil: null, lastError: message.slice(0, 400) } }
    );
    return { advanced: false, reason: 'error', message };
  }
}
