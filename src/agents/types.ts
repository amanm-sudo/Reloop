import type { Types } from 'mongoose';
import type { AgentId } from '@/lib/domain';
import type { LlmMeta } from '@/lib/llm';

/**
 * One interface, five agents. Uniformity is what makes the activity feed, the audit log, the
 * cost accounting and the fixture fallback work identically for all of them — and it means
 * adding a sixth agent is implementing this and registering a transition, nothing else.
 *
 * See .kiro/steering/agent-architecture.md for the invariants this shape exists to protect.
 */

export type AgentToolName =
  | 'lookup_shelf_life'
  | 'lookup_impact_factors'
  | 'rank_recipients'
  | 'draft_outreach'
  | 'send_offer'
  | 'evaluate_counter'
  | 'accept_terms'
  | 'escalate_to_next_candidate'
  | 'fallback_to_compost'
  | 'route_matrix'
  | 'propose_windows'
  | 'cluster_nearby_matches'
  | 'partner_accept'
  | 'partner_counter_offer'
  | 'partner_decline';

/** A capability an agent is permitted to use. Scoping is enforced by the registry. */
export type ToolDef = {
  name: AgentToolName;
  description: string;
};

export type ToolCallRecord = {
  name: AgentToolName;
  input: unknown;
  output: unknown;
  latencyMs: number;
};

/**
 * Everything an agent gets from the outside world. Note what is absent: no reference to another
 * agent, and no way to reach one. Coordination is through the Match blackboard only.
 */
export type AgentContext = {
  runId: Types.ObjectId;
  userId: Types.ObjectId;
  matchId?: Types.ObjectId | undefined;
  /** The event this step was caused by, so the feed can draw the causal chain. */
  causedBy?: Types.ObjectId | undefined;
  /** Scoped tool list. An agent may only use what the registry granted it. */
  tools: readonly ToolDef[];
  now: () => Date;
};

export type AgentResult<T> = {
  output: T;
  /** Feed-ready plain language, <= 45 words. This becomes the AgentEvent summary. */
  rationale: string;
  toolCalls: ToolCallRecord[];
  meta: LlmMeta;
  /** Names the labelled fallback that produced this result, if any. Surfaced in the UI. */
  fallback?: string;
};

export type Agent<TIn, TOut> = {
  readonly id: AgentId;
  readonly displayName: string;
  readonly tools: readonly ToolDef[];
  run(input: TIn, ctx: AgentContext): Promise<AgentResult<TOut>>;
};

/** Thrown only for programmer error. Expected failure returns a degraded AgentResult instead. */
export class AgentContractError extends Error {
  constructor(agentId: AgentId, message: string) {
    super(`[${agentId}] ${message}`);
    this.name = 'AgentContractError';
  }
}
