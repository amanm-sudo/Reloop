import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { ITEM_CATEGORIES, ITEM_KINDS, ITEM_STATES, STORAGE_STATES } from '@/lib/domain';

const inventoryItemSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ITEM_KINDS, required: true, default: 'FOOD' },
    category: { type: String, enum: ITEM_CATEGORIES, required: true },

    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true, default: 'g' },
    /** Normalised mass. All impact maths and capacity checks use this, never `quantity`. */
    quantityKg: { type: Number, required: true, min: 0 },

    storage: { type: String, enum: STORAGE_STATES, required: true, default: 'FRIDGE' },
    isCooked: { type: Boolean, required: true, default: false },
    preparedAt: { type: Date, required: false },
    bestBeforeAt: { type: Date, required: false },
    addedAt: { type: Date, required: true, default: () => new Date() },

    source: { type: String, enum: ['PERCEPTION', 'MANUAL'], required: true, default: 'MANUAL' },
    perceptionRunId: { type: Schema.Types.ObjectId, ref: 'AgentRun', required: false },

    /** Original extraction retained after a user correction, so the feed can show both. */
    extraction: {
      rawName: { type: String, required: false },
      rawQuantity: { type: Number, required: false },
      rawUnit: { type: String, required: false },
      confidence: { type: Number, required: false, min: 0, max: 1 },
      corrected: { type: Boolean, required: false, default: false },
      needsConfirmation: { type: Boolean, required: false, default: false },
    },

    // Written by the Prediction Agent.
    actByAt: { type: Date, required: false },
    urgencyScore: { type: Number, required: false, min: 0, max: 1 },
    lowConfidence: { type: Boolean, required: false, default: false },
    urgencyBasis: { type: String, required: false },

    /** Set by the user for MATERIAL items, which do not spoil and have no shelf life. */
    userDeadlineAt: { type: Date, required: false },

    state: { type: String, enum: ITEM_STATES, required: true, default: 'ACTIVE' },
  },
  { timestamps: true }
);

// Drives the expiry timeline and the urgency sweep.
inventoryItemSchema.index({ userId: 1, state: 1, actByAt: 1 });

export type InventoryItemDoc = InferSchemaType<typeof inventoryItemSchema>;

export const InventoryItem: Model<InventoryItemDoc> =
  (mongoose.models.InventoryItem as Model<InventoryItemDoc>) ??
  mongoose.model<InventoryItemDoc>('InventoryItem', inventoryItemSchema);
