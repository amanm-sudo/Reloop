'use client';

import { useState } from 'react';

/**
 * Methodology, one tap from every number.
 *
 * The whole credibility of the impact figures rests on this being trivially reachable and
 * specific — the factor value actually used, its dataset, its year, and a link. Reading it from
 * the stored `ImpactLog` rather than looking the factor up again means the sheet can never
 * describe a calculation different from the one that produced the number.
 */

export type MethodologyView = {
  dataset: string;
  year: number | null;
  url: string | null;
  commodityGroup: string | null;
  isProxy: boolean;
  proxyNote: string | null;
  factorValues: {
    co2eKgPerKg: number | null;
    waterLPerKg: number | null;
    landM2PerKg: number | null;
  };
  outcome: 'REDISTRIBUTED' | 'COMPOSTED';
  notQuantified: boolean;
  notQuantifiedReason: string | null;
};

export function MethodologySheet({
  methodology,
  label = 'methodology',
}: {
  methodology: MethodologyView;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-slate hover:text-ink text-xs underline"
      >
        ⓘ {label}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Methodology"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-paper-raised rounded-card max-h-[85dvh] w-full max-w-md overflow-auto p-5 sm:max-w-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-sm font-semibold">How this number was worked out</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-slate hover:text-ink text-sm"
              >
                Close
              </button>
            </div>

            <p className="mt-3 text-sm">
              {methodology.outcome === 'COMPOSTED' ? (
                <>
                  This was <strong>composted</strong>, not eaten. Composting avoids the methane that
                  landfill would have produced, but it does not recover the emissions, water and
                  land already spent growing the food — so only the diversion credit is counted, and
                  water and land are reported as zero rather than as a saving.
                </>
              ) : (
                <>
                  This was <strong>redistributed</strong> and eaten by someone, which displaces food
                  that would otherwise have had to be produced. It therefore earns the full
                  published per-kilogram footprint.
                </>
              )}
            </p>

            {methodology.notQuantified ? (
              <p className="text-urgency-soon-ink mt-3 text-sm">
                Not quantified. {methodology.notQuantifiedReason}
              </p>
            ) : (
              <dl className="border-line mt-4 divide-y">
                <Row label="Dataset" value={methodology.dataset} />
                {methodology.year !== null && <Row label="Published" value={String(methodology.year)} />}
                {methodology.commodityGroup && (
                  <Row label="Commodity group used" value={methodology.commodityGroup} />
                )}
                {methodology.factorValues.co2eKgPerKg !== null && (
                  <Row
                    label="CO2e factor"
                    value={`${methodology.factorValues.co2eKgPerKg} kg CO2e per kg`}
                  />
                )}
                {methodology.factorValues.waterLPerKg !== null && (
                  <Row
                    label="Water factor"
                    value={`${methodology.factorValues.waterLPerKg} litres per kg`}
                  />
                )}
                {methodology.factorValues.landM2PerKg !== null && (
                  <Row
                    label="Land factor"
                    value={`${methodology.factorValues.landM2PerKg} m² per kg`}
                  />
                )}
              </dl>
            )}

            {methodology.isProxy && methodology.proxyNote && (
              <div className="bg-paper-sunken rounded-card mt-4 p-3">
                <p className="text-xs font-semibold">This is a proxy factor</p>
                <p className="text-slate mt-1 text-xs leading-relaxed">{methodology.proxyNote}</p>
              </div>
            )}

            {methodology.url && (
              <a
                href={methodology.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-clay-ink mt-4 inline-block text-sm underline"
              >
                Check the source →
              </a>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2">
      <dt className="text-slate text-xs">{label}</dt>
      <dd className="text-right text-xs font-medium">{value}</dd>
    </div>
  );
}
