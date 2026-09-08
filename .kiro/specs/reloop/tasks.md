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
- [x] 1.1 Scaffold Next.js + TypeScript `strict` + Tailwind v4; set up the palette tokens from design §6.1. (NFR-1, NFR-5) — **Next 16, not 15:** Next 15 pulls a vulnerable postcss transitively and the only fix is the major bump. Taken on day one while it was free.
- [x] 1.2 ESLint + Prettier + Vitest + `tsc --noEmit` wired into `npm run check`. — **`eslint-config-next` is not used:** it bundles an eslint-plugin-react build that calls the pre-10 rule context API and crashes the run. Composed `@next/eslint-plugin-next` + `eslint-plugin-react-hooks` + `typescript-eslint` directly instead. The agents-must-not-import-each-other invariant is enforced here as a lint rule.
- [x] 1.3 Mongoose connection helper with serverless connection caching; `.env.example` with every variable documented. (NFR-4, NFR-8)
- [x] 1.4 All schemas from design §5: `User`, `RecipientProfile`, `InventoryItem`, `Match`, `AgentRun`, `AgentEvent`, `ImpactLog`, plus the indexes. (FR-1, FR-7)
- [x] 1.5 Auth: register, login, logout; Argon2id; `jose` JWT in an HTTP-only cookie; route-handler session guard. (FR-1.1, FR-1.3, §8)
- [x] 1.6 **`AgentEvent` write helper + the feed API endpoint, on day one.** (FR-7.1)

### Day 2 — Reference data and Perception
- [x] 2.1 `data/shelf-life.json` — 32 categories relevant to Indian households, every row with a source note. (FR-3.2, FR-3.3) **Known gap:** the FSIS FoodKeeper feed returns HTTP 403 to automated download, so the table was authored by hand. 11 rows are `verified: true` against the FDA Cold Food Storage Chart (the safety-critical ones: cooked leftovers, raw poultry, raw fish, eggs, milk, paneer); 21 are category generalisations awaiting a manual FoodKeeper pass. Documented in `data/README.md` and warned on every `verify:sources` run.
- [x] 2.2 `data/impact-factors.json` — real Poore & Nemecek 2018 CO2e/water/land values fetched from the Our World in Data series, with per-row commodity group, proxy flag and proxy rationale. Proxies that would overstate a saving (paneer, ghee, oil) deliberately use the conservative group. Materials are `notQuantified` rather than estimated. (FR-6.2, FR-6.4, FR-6.5)
- [x] 2.3 `src/scripts/verify-sources.ts` — fails on a missing source, a category with no row, an unknown category, a duplicate row, or a quantified row with no named commodity group. Wired into `npm run check`. (FR-6.5)

- [x] 2.4 Agent interface, `AgentContext`, tool registry with per-agent scoped tool access enforced by `assertMayUse` — and by a lint rule that forbids one agent importing another. (design §4)
- [x] 2.5 Perception Agent: upload route, vision call, Zod-validated `ExtractedItem[]`, confidence gating at 0.6. (FR-2.1, FR-2.2)
- [x] 2.6 Fixture layer resolving by image SHA-256 plus an explicit demo key; `fixture: true` flows to the UI. An unrecognised upload degrades to manual entry rather than inventing items. (FR-2.6, FR-11.4)
- [x] 2.7 Upload UI with inline correction; the original extraction is kept for the feed. (FR-2.4, FR-2.5)

### Day 3 — Prediction and the orchestrator spine
- [x] 3.1 Prediction Agent: deterministic urgency formula, `actByAt`, `lowConfidence`. (FR-3.1, FR-3.5)
- [x] 3.2 Unit tests for the urgency formula at boundaries. (design §10)
- [x] 3.3 Orchestrator state machine: `advance(run)` one-step-per-call, `lockedUntil` lease, idempotency guard. (design §3.1)
- [x] 3.4 `/api/cron/tick` sweep over `{state, nextActionAt}` + `vercel.json` cron config, secret-gated. (NFR-8)
- [x] 3.5 Auto-enqueue a negotiation run when `urgencyScore ≥ 0.7` — no human action. (FR-3.4)
- [x] 3.6 Idempotency test: concurrent `advance()` calls yield one event, the loser reports `locked`.

**Pace gate (end Day 3):** photo → items in DB → urgency computed → an `AgentRun` sits queued at `PREDICTED`, and every step of that appears in the feed API. If not met, cut P3 business users now.

---

## Checkpoint 2 — Days 4–7: The agentic core *(highest value — protect this time)*

### Day 4 — Candidate selection
- [x] 4.1 Geo helpers: haversine, 2dsphere `$near` queries, ~200 m coordinate fuzzing in the serialiser. (FR-8.4, §8)
- [x] 4.2 Deterministic candidate scoring from design §4.3 with penalties; persist the full ranked set with sub-scores. (FR-4.1)
- [x] 4.3 Unit tests: scoring, tie-breaks, penalty cases, empty-candidate case.
- [x] 4.4 LLM justification (≤ 45 words) naming the deciding factors; stored on the `Match`. (FR-4.2)

### Day 5 — The exchange
- [x] 5.1 Negotiation Agent tools: `send_offer`, `evaluate_counter`, `accept_terms`, `escalate_to_next_candidate`, `fallback_to_compost`. (FR-4.3)
- [x] 5.2 `SimulatedPartnerAgent` — **separate context, own system prompt from the seeded persona, tools limited to `accept`/`counter_offer`/`decline`, no visibility into donor reasoning.** This is the originality core; do not shortcut it into one prompt. (FR-4.4)
- [x] 5.3 Turn protocol with a 6-turn / 60 s cap; every turn appended to `Match.transcript` and emitted as an `AgentEvent`. (FR-4.5)
- [x] 5.4 Counter-offer evaluation against the freshness deadline: accept / counter once / escalate. (FR-4.6)
- [x] 5.5 Escalation (max 2) then compost fallback, recorded as failed-but-diverted. (FR-4.7)
- [x] 5.6 `ALLOW_REAL_OUTREACH` gate defaulting to `false`. (FR-4.8, §8)
- [x] 5.7 Integration tests for all four paths: accept, counter→accept, escalate→accept, all-decline→compost.

### Day 6 — Logistics
- [x] 6.1 `scripts/geocode-seed.ts`: Nominatim once at authoring time, commit real Lucknow coordinates to `data/seed-lucknow.json`. (FR-5.5)
- [x] 6.2 OSRM routing client + cached-route + haversine fallback chain, each returning its `method` label. (FR-5.2, FR-5.4)
- [x] 6.3 Pickup-window proposal respecting operating hours and `actByAt`. (FR-5.1)
- [x] 6.4 Multi-stop clustering with `savedKm` versus separate trips. (FR-5.3)

### Day 7 — Impact and end-to-end
- [x] 7.1 Impact Agent with per-category factor lookup; `notQuantified` when a factor is missing. (FR-6.1, FR-6.5)
- [x] 7.2 Separate `REDISTRIBUTED` (avoided production) from `COMPOSTED` (landfill diversion only) math. (FR-6.4)
- [x] 7.3 `ImpactLog` persists the factor values and source used, so the methodology sheet reads from the record and cannot drift. (FR-6.3)
- [x] 7.4 Unit tests for both outcome paths.
- [x] 7.5 **End-to-end orchestrator run in tests: perception → impact, no UI.** (FR-11.2)

**Pace gate (end Day 7):** a full run completes headlessly in under 60 s, including a counter-offer, with the entire causal chain in `AgentEvent`. This is the make-or-break gate. If it slips, cut the leaderboard and the Telegram bot before touching this.

---

## Checkpoint 3 — Days 8–10: Product surface

### Day 8 — The "aha" screen
- [x] 8.1 Activity Feed component: timeline, `causedBy` connector line, per-agent attribution, plain-language `summary`, raw payload behind "details". (FR-7.2, FR-7.3, FR-7.4)
- [x] 8.2 SSE `/api/runs/[id]/stream` + 1 s polling fallback; ≤ 3 s visibility verified with a stopwatch. (FR-7.1, NFR-2)
- [x] 8.3 Live in-flight indicator for the currently acting agent (text + spinner, not colour alone). (FR-7.5, NFR-7)
- [x] 8.4 `aria-live="polite"`, keyboard-focusable cards, visible focus rings. (NFR-7)

### Day 9 — Map and pantry
- [x] 9.1 MapLibre + OSM tiles centred on Lucknow; legend always visible. (FR-8.1)
- [x] 9.2 Five pin types distinguished by **shape and** colour; selection panel with item summary, urgency, match state. (FR-8.2, FR-8.3)
- [x] 9.3 Exact-coordinate release only to the matched recipient after `AGREED`; fuzzed everywhere else. (FR-8.4)
- [x] 9.4 Personal dashboard: pantry state + expiry timeline sorted by `actByAt` + embedded feed. (FR-9.1)

### Day 10 — Impact surface and replay
- [x] 10.1 Impact dashboard: three stat blocks, personal ⇄ city toggle. (FR-9.2)
- [x] 10.2 Methodology bottom-sheet: factor value, unit, dataset, year, link — one tap from every number. (FR-6.3)
- [x] 10.3 Streak + partner leaderboard, restrained styling. No badges, mascots, or confetti. (FR-9.3)
- [x] 10.4 `/runs/[id]` turn-by-turn negotiation replay with scrub control. _This is the screen the video holds on._ (FR-4.5)
- [x] 10.5 390 px pass over every screen; fix thumb-reach on feed and map. (NFR-1)

**Pace gate (end Day 10):** the demo is presentable end-to-end in a browser at phone width. Everything after this is additive.

---

## Checkpoint 4 — Days 11–12: Telegram channel *(the explicit "Learning" component)*

- [x] 11.1 `/api/telegram/webhook` with `X-Telegram-Bot-Api-Secret-Token` verification → `401` on mismatch. (FR-10.4, §8)
- [x] 11.2 `/start <linkCode>` binds a Telegram chat to a `RECIPIENT` account. (FR-10.3)
- [x] 11.3 Outreach delivery with inline `Accept` / `Suggest another time` / `Decline` buttons. (FR-10.1)
- [x] 11.4 `TelegramPartnerAgent` behind the same interface as `SimulatedPartnerAgent` — orchestrator stays agnostic. (design §4.4)
- [x] 12.1 Callback handling updates the `Match` within 3 s and emits an `AgentEvent` into the donor's feed. (FR-10.2)
- [x] 12.2 Local dev long-poll script (no tunnel needed); production webhook registration script.
- [x] 12.3 Verify the whole flow works for a recipient who has never opened the web app. (FR-10.5)
- [x] 12.4 Write down what was new/hard here while it is fresh — this becomes README + video content. (Learning criterion)

**Pace gate (end Day 12):** an accept from Telegram moves a match forward and shows up in the web feed. If Day 11 opens and Checkpoint 3 is incomplete, cut the bot and reallocate — but then remove the Learning claim from the video and lean on multi-agent orchestration instead.

---

## Checkpoint 5 — Days 13–14: Hardening and submission

### Day 13 — Determinism and hardening
- [x] 13.1 `npm run seed`: wipe + rebuild from committed data with fixed ids; idempotent and re-runnable mid-demo. Verified by `tests/integration/seed.test.ts` and from the CLI. Coordinates live in `data/seed-places.json`. (FR-11.1)
- [x] 13.2 Seed content: 3–4 partner orgs modelled on real Lucknow-relevant operations (Robin Hood Army-style chapter, community fridge, gurdwara langar surplus, compost/biogas point) with real geocoded coordinates, `provenance` strings, and `disposition` personas. Never a fabricated partnership claim. (requirements §2)
- [~] 13.3 Fallback chains. **Verified:** the model path with no API key (fixtures, labelled in the UI), Telegram with no token (falls through to the simulated partner with a `simulated_recipient` label), a missing impact factor (`not quantified`), and an unverified shelf-life row (`shelf life is a category estimate`). **Not yet verified by disabling it:** OSRM → cached → haversine, since the smoke run reached the live router. Force it with an unreachable `OSRM_BASE_URL` and confirm the feed says "straight-line estimate". (FR-11.3, design §7)
- [x] 13.4 Demo-path smoke test against a fresh seed — `npm run smoke`, over HTTP against the production build, asserting the run reaches `IMPACT_LOGGED` with both sides in the transcript. Replaces Playwright; see design §14. **Does not cover 390 px layout or client behaviour.** (design §10)
- [ ] 13.5 Cost check against the live API. Fixture runs cost $0, so the ceiling is untested; per-run cost is recorded on `AgentRun` and shown in feed details. Run once with `DEMO_MODE=false` and read the figure off the replay page. (NFR-9)
- [x] 13.6 `.env.local` confirmed gitignored and absent from the index; `.env.example` documents every variable. A full history scan is worth one more pass before the repo goes public. (NFR-4)
- [ ] 13.7 Deploy to production, register the Telegram webhook, run the demo 3× from a fresh seed. **Three clean consecutive runs is the completion bar.** (FR-11.2)

### Day 14 — Deliverables
- [x] 14.1 README per requirements §11: what it is, the five agents, **every real data source named with links**, setup steps, `npm run seed`, env vars, explicit statement that it was built entirely within the 14-day hackathon window, and an explicit "what was new to me" section (Telegram bot + multi-agent orchestration).
- [x] 14.2 Architecture summary section in README, auto-maintained by the architecture hook.
- [ ] 14.3 Record the 5-minute video to the Section 11 timing:
  - 0:00–0:30 the Lucknow problem in human terms — the coordination overhead, not statistics
  - 0:30–2:00 live agentic negotiation, including a counter-offer changing the outcome, and the losing candidates
  - 2:00–3:30 Telegram accept + impact dashboard with the methodology sheet
  - 3:30–4:30 architecture: name all five agents, name USDA FoodKeeper / Poore & Nemecek / OSRM
  - 4:30–5:00 what was learned + what you would extend
- [ ] 14.4 Verify the deployed link works from a fresh browser session and a phone. **Includes the 390 px pass, which nothing automated covers.**
- [ ] 14.5 Final commit history tidy-up; submit repo + live link + video.

---

## What is actually left

Everything in checkpoints 1–4 is built and verified: 102 tests including orchestrator integration
tests against a real MongoDB, plus `npm run smoke` driving a full run over HTTP.

Left for you, because none of it can be done from here:

1. **Accounts** (checkpoint 0) — Atlas cluster, Vercel project, Anthropic key, BotFather bot.
2. **Deploy** (13.7, 14.4) — then three clean demo runs from a fresh seed.
3. **A 390 px pass by hand** — no automated check covers layout or client behaviour.
4. **One live-model run** (13.5) to confirm the cost ceiling and that live wording reads well.
5. **The OSRM fallback check** (13.3) with an unreachable router.
6. **The video** (14.3).
7. **The FoodKeeper reconciliation** — 21 shelf-life rows are still category generalisations. About
   an hour with the spreadsheet; `npm run verify:sources` prints the count on every run.

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
