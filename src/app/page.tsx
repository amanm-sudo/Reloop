import Link from 'next/link';

const AGENTS = [
  {
    name: 'Perception',
    does: 'Reads a photo or a receipt and turns it into structured inventory.',
  },
  {
    name: 'Prediction',
    does: 'Works out how long is left and how much lead time a recipient needs.',
  },
  {
    name: 'Negotiation',
    does: 'Picks the best recipient, explains why, and does the asking.',
  },
  { name: 'Logistics', does: 'Proposes pickup windows and a real road route.' },
  { name: 'Impact', does: 'Quantifies avoided CO2e, water and land from cited data.' },
] as const;

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12 sm:py-20">
      <p className="text-clay-ink text-sm font-medium tracking-wide uppercase">ReLoop</p>

      <h1 className="mt-3 text-3xl leading-tight font-semibold sm:text-4xl">
        Surplus food does not go to waste because nobody wants it. It goes to waste because
        coordinating the handoff costs more than the food is worth.
      </h1>

      <p className="text-slate mt-5 text-base leading-relaxed">
        ReLoop removes that cost. Five agents notice the surplus, judge how urgently it has to
        move, negotiate the handoff with a recovery partner, settle a pickup window, and
        measure what was actually saved — without anyone listing, browsing, or making a phone
        call.
      </p>

      <ol className="border-line mt-10 space-y-4 border-l pl-5">
        {AGENTS.map((agent) => (
          <li key={agent.name} className="relative">
            <span
              aria-hidden="true"
              className="bg-clay absolute top-2 -left-[23px] size-[7px] rounded-full"
            />
            <h2 className="text-sm font-semibold">{agent.name} Agent</h2>
            <p className="text-slate text-sm">{agent.does}</p>
          </li>
        ))}
      </ol>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/register"
          className="bg-clay rounded-card px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Create an account
        </Link>
        <Link
          href="/login"
          className="border-line rounded-card border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-paper-sunken"
        >
          Sign in
        </Link>
      </div>

      <p className="text-slate mt-12 text-xs leading-relaxed">
        Built during a 14-day hackathon. Shelf-life estimates derive from USDA FoodKeeper data;
        environmental factors from Poore &amp; Nemecek (2018). Partner organisations in the demo
        dataset are modelled on how real recovery networks operate and are not active
        partnerships.
      </p>
    </main>
  );
}
