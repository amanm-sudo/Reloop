import mongoose from 'mongoose';
import { env } from '@/lib/env';

/**
 * Serverless-safe Mongoose connection. Route handlers and scripts call `connectDb()` freely;
 * the promise is cached on the module (and across hot reloads) so a warm lambda reuses the
 * existing socket instead of opening a new pool per invocation.
 */

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

const globalForMongoose = globalThis as typeof globalThis & {
  __reloopMongoose?: MongooseCache;
};

const cache: MongooseCache = (globalForMongoose.__reloopMongoose ??= {
  conn: null,
  promise: null,
});

export async function connectDb(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    const { MONGODB_URI, MONGODB_DB } = env();

    mongoose.set('strictQuery', true);

    cache.promise = mongoose
      .connect(MONGODB_URI, {
        dbName: MONGODB_DB,
        // Fail fast rather than hanging a request for 30s behind a bad network.
        serverSelectionTimeoutMS: 8000,
        maxPoolSize: 10,
      })
      .catch((cause: unknown) => {
        // Reset so the next request retries instead of awaiting a permanently rejected promise.
        cache.promise = null;
        throw cause;
      });
  }

  cache.conn = await cache.promise;
  return cache.conn;
}

/**
 * Waits for index builds to finish.
 *
 * Mongoose compiles models and then builds their indexes in the background, so on a database that
 * has never had them a `$near` query can arrive first and fail outright with
 * `unable to find index for $geoNear query`. Recipient ranking is entirely built on `$near`, so that
 * race takes out the whole pipeline on a fresh deployment — and it surfaces as an opaque 500.
 *
 * Called once by the seed and by the test harness. Deliberately not called per request: it is a
 * one-time setup concern, not a hot path.
 */
export async function ensureIndexes(): Promise<void> {
  await connectDb();

  // Imported lazily so this module stays free of model load-order concerns.
  const [{ User }, { RecipientProfile }, { InventoryItem }, { Match }, { AgentRun }, { AgentEvent }, { ImpactLog }] =
    await Promise.all([
      import('@/models/user'),
      import('@/models/recipient-profile'),
      import('@/models/inventory-item'),
      import('@/models/match'),
      import('@/models/agent-run'),
      import('@/models/agent-event'),
      import('@/models/impact-log'),
    ]);

  await Promise.all([
    User.init(),
    RecipientProfile.init(),
    InventoryItem.init(),
    Match.init(),
    AgentRun.init(),
    AgentEvent.init(),
    ImpactLog.init(),
  ]);
}

export async function disconnectDb(): Promise<void> {
  if (cache.conn) {
    await cache.conn.disconnect();
  }
  cache.conn = null;
  cache.promise = null;
}
