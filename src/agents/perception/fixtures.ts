import type { ExtractionResult } from '@/agents/perception/schema';

/**
 * Deterministic Perception fixtures for `DEMO_MODE`.
 *
 * Keyed two ways. By SHA-256 of the uploaded bytes, so a bundled demo image always resolves to
 * the same extraction; and by an explicit key, so the demo UI can offer a "use the demo receipt"
 * path that needs no camera. Both routes set `fixture: true`, which the feed displays — nothing
 * here is ever presented as a live model call.
 *
 * An unrecognised upload in demo mode does NOT fall back to a generic fixture. Inventing items a
 * user did not photograph would be worse than admitting we cannot read it, so it degrades to
 * manual entry instead (FR-2.5).
 */

export const FIXTURE_KEYS = ['receipt-gomti-nagar', 'photo-leftover-sabzi', 'photo-fridge-produce'] as const;
export type FixtureKey = (typeof FIXTURE_KEYS)[number];

export function isFixtureKey(value: string): value is FixtureKey {
  return (FIXTURE_KEYS as readonly string[]).includes(value);
}

const FIXTURES: Record<FixtureKey, ExtractionResult> = {
  'receipt-gomti-nagar': {
    isReceipt: true,
    note: 'Kirana receipt, eight lines, one illegible.',
    items: [
      {
        name: 'Palak (spinach)',
        category: 'produce_leafy_greens',
        quantity: 400,
        unit: 'g',
        estimatedMassG: 400,
        isCooked: false,
        storageHint: 'FRIDGE',
        confidence: 0.94,
      },
      {
        name: 'Tomatoes',
        category: 'produce_tomatoes',
        quantity: 1,
        unit: 'kg',
        estimatedMassG: 1000,
        isCooked: false,
        storageHint: 'FRIDGE',
        confidence: 0.91,
      },
      {
        name: 'Toned milk',
        category: 'dairy_milk',
        quantity: 1,
        unit: 'l',
        estimatedMassG: 1000,
        isCooked: false,
        storageHint: 'FRIDGE',
        confidence: 0.88,
      },
      {
        name: 'Paneer',
        category: 'dairy_paneer',
        quantity: 200,
        unit: 'g',
        estimatedMassG: 200,
        isCooked: false,
        storageHint: 'FRIDGE',
        confidence: 0.86,
      },
      {
        name: 'Atta',
        category: 'grains_wheat_flour',
        quantity: 5,
        unit: 'kg',
        estimatedMassG: 5000,
        isCooked: false,
        storageHint: 'PANTRY',
        confidence: 0.95,
      },
      {
        name: 'Arhar dal',
        category: 'pulses_dry',
        quantity: 1,
        unit: 'kg',
        estimatedMassG: 1000,
        isCooked: false,
        storageHint: 'PANTRY',
        confidence: 0.93,
      },
      {
        name: 'Bananas',
        category: 'produce_bananas',
        quantity: 6,
        unit: 'pcs',
        estimatedMassG: 720,
        isCooked: false,
        storageHint: 'PANTRY',
        confidence: 0.82,
      },
      {
        // Deliberately below the 0.6 gate: the demo shows the confirmation path, not just the
        // happy path.
        name: 'Unreadable line item',
        category: 'packaged_dry_goods',
        quantity: 1,
        unit: 'packs',
        estimatedMassG: 250,
        isCooked: false,
        storageHint: 'PANTRY',
        confidence: 0.34,
      },
    ],
  },

  'photo-leftover-sabzi': {
    isReceipt: false,
    note: 'Two covered containers of cooked food, photographed on a counter.',
    items: [
      {
        name: 'Aloo gobi sabzi',
        category: 'cooked_curry_veg',
        quantity: 1200,
        unit: 'g',
        estimatedMassG: 1200,
        isCooked: true,
        storageHint: 'PANTRY',
        confidence: 0.89,
      },
      {
        name: 'Arhar dal (cooked)',
        category: 'cooked_dal',
        quantity: 900,
        unit: 'g',
        estimatedMassG: 900,
        isCooked: true,
        storageHint: 'PANTRY',
        confidence: 0.85,
      },
      {
        name: 'Rotis',
        category: 'grains_roti',
        quantity: 12,
        unit: 'pcs',
        estimatedMassG: 540,
        isCooked: true,
        storageHint: 'PANTRY',
        confidence: 0.78,
      },
    ],
  },

  'photo-fridge-produce': {
    isReceipt: false,
    note: 'Open fridge shelf.',
    items: [
      {
        name: 'Methi bunch',
        category: 'produce_leafy_greens',
        quantity: 250,
        unit: 'g',
        estimatedMassG: 250,
        isCooked: false,
        storageHint: 'FRIDGE',
        confidence: 0.87,
      },
      {
        name: 'Curd',
        category: 'dairy_curd',
        quantity: 500,
        unit: 'g',
        estimatedMassG: 500,
        isCooked: false,
        storageHint: 'FRIDGE',
        confidence: 0.9,
      },
      {
        name: 'Lauki (bottle gourd)',
        category: 'produce_other_vegetables',
        quantity: 1,
        unit: 'pcs',
        estimatedMassG: 800,
        isCooked: false,
        storageHint: 'FRIDGE',
        confidence: 0.83,
      },
    ],
  },
};

/**
 * SHA-256 of the bundled demo images. Populated when a demo image is added to `fixtures/images/`;
 * empty until then, which is why the explicit-key path exists.
 */
const HASH_TO_KEY: Record<string, FixtureKey> = {};

export function fixtureByKey(key: FixtureKey): ExtractionResult {
  return FIXTURES[key];
}

export function fixtureByHash(sha256: string): ExtractionResult | null {
  const key = HASH_TO_KEY[sha256];
  return key ? FIXTURES[key] : null;
}
