import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { MATCH_STATES } from '@/lib/domain';

/**
 * Queue entry and state-machine cursor.
 *
 * `advance()` performs exactly one transition per call, guarded by a findOneAndUpdate on the
 * expected `state` plus the `lockedUntil` lease. That is what makes a serverless timeout
 * survivable: the cron sweep picks up any run whose `nextActionAt` has passed, and a duplicate
 * advance is a no-op rather than a duplicate event.
 */

const agentRunSchema = new Schema(
  {
    kind: { type: String, enum: ['PERCEPTION', 'NEGOTIATION'], required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: false },

    state: { type: String, enum: MATCH_STATES, required: true },

    nextActionAt: { type: Date, required: true, default: () => new Date() },
    lockedUntil: { type: Date, required: false },
    attempts: { type: Number, required: true, default: 0 },
    lastError: { type: String, required: false },

    totalCostUsd: { type: Number, required: true, default: 0 },
    startedAt: { type: Date, required: true, default: () => new Date() },
    endedAt: { type: Date, required: false },
  },
  { timestamps: true }
);

// The cron sweep query. Compound so it can be served from the index alone.
agentRunSchema.index({ state: 1, nextActionAt: 1 });

export type AgentRunDoc = InferSchemaType<typeof agentRunSchema>;

export const AgentRun: Model<AgentRunDoc> =
  (mongoose.models.AgentRun as Model<AgentRunDoc>) ??
  mongoose.model<AgentRunDoc>('AgentRun', agentRunSchema);
