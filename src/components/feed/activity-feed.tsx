'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentId } from '@/lib/domain';
import { AgentBadge, agentDotClass, fallbackLabel, relativeTime } from '@/components/ui/agent-badge';

/**
 * The Agent Activity Feed.
 *
 * The one screen the whole project is judged on, so two things matter above all: every card reads
 * as a plain English sentence a non-technical person understands, and an agent's action appears
 * here within a couple of seconds of happening.
 *
 * It also drives the run. While anything is in flight the component both polls for new events and
 * calls `advance` to take the next step, which is what makes the exchange unfold turn by turn on
 * screen instead of arriving all at once whenever a cron tick lands.
 */

export type FeedEventView = {
  id: string;
  runId: string;
  matchId: string | null;
  agentId: AgentId;
  kind: string;
  summary: string;
  detail: unknown;
  causedBy: string | null;
  latencyMs: number;
  costUsd: number;
  fixture: boolean;
  fallback: string | null;
  at: string;
};

type RunView = { id: string; state: string; endedAt: string | null };

const POLL_MS = 1200;
const TERMINAL = new Set(['IMPACT_LOGGED', 'FAILED']);

export function ActivityFeed({
  initialEvents,
  runId,
  compact = false,
}: {
  initialEvents: FeedEventView[];
  /** Scope to one run, for the replay view. Omit for the dashboard's whole-account feed. */
  runId?: string;
  compact?: boolean;
}) {
  const [events, setEvents] = useState<FeedEventView[]>(initialEvents);
  const [driving, setDriving] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Guards against overlapping advance calls from a slow network.
  const advancing = useRef(false);

  const refresh = useCallback(async () => {
    const query = new URLSearchParams({ limit: '80' });
    if (runId) query.set('runId', runId);

    const response = await fetch(`/api/feed?${query.toString()}`, { cache: 'no-store' });
    if (!response.ok) return;

    const body = (await response.json()) as
      | { ok: true; data: { events: FeedEventView[] } }
      | { ok: false };
    if (!body.ok) return;

    setEvents(body.data.events);
  }, [runId]);

  /** Take one step on every run that is still going. */
  const driveRuns = useCallback(async (): Promise<boolean> => {
    if (advancing.current) return true;
    advancing.current = true;

    try {
      const listed = await fetch('/api/runs', { cache: 'no-store' });
      if (!listed.ok) return false;

      const body = (await listed.json()) as
        | { ok: true; data: { runs: RunView[] } }
        | { ok: false };
      if (!body.ok) return false;

      const live = body.data.runs.filter(
        (run) => !TERMINAL.has(run.state) && (runId ? run.id === runId : true)
      );

      if (live.length === 0) return false;

      for (const run of live) {
        await fetch(`/api/runs/${run.id}/advance`, { method: 'POST' });
      }

      return true;
    } finally {
      advancing.current = false;
    }
  }, [runId]);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      const stillRunning = await driveRuns();
      if (cancelled) return;
      await refresh();
      if (cancelled) return;
      setDriving(stillRunning);
      setNow(Date.now());
    };

    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [driveRuns, refresh]);

  // Derived, not stored: which agent is mid-step is just the latest actor while a run is live.
  const activeAgent: AgentId | null = driving ? (events[0]?.agentId ?? null) : null;

  if (events.length === 0) {
    return (
      <div className="border-line rounded-card border border-dashed p-6 text-center">
        <p className="text-sm font-medium">Nothing has happened yet.</p>
        <p className="text-slate mt-1 text-sm">
          Add something to your pantry and the agents will start working here.
        </p>
      </div>
    );
  }

  return (
    <section aria-labelledby="feed-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="feed-heading" className="text-sm font-semibold">
          Agent activity
        </h2>
        {driving && (
          <span className="text-clay-ink inline-flex items-center gap-1.5 text-xs">
            <Spinner />
            {activeAgent ? `${activeAgent} working` : 'working'}
          </span>
        )}
      </div>

      {/*
        aria-live so a screen reader hears each new step as it lands, rather than the user having
        to go looking for what changed.
      */}
      <ol
        aria-live="polite"
        aria-relevant="additions"
        className="border-line mt-3 space-y-0 border-l"
      >
        {events.map((event, index) => (
          <FeedCard
            key={event.id}
            event={event}
            now={now}
            compact={compact}
            // The connector line is only drawn where a real causal link exists.
            linked={index < events.length - 1 && events[index + 1]?.id === event.causedBy}
          />
        ))}
      </ol>
    </section>
  );
}

function FeedCard({
  event,
  now,
  compact,
  linked,
}: {
  event: FeedEventView;
  now: number;
  compact: boolean;
  linked: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <li className="relative pb-4 pl-5">
      <span
        aria-hidden="true"
        className={`absolute top-2 -left-[4.5px] size-2 rounded-full ${agentDotClass(event.agentId)}`}
      />
      {linked && (
        <span
          aria-hidden="true"
          className="bg-clay/30 absolute top-4 -left-px h-full w-px"
          title="caused the step above"
        />
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <AgentBadge agentId={event.agentId} />
        <span className="text-slate text-[11px]">{relativeTime(event.at, now)}</span>
        {event.fixture && (
          <span className="bg-paper-sunken text-slate rounded px-1.5 py-0.5 text-[10px] font-medium">
            demo fixture
          </span>
        )}
        {event.fallback && (
          <span className="bg-urgency-soon/20 text-urgency-soon-ink rounded px-1.5 py-0.5 text-[10px] font-medium">
            {fallbackLabel(event.fallback)}
          </span>
        )}
      </div>

      <p className="mt-1 text-sm leading-relaxed">{event.summary}</p>

      {!compact && (
        <>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="text-slate hover:text-ink mt-1 text-xs underline"
          >
            {open ? 'hide details' : 'details'}
          </button>

          {open && (
            <div className="bg-paper-sunken rounded-card mt-2 p-2.5">
              <dl className="text-slate grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <dt>step</dt>
                <dd className="text-ink font-mono">{event.kind}</dd>
                <dt>took</dt>
                <dd className="text-ink">{event.latencyMs} ms</dd>
                {event.costUsd > 0 && (
                  <>
                    <dt>model cost</dt>
                    <dd className="text-ink">${event.costUsd.toFixed(4)}</dd>
                  </>
                )}
              </dl>
              {event.detail != null && (
                <pre className="text-slate mt-2 max-h-56 overflow-auto text-[10px] leading-relaxed whitespace-pre-wrap">
                  {JSON.stringify(event.detail, null, 2)}
                </pre>
              )}
            </div>
          )}
        </>
      )}
    </li>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="border-clay/30 border-t-clay inline-block size-3 animate-spin rounded-full border-2"
    />
  );
}
