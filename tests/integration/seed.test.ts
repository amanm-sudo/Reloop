import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDb } from '@/lib/db';
import { runSeed } from '@/scripts/seed';
import { InventoryItem } from '@/models/inventory-item';
import { RecipientProfile } from '@/models/recipient-profile';
import { User } from '@/models/user';
import { clearTestDb, startTestDb, stopTestDb } from '../helpers/db';

/**
 * Runs the seed for real, against a real database.
 *
 * Demo reliability is a judged criterion, so "the seed works" needs to be an assertion rather than
 * an assumption. This also pins down the honesty rules that are easiest to erode later: real
 * committed coordinates, and a provenance disclaimer on every partner profile.
 */

beforeAll(async () => {
  await startTestDb();
  await connectDb();
  await clearTestDb();
});

afterAll(async () => {
  await stopTestDb();
});

describe('the demo seed', () => {
  it('builds a complete, coherent Lucknow dataset', async () => {
    const summary = await runSeed();

    expect(summary.users).toBe(2);
    expect(summary.partners).toBe(7);
    expect(summary.items).toBeGreaterThanOrEqual(6);
    // Seeding runs the Prediction Agent for real, so urgent items must already have started runs.
    expect(summary.runs).toBeGreaterThan(0);
    expect(summary.events).toBeGreaterThan(0);
  });

  it('gives the demo a genuinely urgent lead item', async () => {
    const sabzi = await InventoryItem.findOne({ category: 'cooked_curry_veg' }).lean();

    expect(sabzi).toBeTruthy();
    // Past the act-now threshold on the real formula, not nudged into looking urgent.
    expect(sabzi?.urgencyScore).toBeGreaterThanOrEqual(0.7);
    expect(sabzi?.actByAt).toBeTruthy();
  });

  it('spreads the pantry across urgency levels, so the timeline has something to show', async () => {
    const items = await InventoryItem.find({}).lean();
    const scores = items.map((item) => item.urgencyScore ?? 0);

    expect(Math.max(...scores)).toBeGreaterThanOrEqual(0.7);
    expect(Math.min(...scores)).toBeLessThan(0.4);
  });

  it('places every partner at real committed coordinates', async () => {
    const partners = await RecipientProfile.find({}).lean();

    for (const partner of partners) {
      const lng = partner.location.coordinates[0];
      const lat = partner.location.coordinates[1];
      expect(typeof lng, partner.orgName).toBe('number');
      expect(typeof lat, partner.orgName).toBe('number');
      // Inside the Lucknow district bounding box.
      expect(lng, partner.orgName).toBeGreaterThan(80.5);
      expect(lng, partner.orgName).toBeLessThan(81.5);
      expect(lat, partner.orgName).toBeGreaterThan(26.4);
      expect(lat, partner.orgName).toBeLessThan(27.2);
    }
  });

  it('never claims a partnership it does not have', async () => {
    const partners = await RecipientProfile.find({}).lean();

    for (const partner of partners) {
      expect(partner.provenance, partner.orgName).toMatch(/not an active partnership/i);
      expect(partner.provenance, partner.orgName).toMatch(/modelled on/i);
    }
  });

  it('includes a compost and a biogas route, so the loop closes when redistribution fails', async () => {
    const sinks = await RecipientProfile.find({ orgType: { $in: ['COMPOST', 'BIOGAS'] } }).lean();
    expect(sinks).toHaveLength(2);
  });

  it('covers late-evening cooked surplus, the hardest and most common real case', async () => {
    // Without an overnight recipient the demo silently becomes a composting demo after 9 PM.
    const overnight = await RecipientProfile.find({
      acceptedCategories: 'cooked_curry_veg',
      orgType: { $nin: ['COMPOST', 'BIOGAS'] },
    }).lean();

    const spansMidnight = overnight.some((partner) =>
      partner.operatingHours.some((hours) => hours.close < hours.open)
    );
    expect(spansMidnight).toBe(true);
  });

  it('reports whether the redistribution path is actually live, rather than assuming it', async () => {
    const summary = await runSeed();
    expect(summary.redistributionViable).toHaveProperty('viable');
    expect(Array.isArray(summary.redistributionViable.openPartners)).toBe(true);
  });

  it('gives partners genuinely different constraints, so ranking has something to decide', async () => {
    const partners = await RecipientProfile.find({ orgType: { $nin: ['COMPOST', 'BIOGAS'] } }).lean();

    // Distinct opening windows and distinct capacities are what make the choice non-trivial.
    const windows = new Set(partners.map((p) => p.operatingHours[0]?.open));
    const capacities = new Set(partners.map((p) => p.dailyCapacityKg));

    expect(windows.size).toBeGreaterThan(1);
    expect(capacities.size).toBeGreaterThan(1);
    expect(partners.some((p) => p.coldChainCapable)).toBe(true);
    expect(partners.some((p) => !p.coldChainCapable)).toBe(true);
  });

  it('is idempotent — re-running rebuilds rather than duplicating', async () => {
    const first = await runSeed();
    const second = await runSeed();

    expect(second.users).toBe(first.users);
    expect(second.partners).toBe(first.partners);
    expect(second.items).toBe(first.items);
    expect(await RecipientProfile.countDocuments()).toBe(7);
    expect(await User.countDocuments()).toBe(2);
  });
});
