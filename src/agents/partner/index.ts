import { z } from 'zod';
import { callChoice, fixtureMeta } from '@/lib/llm';
import { formatIst } from '@/lib/hours';
import { formatMass } from '@/lib/units';
import { toolsFor } from '@/agents/registry';
import type { Agent, AgentContext, AgentResult } from '@/agents/types';
import { decideAsPartner } from '@/agents/partner/policy';
import type { PartnerDecision, PartnerInput } from '@/agents/partner/types';

/**
 * The Partner Agent — the recipient side of the exchange.
 *
 * A genuinely separate mind. Its own system prompt, built from this organisation's persona; its
 * own three verbs and nothing else; and no access whatsoever to the donor side's candidate
 * ranking, sub-scores, or reasoning. Collapsing this into the Negotiation Agent's context would
 * be simpler and would also destroy the only thing that makes the negotiation real.
 *
 * Two implementations behind one contract:
 *   - simulated  — this file, reasoning from the seeded persona
 *   - telegram   — a real human on inline buttons (src/agents/partner/telegram.ts)
 * The orchestrator cannot tell which is answering, which is what lets the demo be reliable and
 * the production path be genuine.
 */

const acceptSchema = z.object({
  message: z.string().min(1).max(400).describe('What you say back, in your own voice'),
});

const counterSchema = z.object({
  message: z.string().min(1).max(400),
  reason: z.string().max(120).describe('Short operational reason, e.g. timing, partial-capacity'),
  altStartIso: z
    .string()
    .optional()
    .describe('ISO timestamp for a collection time that suits you, if timing is the problem'),
  partialQtyKg: z
    .number()
    .positive()
    .optional()
    .describe('How much you can actually take, if you cannot take all of it'),
});

const declineSchema = z.object({
  message: z.string().min(1).max(400),
  reason: z.string().max(120),
});

function systemPromptFor(input: PartnerInput): string {
  const { state } = input;
  const headroom = Math.max(0, state.dailyCapacityKg - state.capacityUsedTodayKg);

  return `You are the coordinator for ${state.orgName}, a ${state.orgType.toLowerCase().replace(/_/g, ' ')} in Lucknow. Someone's household surplus has just been offered to you.

Your situation right now:
- Categories you can handle: ${state.acceptedCategories.join(', ')}
- Cold storage: ${state.coldChainCapable ? 'yes' : 'none'}
- Capacity left today: ${headroom.toFixed(1)} kg of ${state.dailyCapacityKg} kg
- Opening hours (IST): ${state.operatingHours.map((h) => `day ${h.day} ${h.open}-${h.close}`).join('; ')}
${state.disposition ? `- How you operate: ${state.disposition}` : ''}

Decide as a real coordinator would. You are not trying to be agreeable — accepting food you
cannot store, collect, or serve in time wastes it just as surely as a bin does. Counter when a
different time or a smaller amount would actually work. Decline when it genuinely will not.

Speak plainly, one or two sentences, the way someone types a reply between jobs. Do not mention
being an AI, do not thank them effusively, and do not explain your reasoning at length.`;
}

function offerPrompt(input: PartnerInput): string {
  const { offer } = input;
  const windows =
    offer.proposedWindows.length > 0
      ? offer.proposedWindows.map((w) => formatIst(w.start)).join(', ')
      : 'no specific time suggested';

  return `Offer${offer.isRevisedOffer ? ' (revised after your last reply)' : ''}:

- ${offer.itemSummary}
- Quantity: ${formatMass(offer.quantityKg)}
- ${offer.isCooked ? 'Already cooked' : 'Raw / unprepared'}
- Safe until: ${formatIst(offer.freshnessDeadlineAt)}
- Distance from you: ${offer.distanceKm.toFixed(1)} km
- Times suggested: ${windows}

Accept, counter, or decline.`;
}

/** Turns a validated tool choice back into the shared decision shape. */
function decisionFromChoice(tool: string, input: unknown, offer: PartnerInput['offer']): PartnerDecision {
  if (tool === 'accept') {
    const parsed = acceptSchema.parse(input);
    return { kind: 'ACCEPT', message: parsed.message };
  }

  if (tool === 'counter_offer') {
    const parsed = counterSchema.parse(input);
    let altWindow: PartnerDecision['altWindow'];
    if (parsed.altStartIso) {
      const start = new Date(parsed.altStartIso);
      // A counter proposing a time past the deadline is not usable; drop the window and let the
      // Negotiation Agent judge the rest of the counter on its merits.
      if (!Number.isNaN(start.getTime()) && start.getTime() < offer.freshnessDeadlineAt.getTime()) {
        altWindow = { start, end: new Date(start.getTime() + 30 * 60_000) };
      }
    }
    return {
      kind: 'COUNTER',
      message: parsed.message,
      reason: parsed.reason,
      altWindow,
      partialQtyKg: parsed.partialQtyKg,
    };
  }

  const parsed = declineSchema.parse(input);
  return { kind: 'DECLINE', message: parsed.message, reason: parsed.reason };
}

export const simulatedPartnerAgent: Agent<PartnerInput, PartnerDecision> = {
  id: 'partner',
  displayName: 'Partner',
  tools: toolsFor('partner'),

  async run(input: PartnerInput, _ctx: AgentContext): Promise<AgentResult<PartnerDecision>> {
    const startedAt = Date.now();

    const call = await callChoice({
      system: systemPromptFor(input),
      prompt: offerPrompt(input),
      tools: [
        {
          name: 'accept',
          description: 'Take the offer as stated.',
          schema: acceptSchema,
        },
        {
          name: 'counter_offer',
          description: 'Propose a different collection time, a smaller quantity, or both.',
          schema: counterSchema,
        },
        {
          name: 'decline',
          description: 'Turn it down, with the operational reason.',
          schema: declineSchema,
        },
      ],
      // In demo mode the decision comes from this organisation's own rule, computed from its own
      // capacity and hours. Real decision, templated wording.
      fixture: () => {
        const decision = decideAsPartner(input);
        if (decision.kind === 'ACCEPT') {
          return { tool: 'accept', input: { message: decision.message } };
        }
        if (decision.kind === 'COUNTER') {
          return {
            tool: 'counter_offer',
            input: {
              message: decision.message,
              reason: decision.reason ?? 'timing',
              ...(decision.altWindow ? { altStartIso: decision.altWindow.start.toISOString() } : {}),
              ...(decision.partialQtyKg ? { partialQtyKg: decision.partialQtyKg } : {}),
            },
          };
        }
        return {
          tool: 'decline',
          input: { message: decision.message, reason: decision.reason ?? 'unavailable' },
        };
      },
    });

    const decision = decisionFromChoice(call.tool, call.input, input.offer);

    return {
      output: decision,
      rationale: `${input.state.orgName}: ${decision.message}`,
      toolCalls: [
        {
          name:
            decision.kind === 'ACCEPT'
              ? 'partner_accept'
              : decision.kind === 'COUNTER'
                ? 'partner_counter_offer'
                : 'partner_decline',
          input: { turn: input.offer.turn, quantityKg: input.offer.quantityKg },
          output: { kind: decision.kind, reason: decision.reason ?? null },
          latencyMs: Date.now() - startedAt,
        },
      ],
      meta: call.meta.fixture ? { ...fixtureMeta('partner-policy') } : call.meta,
    };
  },
};
