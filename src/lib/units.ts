/**
 * Mass normalisation.
 *
 * Everything downstream — capacity checks, impact maths, offer wording — uses kilograms. Display
 * keeps whatever unit the user or the receipt actually used.
 */

export const SUPPORTED_UNITS = ['g', 'kg', 'ml', 'l', 'pcs', 'packs', 'servings'] as const;
export type SupportedUnit = (typeof SUPPORTED_UNITS)[number];

export function isSupportedUnit(value: string): value is SupportedUnit {
  return (SUPPORTED_UNITS as readonly string[]).includes(value);
}

export type MassResult = {
  quantityKg: number;
  /** How the figure was derived, so the UI can be honest about precision. */
  basis: 'exact' | 'volume-assumed-water-density' | 'estimated-mass';
};

/**
 * `estimatedMassG` is the Perception Agent's own estimate of total mass, used for count-based
 * units where no conversion exists. It is an extraction estimate carried with a confidence
 * score, not a cited constant — that distinction is preserved in `basis` and surfaced in the UI.
 */
export function toKg(
  quantity: number,
  unit: string,
  estimatedMassG?: number | null
): MassResult | null {
  if (!Number.isFinite(quantity) || quantity < 0) return null;

  switch (unit) {
    case 'kg':
      return { quantityKg: quantity, basis: 'exact' };
    case 'g':
      return { quantityKg: quantity / 1000, basis: 'exact' };
    // 1 ml treated as 1 g. True for water and close enough for milk, curd and gravies; it would
    // be wrong for oil (~0.92) and is noted rather than silently corrected.
    case 'l':
      return { quantityKg: quantity, basis: 'volume-assumed-water-density' };
    case 'ml':
      return { quantityKg: quantity / 1000, basis: 'volume-assumed-water-density' };
    case 'pcs':
    case 'packs':
    case 'servings': {
      if (estimatedMassG == null || !Number.isFinite(estimatedMassG) || estimatedMassG <= 0) {
        return null;
      }
      return { quantityKg: estimatedMassG / 1000, basis: 'estimated-mass' };
    }
    default:
      return null;
  }
}

/** Human-readable mass for offer messages and the feed. */
export function formatMass(quantityKg: number): string {
  if (quantityKg < 1) return `${Math.round(quantityKg * 1000)} g`;
  return `${quantityKg.toFixed(quantityKg < 10 ? 1 : 0)} kg`;
}

export function formatHoursLeft(hours: number): string {
  if (hours <= 0) return 'past its window';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)} days`;
}
