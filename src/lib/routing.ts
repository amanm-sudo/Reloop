import { env } from '@/lib/env';
import { haversineKm, type LngLat } from '@/lib/geo';
import type { RouteMethod } from '@/lib/domain';

/**
 * Distance and duration between two points, with a labelled fallback chain.
 *
 * OSRM over real OpenStreetMap roads, then a route cached at seed time, then straight-line
 * haversine. Whichever answers, the `method` rides along and is displayed — a demo that silently
 * substitutes a crow-flies number for a road distance is lying about a fact judges may check.
 */

export type RouteLeg = {
  distanceKm: number;
  durationMin: number;
  method: RouteMethod;
};

/**
 * Populated by the seed script so a demo works with the routing service unplugged. Keyed on
 * rounded coordinates, which is precise enough (~10 m) to be unambiguous between seeded points.
 */
const routeCache = new Map<string, { distanceKm: number; durationMin: number }>();

function cacheKey(from: LngLat, to: LngLat): string {
  const k = (c: LngLat) => `${c[0].toFixed(4)},${c[1].toFixed(4)}`;
  return `${k(from)}->${k(to)}`;
}

export function primeRouteCache(
  entries: Array<{ from: LngLat; to: LngLat; distanceKm: number; durationMin: number }>
): void {
  for (const entry of entries) {
    routeCache.set(cacheKey(entry.from, entry.to), {
      distanceKm: entry.distanceKm,
      durationMin: entry.durationMin,
    });
  }
}

export function clearRouteCache(): void {
  routeCache.clear();
}

/**
 * Straight-line distance scaled by a road-circuity factor so the fallback is not absurdly
 * optimistic. 1.35 is a widely used urban detour ratio; it is an approximation and the
 * HAVERSINE label says as much rather than dressing it up as a measured road distance.
 */
const CIRCUITY_FACTOR = 1.35;
const URBAN_SPEED_KMH = 18;

export function haversineLeg(from: LngLat, to: LngLat): RouteLeg {
  const straight = haversineKm(from, to);
  const distanceKm = straight * CIRCUITY_FACTOR;
  return {
    distanceKm: round2(distanceKm),
    durationMin: Math.max(1, Math.round((distanceKm / URBAN_SPEED_KMH) * 60)),
    method: 'HAVERSINE',
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const OSRM_TIMEOUT_MS = 4000;

type OsrmResponse = {
  code?: string;
  routes?: Array<{ distance?: number; duration?: number }>;
};

/**
 * One leg, best available method. Never throws: an unreachable router degrades to the cache and
 * then to haversine, because a pickup with an approximate distance beats no pickup at all.
 */
export async function routeLeg(from: LngLat, to: LngLat): Promise<RouteLeg> {
  const cached = routeCache.get(cacheKey(from, to));

  try {
    const base = env().OSRM_BASE_URL.replace(/\/$/, '');
    const url = `${base}/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?overview=false`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);

    let payload: OsrmResponse;
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`OSRM responded ${response.status}`);
      payload = (await response.json()) as OsrmResponse;
    } finally {
      clearTimeout(timer);
    }

    const route = payload.routes?.[0];
    if (payload.code !== 'Ok' || !route?.distance || !route.duration) {
      throw new Error('OSRM returned no usable route');
    }

    const leg: RouteLeg = {
      distanceKm: round2(route.distance / 1000),
      durationMin: Math.max(1, Math.round(route.duration / 60)),
      method: 'OSRM',
    };

    // Warm the cache so a later outage still has a real road distance to serve.
    routeCache.set(cacheKey(from, to), { distanceKm: leg.distanceKm, durationMin: leg.durationMin });
    return leg;
  } catch {
    if (cached) {
      return { ...cached, method: 'CACHED' };
    }
    return haversineLeg(from, to);
  }
}

/** One origin to many destinations. Sequential by design: the public OSRM demo is rate-limited. */
export async function routeMatrix(from: LngLat, destinations: LngLat[]): Promise<RouteLeg[]> {
  const legs: RouteLeg[] = [];
  for (const destination of destinations) {
    legs.push(await routeLeg(from, destination));
  }
  return legs;
}

export function describeMethod(method: RouteMethod): string {
  switch (method) {
    case 'OSRM':
      return 'road distance';
    case 'CACHED':
      return 'cached road distance';
    case 'HAVERSINE':
      return 'straight-line estimate';
  }
}
