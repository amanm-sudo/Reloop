/**
 * Checks a deployed ReLoop instance the way a judge would walk it.
 *
 *   node scripts/verify-live.mjs https://your-app.vercel.app
 *
 * Signs in as the seeded donor, loads every screen, and confirms the agent pipeline responds. Run it
 * after any deploy and immediately before recording, because a link that 500s in front of a judge
 * costs more than every feature it was hiding.
 */

const base = (process.argv[2] ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const results = [];

function record(label, ok, detail) {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -> ${detail}` : ''}`);
}

async function main() {
  // Health first: it names the failing stage instead of returning an opaque 500.
  try {
    const res = await fetch(`${base}/api/health`);
    const body = await res.json();
    record('health', res.status === 200 && body.ok === true, `${res.status}`);
    for (const step of body.steps ?? []) {
      record(`  health: ${step.step}`, step.ok, step.detail);
    }
    if (!body.ok) {
      report();
      process.exit(1);
    }
  } catch (error) {
    record('health', false, error.message);
    report();
    process.exit(1);
  }

  // Public pages.
  for (const path of ['/', '/login', '/register']) {
    const res = await fetch(`${base}${path}`);
    record(`GET ${path}`, res.status === 200, `${res.status}`);
  }

  // Unauthenticated APIs must refuse, not leak.
  for (const path of ['/api/feed', '/api/impact']) {
    const res = await fetch(`${base}${path}`, { redirect: 'manual' });
    record(`GET ${path} unauthenticated`, res.status === 401, `${res.status}`);
  }

  // Sign in as the seeded donor.
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'ananya@example.com', password: 'reloop-demo-password' }),
    redirect: 'manual',
  });
  const cookie = login.headers.getSetCookie().join('; ');
  record('sign in as seeded donor', login.status === 200, `${login.status}`);

  if (login.status !== 200) {
    record('  hint', false, 'run `npm run seed` against the same database this deploy points at');
    report();
    process.exit(1);
  }

  // Every screen a judge will open.
  for (const path of ['/dashboard', '/map', '/impact']) {
    const res = await fetch(`${base}${path}`, { headers: { cookie } });
    const body = await res.text();
    record(`GET ${path}`, res.status === 200 && body.length > 1000, `${res.status}, ${body.length} bytes`);
  }

  for (const path of ['/api/items', '/api/runs', '/api/feed']) {
    const res = await fetch(`${base}${path}`, { headers: { cookie } });
    record(`GET ${path}`, res.status === 200, `${res.status}`);
  }

  // Is there anything for the demo to show?
  const items = await (await fetch(`${base}/api/items`, { headers: { cookie } })).json();
  const count = items?.data?.items?.length ?? 0;
  const urgent = (items?.data?.items ?? []).filter((i) => (i.urgencyScore ?? 0) >= 0.7).length;
  record('pantry has seeded items', count > 0, `${count} items, ${urgent} urgent`);

  const runs = await (await fetch(`${base}/api/runs`, { headers: { cookie } })).json();
  const list = runs?.data?.runs ?? [];
  const live = list.filter((r) => !['IMPACT_LOGGED', 'FAILED'].includes(r.state));
  record('agent runs exist', list.length > 0, `${list.length} total, ${live.length} still live`);

  if (live.length === 0 && list.length > 0) {
    record(
      '  note',
      true,
      'all runs already finished — re-run `npm run seed` for a fresh demo so the feed animates live'
    );
  }

  report();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
}

function report() {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`ReLoop live check: ${base}`);
  console.log('='.repeat(72));
  for (const line of results) console.log(line);
  console.log('='.repeat(72));
}

await main();
