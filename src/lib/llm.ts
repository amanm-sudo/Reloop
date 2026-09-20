import { FunctionCallingConfigMode, GoogleGenAI, type Part } from '@google/genai';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { env } from '@/lib/env';

/**
 * The only place a model is called.
 *
 * Two modes, one code path. When `DEMO_MODE` is on (or no API key is configured) every call
 * resolves from the deterministic fixture the caller supplies, and the returned `meta.fixture`
 * flag rides all the way to the UI so nothing is ever passed off as live that is not. The
 * orchestration around the call is identical either way — demo mode never forks the state machine.
 *
 * Model output is untrusted input: structured calls are Zod-parsed before they escape here.
 *
 * Provider: Google Gemini via `@google/genai`. Both entry points below are expressed as forced
 * function calls, which is the most reliable way to get schema-conformant arguments out of a
 * tool-using model. Because every agent goes through this module, swapping providers touched only
 * this file — no agent, no prompt, and no test needed changing.
 */

export type LlmMeta = {
  model: string;
  latencyMs: number;
  costUsd: number;
  fixture: boolean;
};

export type LlmCall<T> = {
  value: T;
  meta: LlmMeta;
};

/**
 * Published list prices per million tokens, used only to attribute a run's cost in the activity
 * feed. Documentation, not billing — if Google's prices move, this figure moves with them and the
 * displayed cost drifts. Retrieved 2026-08-31 from https://ai.google.dev/gemini-api/docs/pricing
 */
const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
};

const FALLBACK_PRICE = { input: 0.3, output: 2.5 };

function costOf(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES_PER_MTOK[model] ?? FALLBACK_PRICE;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

let client: GoogleGenAI | null = null;

function gemini(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: env().GEMINI_API_KEY });
  return client;
}

/**
 * True when a real model call is both allowed and possible. Everything downstream branches on
 * this one predicate so the two modes cannot diverge accidentally.
 */
export function isLive(): boolean {
  const config = env();
  return !config.DEMO_MODE && config.GEMINI_API_KEY.length > 0;
}

export function fixtureMeta(model = 'fixture'): LlmMeta {
  return { model, latencyMs: 0, costUsd: 0, fixture: true };
}

/**
 * Gemini rejects some JSON Schema keywords that `zod-to-json-schema` emits, and it cannot follow
 * `$ref` indirection in a function declaration. Refs are inlined at generation time and the
 * remaining metadata keys are stripped recursively.
 */
export function toGeminiSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const generated = zodToJsonSchema(schema, {
    target: 'openApi3',
    $refStrategy: 'none',
  }) as Record<string, unknown>;

  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (node === null || typeof node !== 'object') return node;

    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === '$schema' || key === 'additionalProperties' || key === 'definitions') continue;
      cleaned[key] = strip(value);
    }
    return cleaned;
  };

  return strip(generated) as Record<string, unknown>;
}

type GeminiUsage = { promptTokenCount?: number; candidatesTokenCount?: number };

function usageOf(usage: GeminiUsage | undefined): { input: number; output: number } {
  return { input: usage?.promptTokenCount ?? 0, output: usage?.candidatesTokenCount ?? 0 };
}

export type ImageInput = { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string };

export type StructuredRequest<S extends z.ZodTypeAny> = {
  /** Agent system prompt. One agent, one prompt. */
  system: string;
  prompt: string;
  schema: S;
  /** Names the emitted structure for the model. Keep it short and descriptive. */
  schemaName: string;
  schemaDescription: string;
  images?: ImageInput[];
  maxTokens?: number;
  vision?: boolean;
  /** Deterministic stand-in used whenever `isLive()` is false. */
  fixture: () => z.infer<S>;
};

/**
 * Structured generation via a single forced function call.
 */
export async function callStructured<S extends z.ZodTypeAny>(
  request: StructuredRequest<S>
): Promise<LlmCall<z.infer<S>>> {
  if (!isLive()) {
    return { value: request.fixture(), meta: fixtureMeta() };
  }

  const config = env();
  const model = request.vision ? config.GEMINI_VISION_MODEL : config.GEMINI_MODEL;
  const startedAt = Date.now();

  const parts: Part[] = [];
  for (const image of request.images ?? []) {
    parts.push({ inlineData: { mimeType: image.mediaType, data: image.base64 } });
  }
  parts.push({ text: request.prompt });

  const response = await gemini().models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction: request.system,
      maxOutputTokens: request.maxTokens ?? 2048,
      tools: [
        {
          functionDeclarations: [
            {
              name: request.schemaName,
              description: request.schemaDescription,
              parametersJsonSchema: toGeminiSchema(request.schema),
            },
          ],
        },
      ],
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: [request.schemaName],
        },
      },
    },
  });

  const latencyMs = Date.now() - startedAt;
  const { input, output } = usageOf(response.usageMetadata);
  const costUsd = costOf(model, input, output);

  const call = response.functionCalls?.[0];
  if (!call?.args) {
    throw new Error(`${request.schemaName}: model returned no structured output`);
  }

  // Model output is untrusted input.
  const parsed = request.schema.safeParse(call.args);
  if (!parsed.success) {
    throw new Error(
      `${request.schemaName}: model output failed validation — ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`
    );
  }

  return { value: parsed.data as z.infer<S>, meta: { model, latencyMs, costUsd, fixture: false } };
}

/** One tool the model may choose between, used by the Partner Agent's genuine tool-use loop. */
export type ChoiceTool<S extends z.ZodTypeAny> = {
  name: string;
  description: string;
  schema: S;
};

export type ChoiceRequest = {
  system: string;
  prompt: string;
  tools: ReadonlyArray<ChoiceTool<z.ZodTypeAny>>;
  maxTokens?: number;
  /** Deterministic stand-in: the tool name and its already-validated input. */
  fixture: () => { tool: string; input: unknown };
};

export type ChoiceResult = {
  tool: string;
  input: unknown;
  meta: LlmMeta;
};

/**
 * Lets the model pick one of several tools and fill in its arguments.
 *
 * This is what makes the Partner Agent a genuine counterparty rather than a scripted one: it is
 * handed `accept`, `counter_offer` and `decline` and nothing else, and it chooses. It never sees
 * the donor side's candidate ranking or reasoning.
 */
export async function callChoice(request: ChoiceRequest): Promise<ChoiceResult> {
  if (!isLive()) {
    const chosen = request.fixture();
    return { tool: chosen.tool, input: chosen.input, meta: fixtureMeta() };
  }

  const config = env();
  const startedAt = Date.now();

  const response = await gemini().models.generateContent({
    model: config.GEMINI_MODEL,
    contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
    config: {
      systemInstruction: request.system,
      maxOutputTokens: request.maxTokens ?? 1024,
      tools: [
        {
          functionDeclarations: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parametersJsonSchema: toGeminiSchema(tool.schema),
          })),
        },
      ],
      toolConfig: {
        functionCallingConfig: {
          // ANY forces a choice, but leaves which one entirely to the model.
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: request.tools.map((tool) => tool.name),
        },
      },
    },
  });

  const latencyMs = Date.now() - startedAt;
  const { input, output } = usageOf(response.usageMetadata);
  const costUsd = costOf(config.GEMINI_MODEL, input, output);

  const call = response.functionCalls?.[0];
  if (!call?.name) {
    throw new Error('partner agent returned no decision');
  }

  const tool = request.tools.find((candidate) => candidate.name === call.name);
  if (!tool) {
    throw new Error(`model chose an unknown tool "${call.name}"`);
  }

  const parsed = tool.schema.safeParse(call.args ?? {});
  if (!parsed.success) {
    throw new Error(`${call.name}: arguments failed validation`);
  }

  return {
    tool: call.name,
    input: parsed.data,
    meta: { model: config.GEMINI_MODEL, latencyMs, costUsd, fixture: false },
  };
}

/** Test seam. */
export function resetLlmClient(): void {
  client = null;
}
