import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { ITEM_CATEGORIES } from '@/lib/domain';

/**
 * One row per completed diversion.
 *
 * The factor values and their source are copied onto the record rather than looked up at read
 * time, so the methodology sheet always shows the numbers the maths actually used and cannot
 * drift if `data/impact-factors.json` is later revised.
 */

const impactLogSchema = new Schema(
  {
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    quantityKg: { type: Number, required: true, min: 0 },
    category: { type: String, enum: ITEM_CATEGORIES, required: true },

    /**
     * REDISTRIBUTED earns the full avoided-production credit; COMPOSTED earns only the
     * landfill-diversion credit. Never reported as equivalent.
     */
    outcome: { type: String, enum: ['REDISTRIBUTED', 'COMPOSTED'], required: true },

    co2eKg: { type: Number, required: false },
    waterL: { type: Number, required: false },
    landM2: { type: Number, required: false },
    /** True when no cited factor exists. The UI shows "not quantified", never an estimate. */
    notQuantified: { type: Boolean, required: true, default: false },
    notQuantifiedReason: { type: String, required: false },

    factorSource: {
      dataset: { type: String, required: true },
      year: { type: Number, required: false },
      url: { type: String, required: true },
      commodityGroup: { type: String, required: false },
      isProxy: { type: Boolean, required: false, default: false },
      proxyNote: { type: String, required: false },
      factorValues: {
        co2eKgPerKg: { type: Number, required: false },
        waterLPerKg: { type: Number, required: false },
        landM2PerKg: { type: Number, required: false },
      },
    },

    at: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false }
);

impactLogSchema.index({ userId: 1, at: -1 });
impactLogSchema.index({ at: -1 });

export type ImpactLogDoc = InferSchemaType<typeof impactLogSchema>;

export const ImpactLog: Model<ImpactLogDoc> =
  (mongoose.models.ImpactLog as Model<ImpactLogDoc>) ??
  mongoose.model<ImpactLogDoc>('ImpactLog', impactLogSchema);
