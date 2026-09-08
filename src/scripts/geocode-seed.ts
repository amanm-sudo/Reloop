/**
 * Geocodes the seed dataset's places ONCE, at authoring time, and commits the result to
 * `data/seed-lucknow.json`.
 *
 * Two reasons it is a script and not a runtime call. Nominatim's usage policy rules out
 * per-request geocoding, and a demo must not depend on a third-party lookup succeeding while a
 * judge is watching. Committed coordinates are real, reproducible, and offline.
 *
 * Run: npm run geocode:seed
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
// Nominatim requires a real identifying User-Agent and no more than one request per second.
const USER_AGENT = 'ReLoop-hackathon-seed/0.1 (surplus food coordination; contact via repo)';
const DELAY_MS = 1200;

type PlaceQuery = {
  key: string;
  query: string;
  /** What this place stands in for in the seed dataset. */
  role: string;
};

const PLACES: PlaceQuery[] = [
  { key: 'gomti_nagar', query: 'Gomti Nagar, Lucknow, Uttar Pradesh, India', role: 'donor household' },
  { key: 'indira_nagar', query: 'Indira Nagar, Lucknow, Uttar Pradesh, India', role: 'donor household' },
  { key: 'hazratganj', query: 'Hazratganj, Lucknow, Uttar Pradesh, India', role: 'NGO chapter base' },
  { key: 'aishbagh', query: 'Aishbagh, Lucknow, Uttar Pradesh, India', role: 'community fridge' },
  { key: 'alambagh', query: 'Alambagh, Lucknow, Uttar Pradesh, India', role: 'NGO chapter base' },
  { key: 'chinhat', query: 'Chinhat, Lucknow, Uttar Pradesh, India', role: 'canteen / business surplus' },
  {
    key: 'naka_hindola',
    query: 'Naka Hindola, Lucknow, Uttar Pradesh, India',
    role: 'gurdwara langar surplus programme',
  },
  {
    key: 'mohanlalganj',
    query: 'Mohanlalganj, Lucknow, Uttar Pradesh, India',
    role: 'municipal waste processing / compost site (the Shivri plant sits in this block)',
  },
  {
    key: 'faizabad_road',
    query: 'Faizabad Road, Lucknow, Uttar Pradesh, India',
    role: 'biogas partner',
  },
];

type GeocodedPlace = PlaceQuery & {
  lng: number;
  lat: number;
  displayName: string;
};

async function geocode(place: PlaceQuery): Promise<GeocodedPlace | null> {
  const url = `${NOMINATIM}?q=${encodeURIComponent(place.query)}&format=jsonv2&limit=1`;

  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) {
    console.error(`  ✗ ${place.key}: HTTP ${response.status}`);
    return null;
  }

  const results = (await response.json()) as Array<{
    lon?: string;
    lat?: string;
    display_name?: string;
  }>;

  const first = results[0];
  if (!first?.lon || !first.lat) {
    console.error(`  ✗ ${place.key}: no result`);
    return null;
  }

  return {
    ...place,
    lng: Number(Number(first.lon).toFixed(6)),
    lat: Number(Number(first.lat).toFixed(6)),
    displayName: first.display_name ?? place.query,
  };
}

async function main(): Promise<void> {
  console.log(`Geocoding ${PLACES.length} Lucknow places via Nominatim (1 req / ${DELAY_MS}ms)…`);

  const geocoded: GeocodedPlace[] = [];

  for (const place of PLACES) {
    const result = await geocode(place);
    if (result) {
      geocoded.push(result);
      console.log(`  ✓ ${place.key} → ${result.lng}, ${result.lat}`);
    }
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  if (geocoded.length !== PLACES.length) {
    console.error(
      `\n✗ Only ${geocoded.length}/${PLACES.length} places resolved. Not writing a partial file — ` +
        `fix the failing queries and re-run, because a hand-typed coordinate is exactly what this script exists to avoid.`
    );
    process.exit(1);
  }

  const outPath = path.join(process.cwd(), 'data', 'seed-places.json');
  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        source: {
          service: 'Nominatim (OpenStreetMap)',
          url: 'https://nominatim.openstreetmap.org/',
          retrievedAt: new Date().toISOString().slice(0, 10),
          note: 'Geocoded once at authoring time and committed. Coordinates are real localities in Lucknow; the organisations placed at them are modelled on how real recovery networks operate and are not active partnerships.',
        },
        places: geocoded,
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  console.log(`\n✓ Wrote ${geocoded.length} places to data/seed-places.json`);
}

main().catch((cause: unknown) => {
  console.error(cause);
  process.exit(1);
});
