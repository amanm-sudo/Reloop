/**
 * Discriminated result used at every route-handler boundary. Handlers never throw to the
 * framework: they return one of these. See .kiro/steering/conventions.md.
 */

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UPSTREAM'
  | 'INTERNAL';

export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; error: { code: ErrorCode; message: string } };
export type Result<T> = Ok<T> | Err;

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

export function err(code: ErrorCode, message: string): Err {
  return { ok: false, error: { code, message } };
}

const STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UPSTREAM: 502,
  INTERNAL: 500,
};

export function statusFor(code: ErrorCode): number {
  return STATUS[code];
}

/** Serialise a Result into a Response. Error messages here are already user-safe. */
export function toResponse<T>(result: Result<T>, okStatus = 200): Response {
  const status = result.ok ? okStatus : statusFor(result.error.code);
  return Response.json(result, { status });
}

/**
 * Wrap a handler so an unexpected throw becomes a generic 500 without leaking internals.
 * Diagnostic detail goes to the log, never to the client.
 */
export async function guarded<T>(
  label: string,
  fn: () => Promise<Result<T>>
): Promise<Result<T>> {
  try {
    return await fn();
  } catch (cause) {
    console.error(`[${label}] unhandled error`, cause);
    return err('INTERNAL', 'Something went wrong. Please try again.');
  }
}
