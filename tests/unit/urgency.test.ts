import { describe, expect, it } from 'vitest';
import { THRESHOLDS } from '@/lib/domain';
import { computeUrgency } from '@/agents/prediction/urgency';

const HOUR = 3_600_000;
const NOW = new Date('2026-08-31T12:00:00.000Z');

describe('urgency formula', () => {
  it('scores freshly cooked food as urgent, because a recipient needs lead time', () => {
    // Cooked sabzi has a 4-hour room-temperature window and recipients need ~6 hours of notice,
    // so it is urgent almost immediately. That gap is the whole reason surplus dies uncollected.
    const result = computeUrgency({
      category: 'cooked_curry_veg',
      storage: 'PANTRY',
      isCooked: true,
      startedAt: new Date(NOW.getTime() - 3 * HOUR),
      now: NOW,
    });

    expect(result.urgencyScore).toBeGreaterThan(THRESHOLDS.ACT_NOW);
    expect(result.shouldActNow).toBe(true);
    expect(result.basis).toBe('shelf-life-table-cooked');
  });

  it('scores dry staples as calm', () => {
    const result = computeUrgency({
      category: 'pulses_dry',
      storage: 'PANTRY',
      isCooked: false,
      startedAt: NOW,
      now: NOW,
    });

    expect(result.urgencyScore).toBe(0);
    expect(result.shouldActNow).toBe(false);
  });

  it('clamps to 1 once the window has passed', () => {
    const result = computeUrgency({
      category: 'cooked_dal',
      storage: 'PANTRY',
      isCooked: true,
      startedAt: new Date(NOW.getTime() - 200 * HOUR),
      now: NOW,
    });

    expect(result.urgencyScore).toBe(1);
    expect(result.remainingHours).toBeLessThan(0);
  });

  it('sits exactly on the threshold when remaining time equals 30% of the action window', () => {
    // urgency = 1 - remaining/window, so remaining = 0.3 * window gives exactly 0.7.
    const windowHours = 24; // leafy greens
    const result = computeUrgency({
      category: 'produce_leafy_greens',
      storage: 'FRIDGE',
      isCooked: false,
      startedAt: NOW,
      bestBeforeAt: new Date(NOW.getTime() + 0.3 * windowHours * HOUR),
      now: NOW,
    });

    expect(result.urgencyScore).toBeCloseTo(0.7, 5);
    expect(result.shouldActNow).toBe(true);
  });

  it('prefers a printed best-before date over any estimate', () => {
    const printed = new Date(NOW.getTime() + 5 * HOUR);
    const result = computeUrgency({
      category: 'packaged_dry_goods',
      storage: 'PANTRY',
      isCooked: false,
      startedAt: NOW,
      bestBeforeAt: printed,
      now: NOW,
    });

    expect(result.basis).toBe('printed-best-before');
    expect(result.actByAt.getTime()).toBe(printed.getTime());
    // A printed date is not an estimate, so it is never flagged low confidence.
    expect(result.lowConfidence).toBe(false);
  });

  it('drives MATERIAL urgency from the owner deadline, not shelf life', () => {
    const deadline = new Date(NOW.getTime() + 12 * HOUR);
    const result = computeUrgency({
      category: 'material_textiles',
      storage: 'PANTRY',
      isCooked: false,
      startedAt: NOW,
      userDeadlineAt: deadline,
      now: NOW,
    });

    expect(result.basis).toBe('user-deadline');
    expect(result.actByAt.getTime()).toBe(deadline.getTime());
  });

  it('flags categories whose shelf-life row is still a generalisation', () => {
    // produce_leafy_greens is verified:false pending the manual FoodKeeper pass, so anything
    // relying on the table for it must say so.
    const result = computeUrgency({
      category: 'produce_leafy_greens',
      storage: 'FRIDGE',
      isCooked: false,
      startedAt: NOW,
      now: NOW,
    });

    expect(result.lowConfidence).toBe(true);
  });

  it('lets cooked poultry outlast raw, via a cookedFactor above 1', () => {
    const raw = computeUrgency({
      category: 'protein_poultry_raw',
      storage: 'FRIDGE',
      isCooked: false,
      startedAt: NOW,
      now: NOW,
    });
    const cooked = computeUrgency({
      category: 'protein_poultry_raw',
      storage: 'FRIDGE',
      isCooked: true,
      startedAt: NOW,
      now: NOW,
    });

    expect(cooked.remainingHours).toBeGreaterThan(raw.remainingHours);
  });
});
