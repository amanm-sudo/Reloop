import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Types } from 'mongoose';
import { getSession } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { listFeed } from '@/lib/agent-log';
import { describeMethod } from '@/lib/routing';
import { formatIst } from '@/lib/hours';
import { formatMass } from '@/lib/units';
import type { RouteMethod } from '@/lib/domain';
import { AgentRun } from '@/models/agent-run';
import { Match } from '@/models/match';
import { ActivityFeed } from '@/components/feed/activity-feed';
import {
  NegotiationReplay,
  type CandidateView,
  type TranscriptTurn,
} from '@/components/runs/negotiation-replay';

export const metadata = { title: 'Negotiation replay · ReLoop' };
export const dynamic = 'force-dynamic';

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) notFound();

  await connectDb();

  const runId = new Types.ObjectId(id);
  const run = await AgentRun.findOne({
    _id: runId,
    userId: new Types.ObjectId(session.userId),
  }).lean();

  if (!run) notFound();

  const match = run.matchId ? await Match.findById(run.matchId).lean() : null;
  const events = await listFeed(new Types.ObjectId(session.userId), { runId, limit: 200 });

  const transcript: TranscriptTurn[] =
    match?.transcript.map((turn) => ({
      turn: turn.turn,
      from: turn.from as TranscriptTurn['from'],
      intent: turn.intent,
      message: turn.message,
      at: turn.at.toISOString(),
    })) ?? [];

  const candidates: CandidateView[] =
    match?.candidates.map((candidate) => {
      const sub = candidate.subScores;
      return {
        orgName: candidate.orgName,
        rank: candidate.rank,
        score: candidate.score,
        subScores: {
          proximity: sub?.proximity ?? 0,
          categoryFit: sub?.categoryFit ?? 0,
          capacityHeadroom: sub?.capacityHeadroom ?? 0,
          timingFit: sub?.timingFit ?? 0,
          penalty: sub?.penalty ?? 0,
        },
        distanceKm: candidate.distanceKm,
        rejectedReason: candidate.rejectedReason ?? null,
        chosen: match.recipientId
          ? String(candidate.recipientId) === String(match.recipientId)
          : false,
      };
    }) ?? [];

  const pickup = match?.pickup;

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-5 py-6">
      <div>
        <Link href="/dashboard" className="text-slate hover:text-ink text-sm">
          ← Back to pantry
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Negotiation replay</h1>
        <p className="text-slate mt-1 text-sm">
          {match ? formatMass(match.quantityKg) : '—'} ·{' '}
          {run.state.replace(/_/g, ' ').toLowerCase()}
          {match?.escalations
            ? ` · moved on ${match.escalations} time${match.escalations === 1 ? '' : 's'}`
            : ''}
          {run.totalCostUsd > 0 && ` · $${run.totalCostUsd.toFixed(4)} of model spend`}
        </p>
        {match && (
          <p className="text-slate mt-1 text-xs">
            Counterparty:{' '}
            {match.partnerWasSimulated
              ? 'simulated partner agent (its own context, capacity and hours)'
              : 'a real recipient answering on Telegram'}
          </p>
        )}
      </div>

      <NegotiationReplay
        transcript={transcript}
        candidates={candidates}
        justification={match?.justification ?? null}
      />

      {pickup?.distanceKm != null && (
        <section aria-labelledby="pickup-heading">
          <h2 id="pickup-heading" className="text-sm font-semibold">
            Pickup
          </h2>
          <p className="mt-2 text-sm">
            {pickup.chosen
              ? `Agreed for ${formatIst(pickup.chosen.start)}.`
              : `${pickup.windows?.length ?? 0} window${(pickup.windows?.length ?? 0) === 1 ? '' : 's'} offered.`}{' '}
            {pickup.distanceKm.toFixed(1)} km
            {pickup.durationMin != null && `, about ${pickup.durationMin} min`}
            {pickup.method && ` (${describeMethod(pickup.method as RouteMethod)})`}.
          </p>
          {pickup.multiStop?.savedKm != null && (
            <p className="text-slate mt-1 text-sm">
              Combined with a nearby pickup, saving {pickup.multiStop.savedKm} km against separate
              trips.
            </p>
          )}
        </section>
      )}

      <ActivityFeed initialEvents={events} runId={id} />
    </main>
  );
}
