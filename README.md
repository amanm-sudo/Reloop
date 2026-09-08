# ReLoop

Surplus food does not go to waste because nobody wants it. It goes to waste because
coordinating the handoff costs more than the food is worth — who to call, is it still good, is
400 g worth a trip, when could someone collect. ReLoop removes that cost by making the
coordination autonomous: five cooperating agents notice the surplus, judge how urgently it has
to move, negotiate the handoff with a recovery partner, settle a pickup window, and measure
what was actually saved.

Built entirely during a 14-day hackathon. No prior work.

> **Status: in progress.** Foundation checkpoint. See
> `.kiro/specs/reloop/tasks.md` for the day-by-day plan and current position.

## Why not a marketplace

A listings app moves the coordination burden onto a human who then has to browse, message, and
schedule. ReLoop's differentiator is that the negotiation happens between two independent
agents — the donor-side Negotiation Agent and a recipient-side Partner Agent with its own
context, its own persona, its own tools, and no visibility into the other side's reasoning. That
asymmetry is what makes the exchange a real negotiation rather than a scripted animation.

<!-- ARCH:START -->

## Architecture

Populated automatically by the `sync-architecture-docs` agent hook whenever the orchestration
code under `src/agents/` changes, so this section cannot drift from the implementation.

Planned shape (see `.kiro/specs/reloop/design.md`):

- **Perception** — photo or receipt to structured inventory
- **Prediction** — act-by time and urgency from cited shelf-life data
- **Negotiation** — ranks recipients, explains the choice, runs the exchange
- **Logistics** — pickup windows and a real road route
- **Impact** — avoided CO2e, water and land from cited factors

Agents never call each other. They coordinate through a shared `Match` document and an
append-only `AgentEvent` log, and the orchestrator advances one state transition per call.

<!-- ARCH:END -->

## Real data sources

Every number the app shows traces to a row in `data/`, and every row carries its source.
`npm run verify:sources` fails the build if that stops being true.

| Purpose | Source |
| --- | --- |
| Avoided CO2e, freshwater and land per kg | Poore & Nemecek (2018), _Science_ 360(6392), via [Our World in Data](https://ourworldindata.org/environmental-impacts-of-food) |
| Landfill-diversion credit for composting | [WRAP food waste collections guidance](https://wrap.org.uk/system/files/2021-05/WRAP-food-collections-webinar-Q&A.pdf) |
| Shelf life by category and storage state | [USDA FoodKeeper](https://www.foodsafety.gov/keep-food-safe/foodkeeper-app), reconciled against the [FDA Cold Food Storage Chart](https://www.fda.gov/downloads/Food/ResourcesForYou/HealthEducators/ucm109315.pdf) |
| Routing and distances | OSRM over OpenStreetMap |
| Coordinates | Nominatim, geocoded once at seed time and committed |

Two things are stated plainly rather than papered over:

- **Composting is not redistribution.** A composted outcome earns only the landfill-diversion
  credit, never the avoided-production factors. Reporting them as equivalent is the most common
  integrity failure in this space.
- **Materials are not quantified.** Poore & Nemecek is food-only, and no sourced non-food factor
  was obtained inside the build window, so textile and household-goods diversions are reported
  by mass and the UI says "not quantified" rather than showing an estimate.

See [`data/README.md`](./data/README.md) for full provenance, including the 21 shelf-life rows
still awaiting a manual FoodKeeper pass and why (the FSIS feed refuses automated download).

## Partner organisations in the demo data

Seeded partner profiles are **modelled on how real recovery networks operate** — the
[FSSAI Share Food Save Food / Indian Food Sharing Alliance](https://sharefood.fssai.gov.in/)
model, [Robin Hood Army](https://robinhoodarmy.com/)-style volunteer chapters, community
fridges, and gurdwara langar surplus programmes. They are **not active partnerships**, every
profile says so in a `provenance` field rendered in the UI, and `ALLOW_REAL_OUTREACH` defaults
to `false` so the system cannot contact a real organisation by accident.

## Setup

Requires Node 20.11+ and a MongoDB instance (Atlas free tier is fine).

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run seed                 # deterministic Lucknow demo dataset
npm run dev
```

`.env.example` documents every variable and where to get it. Nothing secret is committed.

### Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run check` | Typecheck, lint, source integrity, tests — run this before committing |
| `npm run verify:sources` | Fails if any reference row lacks a citation or a category lacks data |
| `npm run seed` | Wipes and rebuilds the deterministic demo dataset |
| `npm run test` | Unit and integration tests (never hits a real LLM, router, or Telegram) |

## What was new to me

Written up in full at submission. Two things were genuinely new territory rather than
familiar work in a new shape: **multi-agent orchestration** as a resumable state machine over a
shared blackboard, and **Telegram bot integration** as a first-class channel so a recipient can
accept a pickup without ever opening the web app.
