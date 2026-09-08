'use client';

import { useState } from 'react';

/**
 * Turn-by-turn replay of the exchange.
 *
 * This is the screen the demo holds on, so it has to make one thing unmistakable: two independent
 * parties talked to each other and the outcome was not predetermined. The scrub control lets a
 * viewer step through the turns at their own pace, and the candidate table shows the options that
 * lost, with the sub-scores that decided it.
 */

export type TranscriptTurn = {
  turn: number;
  from: 'DONOR_AGENT' | 'PARTNER_AGENT';
  intent: string;
  message: string;
  at: string;
};

export type CandidateView = {
  orgName: string;
  rank: number;
  score: number;
  subScores: {
    proximity: number;
    categoryFit: number;
    capacityHeadroom: number;
    timingFit: number;
    penalty: number;
  };
  distanceKm: number;
  rejectedReason: string | null;
  chosen: boolean;
};

const REASONS: Record<string, string> = {
  'category-not-accepted': 'does not take this category',
  'needs-cold-chain': 'no cold chain',
  'no-capacity-today': 'full for today',
  'closed-before-deadline': 'closed for the whole window',
  'outside-coverage': 'outside its coverage radius',
};

export function NegotiationReplay({
  transcript,
  candidates,
  justification,
}: {
  transcript: TranscriptTurn[];
  candidates: CandidateView[];
  justification: string | null;
}) {
  const [visible, setVisible] = useState(transcript.length);

  return (
    <div className="space-y-6">
      <section aria-labelledby="why-heading">
        <h2 id="why-heading" className="text-sm font-semibold">
          Why this recipient
        </h2>
        {justification ? (
          <p className="border-clay/30 bg-clay-soft rounded-card mt-2 border p-3 text-sm">
            {justification}
          </p>
        ) : (
          <p className="text-slate mt-2 text-sm">No recipient was selected for this run.</p>
        )}

        <table className="mt-3 w-full text-left text-xs">
          <caption className="text-slate sr-only">
            Candidate recipients with the scores that decided the choice
          </caption>
          <thead className="text-slate">
            <tr className="border-line border-b">
              <th scope="col" className="py-1.5 pr-2 font-medium">
                Recipient
              </th>
              <th scope="col" className="py-1.5 pr-2 font-medium">
                Distance
              </th>
              <th scope="col" className="py-1.5 pr-2 font-medium">
                Room today
              </th>
              <th scope="col" className="py-1.5 font-medium">
                Score
              </th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => (
              <tr
                key={`${candidate.rank}-${candidate.orgName}`}
                className={`border-line border-b ${candidate.chosen ? 'font-semibold' : ''}`}
              >
                <td className="py-1.5 pr-2">
                  {candidate.orgName}
                  {candidate.chosen && <span className="text-clay-ink"> · chosen</span>}
                  {candidate.rejectedReason && (
                    <span className="text-slate block font-normal">
                      {REASONS[candidate.rejectedReason] ?? candidate.rejectedReason}
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-2">{candidate.distanceKm.toFixed(1)} km</td>
                <td className="py-1.5 pr-2">
                  {candidate.rejectedReason ? '—' : candidate.subScores.capacityHeadroom.toFixed(2)}
                </td>
                <td className="py-1.5">
                  {candidate.rejectedReason ? '—' : candidate.score.toFixed(3)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="exchange-heading">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="exchange-heading" className="text-sm font-semibold">
            The exchange
          </h2>
          <span className="text-slate text-xs">
            {visible} of {transcript.length} turns
          </span>
        </div>

        <p className="text-slate mt-1 text-xs leading-relaxed">
          The recipient side runs as a separate agent with its own capacity, hours and persona. It
          never sees the ranking above, or any of the donor side&apos;s reasoning.
        </p>

        {transcript.length > 1 && (
          <label className="mt-3 block">
            <span className="text-slate text-xs">Step through the turns</span>
            <input
              type="range"
              min={1}
              max={transcript.length}
              value={visible}
              onChange={(event) => setVisible(Number(event.target.value))}
              className="accent-clay mt-1 w-full"
            />
          </label>
        )}

        <ol className="mt-3 space-y-2">
          {transcript.slice(0, visible).map((turn) => {
            const isDonor = turn.from === 'DONOR_AGENT';
            return (
              <li
                key={turn.turn}
                className={`rounded-card max-w-[85%] border p-3 ${
                  isDonor
                    ? 'border-clay/30 bg-clay-soft'
                    : 'border-line bg-paper-sunken ml-auto'
                }`}
              >
                <p className="text-[11px] font-semibold tracking-wide uppercase">
                  {isDonor ? 'Negotiation Agent' : 'Recipient'}
                  <span className="text-slate ml-2 font-normal normal-case">
                    {turn.intent.toLowerCase()}
                  </span>
                </p>
                <p className="mt-1 text-sm leading-relaxed">{turn.message}</p>
              </li>
            );
          })}
        </ol>

        {transcript.length === 0 && (
          <p className="text-slate border-line rounded-card mt-3 border border-dashed p-6 text-center text-sm">
            No offer has gone out yet.
          </p>
        )}
      </section>
    </div>
  );
}
