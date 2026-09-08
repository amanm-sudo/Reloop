import { Types } from 'mongoose';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { listFeed, type FeedEvent } from '@/lib/agent-log';
import { err, guarded, ok, toResponse, type Result } from '@/lib/result';

/**
 * The Agent Activity Feed's data source. Polled by the client while a run is in flight, which
 * is what satisfies the "every agent action visible within 3 seconds" requirement without
 * introducing WebSocket infrastructure.
 *
 * `since` lets the client ask only for what is new, so a 1s poll stays cheap.
 */

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  since: z.coerce.date().optional(),
  runId: z
    .string()
    .refine((v) => Types.ObjectId.isValid(v), 'runId must be a valid id')
    .optional(),
});

export async function GET(request: Request): Promise<Response> {
  const result = await guarded('feed', async (): Promise<Result<{ events: FeedEvent[] }>> => {
    const session = await requireSession();
    if (!session.ok) return session;

    const url = new URL(request.url);
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return err('VALIDATION', 'Check the query parameters and try again.');
    }

    await connectDb();

    const events = await listFeed(session.data.objectId, {
      limit: parsed.data.limit,
      since: parsed.data.since,
      runId: parsed.data.runId ? new Types.ObjectId(parsed.data.runId) : undefined,
    });

    return ok({ events });
  });

  return toResponse(result);
}
