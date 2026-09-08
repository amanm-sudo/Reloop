# ReLoop — Requirements

**Status:** Draft for review. No implementation begins until this and `design.md` are approved.
**Window:** 14 days, solo developer.
**One-line:** A network of five cooperating AI agents that intercepts food/material surplus before it becomes waste by making the *coordination* autonomous.

---

## 1. Problem Statement

In Tier-2/3 Indian cities such as Lucknow, surplus edible food rarely reaches a recovery
organisation. The blocker is not willingness and not a lack of recipients — recovery
networks exist (FSSAI's Indian Food Sharing Alliance lists food-recovery agencies
nationally, and volunteer networks such as Robin Hood Army operate on surplus
redistribution). The blocker is **coordination overhead** per event: who do I call, is
this quantity worth a trip, is it still safe, when can someone collect, and is the
15 minutes of phone calls worth 400g of spinach?

Every existing tool answers "where can I list this?" ReLoop answers "who is already
handling this on my behalf?" The listing/browsing burden is removed entirely: agents
detect, decide, negotiate, schedule, and quantify.

### 1.1 Non-goals (explicit anti-scope)

These are rejected by design; a feature request that reduces to one of them must be
pushed back on:

| Rejected | Reason |
| --- | --- |
| Recyclable-vs-non-recyclable image classifier as centerpiece | Saturated pattern for this track; no coordination value |
| Static "list your surplus" marketplace | Puts the coordination burden back on the human |
| Carbon calculator with invented multipliers | Unciteable numbers destroy credibility |
| Smart-bin fill-level dashboard | Measures waste after it exists; ReLoop is preventive |
| Any "form + one LLM call" feature | Not agentic; fails the Technology criterion |

---

## 2. Users

| # | Persona | Need | Priority |
| --- | --- | --- | --- |
| P1 | Individual / household (demo persona: Ananya, Gomti Nagar, Lucknow) | Surplus leaves the house before spoiling, with zero coordination work | Must |
| P2 | Local recovery org / community fridge / langar surplus programme | Receive only matches that fit capacity, category and timing; accept without installing an app | Must |
| P3 | Small business — kirana store, canteen, event caterer | Handle a *recurring* surplus stream (industrial-symbiosis-at-small-scale angle) | Stretch |

**Real-world grounding for seed data (referenced, never claimed as partnerships):**
- [Robin Hood Army](https://robinhoodarmy.com/) — volunteer, zero-funds surplus redistribution model, chapter-based, operates on restaurant/community surplus.
- [Feeding India](https://www.feedingindia.org/) — national food/nutrition programme.
- [FSSAI Share Food Save Food / Indian Food Sharing Alliance](https://sharefood.fssai.gov.in/) — the government-backed network of food recovery agencies; defines the operating model ReLoop's partner profiles are modelled on.
- Gurdwara langar surplus programmes — high-volume, cooked-food, same-day recovery pattern.

> **Hard rule:** partner profiles in the UI carry a `provenance` field rendered as
> "Public profile — modelled on how <Org> operates. Not an active partnership."
> No fabricated partnership claim appears in the app or the demo narration.

---

## 3. Functional Requirements

Acceptance criteria use EARS-style `WHEN/IF … THEN the system SHALL …`.

### FR-1 — Accounts and identity

**User story:** As a household user, I want to sign in with minimal friction so I can
start using ReLoop in under a minute.

1. WHEN a visitor submits a valid email and password THEN the system SHALL create a `User` with a home location and issue an HTTP-only session cookie.
2. WHEN a user has no home location set THEN the system SHALL require one (map-pin or address search) before any surplus can be posted, because every downstream agent depends on coordinates.
3. IF a request to any authenticated API route lacks a valid session THEN the system SHALL respond `401` and SHALL NOT leak whether the referenced resource exists.
4. The system SHALL support a `RECIPIENT` account type (partner org) with capacity, accepted categories, and coverage radius.
5. Auth SHALL NOT be extended with OAuth providers, RBAC hierarchies, or email verification flows within the 14-day window.

### FR-2 — Perception Agent

**User story:** As a household user, I want to photograph groceries or a receipt and have
my pantry populate itself, so logging is not a chore.

1. WHEN a user uploads a photo of groceries or a receipt THEN the Perception Agent SHALL return a structured list of `{name, category, quantity, unit, confidence}` items within 15 seconds.
2. WHEN an extracted item has `confidence < 0.6` THEN the system SHALL surface it as "needs confirmation" and SHALL NOT let it trigger an autonomous match until confirmed.
3. WHEN extraction completes THEN the system SHALL persist one `AgentEvent` per run containing the model used, token/latency cost, and a one-sentence rationale.
4. WHEN the user edits an extracted quantity or category THEN the system SHALL store the correction on the item and keep the original extraction for the activity feed.
5. IF the vision provider errors or times out THEN the system SHALL fall back to manual entry with a visible, non-blocking notice — never a blank failure.
6. IF `DEMO_MODE=true` THEN the Perception Agent SHALL resolve from deterministic fixtures keyed by image checksum, and the UI SHALL label the run "demo fixture".

### FR-3 — Prediction Agent

**User story:** As a household user, I want to know which item needs to move *now*, not a
generic expiry date.

1. WHEN an `InventoryItem` is created THEN the Prediction Agent SHALL compute an `actByAt` timestamp and an `urgencyScore` in `[0,1]`.
2. The Prediction Agent SHALL derive baseline shelf life from a lookup table extracted from the [USDA FoodKeeper](https://www.foodsafety.gov/keep-food-safe/foodkeeper-app) dataset, adjusted for storage state (`PANTRY | FRIDGE | FREEZER`) and cooked-vs-raw.
3. Each shelf-life row SHALL carry `source` and `sourceNote` fields; the system SHALL NOT contain any shelf-life number without one.
4. WHEN `urgencyScore` crosses the act-now threshold (default `0.7`) THEN the system SHALL enqueue a negotiation run automatically, without user action.
5. WHEN a category has no lookup entry THEN the Prediction Agent SHALL use the category's conservative floor and SHALL mark the estimate `lowConfidence: true`.

### FR-4 — Negotiation Agent (the core mechanic)

**User story:** As a household user, I want an agent to choose the right recipient and do
the asking, and I want to see *why* it chose them.

1. WHEN a negotiation run starts THEN the Negotiation Agent SHALL score candidate recipients on distance, declared capacity, category fit, and remaining freshness window, and SHALL persist the ranked candidate set with per-candidate scores.
2. WHEN a recipient is selected THEN the agent SHALL persist a natural-language `justification` (≤ 45 words) naming the deciding factors.
3. WHEN a recipient is selected THEN the agent SHALL draft an outreach message tailored to that recipient's profile and channel.
4. WHEN the counterparty is a simulated partner THEN the system SHALL run a genuine agent-to-agent exchange: the partner agent SHALL be a **separate agent with its own system prompt, own persona state, and its own tool set** (`accept`, `counter_offer`, `decline`) — it SHALL NOT be the same context role-playing both sides.
5. The full exchange SHALL complete in under 60 seconds wall-clock and SHALL be replayable turn-by-turn in the UI.
6. WHEN a partner agent counters (different time, partial quantity) THEN the Negotiation Agent SHALL evaluate the counter against the freshness deadline and either accept, counter once, or fall through to the next-ranked recipient.
7. IF no recipient accepts within the freshness window THEN the system SHALL escalate to the compost/biogas fallback route and SHALL record the redistribution attempt as failed-but-diverted.
8. The Negotiation Agent SHALL NOT send outreach to a real external contact unless `ALLOW_REAL_OUTREACH=true`; default is simulated.

### FR-5 — Logistics Agent

**User story:** As a recipient org, I want a concrete pickup window and route, not "sometime today."

1. WHEN a match reaches `AGREED` THEN the Logistics Agent SHALL propose up to three pickup windows that respect the recipient's operating hours and the item's `actByAt`.
2. The agent SHALL compute travel distance and duration from a real routing service (OSRM / Google Directions) using real Lucknow coordinates.
3. WHEN multiple matches share a recipient and overlap in time THEN the agent SHALL propose a single multi-stop pickup and SHALL state the distance saved versus separate trips.
4. IF the routing service is unavailable THEN the system SHALL fall back to cached seed routes, then to haversine straight-line distance, and SHALL label which method produced the number.
5. Coordinates SHALL be real (geocoded once at seed time and committed); the system SHALL NOT contain invented lat/lng pairs.

### FR-6 — Impact Agent

**User story:** As a user, I want to know what was actually saved, in real units, with a
source I can check.

1. WHEN a match reaches `COMPLETED` THEN the Impact Agent SHALL compute avoided **kg CO2e**, **litres of freshwater**, and **m² land use** for the diverted mass.
2. Factors SHALL come from a cited published dataset — primary: Poore & Nemecek (2018), *Science*, per-kg GHG / land / freshwater-withdrawal factors as published via [Our World in Data](https://ourworldindata.org/environmental-impacts-of-food); secondary cross-check: [WRAP UK household food waste carbon figures](https://www.wrap.ngo/resources/report/household-food-and-drink-waste-united-kingdom-2021-22).
3. Every impact number rendered in the UI SHALL have a methodology affordance within one tap, showing factor value, unit, dataset name, year, and a link.
4. The Impact Agent SHALL distinguish **redistributed** (full avoided-production credit) from **composted** (diverted-from-landfill credit only) and SHALL NOT report them as equivalent.
5. The system SHALL NOT display an impact number whose factor lacks a `source` field. A missing factor renders as "not quantified" rather than an estimate.

### FR-7 — Agent Activity Feed (the "aha" screen)

**User story:** As a user, I want to watch the system work on my behalf in language I
understand.

1. WHEN any agent takes an action THEN the corresponding `AgentEvent` SHALL be visible in the feed within 3 seconds.
2. Each event SHALL render as one plain-language sentence — e.g. *"Noticed 400g spinach expiring in 18h → matched Robin Hood Army (2.1 km) → pickup proposed 6:30 PM → ~1.2 kg CO2e saved"* — with raw payload available behind a "details" disclosure.
3. The feed SHALL visually attribute each event to its agent (five distinct identities) and SHALL show the causal chain between events in a run.
4. The feed SHALL NOT show raw JSON, stack traces, or model IDs at the top level.
5. WHEN a run is in progress THEN the feed SHALL show a live in-flight indicator for the currently acting agent.

### FR-8 — Map surface

1. The system SHALL render a live interactive map (not a static image) centred on Lucknow.
2. Pins SHALL be visually distinct for: household surplus, partner org, pickup in progress, completed today, compost/biogas point.
3. WHEN a pin is selected THEN the system SHALL show item summary, urgency, and current match state.
4. Household exact coordinates SHALL be fuzzed to ~200 m in any public/city view; exact location SHALL be revealed only to the matched recipient after `AGREED`.

### FR-9 — Dashboards

1. The personal dashboard SHALL show pantry state, an expiry timeline ordered by `actByAt`, and the activity feed.
2. The impact dashboard SHALL show personal cumulative and city-wide cumulative CO2e / water / land, plus a streak metric.
3. Gamification SHALL be limited to streak + city total + a partner leaderboard. No badges, mascots, confetti, or points-without-units.

### FR-10 — Telegram channel

**User story:** As an NGO coordinator with no time to learn an app, I want to accept a
pickup by replying to a message.

1. WHEN a match is offered to a recipient with a linked Telegram chat THEN the system SHALL deliver the outreach message with inline `Accept` / `Suggest another time` / `Decline` actions.
2. WHEN a recipient taps an action THEN the system SHALL update the match within 3 seconds and SHALL emit an `AgentEvent` visible in the donor's feed.
3. The bot SHALL support `/start <linkCode>` to bind a Telegram chat to a `RECIPIENT` account.
4. The webhook SHALL verify the Telegram secret token and SHALL reject unverified requests with `401`.
5. The bot SHALL be usable by a recipient who has never opened the web app.

### FR-11 — Demo reliability

1. `npm run seed` SHALL wipe and rebuild a deterministic, geographically coherent Lucknow dataset from a committed fixture file, with a fixed RNG seed.
2. The full flow — photo → extraction → urgency → agent-to-agent negotiation → pickup window → impact — SHALL be demonstrable live in under 90 seconds without any external human responding.
3. Every external dependency (LLM, vision, routing, Telegram) SHALL have a labelled offline fallback, and the UI SHALL indicate when a fallback is in use.
4. `DEMO_MODE=true` SHALL make agent outputs deterministic for scripted narration while keeping the orchestration path identical to live mode.

---

## 4. Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NFR-1 | Mobile-first. All primary flows usable at 390 px width; feed and map are thumb-reachable. |
| NFR-2 | Agent action → UI visibility ≤ 3 s. |
| NFR-3 | Full negotiation run ≤ 60 s. |
| NFR-4 | No secret in source. All keys via env; a committed `.env.example` documents every var. |
| NFR-5 | TypeScript `strict: true`. No `any` in agent or data layers. |
| NFR-6 | Every agent decision is auditable: input snapshot, tool calls, output, rationale, timestamp, latency, cost. |
| NFR-7 | Accessible: keyboard-navigable feed and map controls, visible focus rings, WCAG AA contrast on the chosen palette, `aria-live` on the feed. Full conformance needs manual AT testing — not claimed. |
| NFR-8 | Deployable as a single Next.js app (Vercel) plus MongoDB Atlas. No separate always-on server required. |
| NFR-9 | Cost ceiling: a full demo run stays under ~$0.15 of model spend; fixtures used in `DEMO_MODE`. |

---

## 5. Design Constraints

- **Palette:** warm-neutral base (`#F7F4EF` paper, `#12100E` ink) with a single clay/terracotta accent (`#C9502F`) and an amber→red urgency scale. Explicitly **no** leaf icons, no green gradients, no recycling-triangle motifs.
- **Voice:** the feed speaks in short declarative sentences. Agents are named, not anthropomorphised into characters.
- **Motion:** used only to show causality between agent steps, never decoratively.

---

## 6. Out of Scope (14-day window)

Payments; volunteer driver marketplace; multi-city support; native mobile app; WhatsApp Cloud API; real-time chat between humans; ML-trained spoilage model (lookup table + rules instead); FSSAI compliance certification workflow.

---

## 7. Cut Order Under Time Pressure

1. Business / recurring-stream users (P3)
2. City leaderboard
3. Telegram bot
4. Route optimisation → haversine fallback

**Never cut:** agent-to-agent negotiation visibility. That is the project's identity.

---

## 8. Traceability to Judging Criteria

| Criterion | Where it is earned | Verified by |
| --- | --- | --- |
| Originality | FR-4.4 two independent agents negotiating; §1.1 anti-scope | Live replay of an exchange |
| Adherence to Track | FR-3 prevention + FR-4 redistribution + FR-6 quantification = closed loop | All three visible in one run |
| Completion | FR-11 seeded deterministic end-to-end demo | Fresh-clone → seed → demo, 3× |
| Learning | FR-10 Telegram bot + five-agent orchestration, stated in README/video | Named explicitly in both |
| Design | FR-7 activity feed as the "aha" screen; §5 palette; NFR-1 | 390 px walkthrough |
| Technology | Five distinct agents, real routing (FR-5.2), cited factors (FR-6.2), live bot | Architecture section of video |

---

## 9. Open Questions for Review

1. **Materials scope:** keep non-food reusable goods in v1 (strengthens "circular economy" beyond food) or food-only for depth? *Recommendation: food-first with a `MATERIAL` item type wired through the same pipeline but only 2–3 seeded examples.*
2. **Compost fallback:** model as a third partner type with real Lucknow composting/biogas points, or as an abstract sink? *Recommendation: real partner type — it completes the loop when redistribution fails.*
3. **Maps provider:** MapLibre + OSM tiles (no key, zero setup risk) vs Google Maps (better India POI data, needs billing). *Recommendation: MapLibre + OSM for tiles, OSRM for routing, no keys to leak.*
4. **Telegram timing:** Days 11–12 as scheduled, or pull the bot forward to Day 8 since it is the riskiest external approval path? *Recommendation: create the bot token on Day 1 (5 minutes, removes all approval risk) and implement on Days 11–12 as planned.*
