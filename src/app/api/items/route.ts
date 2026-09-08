import { Types } from 'mongoose';
import { z } from 'zod';
import { ITEM_CATEGORIES, STORAGE_STATES } from '@/lib/domain';
import { requireSession } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { err, guarded, ok, toResponse, type Result } from '@/lib/result';
import { toKg } from '@/lib/units';
import { ingestItem } from '@/lib/ingest';
import { InventoryItem } from '@/models/inventory-item';

/**
 * Pantry writes.
 *
 * Adding an item immediately runs the Prediction Agent and, if urgency has already crossed the
 * act-now threshold, starts a negotiation run without asking. That autonomy is the point of the
 * product, so it lives on the default path rather than behind a button.
 */

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.enum(ITEM_CATEGORIES),
  quantity: z.number().positive(),
  unit: z.string().min(1).max(12),
  estimatedMassG: z.number().min(0).optional(),
  storage: z.enum(STORAGE_STATES).default('FRIDGE'),
  isCooked: z.boolean().default(false),
  preparedAt: z.coerce.date().optional(),
  bestBeforeAt: z.coerce.date().optional(),
  userDeadlineAt: z.coerce.date().optional(),
});

export async function POST(request: Request): Promise<Response> {
  const result = await guarded('items/create', async (): Promise<Result<unknown>> => {
    const session = await requireSession();
    if (!session.ok) return session;

    const body: unknown = await request.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return err('VALIDATION', parsed.error.issues[0]?.message ?? 'Check the item details.');
    }

    const input = parsed.data;
    const mass = toKg(input.quantity, input.unit, input.estimatedMassG ?? null);
    if (!mass) {
      return err('VALIDATION', 'Give a weight, or a count with an estimated total weight.');
    }

    await connectDb();

    // Manual entry and Perception extraction share one ingest path, so they cannot drift.
    const ingested = await ingestItem({
      userId: session.data.objectId,
      runId: new Types.ObjectId(),
      name: input.name,
      category: input.category,
      quantity: input.quantity,
      unit: input.unit,
      quantityKg: mass.quantityKg,
      storage: input.storage,
      isCooked: input.isCooked,
      preparedAt: input.preparedAt,
      bestBeforeAt: input.bestBeforeAt,
      userDeadlineAt: input.userDeadlineAt,
      source: 'MANUAL',
    });

    return ok({
      itemId: String(ingested.itemId),
      actByAt: ingested.actByAt.toISOString(),
      urgencyScore: ingested.urgencyScore,
      shouldActNow: ingested.shouldActNow,
      runId: ingested.startedRunId ? String(ingested.startedRunId) : null,
    });
  });

  return toResponse(result, 201);
}

export async function GET(): Promise<Response> {
  const result = await guarded('items/list', async (): Promise<Result<unknown>> => {
    const session = await requireSession();
    if (!session.ok) return session;

    await connectDb();

    const items = await InventoryItem.find({
      userId: session.data.objectId,
      state: { $in: ['ACTIVE', 'POSTED'] },
    })
      .sort({ actByAt: 1 })
      .limit(200)
      .lean();

    return ok({
      items: items.map((item) => ({
        id: String(item._id),
        name: item.name,
        category: item.category,
        kind: item.kind,
        quantity: item.quantity,
        unit: item.unit,
        quantityKg: item.quantityKg,
        storage: item.storage,
        isCooked: item.isCooked,
        actByAt: item.actByAt?.toISOString() ?? null,
        urgencyScore: item.urgencyScore ?? null,
        lowConfidence: item.lowConfidence ?? false,
        needsConfirmation: item.extraction?.needsConfirmation ?? false,
        confidence: item.extraction?.confidence ?? null,
        state: item.state,
      })),
    });
  });

  return toResponse(result);
}
