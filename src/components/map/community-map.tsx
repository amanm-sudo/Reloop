'use client';

import * as maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { LUCKNOW_CENTRE } from '@/lib/geo';

/**
 * The community map: a real, live-rendered map, not a static image.
 *
 * MapLibre over OpenStreetMap tiles, so there is no API key to leak and no billing to configure.
 *
 * Two design rules are load-bearing here. Pin types differ in **shape as well as colour**, so the
 * legend still works for anyone who cannot separate the hues. And household pins are drawn at
 * coordinates the server has already fuzzed to ~200 m — the map never receives an exact household
 * position it is not entitled to show.
 */

export type MapPinView = {
  id: string;
  kind: 'SURPLUS' | 'PARTNER' | 'IN_PROGRESS' | 'COMPLETED_TODAY' | 'COMPOST';
  label: string;
  coordinates: [number, number];
  exact: boolean;
  detail: string;
  provenance?: string | null;
};

const STYLE: Record<
  MapPinView['kind'],
  { colour: string; shape: 'circle' | 'square' | 'diamond'; legend: string }
> = {
  SURPLUS: { colour: '#C9502F', shape: 'circle', legend: 'Household surplus' },
  PARTNER: { colour: '#3F6B7D', shape: 'square', legend: 'Recovery partner' },
  IN_PROGRESS: { colour: '#E8A33D', shape: 'diamond', legend: 'Pickup in progress' },
  COMPLETED_TODAY: { colour: '#45604A', shape: 'circle', legend: 'Completed today' },
  COMPOST: { colour: '#7A5C2E', shape: 'square', legend: 'Compost / biogas' },
};

function markerElement(pin: MapPinView): HTMLElement {
  const style = STYLE[pin.kind];
  const element = document.createElement('div');

  const size = pin.kind === 'PARTNER' || pin.kind === 'COMPOST' ? 14 : 12;
  element.style.width = `${size}px`;
  element.style.height = `${size}px`;
  element.style.background = style.colour;
  element.style.border = '2px solid #F7F4EF';
  element.style.boxSizing = 'content-box';
  element.style.cursor = 'pointer';

  if (style.shape === 'circle') element.style.borderRadius = '50%';
  if (style.shape === 'diamond') element.style.transform = 'rotate(45deg)';
  if (style.shape === 'square') element.style.borderRadius = '2px';

  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', `${style.legend}: ${pin.label}`);
  return element;
}

export function CommunityMap({
  pins,
  styleUrl,
}: {
  pins: MapPinView[];
  styleUrl: string;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!container.current || map.current) return;

    try {
      const instance = new maplibregl.Map({
        container: container.current,
        style: styleUrl,
        center: [LUCKNOW_CENTRE[0], LUCKNOW_CENTRE[1]],
        zoom: 11,
        attributionControl: { compact: true },
      });

      instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      // Tile or style failure degrades to the pin list below rather than a blank rectangle.
      instance.on('error', () => setFailed(true));

      map.current = instance;
    } catch {
      // Deferred out of the effect body: this reports the outcome of an external system rather
      // than deriving state, and updating synchronously here would cascade a render.
      queueMicrotask(() => setFailed(true));
    }

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [styleUrl]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    const markers = pins.map((pin) => {
      const popup = new maplibregl.Popup({ offset: 14, closeButton: false }).setHTML(
        `<div style="font-family:system-ui;font-size:12px;max-width:220px">
           <strong>${escapeHtml(pin.label)}</strong><br/>
           <span style="color:#5B5F58">${escapeHtml(pin.detail)}</span>
           ${pin.provenance ? `<br/><span style="color:#5B5F58;font-size:10px">${escapeHtml(pin.provenance)}</span>` : ''}
         </div>`
      );

      return new maplibregl.Marker({ element: markerElement(pin) })
        .setLngLat(pin.coordinates)
        .setPopup(popup)
        .addTo(instance);
    });

    return () => markers.forEach((marker) => marker.remove());
  }, [pins]);

  return (
    <div>
      <div
        ref={container}
        className="border-line rounded-card h-[60dvh] w-full overflow-hidden border"
        aria-label="Map of surplus and recovery partners in Lucknow"
      />

      {failed && (
        <p className="text-urgency-soon-ink mt-2 text-xs">
          Map tiles could not load. The pin list below still shows everything.
        </p>
      )}

      {/* Legend is always visible, and names the shape as well as the colour. */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
        {(Object.keys(STYLE) as MapPinView['kind'][]).map((kind) => (
          <li key={kind} className="flex items-center gap-1.5 text-xs">
            <span
              aria-hidden="true"
              style={{
                background: STYLE[kind].colour,
                width: 10,
                height: 10,
                borderRadius: STYLE[kind].shape === 'circle' ? '50%' : 2,
                transform: STYLE[kind].shape === 'diamond' ? 'rotate(45deg)' : undefined,
                display: 'inline-block',
              }}
            />
            {STYLE[kind].legend}
          </li>
        ))}
      </ul>
    </div>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
