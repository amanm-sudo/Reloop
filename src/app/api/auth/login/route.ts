import { connectDb } from '@/lib/db';
import { createSessionCookie, credentialsSchema, verifyPassword } from '@/lib/auth';
import { err, guarded, ok, toResponse, type Result } from '@/lib/result';
import type { UserRole } from '@/lib/domain';
import { User } from '@/models/user';

export async function POST(request: Request): Promise<Response> {
  const result = await guarded('auth/login', async (): Promise<Result<{ userId: string }>> => {
    const body: unknown = await request.json().catch(() => null);
    const parsed = credentialsSchema.safeParse(body);
    if (!parsed.success) {
      return err('UNAUTHORIZED', 'Email or password is incorrect.');
    }

    const { email, password } = parsed.data;

    await connectDb();

    // passwordHash is `select: false`, so ask for it explicitly.
    const user = await User.findOne({ email }).select('+passwordHash').lean();
    if (!user) {
      return err('UNAUTHORIZED', 'Email or password is incorrect.');
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return err('UNAUTHORIZED', 'Email or password is incorrect.');
    }

    await createSessionCookie({
      userId: String(user._id),
      role: user.role as UserRole,
      email: user.email,
    });

    return ok({ userId: String(user._id) });
  });

  return toResponse(result);
}
