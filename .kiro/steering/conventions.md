# Coding Conventions — ReLoop

Applies to all code in this repo.

## TypeScript

- `strict: true`. No `any` anywhere in `src/agents/**`, `src/models/**`, or `src/lib/**`.
  If a type is genuinely unknown, use `unknown` and narrow with Zod.
- No non-null assertions (`!`) outside test files. Narrow properly.
- Prefer `type` for shapes, `interface` only when it will be implemented or extended.
- Exported functions have explicit return types. Inference is fine for locals.
- Discriminated unions over optional-field soup, especially for agent results and match state.

## Validation

- Zod schema at every boundary: route handler input, env vars at startup, reference-data
  files at load, **and every LLM tool-call output**.
- LLM output is untrusted input. Never destructure a model response without parsing it first.
- Env access goes through `src/lib/env.ts` (a parsed Zod object). Never read
  `process.env.X` inline.

## Error handling

- Route handlers return a discriminated result, never throw to the framework:
  `{ ok: true, data }` | `{ ok: false, error: { code, message } }`.
- Error `message` is user-safe. Diagnostic detail goes to the log, not the response.
- Agents never throw for expected failure (no candidates, provider timeout, missing factor).
  They return a result with a degraded outcome and a `fallback` label, and the UI shows it.
  Throwing is reserved for programmer error.
- Every catch either handles or rethrows with context. No empty catch, no silent swallow.

## Folder structure

Follow `design.md` §9. Rules that matter:

- `src/agents/<name>/` contains that agent's prompt, tools, and types. Agents do not import
  from each other — they communicate through the blackboard only.
- `src/lib/` is framework-agnostic and has no React imports.
- Mongoose models live only in `src/models/` and are only imported server-side.
- No barrel `index.ts` files that re-export whole directories; they wreck tree-shaking and
  hide dependency direction.

## Naming

- Files: `kebab-case.ts`. React components: `PascalCase.tsx`.
- Booleans read as predicates: `isSimulated`, `needsConfirmation`, `hasCapacity`.
- Money/units in the name when ambiguous: `quantityKg`, `co2eKg`, `waterL`, `distanceKm`,
  `latencyMs`, `costUsd`. Never a bare `amount` or `value`.
- Times end in `At` and are stored as UTC `Date`: `actByAt`, `preparedAt`, `lockedUntil`.

## React / Next.js

- Server Components by default. `"use client"` only for interactivity (map, feed stream,
  forms) and kept as low in the tree as possible.
- Data fetching in Server Components or route handlers, never in `useEffect` for initial load.
  The feed's live stream is the one deliberate exception.
- No client-side state library. `useState` + server state is sufficient at this scale.

## Styling

- Tailwind utilities only; no CSS modules, no styled-components.
- Colours come from the design tokens in `design.md` §6.1. Never a raw hex in a component.
- **Palette discipline:** one clay accent (`#C9502F`) plus the urgency scale. No green
  gradients, no leaf icons, no recycling-triangle motifs. Circularity is shown structurally
  (the feed's connector line), never with eco-stock iconography.
- Mobile-first: write the 390 px layout, then add `sm:`/`md:` upward.

## Accessibility

- Interactive elements are real `<button>`/`<a>`. No `onClick` on a `div`.
- Visible focus rings; never `outline: none` without a replacement.
- State is never communicated by colour alone — pair it with text or shape (this is why map
  pins differ in shape, not just colour).
- The activity feed container is `aria-live="polite"`.

## Testing

- Business logic (urgency formula, candidate scoring, impact math) has unit tests. UI does not,
  except the Playwright smoke test over the demo path.
- Orchestrator transitions have integration tests with a stubbed LLM, including the
  counter-offer, escalation, and compost-fallback paths.
- Tests must not call a real LLM, routing service, or Telegram.

## Commits

- Imperative subject, ≤ 72 chars, scoped: `agents: add counter-offer evaluation`.
- Commit at least twice daily. Commit history is part of the judged submission.
- Never commit `.env.local`, fixtures containing real personal data, or API keys.
