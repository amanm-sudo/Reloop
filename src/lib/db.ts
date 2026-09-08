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

export async function disconnectDb(): Promise<void> {
  if (cache.conn) {
    await cache.conn.disconnect();
  }
  cache.conn = null;
  cache.promise = null;
}
