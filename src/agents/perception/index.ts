import { createHash } from 'node:crypto';
import { THRESHOLDS, type ItemCategory, type StorageState, kindOf } from '@/lib/domain';
import { callStructured, fixtureMeta, isLive } from '@/lib/llm';
import { toKg, type MassResult } from '@/lib/units';
import { toolsFor } from '@/agents/registry';
import type { Agent, AgentContext, AgentResult } from '@/agents/types';
import { fixtureByHash, fixtureByKey, type FixtureKey } from '@/agents/perception/fixtures';
import { PERCEPTION_SYSTEM, perceptionPrompt } from '@/agents/perception/prompt';
import { extractionResultSchema, type ExtractionResult } from '@/agents/perception/schema';

/**
 * Perception Agent: a photo or receipt becomes structured inventory.
 *
 * One vision call, no tools. Items below the confidence gate are marked `needsConfirmation` and
 * are barred from triggering an autonomous match until a human confirms them — an agent acting on
 * a misread label is the failure mode most likely to embarrass the whole system.
 */

export type PerceptionInput = {
  image?: { bytes: Buffer; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' } | undefined;
  /** Demo-only shortcut so the walkthrough needs no camera. Ignored when live. */
  fixtureKey?: FixtureKey | undefined;
  note?: string | null;
};

export type NormalisedItem = {
  name: string;
  category: ItemCategory;
  kind: 'FOOD' | 'MATERIAL';
  quantity: number;
  unit: string;
  quantityKg: number;
  massBasis: MassResult['basis'];
  isCooked: boolean;
  storage: StorageState;
  confidence: number;
  needsConfirmation: boolean;
};

export type PerceptionOutput = {
  isReceipt: boolean;
  note: string;
  items: NormalisedItem[];
  /** Rows the model produced that could not be normalised into a usable mass. */
  unusable: number;
  needsConfirmationCount: number;
};

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalise(extraction: ExtractionResult): {
  items: NormalisedItem[];
  unusable: number;
} {
  const items: NormalisedItem[] = [];
  let unusable = 0;

  for (const raw of extraction.items) {
    const mass = toKg(raw.quantity, raw.unit, raw.estimatedMassG);
    if (!mass || mass.quantityKg <= 0) {
      // No usable mass means no capacity check and no impact figure, so it cannot enter the
      // pipeline. Counted rather than silently dropped.
      unusable += 1;
      continue;
    }

    items.push({
      name: raw.name,
      category: raw.category,
      kind: kindOf(raw.category),
      quantity: raw.quantity,
      unit: raw.unit,
      quantityKg: mass.quantityKg,
      massBasis: mass.basis,
      isCooked: raw.isCooked,
      storage: raw.storageHint,
      confidence: raw.confidence,
      needsConfirmation: raw.confidence < THRESHOLDS.MIN_EXTRACTION_CONFIDENCE,
    });
  }

  return { items, unusable };
}

function summarise(output: PerceptionOutput, viaFixture: boolean): string {
  if (output.items.length === 0) {
    return viaFixture
      ? 'Could not read that image in demo mode — add the items by hand instead.'
      : 'Could not make out any items in that image — add them by hand instead.';
  }

  const heaviest = [...output.items].sort((a, b) => b.quantityKg - a.quantityKg)[0];
  const others = output.items.length - 1;
  const tail =
    output.needsConfirmationCount > 0
      ? `, ${output.needsConfirmationCount} needing a quick confirmation`
      : '';

  return others > 0
    ? `Read ${output.items.length} items off the ${output.isReceipt ? 'receipt' : 'photo'}, including ${heaviest?.name}${tail}.`
    : `Read ${heaviest?.name} off the ${output.isReceipt ? 'receipt' : 'photo'}${tail}.`;
}

export const perceptionAgent: Agent<PerceptionInput, PerceptionOutput> = {
  id: 'perception',
  displayName: 'Perception',
  tools: toolsFor('perception'),

  async run(input: PerceptionInput, _ctx: AgentContext): Promise<AgentResult<PerceptionOutput>> {
    const empty: PerceptionOutput = {
      isReceipt: false,
      note: '',
      items: [],
      unusable: 0,
      needsConfirmationCount: 0,
    };

    // --- Fixture path: DEMO_MODE, or live mode with no key configured. ---
    if (!isLive()) {
      const fixture = input.fixtureKey
        ? fixtureByKey(input.fixtureKey)
        : input.image
          ? fixtureByHash(sha256(input.image.bytes))
          : null;

      if (!fixture) {
        // Deliberately does not fall back to a generic fixture. Inventing items the user never
        // photographed would be worse than admitting we cannot read it.
        return {
          output: empty,
          rationale: summarise(empty, true),
          toolCalls: [],
          meta: fixtureMeta(),
          fallback: 'manual_entry',
        };
      }

      const { items, unusable } = normalise(fixture);
      const output: PerceptionOutput = {
        isReceipt: fixture.isReceipt,
        note: fixture.note,
        items,
        unusable,
        needsConfirmationCount: items.filter((i) => i.needsConfirmation).length,
      };

      return {
        output,
        rationale: summarise(output, true),
        toolCalls: [],
        meta: fixtureMeta(),
      };
    }

    // --- Live path. ---
    if (!input.image) {
      return {
        output: empty,
        rationale: 'No image was provided, so there was nothing to read.',
        toolCalls: [],
        meta: fixtureMeta(),
        fallback: 'manual_entry',
      };
    }

    try {
      const call = await callStructured({
        system: PERCEPTION_SYSTEM,
        prompt: perceptionPrompt(input.note ?? null),
        schema: extractionResultSchema,
        schemaName: 'record_inventory',
        schemaDescription: 'Record every food or reusable item visible in the image.',
        images: [{ mediaType: input.image.mediaType, base64: input.image.bytes.toString('base64') }],
        vision: true,
        maxTokens: 3000,
        fixture: () => ({ isReceipt: false, note: '', items: [] }),
      });

      const { items, unusable } = normalise(call.value);
      const output: PerceptionOutput = {
        isReceipt: call.value.isReceipt,
        note: call.value.note,
        items,
        unusable,
        needsConfirmationCount: items.filter((i) => i.needsConfirmation).length,
      };

      return {
        output,
        rationale: summarise(output, false),
        toolCalls: [],
        meta: call.meta,
      };
    } catch (cause) {
      // Expected failure: a provider timeout or a malformed response degrades to manual entry
      // with a visible label. It never throws into the orchestrator.
      console.error('[perception] vision call failed', cause);
      return {
        output: empty,
        rationale: 'The vision service did not respond, so add the items by hand for now.',
        toolCalls: [],
        meta: fixtureMeta(),
        fallback: 'vision_unavailable',
      };
    }
  },
};
