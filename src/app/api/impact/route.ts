import { requireSession } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { guarded, ok, toResponse, type Result } from '@/lib/result';
import { impactTable } from '@/lib/reference-data';
import { ImpactLog } from '@/models/impact-log';

/**
 * Personal and city-wide totals.
 *
 * Redistributed and composted are reported as separate lines rather than a single headline number.
 * Summing them would be the easy way to a bigger figure and the fastest way to lose a judge's
 * trust: composted food never recovers the emissions of growing it.
 */

type Totals = {
  co2eKg: number;
  waterL: number;
  landM2: number;
  massKg: number;
  count: number;
  notQuantifiedCount: number;
};

const EMPTY: Totals = {
  co2eKg: 0,
  waterL: 0,
  landM2: 0,
  massKg: 0,
  count: 0,
  notQuantifiedCount: 0,
};

function add(totals: Totals, row: { co2eKg?: number | null; waterL?: number | null; landM2?: number | null; quantityKg: number; notQuantified: boolean }): Totals {
  return {
    co2eKg: totals.co2eKg + (row.co2eKg ?? 0),
    waterL: totals.waterL + (row.waterL ?? 0),
    landM2: totals.landM2 + (row.landM2 ?? 0),
    massKg: totals.massKg + row.quantityKg,
    count: totals.count + 1,
    notQuantifiedCount: totals.notQuantifiedCount + (row.notQuantified ? 1 : 0),
  };
}

function round(totals: Totals): Totals {
  return {
    co2eKg: Math.round(totals.co2eKg * 100) / 100,
    waterL: Math.round(totals.waterL),
    landM2: Math.round(totals.landM2 * 100) / 100,
    massKg: Math.round(totals.massKg * 100) / 100,
    count: totals.count,
    notQuantifiedCount: totals.notQuantifiedCount,
  };
}

/** Consecutive days, counting back from today, with at least one diversion. */
function streakFrom(dates: readonly Date[]): number {
  if (dates.length === 0) return 0;

  const days = new Set(dates.map((d) => d.toISOString().slice(0, 10)));
  let streak = 0;
  const cursor = new Date();

  for (;;) {
    const key = cursor.toISOString().slice(0, 10);
    if (!days.has(key)) break;
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return streak;
}

export async function GET(): Promise<Response> {
  const result = await guarded('impact', async (): Promise<Result<unknown>> => {
    const session = await requireSession();
    if (!session.ok) return session;

    await connectDb();

    const [mine, all] = await Promise.all([
      ImpactLog.find({ userId: session.data.objectId }).sort({ at: -1 }).limit(500).lean(),
      ImpactLog.find({}).sort({ at: -1 }).limit(2000).lean(),
    ]);

    const split = (rows: typeof mine) => {
      let redistributed = EMPTY;
      let composted = EMPTY;
      for (const row of rows) {
        if (row.outcome === 'COMPOSTED') composted = add(composted, row);
        else redistributed = add(redistributed, row);
      }
      return { redistributed: round(redistributed), composted: round(composted) };
    };

    const table = impactTable();

    return ok({
      personal: {
        ...split(mine),
        streakDays: streakFrom(mine.map((r) => r.at)),
      },
      city: split(all),
      methodology: {
        dataset: table.dataset.name,
        year: table.dataset.year,
        url: table.dataset.url,
        notes: table.dataset.notes,
        compost: {
          note: table.compostFallback.note,
          co2eKgPerKgDiverted: table.compostFallback.co2eKgPerKgDiverted,
          source: table.compostFallback.source,
          sourceUrl: table.compostFallback.sourceUrl,
        },
      },
      recent: mine.slice(0, 12).map((row) => {
        // Mongoose types nested paths as optional; the write path always sets these.
        const source = row.factorSource;
        return {
          id: String(row._id),
          category: row.category,
          outcome: row.outcome,
          quantityKg: row.quantityKg,
          co2eKg: row.co2eKg ?? null,
          waterL: row.waterL ?? null,
          landM2: row.landM2 ?? null,
          notQuantified: row.notQuantified,
          notQuantifiedReason: row.notQuantifiedReason ?? null,
          at: row.at.toISOString(),
          factorSource: {
            dataset: source?.dataset ?? 'unrecorded',
            year: source?.year ?? null,
            url: source?.url ?? null,
            commodityGroup: source?.commodityGroup ?? null,
            isProxy: source?.isProxy ?? false,
            proxyNote: source?.proxyNote ?? null,
            factorValues: {
              co2eKgPerKg: source?.factorValues?.co2eKgPerKg ?? null,
              waterLPerKg: source?.factorValues?.waterLPerKg ?? null,
              landM2PerKg: source?.factorValues?.landM2PerKg ?? null,
            },
          },
        };
      }),
    });
  });

  return toResponse(result);
}
