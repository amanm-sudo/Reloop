import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  ITEM_CATEGORIES,
  STORAGE_STATES,
  type ItemCategory,
  type StorageState,
} from '@/lib/domain';

/**
 * Loads and validates the cited reference tables in `data/`.
 *
 * Read from disk rather than imported so the same code path serves route handlers, the seed
 * script, and tests. `next.config.ts` traces `data/` into the deployment bundle.
 *
 * Every table is parsed with Zod at load time: a malformed or unsourced row fails loudly at
 * startup instead of producing a silently wrong number in front of a judge.
 */

const categoryEnum = z.enum(ITEM_CATEGORIES);
const storageRecord = z.object(
  Object.fromEntries(STORAGE_STATES.map((s) => [s, z.number().min(0)])) as Record<
    StorageState,
    z.ZodNumber
  >
);

const shelfLifeEntrySchema = z.object({
  category: categoryEnum,
  label: z.string().min(1),
  baselineHours: storageRecord,
  cookedFactor: z.number().positive(),
  actionWindowHours: z.number().positive(),
  verified: z.boolean(),
  sourceNote: z.string().min(10, 'every shelf-life row must explain where its value came from'),
});

const shelfLifeFileSchema = z.object({
  dataset: z.object({
    name: z.string().min(1),
    primaryUrl: z.string().url(),
    coldChartUrl: z.string().url(),
    dataDocumentationUrl: z.string().url(),
    retrievedAt: z.string().min(4),
    extractionNote: z.string().min(1),
    unitNote: z.string().min(1),
  }),
  entries: z.array(shelfLifeEntrySchema).min(1),
});

const impactFactorSchema = z
  .object({
    category: categoryEnum,
    commodityGroup: z.string().min(1).nullable(),
    co2eKgPerKg: z.number().min(0).nullable(),
    landM2PerKg: z.number().min(0).nullable(),
    waterLPerKg: z.number().min(0).nullable(),
    isProxy: z.boolean().optional().default(false),
    proxyNote: z.string().optional(),
    notQuantified: z.boolean().optional().default(false),
    notQuantifiedReason: z.string().optional(),
    verified: z.boolean(),
  })
  .superRefine((row, ctx) => {
    if (row.notQuantified) {
      if (!row.notQuantifiedReason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${row.category}: notQuantified rows must say why`,
        });
      }
      return;
    }
    if (row.co2eKgPerKg == null || row.landM2PerKg == null || row.waterLPerKg == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${row.category}: a quantified row needs all three factors, or notQuantified: true`,
      });
    }
    if (!row.commodityGroup) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${row.category}: a quantified row must name the published commodity group it came from`,
      });
    }
    if (row.isProxy && !row.proxyNote) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${row.category}: a proxy row must explain the substitution`,
      });
    }
  });

const impactFileSchema = z.object({
  dataset: z.object({
    name: z.string().min(1),
    year: z.number().int(),
    referenceYear: z.number().int(),
    distributedVia: z.string().min(1),
    url: z.string().url(),
    seriesUrls: z.object({
      co2eKgPerKg: z.string().url(),
      landM2PerKg: z.string().url(),
      waterLPerKg: z.string().url(),
    }),
    retrievedAt: z.string().min(4),
    notes: z.string().min(1),
  }),
  compostFallback: z.object({
    note: z.string().min(1),
    co2eKgPerKgDiverted: z.number().min(0),
    waterLPerKgDiverted: z.number().min(0),
    landM2PerKgDiverted: z.number().min(0),
    source: z.string().min(1),
    sourceUrl: z.string().url(),
    verified: z.boolean(),
  }),
  factors: z.array(impactFactorSchema).min(1),
});

export type ShelfLifeEntry = z.infer<typeof shelfLifeEntrySchema>;
export type ImpactFactor = z.infer<typeof impactFactorSchema>;
export type ShelfLifeFile = z.infer<typeof shelfLifeFileSchema>;
export type ImpactFile = z.infer<typeof impactFileSchema>;

function loadJson(fileName: string): unknown {
  const filePath = path.join(process.cwd(), 'data', fileName);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function parseOrThrow<S extends z.ZodTypeAny>(
  schema: S,
  raw: unknown,
  fileName: string
): z.infer<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n  ');
    throw new Error(`data/${fileName} is invalid:\n  ${detail}`);
  }
  return parsed.data;
}

let shelfLifeCache: ShelfLifeFile | null = null;
let impactCache: ImpactFile | null = null;

export function shelfLifeTable(): ShelfLifeFile {
  const cached =
    shelfLifeCache ??
    parseOrThrow(shelfLifeFileSchema, loadJson('shelf-life.json'), 'shelf-life.json');
  shelfLifeCache = cached;
  return cached;
}

export function impactTable(): ImpactFile {
  const cached =
    impactCache ??
    parseOrThrow(impactFileSchema, loadJson('impact-factors.json'), 'impact-factors.json');
  impactCache = cached;
  return cached;
}

/** Tool surface for the Prediction Agent. Total over the canonical category list. */
export function lookupShelfLife(category: ItemCategory): ShelfLifeEntry {
  const entry = shelfLifeTable().entries.find((e) => e.category === category);
  if (!entry) {
    // verify-sources guarantees coverage, so this is programmer error, not expected failure.
    throw new Error(`shelf-life.json has no row for category "${category}"`);
  }
  return entry;
}

/** Tool surface for the Impact Agent. Total over the canonical category list. */
export function lookupFactors(category: ItemCategory): ImpactFactor {
  const factor = impactTable().factors.find((f) => f.category === category);
  if (!factor) {
    throw new Error(`impact-factors.json has no row for category "${category}"`);
  }
  return factor;
}

/** Everything the methodology sheet needs, read from the same rows the maths used. */
export function methodologyFor(category: ItemCategory): {
  factor: ImpactFactor;
  dataset: ImpactFile['dataset'];
  compost: ImpactFile['compostFallback'];
} {
  const table = impactTable();
  return { factor: lookupFactors(category), dataset: table.dataset, compost: table.compostFallback };
}

/** Test seam. */
export function resetReferenceDataCache(): void {
  shelfLifeCache = null;
  impactCache = null;
}
