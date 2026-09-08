# Product Guardrails — ReLoop

Scope discipline for a 14-day solo build judged on Originality, Adherence to Track,
Completion, Learning, Design, and Technology.

## Reject these, always

If a proposed feature reduces to one of these, push back and find the agentic version instead:

- A recyclable-vs-non-recyclable image classifier as a centerpiece
- A static "list your surplus and browse" marketplace
- A carbon calculator with invented or unsourced multipliers
- A smart-bin fill-level dashboard
- **Any "form plus one GPT call."** If a feature can be described that way, it is not a
  ReLoop feature yet.

The test: does this feature involve agents acting on each other's behalf, or does it involve a
human doing coordination work? The second one is the problem ReLoop exists to remove.

## Never cut

The agent-to-agent negotiation and its visibility in the UI. When time runs out, cut in this
pre-committed order and do not re-deliberate:

1. Business / recurring-stream users
2. City leaderboard
3. Telegram bot
4. Route optimisation → straight-line fallback

## Honesty rules

- **No fabricated partnerships.** Seeded organisations are modelled on how real orgs operate,
  and every profile carries a `provenance` string saying exactly that. Neither the app nor the
  demo narration claims a relationship that does not exist.
- **No invented numbers.** Every shelf-life and emission figure traces to a cited dataset row.
  Missing factor → "not quantified", never an estimate.
- **No hidden simulation.** When a partner is simulated or an agent output came from a fixture,
  the UI says so. The system is impressive because the orchestration is real; passing off
  fixtures as live would put that at risk for no gain.
- **Real coordinates only.** Geocoded once at seed time and committed. Never hand-typed lat/lng.

## Design guardrails

- One "aha" screen: the Agent Activity Feed, in plain conversational sentences. Never raw JSON
  at the top level.
- Mobile-first at 390 px. The primary real users are on phones.
- One clay accent plus an urgency scale. No leaf icons, no green gradients, no recycling
  triangles. Circularity is shown structurally.
- Gamification limited to a streak, a city total, and a partner leaderboard. No badges,
  mascots, confetti, or points without units. Impact numbers must feel earned.

## Demo reliability is a feature, not a chore

- Every external dependency has a labelled offline fallback.
- `npm run seed` is deterministic, idempotent, and safe to run mid-demo.
- The full flow demos live in under 90 seconds with no external human responding.
- Every agent action is visible within 3 seconds. No invisible background magic — judges need
  to watch the system think.

## When in doubt

Prefer a smaller thing that works every time over a larger thing that works sometimes.
Completion is a judged criterion; ambition that does not run is worth zero.
