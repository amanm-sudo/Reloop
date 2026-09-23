# ReLoop

**Food gets binned because finding who can take it costs twenty minutes nobody has. ReLoop's agents find them, negotiate the handoff, and measure what was saved.**

🔗 **[Live demo](https://reloop-ecru.vercel.app)** · sign in with `ananya@example.com` / `reloop-demo-password`

Five cooperating AI agents intercept surplus food *before* it becomes waste — not a marketplace
where people list and browse, but a system that notices the surplus, works out how urgently it has
to move, negotiates with a real recovery partner, settles a pickup, and quantifies the saving from
published data.

Built entirely during a 14-day hackathon. No prior work.

---

## See it work in 60 seconds

1. Open the [live demo](https://reloop-ecru.vercel.app) and sign in with the details above.
2. Look at the top of the pantry: **1.2 kg of cooked sabzi**, already flagged urgent. Nobody
   flagged it — cooked food has about four hours and a recipient needs a couple of hours' notice.
3. **Watch the Agent Activity Feed.** You did not list anything or message anyone. It is:
   - ranking nearby recipients, then telling you *why* it chose one —
     *"picked Chinhat Night Shelter Kitchen (3.5 km) because Robin Hood Army is closed for the whole window"*
   - putting an offer to that kitchen, and getting a real answer back
   - settling a pickup window and a road distance
   - measuring the CO2e and water avoided
4. Click **"Replay this negotiation turn by turn"** to see the exchange and the candidates that
   lost, with the scores that decided it.
5. Open **Impact** and tap ⓘ *methodology* on any number.

> If the feed looks static, every seeded run has already finished. That is what
> `npm run seed` is for — it resets the demo in seconds.

<!-- Screenshots: drop images in docs/ and reference them here once you have them. -->

---

## The problem

In Lucknow there are NGOs, community kitchens, gurdwara langars and night shelters within a few
kilometres of almost any household, most of them short of food. The gap is not willingness and it is
not a shortage of recipients.

It is that acting on a bowl of leftover sabzi means finding out who is open right now, who has room
today, who can send a volunteer before it spoils, and whether it is even worth the trip. That is
twenty minutes of phone calls for maybe a kilo of food. Nobody does it.

**Every other tool answers "where can I list this?"** — which hands the twenty minutes back to a
human in a nicer interface. ReLoop answers a different question: *who is already dealing with this
on my behalf?*

## Why this is not a marketplace

The negotiation happens between **two independent agents**.

The donor-side Negotiation Agent ranks recipients and makes an offer. The recipient-side Partner
Agent answers with its own opening hours, its own capacity, its own cold chain — and **no visibility
into the donor side's reasoning or the ranking it came from.**

That asymmetry is the whole point. It is why the counterparty genuinely accepts, counters with a
different time, offers to take half, or declines — and why the outcome is not predetermined. Collapse
both sides into one context and you have an animation, not a negotiation.

## The five agents

| Agent | What it does |
| --- | --- |
| **Perception** | Reads a photo or a receipt into a structured list |
| **Prediction** | Works out the act-by time — earlier than expiry, because a partner needs lead time |
| **Negotiation** | Ranks recipients, explains the choice, runs the exchange, escalates or diverts |
| **Logistics** | Proposes pickup windows that fit real opening hours, over real road distances |
| **Impact** | Quantifies avoided CO2e, freshwater and land from cited factors |

They never call each other. They coordinate through one shared record and an append-only event
log — and that log **is** the activity feed you watch in the app. It is not a view built for the
demo; it is the coordination mechanism, rendered.

## Why the numbers are trustworthy

Every figure traces to a row in [`data/`](./data), and every row carries its source.
`npm run verify:sources` fails the build if that stops being true.

| Purpose | Source |
| --- | --- |
| Avoided CO2e, freshwater, land per kg | Poore & Nemecek (2018), _Science_ 360(6392), via [Our World in Data](https://ourworldindata.org/environmental-impacts-of-food) |
| Landfill-diversion credit for composting | [WRAP food waste collections guidance](https://wrap.org.uk/system/files/2021-05/WRAP-food-collections-webinar-Q&A.pdf) |
| Shelf life by category and storage | [USDA FoodKeeper](https://www.foodsafety.gov/keep-food-safe/foodkeeper-app), cross-checked against the [FDA Cold Food Storage Chart](https://www.fda.gov/downloads/Food/ResourcesForYou/HealthEducators/ucm109315.pdf) |
| Distances and routing | OSRM over OpenStreetMap |
| Coordinates | Nominatim — 9 real Lucknow localities, geocoded once and committed |

Three things are stated plainly rather than papered over:

**Composting is not redistribution.** Composted food earns only the landfill-diversion credit, never
the avoided-production factors — the methane is stopped, but the water and land spent growing it are
already gone. Summing the two produces a bigger headline, and plenty of tools do it. This one
refuses.

**Materials are not quantified.** Poore & Nemecek is food-only. Donated textiles and household goods
are reported by mass, and the UI says *"not quantified"* rather than showing an estimate.

**21 of 32 shelf-life rows are still generalisations.** The federal dataset returns HTTP 403 to
automated download, so rather than cite rows I had not read, the table is split: verified values are
marked, the rest are flagged, and a check prints the unverified count on **every single run** so the
gap cannot quietly become permanent. See [`data/README.md`](./data/README.md).

## Partner organisations in the demo data

Seeded profiles are **modelled on how real recovery networks operate** — the
[FSSAI Share Food Save Food / Indian Food Sharing Alliance](https://sharefood.fssai.gov.in/) model,
[Robin Hood Army](https://robinhoodarmy.com/)-style volunteer chapters, community fridges, and
gurdwara langar surplus programmes.

They are **not active partnerships.** Every profile says so in a `provenance` field rendered in the
UI, and `ALLOW_REAL_OUTREACH` defaults to `false` so the system cannot contact a real organisation by
accident.

<!-- ARCH:START -->

## Architecture

Regenerated by the `sync-architecture-docs` hook whenever `src/agents/` changes, from
`src/agents/registry.ts` and `src/lib/domain.ts`.

All six agents implement one interface (`src/agents/types.ts`): `run(input, ctx)` returning
`output`, a feed-ready `rationale`, `toolCalls`, and `meta { model, latencyMs, costUsd, fixture }`.

| Agent | Responsibility | Tools granted |
| --- | --- | --- |
| Perception | Photo or receipt into structured inventory | none — a single vision call |
| Prediction | Act-by time and urgency score | `lookup_shelf_life` |
| Negotiation | Rank recipients, explain the choice, run the exchange | `rank_recipients`, `draft_outreach`, `send_offer`, `evaluate_counter`, `accept_terms`, `escalate_to_next_candidate`, `fallback_to_compost` |
| Logistics | Pickup windows and a real road route | `route_matrix`, `propose_windows`, `cluster_nearby_matches` |
| Impact | Avoided CO2e, freshwater and land | `lookup_impact_factors` |
| Partner | The counterparty, donor-side reasoning withheld | `partner_accept`, `partner_counter_offer`, `partner_decline` |

Access is declared in `registry.ts` and enforced by `assertMayUse`, not requested in a prompt.

**Transitions**, as registered in `src/agents/orchestrator/index.ts`:

| From | Step | To |
| --- | --- | --- |
| `PREDICTED` | Negotiation ranks recipients | `CANDIDATES_RANKED` · `COMPOST_DIVERTED` |
| `CANDIDATES_RANKED` | Logistics routes and proposes windows | `NEGOTIATING` · `COMPOST_DIVERTED` |
| `NEGOTIATING` | Negotiation sends the offer | `OUTREACH_SENT` |
| `OUTREACH_SENT` | Partner answers | `AGREED` · `COUNTERED` · escalate · `COMPOST_DIVERTED` |
| `COUNTERED` | Negotiation evaluates against the deadline | `AGREED` · `NEGOTIATING` · escalate · `COMPOST_DIVERTED` |
| `AGREED` | Logistics confirms and combines trips | `SCHEDULED` |
| `SCHEDULED` | Handoff | `COMPLETED` |
| `COMPOST_DIVERTED` | Route to the nearest compost or biogas partner **that accepts the category** | `COMPLETED` · `FAILED` |
| `COMPLETED` | Impact quantifies | `IMPACT_LOGGED` |

Terminals are `IMPACT_LOGGED` and `FAILED`. `COMPOST_DIVERTED` is deliberately not terminal — a
composted outcome still earns an `ImpactLog`, with the landfill-diversion credit only.

Agents never call each other. They coordinate through the shared `Match` document and the
append-only `AgentEvent` log. `advance()` performs exactly one transition per call under a
`lockedUntil` lease, so a duplicate call is a no-op and a serverless timeout is resumable.

<!-- ARCH:END -->

## Run it locally

Needs Node 20.11+ and a MongoDB instance — the Atlas free tier is fine.

```bash
npm install
cp .env.example .env.local    # fill in MONGODB_URI and SESSION_SECRET
npm run seed                  # deterministic Lucknow demo dataset
npm run dev
```

Sign in as `ananya@example.com` / `reloop-demo-password`.

**It runs with no AI API key at all.** `DEMO_MODE=true` is the default: decisions are computed from
real rules over real partner data, and only the natural-language *wording* comes from committed
fixtures. Every affected card in the UI is labelled `demo fixture`, so nothing is ever passed off as
live that is not. Add `GEMINI_API_KEY` and set `DEMO_MODE=false` for live model calls — the
orchestration path is byte-for-byte identical either way.

`.env.example` documents every variable and where to get it. Nothing secret is committed.

Deploying? See [`DEPLOY.md`](./DEPLOY.md).

### Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run seed` | Wipes and rebuilds the demo dataset. Deterministic, safe to re-run mid-demo. |
| `npm run check` | Typecheck, lint, source integrity, 114 tests |
| `npm run smoke` | Boots a throwaway DB and the production build, seeds it, drives a full run over HTTP |
| `npm run verify:live` | Walks a deployed instance the way a judge would |
| `npm run verify:sources` | Fails if any reference row lacks a citation, or a category lacks data |
| `npm run geocode:seed` | Re-geocodes the seed places. Rarely needed; output is committed. |

## Tech

Next.js · TypeScript · MongoDB · Google Gemini (`@google/genai`) · MapLibre + OpenStreetMap · OSRM ·
Telegram Bot API · Vercel

## Verified, and not

**Verified automatically — 114 tests.** Including orchestrator integration tests against a real
MongoDB covering the happy path, a counter-offer on partial capacity, the compost fallback,
lease-based idempotency under concurrent advances, and the refusal to act on an unconfirmed
extraction. `npm run smoke` additionally drives a full run over HTTP against the production build and
asserts both sides appear in the transcript. `npm run verify:live` checks the deployment.

**Not verified, stated plainly:**

- **Layout and client behaviour at 390 px** need a human pass. There is no browser-driver suite.
- **The live Gemini path has never been run** — the whole suite executes in fixture mode. The schema
  translation it depends on is covered by `tests/unit/llm-schema.test.ts`, but the first real call
  will be the first real call.
- **Telegram is built but unproven.** The webhook, link codes and inline accept/counter/decline are
  implemented, and a human's tap goes through the same `applyPartnerDecision` as a simulated
  partner's decision — but with no bot token it has not been run end to end.
- **Accessibility** follows the project's own rules (keyboard focus, `aria-live` on the feed,
  shape-plus-colour on map pins, AA contrast). Full conformance needs manual testing with assistive
  technology and is not claimed.

## Demo timing

Recovery partners in the seed data cover roughly **08:00–01:30 IST**. Outside those hours no
recipient can collect before cooked food turns, so ReLoop correctly routes it to composting instead
of redistribution — real behaviour, but not the headline.

`npm run seed` prints which scenario is live before you start.

## Three bugs worth naming

**The one that mattered most only appeared at half past midnight.** Everything passed. Then I ran it
late and watched it send good food to compost while a night kitchen sat open and willing. It was
offering a thirty-minute pickup slot to a kitchen closing in twenty, and concluding nothing fit.
Twice, at two different layers. Tests missed it because they asserted the *shape* of the output, not
whether the outcome made sense.

**It quietly invented a number.** The live feed credited 2.4 kg of donated winter clothes with 1.2 kg
of avoided CO2 — using a figure measured on *food* waste. The one thing this project claims never to
do, happening on screen. Chasing it found a second hole: one category belonged to no group at all, so
ghee had no diversion route whatsoever and would have been written off as waste.

**A score that had stopped scoring.** A capacity measure was capped at 1, so a partner with 60 kg of
room scored identically to one with 2 kg. It looked fine and discriminated on nothing.

## What's next

- **Finish the Telegram channel** so a coordinator can accept a pickup from a chat they already have
  open. The people who need this most are the least likely to install anything.
- **Recurring surplus** from canteens, kirana stores and caterers — predictable, scheduled, and where
  the real volume is.
- **Close the data gaps:** reconcile the remaining shelf-life rows, and source a real factor for
  textiles so those diversions can be measured instead of merely counted.
- **Let recipients ask.** Today surplus finds a recipient; a kitchen short tomorrow should be able to
  say so and have it met.

---

Built with [Kiro](https://kiro.dev) — the spec, steering rules and agent hooks that drove this build
are in [`.kiro/`](./.kiro).
