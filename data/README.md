# Reference data provenance

Every number ReLoop shows a user traces back to a row in this directory, and every row
carries its source. `npm run verify:sources` enforces that: it fails the build if a row is
missing a source, if a canonical category has no row, or if a row references a category that
does not exist.

## `impact-factors.json`

Environmental factors, per kilogram of product.

**Source:** Poore, J. & Nemecek, T. (2018). *Reducing food's environmental impacts through
producers and consumers.* Science 360(6392), 987–992. Retrieved 2026-08-31 from the Our World
in Data distributions of that dataset:

- [Greenhouse gas emissions per kilogram](https://ourworldindata.org/grapher/ghg-per-kg-poore)
- [Land use per kilogram](https://ourworldindata.org/grapher/land-use-per-kg-poore)
- [Freshwater withdrawals per kilogram](https://ourworldindata.org/grapher/water-withdrawals-per-kg-poore)

Values are global averages across the full supply chain. Poore & Nemecek was chosen over
WRAP because it publishes carbon, water **and** land on the same per-kg basis; WRAP is used
only as an order-of-magnitude cross-check.

**Proxy rows.** Poore & Nemecek publishes 38 commodity groups, and ReLoop has 32 categories
that do not map one-to-one. Where a category has no exact group, the row records
`isProxy: true`, names the group used, and explains the substitution in `proxyNote`. Where a
proxy would *overstate* the saving (paneer, ghee, cooking oil), the conservative group is
used deliberately and the note says so. ReLoop understates rather than inflates.

**Composting is accounted separately.** `compostFallback` carries a landfill-diversion credit
only. Composted food does not recover the emissions already embodied in producing it, so a
composted outcome never receives the per-kg production factors. Treating the two as
interchangeable is the most common integrity failure in this problem space.

**Materials are not quantified.** Textiles, paper and household goods carry
`notQuantified: true`. Poore & Nemecek is food-only, and no sourced non-food factor was
obtained inside the build window. Those diversions are reported by mass, and the UI says
"not quantified" rather than showing an estimate.

## `shelf-life.json`

Storage life per category and storage state, plus the lead time a recovery partner needs.

**Intended source:** [USDA FoodKeeper (FSIS)](https://www.foodsafety.gov/keep-food-safe/foodkeeper-app),
whose field definitions are documented in the
[FoodKeeper data documentation](https://www.fsis.usda.gov/sites/default/files/media_file/2020-06/Data-Documentation-FoodKeeper-Application.pdf).

**Known gap, stated plainly.** The FSIS data feed refuses automated download — every
published endpoint returned HTTP 403 on 2026-08-31. This table was therefore authored by
hand rather than generated from the feed, and rows are marked accordingly:

- `verified: true` — the value appears on the
  [FDA/FoodSafety.gov Cold Food Storage Chart](https://www.fda.gov/downloads/Food/ResourcesForYou/HealthEducators/ucm109315.pdf),
  the same federal guidance family as FoodKeeper. These cover the categories that actually
  matter for safety and for the demo: cooked leftovers, raw poultry, raw fish, eggs, milk,
  fresh cheese.
- `verified: false` — a category-level generalisation consistent with published guidance but
  not yet traceable to a specific row. Items in these categories are flagged lower-confidence
  in the UI.

`npm run verify:sources` prints the unverified count on every run so the gap stays visible
rather than quietly becoming permanent.

### To close the gap

1. Download `FoodKeeper_Data.xlsx` by hand from the
   [FSIS FoodKeeper page](https://www.foodsafety.gov/keep-food-safe/foodkeeper-app) or the
   data.gov catalogue entry.
2. For each `verified: false` row, find the matching product rows and take
   `Refrigerate_Min`/`Refrigerate_Max`, `DOP_Pantry_*`, and `Freeze_*`, converting the metric
   field to hours.
3. Replace the value, set `verified: true`, and put the product name and column in
   `sourceNote`.

### `actionWindowHours` is ours, not theirs

This field is how much lead time a recovery partner realistically needs for a category, and
it is a ReLoop operational parameter — not a food-safety figure. It is what makes a Prediction
Agent output actionable rather than merely informative, and it is documented as our own so it
is never mistaken for published guidance.

## `seed-lucknow.json`

Created on Day 6 by `npm run geocode:seed`, which calls Nominatim once at authoring time and
commits the result. Coordinates are real and are never hand-typed. Partner organisations carry
a `provenance` string stating they are modelled on how a real network operates and are not
active partnerships.
