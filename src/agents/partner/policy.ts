import { formatIst, isOpenAt, nextOpenAt } from '@/lib/hours';
import { formatMass } from '@/lib/units';
import type { PartnerDecision, PartnerInput } from '@/agents/partner/types';

/**
 * The partner's decision rule, used verbatim in demo mode and as the fixture for the live path.
 *
 * Worth being precise about what is and is not simulated here. The *decision* is real: it is
 * computed from this organisation's own capacity, opening hours and category list, none of which
 * the donor side can see or influence. Only the *wording* is templated. So even with no API key
 * configured, the exchange is a genuine negotiation between two parties with different
 * information — it is not a scripted animation with predetermined turns.
 */

const MS_PER_HOUR = 3_600_000;

export function decideAsPartner(input: PartnerInput): PartnerDecision {
  const { offer, state, now } = input;
  const mass = formatMass(offer.quantityKg);

  if (!state.acceptedCategories.includes(offer.category)) {
    return {
      kind: 'DECLINE',
      reason: 'category-not-handled',
      message: `Thanks, but we are not set up to take this one. Try someone who handles it properly.`,
    };
  }

  const headroomKg = state.dailyCapacityKg - state.capacityUsedTodayKg;

  if (headroomKg <= 0) {
    return {
      kind: 'DECLINE',
      reason: 'at-capacity',
      message: `We are full for today, sorry. Tomorrow morning we would gladly take it, but this will not keep that long.`,
    };
  }

  // Can take some but not all: counter with what actually fits rather than decline outright.
  if (headroomKg < offer.quantityKg) {
    const partial = Math.floor(headroomKg * 10) / 10;
    const window = firstWorkableWindow(input);
    return {
      kind: 'COUNTER',
      reason: 'partial-capacity',
      partialQtyKg: partial,
      altWindow: window ?? undefined,
      message: `We can take ${formatMass(partial)} of the ${mass} — that is all the room we have left today${
        window ? `, and ${formatIst(window.start)} works for our route` : ''
      }.`,
    };
  }

  const openWindow = offer.proposedWindows.find(
    (w) => isOpenAt(state.operatingHours, w.start) && isOpenAt(state.operatingHours, w.end)
  );

  if (openWindow) {
    // Cold food with a long tail and no cold chain is a real refusal, not a quibble.
    const hoursLeft = (offer.freshnessDeadlineAt.getTime() - now.getTime()) / MS_PER_HOUR;
    if (needsColdStorage(offer) && !state.coldChainCapable && hoursLeft > 6) {
      return {
        kind: 'DECLINE',
        reason: 'no-cold-chain',
        message: `We have no cold storage, so we could not hold ${mass} safely between collection and serving.`,
      };
    }

    return {
      kind: 'ACCEPT',
      message: `Yes, we will take ${mass}. ${formatIst(openWindow.start)} suits us — a volunteer is on that route.`,
    };
  }

  // None of the proposed times work. Offer one that does, if there is one before the deadline.
  const alternative = firstWorkableWindow(input);

  if (!alternative) {
    return {
      kind: 'DECLINE',
      reason: 'closed-before-deadline',
      message: `We are closed for the whole time this is still good. We cannot get to it before it turns.`,
    };
  }

  // A partner that has already been met once does not keep haggling.
  if (offer.isRevisedOffer) {
    return {
      kind: 'ACCEPT',
      message: `That works. We will collect ${mass} at ${formatIst(alternative.start)}.`,
    };
  }

  return {
    kind: 'COUNTER',
    reason: 'timing',
    altWindow: alternative,
    message: `None of those times work for us. Can we make it ${formatIst(alternative.start)} instead? That is when our volunteer covers that side.`,
  };
}

function needsColdStorage(offer: { category: string; isCooked: boolean }): boolean {
  return (
    offer.isCooked || offer.category.startsWith('dairy_') || offer.category.startsWith('protein_')
  );
}

function firstWorkableWindow(input: PartnerInput): { start: Date; end: Date } | null {
  const { offer, state, now } = input;
  const horizonHours = Math.max(
    1,
    (offer.freshnessDeadlineAt.getTime() - now.getTime()) / MS_PER_HOUR
  );

  const start = nextOpenAt(state.operatingHours, now, horizonHours);
  if (!start) return null;

  const end = new Date(start.getTime() + 30 * 60_000);
  if (end.getTime() > offer.freshnessDeadlineAt.getTime()) return null;

  return { start, end };
}
