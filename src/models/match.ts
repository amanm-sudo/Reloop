import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import {
  MATCH_OUTCOMES,
  MATCH_STATES,
  NEGOTIATION_INTENTS,
  ROUTE_METHODS,
} from '@/lib/domain';

/**
 * The blackboard.
 *
 * Agents never call each other. Each reads this document, does its one job, writes back, and
 * the orchestrator advances. The `transcript` array is the agent-to-agent exchange itself, and
 * the `candidates` array preserves the losing options with their sub-scores so the UI can show
 * "chose A over B because ...".
 */

const candidateSchema = new Schema(
  {
    recipientId: { type: Schema.Types.ObjectId, ref: 'RecipientProfile', required: true },
    orgName: { type: String, required: true },
    rank: { type: Number, required: true },
    score: { type: Number, required: true },
    subScores: {
      proximity: { type: Number, required: true },
      categoryFit: { type: Number, required: true },
      capacityHeadroom: { type: Number, required: true },
      timingFit: { type: Number, required: true },
      penalty: { type: Number, required: true, default: 0 },
    },
    distanceKm: { type: Number, required: true },
    rejectedReason: { type: String, required: false },
  },
  { _id: false }
);

const transcriptTurnSchema = new Schema(
  {
    turn: { type: Number, required: true },
    from: { type: String, enum: ['DONOR_AGENT', 'PARTNER_AGENT'], required: true },
    intent: { type: String, enum: NEGOTIATION_INTENTS, required: true },
    /** Plain language, as actually exchanged. This is what the replay view renders. */
    message: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: false },
    at: { type: Date, required: true, default: () => new Date() },
  },
  { _id: false }
);

const pickupWindowSchema = new Schema(
  { start: { type: Date, required: true }, end: { type: Date, required: true } },
  { _id: false }
);

const matchSchema = new Schema(
  {
    runId: { type: Schema.Types.ObjectId, ref: 'AgentRun', required: true, index: true },
    itemIds: { type: [Schema.Types.ObjectId], ref: 'InventoryItem', required: true },
    donorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    recipientId: { type: Schema.Types.ObjectId, ref: 'RecipientProfile', required: false },

    state: { type: String, enum: MATCH_STATES, required: true, default: 'PREDICTED' },

    quantityKg: { type: Number, required: true, min: 0 },
    freshnessDeadlineAt: { type: Date, required: true },

    candidates: { type: [candidateSchema], required: true, default: [] },
    /** Why this recipient, in <= 45 words. Written by the Negotiation Agent. */
    justification: { type: String, required: false },
    escalations: { type: Number, required: true, default: 0 },

    transcript: { type: [transcriptTurnSchema], required: true, default: [] },

    pickup: {
      windows: { type: [pickupWindowSchema], required: false },
      chosen: { type: pickupWindowSchema, required: false },
      distanceKm: { type: Number, required: false },
      durationMin: { type: Number, required: false },
      /** Always surfaced in the UI: degrade loudly, never silently. */
      method: { type: String, enum: ROUTE_METHODS, required: false },
      multiStop: {
        stops: { type: [Schema.Types.Mixed], required: false },
        savedKm: { type: Number, required: false },
      },
    },

    outcome: { type: String, enum: MATCH_OUTCOMES, required: false },
    /** True when the counterparty was a SimulatedPartnerAgent rather than a real reply. */
    partnerWasSimulated: { type: Boolean, required: true, default: true },
  },
  { timestamps: true }
);

matchSchema.index({ donorId: 1, createdAt: -1 });
matchSchema.index({ recipientId: 1, state: 1 });

export type MatchDoc = InferSchemaType<typeof matchSchema>;

export const Match: Model<MatchDoc> =
  (mongoose.models.Match as Model<MatchDoc>) ?? mongoose.model<MatchDoc>('Match', matchSchema);
