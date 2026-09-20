import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { impactAgent } from '@/agents/impact';
import { makeContext } from '@/agents/registry';

/**
 * These tests exist to stop the impact numbers from flattering the project. The failure mode they
 * guard against is not a crash — it is a plausible-looking number that is quietly four times too
 * big because composting was credited as if the food had been eaten.
 */

const ctx = makeContext({
  agentId: 'impact',
  runId: new Types.ObjectId(),
  userId: new Types.ObjectId(),
});

describe('redistributed impact', () => {
  it('uses the cited per-kg factors', async () => {
    // Rice: 4.45 kg CO2e, 2248.4 L, 2.8 m² per kg (Poore & Nemecek 2018).
    const result = await impactAgent.run(
      { category: 'grains_rice_raw', quantityKg: 2, outcome: 'REDISTRIBUTED' },
      ctx
    );

    expect(result.output.co2eKg).toBeCloseTo(8.9, 3);
    expect(result.output.waterL).toBeCloseTo(4496.8, 1);
    expect(result.output.landM2).toBeCloseTo(5.6, 3);
    expect(result.output.notQuantified).toBe(false);
    expect(result.output.factorSource.commodityGroup).toBe('Rice');
  });

  it('records the factor values on the result, so the methodology sheet cannot drift', async () => {
    const result = await impactAgent.run(
      { category: 'produce_tomatoes', quantityKg: 1, outcome: 'REDISTRIBUTED' },
      ctx
    );

    expect(result.output.factorSource.factorValues.co2eKgPerKg).toBe(2.09);
    expect(result.output.factorSource.url).toMatch(/^https:\/\//);
  });

  it('flags proxy factors rather than hiding the substitution', async () => {
    const result = await impactAgent.run(
      { category: 'dairy_paneer', quantityKg: 1, outcome: 'REDISTRIBUTED' },
      ctx
    );

    expect(result.output.factorSource.isProxy).toBe(true);
    expect(result.output.factorSource.proxyNote).toBeTruthy();
    expect(result.fallback).toBe('factor_proxy');
  });
});

describe('composted impact', () => {
  it('credits only landfill diversion, never avoided production', async () => {
    const redistributed = await impactAgent.run(
      { category: 'cooked_rice_dish', quantityKg: 4, outcome: 'REDISTRIBUTED' },
      ctx
    );
    const composted = await impactAgent.run(
      { category: 'cooked_rice_dish', quantityKg: 4, outcome: 'COMPOSTED' },
      ctx
    );

    expect(composted.output.co2eKg).toBeCloseTo(2, 3); // 4 kg x 0.5
    // The whole point: composting must be worth dramatically less than redistribution.
    expect(composted.output.co2eKg!).toBeLessThan(redistributed.output.co2eKg! / 5);
  });

  it('recovers no water and no land', async () => {
    const result = await impactAgent.run(
      { category: 'grains_rice_raw', quantityKg: 10, outcome: 'COMPOSTED' },
      ctx
    );

    // Zero is the correct answer, not missing data: growing it is already spent.
    expect(result.output.waterL).toBe(0);
    expect(result.output.landM2).toBe(0);
    expect(result.output.notQuantified).toBe(false);
  });

  it('cites a different source than the production factors', async () => {
    const result = await impactAgent.run(
      { category: 'cooked_dal', quantityKg: 1, outcome: 'COMPOSTED' },
      ctx
    );
    expect(result.output.factorSource.dataset).toMatch(/WRAP/i);
  });

  it('refuses to apply the food compost credit to a material', async () => {
    /*
     * Regression. The compost credit is WRAP's avoided landfill methane per tonne of FOOD waste.
     * This branch used to apply it to any composted diversion, so 2.4 kg of donated clothes were
     * credited 1.2 kg CO2e from a figure never measured on textiles — an invented number in the
     * one place this project cannot afford one.
     */
    const result = await impactAgent.run(
      { category: 'material_textiles', quantityKg: 2.4, outcome: 'COMPOSTED' },
      ctx
    );

    expect(result.output.notQuantified).toBe(true);
    expect(result.output.co2eKg).toBeNull();
    expect(result.output.notQuantifiedReason).toBeTruthy();
    expect(result.fallback).toBe('factor_not_available');
    // And it must not claim the food story either.
    expect(result.rationale).not.toMatch(/growing it/i);
  });

  it('still credits food that was composted', async () => {
    const result = await impactAgent.run(
      { category: 'cooked_curry_veg', quantityKg: 2.4, outcome: 'COMPOSTED' },
      ctx
    );
    expect(result.output.notQuantified).toBe(false);
    expect(result.output.co2eKg).toBeCloseTo(1.2, 3);
  });
});

describe('unquantifiable categories', () => {
  it('says "not quantified" instead of estimating', async () => {
    const result = await impactAgent.run(
      { category: 'material_textiles', quantityKg: 3, outcome: 'REDISTRIBUTED' },
      ctx
    );

    expect(result.output.notQuantified).toBe(true);
    expect(result.output.co2eKg).toBeNull();
    expect(result.output.waterL).toBeNull();
    expect(result.output.landM2).toBeNull();
    expect(result.output.notQuantifiedReason).toBeTruthy();
    expect(result.fallback).toBe('factor_not_available');
  });

  it('still reports the mass diverted', async () => {
    const result = await impactAgent.run(
      { category: 'material_household_goods', quantityKg: 5.5, outcome: 'REDISTRIBUTED' },
      ctx
    );
    expect(result.output.quantityKg).toBe(5.5);
  });
});

describe('scaling', () => {
  it('is linear in mass', async () => {
    const one = await impactAgent.run(
      { category: 'produce_apples', quantityKg: 1, outcome: 'REDISTRIBUTED' },
      ctx
    );
    const ten = await impactAgent.run(
      { category: 'produce_apples', quantityKg: 10, outcome: 'REDISTRIBUTED' },
      ctx
    );
    expect(ten.output.co2eKg!).toBeCloseTo(one.output.co2eKg! * 10, 6);
  });

  it('returns zero for zero mass rather than throwing', async () => {
    const result = await impactAgent.run(
      { category: 'produce_apples', quantityKg: 0, outcome: 'REDISTRIBUTED' },
      ctx
    );
    expect(result.output.co2eKg).toBe(0);
  });
});
