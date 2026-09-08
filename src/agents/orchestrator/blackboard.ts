import type { Types } from 'mongoose';
import type { ItemCategory, StorageState } from '@/lib/domain';
import type { LngLat } from '@/lib/geo';
import type { OperatingHours } from '@/lib/hours';
import { InventoryItem } from '@/models/inventory-item';
import { Match } from '@/models/match';
import { RecipientProfile } from '@/models/recipient-profile';
import { User } from '@/models/user';

/**
 * Read helpers over the blackboard.
 *
 * Agents receive plain data through these, never Mongoose documents. That keeps agent code free of
 * database concerns, makes every agent trivially testable with a literal, and means an agent
 * physically cannot reach sideways into another agent's state.
 */

export type MatchView = {
  id: Types.ObjectId;
  runId: Types.ObjectId;
  donorId: Types.ObjectId;
  recipientId: Types.ObjectId | null;
  state: string;
  quantityKg: number;
  freshnessDeadlineAt: Date;
  escalations: number;
  itemIds: Types.ObjectId[];
  candidates: Array<{
    recipientId: Types.ObjectId;
    orgName: string;
    rank: number;
    score: number;
    distanceKm: number;
    rejectedReason?: string | null;
  }>;
  transcriptLength: number;
  pickupWindows: Array<{ start: Date; end: Date }>;
  partnerWasSimulated: boolean;
};

export type ItemView = {
  id: Types.ObjectId;
  name: string;
  category: ItemCategory;
  quantityKg: number;
  storage: StorageState;
  isCooked: boolean;
  actByAt: Date | null;
};

export type DonorView = {
  id: Types.ObjectId;
  displayName: string;
  coordinates: LngLat;
};

export type RecipientView = {
  id: Types.ObjectId;
  orgName: string;
  orgType: string;
  coordinates: LngLat;
  coverageRadiusKm: number;
  acceptedCategories: ItemCategory[];
  coldChainCapable: boolean;
  dailyCapacityKg: number;
  capacityUsedTodayKg: number;
  operatingHours: OperatingHours[];
  disposition: string | null;
  telegramChatId: string | null;
  isSimulated: boolean;
};

function asLngLat(coordinates: number[]): LngLat | null {
  const lng = coordinates[0];
  const lat = coordinates[1];
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;
  return [lng, lat];
}

export async function loadMatch(matchId: Types.ObjectId): Promise<MatchView | null> {
  const doc = await Match.findById(matchId).lean();
  if (!doc) return null;

  return {
    id: doc._id,
    runId: doc.runId,
    donorId: doc.donorId,
    recipientId: doc.recipientId ?? null,
    state: doc.state,
    quantityKg: doc.quantityKg,
    freshnessDeadlineAt: doc.freshnessDeadlineAt,
    escalations: doc.escalations,
    itemIds: [...doc.itemIds],
    candidates: doc.candidates.map((c) => ({
      recipientId: c.recipientId,
      orgName: c.orgName,
      rank: c.rank,
      score: c.score,
      distanceKm: c.distanceKm,
      rejectedReason: c.rejectedReason ?? null,
    })),
    transcriptLength: doc.transcript.length,
    pickupWindows: (doc.pickup?.windows ?? []).map((w) => ({ start: w.start, end: w.end })),
    partnerWasSimulated: doc.partnerWasSimulated,
  };
}

export async function loadItems(itemIds: readonly Types.ObjectId[]): Promise<ItemView[]> {
  const docs = await InventoryItem.find({ _id: { $in: itemIds } }).lean();
  return docs.map((doc) => ({
    id: doc._id,
    name: doc.name,
    category: doc.category as ItemCategory,
    quantityKg: doc.quantityKg,
    storage: doc.storage as StorageState,
    isCooked: doc.isCooked,
    actByAt: doc.actByAt ?? null,
  }));
}

export async function loadDonor(userId: Types.ObjectId): Promise<DonorView | null> {
  const doc = await User.findById(userId).lean();
  if (!doc?.location) return null;
  const coordinates = asLngLat(doc.location.coordinates);
  if (!coordinates) return null;
  return { id: doc._id, displayName: doc.displayName, coordinates };
}

function toRecipientView(doc: {
  _id: Types.ObjectId;
  orgName: string;
  orgType: string;
  location: { coordinates: number[] };
  coverageRadiusKm: number;
  acceptedCategories: string[];
  coldChainCapable: boolean;
  dailyCapacityKg: number;
  capacityUsedTodayKg: number;
  operatingHours: Array<{ day: number; open: string; close: string }>;
  disposition?: string | null;
  contact?: { telegramChatId?: string | null } | null;
  isSimulated: boolean;
}): RecipientView | null {
  const coordinates = asLngLat(doc.location.coordinates);
  if (!coordinates) return null;

  return {
    id: doc._id,
    orgName: doc.orgName,
    orgType: doc.orgType,
    coordinates,
    coverageRadiusKm: doc.coverageRadiusKm,
    acceptedCategories: doc.acceptedCategories as ItemCategory[],
    coldChainCapable: doc.coldChainCapable,
    dailyCapacityKg: doc.dailyCapacityKg,
    capacityUsedTodayKg: doc.capacityUsedTodayKg,
    operatingHours: doc.operatingHours.map((h) => ({ day: h.day, open: h.open, close: h.close })),
    disposition: doc.disposition ?? null,
    telegramChatId: doc.contact?.telegramChatId ?? null,
    isSimulated: doc.isSimulated,
  };
}

/** Recipients within reach of a donor, excluding compost sinks unless explicitly asked for. */
export async function loadNearbyRecipients(
  coordinates: LngLat,
  options: { maxKm?: number; onlyCompost?: boolean } = {}
): Promise<RecipientView[]> {
  const maxKm = options.maxKm ?? 15;
  const compostTypes = ['COMPOST', 'BIOGAS'];

  const docs = await RecipientProfile.find({
    isActive: true,
    orgType: options.onlyCompost ? { $in: compostTypes } : { $nin: compostTypes },
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [coordinates[0], coordinates[1]] },
        $maxDistance: maxKm * 1000,
      },
    },
  }).lean();

  return docs
    .map((doc) => toRecipientView(doc))
    .filter((view): view is RecipientView => view !== null);
}

export async function loadRecipient(id: Types.ObjectId): Promise<RecipientView | null> {
  const doc = await RecipientProfile.findById(id).lean();
  return doc ? toRecipientView(doc) : null;
}

/** Summary phrase used in offers and the feed, e.g. "spinach and 2 other items". */
export function summariseItems(items: readonly ItemView[]): string {
  const first = items[0];
  if (!first) return 'surplus food';
  if (items.length === 1) return first.name.toLowerCase();
  return `${first.name.toLowerCase()} and ${items.length - 1} other item${items.length > 2 ? 's' : ''}`;
}
