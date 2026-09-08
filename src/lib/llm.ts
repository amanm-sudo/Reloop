import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { env } from '@/lib/env';

/**
 * The only place a model is called.
 *
 * Two modes, one code path. When `DEMO_MODE` is on (or no API key is configured) every call
 * resolves from the deterministic fixture the caller supplies, and the returned `meta.fixture`
 * flag rides all the way to the UI so nothing is ever passed off as live that is not. The
 * orchestration around the call is identical either way — demo mode never forks the state
 * machine.
 *
 * Model output is untrusted input: structured calls are Zod-parsed before they escape here.
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
 * feed. Documentation, not billing — if these drift the feed's cost figure drifts with them.
 */
const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-opus-4-1': { input: 15, output: 75 },
};

const FALLBACK_PRICE = { input: 3, output: 15 };

function costOf(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES_PER_MTOK[model] ?? FALLBACK_PRICE;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  client ??= new Anthropic({ apiKey: env().ANTHROPIC_API_KEY });
  return client;
}

/**
 * True when a real model call is both allowed and possible. Everything downstream branches on
 * this one predicate so the two modes cannot diverge accidentally.
 */
export function isLive(): boolean {
  const config = env();
  return !config.DEMO_MODE && config.ANTHROPIC_API_KEY.length > 0;
}

export function fixtureMeta(model = 'fixture'): LlmMeta {
  return { model, latencyMs: 0, costUsd: 0, fixture: true };
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
 * Structured generation via a single-tool forced call, which is the most reliable way to get
 * schema-conformant JSON out of a tool-using model.
 */
export async function callStructured<S extends z.ZodTypeAny>(
  request: StructuredRequest<S>
): Promise<LlmCall<z.infer<S>>> {
  if (!isLive()) {
    return { value: request.fixture(), meta: fixtureMeta() };
  }

  const config = env();
  const model = request.vision ? config.ANTHROPIC_VISION_MODEL : config.ANTHROPIC_MODEL;
  const startedAt = Date.now();

  const content: Anthropic.ContentBlockParam[] = [];
  for (const image of request.images ?? []) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
    });
  }
  content.push({ type: 'text', text: request.prompt });

  const response = await anthropic().messages.create({
    model,
    max_tokens: request.maxTokens ?? 2048,
    system: request.system,
    messages: [{ role: 'user', content }],
    tools: [
      {
        name: request.schemaName,
        description: request.schemaDescription,
        input_schema: zodToJsonSchema(request.schema, {
          target: 'openApi3',
        }) as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: request.schemaName },
  });

  const latencyMs = Date.now() - startedAt;
  const costUsd = costOf(model, response.usage.input_tokens, response.usage.output_tokens);

  const block = response.content.find((c) => c.type === 'tool_use');
  if (!block || block.type !== 'tool_use') {
    throw new Error(`${request.schemaName}: model returned no structured output`);
  }

  // Model output is untrusted input.
  const parsed = request.schema.safeParse(block.input);
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

  const response = await anthropic().messages.create({
    model: config.ANTHROPIC_MODEL,
    max_tokens: request.maxTokens ?? 1024,
    system: request.system,
    messages: [{ role: 'user', content: [{ type: 'text', text: request.prompt }] }],
    tools: request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: zodToJsonSchema(tool.schema, {
        target: 'openApi3',
      }) as Anthropic.Tool.InputSchema,
    })),
    tool_choice: { type: 'any' },
  });

  const latencyMs = Date.now() - startedAt;
  const costUsd = costOf(
    config.ANTHROPIC_MODEL,
    response.usage.input_tokens,
    response.usage.output_tokens
  );

  const block = response.content.find((c) => c.type === 'tool_use');
  if (!block || block.type !== 'tool_use') {
    throw new Error('partner agent returned no decision');
  }

  const tool = request.tools.find((t) => t.name === block.name);
  if (!tool) {
    throw new Error(`model chose an unknown tool "${block.name}"`);
  }

  const parsed = tool.schema.safeParse(block.input);
  if (!parsed.success) {
    throw new Error(`${block.name}: arguments failed validation`);
  }

  return {
    tool: block.name,
    input: parsed.data,
    meta: { model: config.ANTHROPIC_MODEL, latencyMs, costUsd, fixture: false },
  };
}

/** Test seam. */
export function resetLlmClient(): void {
  client = null;
}
