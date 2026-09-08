import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { AGENT_IDS } from '@/lib/domain';

/**
 * Append-only agent decision log.
 *
 * This collection is simultaneously the audit trail, the causal record of a run, and the data
 * behind the Agent Activity Feed — the project's "aha" screen. It exists from day one for that
 * reason: if an agent action produces no event, the user cannot see it, and per the spec it
 * therefore does not exist.
 */

const agentEventSchema = new Schema(
  {
    runId: { type: Schema.Types.ObjectId, ref: 'AgentRun', required: true },
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: false },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    agentId: { type: String, enum: AGENT_IDS, required: true },
    kind: { type: String, required: true },

    /**
     * The one plain-language sentence a non-technical user reads in the feed. Never JSON,
     * never a stack trace, never a model id.
     */
    summary: { type: String, required: true },
    /** Raw payload, shown only behind the "details" disclosure. */
    detail: { type: Schema.Types.Mixed, required: false },

    /** Renders the causal chain between steps as the feed's connector line. */
    causedBy: { type: Schema.Types.ObjectId, ref: 'AgentEvent', required: false },

    latencyMs: { type: Number, required: true, default: 0 },
    costUsd: { type: Number, required: true, default: 0 },
    /** True when the output came from a deterministic fixture. Always surfaced in the UI. */
    fixture: { type: Boolean, required: true, default: false },
    /** Set when a labelled fallback produced this result, e.g. HAVERSINE instead of OSRM. */
    fallback: { type: String, required: false },

    at: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false }
);

agentEventSchema.index({ userId: 1, at: -1 });
agentEventSchema.index({ runId: 1, at: 1 });

export type AgentEventDoc = InferSchemaType<typeof agentEventSchema>;

export const AgentEvent: Model<AgentEventDoc> =
  (mongoose.models.AgentEvent as Model<AgentEventDoc>) ??
  mongoose.model<AgentEventDoc>('AgentEvent', agentEventSchema);
