import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { publicConfig } from '@/lib/env';
import { releaseCoordinates } from '@/lib/geo';
import { Match } from '@/models/match';
import { RecipientProfile } from '@/models/recipient-profile';
import { User } from '@/models/user';
import { CommunityMap, type MapPinView } from '@/components/map/community-map';

export const metadata = { title: 'Map · ReLoop' };
export const dynamic = 'force-dynamic';

const COMPOST_TYPES = ['COMPOST', 'BIOGAS'];

/**
 * Where the surplus and the partners are.
 *
 * Pin data is assembled here, on the server, because that is where the location-release decision
 * belongs: a household's exact coordinates reach the browser only when the viewer is the recipient
 * of an already-agreed handoff. Everyone else gets a point fuzzed to about 200 m.
 */
export default async function MapPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  await connectDb();

  const [profiles, matches] = await Promise.all([
    RecipientProfile.find({ isActive: true }).limit(200).lean(),
    Match.find({
      state: { $nin: ['FAILED'] },
      updatedAt: { $gte: new Date(Date.now() - 48 * 3600_000) },
    })
      .limit(200)
      .lean(),
  ]);

  const donorIds = [...new Set(matches.map((m) => String(m.donorId)))];
  const donors = await User.find({ _id: { $in: donorIds } })
    .select('location')
    .lean();
  const donorById = new Map(donors.map((d) => [String(d._id), d]));

  const pins: MapPinView[] = [];

  for (const profile of profiles) {
    const [lng, lat] = profile.location.coordinates;
    if (typeof lng !== 'number' || typeof lat !== 'number') continue;

    const headroom = Math.max(0, profile.dailyCapacityKg - profile.capacityUsedTodayKg);

    pins.push({
      id: String(profile._id),
      kind: COMPOST_TYPES.includes(profile.orgType) ? 'COMPOST' : 'PARTNER',
      label: profile.orgName,
      coordinates: [lng, lat],
      // Organisations are public-facing; their locations are not private data.
      exact: true,
      detail: `${profile.orgType.replace(/_/g, ' ').toLowerCase()} · ${headroom.toFixed(0)} kg of ${profile.dailyCapacityKg} kg left today`,
      provenance: profile.provenance,
    });
  }

  for (const match of matches) {
    const donor = donorById.get(String(match.donorId));
    const lng = donor?.location?.coordinates[0];
    const lat = donor?.location?.coordinates[1];
    if (typeof lng !== 'number' || typeof lat !== 'number') continue;

    const viewerIsMatchedRecipient =
      match.recipientId != null &&
      ['AGREED', 'SCHEDULED', 'COMPLETED'].includes(match.state) &&
      String(match.recipientId) === session.userId;

    const released = releaseCoordinates({
      coordinates: [lng, lat],
      seed: String(match._id),
      viewerIsMatchedRecipient,
    });

    const kind: MapPinView['kind'] =
      ['COMPLETED', 'IMPACT_LOGGED'].includes(match.state)
        ? 'COMPLETED_TODAY'
        : ['AGREED', 'SCHEDULED'].includes(match.state)
          ? 'IN_PROGRESS'
          : 'SURPLUS';

    pins.push({
      id: String(match._id),
      kind,
      label: `${match.quantityKg.toFixed(1)} kg surplus`,
      coordinates: [released.coordinates[0], released.coordinates[1]],
      exact: released.exact,
      detail: released.exact
        ? `${match.state.replace(/_/g, ' ').toLowerCase()} · exact address released to you`
        : `${match.state.replace(/_/g, ' ').toLowerCase()} · approximate to ~200 m`,
    });
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-5 py-6">
      <div>
        <h1 className="text-xl font-semibold">Around Lucknow</h1>
        <p className="text-slate mt-1 text-sm">
          Household pins are deliberately approximate. An exact address is released only to the
          partner a handoff has actually been agreed with.
        </p>
      </div>

      <CommunityMap pins={pins} styleUrl={publicConfig.mapStyleUrl} />

      <section aria-labelledby="partners-heading">
        <h2 id="partners-heading" className="text-sm font-semibold">
          Partner organisations
        </h2>
        <ul className="mt-2 space-y-2">
          {pins
            .filter((pin) => pin.kind === 'PARTNER' || pin.kind === 'COMPOST')
            .map((pin) => (
              <li key={pin.id} className="border-line rounded-card border p-3">
                <p className="text-sm font-medium">{pin.label}</p>
                <p className="text-slate mt-0.5 text-xs">{pin.detail}</p>
                {pin.provenance && (
                  <p className="text-slate mt-1 text-[11px] italic">{pin.provenance}</p>
                )}
              </li>
            ))}
        </ul>
      </section>
    </main>
  );
}
