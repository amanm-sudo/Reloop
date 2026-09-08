import { fixtureMeta } from '@/lib/llm';
import type { ItemCategory } from '@/lib/domain';
import { impactTable, lookupFactors } from '@/lib/reference-data';
import { formatMass } from '@/lib/units';
import { toolsFor } from '@/agents/registry';
import type { Agent, AgentContext, AgentResult } from '@/agents/types';

/**
 * Impact Agent: what was actually saved, in real units, from cited data.
 *
 * The one thing this agent must never do is flatter the project. Two rules enforce that:
 *
 *   1. Redistribution and composting are accounted differently. Food eaten by a person displaces
 *      food that would otherwise have been produced, so it earns the full per-kg production
 *      footprint. Composted food does not — the emissions of growing it are already spent, and
 *      only the landfill methane is avoided. Reporting these as equivalent is the standard way
 *      this kind of number gets inflated, and it is the reason the two paths are separate here.
 *
 *   2. No cited factor means no number. A missing factor produces `notQuantified`, and the UI
 *      says so rather than showing an estimate.
 */

export type ImpactInput = {
  category: ItemCategory;
  quantityKg: number;
  outcome: 'REDISTRIBUTED' | 'COMPOSTED';
};

export type ImpactOutput = {
  outcome: 'REDISTRIBUTED' | 'COMPOSTED';
  quantityKg: number;
  co2eKg: number | null;
  waterL: number | null;
  landM2: number | null;
  notQuantified: boolean;
  notQuantifiedReason?: string | undefined;
  factorSource: {
    dataset: string;
    year?: number | undefined;
    url: string;
    commodityGroup?: string | undefined;
    isProxy: boolean;
    proxyNote?: string | undefined;
    factorValues: {
      co2eKgPerKg?: number | undefined;
      waterLPerKg?: number | undefined;
      landM2PerKg?: number | undefined;
    };
  };
};

function round(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

export const impactAgent: Agent<ImpactInput, ImpactOutput> = {
  id: 'impact',
  displayName: 'Impact',
  tools: toolsFor('impact'),

  async run(input: ImpactInput, _ctx: AgentContext): Promise<AgentResult<ImpactOutput>> {
    const startedAt = Date.now();
    const table = impactTable();
    const factor = lookupFactors(input.category);

    const toolCalls = [
      {
        name: 'lookup_impact_factors' as const,
        input: { category: input.category, outcome: input.outcome },
        output: {
          commodityGroup: factor.commodityGroup,
          notQuantified: factor.notQuantified,
          isProxy: factor.isProxy,
        },
        latencyMs: Date.now() - startedAt,
      },
    ];

    // --- Composted: landfill-diversion credit only. ---
    if (input.outcome === 'COMPOSTED') {
      const compost = table.compostFallback;
      const co2eKg = round(input.quantityKg * compost.co2eKgPerKgDiverted, 3);

      const output: ImpactOutput = {
        outcome: 'COMPOSTED',
        quantityKg: input.quantityKg,
        co2eKg,
        // Composting recovers no water and no land. Reporting zero is the honest answer, not a
        // gap in the data.
        waterL: 0,
        landM2: 0,
        notQuantified: false,
        factorSource: {
          dataset: compost.source,
          url: compost.sourceUrl,
          isProxy: false,
          factorValues: { co2eKgPerKg: compost.co2eKgPerKgDiverted },
        },
      };

      return {
        output,
        rationale: `${formatMass(input.quantityKg)} kept out of landfill — about ${co2eKg} kg CO2e of methane avoided. Growing it is already spent, so no water or land is recovered.`,
        toolCalls,
        meta: { ...fixtureMeta('deterministic'), latencyMs: Date.now() - startedAt },
      };
    }

    // --- Redistributed but unquantifiable: say so, do not estimate. ---
    if (factor.notQuantified || factor.co2eKgPerKg == null) {
      const output: ImpactOutput = {
        outcome: 'REDISTRIBUTED',
        quantityKg: input.quantityKg,
        co2eKg: null,
        waterL: null,
        landM2: null,
        notQuantified: true,
        notQuantifiedReason: factor.notQuantifiedReason,
        factorSource: {
          dataset: table.dataset.name,
          year: table.dataset.year,
          url: table.dataset.url,
          isProxy: false,
          factorValues: {},
        },
      };

      return {
        output,
        rationale: `${formatMass(input.quantityKg)} redistributed. Footprint not quantified — no cited factor exists for this category.`,
        toolCalls,
        meta: { ...fixtureMeta('deterministic'), latencyMs: Date.now() - startedAt },
        fallback: 'factor_not_available',
      };
    }

    // --- Redistributed: full avoided-production credit. ---
    const co2eKg = round(input.quantityKg * factor.co2eKgPerKg, 3);
    const waterL = factor.waterLPerKg == null ? null : round(input.quantityKg * factor.waterLPerKg, 1);
    const landM2 = factor.landM2PerKg == null ? null : round(input.quantityKg * factor.landM2PerKg, 3);

    const output: ImpactOutput = {
      outcome: 'REDISTRIBUTED',
      quantityKg: input.quantityKg,
      co2eKg,
      waterL,
      landM2,
      notQuantified: false,
      factorSource: {
        dataset: table.dataset.name,
        year: table.dataset.year,
        url: table.dataset.url,
        commodityGroup: factor.commodityGroup ?? undefined,
        isProxy: factor.isProxy,
        proxyNote: factor.proxyNote,
        factorValues: {
          co2eKgPerKg: factor.co2eKgPerKg,
          waterLPerKg: factor.waterLPerKg ?? undefined,
          landM2PerKg: factor.landM2PerKg ?? undefined,
        },
      },
    };

    const waterPart = waterL == null ? '' : ` and ${Math.round(waterL)} litres of water`;

    return {
      output,
      rationale: `${formatMass(input.quantityKg)} eaten instead of binned — about ${co2eKg} kg CO2e${waterPart} avoided.`,
      toolCalls,
      meta: { ...fixtureMeta('deterministic'), latencyMs: Date.now() - startedAt },
      ...(factor.isProxy ? { fallback: 'factor_proxy' } : {}),
    };
  },
};
