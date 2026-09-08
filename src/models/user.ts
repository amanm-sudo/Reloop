import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { USER_ROLES } from '@/lib/domain';

/**
 * GeoJSON point, stored [lng, lat] as MongoDB requires. Household coordinates are only ever
 * released in full to a matched recipient — see `src/lib/geo.ts` for the fuzzing serialiser.
 */
export const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (v: number[]) =>
          v.length === 2 &&
          typeof v[0] === 'number' &&
          typeof v[1] === 'number' &&
          v[0] >= -180 &&
          v[0] <= 180 &&
          v[1] >= -90 &&
          v[1] <= 90,
        message: 'coordinates must be [lng, lat] within valid ranges',
      },
    },
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: USER_ROLES, required: true, default: 'DONOR' },
    displayName: { type: String, required: true, trim: true },
    // Optional at signup; required before any surplus can be posted (FR-1.2), because every
    // downstream agent depends on coordinates.
    location: { type: pointSchema, required: false },
    address: { type: String, required: false, trim: true },
    telegramChatId: { type: String, required: false, index: true },
  },
  { timestamps: true }
);

userSchema.index({ location: '2dsphere' });

export type UserDoc = InferSchemaType<typeof userSchema>;

export const User: Model<UserDoc> =
  (mongoose.models.User as Model<UserDoc>) ?? mongoose.model<UserDoc>('User', userSchema);
