import type { Types } from 'mongoose';
import type { AgentId } from '@/lib/domain';
import type { AgentContext, AgentToolName, ToolDef } from '@/agents/types';

/**
 * Tool access control.
 *
 * Which agent may do what is declared here and enforced in code — not requested politely in a
 * system prompt. Perception cannot geocode. Logistics cannot message a partner. Impact cannot
 * move a Match forward. The Partner Agent gets exactly three verbs and nothing else, which is
 * what keeps the negotiation honest.
 *
 * This module and the orchestrator are the only two places allowed to know about every agent.
 */

const TOOL_CATALOGUE: Record<AgentToolName, string> = {
  lookup_shelf_life: 'Read cited shelf-life baselines for a category and storage state.',
  lookup_impact_factors: 'Read cited per-kg CO2e, freshwater and land factors for a category.',
  rank_recipients: 'Score nearby recipients on proximity, category fit, capacity and timing.',
  draft_outreach: 'Write the outreach message for a chosen recipient and channel.',
  send_offer: 'Put an offer to the counterparty and record the turn.',
  evaluate_counter: 'Judge a counter-offer against the freshness deadline.',
  accept_terms: 'Agree the counterparty terms and close the exchange.',
  escalate_to_next_candidate: 'Abandon this counterparty and approach the next-ranked one.',
  fallback_to_compost: 'Route the surplus to a compost or biogas partner when nobody can take it.',
  route_matrix: 'Get real road distance and duration between points.',
  propose_windows: 'Generate pickup windows that fit operating hours and the freshness deadline.',
  cluster_nearby_matches: 'Find overlapping pickups for one recipient to combine into a trip.',
  partner_accept: 'As the recipient, accept the offer as stated.',
  partner_counter_offer: 'As the recipient, propose a different time or a partial quantity.',
  partner_decline: 'As the recipient, decline and say why.',
};

const AGENT_TOOL_ACCESS: Record<AgentId, readonly AgentToolName[]> = {
  // A single vision call. No tools by design.
  perception: [],
  prediction: ['lookup_shelf_life'],
  negotiation: [
    'rank_recipients',
    'draft_outreach',
    'send_offer',
    'evaluate_counter',
    'accept_terms',
    'escalate_to_next_candidate',
    'fallback_to_compost',
  ],
  logistics: ['route_matrix', 'propose_windows', 'cluster_nearby_matches'],
  impact: ['lookup_impact_factors'],
  // The counterparty. Three verbs, no visibility into the donor side's reasoning.
  partner: ['partner_accept', 'partner_counter_offer', 'partner_decline'],
};

export function toolsFor(agentId: AgentId): readonly ToolDef[] {
  return AGENT_TOOL_ACCESS[agentId].map((name) => ({ name, description: TOOL_CATALOGUE[name] }));
}

export function mayUse(agentId: AgentId, tool: AgentToolName): boolean {
  return AGENT_TOOL_ACCESS[agentId].includes(tool);
}

/**
 * Guard called at the top of every tool implementation. A violation is programmer error — an
 * agent reaching for a capability it was never granted — so it throws rather than degrading.
 */
export function assertMayUse(agentId: AgentId, tool: AgentToolName): void {
  if (!mayUse(agentId, tool)) {
    throw new Error(
      `[${agentId}] is not permitted to use "${tool}". Tool access is declared in src/agents/registry.ts.`
    );
  }
}

export function makeContext(input: {
  agentId: AgentId;
  runId: Types.ObjectId;
  userId: Types.ObjectId;
  matchId?: Types.ObjectId | undefined;
  causedBy?: Types.ObjectId | undefined;
  now?: () => Date;
}): AgentContext {
  return {
    runId: input.runId,
    userId: input.userId,
    matchId: input.matchId,
    causedBy: input.causedBy,
    tools: toolsFor(input.agentId),
    now: input.now ?? (() => new Date()),
  };
}

/** Everything the README architecture section needs, read from the source of truth. */
export function describeAccess(): Array<{ agentId: AgentId; tools: AgentToolName[] }> {
  return (Object.keys(AGENT_TOOL_ACCESS) as AgentId[]).map((agentId) => ({
    agentId,
    tools: [...AGENT_TOOL_ACCESS[agentId]],
  }));
}
