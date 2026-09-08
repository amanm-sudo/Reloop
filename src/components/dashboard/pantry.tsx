'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { formatHoursLeft, formatMass } from '@/lib/units';

/**
 * Pantry list, ordered by how soon each item must move.
 *
 * The urgency bar is the timeline: it answers "what needs attention" at a glance without the user
 * reading a single date. Colour is always paired with a text label, so the ordering and the words
 * carry the meaning on their own.
 */

export type PantryItemView = {
  id: string;
  name: string;
  category: string;
  kind: string;
  quantity: number;
  unit: string;
  quantityKg: number;
  storage: string;
  actByAt: string | null;
  urgencyScore: number | null;
  lowConfidence: boolean;
  needsConfirmation: boolean;
  confidence: number | null;
  state: string;
};

function urgencyBand(score: number | null): {
  label: string;
  bar: string;
  text: string;
} {
  if (score == null) return { label: 'not estimated', bar: 'bg-line', text: 'text-slate' };
  if (score >= 0.9) return { label: 'critical', bar: 'bg-urgency-critical', text: 'text-urgency-critical-ink' };
  if (score >= 0.7) return { label: 'act now', bar: 'bg-urgency-now', text: 'text-urgency-now-ink' };
  if (score >= 0.4) return { label: 'soon', bar: 'bg-urgency-soon', text: 'text-urgency-soon-ink' };
  return { label: 'calm', bar: 'bg-urgency-calm', text: 'text-urgency-calm-ink' };
}

export function Pantry({ items, nowIso }: { items: PantryItemView[]; nowIso: string }) {
  /*
   * The clock is seeded from the server's render time rather than read during the client render.
   * Reading it during render would be non-idempotent and would mismatch on hydration; one interval
   * for the whole list then keeps the countdowns moving.
   */
  const [now, setNow] = useState(() => new Date(nowIso).getTime());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (items.length === 0) {
    return (
      <p className="text-slate border-line rounded-card border border-dashed p-6 text-center text-sm">
        Your pantry is empty. Add something below, or use one of the demo images.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <PantryRow key={item.id} item={item} now={now} />
      ))}
    </ul>
  );
}

function PantryRow({ item, now }: { item: PantryItemView; now: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const band = urgencyBand(item.urgencyScore);

  const hoursLeft = item.actByAt
    ? (new Date(item.actByAt).getTime() - now) / 3_600_000
    : null;

  async function post(path: string, body: unknown) {
    setBusy(true);
    await fetch(path, {
      method: path.endsWith('/runs') ? 'POST' : 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(false);
    startTransition(() => router.refresh());
  }

  const disabled = busy || pending;

  return (
    <li className="border-line bg-paper-raised rounded-card border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <p className="text-slate mt-0.5 text-xs">
            {formatMass(item.quantityKg)} · {item.storage.toLowerCase()}
            {hoursLeft !== null && ` · ${formatHoursLeft(hoursLeft)} left`}
          </p>
        </div>

        <span className={`shrink-0 text-[11px] font-semibold ${band.text}`}>{band.label}</span>
      </div>

      <div
        role="meter"
        aria-valuenow={Math.round((item.urgencyScore ?? 0) * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Urgency for ${item.name}: ${band.label}`}
        className="bg-paper-sunken mt-2 h-1 w-full overflow-hidden rounded-full"
      >
        <div
          className={`h-full ${band.bar}`}
          style={{ width: `${Math.max(3, Math.round((item.urgencyScore ?? 0) * 100))}%` }}
        />
      </div>

      {(item.needsConfirmation || item.lowConfidence) && (
        <p className="text-urgency-soon-ink mt-2 text-xs">
          {item.needsConfirmation
            ? `Read with ${Math.round((item.confidence ?? 0) * 100)}% confidence — confirm it and the agents can act.`
            : 'Shelf life for this category is a generalisation, not a cited row.'}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap gap-2">
        {item.needsConfirmation && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void post(`/api/items/${item.id}`, { confirm: true })}
            className="bg-clay rounded-card px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-60"
          >
            Confirm reading
          </button>
        )}

        {item.state === 'ACTIVE' && !item.needsConfirmation && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void post('/api/runs', { itemId: item.id })}
            className="border-line rounded-card hover:bg-paper-sunken border px-2.5 py-1.5 text-xs font-medium disabled:opacity-60"
          >
            Find a home now
          </button>
        )}

        {item.state === 'ACTIVE' && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void post(`/api/items/${item.id}`, { consumed: true })}
            className="text-slate hover:text-ink px-1 py-1.5 text-xs underline disabled:opacity-60"
          >
            We ate it
          </button>
        )}

        {item.state === 'POSTED' && (
          <span className="text-slate text-xs">Pickup arranged — agents are handling it.</span>
        )}
      </div>
    </li>
  );
}
