import { getSession } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { guarded, ok, toResponse, type Result } from '@/lib/result';
import { releaseCoordinates, type LngLat } from '@/lib/geo';
import { Match } from '@/models/match';
import { RecipientProfile } from '@/models/recipient-profile';

/**
 * Pins for the community map.
 *
 * Household coordinates are fuzzed by ~200 m for everyone except the recipient a handoff has
 * actually been agreed with. That release decision is made here, in the serialiser, rather than in
 * the map component — a new view can forget to fuzz, but it cannot forget to call this.
 */

export type MapPin = {
  id: string;
  kind: 'SURPLUS' | 'PARTNER' | 'IN_PROGRESS' | 'COMPLETED_TODAY' | 'COMPOST';
  label: string;
  coordinates: LngLat;
  exact: boolean;
  detail: string;
  provenance?: string | null;
  urgency?: number | null;
};

const COMPOST_TYPES = ['COMPOST', 'BIOGAS'];

export async function GET(): Promise<Response> {
  const result = await guarded('map', async (): Promise<Result<{ pins: MapPin[] }>> => {
    await connectDb();

    const session = await getSession();
    const pins: MapPin[] = [];

    const profiles = await RecipientProfile.find({ isActive: true }).limit(200).lean();

    for (const profile of profiles) {
      const lng = profile.location.coordinates[0];
      const lat = profile.location.coordinates[1];
      if (typeof lng !== 'number' || typeof lat !== 'number') continue;

      const headroom = Math.max(0, profile.dailyCapacityKg - profile.capacityUsedTodayKg);

      pins.push({
        id: String(profile._id),
        kind: COMPOST_TYPES.includes(profile.orgType) ? 'COMPOST' : 'PARTNER',
        label: profile.orgName,
        coordinates: [lng, lat],
        // Organisations are public-facing; their addresses are not private data.
        exact: true,
        detail: `${profile.orgType.replace(/_/g, ' ').toLowerCase()} · ${headroom.toFixed(0)} kg of ${profile.dailyCapacityKg} kg left today`,
        provenance: profile.provenance,
      });
    }

    // Active and just-completed matches, with the donor end shown as a surplus pin.
    const since = new Date(Date.now() - 24 * 3600_000);
    const matches = await Match.find({
      state: { $nin: ['FAILED'] },
      updatedAt: { $gte: since },
    })
      .populate<{ donorId: { _id: unknown; location?: { coordinates: number[] }; displayName: string } }>(
        'donorId',
        'location displayName'
      )
      .limit(200)
      .lean();

    for (const match of matches) {
      const donor = match.donorId as unknown as {
        _id: unknown;
        location?: { coordinates: number[] };
      } | null;
      const lng = donor?.location?.coordinates[0];
      const lat = donor?.location?.coordinates[1];
      if (typeof lng !== 'number' || typeof lat !== 'number') continue;

      const viewerIsMatchedRecipient =
        session != null &&
        match.recipientId != null &&
        // A recipient sees the exact address only once the handoff is agreed.
        ['AGREED', 'SCHEDULED', 'COMPLETED'].includes(match.state) &&
        String(match.recipientId) === session.userId;

      const released = releaseCoordinates({
        coordinates: [lng, lat],
        seed: String(match._id),
        viewerIsMatchedRecipient,
      });

      const kind: MapPin['kind'] =
        match.state === 'IMPACT_LOGGED' || match.state === 'COMPLETED'
          ? 'COMPLETED_TODAY'
          : ['AGREED', 'SCHEDULED'].includes(match.state)
            ? 'IN_PROGRESS'
            : 'SURPLUS';

      pins.push({
        id: String(match._id),
        kind,
        label: `${match.quantityKg.toFixed(1)} kg surplus`,
        coordinates: released.coordinates,
        exact: released.exact,
        detail: released.exact
          ? `${match.state.replace(/_/g, ' ').toLowerCase()} · exact address released to you`
          : `${match.state.replace(/_/g, ' ').toLowerCase()} · location approximate to ~200 m`,
      });
    }

    return ok({ pins });
  });

  return toResponse(result);
}
