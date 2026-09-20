import { config } from 'dotenv';

/**
 * Loads `.env.local` for standalone scripts.
 *
 * Next.js reads `.env.local` itself for `dev`, `build` and `start`, but a script run through tsx
 * gets no such treatment — it sees only the ambient shell environment. Without this, `npm run seed`
 * fails with "MONGODB_URI: Required" even though the file is sitting right there correctly filled
 * in, which is a genuinely baffling error to hit during setup.
 *
 * Import this FIRST, before anything that might read configuration:
 *
 *   import '@/scripts/load-env';
 *
 * Loading order matters. dotenv does not overwrite variables that are already set, so a value
 * exported in the shell or injected by CI still wins over the file — which is what you want, and is
 * how the test harness and `npm run smoke` pass their own throwaway settings.
 */

// Two calls rather than an array path, so this works across dotenv versions.
// `quiet` suppresses dotenv's startup banner, which otherwise buries the seed script's own output.
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });
