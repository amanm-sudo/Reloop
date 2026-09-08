import { Types } from 'mongoose';
import { THRESHOLDS } from '@/lib/domain';
import { recordEvent } from '@/lib/agent-log';
import { AgentRun } from '@/models/agent-run';
import { InventoryItem } from '@/models/inventory-item';
import { Match } from '@/models/match';

/**
 * Creating a negotiation run.
 *
 * This is the moment the system stops being a pantry tracker and starts acting on the user's
 * behalf, so it is deliberately reachable two ways: automatically when the Prediction Agent
 * crosses the act-now threshold, and manually from the dashboard for a demo. Both land here, so
 * there is exactly one definition of what starting a run means.
 */

export type StartRunResult =
  | { started: true; runId: Types.ObjectId; matchId: Types.ObjectId }
  | { started: false; reason: 'not-found' | 'already-running' | 'needs-confirmation' | 'no-deadline' };

export async function startNegotiationRun(input: {
  userId: Types.ObjectId;
  itemId: Types.ObjectId;
  now?: Date;
}): Promise<StartRunResult> {
  const now = input.now ?? new Date();

  const item = await InventoryItem.findOne({ _id: input.itemId, userId: input.userId }).lean();
  if (!item || item.state !== 'ACTIVE') return { started: false, reason: 'not-found' };

  // An unconfirmed low-confidence extraction must never trigger autonomous outreach.
  if (item.extraction?.needsConfirmation) return { started: false, reason: 'needs-confirmation' };

  if (!item.actByAt) return { started: false, reason: 'no-deadline' };

  const existing = await Match.findOne({
    itemIds: item._id,
    state: { $nin: ['IMPACT_LOGGED', 'FAILED'] },
  })
    .select('_id runId')
    .lean();

  if (existing) {
    return { started: false, reason: 'already-running' };
  }

  const runId = new Types.ObjectId();
  const matchId = new Types.ObjectId();

  await Match.create({
    _id: matchId,
    runId,
    itemIds: [item._id],
    donorId: input.userId,
    state: 'PREDICTED',
    quantityKg: item.quantityKg,
    freshnessDeadlineAt: item.actByAt,
    candidates: [],
    transcript: [],
    escalations: 0,
    partnerWasSimulated: true,
  });

  await AgentRun.create({
    _id: runId,
    kind: 'NEGOTIATION',
    userId: input.userId,
    matchId,
    state: 'PREDICTED',
    nextActionAt: now,
    attempts: 0,
    totalCostUsd: 0,
    startedAt: now,
  });

  await recordEvent({
    runId,
    userId: input.userId,
    matchId,
    agentId: 'prediction',
    kind: 'run_started',
    summary:
      item.urgencyScore != null && item.urgencyScore >= THRESHOLDS.ACT_NOW
        ? `${item.name} crossed the act-now threshold — handing it to the Negotiation Agent.`
        : `Looking for a home for ${item.name} now.`,
    detail: { urgencyScore: item.urgencyScore ?? null, actByAt: item.actByAt.toISOString() },
  });

  return { started: true, runId, matchId };
}
