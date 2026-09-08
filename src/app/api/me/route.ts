import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { err, guarded, ok, toResponse, type Result } from '@/lib/result';
import { User } from '@/models/user';

/**
 * The account, and specifically its home location.
 *
 * Location is not a profile nicety here: distance, routing and recipient ranking all depend on it,
 * so nothing can be posted until it is set (FR-1.2).
 */

const patchSchema = z.object({
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  address: z.string().trim().max(200).optional(),
});

export async function GET(): Promise<Response> {
  const result = await guarded('me', async (): Promise<Result<unknown>> => {
    const session = await requireSession();
    if (!session.ok) return session;

    await connectDb();

    const user = await User.findById(session.data.objectId).lean();
    if (!user) return err('NOT_FOUND', 'Account not found.');

    const lng = user.location?.coordinates[0];
    const lat = user.location?.coordinates[1];

    return ok({
      id: String(user._id),
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      address: user.address ?? null,
      location:
        typeof lng === 'number' && typeof lat === 'number' ? { lng, lat } : null,
      hasLocation: typeof lng === 'number' && typeof lat === 'number',
    });
  });

  return toResponse(result);
}

export async function PATCH(request: Request): Promise<Response> {
  const result = await guarded('me/patch', async (): Promise<Result<unknown>> => {
    const session = await requireSession();
    if (!session.ok) return session;

    const body: unknown = await request.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return err('VALIDATION', 'Pick a point on the map to set your location.');

    await connectDb();

    await User.updateOne(
      { _id: session.data.objectId },
      {
        $set: {
          location: { type: 'Point', coordinates: [parsed.data.lng, parsed.data.lat] },
          ...(parsed.data.address ? { address: parsed.data.address } : {}),
        },
      }
    );

    return ok({ updated: true });
  });

  return toResponse(result);
}
