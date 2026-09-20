# ReLoop — 5 minute demo script

**Before you hit record:** run `npm run seed`. It prints one line telling you whether a partner is
open right now. If it says the redistribution path is live, go. If not, wait until after 08:00 IST —
outside partner hours the app correctly routes food to compost instead, which is honest behaviour
but not the story you want to tell.

Keep your voice normal. Don't read it like a script.

---

## 0:00–0:30 — The problem

*(On screen: just you, or a still of a plate of leftover food.)*

> Last night someone in Lucknow cooked too much. There's a kilo of sabzi sitting on the counter,
> perfectly good, and by morning it's bin food.
>
> It's not that nobody wants it. There are NGOs, community kitchens, night shelters, all within a
> few kilometres, all short of food.
>
> The reason it gets thrown away is that finding out *who* can take it — who's open, who's got room,
> who can send someone before it spoils — takes twenty minutes of phone calls. Nobody does twenty
> minutes of phone calls for a bowl of sabzi.
>
> So I built something that does the phone calls.

---

## 0:30–2:00 — Watch it happen

*(On screen: the pantry. Point at the sabzi at the top of the list.)*

> This is ReLoop. Here's that sabzi. I didn't flag it as urgent — it worked that out itself, because
> cooked food has about four hours and whoever collects it needs a couple of hours' notice.
>
> I haven't listed it anywhere. I haven't messaged anyone. Watch.

*(Let the feed run. Stop talking for a few seconds and let it fill in.)*

> It's looking at who's nearby.

*(Pause on the "picked X over Y" line. Read it out.)*

> There. It chose the night shelter kitchen over the Robin Hood Army chapter — because the Robin
> Hood Army is closed for the whole window this food is still safe. It's telling me *why*, not just
> what.

*(Let the next cards land.)*

> And now it's actually asking them.

*(Pause on the partner's reply.)*

> That reply is the part I care about most. That's not a script. The kitchen is a separate agent with
> its own opening hours, its own capacity, its own fridge — and it can't see any of my side's
> reasoning. It said yes because it genuinely could. Sometimes it says "we only have room for half"
> or "not at that time, come at ten" — and then my side has to decide whether that still works
> before the food goes off.

*(Click into the replay screen.)*

> Here's the whole conversation, turn by turn. And here are the ones that lost, and exactly why.

---

## 2:00–3:30 — What it actually saved

*(On screen: the impact page.)*

> And then it measures it. Not points, not a score — kilograms of CO2 and litres of water.

*(Tap the methodology link. Let it open.)*

> One tap and it shows you where the number came from. The dataset, the year, the exact figure per
> kilo, and a link. Because a made-up carbon number is worse than no number.
>
> Two things I'm stubborn about here. If food gets composted instead of eaten, it earns far less
> credit — composting stops the methane, but the water and land that went into growing it are already
> spent. Most tools quietly add those together to get a bigger headline. This one won't.
>
> And for things like donated clothes, it says "not quantified" instead of guessing.

*(Switch to the map.)*

> This is the map. Partners, surplus, pickups in progress. Household pins are deliberately fuzzy —
> your exact address only goes to the one organisation you've actually agreed a handoff with.

---

## 3:30–4:30 — How it works, briefly

*(On screen: back to the feed, or the replay.)*

> There are five agents and they each do one job.
>
> One reads a photo or a receipt and turns it into a list. One works out how long you've got. One
> picks the recipient and does the negotiating. One sorts out the timing and the route. One does the
> measuring.
>
> They don't call each other. They all write to one shared record, which is also exactly what you've
> been watching — that feed isn't a log I built for the demo, it *is* how the system coordinates.
>
> The numbers are real. Shelf life comes from the USDA's FoodKeeper guidance. The carbon, water and
> land figures come from Poore and Nemecek's 2018 study in Science. The distances are real road
> distances over OpenStreetMap. The locations are real places in Lucknow.
>
> The organisations in here are modelled on how real recovery networks actually operate — and the app
> says so on every single one, because I'm not going to imply a partnership I don't have.

---

## 4:30–5:00 — What I'd do next

> The hardest part wasn't the AI. It was time.
>
> My first version looked great and then quietly failed at half past midnight, because it offered a
> half-hour pickup slot to a kitchen that shut in twenty minutes. It sent good food to compost while
> somebody was standing right there willing to take it. Tests didn't catch that. Running it at a
> stupid hour did.
>
> Next is the messaging side, so a coordinator can accept a pickup by tapping a button in a chat they
> already have open, without installing anything. That's the difference between a nice demo and
> something an actual NGO would use.
>
> Food doesn't go to waste because people don't care. It goes to waste because caring takes twenty
> minutes nobody has. ReLoop takes the twenty minutes.

---

## Notes

- **Total: about 700 words.** That's five minutes at a normal pace. If you're running long, cut the
  map bit at 3:30 — it's the least important thing on screen.
- **The silences are deliberate.** When the feed is filling in, shut up and let it. That's the moment
  that sells it.
- **Don't say "agentic", "orchestration", "pipeline", or "leveraging".** You're describing something
  that makes phone calls so a person doesn't have to.
- If a partner **declines** or **counters** during your take, don't restart — that's a better demo
  than a clean accept. Say "see, it didn't just get a yes" and follow it.
