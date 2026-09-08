---
inclusion: fileMatch
fileMatchPattern: 'src/agents/**'
---

# Agent Architecture Pattern — ReLoop

This file governs everything under `src/agents/`. Reference: `.kiro/specs/reloop/design.md` §3–§4.

## The invariants

These are not style preferences. Breaking any one of them collapses the project's core claim
of being a multi-agent system rather than a chat wrapper.

1. **Agents never call each other.** Coordination happens exclusively through the blackboard:
   the `Match` document plus the append-only `AgentEvent` log. If agent A needs something from
   agent B, A writes state and the orchestrator advances to B. No direct imports between
   `src/agents/<a>/` and `src/agents/<b>/`.

2. **One agent, one system prompt, one scoped tool set.** Tool access is enforced by the
   registry in `src/agents/registry.ts`, not requested politely in a prompt. Perception cannot
   geocode. Logistics cannot message a partner. Impact cannot write a `Match` state transition.

3. **The Partner Agent is a genuinely separate mind.** `SimulatedPartnerAgent` has its own
   context, its own system prompt built from the seeded org persona, and tools limited to
   `accept` / `counter_offer` / `decline`. It must never receive the donor-side candidate
   ranking, the other candidates, or the Negotiation Agent's reasoning. That information
   asymmetry is the whole point — do not collapse both sides into one prompt for convenience,
   however tempting it looks at 2 AM on Day 5.

4. **Every agent action emits exactly one `AgentEvent`**, containing a plain-language `summary`
   (the sentence a non-technical user reads in the feed), a `detail` payload, `causedBy` for
   the causal chain, and `latencyMs` / `costUsd` / `fixture`. If an action produces no event,
   it is invisible to the user and therefore does not exist.

5. **The orchestrator advances one step per call.** `advance(run)` performs a single state
   transition, guarded by a `findOneAndUpdate` on the expected `state` plus a `lockedUntil`
   lease. It must be safe to call twice: a duplicate call is a no-op, not a duplicate event.
   Never write a long-running loop that walks the whole state machine in one invocation.

6. **Decide deterministically, explain with the model.** Candidate scoring and urgency are
   pure functions with unit tests. The LLM writes the human-readable justification; it does not
   pick the recipient. Reproducible, testable, and defensible to a judge who asks "why that
   NGO?"

7. **Model output is untrusted input.** Every tool-call result and every structured response
   is parsed with Zod before use. No exceptions.

8. **Every agent supports fixture mode.** When `DEMO_MODE=true`, model calls resolve from
   `fixtures/` deterministically and the result carries `fixture: true` — which surfaces in the
   UI. The orchestration path is identical in both modes; only the model call is swapped. Never
   fork the state machine for demo mode.

## The shape

```ts
interface Agent<TIn, TOut> {
  readonly id: AgentId;
  readonly displayName: string;
  readonly tools: ToolDef[];
  run(input: TIn, ctx: AgentContext): Promise<AgentResult<TOut>>;
}
```

`AgentResult` always carries `output` (Zod-validated), `rationale` (≤ 45 words, feed-ready),
`toolCalls`, and `meta { model, latencyMs, costUsd, fixture }`. Adding a sixth agent means
implementing this interface and registering a transition — nothing else.

## The five agents and their boundaries

| Agent | Reads | Writes | Tools |
| --- | --- | --- | --- |
| Perception | uploaded image | `InventoryItem[]` | none (single vision call) |
| Prediction | `InventoryItem` | `actByAt`, `urgencyScore` | `lookupShelfLife` |
| Negotiation | `Match`, `RecipientProfile[]` | `candidates`, `justification`, `transcript` | `send_offer`, `evaluate_counter`, `accept_terms`, `escalate_to_next_candidate`, `fallback_to_compost` |
| Logistics | agreed `Match` | `pickup` | `routeMatrix`, `proposeWindows`, `clusterNearbyMatches` |
| Impact | completed `Match` | `ImpactLog` | `lookupFactors` |

## Degradation

Agents do not throw on expected failure. No candidates, a provider timeout, or a missing
emission factor all produce a valid `AgentResult` with a degraded outcome and a `fallback`
label that the UI displays. Fallback chains are defined in `design.md` §7 and every fallback
must be labelled in the UI — degrade loudly, never silently.

## Data integrity

No shelf-life number and no emission factor may exist without a `source` field.
`scripts/verify-sources.ts` enforces this and runs in `npm run check`. A missing factor renders
as "not quantified" — never as a guess.
