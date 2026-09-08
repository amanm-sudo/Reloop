import { z } from 'zod';

/**
 * The single place `process.env` is read. Parsed once, fails fast, and reports the missing
 * variable by NAME only — never its value. See .kiro/steering/secrets.md.
 */

const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB: z.string().min(1).default('reloop'),

  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-sonnet-4-5'),
  ANTHROPIC_VISION_MODEL: z.string().min(1).default('claude-sonnet-4-5'),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(''),

  OSRM_BASE_URL: z.string().url().default('https://router.project-osrm.org'),

  DEMO_MODE: booleanish.default(true),
  ALLOW_REAL_OUTREACH: booleanish.default(false),

  CRON_SECRET: z.string().default(''),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

/**
 * Server-only environment access. Throws with the offending variable names on first call if
 * anything is missing or malformed.
 */
export function env(): ServerEnv {
  if (cached) return cached;

  const parsed = serverSchema.safeParse(process.env);

  if (!parsed.success) {
    const names = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(
      `Invalid environment configuration — ${names}. Copy .env.example to .env.local and fill it in.`
    );
  }

  // Safety interlock: real outreach may only ever be enabled deliberately, in production,
  // and never while demo fixtures are driving agent output.
  if (parsed.data.ALLOW_REAL_OUTREACH && parsed.data.DEMO_MODE) {
    throw new Error(
      'ALLOW_REAL_OUTREACH cannot be true while DEMO_MODE is true. Real organisations are not test fixtures.'
    );
  }

  cached = parsed.data;
  return cached;
}

/** Test seam: forget the parsed cache so a test can vary the environment. */
export function resetEnvCache(): void {
  cached = null;
}

/** Public, non-secret client config. Only genuinely public values belong here. */
export const publicConfig = {
  mapStyleUrl:
    process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/liberty',
} as const;
