# ReLoop — Implementation Plan

**Status:** Do not start until `requirements.md` and `design.md` are approved.
**Format:** Checkpoints map 1:1 to the 14-day schedule. Each checkpoint has a **pace gate** —
if it is not met by end of that day, apply the cut order (requirements §7) immediately
rather than pushing the schedule.

Each task cites the requirements it satisfies.

---

## Checkpoint 0 — Day 0 (2 hours, before Day 1)

- [ ] 0.1 Create the Telegram bot via BotFather, store the token in `.env.local`. _Five minutes now removes all external-approval risk from Day 11._ (FR-10)
- [ ] 0.2 Create MongoDB Atlas free cluster, Vercel project, Anthropic API key.
- [ ] 0.3 `git init`, first commit, push public repo. Commit early and often — commit history is judged.

**Pace gate:** all four external accounts exist and a hello-world Next.js app is deployed to Vercel.

---

## Checkpoint 1 — Days 1–3: Foundation

### Day 1 — Skeleton and data layer
- [ ] 1.1 Scaffold Next.js 15 + TypeScript `strict` + Tailwind v4; set up the palette tokens from design §6.1. (NFR-1, NFR-5)
- [ ] 1.2 ESLint + Prettier + Vitest + `tsc --noEmit` wired into `npm run check`. Needed before the lint hook can work.
- [ ] 1.3 Mongoose connection helper with serverless connection caching; `.env.example` with every variable documented. (NFR-4, NFR-8)
- [ ] 1.4 All schemas from design §5: `User`, `RecipientProfile`, `InventoryItem`, `Match`, `AgentRun`, `AgentEvent`, `ImpactLog`, plus the four indexes. (FR-1, FR-7)
- [ ] 1.5 Auth: register, login, logout; Argon2id; `jose` JWT in an HTTP-only cookie; route-handler session guard. (FR-1.1, FR-1.3, §8)
- [ ] 1.6 **`AgentEvent` write helper + the feed API endpoint, on day one.** The feed is first-class data, not a later feature — every subsequent task appends to it. (FR-7.1)

### Day 2 — Reference data and Perception
- [ ] 2.1 Build `data/shelf-life.json` from USDA FoodKeeper for ~40 categories relevant to Indian households (dal, atta, paneer, cooked sabzi, leafy greens, milk, curd, roti, rice, fruit). Every row carries `source` + `sourceNote`. (FR-3.2, FR-3.3)
- [ ] 2.2 Build `data/impact-factors.json` from Poore & Nemecek 2018 (CO2e, water, land) with dataset/year/url per row. (FR-6.2)
- [ ] 2.3 `scripts/verify-sources.ts` — fails if any reference row lacks `source`. Wire into `npm run check`. (FR-6.5)
- [ ] 2.4 Agent interface, `AgentContext`, tool registry with **per-agent scoped tool access**. (design §4)
- [ ] 2.5 Perception Agent: upload route, Claude vision call, Zod-validated `ExtractedItem[]`, confidence gating at 0.6. (FR-2.1, FR-2.2)
- [ ] 2.6 Fixture layer: `DEMO_MODE` resolves Perception from `fixtures/` keyed by image SHA-256; `fixture: true` flag flows to the UI. (FR-2.6, FR-11.4)
- [ ] 2.7 Upload UI + inline correction of extracted items (keeps original for the feed). (FR-2.4, FR-2.5)

### Day 3 — Prediction and the orchestrator spine
- [ ] 3.1 Prediction Agent: deterministic urgency formula, `actByAt`, `lowConfidence` for missing categories. (FR-3.1, FR-3.5)
- [ ] 3.2 Unit tests for the urgency formula at boundaries (0, 0.7 threshold, past-deadline). (design §10)
- [ ] 3.3 Orchestrator state machine: states, transitions, `advance(run)` one-step-per-call, `lockedUntil` lease, idempotency guard. (design §3.1)
- [ ] 3.4 `/api/cron/tick` sweep over `{state, nextActionAt}` + `vercel.json` cron config. (NFR-8)
- [ ] 3.5 Auto-enqueue a negotiation run when `urgencyScore ≥ 0.7` — no human action. (FR-3.4)
- [ ] 3.6 Idempotency test: `advance()` called twice on one state emits one event.

**Pace gate (end Day 3):** photo → items in DB → urgency computed → an `AgentRun` sits queued at `PREDICTED`, and every step of that appears in the feed API. If not met, cut P3 business users now.

---

## Checkpoint 2 — Days 4–7: The agentic core *(highest value — protect this time)*

### Day 4 — Candidate selection
- [ ] 4.1 Geo helpers: haversine, 2dsphere `$near` queries, ~200 m coordinate fuzzing in the serialiser. (FR-8.4, §8)
- [ ] 4.2 Deterministic candidate scoring from design §4.3 with penalties; persist the full ranked set with sub-scores. (FR-4.1)
- [ ] 4.3 Unit tests: scoring, tie-breaks, penalty cases, empty-candidate case.
- [ ] 4.4 LLM justification (≤ 45 words) naming the deciding factors; stored on the `Match`. (FR-4.2)

### Day 5 — The exchange
- [ ] 5.1 Negotiation Agent tools: `send_offer`, `evaluate_counter`, `accept_terms`, `escalate_to_next_candidate`, `fallback_to_compost`. (FR-4.3)
- [ ] 5.2 `SimulatedPartnerAgent` — **separate context, own system prompt from the seeded persona, tools limited to `accept`/`counter_offer`/`decline`, no visibility into donor reasoning.** This is the originality core; do not shortcut it into one prompt. (FR-4.4)
- [ ] 5.3 Turn protocol with a 6-turn / 60 s cap; every turn appended to `Match.transcript` and emitted as an `AgentEvent`. (FR-4.5)
- [ ] 5.4 Counter-offer evaluation against the freshness deadline: accept / counter once / escalate. (FR-4.6)
- [ ] 5.5 Escalation (max 2) then compost fallback, recorded as failed-but-diverted. (FR-4.7)
- [ ] 5.6 `ALLOW_REAL_OUTREACH` gate defaulting to `false`. (FR-4.8, §8)
- [ ] 5.7 Integration tests for all four paths: accept, counter→accept, escalate→accept, all-decline→compost.

### Day 6 — Logistics
- [ ] 6.1 `scripts/geocode-seed.ts`: Nominatim once at authoring time, commit real Lucknow coordinates to `data/seed-lucknow.json`. (FR-5.5)
- [ ] 6.2 OSRM routing client + cached-route + haversine fallback chain, each returning its `method` label. (FR-5.2, FR-5.4)
- [ ] 6.3 Pickup-window proposal respecting operating hours and `actByAt`. (FR-5.1)
- [ ] 6.4 Multi-stop clustering with `savedKm` versus separate trips. (FR-5.3)

### Day 7 — Impact and end-to-end
- [ ] 7.1 Impact Agent with per-category factor lookup; `notQuantified` when a factor is missing. (FR-6.1, FR-6.5)
- [ ] 7.2 Separate `REDISTRIBUTED` (avoided production) from `COMPOSTED` (landfill diversion only) math. (FR-6.4)
- [ ] 7.3 `ImpactLog` persists the factor values and source used, so the methodology sheet reads from the record and cannot drift. (FR-6.3)
- [ ] 7.4 Unit tests for both outcome paths.
- [ ] 7.5 **End-to-end orchestrator run in tests: perception → impact, no UI.** (FR-11.2)

**Pace gate (end Day 7):** a full run completes headlessly in under 60 s, including a counter-offer, with the entire causal chain in `AgentEvent`. This is the make-or-break gate. If it slips, cut the leaderboard and the Telegram bot before touching this.

---

## Checkpoint 3 — Days 8–10: Product surface

### Day 8 — The "aha" screen
- [ ] 8.1 Activity Feed component: timeline, `causedBy` connector line, per-agent attribution, plain-language `summary`, raw payload behind "details". (FR-7.2, FR-7.3, FR-7.4)
- [ ] 8.2 SSE `/api/runs/[id]/stream` + 1 s polling fallback; ≤ 3 s visibility verified with a stopwatch. (FR-7.1, NFR-2)
- [ ] 8.3 Live in-flight indicator for the currently acting agent (text + spinner, not colour alone). (FR-7.5, NFR-7)
- [ ] 8.4 `aria-live="polite"`, keyboard-focusable cards, visible focus rings. (NFR-7)

### Day 9 — Map and pantry
- [ ] 9.1 MapLibre + OSM tiles centred on Lucknow; legend always visible. (FR-8.1)
- [ ] 9.2 Five pin types distinguished by **shape and** colour; selection panel with item summary, urgency, match state. (FR-8.2, FR-8.3)
- [ ] 9.3 Exact-coordinate release only to the matched recipient after `AGREED`; fuzzed everywhere else. (FR-8.4)
- [ ] 9.4 Personal dashboard: pantry state + expiry timeline sorted by `actByAt` + embedded feed. (FR-9.1)

### Day 10 — Impact surface and replay
- [ ] 10.1 Impact dashboard: three stat blocks, personal ⇄ city toggle. (FR-9.2)
- [ ] 10.2 Methodology bottom-sheet: factor value, unit, dataset, year, link — one tap from every number. (FR-6.3)
- [ ] 10.3 Streak + partner leaderboard, restrained styling. No badges, mascots, or confetti. (FR-9.3)
- [ ] 10.4 `/runs/[id]` turn-by-turn negotiation replay with scrub control. _This is the screen the video holds on._ (FR-4.5)
- [ ] 10.5 390 px pass over every screen; fix thumb-reach on feed and map. (NFR-1)

**Pace gate (end Day 10):** the demo is presentable end-to-end in a browser at phone width. Everything after this is additive.

---

## Checkpoint 4 — Days 11–12: Telegram channel *(the explicit "Learning" component)*

- [ ] 11.1 `/api/telegram/webhook` with `X-Telegram-Bot-Api-Secret-Token` verification → `401` on mismatch. (FR-10.4, §8)
- [ ] 11.2 `/start <linkCode>` binds a Telegram chat to a `RECIPIENT` account. (FR-10.3)
- [ ] 11.3 Outreach delivery with inline `Accept` / `Suggest another time` / `Decline` buttons. (FR-10.1)
- [ ] 11.4 `TelegramPartnerAgent` behind the same interface as `SimulatedPartnerAgent` — orchestrator stays agnostic. (design §4.4)
- [ ] 12.1 Callback handling updates the `Match` within 3 s and emits an `AgentEvent` into the donor's feed. (FR-10.2)
- [ ] 12.2 Local dev long-poll script (no tunnel needed); production webhook registration script.
- [ ] 12.3 Verify the whole flow works for a recipient who has never opened the web app. (FR-10.5)
- [ ] 12.4 Write down what was new/hard here while it is fresh — this becomes README + video content. (Learning criterion)

**Pace gate (end Day 12):** an accept from Telegram moves a match forward and shows up in the web feed. If Day 11 opens and Checkpoint 3 is incomplete, cut the bot and reallocate — but then remove the Learning claim from the video and lean on multi-agent orchestration instead.

---

## Checkpoint 5 — Days 13–14: Hardening and submission

### Day 13 — Determinism and hardening
- [ ] 13.1 `npm run seed`: wipe + rebuild from `data/seed-lucknow.json` with a fixed RNG seed; idempotent and re-runnable mid-demo. (FR-11.1)
- [ ] 13.2 Seed content: 3–4 partner orgs modelled on real Lucknow-relevant operations (Robin Hood Army-style chapter, community fridge, gurdwara langar surplus, compost/biogas point) with real geocoded coordinates, `provenance` strings, and `disposition` personas. Never a fabricated partnership claim. (requirements §2)
- [ ] 13.3 Verify every fallback chain by disabling each dependency in turn; confirm the UI labels each one. (FR-11.3, design §7)
- [ ] 13.4 Playwright smoke test over the exact demo path against fresh seed. (design §10)
- [ ] 13.5 Cost check: full run under ~$0.15; per-run cost visible in feed details. (NFR-9)
- [ ] 13.6 Secret scan; confirm no key in git history; `.env.example` complete. (NFR-4)
- [ ] 13.7 Deploy to production, register the Telegram webhook, run the demo 3× from a fresh seed. **Three clean consecutive runs is the completion bar.** (FR-11.2)

### Day 14 — Deliverables
- [ ] 14.1 README per requirements §11: what it is, the five agents, **every real data source named with links**, setup steps, `npm run seed`, env vars, explicit statement that it was built entirely within the 14-day hackathon window, and an explicit "what was new to me" section (Telegram bot + multi-agent orchestration).
- [ ] 14.2 Architecture summary section in README, auto-maintained by the architecture hook.
- [ ] 14.3 Record the 5-minute video to the Section 11 timing:
  - 0:00–0:30 the Lucknow problem in human terms — the coordination overhead, not statistics
  - 0:30–2:00 live agentic negotiation, including a counter-offer changing the outcome, and the losing candidates
  - 2:00–3:30 Telegram accept + impact dashboard with the methodology sheet
  - 3:30–4:30 architecture: name all five agents, name USDA FoodKeeper / Poore & Nemecek / OSRM
  - 4:30–5:00 what was learned + what you would extend
- [ ] 14.4 Verify the deployed link works from a fresh browser session and a phone.
- [ ] 14.5 Final commit history tidy-up; submit repo + live link + video.

**Pace gate (end Day 14):** repo public, live link works on a phone, video uploaded, README names every data source.

---

## Cut Order (pre-committed — apply without re-deliberating)

1. P3 business / recurring-stream users
2. City leaderboard
3. Telegram bot (and drop the Learning claim that depends on it)
4. Route optimisation → haversine only

**Never cut:** the agent-to-agent negotiation and its visibility. That is the project.

---

## Daily Habits

- Commit at least twice a day with meaningful messages — commit history is judged.
- Re-run `npm run seed` + the demo path every evening from Day 7. A demo that worked yesterday is not evidence it works today.
- Keep a running `NOTES.md` of what surprised you; it writes the Learning section for free.
