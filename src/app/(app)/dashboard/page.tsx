import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Types } from 'mongoose';
import { getSession } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { listFeed } from '@/lib/agent-log';
import { InventoryItem } from '@/models/inventory-item';
import { AgentRun } from '@/models/agent-run';
import { User } from '@/models/user';
import { ActivityFeed } from '@/components/feed/activity-feed';
import { AddSurplus } from '@/components/dashboard/add-surplus';
import { Pantry, type PantryItemView } from '@/components/dashboard/pantry';
import { SetLocation } from '@/components/dashboard/set-location';

export const metadata = { title: 'Pantry · ReLoop' };
export const dynamic = 'force-dynamic';

/**
 * The home screen: what you have, what needs to move, and what the agents have done about it.
 *
 * Rendered on the server so first paint already shows real state; only the feed and the forms are
 * client components.
 */
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  await connectDb();

  const userId = new Types.ObjectId(session.userId);

  const [user, items, events, liveRuns] = await Promise.all([
    User.findById(userId).lean(),
    InventoryItem.find({ userId, state: { $in: ['ACTIVE', 'POSTED'] } })
      .sort({ urgencyScore: -1, actByAt: 1 })
      .limit(100)
      .lean(),
    listFeed(userId, { limit: 60 }),
    AgentRun.find({ userId, kind: 'NEGOTIATION', state: { $nin: ['IMPACT_LOGGED', 'FAILED'] } })
      .select('_id state')
      .lean(),
  ]);

  const hasLocation = Array.isArray(user?.location?.coordinates);

  const pantry: PantryItemView[] = items.map((item) => ({
    id: String(item._id),
    name: item.name,
    category: item.category,
    kind: item.kind,
    quantity: item.quantity,
    unit: item.unit,
    quantityKg: item.quantityKg,
    storage: item.storage,
    actByAt: item.actByAt?.toISOString() ?? null,
    urgencyScore: item.urgencyScore ?? null,
    lowConfidence: item.lowConfidence ?? false,
    needsConfirmation: item.extraction?.needsConfirmation ?? false,
    confidence: item.extraction?.confidence ?? null,
    state: item.state,
  }));

  const urgent = pantry.filter((item) => (item.urgencyScore ?? 0) >= 0.7).length;

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-5 py-6">
      <div>
        <h1 className="text-xl font-semibold">
          {urgent > 0
            ? `${urgent} item${urgent === 1 ? '' : 's'} need${urgent === 1 ? 's' : ''} to move`
            : 'Nothing urgent right now'}
        </h1>
        <p className="text-slate mt-1 text-sm">
          {liveRuns.length > 0
            ? `${liveRuns.length} run${liveRuns.length === 1 ? '' : 's'} in progress — watch the feed below.`
            : 'The agents are watching your expiry timeline and will act without being asked.'}
        </p>
      </div>

      {/* Every downstream agent needs coordinates, so this blocks rather than nags. */}
      {!hasLocation && <SetLocation />}

      <ActivityFeed initialEvents={events} />

      {liveRuns.length > 0 && (
        <ul className="space-y-1.5">
          {liveRuns.map((run) => (
            <li key={String(run._id)}>
              <Link
                href={`/runs/${String(run._id)}`}
                className="text-clay-ink text-sm underline"
              >
                Replay this negotiation turn by turn →
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="pantry-heading">
        <h2 id="pantry-heading" className="text-sm font-semibold">
          Expiry timeline
        </h2>
        <p className="text-slate mt-1 mb-3 text-xs">
          Ordered by how soon a recipient would need to act, not by expiry date — those differ by
          the lead time a partner needs, which is why surplus dies uncollected.
        </p>
        <Pantry items={pantry} nowIso={new Date().toISOString()} />
      </section>

      <AddSurplus />
    </main>
  );
}
