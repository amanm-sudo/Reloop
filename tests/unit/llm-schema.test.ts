import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toGeminiSchema } from '@/lib/llm';
import { extractionResultSchema } from '@/agents/perception/schema';

/**
 * Schema translation for Gemini function declarations.
 *
 * Every live model call depends on this, and no other test touches it: the whole suite runs in
 * fixture mode, so a broken translation would pass CI and then fail on the first real call — with
 * a key configured, during a demo. These tests are the only thing standing in that gap until the
 * live path has actually been run.
 *
 * Gemini rejects `$schema` and `additionalProperties`, and cannot follow `$ref` indirection inside
 * a function declaration.
 */

function walk(node: unknown, visit: (key: string, value: unknown) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (node === null || typeof node !== 'object') return;

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    visit(key, value);
    walk(value, visit);
  }
}

function keysOf(node: unknown): string[] {
  const found: string[] = [];
  walk(node, (key) => found.push(key));
  return found;
}

describe('Gemini schema translation', () => {
  it('strips keywords Gemini rejects', () => {
    const translated = toGeminiSchema(extractionResultSchema);
    const keys = keysOf(translated);

    expect(keys).not.toContain('$schema');
    expect(keys).not.toContain('additionalProperties');
    expect(keys).not.toContain('definitions');
  });

  it('leaves no $ref indirection to follow', () => {
    // A schema reused in two places is exactly what makes zod-to-json-schema emit a $ref.
    const inner = z.object({ label: z.string(), score: z.number() });
    const outer = z.object({ first: inner, second: inner });

    const translated = toGeminiSchema(outer);
    const serialised = JSON.stringify(translated);

    expect(serialised).not.toContain('$ref');
    // Both branches must be fully spelled out.
    const properties = translated.properties as Record<string, { properties?: unknown }>;
    expect(properties.first?.properties).toBeTruthy();
    expect(properties.second?.properties).toBeTruthy();
  });

  it('preserves the structure the model actually needs', () => {
    const translated = toGeminiSchema(extractionResultSchema);

    expect(translated.type).toBe('object');

    const properties = translated.properties as Record<string, Record<string, unknown>>;
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining(['isReceipt', 'note', 'items'])
    );
    expect(properties.items?.type).toBe('array');

    // Required fields must survive, or the model will happily omit them.
    expect(translated.required).toEqual(expect.arrayContaining(['isReceipt', 'note', 'items']));
  });

  it('keeps enum constraints, which is how categories stay valid', () => {
    const translated = toGeminiSchema(extractionResultSchema);
    const items = (translated.properties as Record<string, Record<string, unknown>>).items;
    const itemSchema = items?.items as Record<string, Record<string, unknown>>;
    const category = itemSchema?.properties?.category as Record<string, unknown> | undefined;

    expect(Array.isArray(category?.enum)).toBe(true);
    expect((category?.enum as string[]).length).toBeGreaterThan(20);
  });

  it('keeps numeric bounds, so confidence cannot come back as 7', () => {
    const translated = toGeminiSchema(extractionResultSchema);
    const items = (translated.properties as Record<string, Record<string, unknown>>).items;
    const itemSchema = items?.items as Record<string, Record<string, unknown>>;
    const confidence = itemSchema?.properties?.confidence as Record<string, unknown> | undefined;

    expect(confidence?.minimum).toBe(0);
    expect(confidence?.maximum).toBe(1);
  });

  it('produces something JSON-serialisable, since it crosses an HTTP boundary', () => {
    const translated = toGeminiSchema(extractionResultSchema);
    expect(() => JSON.stringify(translated)).not.toThrow();
    expect(JSON.parse(JSON.stringify(translated))).toEqual(translated);
  });

  it('handles optional fields without emitting them as required', () => {
    const schema = z.object({ needed: z.string(), maybe: z.string().optional() });
    const translated = toGeminiSchema(schema);

    expect(translated.required).toEqual(['needed']);
  });
});
