import { describe, expect, it } from 'vitest';
import { ITEM_CATEGORIES, MATERIAL_CATEGORIES, STORAGE_STATES, kindOf } from '@/lib/domain';
import {
  impactTable,
  lookupFactors,
  lookupShelfLife,
  methodologyFor,
  shelfLifeTable,
} from '@/lib/reference-data';

/**
 * These tests protect the project's central data claim: no number reaches a user without a
 * citation, and no category can exist without cited data behind it.
 */

describe('reference data coverage', () => {
  it('has a shelf-life row for every canonical category', () => {
    for (const category of ITEM_CATEGORIES) {
      expect(() => lookupShelfLife(category), category).not.toThrow();
    }
  });

  it('has an impact row for every canonical category', () => {
    for (const category of ITEM_CATEGORIES) {
      expect(() => lookupFactors(category), category).not.toThrow();
    }
  });

  it('defines a baseline for every storage state', () => {
    for (const category of ITEM_CATEGORIES) {
      const entry = lookupShelfLife(category);
      for (const storage of STORAGE_STATES) {
        expect(entry.baselineHours[storage], `${category}/${storage}`).toBeTypeOf('number');
      }
    }
  });

  it('has no duplicate rows', () => {
    const shelf = shelfLifeTable().entries.map((e) => e.category);
    const impact = impactTable().factors.map((f) => f.category);
    expect(new Set(shelf).size).toBe(shelf.length);
    expect(new Set(impact).size).toBe(impact.length);
  });
});

describe('citation integrity', () => {
  it('gives every shelf-life row a source note', () => {
    for (const entry of shelfLifeTable().entries) {
      expect(entry.sourceNote.length, entry.category).toBeGreaterThan(10);
    }
  });

  it('names a published commodity group for every quantified impact row', () => {
    for (const factor of impactTable().factors) {
      if (factor.notQuantified) {
        expect(factor.notQuantifiedReason, factor.category).toBeTruthy();
      } else {
        expect(factor.commodityGroup, factor.category).toBeTruthy();
        expect(factor.co2eKgPerKg, factor.category).toBeTypeOf('number');
        expect(factor.waterLPerKg, factor.category).toBeTypeOf('number');
        expect(factor.landM2PerKg, factor.category).toBeTypeOf('number');
      }
    }
  });

  it('explains every proxy substitution', () => {
    for (const factor of impactTable().factors) {
      if (factor.isProxy) {
        expect(factor.proxyNote, factor.category).toBeTruthy();
      }
    }
  });

  it('exposes dataset provenance to the methodology sheet', () => {
    const { dataset, factor, compost } = methodologyFor('produce_leafy_greens');
    expect(dataset.name).toMatch(/Poore/);
    expect(dataset.url).toMatch(/^https:\/\//);
    expect(factor.category).toBe('produce_leafy_greens');
    expect(compost.sourceUrl).toMatch(/^https:\/\//);
  });
});

describe('accounting separation', () => {
  it('keeps the compost credit far below the production footprint it must not impersonate', () => {
    const { compostFallback, factors } = impactTable();
    const rice = factors.find((f) => f.category === 'grains_rice_raw');
    expect(rice?.co2eKgPerKg).toBeGreaterThan(compostFallback.co2eKgPerKgDiverted);
    // Composting recovers no water or land — only landfill methane is avoided.
    expect(compostFallback.waterLPerKgDiverted).toBe(0);
    expect(compostFallback.landM2PerKgDiverted).toBe(0);
  });

  it('reports materials as not quantified rather than guessing', () => {
    for (const category of MATERIAL_CATEGORIES) {
      const factor = lookupFactors(category);
      expect(factor.notQuantified, category).toBe(true);
      expect(factor.co2eKgPerKg, category).toBeNull();
      expect(kindOf(category)).toBe('MATERIAL');
    }
  });
});
