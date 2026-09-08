import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { parseObjectId } from '@/lib/api';
import { err, guarded, ok, toResponse, type Result } from '@/lib/result';
import { startNegotiationRun } from '@/lib/runs';
import { AgentRun } from '@/models/agent-run';

const createSchema = z.object({ itemId: z.string() });

/** Manual start, for the demo and for a user who wants to act before the threshold trips. */
export async function POST(request: Request): Promise<Response> {
  const result = await guarded('runs/create', async (): Promise<Result<unknown>> => {
    const session = await requireSession();
    if (!session.ok) return session;

    const body: unknown = await request.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return err('VALIDATION', 'Which item should the agents work on?');

    const itemId = parseObjectId(parsed.data.itemId);
    if (!itemId.ok) return itemId;

    await connectDb();

    const run = await startNegotiationRun({
      userId: session.data.objectId,
      itemId: itemId.data,
    });

    if (!run.started) {
      switch (run.reason) {
        case 'already-running':
          return err('CONFLICT', 'The agents are already working on that one.');
        case 'needs-confirmation':
          return err('CONFLICT', 'Confirm the reading first — the agents will not act on a guess.');
        case 'no-deadline':
          return err('VALIDATION', 'That item has no act-by time yet.');
        default:
          return err('NOT_FOUND', 'That item is no longer available.');
      }
    }

    return ok({ runId: String(run.runId), matchId: String(run.matchId) });
  });

  return toResponse(result, 201);
}

export async function GET(): Promise<Response> {
  const result = await guarded('runs/list', async (): Promise<Result<unknown>> => {
    const session = await requireSession();
    if (!session.ok) return session;

    await connectDb();

    const runs = await AgentRun.find({ userId: session.data.objectId, kind: 'NEGOTIATION' })
      .sort({ startedAt: -1 })
      .limit(30)
      .lean();

    return ok({
      runs: runs.map((run) => ({
        id: String(run._id),
        matchId: run.matchId ? String(run.matchId) : null,
        state: run.state,
        startedAt: run.startedAt.toISOString(),
        endedAt: run.endedAt?.toISOString() ?? null,
        totalCostUsd: run.totalCostUsd,
        lastError: run.lastError ?? null,
      })),
    });
  });

  return toResponse(result);
}
