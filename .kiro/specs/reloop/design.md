# ReLoop — Design

**Status:** Draft for review alongside `requirements.md`. No code until approved.

---

## 1. Design Principles

1. **The blackboard is the product.** Agents never call each other directly. They read and
   write a shared `Match` document and append to an append-only `AgentEvent` log. That log
   is simultaneously the audit trail, the orchestration state, and the UI's "aha" screen.
   Building it as first-class data on Day 1 is what makes the feed free later.
2. **Two independent minds, not one prompt pretending.** The donor-side Negotiation Agent
   and the recipient-side Partner Agent are separate agents with separate system prompts,
   separate tool sets, and no shared context. Each sees only the messages exchanged. This
   is the single most important architectural decision in the project — it is the
   difference between "agentic" and "a chat wrapper."
3. **Every number has a citation or it does not render.** Impact and shelf-life factors
   carry `source` metadata through to the UI. A missing factor shows "not quantified."
4. **Degrade loudly, never silently.** Each external dependency has a labelled fallback
   chain. The UI always says which method produced a number.
5. **Deterministic by switch.** `DEMO_MODE` swaps model calls for fixtures without
   changing the orchestration path, so the demo is reliable and still honest.

---

## 2. Technology Decisions

| Concern | Choice | Rationale |
| --- | --- | --- |
| Framework | Next.js 15 (App Router), TypeScript `strict` | One deploy target, one language, server actions + route handlers cover the backend. Avoids a second Express service. |
| Styling | Tailwind CSS v4 + small local primitives | Fast, no component-library bloat, full control of the anti-cliché palette. |
| Database | MongoDB Atlas + Mongoose | Agent events and extracted inventory are heterogeneous documents; schema flexibility matters more than joins here. Match/User relations are shallow enough not to need Postgres. |
| LLM | Anthropic Claude (tool calling) via `@anthropic-ai/sdk`; vision for Perception | Native tool-use loop, strong structured output, one provider for all five agents. |
| Maps | MapLibre GL JS + OSM raster/vector tiles | Real live map, no API key to leak, zero billing risk. |
| Routing | OSRM HTTP API → cached seed routes → haversine | Real road distances with two labelled fallbacks. |
| Geocoding | Nominatim, **at seed time only**, results committed | Real coordinates, no runtime dependency, respects usage policy. |
| Messaging | Telegram Bot API via webhook route | Simplest approval path; works for users who will never open the web app. |
| Auth | Email + password, Argon2id, HTTP-only JWT cookie via `jose` | Deliberately minimal per FR-1.5. |
| Background work | Vercel Cron (1 min) + an idempotent `AgentRun` queue in Mongo | No always-on worker needed; survives serverless cold starts. |
| Live updates | SSE endpoint per active run, 1 s polling fallback | Meets the ≤3 s visibility requirement without WebSocket infrastructure. |
| Validation | Zod at every boundary, including LLM tool outputs | LLM output is untrusted input. |
| Tests | Vitest (unit + orchestrator integration), Playwright smoke on the demo path | Enough to protect the demo, not a test-suite project. |

**Rejected alternatives:** separate Express backend (two deploys, no benefit); PostgreSQL
(relational integrity not the bottleneck); LangChain/CrewAI (the orchestration is ~200
lines of explicit state machine and hiding it costs Technology legibility); WhatsApp Cloud
API (approval latency risk inside a 14-day window); WebSockets (serverless friction).

---

## 3. System Architecture

```
┌──────────────────────────── Next.js (Vercel) ─────────────────────────────┐
│                                                                            │
│  App Router UI (mobile-first)                                              │
│  ├─ /dashboard        pantry + expiry timeline + ACTIVITY FEED  ← "aha"     │
│  ├─ /map              MapLibre: households, partners, in-progress          │
│  ├─ /impact           personal + city totals, methodology sheet            │
│  └─ /runs/[id]        turn-by-turn negotiation replay                      │
│         │  SSE /api/runs/[id]/stream (1 s poll fallback)                   │
│         ▼                                                                  │
│  Route handlers / server actions                                           │
│  ├─ /api/perception          photo → items                                 │
│  ├─ /api/runs                enqueue + advance AgentRun                    │
│  ├─ /api/telegram/webhook    inbound partner replies                       │
│  └─ /api/cron/tick           Vercel Cron: sweep due runs                   │
│         │                                                                  │
│  ┌──────▼─────────────── Orchestrator (state machine) ─────────────────┐   │
│  │  advance(run) → one step per invocation, idempotent, resumable      │   │
│  │                                                                     │   │
│  │  PERCEIVED → PREDICTED → CANDIDATES_RANKED → OUTREACH_SENT          │   │
│  │      → NEGOTIATING ⇄ COUNTERED → AGREED → SCHEDULED                 │   │
│  │      → COMPLETED → IMPACT_LOGGED    (fail → COMPOST_DIVERTED)       │   │
│  └──────┬──────────┬──────────┬──────────┬──────────┬──────────────────┘   │
│         │          │          │          │          │                      │
│    Perception  Prediction  Negotiation  Logistics  Impact   ← 5 agents      │
│         │          │          │  ▲       │          │                      │
│         └──────────┴──────────┼──┼───────┴──────────┘                      │
│                               │  │                                          │
│              ┌────────────────▼──┴─────────────────┐                        │
│              │  BLACKBOARD (MongoDB)               │                        │
│              │  Match (shared state) +             │                        │
│              │  AgentEvent (append-only log)       │                        │
│              └─────────────────────────────────────┘                        │
│                               ▲                                             │
│                    separate context, separate tools                         │
│              ┌────────────────┴─────────────────┐                           │
│              │  PARTNER AGENT (recipient side)  │                           │
│              │  simulated persona | or real via Telegram                    │
│              └──────────────────────────────────┘                           │
└────────────────────────────────────────────────────────────────────────────┘
   External: Claude API · OSRM · OSM tiles · Telegram Bot API
```

### 3.1 Why a step-wise orchestrator

`advance(run)` performs exactly one state transition per call and is safe to re-enter.
Consequences: serverless timeouts can never leave a run wedged; the cron sweep resumes any
run whose `nextActionAt` has passed; the UI can drive a run forward on demand ("Run agents
now" demo button); and each transition is a natural `AgentEvent` boundary. A single
long-running `while` loop would give none of that.

Concurrency safety: each transition is a `findOneAndUpdate` guarded on the expected
`state` and a `lockedUntil` lease, so a cron tick and a user-triggered advance cannot
double-execute a step.

---

## 4. Agent Specifications

Every agent implements one interface. Uniformity is what makes the feed, the audit log,
the cost tracking, and the fixture fallback work identically for all five.

```ts
interface Agent<TIn, TOut> {
  readonly id: AgentId;            // 'perception' | 'prediction' | ...
  readonly displayName: string;    // shown in the feed
  readonly tools: ToolDef[];       // explicit, per-agent tool access
  run(input: TIn, ctx: AgentContext): Promise<AgentResult<TOut>>;
}

interface AgentResult<T> {
  output: T;                       // Zod-validated
  rationale: string;               // ≤ 45 words, feed-ready plain language
  toolCalls: ToolCallRecord[];
  meta: { model: string; latencyMs: number; costUsd: number; fixture: boolean };
}
```

`AgentContext` carries the run id, a scoped logger that appends `AgentEvent`s, and the
tool registry. **Tool access is scoped per agent** — Perception cannot geocode, Logistics
cannot message a partner. This is enforced in the registry, not by prompt instruction.

### 4.1 Perception Agent

- **In:** uploaded image (photo of groceries, or a receipt) + optional user note.
- **Tools:** none. Single vision call with a strict Zod-validated JSON schema.
- **Out:** `ExtractedItem[]` with `confidence` per item.
- **Notes:** receipt vs photo is detected in-prompt and handled by one schema. Items below
  0.6 confidence are flagged `needsConfirmation` and are barred from auto-triggering a
  negotiation (FR-2.2). Fixture mode keys on SHA-256 of the image bytes.

### 4.2 Prediction Agent

- **In:** `InventoryItem` (category, storage state, cooked/raw, purchase or prepared time).
- **Tools:** `lookupShelfLife(category, storage)` over the committed USDA FoodKeeper-derived table.
- **Out:** `{ actByAt, urgencyScore, lowConfidence, basis }`.
- **Rule, not a model call.** Deterministic and cheap:

  ```
  remainingHours = baselineHours(category, storage) × cookedFactor − hoursSincePrepared
  urgencyScore   = clamp(1 − remainingHours / actionWindowHours, 0, 1)
  ```

  `actionWindowHours` is per-category (cooked food ~6 h, leafy greens ~24 h, dry goods
  ~168 h) — it encodes "how much lead time does a recovery org need for this?" The LLM is
  used only for the one-sentence rationale, and only when not in `DEMO_MODE`.
- Crossing `urgencyScore ≥ 0.7` enqueues an `AgentRun` with no human action (FR-3.4).

### 4.3 Negotiation Agent

The centrepiece. Runs in two phases.

**Phase A — selection (deterministic scoring, then LLM justification):**

```
score = 0.30 · proximity          (1 − min(km/coverageRadiusKm, 1))
      + 0.25 · categoryFit        (accepted category? cold-chain capable if needed?)
      + 0.25 · capacityHeadroom   (remaining kg today / requested kg, capped at 1)
      + 0.20 · timingFit          (recipient open before actByAt?)
      − penalties                 (declined this donor today, at capacity, closed)
```

Scoring is deterministic so the choice is defensible and reproducible; the LLM writes the
human-readable *why*, it does not pick. The full ranked candidate set with sub-scores is
persisted, so the UI can show "chose A over B because …".

**Phase B — the exchange.** Tools available to the Negotiation Agent:
`send_offer`, `evaluate_counter`, `accept_terms`, `escalate_to_next_candidate`,
`fallback_to_compost`.

Turn protocol, capped at 6 turns / 60 s:

```
Negotiation → OFFER      {itemSummary, qtyKg, freshnessDeadline, proposedWindows, distanceKm}
Partner     → ACCEPT | COUNTER {altWindow?, partialQtyKg?, reason} | DECLINE {reason}
Negotiation → evaluate: counter within freshness deadline?
                yes → ACCEPT (or one COUNTER back)
                no  → escalate_to_next_candidate  (max 2 escalations)
                exhausted → fallback_to_compost
```

Each turn is one `AgentEvent` → the replay view at `/runs/[id]` is free.

### 4.4 Partner Agent (recipient side)

Not a sixth product agent — the counterparty. Two implementations behind one interface:

- `SimulatedPartnerAgent` — its own Claude context, own system prompt built from the seeded
  org profile (capacity remaining today, operating hours, categories, volunteer
  availability, a behavioural disposition such as *"eager but capacity-constrained after
  4 PM"*). Its tools are only `accept` / `counter_offer` / `decline`. It cannot see the
  donor's candidate ranking, the other candidates, or the Negotiation Agent's reasoning.
- `TelegramPartnerAgent` — a real human answering inline buttons; identical message
  contract, so the orchestrator is agnostic to which is on the other side.

The information asymmetry is deliberate: it is what makes the exchange a real negotiation
and not a scripted animation, and it is the claim the demo video will make.

### 4.5 Logistics Agent

- **Tools:** `routeMatrix(origin, dests)` (OSRM → cached → haversine, each labelled),
  `proposeWindows(operatingHours, actByAt)`, `clusterNearbyMatches(recipientId, timeWindow)`.
- **Out:** up to 3 windows, `distanceKm`, `durationMin`, `method`, optional multi-stop plan
  with `savedKm` versus separate trips.

### 4.6 Impact Agent

- **Tools:** `lookupFactors(category)` returning `{co2eKgPerKg, waterLPerKg, landM2PerKg, source, year, url}`.
- **Out:** `ImpactLog` with `outcome: 'REDISTRIBUTED' | 'COMPOSTED'`.
- Redistributed → full avoided-production credit (the food substitutes for food that would
  otherwise have been produced). Composted → landfill-diversion credit only (avoided
  anaerobic methane), a materially smaller number. Reporting these as equivalent is the
  most common integrity failure in this category, so the model separates them explicitly
  and the UI labels which is which.
- No factor → `notQuantified: true`, and the UI says so rather than guessing.

---

## 5. Data Model

MongoDB, Mongoose schemas, all timestamps UTC.

```ts
User {
  _id, email, passwordHash,
  role: 'DONOR' | 'RECIPIENT' | 'ADMIN',
  displayName,
  location: { type: 'Point', coordinates: [lng, lat] },   // 2dsphere
  address?, createdAt
}

RecipientProfile {
  _id, userId?,                        // null for seeded reference orgs
  orgName, orgType: 'NGO' | 'COMMUNITY_FRIDGE' | 'LANGAR' | 'COMPOST' | 'BIOGAS',
  location: GeoPoint, coverageRadiusKm,
  acceptedCategories: string[], coldChainCapable: boolean,
  dailyCapacityKg, capacityUsedTodayKg,
  operatingHours: { day: 0..6, open: 'HH:mm', close: 'HH:mm' }[],
  contact: { telegramChatId?, phone?, email? },
  disposition?: string,                // seeds the SimulatedPartnerAgent persona
  provenance: string,                  // "Modelled on how <Org> operates. Not a partnership."
  isSimulated: boolean
}

InventoryItem {
  _id, userId, name, category, quantity, unit, quantityKg,
  storage: 'PANTRY' | 'FRIDGE' | 'FREEZER',
  isCooked: boolean, preparedAt?, addedAt,
  source: 'PERCEPTION' | 'MANUAL', perceptionRunId?,
  extraction?: { rawName, confidence, corrected: boolean },
  actByAt?, urgencyScore?, lowConfidence?,
  state: 'ACTIVE' | 'CONSUMED' | 'POSTED' | 'DIVERTED' | 'WASTED'
}

Match {                                 // the blackboard
  _id, runId, itemIds[], donorId, recipientId?,
  state: MatchState,
  candidates: [{ recipientId, score, subScores: {...}, rank, rejectedReason? }],
  justification?,                       // why this recipient
  transcript: [{ turn, from: 'DONOR_AGENT'|'PARTNER_AGENT', intent, message, payload?, at }],
  pickup?: { windows: [{start,end}], chosen?, distanceKm, durationMin, method,
             multiStop?: { stops[], savedKm } },
  outcome?: 'REDISTRIBUTED' | 'COMPOSTED' | 'FAILED',
  createdAt, updatedAt
}

AgentRun {                              // queue + state machine cursor
  _id, kind: 'PERCEPTION' | 'NEGOTIATION',
  state: MatchState, matchId?,
  nextActionAt, lockedUntil?, attempts, lastError?,
  totalCostUsd, startedAt, endedAt?
}

AgentEvent {                            // append-only; powers the feed
  _id, runId, matchId?, userId,
  agentId: 'perception'|'prediction'|'negotiation'|'logistics'|'impact'|'partner',
  kind, summary,                        // summary = the plain-language feed sentence
  detail: object,                       // raw payload behind "details"
  causedBy?: eventId,                   // renders the causal chain
  latencyMs, costUsd, fixture: boolean, at
}

ImpactLog {
  _id, matchId, userId, quantityKg, category,
  outcome: 'REDISTRIBUTED' | 'COMPOSTED',
  co2eKg, waterL, landM2, notQuantified,
  factorSource: { dataset, year, url, factorValues }
}
```

**Indexes:** `User.location` 2dsphere; `RecipientProfile.location` 2dsphere;
`InventoryItem { userId, actByAt }`; `AgentEvent { userId, at: -1 }` and `{ runId, at: 1 }`;
`AgentRun { state, nextActionAt }` (the cron sweep query).

### 5.1 Reference data (committed, cited)

| File | Contents | Source |
| --- | --- | --- |
| `data/shelf-life.json` | `{category, storage, baselineHours, cookedFactor, actionWindowHours, source, sourceNote}` | Extracted from USDA FoodKeeper |
| `data/impact-factors.json` | `{category, co2eKgPerKg, waterLPerKg, landM2PerKg, dataset, year, url}` | Poore & Nemecek 2018 (via Our World in Data); WRAP UK cross-check |
| `data/compost-factors.json` | Landfill-diversion CO2e per kg by stream | WRAP / municipal composting figures, cited per row |
| `data/seed-lucknow.json` | Real geocoded Lucknow coordinates for partner orgs, compost points, demo households | Nominatim at authoring time, committed |

Every row in every file carries `source`. A row without one fails a seed-time validation
check — this is enforced, not a convention.

---

## 6. UI Design

### 6.1 Visual identity

```
paper     #F7F4EF   surfaces
ink       #12100E   text
clay      #C9502F   single accent — actions, agent attribution
slate     #5B5F58   secondary text
urgency   #7A9E7E → #E8A33D → #C9502F → #8C2B18   calm → act now
```

One accent, one type scale (Inter or Geist), 4 px spacing grid, generous whitespace,
subtle 1 px borders instead of shadows. No leaf icons, no green gradients, no recycling
triangles. Circularity is expressed structurally — the loop is drawn by the *connector
lines in the activity feed*, not by an icon.

### 6.2 The Agent Activity Feed (the "aha" screen)

Vertical timeline, newest at top, one card per `AgentEvent`, connected by a 1 px clay line
that traces `causedBy` — so a run reads as one continuous loop, visually.

```
┌────────────────────────────────────────────┐
│ ● PREDICTION            18h left · just now│
│   Spinach (400 g) is at 78% urgency —      │
│   leafy greens need ~24h of lead time.     │
│   ▸ details                                 │
├──┼─────────────────────────────────────────┤
│ ● NEGOTIATION                    5s ago    │
│   Picked Robin Hood Army (2.1 km) over     │
│   Aishbagh Fridge — 3× the headroom today  │
│   and open until 8 PM.                     │
│   ▸ see all 4 candidates                    │
├──┼─────────────────────────────────────────┤
│ ⇄ EXCHANGE                       live ⠋    │
│   Agent → RHA: 400g spinach, collect by    │
│              6 PM?                          │
│   RHA → Agent: Can do 6:30, volunteer is   │
│              on the Gomti Nagar route.      │
│   Agent: accepted.                          │
│   ▸ replay turn by turn                     │
├──┼─────────────────────────────────────────┤
│ ● IMPACT                                    │
│   ~1.2 kg CO2e · 118 L water avoided       │
│   ⓘ methodology                             │
└────────────────────────────────────────────┘
```

`aria-live="polite"` on the feed container; each card is a focusable region; the live
in-flight indicator is text plus spinner, not colour alone.

### 6.3 Other surfaces

- **Map** — MapLibre, Lucknow-centred. Households: small clay dots (fuzzed ~200 m in city
  view). Partners: squared pins by org type. In-progress pickups: animated dashed route
  line. Legend is always visible; pin types differ in *shape* as well as colour.
- **Impact** — three stat blocks (CO2e, water, land) with a methodology bottom-sheet giving
  factor value, dataset, year, link. Personal vs city toggle. Streak as a compact row, not
  a hero element.
- **Replay** (`/runs/[id]`) — the negotiation transcript with a scrub control. This is the
  screen to hold on in the video.

---

## 7. Reliability and Fallback Chains

| Dependency | Chain | UI label |
| --- | --- | --- |
| Vision (Perception) | Claude vision → fixture by image hash → manual entry | "demo fixture" / "entered manually" |
| LLM (rationales, exchange) | Claude → fixture transcript → deterministic template | "demo fixture" |
| Routing | OSRM → cached seed route → haversine | "road distance" / "cached" / "straight-line" |
| Tiles | OSM tiles → cached static tile bundle for Lucknow bbox | silent (visual only) |
| Telegram | Webhook → in-app simulated partner | "simulated recipient" |

`DEMO_MODE=true` forces fixtures for all model calls while running the **identical**
orchestrator path — the state machine, blackboard writes, and events are real. The UI
always shows the `fixture` flag, so nothing is passed off as live that is not.

---

## 8. Security

- Argon2id password hashing; HTTP-only, `SameSite=Lax`, `Secure` session cookie via `jose`.
- Zod validation on every route handler input **and** on every LLM tool-call output. Model
  output is untrusted input.
- Telegram webhook verifies `X-Telegram-Bot-Api-Secret-Token`; mismatch → `401`.
- Household exact coordinates are only released to the matched recipient after `AGREED`;
  all other reads get a fuzzed point. Enforced in the serialiser, not the component.
- No secrets in source; `.env.example` documents every variable; a pre-commit secret scan
  runs via the lint hook.
- Rate limits on `/api/perception` (uploads) and `/api/telegram/webhook`.
- `ALLOW_REAL_OUTREACH` defaults `false`. The system cannot contact a real external org
  without an explicit env flip — protects real NGOs from hackathon traffic.

---

## 9. Folder Structure

```
reloop/
├─ .kiro/{specs,steering,hooks}/
├─ data/                       shelf-life, impact factors, seed fixtures (all cited)
├─ fixtures/                   deterministic agent fixtures for DEMO_MODE
├─ src/
│  ├─ app/
│  │  ├─ (auth)/{login,register}/
│  │  ├─ (app)/{dashboard,map,impact,runs/[id]}/
│  │  └─ api/{perception,runs,telegram,cron}/
│  ├─ agents/
│  │  ├─ types.ts              Agent, AgentResult, AgentContext
│  │  ├─ registry.ts           per-agent scoped tool access
│  │  ├─ perception/ prediction/ negotiation/ logistics/ impact/ partner/
│  │  └─ orchestrator/         state machine, advance(), lease, sweep
│  ├─ lib/{db,auth,geo,routing,telegram,llm,impact,validation}/
│  ├─ models/                  Mongoose schemas
│  ├─ components/{feed,map,impact,ui}/
│  └─ scripts/{seed.ts,geocode-seed.ts,verify-sources.ts}
└─ tests/{unit,integration,e2e}/
```

---

## 10. Testing Strategy

- **Unit:** urgency formula boundaries; candidate scoring (incl. tie-breaks and penalties);
  impact math for both outcomes; haversine vs OSRM agreement within tolerance.
- **Integration:** `advance()` through every transition with a stubbed LLM — including the
  counter-offer path, the two-escalation path, and the compost fallback. Idempotency test:
  calling `advance()` twice on the same state produces one event, not two.
- **Source integrity:** `verify-sources.ts` fails CI if any reference-data row lacks
  `source` — this is what keeps FR-6.5 true as data is added.
- **E2E smoke (Playwright):** the exact demo path, run against fresh seed. This is the
  regression gate before recording.

---

## 11. Deployment

Vercel (Next.js full-stack) + MongoDB Atlas free tier. Vercel Cron hits `/api/cron/tick`
every minute. Telegram webhook registered against the production URL. Local dev uses a
long-poll script instead of a webhook so no tunnel is needed.

Env vars: `MONGODB_URI`, `ANTHROPIC_API_KEY`, `SESSION_SECRET`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET`, `OSRM_BASE_URL`, `DEMO_MODE`, `ALLOW_REAL_OUTREACH`,
`NEXT_PUBLIC_MAP_STYLE_URL`.

---

## 12. Risk Register

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Agent-to-agent exchange feels scripted to judges | Med | Information asymmetry (§4.4) is real and demonstrable; show a counter-offer changing the outcome, and show the losing candidates |
| Vision extraction unreliable on Indian groceries/receipts | High | Confidence gating + inline correction + fixtures; correction UX is a feature, not an apology |
| 14-day scope overrun | High | Cut order is pre-committed (requirements §7); Days 13–14 reserved for hardening only |
| Serverless timeout mid-run | Med | Step-wise `advance()` + lease + cron resume |
| OSRM public endpoint flaky | Med | Cached seed routes + labelled haversine fallback |
| Telegram webhook not reachable locally | Med | Long-poll dev script; bot token created Day 1 |
| Impact numbers challenged on methodology | Med | Factors cited per row; redistributed vs composted separated; methodology one tap away |
| Model cost creep during testing | Low | Fixtures in dev, per-run cost recorded on `AgentRun`, cost surfaced in the feed detail |

---

## 13. Decisions — Resolved

Adopted as defaults so implementation is not blocked. Each is reversible; the cost of
reversal is noted.

| # | Decision | Reversal cost |
| --- | --- | --- |
| 1 | MongoDB + Mongoose, not PostgreSQL | High after Day 3 — schemas and queries would be rewritten |
| 2 | Next.js route handlers, no separate Express service | Medium — handlers are thin, logic lives in `src/lib` and `src/agents` |
| 3 | MapLibre + OSM tiles + OSRM routing, no API keys | Low — routing is behind `src/lib/routing`, map is one component |
| 4 | Deterministic candidate scoring; the LLM writes the justification but does not choose | Low — swapping in model-driven selection is a single function |
| 5 | `MATERIAL` item type **in**, food-first: same pipeline, 2–3 seeded examples, no material-specific UI | Low — one enum value and a factor table section |
| 6 | Compost/biogas modelled as a real `RecipientProfile` org type with real Lucknow coordinates, not an abstract sink | Low |
| 7 | Impact factors: Poore & Nemecek 2018 primary (gives CO2e **and** water **and** land per kg); WRAP UK as cross-check only | Low — factor files are data, not code |
| 8 | Telegram bot token created on Day 0, implemented Days 11–12 as scheduled | n/a |
