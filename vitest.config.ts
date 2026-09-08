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
    // Tests must never reach a real LLM, routing service, or Telegram.
    env: {
      DEMO_MODE: 'true',
      ALLOW_REAL_OUTREACH: 'false',
    },
  },
});
