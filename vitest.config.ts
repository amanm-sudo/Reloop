import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration tests spin up an in-memory MongoDB, which downloads a binary on first run.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // Each file gets its own in-memory server; running them in parallel is wasteful and flaky.
    fileParallelism: false,
    // Tests must never reach a real LLM, routing service, or Telegram.
    env: {
      DEMO_MODE: 'true',
      ALLOW_REAL_OUTREACH: 'false',
    },
  },
});
