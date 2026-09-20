import { connectDb } from '@/lib/db';
import { env } from '@/lib/env';

/**
 * Deployment health, step by step.
 *
 * Exists because the generic "Something went wrong" that every other route returns is right for
 * users and useless for diagnosis — it deliberately reveals nothing, which means a broken deploy
 * looks identical whether the cause is a missing variable, a refused database login, or a blocked
 * IP. This endpoint names the failing stage.
 *
 * It reports the *shape* of the problem, never the secret: no connection string, no password, no
 * key. Values are reduced to "present/absent" and lengths, and any credentials that appear inside a
 * driver error message are scrubbed before the response is built.
 */

function scrub(message: string): string {
  return (
    message
      // mongodb+srv://user:password@host -> mongodb+srv://***:***@host
      .replace(/\/\/[^@\s/]+@/g, '//***:***@')
      // Any long opaque token that slipped through.
      .replace(/[A-Za-z0-9_-]{32,}/g, '***')
  );
}

export async function GET(): Promise<Response> {
  const steps: Array<{ step: string; ok: boolean; detail?: string }> = [];

  // --- 1. Environment ---
  let mongoScheme = 'unknown';
  try {
    const config = env();
    mongoScheme = config.MONGODB_URI.startsWith('mongodb+srv://')
      ? 'mongodb+srv'
      : config.MONGODB_URI.startsWith('mongodb://')
        ? 'mongodb'
        : 'MALFORMED — does not start with mongodb:// or mongodb+srv://';

    const uri = config.MONGODB_URI;

    steps.push({
      step: 'environment',
      ok: true,
      detail: [
        `scheme: ${mongoScheme}`,
        `uri length: ${uri.length}`,
        // The two classic paste mistakes, checked explicitly.
        `contains literal <db_password> placeholder: ${uri.includes('<') || uri.includes('>')}`,
        `has leading/trailing whitespace: ${uri !== uri.trim()}`,
        `database name: ${config.MONGODB_DB}`,
        `session secret length: ${config.SESSION_SECRET.length}`,
        `demo mode: ${config.DEMO_MODE}`,
        `gemini key present: ${config.GEMINI_API_KEY.length > 0}`,
        `telegram token present: ${config.TELEGRAM_BOT_TOKEN.length > 0}`,
      ].join(' | '),
    });
  } catch (cause) {
    steps.push({
      step: 'environment',
      ok: false,
      detail: scrub(cause instanceof Error ? cause.message : String(cause)),
    });
    return Response.json({ ok: false, steps }, { status: 503 });
  }

  // --- 2. Database ---
  const startedAt = Date.now();
  try {
    await connectDb();
    steps.push({ step: 'database', ok: true, detail: `connected in ${Date.now() - startedAt}ms` });
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : 'UnknownError';
    const message = scrub(cause instanceof Error ? cause.message : String(cause));
    const elapsed = Date.now() - startedAt;

    /*
     * The elapsed time is the useful discriminator: a refused login comes back almost immediately,
     * whereas an IP that Atlas is not allowing produces a server-selection timeout.
     */
    const likely =
      /bad auth|Authentication failed/i.test(message)
        ? 'Wrong username or password in MONGODB_URI, or that Atlas user lacks access to this database.'
        : /ENOTFOUND|querySrv|getaddrinfo/i.test(message)
          ? 'The cluster hostname could not be resolved — check for a typo in the host part of MONGODB_URI.'
          : /Invalid scheme|Invalid connection string|URI malformed/i.test(message)
            ? 'MONGODB_URI is malformed. Re-copy it from Atlas and re-substitute the password.'
            : elapsed > 5000
              ? 'Timed out selecting a server — this is the signature of an Atlas Network Access rule that does not allow this IP. Add 0.0.0.0/0.'
              : 'Connection refused quickly, which points at credentials rather than network access.';

    steps.push({
      step: 'database',
      ok: false,
      detail: `${name} after ${elapsed}ms: ${message} — LIKELY CAUSE: ${likely}`,
    });

    return Response.json({ ok: false, steps }, { status: 503 });
  }

  return Response.json({ ok: true, steps });
}
