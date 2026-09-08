'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LUCKNOW_CENTRE } from '@/lib/geo';

/**
 * Home location, required before anything can be posted.
 *
 * Every downstream agent depends on coordinates: distance scoring, routing, coverage radius. So
 * this blocks rather than sits in a settings page nobody visits.
 */
export function SetLocation() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(lng: number, lat: number, address?: string) {
    setBusy(true);
    setError(null);

    const response = await fetch('/api/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lng, lat, address }),
    });

    if (!response.ok) {
      setError('Could not save that. Try again.');
      setBusy(false);
      return;
    }

    router.refresh();
  }

  return (
    <section
      aria-labelledby="location-heading"
      className="border-clay/40 bg-clay-soft rounded-card border p-4"
    >
      <h2 id="location-heading" className="text-sm font-semibold">
        Set your location first
      </h2>
      <p className="mt-1 text-sm">
        Distance, routing and which partners can reach you all depend on it. Nothing can be matched
        until it is set.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!('geolocation' in navigator)) {
              setError('This browser cannot share a location. Use the Lucknow option instead.');
              return;
            }
            setBusy(true);
            navigator.geolocation.getCurrentPosition(
              (position) =>
                void save(position.coords.longitude, position.coords.latitude),
              () => {
                setError('Location permission was declined.');
                setBusy(false);
              },
              { timeout: 8000 }
            );
          }}
          className="bg-clay rounded-card px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          Use my current location
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => void save(LUCKNOW_CENTRE[0], LUCKNOW_CENTRE[1], 'Lucknow')}
          className="border-clay/40 rounded-card border bg-white/60 px-3 py-2 text-sm font-medium disabled:opacity-60"
        >
          I am in Lucknow
        </button>
      </div>

      {error && (
        <p role="alert" className="text-urgency-critical-ink mt-2 text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
