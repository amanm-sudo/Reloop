import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { disconnectDb } from '@/lib/db';
import { resetEnvCache } from '@/lib/env';

/**
 * In-memory MongoDB for integration tests.
 *
 * The orchestrator's correctness is largely about atomic updates, leases and idempotency — none of
 * which can be tested against a mock. A real server is the only way these tests mean anything.
 */

let server: MongoMemoryServer | null = null;

/**
 * Refuses to let a destructive test touch anything but a local throwaway database.
 *
 * This is not theoretical. The seed test imports `@/scripts/seed`, which imports `load-env`, which
 * reads the developer's real `.env.local` at module-evaluation time — before any `beforeAll` runs.
 * `runSeed()` begins by deleting every collection it owns. The current import order happens to be
 * safe, but "happens to be" is not a property worth betting a production database on, so the
 * destructive paths assert their target instead of assuming it.
 */
export function assertLocalDatabase(): void {
  const uri = process.env.MONGODB_URI ?? '';
  const isLocal = /(?:127\.0\.0\.1|localhost|::1)/.test(uri);

  if (!isLocal) {
    // Redact any credentials before this reaches a log.
    const safe = uri.replace(/\/\/[^@/]+@/, '//***@');
    throw new Error(
      `Refusing to run destructive test setup against a non-local database (${safe || 'unset'}). ` +
        'Tests must only ever target the in-memory server started by startTestDb().'
    );
  }
}

export async function startTestDb(): Promise<void> {
  server = await MongoMemoryServer.create();

  process.env.MONGODB_URI = server.getUri();
  process.env.MONGODB_DB = 'reloop-test';
  process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long';
  process.env.DEMO_MODE = 'true';
  process.env.ALLOW_REAL_OUTREACH = 'false';
  // Empty key plus DEMO_MODE means no test can reach a real model, by construction.
  process.env.GEMINI_API_KEY = '';
  resetEnvCache();

  assertLocalDatabase();
}

export async function stopTestDb(): Promise<void> {
  await disconnectDb();
  await server?.stop();
  server = null;
}

export async function clearTestDb(): Promise<void> {
  assertLocalDatabase();

  const collections = await mongoose.connection.db?.collections();
  for (const collection of collections ?? []) {
    await collection.deleteMany({});
  }
}
