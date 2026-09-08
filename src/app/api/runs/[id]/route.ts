import { requireSession } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { parseObjectId } from '@/lib/api';
import { err, guarded, ok, toResponse, type Result } from '@/lib/result';
import { listFeed } from '@/lib/agent-log';
import { AgentRun } from '@/models/agent-run';
import { Match } from '@/models/match';

/**
 * Everything the replay view needs: the ranked candidates with their sub-scores, the
 * turn-by-turn transcript, the pickup decision, and the events in causal order.
 *
 * The losing candidates are included on purpose. "Chose A over B because B was at capacity" is a
 * claim the UI should be able to show rather than assert.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const result = await guarded('runs/get', async (): Promise<Result<unknown>> => {
    const session = await requireSession();
    if (!session.ok) return session;

    const { id } = await context.params;
    const runId = parseObjectId(id);
    if (!runId.ok) return runId;

    await connectDb();

    const run = await AgentRun.findOne({ _id: runId.data, userId: session.data.objectId }).lean();
    if (!run) return err('NOT_FOUND', 'That run is no longer available.');

    const match = run.matchId ? await Match.findById(run.matchId).lean() : null;
    const events = await listFeed(session.data.objectId, { runId: runId.data, limit: 200 });

    return ok({
      run: {
        id: String(run._id),
        kind: run.kind,
        state: run.state,
        startedAt: run.startedAt.toISOString(),
        endedAt: run.endedAt?.toISOString() ?? null,
        totalCostUsd: run.totalCostUsd,
      },
      match: match
        ? {
            id: String(match._id),
            state: match.state,
            quantityKg: match.quantityKg,
            freshnessDeadlineAt: match.freshnessDeadlineAt.toISOString(),
            justification: match.justification ?? null,
            escalations: match.escalations,
            outcome: match.outcome ?? null,
            partnerWasSimulated: match.partnerWasSimulated,
            recipientId: match.recipientId ? String(match.recipientId) : null,
            candidates: match.candidates.map((c) => {
              const sub = c.subScores;
              return {
                orgName: c.orgName,
                rank: c.rank,
                score: c.score,
                subScores: {
                  proximity: sub?.proximity ?? 0,
                  categoryFit: sub?.categoryFit ?? 0,
                  capacityHeadroom: sub?.capacityHeadroom ?? 0,
                  timingFit: sub?.timingFit ?? 0,
                  penalty: sub?.penalty ?? 0,
                },
                distanceKm: c.distanceKm,
                rejectedReason: c.rejectedReason ?? null,
                chosen: match.recipientId
                  ? String(c.recipientId) === String(match.recipientId)
                  : false,
              };
            }),
            transcript: match.transcript.map((t) => ({
              turn: t.turn,
              from: t.from,
              intent: t.intent,
              message: t.message,
              at: t.at.toISOString(),
            })),
            pickup: match.pickup
              ? {
                  chosen: match.pickup.chosen
                    ? {
                        start: match.pickup.chosen.start.toISOString(),
                        end: match.pickup.chosen.end.toISOString(),
                      }
                    : null,
                  windows: (match.pickup.windows ?? []).map((w) => ({
                    start: w.start.toISOString(),
                    end: w.end.toISOString(),
                  })),
                  distanceKm: match.pickup.distanceKm ?? null,
                  durationMin: match.pickup.durationMin ?? null,
                  method: match.pickup.method ?? null,
                  multiStop: match.pickup.multiStop?.savedKm
                    ? { savedKm: match.pickup.multiStop.savedKm }
                    : null,
                }
              : null,
          }
        : null,
      // Oldest first: a replay reads forwards.
      events: [...events].reverse(),
    });
  });

  return toResponse(result);
}
