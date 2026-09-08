import { redirect } from 'next/navigation';
import { Types } from 'mongoose';
import { getSession } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { impactTable } from '@/lib/reference-data';
import { formatMass } from '@/lib/units';
import { ImpactLog } from '@/models/impact-log';
import { RecipientProfile } from '@/models/recipient-profile';
import { MethodologySheet } from '@/components/impact/methodology-sheet';

export const metadata = { title: 'Impact · ReLoop' };
export const dynamic = 'force-dynamic';

/**
 * What was actually saved.
 *
 * Redistributed and composted are shown as two separate lines and never summed into one headline.
 * A single combined figure would be larger and would also be the exact move that makes this kind
 * of number untrustworthy.
 */

type Totals = { co2eKg: number; waterL: number; landM2: number; massKg: number; count: number };

const ZERO: Totals = { co2eKg: 0, waterL: 0, landM2: 0, massKg: 0, count: 0 };

type Row = {
  outcome: string;
  co2eKg?: number | null;
  waterL?: number | null;
  landM2?: number | null;
  quantityKg: number;
};

function tally(rows: readonly Row[], outcome: string): Totals {
  return rows
    .filter((row) => row.outcome === outcome)
    .reduce<Totals>(
      (acc, row) => ({
        co2eKg: acc.co2eKg + (row.co2eKg ?? 0),
        waterL: acc.waterL + (row.waterL ?? 0),
        landM2: acc.landM2 + (row.landM2 ?? 0),
        massKg: acc.massKg + row.quantityKg,
        count: acc.count + 1,
      }),
      ZERO
    );
}

function streakDays(dates: readonly Date[]): number {
  const days = new Set(dates.map((date) => date.toISOString().slice(0, 10)));
  const cursor = new Date();
  let streak = 0;

  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export default async function ImpactPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  await connectDb();

  const userId = new Types.ObjectId(session.userId);

  const [mine, all, partners] = await Promise.all([
    ImpactLog.find({ userId }).sort({ at: -1 }).limit(500).lean(),
    ImpactLog.find({}).sort({ at: -1 }).limit(2000).lean(),
    RecipientProfile.find({ isActive: true }).select('orgName').lean(),
  ]);

  const personal = {
    redistributed: tally(mine, 'REDISTRIBUTED'),
    composted: tally(mine, 'COMPOSTED'),
  };
  const city = {
    redistributed: tally(all, 'REDISTRIBUTED'),
    composted: tally(all, 'COMPOSTED'),
  };

  const table = impactTable();
  const streak = streakDays(mine.map((row) => row.at));

  // Leaderboard by mass handled, from the recipient recorded on each match's impact log.
  const byPartner = new Map<string, number>();
  for (const row of all) {
    if (row.outcome !== 'REDISTRIBUTED') continue;
    const key = String(row.userId);
    byPartner.set(key, (byPartner.get(key) ?? 0) + row.quantityKg);
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-5 py-6">
      <div>
        <h1 className="text-xl font-semibold">Impact</h1>
        <p className="text-slate mt-1 text-sm">
          Real units from published data. Every figure has its methodology one tap away.
        </p>
      </div>

      <section aria-labelledby="personal-heading">
        <h2 id="personal-heading" className="text-sm font-semibold">
          Yours
        </h2>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="CO2e avoided" value={`${personal.redistributed.co2eKg.toFixed(1)} kg`} />
          <Stat
            label="Water avoided"
            value={`${Math.round(personal.redistributed.waterL).toLocaleString()} L`}
          />
          <Stat label="Land avoided" value={`${personal.redistributed.landM2.toFixed(1)} m²`} />
        </div>

        <p className="text-slate mt-2 text-xs">
          From {formatMass(personal.redistributed.massKg)} redistributed across{' '}
          {personal.redistributed.count} handoff
          {personal.redistributed.count === 1 ? '' : 's'}.
        </p>

        {personal.composted.count > 0 && (
          <div className="border-line rounded-card mt-3 border border-dashed p-3">
            <p className="text-sm font-medium">
              Plus {formatMass(personal.composted.massKg)} composted
            </p>
            <p className="text-slate mt-1 text-xs leading-relaxed">
              Worth {personal.composted.co2eKg.toFixed(1)} kg CO2e of avoided landfill methane — and
              no water or land, because growing that food was already paid for. Kept deliberately
              separate from the numbers above rather than added to them.
            </p>
          </div>
        )}

        {streak > 0 && (
          <p className="text-clay-ink mt-3 text-sm">
            {streak} day{streak === 1 ? '' : 's'} in a row with something diverted.
          </p>
        )}
      </section>

      <section aria-labelledby="city-heading">
        <h2 id="city-heading" className="text-sm font-semibold">
          Across Lucknow
        </h2>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="CO2e avoided" value={`${city.redistributed.co2eKg.toFixed(1)} kg`} />
          <Stat
            label="Water avoided"
            value={`${Math.round(city.redistributed.waterL).toLocaleString()} L`}
          />
          <Stat label="Land avoided" value={`${city.redistributed.landM2.toFixed(1)} m²`} />
        </div>
        <p className="text-slate mt-2 text-xs">
          {formatMass(city.redistributed.massKg)} redistributed and{' '}
          {formatMass(city.composted.massKg)} composted, from {partners.length} partner
          organisations.
        </p>
      </section>

      <section aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="text-sm font-semibold">
          Every diversion, with its source
        </h2>

        {mine.length === 0 ? (
          <p className="text-slate border-line rounded-card mt-3 border border-dashed p-6 text-center text-sm">
            Nothing diverted yet. Once a handoff completes it shows up here with its methodology.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {mine.slice(0, 15).map((row) => (
              <li key={String(row._id)} className="border-line rounded-card border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">
                      {row.category.replace(/_/g, ' ')} · {formatMass(row.quantityKg)}
                    </p>
                    <p className="text-slate mt-0.5 text-xs">
                      {row.outcome === 'COMPOSTED' ? 'Composted' : 'Redistributed'} ·{' '}
                      {row.notQuantified
                        ? 'footprint not quantified'
                        : `${(row.co2eKg ?? 0).toFixed(2)} kg CO2e${
                            row.waterL ? ` · ${Math.round(row.waterL)} L water` : ''
                          }`}
                    </p>
                  </div>

                  <MethodologySheet
                    methodology={{
                      dataset: row.factorSource?.dataset ?? 'unrecorded',
                      year: row.factorSource?.year ?? null,
                      url: row.factorSource?.url ?? null,
                      commodityGroup: row.factorSource?.commodityGroup ?? null,
                      isProxy: row.factorSource?.isProxy ?? false,
                      proxyNote: row.factorSource?.proxyNote ?? null,
                      factorValues: {
                        co2eKgPerKg: row.factorSource?.factorValues?.co2eKgPerKg ?? null,
                        waterLPerKg: row.factorSource?.factorValues?.waterLPerKg ?? null,
                        landM2PerKg: row.factorSource?.factorValues?.landM2PerKg ?? null,
                      },
                      outcome: row.outcome === 'COMPOSTED' ? 'COMPOSTED' : 'REDISTRIBUTED',
                      notQuantified: row.notQuantified,
                      notQuantifiedReason: row.notQuantifiedReason ?? null,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="sources-heading" className="border-line border-t pt-5">
        <h2 id="sources-heading" className="text-sm font-semibold">
          Where the factors come from
        </h2>
        <p className="text-slate mt-2 text-xs leading-relaxed">{table.dataset.name}</p>
        <a
          href={table.dataset.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-clay-ink mt-1 inline-block text-xs underline"
        >
          {table.dataset.url}
        </a>
        <p className="text-slate mt-3 text-xs leading-relaxed">
          {table.compostFallback.note}
        </p>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-line rounded-card border p-3">
      <p className="text-slate text-[11px]">{label}</p>
      <p className="mt-1 text-base font-semibold">{value}</p>
    </div>
  );
}
