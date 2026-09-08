# Secrets and API Keys — ReLoop

Non-negotiable rules. A leaked key in a public hackathon repo is both a security incident
and a credibility hit with judges.

## Never

- Never write an API key, token, connection string, or webhook secret into source, config,
  test, fixture, seed, or documentation file. Not even a "temporary" one, not even commented out.
- Never paste a real key into a chat message, commit message, or README.
- Never commit `.env`, `.env.local`, `.env.production`, `*.pem`, or `service-account*.json`.
- Never log a secret. Redact before logging: log the variable **name**, never its value.
- Never send project secrets or user data to any third-party endpoint that is not an
  explicitly configured provider (Anthropic, MongoDB Atlas, OSRM, Telegram).

## Always

- Every secret is read through `src/lib/env.ts`, which parses `process.env` with Zod once at
  startup and fails fast with the missing variable's name if something is absent.
- Every new variable is added to `.env.example` on the same commit, with a placeholder value
  and a one-line comment on how to obtain it.
- Server-only secrets never get the `NEXT_PUBLIC_` prefix. Only genuinely public config
  (map style URL) may be `NEXT_PUBLIC_`.
- Secrets used by the browser: none. If a feature seems to need one, proxy it through a
  route handler instead.
- Production secrets live in Vercel project env vars, set through the dashboard or CLI.

## Current variables

| Variable | Scope | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | server | Atlas connection string |
| `ANTHROPIC_API_KEY` | server | All five agents + vision |
| `SESSION_SECRET` | server | JWT signing (min 32 bytes) |
| `TELEGRAM_BOT_TOKEN` | server | Bot API |
| `TELEGRAM_WEBHOOK_SECRET` | server | Verifies inbound webhook header |
| `OSRM_BASE_URL` | server | Routing endpoint |
| `DEMO_MODE` | server | Fixture-backed deterministic agent output |
| `ALLOW_REAL_OUTREACH` | server | Must stay `false` unless a real org has consented |
| `NEXT_PUBLIC_MAP_STYLE_URL` | client | Public map style, not a secret |

## Safety flags

`ALLOW_REAL_OUTREACH` defaults to `false` and must remain so. Flipping it lets the
Negotiation Agent contact a real external organisation. Do not flip it for testing, and do
not flip it for the demo. Real NGOs are not test fixtures.

## If a key is exposed

1. Revoke and rotate it at the provider immediately — before cleaning git history.
2. Then purge it from history, force-push, and note the rotation.
3. Assume any key that ever touched a public commit is compromised regardless of history rewriting.
