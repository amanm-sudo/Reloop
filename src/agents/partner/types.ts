import type { OperatingHours, Window } from '@/lib/hours';
import type { ItemCategory } from '@/lib/domain';

/**
 * The counterparty's side of the exchange.
 *
 * Note what an `Offer` contains and, more importantly, what it does not. There is no candidate
 * ranking, no sub-scores, no donor-side reasoning, and no indication that other recipients were
 * considered. The Partner Agent sees only what a real organisation would see in a message.
 *
 * That information asymmetry is the project's central claim. Widening this type to "help" the
 * partner decide would quietly turn the negotiation into a monologue.
 */

export type Offer = {
  matchId: string;
  itemSummary: string;
  category: ItemCategory;
  quantityKg: number;
  isCooked: boolean;
  /** How long the food stays safe — the partner's own hard constraint too. */
  freshnessDeadlineAt: Date;
  proposedWindows: Window[];
  distanceKm: number;
  /** Round of the exchange, so the partner knows whether this is a revised offer. */
  turn: number;
  /** Set when the donor side has already moved once in response to a counter. */
  isRevisedOffer: boolean;
};

/** The partner's own state. Its capacity and hours, never the donor's view of them. */
export type PartnerState = {
  recipientId: string;
  orgName: string;
  orgType: string;
  acceptedCategories: readonly ItemCategory[];
  coldChainCapable: boolean;
  dailyCapacityKg: number;
  capacityUsedTodayKg: number;
  operatingHours: readonly OperatingHours[];
  /** Behavioural disposition from the seeded persona, e.g. capacity-constrained after 4 PM. */
  disposition?: string | undefined;
};

export type PartnerDecisionKind = 'ACCEPT' | 'COUNTER' | 'DECLINE' | 'PENDING';

export type PartnerDecision = {
  kind: PartnerDecisionKind;
  /** What the partner actually says. Rendered verbatim in the transcript and the replay view. */
  message: string;
  /** COUNTER only: a different time that suits them. */
  altWindow?: Window | undefined;
  /** COUNTER only: they can take some of it but not all. */
  partialQtyKg?: number | undefined;
  /** DECLINE and COUNTER: the operational reason, in their words. */
  reason?: string | undefined;
};

export type PartnerInput = {
  offer: Offer;
  state: PartnerState;
  now: Date;
};
