import { THRESHOLDS, kindOf, type ItemCategory, type StorageState } from '@/lib/domain';
import { lookupShelfLife } from '@/lib/reference-data';

/**
 * Urgency is a pure function, not a model call.
 *
 * Deterministic and unit-tested so the same item always yields the same act-by time, and so
 * "why is this urgent?" has an answer that does not depend on a sampled token. The model's only
 * job downstream is wording the explanation.
 */

export type UrgencyInput = {
  category: ItemCategory;
  storage: StorageState;
  isCooked: boolean;
  /** When the clock started: prepared time for cooked food, otherwise when it entered ReLoop. */
  startedAt: Date;
  /** A printed date beats any estimate we can make. */
  bestBeforeAt?: Date | null;
  /** MATERIAL items do not spoil; the owner sets the deadline. */
  userDeadlineAt?: Date | null;
  now: Date;
};

export type UrgencyBasis =
  | 'printed-best-before'
  | 'user-deadline'
  | 'shelf-life-table'
  | 'shelf-life-table-cooked';

export type UrgencyOutput = {
  actByAt: Date;
  urgencyScore: number;
  remainingHours: number;
  /** The lead time a recipient needs for this category — what makes the score actionable. */
  actionWindowHours: number;
  basis: UrgencyBasis;
  /** True when the underlying shelf-life row is a category generalisation, not a cited row. */
  lowConfidence: boolean;
  shouldActNow: boolean;
};

const MS_PER_HOUR = 3_600_000;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

export function computeUrgency(input: UrgencyInput): UrgencyOutput {
  const entry = lookupShelfLife(input.category);
  const isMaterial = kindOf(input.category) === 'MATERIAL';

  let deadline: Date;
  let basis: UrgencyBasis;
  let lowConfidence = !entry.verified;

  if (isMaterial && input.userDeadlineAt) {
    deadline = input.userDeadlineAt;
    basis = 'user-deadline';
    // A date the owner set is not an estimate, so table confidence is irrelevant.
    lowConfidence = false;
  } else if (input.bestBeforeAt) {
    deadline = input.bestBeforeAt;
    basis = 'printed-best-before';
    lowConfidence = false;
  } else {
    const baseline = entry.baselineHours[input.storage];
    // A cookedFactor above 1 is meaningful: cooked poultry keeps longer than raw.
    const hours = input.isCooked ? baseline * entry.cookedFactor : baseline;
    deadline = new Date(input.startedAt.getTime() + hours * MS_PER_HOUR);
    basis = input.isCooked ? 'shelf-life-table-cooked' : 'shelf-life-table';
  }

  const remainingHours = (deadline.getTime() - input.now.getTime()) / MS_PER_HOUR;
  const actionWindowHours = entry.actionWindowHours;

  // The score answers "how close is this to the point where a recipient can no longer act?",
  // not "how close is it to spoiling". Those differ by the partner's lead time, which is the
  // whole reason surplus dies uncollected.
  const urgencyScore = clamp01(1 - remainingHours / actionWindowHours);

  return {
    actByAt: deadline,
    urgencyScore,
    remainingHours,
    actionWindowHours,
    basis,
    lowConfidence,
    shouldActNow: urgencyScore >= THRESHOLDS.ACT_NOW,
  };
}
