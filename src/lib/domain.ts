/**
 * Shared domain vocabulary. Imported by models, agents, and UI alike.
 *
 * The category list is canonical: `data/shelf-life.json` and `data/impact-factors.json` must
 * each cover every entry exactly once, and `src/scripts/verify-sources.ts` fails the build if
 * they do not. That is what stops a category from silently existing without cited data.
 */

export const ITEM_KINDS = ['FOOD', 'MATERIAL'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const STORAGE_STATES = ['PANTRY', 'FRIDGE', 'FREEZER'] as const;
export type StorageState = (typeof STORAGE_STATES)[number];

export const FOOD_CATEGORIES = [
  'produce_leafy_greens',
  'produce_root_vegetables',
  'produce_other_vegetables',
  'produce_tomatoes',
  'produce_onions',
  'produce_potatoes',
  'produce_bananas',
  'produce_citrus',
  'produce_apples',
  'produce_other_fruit',
  'produce_herbs',
  'dairy_milk',
  'dairy_curd',
  'dairy_paneer',
  'dairy_butter_ghee',
  'grains_rice_raw',
  'grains_wheat_flour',
  'grains_bread',
  'grains_roti',
  'pulses_dry',
  'protein_eggs',
  'protein_poultry_raw',
  'protein_fish_raw',
  'cooked_rice_dish',
  'cooked_dal',
  'cooked_curry_veg',
  'cooked_sweets',
  'oils_fats',
  'packaged_dry_goods',
] as const;

export const MATERIAL_CATEGORIES = [
  'material_textiles',
  'material_paper_card',
  'material_household_goods',
] as const;

export const ITEM_CATEGORIES = [...FOOD_CATEGORIES, ...MATERIAL_CATEGORIES] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export function isItemCategory(value: string): value is ItemCategory {
  return (ITEM_CATEGORIES as readonly string[]).includes(value);
}

export function kindOf(category: ItemCategory): ItemKind {
  return (MATERIAL_CATEGORIES as readonly string[]).includes(category) ? 'MATERIAL' : 'FOOD';
}

export const ITEM_STATES = ['ACTIVE', 'CONSUMED', 'POSTED', 'DIVERTED', 'WASTED'] as const;
export type ItemState = (typeof ITEM_STATES)[number];

export const USER_ROLES = ['DONOR', 'RECIPIENT', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ORG_TYPES = [
  'NGO',
  'COMMUNITY_FRIDGE',
  'LANGAR',
  'COMPOST',
  'BIOGAS',
  'NEIGHBOUR',
] as const;
export type OrgType = (typeof ORG_TYPES)[number];

/**
 * Match lifecycle. The orchestrator performs exactly one transition per `advance()` call.
 * Order matters: `MATCH_STATES.indexOf` is used for progress display only, never for control
 * flow — transitions are declared explicitly in the orchestrator.
 */
export const MATCH_STATES = [
  'PERCEIVED',
  'PREDICTED',
  'CANDIDATES_RANKED',
  'OUTREACH_SENT',
  'NEGOTIATING',
  'COUNTERED',
  'AGREED',
  'SCHEDULED',
  'COMPLETED',
  'IMPACT_LOGGED',
  'COMPOST_DIVERTED',
  'FAILED',
] as const;
export type MatchState = (typeof MATCH_STATES)[number];

/**
 * `COMPOST_DIVERTED` is deliberately NOT terminal. A composted outcome still gets an ImpactLog —
 * with the landfill-diversion credit only — so it flows on to `IMPACT_LOGGED`. Ending the run at
 * COMPOST_DIVERTED would leave the one outcome we most need to account for unaccounted.
 */
export const TERMINAL_MATCH_STATES: readonly MatchState[] = ['IMPACT_LOGGED', 'FAILED'];

export function isTerminal(state: MatchState): boolean {
  return TERMINAL_MATCH_STATES.includes(state);
}

export const MATCH_OUTCOMES = ['REDISTRIBUTED', 'COMPOSTED', 'FAILED'] as const;
export type MatchOutcome = (typeof MATCH_OUTCOMES)[number];

/** The five product agents plus the counterparty. */
export const AGENT_IDS = [
  'perception',
  'prediction',
  'negotiation',
  'logistics',
  'impact',
  'partner',
] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const AGENT_DISPLAY_NAMES: Record<AgentId, string> = {
  perception: 'Perception',
  prediction: 'Prediction',
  negotiation: 'Negotiation',
  logistics: 'Logistics',
  impact: 'Impact',
  partner: 'Partner',
};

export const NEGOTIATION_INTENTS = [
  'OFFER',
  'ACCEPT',
  'COUNTER',
  'DECLINE',
  'CONFIRM',
  'ESCALATE',
] as const;
export type NegotiationIntent = (typeof NEGOTIATION_INTENTS)[number];

/** How a distance/duration figure was obtained. Always surfaced in the UI. */
export const ROUTE_METHODS = ['OSRM', 'CACHED', 'HAVERSINE'] as const;
export type RouteMethod = (typeof ROUTE_METHODS)[number];

/** Tunables that the spec pins down. Kept here so tests and agents cannot drift apart. */
export const THRESHOLDS = {
  /** urgencyScore at or above which a negotiation run is enqueued with no human action. */
  ACT_NOW: 0.7,
  /** Extraction confidence below which an item may not trigger autonomous matching. */
  MIN_EXTRACTION_CONFIDENCE: 0.6,
  /** Hard caps on the agent-to-agent exchange. */
  MAX_NEGOTIATION_TURNS: 6,
  MAX_NEGOTIATION_MS: 60_000,
  MAX_ESCALATIONS: 2,
  /** Metres of jitter applied to household coordinates in any non-matched view. */
  LOCATION_FUZZ_M: 200,
} as const;
