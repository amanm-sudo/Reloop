import { fixtureMeta } from '@/lib/llm';
import type { LngLat } from '@/lib/geo';
import { haversineKm } from '@/lib/geo';
import { formatIst, proposeWindows, type OperatingHours, type Window } from '@/lib/hours';
import { describeMethod, routeLeg } from '@/lib/routing';
import type { RouteMethod } from '@/lib/domain';
import { toolsFor } from '@/agents/registry';
import type { Agent, AgentContext, AgentResult, ToolCallRecord } from '@/agents/types';

/**
 * Logistics Agent: when, and how far.
 *
 * Distances come from real roads via OSRM where possible, and every figure carries the method
 * that produced it so the UI can say "road distance" or "straight-line estimate" rather than
 * implying a precision it does not have.
 */

export type OtherPickup = {
  matchId: string;
  itemSummary: string;
  donorCoordinates: LngLat;
  window: Window;
};

export type LogisticsInput = {
  donorCoordinates: LngLat;
  recipientCoordinates: LngLat;
  recipientHours: readonly OperatingHours[];
  freshnessDeadlineAt: Date;
  now: Date;
  /** Set once the partner has agreed a specific time; windows are then confirmation, not options. */
  agreedWindow?: Window | undefined;
  /** Other pickups already scheduled for this recipient, for trip combining. */
  otherPickups?: readonly OtherPickup[];
};

export type MultiStopPlan = {
  stops: Array<{ matchId: string; itemSummary: string }>;
  savedKm: number;
};

export type LogisticsOutput = {
  windows: Window[];
  chosen: Window | null;
  distanceKm: number;
  durationMin: number;
  method: RouteMethod;
  multiStop?: MultiStopPlan | undefined;
};

/**
 * Slack before the earliest proposable window, so a volunteer can realistically get there.
 *
 * Scaled to the time actually left rather than fixed: reserving a flat 20 minutes out of a
 * 45-minute runway leaves nothing to offer, and an urgent handoff that could have happened gets
 * composted instead.
 */
function travelSlackMin(runwayMin: number): number {
  return Math.max(5, Math.min(20, Math.floor(runwayMin * 0.2)));
}

function clusterPlan(
  input: LogisticsInput,
  chosen: Window | null,
  legKm: number
): MultiStopPlan | undefined {
  const others = input.otherPickups ?? [];
  if (!chosen || others.length === 0) return undefined;

  // Overlapping means within 90 minutes of the chosen slot — close enough that one volunteer trip
  // can cover both without either pickup slipping.
  const overlapping = others.filter(
    (other) => Math.abs(other.window.start.getTime() - chosen.start.getTime()) <= 90 * 60_000
  );
  if (overlapping.length === 0) return undefined;

  // Separate trips: out and back for each donor. Combined: recipient -> a -> b -> recipient.
  const separateKm =
    legKm * 2 +
    overlapping.reduce(
      (sum, other) => sum + haversineKm(input.recipientCoordinates, other.donorCoordinates) * 2,
      0
    );

  let combinedKm = legKm;
  let cursor = input.donorCoordinates;
  for (const other of overlapping) {
    combinedKm += haversineKm(cursor, other.donorCoordinates);
    cursor = other.donorCoordinates;
  }
  combinedKm += haversineKm(cursor, input.recipientCoordinates);

  const savedKm = Math.round((separateKm - combinedKm) * 10) / 10;
  if (savedKm <= 0.2) return undefined;

  return {
    stops: [
      { matchId: 'this', itemSummary: 'this pickup' },
      ...overlapping.map((o) => ({ matchId: o.matchId, itemSummary: o.itemSummary })),
    ],
    savedKm,
  };
}

export const logisticsAgent: Agent<LogisticsInput, LogisticsOutput> = {
  id: 'logistics',
  displayName: 'Logistics',
  tools: toolsFor('logistics'),

  async run(input: LogisticsInput, _ctx: AgentContext): Promise<AgentResult<LogisticsOutput>> {
    const startedAt = Date.now();
    const toolCalls: ToolCallRecord[] = [];

    const leg = await routeLeg(input.recipientCoordinates, input.donorCoordinates);
    toolCalls.push({
      name: 'route_matrix',
      input: { from: input.recipientCoordinates, to: input.donorCoordinates },
      output: leg,
      latencyMs: Date.now() - startedAt,
    });

    const runwayMin = (input.freshnessDeadlineAt.getTime() - input.now.getTime()) / 60_000;
    const earliest = new Date(input.now.getTime() + travelSlackMin(runwayMin) * 60_000);
    const windows = input.agreedWindow
      ? [input.agreedWindow]
      : proposeWindows({
          hours: input.recipientHours,
          earliest,
          latest: input.freshnessDeadlineAt,
          count: 3,
        });

    toolCalls.push({
      name: 'propose_windows',
      input: { earliest: earliest.toISOString(), latest: input.freshnessDeadlineAt.toISOString() },
      output: { count: windows.length },
      latencyMs: Date.now() - startedAt,
    });

    const chosen = input.agreedWindow ?? windows[0] ?? null;
    const multiStop = clusterPlan(input, chosen, leg.distanceKm);

    if (multiStop) {
      toolCalls.push({
        name: 'cluster_nearby_matches',
        input: { candidates: input.otherPickups?.length ?? 0 },
        output: { stops: multiStop.stops.length, savedKm: multiStop.savedKm },
        latencyMs: Date.now() - startedAt,
      });
    }

    const output: LogisticsOutput = {
      windows,
      chosen,
      distanceKm: leg.distanceKm,
      durationMin: leg.durationMin,
      method: leg.method,
      multiStop,
    };

    const methodLabel = describeMethod(leg.method);

    // Expected failure, not an exception: nobody is open before the food turns.
    if (windows.length === 0) {
      return {
        output,
        rationale: `No collection slot fits before the food turns — ${leg.distanceKm.toFixed(1)} km away by ${methodLabel}.`,
        toolCalls,
        meta: { ...fixtureMeta('deterministic'), latencyMs: Date.now() - startedAt },
        fallback: 'no_viable_window',
      };
    }

    const base = input.agreedWindow
      ? `Pickup set for ${formatIst(chosen?.start ?? input.now)} — ${leg.distanceKm.toFixed(1)} km, about ${leg.durationMin} min by ${methodLabel}.`
      : `Proposed ${windows.length === 1 ? formatIst(windows[0]?.start ?? input.now) : `${windows.length} slots from ${formatIst(windows[0]?.start ?? input.now)}`} — ${leg.distanceKm.toFixed(1)} km, about ${leg.durationMin} min by ${methodLabel}.`;

    const rationale = multiStop
      ? `${base} Combining with ${multiStop.stops.length - 1} nearby pickup${multiStop.stops.length > 2 ? 's' : ''} saves ${multiStop.savedKm} km.`
      : base;

    return {
      output,
      rationale,
      toolCalls,
      meta: { ...fixtureMeta('deterministic'), latencyMs: Date.now() - startedAt },
      // Label the degraded routing method so the number is never mistaken for a measured one.
      ...(leg.method === 'HAVERSINE'
        ? { fallback: 'routing_straight_line' }
        : leg.method === 'CACHED'
          ? { fallback: 'routing_cached' }
          : {}),
    };
  },
};
