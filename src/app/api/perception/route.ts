import { Types } from 'mongoose';
import { requireSession } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/api';
import { connectDb } from '@/lib/db';
import { recordEvent } from '@/lib/agent-log';
import { err, guarded, ok, toResponse, type Result } from '@/lib/result';
import { ingestItem } from '@/lib/ingest';
import { AgentRun } from '@/models/agent-run';
import { perceptionAgent } from '@/agents/perception';
import { isFixtureKey } from '@/agents/perception/fixtures';
import { makeContext } from '@/agents/registry';

/**
 * Photo or receipt in, pantry out.
 *
 * Accepts multipart form data with an `image`, or a `fixtureKey` for the demo path that needs no
 * camera. The Perception run gets its own AgentRun so every extraction and the urgency estimates
 * that follow from it share one causal chain in the feed.
 */

const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

type AllowedType = (typeof ALLOWED_TYPES)[number];

function isAllowedType(value: string): value is AllowedType {
  return (ALLOWED_TYPES as readonly string[]).includes(value);
}

export async function POST(request: Request): Promise<Response> {
  const result = await guarded('perception', async (): Promise<Result<unknown>> => {
    const session = await requireSession();
    if (!session.ok) return session;

    const limited = rateLimit(clientKey(request, 'perception'), 12, 60_000);
    if (!limited.ok) return limited;

    const form = await request.formData().catch(() => null);
    if (!form) return err('VALIDATION', 'Send the photo as form data.');

    const note = form.get('note');
    const fixtureKeyRaw = form.get('fixtureKey');
    const file = form.get('image');

    let image: { bytes: Buffer; mediaType: AllowedType } | undefined;

    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_UPLOAD_BYTES) {
        return err('VALIDATION', 'That image is larger than 6 MB. Try a smaller one.');
      }
      if (!isAllowedType(file.type)) {
        return err('VALIDATION', 'Use a JPEG, PNG or WebP image.');
      }
      image = { bytes: Buffer.from(await file.arrayBuffer()), mediaType: file.type };
    }

    const fixtureKey =
      typeof fixtureKeyRaw === 'string' && isFixtureKey(fixtureKeyRaw) ? fixtureKeyRaw : undefined;

    if (!image && !fixtureKey) {
      return err('VALIDATION', 'Attach a photo or pick one of the demo images.');
    }

    await connectDb();

    const now = new Date();
    const runId = new Types.ObjectId();

    await AgentRun.create({
      _id: runId,
      kind: 'PERCEPTION',
      userId: session.data.objectId,
      // A perception run is a single call, so it is complete the moment it finishes. It exists as
      // a run purely to group the extraction and its follow-on urgency events.
      state: 'PERCEIVED',
      nextActionAt: now,
      startedAt: now,
      endedAt: now,
      attempts: 1,
      totalCostUsd: 0,
    });

    const extraction = await perceptionAgent.run(
      { image, fixtureKey, note: typeof note === 'string' ? note : null },
      makeContext({ agentId: 'perception', runId, userId: session.data.objectId })
    );

    const rootEvent = await recordEvent({
      runId,
      userId: session.data.objectId,
      agentId: 'perception',
      kind: extraction.output.items.length > 0 ? 'items_extracted' : 'extraction_empty',
      summary: extraction.rationale,
      detail: {
        isReceipt: extraction.output.isReceipt,
        note: extraction.output.note,
        unusable: extraction.output.unusable,
        items: extraction.output.items.map((i) => ({
          name: i.name,
          category: i.category,
          quantity: i.quantity,
          unit: i.unit,
          quantityKg: i.quantityKg,
          massBasis: i.massBasis,
          confidence: i.confidence,
          needsConfirmation: i.needsConfirmation,
        })),
      },
      latencyMs: extraction.meta.latencyMs,
      costUsd: extraction.meta.costUsd,
      fixture: extraction.meta.fixture,
      fallback: extraction.fallback,
    });

    await AgentRun.updateOne(
      { _id: runId },
      { $set: { totalCostUsd: extraction.meta.costUsd } }
    );

    const ingested = [];
    for (const item of extraction.output.items) {
      ingested.push(
        await ingestItem({
          userId: session.data.objectId,
          runId,
          name: item.name,
          category: item.category,
          quantity: item.quantity,
          unit: item.unit,
          quantityKg: item.quantityKg,
          storage: item.storage,
          isCooked: item.isCooked,
          source: 'PERCEPTION',
          extraction: {
            rawName: item.name,
            rawQuantity: item.quantity,
            rawUnit: item.unit,
            confidence: item.confidence,
            needsConfirmation: item.needsConfirmation,
          },
          causedBy: rootEvent.id,
          now,
        })
      );
    }

    return ok({
      runId: String(runId),
      fixture: extraction.meta.fixture,
      fallback: extraction.fallback ?? null,
      isReceipt: extraction.output.isReceipt,
      itemCount: ingested.length,
      needsConfirmation: ingested.filter((i) => i.needsConfirmation).length,
      startedRuns: ingested
        .map((i) => (i.startedRunId ? String(i.startedRunId) : null))
        .filter((id): id is string => id !== null),
    });
  });

  return toResponse(result, 201);
}
