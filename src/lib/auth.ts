import { cookies } from 'next/headers';
import { Types } from 'mongoose';
import { hash, verify } from '@node-rs/argon2';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { env } from '@/lib/env';
import { err, ok, type Result } from '@/lib/result';
import type { UserRole } from '@/lib/domain';

/**
 * Deliberately minimal auth: email + password, Argon2id, one signed HTTP-only cookie.
 * No OAuth, no RBAC hierarchy, no email verification — the spec pins this down as out of
 * scope so the 14 days go to the agent core instead.
 */

const COOKIE_NAME = 'reloop_session';
const SESSION_DAYS = 30;

/**
 * OWASP's low-memory Argon2id baseline: 19 MiB, 2 iterations, 1 lane.
 *
 * The algorithm is not passed explicitly because @node-rs/argon2 exposes `Algorithm` as an
 * ambient const enum, which `isolatedModules` rejects. Its default is Argon2id, and
 * `tests/unit/auth.test.ts` asserts the produced hash carries the `$argon2id$` prefix — so this
 * is verified rather than assumed.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    return await verify(stored, plain, ARGON2_OPTIONS);
  } catch {
    // A malformed stored hash must read as "wrong password", never as a crash.
    return false;
  }
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env().SESSION_SECRET);
}

export type Session = {
  userId: string;
  role: UserRole;
  email: string;
};

const sessionClaimsSchema = z.object({
  sub: z.string().min(1),
  role: z.enum(['DONOR', 'RECIPIENT', 'ADMIN']),
  email: z.string().email(),
});

export async function createSessionCookie(session: Session): Promise<void> {
  const token = await new SignJWT({ role: session.role, email: session.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env().NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    const claims = sessionClaimsSchema.safeParse(payload);
    if (!claims.success) return null;
    return { userId: claims.data.sub, role: claims.data.role, email: claims.data.email };
  } catch {
    // Expired or tampered token reads as "not signed in".
    return null;
  }
}

/**
 * Route-handler guard. Returns a 401 Result rather than throwing, and never reveals whether a
 * referenced resource exists.
 */
export async function requireSession(): Promise<Result<Session & { objectId: Types.ObjectId }>> {
  const session = await getSession();
  if (!session) return err('UNAUTHORIZED', 'Sign in to continue.');
  if (!Types.ObjectId.isValid(session.userId)) {
    return err('UNAUTHORIZED', 'Sign in to continue.');
  }
  return ok({ ...session, objectId: new Types.ObjectId(session.userId) });
}

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(10, 'Use at least 10 characters.').max(200),
});

export const registrationSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(1, 'Tell us what to call you.').max(80),
  role: z.enum(['DONOR', 'RECIPIENT']).default('DONOR'),
});
