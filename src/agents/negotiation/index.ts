import { z } from 'zod';
import { THRESHOLDS, type ItemCategory } from '@/lib/domain';
import { callStructured, fixtureMeta } from '@/lib/llm';
import { formatIst, type Window } from '@/lib/hours';
import { formatHoursLeft, formatMass } from '@/lib/units';
import { toolsFor } from '@/agents/registry';
import type { Agent, AgentContext, AgentResult, ToolCallRecord } from '@/agents/types';
import {
  describeIneligibility,
  rankCandidates,
  type CandidateInput,
  type ScoredCandidate,
  type ScoringContext,
} from '@/agents/negotiation/scoring';

/**
 * Negotiation Agent — the core mechanic.
 *
 * Three steps, one per orchestrator transition, so the exchange stays visible turn by turn and no
 * single call runs long enough to be killed mid-flight:
 *   rank      pick a recipient deterministically, then have the model word the "why"
 *   offer     draft what the donor side actually says
 *   evaluate  judge a counter against the freshness deadline: accept, counter once, or move on
 */

export type NegotiationInput =
  | {
      step: 'rank';
      candidates: readonly CandidateInput[];
      context: ScoringContext;
      itemSummary: string;
    }
  | {
      step: 'offer';
      itemSummary: string;
      quantityKg: number;
      orgName: string;
      distanceKm: number;
      freshnessDeadlineAt: Date;
      windows: Window[];
      isRevisedOffer: boolean;
    }
  | {
      step: 'evaluate';
      counter: {
        altWindow?: Window | undefined;
        partialQtyKg?: number | undefined;
        reason?: string | undefined;
        message: string;
      };
      orgName: string;
      quantityKg: number;
      freshnessDeadlineAt: Date;
      escalationsSoFar: number;
      hasNextCandidate: boolean;
      now: Date;
    };

export type RankOutput = {
  ranked: ScoredCandidate[];
  chosen: ScoredCandidate | null;
  justification: string;
};

export type OfferOutput = { message: string };

export type EvaluateDecision =
  | { action: 'ACCEPT'; acceptedQtyKg: number; window?: Window | undefined; message: string }
  | { action: 'COUNTER'; window?: Window | undefined; message: string }
  | { action: 'ESCALATE'; message: string }
  | { action: 'COMPOST'; message: string };

export type NegotiationOutput = RankOutput | OfferOutput | EvaluateDecision;

const justificationSchema = z.object({
  justification: z
    .string()
    .min(10)
    .max(280)
    .describe('At most 45 words naming the factors that decided it, in plain language'),
});

const offerSchema = z.object({
  message: z
    .string()
    .min(10)
    .max(500)
    .describe('The outreach message, two or three sentences, as a person would type it'),
});

const NEGOTIATION_SYSTEM = `You are ReLoop's Negotiation Agent, acting for a household with surplus food in Lucknow.

You write on the household's behalf to food recovery organisations. You are brief, concrete and
respectful of the recipient's time — they are volunteers between jobs, not customers.

Always lead with the facts that decide whether they can help: what it is, how much, how long it
stays good, and how far away it is. Never oversell, never guilt, never pad. Do not mention being
an AI. Do not invent details you were not given.`;

/** Words the justification without letting the model change the outcome. */
function templateJustification(chosen: ScoredCandidate, runnerUp: ScoredCandidate | null): string {
  const distance = `${chosen.distanceKm.toFixed(1)} km`;

  if (!runnerUp) {
    return `${chosen.orgName} is the only match that can take this in time — ${distance} away with room to spare today.`;
  }

  if (!runnerUp.eligible && runnerUp.rejectedReason) {
    return `Picked ${chosen.orgName} (${distance}) because ${runnerUp.orgName} ${describeIneligibility(runnerUp.rejectedReason)}.`;
  }

  const headroomRatio =
    runnerUp.subScores.capacityHeadroom > 0
      ? chosen.subScores.capacityHeadroom / runnerUp.subScores.capacityHeadroom
      : 0;

  if (headroomRatio >= 1.5) {
    return `Picked ${chosen.orgName} (${distance}) over ${runnerUp.orgName}: more capacity left today and open across the whole window.`;
  }

  if (chosen.distanceKm < runnerUp.distanceKm) {
    return `Picked ${chosen.orgName} — ${distance} against ${runnerUp.distanceKm.toFixed(1)} km for ${runnerUp.orgName}, with similar capacity.`;
  }

  return `Picked ${chosen.orgName} (${distance}) over ${runnerUp.orgName} on the better overall fit of timing, capacity and category.`;
}

function templateOffer(input: Extract<NegotiationInput, { step: 'offer' }>): string {
  const mass = formatMass(input.quantityKg);
  const times =
    input.windows.length > 0
      ? input.windows.map((w) => formatIst(w.start)).join(' or ')
      : 'any time that suits you';

  const lead = input.isRevisedOffer
    ? `Understood — revising to fit your side.`
    : `Hello ${input.orgName},`;

  return `${lead} A household ${input.distanceKm.toFixed(1)} km from you has ${mass} of ${input.itemSummary} going spare. It stays good until ${formatIst(input.freshnessDeadlineAt)}. Could someone collect at ${times}?`;
}

export const negotiationAgent: Agent<NegotiationInput, NegotiationOutput> = {
  id: 'negotiation',
  displayName: 'Negotiation',
  tools: toolsFor('negotiation'),

  async run(
    input: NegotiationInput,
    _ctx: AgentContext
  ): Promise<AgentResult<NegotiationOutput>> {
    const startedAt = Date.now();

    if (input.step === 'rank') {
      const ranked = rankCandidates(input.candidates, input.context);
      const eligible = ranked.filter((c) => c.eligible);
      const chosen = eligible[0] ?? null;
      const runnerUp = ranked[1] ?? null;

      const toolCalls: ToolCallRecord[] = [
        {
          name: 'rank_recipients',
          input: {
            candidateCount: input.candidates.length,
            category: input.context.category,
            quantityKg: input.context.quantityKg,
          },
          output: ranked.map((c) => ({
            orgName: c.orgName,
            score: c.score,
            eligible: c.eligible,
            rejectedReason: c.rejectedReason ?? null,
          })),
          latencyMs: Date.now() - startedAt,
        },
      ];

      if (!chosen) {
        const reasons = ranked
          .map((c) => (c.rejectedReason ? `${c.orgName} ${describeIneligibility(c.rejectedReason)}` : null))
          .filter((r): r is string => r !== null)
          .slice(0, 2);

        return {
          output: { ranked, chosen: null, justification: '' },
          rationale:
            reasons.length > 0
              ? `No one nearby can take this: ${reasons.join('; ')}. Routing to compost instead.`
              : 'No recipient within range can take this. Routing to compost instead.',
          toolCalls,
          meta: { ...fixtureMeta('deterministic'), latencyMs: Date.now() - startedAt },
          fallback: 'no_eligible_recipient',
        };
      }

      // The choice is already made. The model only words it.
      const call = await callStructured({
        system: NEGOTIATION_SYSTEM,
        prompt: `You have selected ${chosen.orgName} for ${formatMass(input.context.quantityKg)} of ${input.itemSummary}.

Scores that decided it (0-1): proximity ${chosen.subScores.proximity}, category fit ${chosen.subScores.categoryFit}, capacity headroom ${chosen.subScores.capacityHeadroom}, timing fit ${chosen.subScores.timingFit}. Distance ${chosen.distanceKm.toFixed(1)} km.
${
  runnerUp
    ? `Next best was ${runnerUp.orgName}${
        runnerUp.eligible
          ? ` (proximity ${runnerUp.subScores.proximity}, capacity headroom ${runnerUp.subScores.capacityHeadroom}, ${runnerUp.distanceKm.toFixed(1)} km)`
          : ` but it ${runnerUp.rejectedReason ? describeIneligibility(runnerUp.rejectedReason) : 'was not eligible'}`
      }.`
    : 'There was no other viable option.'
}

Explain the choice to the household in at most 45 words. Name the deciding factors. Do not restate the numbers as numbers.`,
        schema: justificationSchema,
        schemaName: 'record_justification',
        schemaDescription: 'Explain why this recipient was chosen.',
        maxTokens: 300,
        fixture: () => ({ justification: templateJustification(chosen, runnerUp) }),
      });

      return {
        output: { ranked, chosen, justification: call.value.justification },
        rationale: call.value.justification,
        toolCalls,
        meta: call.meta,
      };
    }

    if (input.step === 'offer') {
      const call = await callStructured({
        system: NEGOTIATION_SYSTEM,
        prompt: `Write to ${input.orgName}.

- Item: ${input.itemSummary}
- Quantity: ${formatMass(input.quantityKg)}
- Good until: ${formatIst(input.freshnessDeadlineAt)}
- Distance from them: ${input.distanceKm.toFixed(1)} km
- Collection times you can offer: ${input.windows.map((w) => formatIst(w.start)).join(', ') || 'flexible'}
${input.isRevisedOffer ? '- This is a revised offer after they came back with a constraint. Acknowledge that briefly.' : ''}

Two or three sentences. End with a direct question about collection.`,
        schema: offerSchema,
        schemaName: 'record_outreach',
        schemaDescription: 'The outreach message sent to the recipient.',
        maxTokens: 400,
        fixture: () => ({ message: templateOffer(input) }),
      });

      return {
        output: { message: call.value.message },
        rationale: `Offered ${formatMass(input.quantityKg)} to ${input.orgName}, ${input.distanceKm.toFixed(1)} km away.`,
        toolCalls: [
          {
            name: 'send_offer',
            input: { orgName: input.orgName, quantityKg: input.quantityKg },
            output: { delivered: true },
            latencyMs: Date.now() - startedAt,
          },
        ],
        meta: call.meta,
      };
    }

    // --- evaluate: deterministic, because a deadline is not a matter of opinion. ---
    const { counter, freshnessDeadlineAt, quantityKg } = input;

    const windowIsUsable =
      !counter.altWindow || counter.altWindow.end.getTime() <= freshnessDeadlineAt.getTime();

    const partial = counter.partialQtyKg ?? null;
    const partialIsWorthIt = partial === null || partial >= quantityKg * 0.4;

    const decide = (): EvaluateDecision => {
      if (!windowIsUsable) {
        const hoursOver =
          ((counter.altWindow?.end.getTime() ?? 0) - freshnessDeadlineAt.getTime()) / 3_600_000;
        if (input.hasNextCandidate && input.escalationsSoFar < THRESHOLDS.MAX_ESCALATIONS) {
          return {
            action: 'ESCALATE',
            message: `${input.orgName}'s time is ${formatHoursLeft(hoursOver)} past the safe window — trying the next recipient.`,
          };
        }
        return {
          action: 'COMPOST',
          message: `${input.orgName} cannot make it in time and there is nobody else in range — diverting to compost so it does not go to landfill.`,
        };
      }

      if (!partialIsWorthIt) {
        if (input.hasNextCandidate && input.escalationsSoFar < THRESHOLDS.MAX_ESCALATIONS) {
          return {
            action: 'ESCALATE',
            message: `${input.orgName} can only take ${formatMass(partial ?? 0)} of ${formatMass(quantityKg)} — asking the next recipient for the whole lot.`,
          };
        }
      }

      const accepted = partial ?? quantityKg;
      return {
        action: 'ACCEPT',
        acceptedQtyKg: accepted,
        window: counter.altWindow,
        message:
          partial !== null && partial < quantityKg
            ? `Taking ${input.orgName}'s offer of ${formatMass(accepted)}${counter.altWindow ? ` at ${formatIst(counter.altWindow.start)}` : ''} — inside the safe window, so it is worth it.`
            : `${input.orgName}'s time works${counter.altWindow ? ` (${formatIst(counter.altWindow.start)})` : ''} and it is inside the safe window — agreed.`,
      };
    };

    const decision = decide();

    return {
      output: decision,
      rationale: decision.message,
      toolCalls: [
        {
          name:
            decision.action === 'ACCEPT'
              ? 'accept_terms'
              : decision.action === 'ESCALATE'
                ? 'escalate_to_next_candidate'
                : decision.action === 'COMPOST'
                  ? 'fallback_to_compost'
                  : 'evaluate_counter',
          input: {
            altWindowEnd: counter.altWindow?.end.toISOString() ?? null,
            partialQtyKg: partial,
            deadline: freshnessDeadlineAt.toISOString(),
          },
          output: { action: decision.action, windowIsUsable, partialIsWorthIt },
          latencyMs: Date.now() - startedAt,
        },
      ],
      meta: { ...fixtureMeta('deterministic'), latencyMs: Date.now() - startedAt },
    };
  },
};

/** Re-exported for the orchestrator's benefit; the scoring module stays the source of truth. */
export type { CandidateInput, ScoredCandidate, ScoringContext };
export { rankCandidates };
export type { ItemCategory };
