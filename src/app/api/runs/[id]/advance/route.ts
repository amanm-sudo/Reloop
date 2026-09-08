import { requireSession } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { parseObjectId } from '@/lib/api';
import { err, guarded, ok, toResponse, type Result } from '@/lib/result';
import { advance } from '@/agents/orchestrator';
import { AgentRun } from '@/models/agent-run';

/**
 * Drive a run forward by exactly one step.
 *
 * The dashboard calls this in a loop while a run is live, which is what makes the exchange visible
 * turn by turn inside a demo rather than appearing all at once when a cron tick happens to fire.
 * The cron sweep hits the same `advance()`, so the two cannot diverge.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const result = await guarded('runs/advance', async (): Promise<Result<unknown>> => {
    const session = await requireSession();
    if (!session.ok) return session;

    const { id } = await context.params;
    const runId = parseObjectId(id);
    if (!runId.ok) return runId;

    await connectDb();

    // Ownership check before touching the state machine.
    const owned = await AgentRun.exists({ _id: runId.data, userId: session.data.objectId });
    if (!owned) return err('NOT_FOUND', 'That run is no longer available.');

    const outcome = await advance(runId.data);

    if (!outcome.advanced) {
      return ok({
        advanced: false,
        reason: outcome.reason,
        // 'locked' and 'error' are transient; the client keeps polling. 'terminal' means stop.
        keepPolling: outcome.reason === 'locked' || outcome.reason === 'error',
      });
    }

    return ok({
      advanced: true,
      from: outcome.from,
      to: outcome.to,
      done: outcome.done,
      nextActionAt: outcome.nextActionAt?.toISOString() ?? null,
      keepPolling: !outcome.done,
    });
  });

  return toResponse(result);
}
