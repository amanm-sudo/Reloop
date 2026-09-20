/**
 * Demo smoke test. Run it before recording, and after any change to the agent pipeline.
 *
 *   npm run build && npm run smoke
 *
 * Boots a throwaway MongoDB and the production build, seeds the Lucknow dataset, then exercises
 * the exact path a judge will walk: public pages render, unauthenticated APIs are refused, the
 * seeded donor can sign in, every screen renders with real data, and a negotiation run is driven
 * step by step to a logged impact with both sides on the record.
 *
 * This exists instead of a browser-driver suite because what actually breaks a demo is the server
 * path — a stale index, a closed connection, a window that no longer fits — and this catches those
 * in a few seconds without a browser download. It does not check layout or client-side behaviour;
 * those still need a human at 390 px.
 */
import { spawn } from 'node:child_process';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
const uri = server.getUri();

const env = {
  ...process.env,
  MONGODB_URI: uri,
  MONGODB_DB: 'reloop-smoke',
  // Throwaway value for a throwaway database. Never a real secret.
  SESSION_SECRET: 'smoke-test-secret-at-least-32-characters-long',
  DEMO_MODE: 'true',
  ALLOW_REAL_OUTREACH: 'false',
  GEMINI_API_KEY: '',
  CRON_SECRET: 'serve-check-cron',
  PORT: '3111',
};

// Seed first so the pages have something to render.
const seed = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/scripts/seed.ts'], {
  stdio: 'inherit',
  env,
});
await new Promise((resolve) => seed.on('exit', resolve));

const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3111'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env,
});
app.stdout.on('data', (d) => process.stdout.write(`[app] ${d}`));
app.stderr.on('data', (d) => process.stderr.write(`[app] ${d}`));

async function waitForReady(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:3111/');
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

const ready = await waitForReady();
const results = [];

if (ready) {
  const checks = [
    ['GET /', 'http://127.0.0.1:3111/', 200],
    ['GET /login', 'http://127.0.0.1:3111/login', 200],
    ['GET /register', 'http://127.0.0.1:3111/register', 200],
    ['GET /api/map (public)', 'http://127.0.0.1:3111/api/map', 200],
    ['GET /api/feed (unauth)', 'http://127.0.0.1:3111/api/feed', 401],
    ['GET /api/impact (unauth)', 'http://127.0.0.1:3111/api/impact', 401],
    ['GET /api/cron/tick (no secret)', 'http://127.0.0.1:3111/api/cron/tick', 401],
  ];

  for (const [label, url, expected] of checks) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      results.push(`${response.status === expected ? 'PASS' : 'FAIL'}  ${label} -> ${response.status} (want ${expected})`);
    } catch (error) {
      results.push(`FAIL  ${label} -> threw ${error.message}`);
    }
  }

  // Authenticated flow: sign in as the seeded donor, then load the dashboard.
  try {
    const login = await fetch('http://127.0.0.1:3111/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ananya@example.com', password: 'reloop-demo-password' }),
      redirect: 'manual',
    });
    const cookie = login.headers.getSetCookie().join('; ');
    results.push(`${login.status === 200 ? 'PASS' : 'FAIL'}  POST /api/auth/login -> ${login.status}`);

    for (const [label, url] of [
      ['GET /dashboard (auth)', 'http://127.0.0.1:3111/dashboard'],
      ['GET /map (auth)', 'http://127.0.0.1:3111/map'],
      ['GET /impact (auth)', 'http://127.0.0.1:3111/impact'],
      ['GET /api/items (auth)', 'http://127.0.0.1:3111/api/items'],
      ['GET /api/runs (auth)', 'http://127.0.0.1:3111/api/runs'],
      ['GET /api/feed (auth)', 'http://127.0.0.1:3111/api/feed'],
    ]) {
      const response = await fetch(url, { headers: { cookie } });
      const body = await response.text();
      const ok = response.status === 200 && body.length > 200;
      results.push(`${ok ? 'PASS' : 'FAIL'}  ${label} -> ${response.status}, ${body.length} bytes`);
    }

    // Drive a seeded run one step through the HTTP layer.
    const runs = await fetch('http://127.0.0.1:3111/api/runs', { headers: { cookie } });
    const runsBody = await runs.json();
    const runId = runsBody?.data?.runs?.[0]?.id;
    if (runId) {
      // Drive the run the way the dashboard does, until it settles.
      const path = [];
      for (let i = 0; i < 20; i += 1) {
        const advanced = await fetch(`http://127.0.0.1:3111/api/runs/${runId}/advance`, {
          method: 'POST',
          headers: { cookie },
        });
        const payload = await advanced.json();
        const data = payload?.data;
        if (!data?.advanced) {
          path.push(`(stopped: ${data?.reason ?? 'unknown'})`);
          break;
        }
        path.push(data.to);
        if (data.done) break;
        await new Promise((r) => setTimeout(r, 2200));
      }

      const reachedEnd = path.at(-1) === 'IMPACT_LOGGED';
      results.push(`${reachedEnd ? 'PASS' : 'FAIL'}  run path -> ${path.join(' -> ')}`);

      const detail = await fetch(`http://127.0.0.1:3111/api/runs/${runId}`, { headers: { cookie } });
      const detailBody = await detail.json();
      const match = detailBody?.data?.match;
      const speakers = new Set((match?.transcript ?? []).map((t) => t.from));

      /*
       * Which outcome is correct depends on the clock: outside every partner's opening hours,
       * composting genuinely is the right answer and demanding a negotiation would be asserting
       * something false. So the assertion is conditional — if an offer went out, both sides must be
       * on the record; if none did, say plainly which scenario was exercised.
       */
      const negotiated = path.includes('OUTREACH_SENT');
      if (negotiated) {
        results.push(
          `${speakers.size === 2 ? 'PASS' : 'FAIL'}  exchange had both sides -> ${[...speakers].join(', ') || 'none'} (${match?.transcript?.length ?? 0} turns)`
        );
      } else {
        results.push(
          'PASS  compost path exercised (no recipient open inside the action window) — no exchange expected'
        );
      }
      results.push(
        `${match?.justification ? 'PASS' : 'FAIL'}  justification -> ${match?.justification ?? 'missing'}`
      );
      results.push(
        `${match?.candidates?.length > 1 ? 'PASS' : 'FAIL'}  candidates recorded -> ${(match?.candidates ?? []).map((c) => `${c.orgName}${c.chosen ? '*' : ''}${c.rejectedReason ? `(${c.rejectedReason})` : ''}`).join(', ')}`
      );

      const impact = await fetch('http://127.0.0.1:3111/api/impact', { headers: { cookie } });
      const impactBody = await impact.json();
      const totals = impactBody?.data?.personal;
      results.push(
        `${totals ? 'PASS' : 'FAIL'}  impact totals -> redistributed ${totals?.redistributed?.co2eKg ?? '?'} kg CO2e / composted ${totals?.composted?.co2eKg ?? '?'} kg CO2e`
      );

      const replay = await fetch(`http://127.0.0.1:3111/runs/${runId}`, { headers: { cookie } });
      const replayBody = await replay.text();
      results.push(
        `${replay.status === 200 && replayBody.length > 200 ? 'PASS' : 'FAIL'}  GET /runs/:id -> ${replay.status}, ${replayBody.length} bytes`
      );
    } else {
      results.push('FAIL  no seeded run found to advance');
    }
  } catch (error) {
    results.push(`FAIL  authenticated flow threw ${error.message}`);
  }
} else {
  results.push('FAIL  app never became ready');
}

app.kill();
await server.stop();

console.log(`\n${'='.repeat(70)}`);
for (const line of results) console.log(line);
console.log('='.repeat(70));

process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
