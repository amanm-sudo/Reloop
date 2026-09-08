import { createHash } from 'node:crypto';
import { THRESHOLDS } from '@/lib/domain';

/** GeoJSON order: [lng, lat]. Kept explicit because getting it backwards is silent and awful. */
export type LngLat = readonly [number, number];

export type GeoPoint = { type: 'Point'; coordinates: LngLat };

export function point(lng: number, lat: number): GeoPoint {
  return { type: 'Point', coordinates: [lng, lat] };
}

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance. The final, always-available fallback in the routing chain. */
export function haversineKm(a: LngLat, b: LngLat): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;

  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Deterministic ~200 m offset applied to household coordinates in any view the matched recipient
 * is not entitled to.
 *
 * Derived from a stable seed (the item or user id) rather than randomly, so a pin does not jitter
 * between renders — a wandering marker would leak the true position over a few refreshes, which
 * defeats the point.
 */
export function fuzzCoordinates(coordinates: LngLat, seed: string): LngLat {
  const digest = createHash('sha256').update(seed).digest();
  // Two independent values in [0,1) from separate bytes of the digest.
  const angle = ((digest[0] ?? 0) / 256) * 2 * Math.PI;
  const magnitude = Math.sqrt((digest[1] ?? 0) / 256) * THRESHOLDS.LOCATION_FUZZ_M;

  const [lng, lat] = coordinates;
  const metresPerDegLat = 111_320;
  const metresPerDegLng = metresPerDegLat * Math.cos(toRadians(lat));

  const dLat = (magnitude * Math.sin(angle)) / metresPerDegLat;
  const dLng = (magnitude * Math.cos(angle)) / (metresPerDegLng || 1);

  return [round6(lng + dLng), round6(lat + dLat)];
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Serialiser boundary for location privacy. Exact coordinates are released only to the matched
 * recipient once the handoff is agreed; everyone else, including the public map, gets the fuzzed
 * point. Enforced here rather than in a component so a new view cannot forget.
 */
export function releaseCoordinates(input: {
  coordinates: LngLat;
  seed: string;
  viewerIsMatchedRecipient: boolean;
}): { coordinates: LngLat; exact: boolean } {
  if (input.viewerIsMatchedRecipient) {
    return { coordinates: input.coordinates, exact: true };
  }
  return { coordinates: fuzzCoordinates(input.coordinates, input.seed), exact: false };
}

/** Lucknow. Map default centre and the seed dataset's anchor. */
export const LUCKNOW_CENTRE: LngLat = [80.9462, 26.8467];
