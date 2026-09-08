import { fixtureMeta } from '@/lib/llm';
import { lookupShelfLife } from '@/lib/reference-data';
import { formatHoursLeft, formatMass } from '@/lib/units';
import type { ItemCategory } from '@/lib/domain';
import { toolsFor } from '@/agents/registry';
import type { Agent, AgentContext, AgentResult, ToolCallRecord } from '@/agents/types';
import { computeUrgency, type UrgencyInput, type UrgencyOutput } from '@/agents/prediction/urgency';

/**
 * Prediction Agent: how long is left, and how urgently must this move.
 *
 * Entirely deterministic. Its one tool is `lookup_shelf_life` over the cited table, and the
 * wording of the explanation is templated rather than generated — there is no reason to spend a
 * model call, or introduce non-determinism, on a sentence this structured.
 */

export type PredictionInput = UrgencyInput & {
  itemName: string;
  quantityKg: number;
};

export type PredictionOutput = UrgencyOutput & {
  label: string;
};

function summarise(input: PredictionInput, urgency: UrgencyOutput, label: string): string {
  const mass = formatMass(input.quantityKg);
  const left = formatHoursLeft(urgency.remainingHours);
  const pct = Math.round(urgency.urgencyScore * 100);

  if (urgency.remainingHours <= 0) {
    return `${input.itemName} (${mass}) is past its window — ${label} should have moved already.`;
  }

  if (urgency.shouldActNow) {
    return `${input.itemName} (${mass}) has ${left} left and ${label} need about ${formatHoursLeft(urgency.actionWindowHours)} of notice, so it is at ${pct}% urgency — acting now.`;
  }

  return `${input.itemName} (${mass}) has ${left} left, which is comfortable for ${label} — ${pct}% urgency, watching it.`;
}

/** Plain-language stand-in for the category, used in the feed instead of a category key. */
function leadTimeLabel(category: ItemCategory): string {
  const entry = lookupShelfLife(category);
  return entry.label.toLowerCase();
}

export const predictionAgent: Agent<PredictionInput, PredictionOutput> = {
  id: 'prediction',
  displayName: 'Prediction',
  tools: toolsFor('prediction'),

  async run(input: PredictionInput, _ctx: AgentContext): Promise<AgentResult<PredictionOutput>> {
    const startedAt = Date.now();

    const entry = lookupShelfLife(input.category);
    const urgency = computeUrgency(input);
    const label = leadTimeLabel(input.category);

    const toolCalls: ToolCallRecord[] = [
      {
        name: 'lookup_shelf_life',
        input: { category: input.category, storage: input.storage },
        output: {
          baselineHours: entry.baselineHours[input.storage],
          cookedFactor: entry.cookedFactor,
          actionWindowHours: entry.actionWindowHours,
          verified: entry.verified,
          sourceNote: entry.sourceNote,
        },
        latencyMs: Date.now() - startedAt,
      },
    ];

    return {
      output: { ...urgency, label },
      rationale: summarise(input, urgency, label),
      toolCalls,
      meta: { ...fixtureMeta('deterministic'), latencyMs: Date.now() - startedAt },
      // Surfaced in the UI: the shelf-life row behind this is a category generalisation awaiting
      // a manual FoodKeeper pass, not a cited row.
      ...(urgency.lowConfidence ? { fallback: 'shelf_life_generalised' } : {}),
    };
  },
};
