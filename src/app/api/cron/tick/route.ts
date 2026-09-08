import { env } from '@/lib/env';
import { connectDb } from '@/lib/db';
import { err, guarded, ok, toResponse, type Result } from '@/lib/result';
import { advance, dueRuns } from '@/agents/orchestrator';

/**
 * The sweep. Vercel Cron hits this every minute.
 *
 * It exists so a run cannot stall just because nobody has the dashboard open — a pickup agreed at
 * 6 PM still needs its impact logged whether or not the donor is watching. Each due run gets one
 * step; the next tick takes the next step.
 */

const MAX_RUNS_PER_TICK = 10;

export async function GET(request: Request): Promise<Response> {
  const result = await guarded('cron/tick', async (): Promise<Result<unknown>> => {
    const secret = env().CRON_SECRET;

    // Vercel Cron sends the Authorization header. Without a configured secret the endpoint stays
    // closed rather than defaulting to open.
    if (secret.length === 0) {
      return err('FORBIDDEN', 'Cron is not configured.');
    }
    if (request.headers.get('authorization') !== `Bearer ${secret}`) {
      return err('UNAUTHORIZED', 'Not permitted.');
    }

    await connectDb();

    const now = new Date();
    const runIds = await dueRuns(now, MAX_RUNS_PER_TICK);

    const advanced: Array<{ runId: string; from?: string; to?: string; reason?: string }> = [];

    for (const runId of runIds) {
      const outcome = await advance(runId, new Date());
      advanced.push(
        outcome.advanced
          ? { runId: String(runId), from: outcome.from, to: outcome.to }
          : { runId: String(runId), reason: outcome.reason }
      );
    }

    return ok({ due: runIds.length, advanced });
  });

  return toResponse(result);
}
