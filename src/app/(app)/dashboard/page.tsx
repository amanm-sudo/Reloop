import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';

export const metadata = { title: 'Dashboard · ReLoop' };

/**
 * Placeholder. Checkpoint 3 (Day 8-9) builds this into the pantry state, the expiry timeline,
 * and the Agent Activity Feed. The feed's data source at /api/feed already exists.
 */
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <p className="text-clay-ink text-sm font-medium tracking-wide uppercase">ReLoop</p>
      <h1 className="mt-3 text-2xl font-semibold">Signed in as {session.email}</h1>
      <p className="text-slate mt-3 text-sm">
        The pantry, expiry timeline and Agent Activity Feed land here in checkpoint 3. The feed
        API and the agent event log are already in place.
      </p>
    </main>
  );
}
