import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { parseObjectId } from '@/lib/api';
import { err, guarded, ok, toResponse, type Result } from '@/lib/result';
import { InventoryItem } from '@/models/inventory-item';
import { STORAGE_STATES } from '@/lib/domain';
import { toKg } from '@/lib/units';

/**
 * Correcting an extracted item.
 *
 * Confirming a low-confidence reading is a first-class action, not an apology for the model: the
 * original extraction is kept alongside the correction so the activity feed can show both, and
 * confirmation is what unblocks autonomous matching for that item.
 */

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().min(1).max(12).optional(),
  estimatedMassG: z.number().min(0).optional(),
  storage: z.enum(STORAGE_STATES).optional(),
  confirm: z.boolean().optional(),
  consumed: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const result = await guarded('items/patch', async (): Promise<Result<unknown>> => {
    const session = await requireSession();
    if (!session.ok) return session;

    const { id } = await context.params;
    const itemId = parseObjectId(id);
    if (!itemId.ok) return itemId;

    const body: unknown = await request.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return err('VALIDATION', 'Check the fields and try again.');

    await connectDb();

    const item = await InventoryItem.findOne({
      _id: itemId.data,
      userId: session.data.objectId,
    });
    // Same response whether it is missing or someone else's — no existence leak.
    if (!item) return err('NOT_FOUND', 'That item is no longer available.');

    const patch = parsed.data;

    if (patch.consumed) {
      item.state = 'CONSUMED';
      await item.save();
      return ok({ id: String(item._id), state: item.state });
    }

    const changedQuantity = patch.quantity != null || patch.unit != null;

    if (changedQuantity) {
      const quantity = patch.quantity ?? item.quantity;
      const unit = patch.unit ?? item.unit;
      const mass = toKg(quantity, unit, patch.estimatedMassG ?? null);
      if (!mass) return err('VALIDATION', 'That quantity and unit do not give a usable weight.');
      item.quantity = quantity;
      item.unit = unit;
      item.quantityKg = mass.quantityKg;
    }

    if (patch.name) item.name = patch.name;
    if (patch.storage) item.storage = patch.storage;

    if (item.extraction && (changedQuantity || patch.name || patch.confirm)) {
      // The original reading stays on the record; only the flags move.
      item.extraction.corrected = changedQuantity || Boolean(patch.name);
      if (patch.confirm || changedQuantity) item.extraction.needsConfirmation = false;
    }

    await item.save();

    return ok({
      id: String(item._id),
      name: item.name,
      quantityKg: item.quantityKg,
      needsConfirmation: item.extraction?.needsConfirmation ?? false,
    });
  });

  return toResponse(result);
}
