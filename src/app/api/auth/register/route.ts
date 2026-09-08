import { connectDb } from '@/lib/db';
import { createSessionCookie, hashPassword, registrationSchema } from '@/lib/auth';
import { err, guarded, ok, toResponse, type Result } from '@/lib/result';
import { User } from '@/models/user';

export async function POST(request: Request): Promise<Response> {
  const result = await guarded('auth/register', async (): Promise<Result<{ userId: string }>> => {
    const body: unknown = await request.json().catch(() => null);
    const parsed = registrationSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return err('VALIDATION', first?.message ?? 'Check the details and try again.');
    }

    const { email, password, displayName, role } = parsed.data;

    await connectDb();

    const existing = await User.exists({ email });
    if (existing) {
      // Deliberately explicit here: on a signup form, "already registered" is the useful
      // answer and the address is one the visitor already typed.
      return err('CONFLICT', 'An account with that email already exists.');
    }

    const user = await User.create({
      email,
      passwordHash: await hashPassword(password),
      displayName,
      role,
    });

    await createSessionCookie({ userId: String(user._id), role, email });

    return ok({ userId: String(user._id) });
  });

  return toResponse(result, 201);
}
