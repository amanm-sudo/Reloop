import { Types } from 'mongoose';
import { err, type Result } from '@/lib/result';

/** Small helpers shared by route handlers so each one stays about its own job. */

export function parseObjectId(value: string | undefined): Result<Types.ObjectId> {
  if (!value || !Types.ObjectId.isValid(value)) {
    return err('VALIDATION', 'That identifier is not valid.');
  }
  return { ok: true, data: new Types.ObjectId(value) };
}

/**
 * Fixed-window in-memory rate limit. Per-instance only, which is a real limitation on serverless
 * — it slows an abusive client down rather than stopping one outright. Enough for upload and
 * webhook endpoints in a hackathon build; a shared store would be the production answer.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): Result<null> {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, data: null };
  }

  if (bucket.count >= limit) {
    return err('RATE_LIMITED', 'Too many requests just now. Give it a moment.');
  }

  bucket.count += 1;
  return { ok: true, data: null };
}

export function clientKey(request: Request, suffix: string): string {
  const forwarded = request.headers.get('x-forwarded-for') ?? 'local';
  return `${forwarded.split(',')[0]?.trim() ?? 'local'}:${suffix}`;
}
