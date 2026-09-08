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

export async function startTestDb(): Promise<void> {
  server = await MongoMemoryServer.create();

  process.env.MONGODB_URI = server.getUri();
  process.env.MONGODB_DB = 'reloop-test';
  process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long';
  process.env.DEMO_MODE = 'true';
  process.env.ALLOW_REAL_OUTREACH = 'false';
  process.env.ANTHROPIC_API_KEY = '';
  resetEnvCache();
}

export async function stopTestDb(): Promise<void> {
  await disconnectDb();
  await server?.stop();
  server = null;
}

export async function clearTestDb(): Promise<void> {
  const collections = await mongoose.connection.db?.collections();
  for (const collection of collections ?? []) {
    await collection.deleteMany({});
  }
}
