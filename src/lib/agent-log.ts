import type { Types } from 'mongoose';
import type { AgentId } from '@/lib/domain';
import { AgentEvent } from '@/models/agent-event';

/**
 * The single way an agent action becomes visible.
 *
 * Every agent step writes exactly one event through here. The `summary` is the plain-language
 * sentence the user reads in the Agent Activity Feed; `detail` is the raw payload, shown only
 * behind a disclosure. `causedBy` links a step to the one that triggered it, which is what the
 * feed draws as its connector line.
 *
 * This helper exists on day one deliberately: an action with no event is invisible to the user,
 * and per the spec an invisible action does not count as having happened.
 */

export type RecordEventInput = {
  runId: Types.ObjectId;
  userId: Types.ObjectId;
  matchId?: Types.ObjectId | undefined;
  agentId: AgentId;
  /** Machine-readable step name, e.g. 'items_extracted', 'counter_evaluated'. */
  kind: string;
  summary: string;
  detail?: unknown;
  causedBy?: Types.ObjectId | undefined;
  latencyMs?: number;
  costUsd?: number;
  fixture?: boolean;
  /** Name the labelled fallback that produced this result, if any. */
  fallback?: string | undefined;
};

export type RecordedEvent = {
  id: Types.ObjectId;
  at: Date;
};

const MAX_SUMMARY_CHARS = 220;

export async function recordEvent(input: RecordEventInput): Promise<RecordedEvent> {
  const summary = input.summary.trim();
  if (summary.length === 0) {
    throw new Error(`agent event for ${input.agentId}/${input.kind} has an empty summary`);
  }

  const doc = await AgentEvent.create({
    runId: input.runId,
    userId: input.userId,
    matchId: input.matchId,
    agentId: input.agentId,
    kind: input.kind,
    summary: summary.slice(0, MAX_SUMMARY_CHARS),
    detail: input.detail ?? undefined,
    causedBy: input.causedBy,
    latencyMs: input.latencyMs ?? 0,
    costUsd: input.costUsd ?? 0,
    fixture: input.fixture ?? false,
    fallback: input.fallback,
    at: new Date(),
  });

  return { id: doc._id, at: doc.at };
}

/** Shape the feed API returns. Deliberately free of model ids and stack traces. */
export type FeedEvent = {
  id: string;
  runId: string;
  matchId: string | null;
  agentId: AgentId;
  kind: string;
  summary: string;
  detail: unknown;
  causedBy: string | null;
  latencyMs: number;
  costUsd: number;
  fixture: boolean;
  fallback: string | null;
  at: string;
};

export async function listFeed(
  userId: Types.ObjectId,
  options: { limit?: number; since?: Date; runId?: Types.ObjectId } = {}
): Promise<FeedEvent[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);

  const filter: Record<string, unknown> = { userId };
  if (options.runId) filter.runId = options.runId;
  if (options.since) filter.at = { $gt: options.since };

  const docs = await AgentEvent.find(filter).sort({ at: -1 }).limit(limit).lean();

  return docs.map((d) => ({
    id: String(d._id),
    runId: String(d.runId),
    matchId: d.matchId ? String(d.matchId) : null,
    agentId: d.agentId as AgentId,
    kind: d.kind,
    summary: d.summary,
    detail: d.detail ?? null,
    causedBy: d.causedBy ? String(d.causedBy) : null,
    latencyMs: d.latencyMs,
    costUsd: d.costUsd,
    fixture: d.fixture,
    fallback: d.fallback ?? null,
    at: d.at.toISOString(),
  }));
}
