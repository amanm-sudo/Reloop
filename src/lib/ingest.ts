import type { Types } from 'mongoose';
import { kindOf, type ItemCategory, type StorageState } from '@/lib/domain';
import { recordEvent } from '@/lib/agent-log';
import { startNegotiationRun } from '@/lib/runs';
import { InventoryItem } from '@/models/inventory-item';
import { predictionAgent } from '@/agents/prediction';
import { makeContext } from '@/agents/registry';

/**
 * One definition of "an item entered the system".
 *
 * Manual entry and Perception extraction both come through here, so an item added by hand and one
 * read off a receipt get identical treatment: the same urgency estimate, the same feed event, and
 * the same autonomous hand-off when urgency crosses the threshold. Two code paths would inevitably
 * have drifted.
 */

export type IngestInput = {
  userId: Types.ObjectId;
  runId: Types.ObjectId;
  name: string;
  category: ItemCategory;
  quantity: number;
  unit: string;
  quantityKg: number;
  storage: StorageState;
  isCooked: boolean;
  preparedAt?: Date | undefined;
  bestBeforeAt?: Date | undefined;
  userDeadlineAt?: Date | undefined;
  source: 'PERCEPTION' | 'MANUAL';
  extraction?:
    | {
        rawName: string;
        rawQuantity: number;
        rawUnit: string;
        confidence: number;
        needsConfirmation: boolean;
      }
    | undefined;
  causedBy?: Types.ObjectId | undefined;
  now?: Date;
};

export type IngestResult = {
  itemId: Types.ObjectId;
  actByAt: Date;
  urgencyScore: number;
  shouldActNow: boolean;
  needsConfirmation: boolean;
  startedRunId: Types.ObjectId | null;
  summary: string;
};

export async function ingestItem(input: IngestInput): Promise<IngestResult> {
  const now = input.now ?? new Date();
  const startedAt = input.preparedAt ?? now;

  const prediction = await predictionAgent.run(
    {
      itemName: input.name,
      quantityKg: input.quantityKg,
      category: input.category,
      storage: input.storage,
      isCooked: input.isCooked,
      startedAt,
      bestBeforeAt: input.bestBeforeAt ?? null,
      userDeadlineAt: input.userDeadlineAt ?? null,
      now,
    },
    makeContext({ agentId: 'prediction', runId: input.runId, userId: input.userId })
  );

  const needsConfirmation = input.extraction?.needsConfirmation ?? false;

  const item = await InventoryItem.create({
    userId: input.userId,
    name: input.name,
    kind: kindOf(input.category),
    category: input.category,
    quantity: input.quantity,
    unit: input.unit,
    quantityKg: input.quantityKg,
    storage: input.storage,
    isCooked: input.isCooked,
    preparedAt: input.preparedAt,
    bestBeforeAt: input.bestBeforeAt,
    userDeadlineAt: input.userDeadlineAt,
    addedAt: now,
    source: input.source,
    perceptionRunId: input.source === 'PERCEPTION' ? input.runId : undefined,
    extraction: input.extraction
      ? { ...input.extraction, corrected: false }
      : undefined,
    actByAt: prediction.output.actByAt,
    urgencyScore: prediction.output.urgencyScore,
    lowConfidence: prediction.output.lowConfidence,
    urgencyBasis: prediction.output.basis,
    state: 'ACTIVE',
  });

  const recorded = await recordEvent({
    runId: input.runId,
    userId: input.userId,
    agentId: 'prediction',
    kind: 'urgency_estimated',
    summary: needsConfirmation
      ? `${prediction.rationale} Holding off until you confirm the reading.`
      : prediction.rationale,
    detail: {
      itemId: String(item._id),
      actByAt: prediction.output.actByAt.toISOString(),
      urgencyScore: prediction.output.urgencyScore,
      basis: prediction.output.basis,
      remainingHours: Math.round(prediction.output.remainingHours * 10) / 10,
      needsConfirmation,
    },
    causedBy: input.causedBy,
    latencyMs: prediction.meta.latencyMs,
    fixture: prediction.meta.fixture,
    fallback: prediction.fallback,
  });

  // Autonomy, but not recklessness: an unconfirmed low-confidence reading never triggers outreach.
  let startedRunId: Types.ObjectId | null = null;
  if (prediction.output.shouldActNow && !needsConfirmation) {
    const run = await startNegotiationRun({ userId: input.userId, itemId: item._id, now });
    if (run.started) startedRunId = run.runId;
  }

  return {
    itemId: item._id,
    actByAt: prediction.output.actByAt,
    urgencyScore: prediction.output.urgencyScore,
    shouldActNow: prediction.output.shouldActNow,
    needsConfirmation,
    startedRunId,
    summary: recorded.id ? prediction.rationale : prediction.rationale,
  };
}
