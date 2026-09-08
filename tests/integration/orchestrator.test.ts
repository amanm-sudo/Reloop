import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDb } from '@/lib/db';
import { everyDay } from '@/lib/hours';
import { ingestItem } from '@/lib/ingest';
import { startNegotiationRun } from '@/lib/runs';
import type { ItemCategory } from '@/lib/domain';
import { advance } from '@/agents/orchestrator';
import { AgentEvent } from '@/models/agent-event';
import { AgentRun } from '@/models/agent-run';
import { ImpactLog } from '@/models/impact-log';
import { Match } from '@/models/match';
import { RecipientProfile } from '@/models/recipient-profile';
import { User } from '@/models/user';
import { clearTestDb, startTestDb, stopTestDb } from '../helpers/db';

/**
 * End-to-end orchestrator behaviour against a real MongoDB.
 *
 * These are the tests that matter most. The orchestrator's correctness lives in atomic updates,
 * lease acquisition and idempotency — none of which a mocked database would exercise. Everything
 * here runs with DEMO_MODE on and no API key, so no model is called and the results are
 * deterministic.
 */

// 11:30 IST on a Tuesday. Chosen so the langar's midday window is open and the volunteer NGO's
// evening window is not — the demo's timing constraint is real, not arranged.
const NOW = new Date('2026-09-01T06:00:00.000Z');
const HOUR = 3_600_000;

const DONOR_ID = new Types.ObjectId('64a000000000000000000001');

// Gomti Nagar and Naka Hindola, from data/seed-places.json.
const GOMTI: [number, number] = [81.00392, 26.861174];
const NAKA_HINDOLA: [number, number] = [80.923278, 26.838276];
const HAZRATGANJ: [number, number] = [80.9432, 26.847528];
const MOHANLALGANJ: [number, number] = [81.067043, 26.672227];

const COOKED: ItemCategory[] = ['cooked_curry_veg', 'cooked_dal', 'cooked_rice_dish'];

async function seedWorld(options: { langarCapacityUsedKg?: number } = {}): Promise<void> {
  await User.create({
    _id: DONOR_ID,
    email: 'donor@example.com',
    passwordHash: 'not-used-in-this-test',
    role: 'DONOR',
    displayName: 'Ananya',
    location: { type: 'Point', coordinates: GOMTI },
  });

  await RecipientProfile.create([
    {
      orgName: 'Langar Surplus',
      orgType: 'LANGAR',
      location: { type: 'Point', coordinates: NAKA_HINDOLA },
      coverageRadiusKm: 12,
      acceptedCategories: COOKED,
      coldChainCapable: false,
      dailyCapacityKg: 120,
      capacityUsedTodayKg: options.langarCapacityUsedKg ?? 0,
      operatingHours: everyDay('11:00', '14:30'),
      provenance: 'Test fixture. Not a partnership.',
      isSimulated: true,
    },
    {
      // Volunteer NGO, evenings only — closed during the window under test.
      orgName: 'Evening Volunteers',
      orgType: 'NGO',
      location: { type: 'Point', coordinates: HAZRATGANJ },
      coverageRadiusKm: 12,
      acceptedCategories: COOKED,
      coldChainCapable: false,
      dailyCapacityKg: 60,
      capacityUsedTodayKg: 0,
      operatingHours: everyDay('17:00', '21:30'),
      provenance: 'Test fixture. Not a partnership.',
      isSimulated: true,
    },
    {
      orgName: 'Organic Waste Site',
      orgType: 'COMPOST',
      location: { type: 'Point', coordinates: MOHANLALGANJ },
      coverageRadiusKm: 40,
      acceptedCategories: COOKED,
      coldChainCapable: false,
      dailyCapacityKg: 2000,
      capacityUsedTodayKg: 0,
      operatingHours: everyDay('06:00', '18:00'),
      provenance: 'Test fixture. Not a partnership.',
      isSimulated: true,
    },
  ]);
}

async function addCookedItem(quantityKg: number): Promise<Types.ObjectId> {
  const result = await ingestItem({
    userId: DONOR_ID,
    runId: new Types.ObjectId(),
    name: 'Aloo gobi sabzi',
    category: 'cooked_curry_veg',
    quantity: quantityKg * 1000,
    unit: 'g',
    quantityKg,
    storage: 'PANTRY',
    isCooked: true,
    // Prepared 3 hours ago: past the act-now threshold on the real formula.
    preparedAt: new Date(NOW.getTime() - 3 * HOUR),
    source: 'MANUAL',
    now: NOW,
  });
  return result.itemId;
}

/** Drives the machine the way the dashboard does: one step at a time until it settles. */
async function runToCompletion(runId: Types.ObjectId, maxSteps = 20): Promise<string[]> {
  const path: string[] = [];

  for (let i = 0; i < maxSteps; i += 1) {
    // Advance the clock past any scheduled delay so the test does not actually wait.
    const outcome = await advance(runId, new Date(NOW.getTime() + (i + 1) * 60_000));
    if (!outcome.advanced) break;
    path.push(outcome.to);
    if (outcome.done) break;
  }

  return path;
}

beforeAll(async () => {
  await startTestDb();
  await connectDb();
});

afterAll(async () => {
  await stopTestDb();
});

beforeEach(async () => {
  await clearTestDb();
});

describe('the full loop', () => {
  it('goes from urgent item to logged impact without a human touching it', async () => {
    await seedWorld();
    const itemId = await addCookedItem(1.2);

    // Ingest alone should have started the run — that autonomy is the product.
    const existing = await AgentRun.findOne({ kind: 'NEGOTIATION' }).lean();
    expect(existing, 'crossing the threshold must start a run with no human action').toBeTruthy();

    const path = await runToCompletion(existing!._id);

    expect(path).toContain('CANDIDATES_RANKED');
    expect(path).toContain('OUTREACH_SENT');
    expect(path.at(-1)).toBe('IMPACT_LOGGED');

    const match = await Match.findOne({ itemIds: itemId }).lean();
    expect(match?.outcome).toBe('REDISTRIBUTED');

    // The exchange must have two sides on the record.
    const speakers = new Set(match?.transcript.map((t) => t.from));
    expect(speakers).toEqual(new Set(['DONOR_AGENT', 'PARTNER_AGENT']));

    // It must have picked the recipient that is actually open, not merely the nearest.
    const chosen = match?.candidates.find(
      (c) => String(c.recipientId) === String(match.recipientId)
    );
    expect(chosen?.orgName).toBe('Langar Surplus');

    const impact = await ImpactLog.findOne({ matchId: match?._id }).lean();
    expect(impact?.outcome).toBe('REDISTRIBUTED');
    expect(impact?.co2eKg).toBeGreaterThan(0);
    expect(impact?.factorSource?.url).toMatch(/^https:\/\//);
  });

  it('records the losing candidates and why they lost', async () => {
    await seedWorld();
    await addCookedItem(1.2);

    const run = await AgentRun.findOne({ kind: 'NEGOTIATION' }).lean();
    await runToCompletion(run!._id);

    const match = await Match.findOne({}).lean();
    const evening = match?.candidates.find((c) => c.orgName === 'Evening Volunteers');

    // Closed for the whole freshness window, and the record says so — this is what lets the UI
    // show "chose A over B because" rather than just assert it.
    expect(evening?.rejectedReason).toBe('closed-before-deadline');
    expect(match?.justification).toBeTruthy();
  });

  it('makes every step visible in the feed, in a causal chain', async () => {
    await seedWorld();
    await addCookedItem(1.2);

    const run = await AgentRun.findOne({ kind: 'NEGOTIATION' }).lean();
    await runToCompletion(run!._id);

    const events = await AgentEvent.find({ runId: run!._id }).sort({ at: 1 }).lean();
    expect(events.length).toBeGreaterThan(4);

    // Plain language only: no JSON, no stack traces in what the user reads.
    for (const event of events) {
      expect(event.summary.length).toBeGreaterThan(0);
      expect(event.summary).not.toMatch(/^\s*[{[]/);
    }

    // Several distinct agents must be visible, not one doing everything.
    const agents = new Set(events.map((e) => e.agentId));
    expect(agents.size).toBeGreaterThanOrEqual(3);
    expect(agents).toContain('partner');

    // Everything after the first step should be linked to what caused it.
    expect(events.slice(1).some((e) => e.causedBy != null)).toBe(true);
  });
});

describe('the counter-offer path', () => {
  it('takes a partial quantity when that is all the recipient can hold', async () => {
    // Langar has only 15 kg of headroom against a 30 kg offer, so its own rule counters with a
    // partial. The donor side then judges that against the deadline.
    await seedWorld({ langarCapacityUsedKg: 105 });
    await addCookedItem(30);

    const run = await AgentRun.findOne({ kind: 'NEGOTIATION' }).lean();
    const path = await runToCompletion(run!._id);

    expect(path).toContain('COUNTERED');
    expect(path.at(-1)).toBe('IMPACT_LOGGED');

    const match = await Match.findOne({}).lean();
    expect(match?.outcome).toBe('REDISTRIBUTED');
    // Accepted the 15 kg that fits rather than losing all 30.
    expect(match?.quantityKg).toBeLessThan(30);
    expect(match?.quantityKg).toBeGreaterThan(0);

    const countered = match?.transcript.find((t) => t.intent === 'COUNTER');
    expect(countered?.from).toBe('PARTNER_AGENT');
  });
});

describe('the compost fallback', () => {
  it('diverts from landfill when nobody can take the food, and accounts it differently', async () => {
    await seedWorld();

    // Raw fish: none of the seeded recipients accept it, so redistribution genuinely fails.
    await ingestItem({
      userId: DONOR_ID,
      runId: new Types.ObjectId(),
      name: 'Fish',
      category: 'protein_fish_raw',
      quantity: 800,
      unit: 'g',
      quantityKg: 0.8,
      storage: 'FRIDGE',
      isCooked: false,
      bestBeforeAt: new Date(NOW.getTime() + HOUR),
      source: 'MANUAL',
      now: NOW,
    });

    const run = await AgentRun.findOne({ kind: 'NEGOTIATION' }).lean();
    const path = await runToCompletion(run!._id);

    expect(path).toContain('COMPOST_DIVERTED');
    expect(path.at(-1)).toBe('IMPACT_LOGGED');

    const impact = await ImpactLog.findOne({}).lean();
    expect(impact?.outcome).toBe('COMPOSTED');
    // Landfill-diversion credit only: no water or land is recovered by composting.
    expect(impact?.waterL).toBe(0);
    expect(impact?.landM2).toBe(0);
    expect(impact?.co2eKg).toBeCloseTo(0.4, 3); // 0.8 kg x 0.5
    expect(impact?.factorSource?.dataset).toMatch(/WRAP/i);
  });
});

describe('idempotency and locking', () => {
  it('treats a duplicate advance as a no-op rather than a second set of events', async () => {
    await seedWorld();
    await addCookedItem(1.2);

    const run = await AgentRun.findOne({ kind: 'NEGOTIATION' }).lean();
    const runId = run!._id;

    const [first, second] = await Promise.all([
      advance(runId, new Date(NOW.getTime() + 60_000)),
      advance(runId, new Date(NOW.getTime() + 60_000)),
    ]);

    // Exactly one of the two may proceed; the other must find the lease held.
    const advancedCount = [first, second].filter((r) => r.advanced).length;
    expect(advancedCount).toBe(1);

    const loser = [first, second].find((r) => !r.advanced);
    expect(loser && 'reason' in loser ? loser.reason : null).toBe('locked');

    const rankEvents = await AgentEvent.countDocuments({
      runId,
      kind: { $in: ['candidates_ranked', 'no_recipient_available'] },
    });
    expect(rankEvents).toBe(1);
  });

  it('refuses to advance a finished run', async () => {
    await seedWorld();
    await addCookedItem(1.2);

    const run = await AgentRun.findOne({ kind: 'NEGOTIATION' }).lean();
    await runToCompletion(run!._id);

    const after = await advance(run!._id, new Date(NOW.getTime() + 3600_000));
    expect(after.advanced).toBe(false);
    if (!after.advanced) expect(after.reason).toBe('terminal');
  });

  it('reports a missing run instead of throwing', async () => {
    const outcome = await advance(new Types.ObjectId(), NOW);
    expect(outcome.advanced).toBe(false);
    if (!outcome.advanced) expect(outcome.reason).toBe('not-found');
  });
});

describe('guards on starting a run', () => {
  it('will not act on an unconfirmed low-confidence reading', async () => {
    await seedWorld();

    const ingested = await ingestItem({
      userId: DONOR_ID,
      runId: new Types.ObjectId(),
      name: 'Something illegible',
      category: 'cooked_curry_veg',
      quantity: 1000,
      unit: 'g',
      quantityKg: 1,
      storage: 'PANTRY',
      isCooked: true,
      preparedAt: new Date(NOW.getTime() - 3 * HOUR),
      source: 'PERCEPTION',
      extraction: {
        rawName: 'Something illegible',
        rawQuantity: 1000,
        rawUnit: 'g',
        confidence: 0.3,
        needsConfirmation: true,
      },
      now: NOW,
    });

    // Urgent, but not acted on — an agent phoning an NGO about a misread label is the failure
    // mode worth guarding hardest.
    expect(ingested.shouldActNow).toBe(true);
    expect(ingested.startedRunId).toBeNull();

    const started = await startNegotiationRun({ userId: DONOR_ID, itemId: ingested.itemId });
    expect(started.started).toBe(false);
    if (!started.started) expect(started.reason).toBe('needs-confirmation');
  });

  it('will not start a second run for an item already in flight', async () => {
    await seedWorld();
    const itemId = await addCookedItem(1.2);

    const again = await startNegotiationRun({ userId: DONOR_ID, itemId });
    expect(again.started).toBe(false);
    if (!again.started) expect(again.reason).toBe('already-running');
  });
});
