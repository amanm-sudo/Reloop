import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { ITEM_CATEGORIES, ORG_TYPES } from '@/lib/domain';
import { pointSchema } from '@/models/user';

const operatingHoursSchema = new Schema(
  {
    day: { type: Number, required: true, min: 0, max: 6 },
    open: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
    close: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
  },
  { _id: false }
);

const recipientProfileSchema = new Schema(
  {
    // Null for seeded reference organisations that have no ReLoop login.
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: false, index: true },

    orgName: { type: String, required: true, trim: true },
    orgType: { type: String, enum: ORG_TYPES, required: true },

    location: { type: pointSchema, required: true },
    coverageRadiusKm: { type: Number, required: true, min: 0.1 },

    acceptedCategories: { type: [String], enum: ITEM_CATEGORIES, required: true, default: [] },
    coldChainCapable: { type: Boolean, required: true, default: false },

    dailyCapacityKg: { type: Number, required: true, min: 0 },
    capacityUsedTodayKg: { type: Number, required: true, min: 0, default: 0 },
    capacityResetAt: { type: Date, required: false },

    operatingHours: { type: [operatingHoursSchema], required: true, default: [] },

    contact: {
      telegramChatId: { type: String, required: false },
      phone: { type: String, required: false },
      email: { type: String, required: false, lowercase: true },
    },

    /**
     * Seeds the SimulatedPartnerAgent's persona. Behavioural disposition only — never facts
     * about a real organisation's commitments.
     */
    disposition: { type: String, required: false },

    /**
     * Rendered in the UI verbatim. Must state that the profile is modelled on how a real
     * organisation operates and is not an active partnership (requirements §2).
     */
    provenance: { type: String, required: true },

    isSimulated: { type: Boolean, required: true, default: true },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true }
);

recipientProfileSchema.index({ location: '2dsphere' });
recipientProfileSchema.index({ isActive: 1, orgType: 1 });

export type RecipientProfileDoc = InferSchemaType<typeof recipientProfileSchema>;

export const RecipientProfile: Model<RecipientProfileDoc> =
  (mongoose.models.RecipientProfile as Model<RecipientProfileDoc>) ??
  mongoose.model<RecipientProfileDoc>('RecipientProfile', recipientProfileSchema);
