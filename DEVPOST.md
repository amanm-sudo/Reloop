## Inspiration

Surplus food doesn't get thrown away because nobody wants it.

In Lucknow there are NGOs, community kitchens, gurdwara langars and night shelters within a few
kilometres of almost any household, most of them short of food. The gap isn't willingness and it
isn't a shortage of recipients.

It's that acting on a bowl of leftover sabzi means finding out who's open right now, who has room
today, who can send a volunteer before it spoils, and whether it's even worth the trip. That's
twenty minutes of phone calls for maybe a kilo of food. Nobody does it. So the food goes in the bin,
and everyone involved would honestly have preferred otherwise.

Every app I looked at answered "where can I list this?" — which just hands the twenty minutes back
to the human, in a nicer interface. I wanted to answer a different question: who is already dealing
with this on my behalf?

## What it does

You photograph your groceries, or a receipt, or just type what you've got. After that you do
nothing.

ReLoop notices when something is close to the point where a recipient could no longer act on it —
which is earlier than the point where it spoils, because a partner needs lead time. It then picks the
best recipient nearby and explains why in plain language: *"chose the night shelter kitchen over the
Robin Hood Army chapter, because that chapter is closed for the whole window this food is still
safe."*

Then it actually negotiates. It sends an offer, and the recipient answers for itself — accepting,
or countering with a different time, or saying it only has room for half, or declining outright. If
a counter-offer won't fit before the food turns, ReLoop moves to the next recipient. If nobody can
take it, it routes the food to composting rather than landfill and says plainly that the food itself
is lost.

Finally it measures what was saved, in kilograms of CO2 and litres of water, with the source one tap
away.

Everything the agents do appears on one screen, in sentences a person reads rather than logs.

## How we built it

Five agents, each with one job: reading a photo into a list, judging urgency, negotiating, sorting
timing and route, measuring impact.

They never call each other. They all read and write one shared record, and the "activity feed" you
see in the app isn't a log added for the demo — it *is* the coordination mechanism, rendered.

Three decisions shaped the rest:

**The recipient is a genuinely separate party.** The counterparty agent has its own opening hours,
its own capacity, its own fridge or lack of one, and it cannot see any of the donor side's reasoning
or the ranking it came from. That asymmetry is why the exchange is a negotiation and not an
animation.

**The choice is deterministic; only the explanation is generated.** Scoring on distance, capacity,
category fit and timing is a plain tested function. The model writes the sentence explaining it. So
"why that NGO?" has a reproducible answer.

**One step at a time.** The system advances by exactly one state transition per call, under a lock.
A timeout can't strand a run halfway, and running the same step twice does nothing rather than
duplicating work.

The numbers are real and cited: shelf life from the USDA's FoodKeeper guidance cross-checked against
the FDA cold storage chart, and carbon, water and land figures from Poore & Nemecek's 2018 study in
*Science*. Distances are real road distances over OpenStreetMap. Locations are real Lucknow
localities, geocoded once and committed. The organisations are modelled on how real recovery networks
operate, and every profile says so in the app — no implied partnerships.

Stack: Next.js, MongoDB, Google Gemini, MapLibre. A Telegram channel is built so a coordinator could
accept a pickup from a chat they already have open, but it's unproven — see what's next.

## Challenges we ran into

**The bug that mattered most only appeared at half past midnight.** Everything passed. Then I ran it
late and watched it send perfectly good food to compost while a night kitchen sat open and willing.
The cause was mundane: it was offering a thirty-minute pickup slot to a kitchen closing in twenty,
and when that didn't fit it concluded nothing fit. Twice, at two different layers. No test caught it,
because the tests asserted the shape of the output rather than whether the outcome made sense.

**It quietly invented a number.** I watched the live feed credit 2.4 kg of donated winter clothes
with 1.2 kg of avoided CO2 — using a figure measured on *food* waste. The one thing this project
claims never to do, happening on screen. Chasing it found a second hole: one category belonged to no
group at all, so ghee had no diversion route whatsoever and would have been written off as waste.

**A score that had stopped scoring.** A capacity measure was capped at 1, which meant a partner with
60 kg of room scored identically to one with 2 kg. It looked fine and discriminated on nothing.

**The dataset refused to be downloaded.** The federal food-storage data returns 403 to anything
automated. I refused to cite rows I hadn't read, so the table is split: values I could verify against
a published chart are marked as such, and the rest are flagged as generalisations. A check prints the
unverified count on every single run so the gap can't quietly become permanent.

## Accomplishments that we're proud of

**It runs with no API key at all.** Decisions come from real rules over real partner data; only the
wording is pre-written, and every affected card in the UI says so. The demo can't fail because a
provider is slow, and nothing is passed off as live that isn't.

**The honest accounting.** Composted food earns a fraction of what redistributed food earns, because
composting stops the methane but the water and land spent growing it are already gone. Adding those
together would produce a bigger headline number, and a lot of tools do. Donated clothes say "not
quantified" rather than guessing.

**It tells you why, and shows you the options that lost.** Including their scores.

**114 tests**, including ones that drive the whole loop against a real database and assert the
outcome makes sense, plus a command that boots the real build and walks the demo path end to end.

## What we learned

**Running it at an inconvenient hour is a test technique.** Every one of my worst bugs was
time-dependent and invisible to a passing suite. Tests that assert "did this produce a plausible
shape" will happily certify a system that is quietly doing the wrong thing.

**Sequencing beats looping.** Building the coordination as one resumable step at a time — rather than
a loop that runs the whole pipeline — is what makes it survive a timeout, run from a browser or a
schedule, and be safe to retry. That was the single most useful structural decision.

**Refusing to guess is a feature.** Every time I hit missing data, the temptation was to substitute
something plausible. Marking it "not quantified", or flagging a substitute as a substitute and
choosing the one that *understates* the saving, took longer and made the project far more defensible.

**Putting all the model calls in one place paid off unexpectedly.** Switching providers mid-build
touched exactly one file — no agent, no prompt, no test.

## What's next for ReLoop

**Finish the messaging channel.** It's built but unproven. A coordinator accepting a pickup by
tapping a button in a chat they already have open is the difference between a good demo and something
an NGO would actually use — because the people who need this most are the least likely to install
anything.

**Recurring surplus.** A canteen, a kirana store or a caterer produces predictable surplus on a
schedule. Learning that pattern turns one-off rescues into a standing arrangement, which is where the
real volume is.

**Close the data gaps.** Reconcile the remaining shelf-life rows against the source dataset, and find
a properly sourced factor for textiles and household goods so those diversions can be measured
instead of merely counted.

**Let recipients ask.** Right now surplus finds a recipient. A kitchen that knows it's short tomorrow
should be able to put that into the same system and have it met.
