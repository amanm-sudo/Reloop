/**
 * Operating hours and pickup windows, in India Standard Time.
 *
 * IST is a fixed +05:30 with no daylight saving, so a constant offset is correct here rather than
 * merely convenient. Stored hours are IST wall-clock strings ('18:30'); everything persisted is
 * UTC. This module is the only place the two meet.
 */

export type OperatingHours = { day: number; open: string; close: string };

export type Window = { start: Date; end: Date };

const IST_OFFSET_MIN = 330;
const MS_PER_MIN = 60_000;

function parseHhMm(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** IST wall-clock view of an instant. Read with getUTC* accessors. */
function istView(instant: Date): Date {
  return new Date(instant.getTime() + IST_OFFSET_MIN * MS_PER_MIN);
}

/** The UTC instant for a given IST wall-clock day and minute-of-day. */
function instantFromIst(istMidnightUtcMs: number, minuteOfDay: number): Date {
  return new Date(istMidnightUtcMs + minuteOfDay * MS_PER_MIN - IST_OFFSET_MIN * MS_PER_MIN);
}

export function istDayOfWeek(instant: Date): number {
  return istView(instant).getUTCDay();
}

export function istMinuteOfDay(instant: Date): number {
  const view = istView(instant);
  return view.getUTCHours() * 60 + view.getUTCMinutes();
}

/** Milliseconds of the IST midnight that starts the day containing `instant`. */
function istMidnightMs(instant: Date): number {
  const view = istView(instant);
  return Date.UTC(view.getUTCFullYear(), view.getUTCMonth(), view.getUTCDate());
}

export function formatIst(instant: Date): string {
  const view = istView(instant);
  const hours = view.getUTCHours();
  const minutes = view.getUTCMinutes().toString().padStart(2, '0');
  const suffix = hours < 12 ? 'AM' : 'PM';
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${minutes} ${suffix}`;
}

/**
 * Supports windows that cross midnight, which matter here: night shelters and late community
 * kitchens are exactly the recipients still reachable when a household finds itself with cooked
 * surplus at 10 PM. A window with `close` earlier than `open` (19:00–01:30) is read as spanning
 * into the following day.
 */
export function isOpenAt(hours: readonly OperatingHours[], instant: Date): boolean {
  const day = istDayOfWeek(instant);
  const minute = istMinuteOfDay(instant);
  const previousDay = (day + 6) % 7;

  return hours.some((entry) => {
    const open = parseHhMm(entry.open);
    const close = parseHhMm(entry.close);
    if (open == null || close == null) return false;

    if (close >= open) {
      return entry.day === day && minute >= open && minute <= close;
    }

    // Spans midnight: open on its own day from `open`, and on the next day until `close`.
    if (entry.day === day) return minute >= open;
    if (entry.day === previousDay) return minute <= close;
    return false;
  });
}

/** The next instant this recipient is open, or null within the horizon. */
export function nextOpenAt(
  hours: readonly OperatingHours[],
  from: Date,
  horizonHours = 72
): Date | null {
  const stepMinutes = 15;
  const steps = Math.ceil((horizonHours * 60) / stepMinutes);

  for (let i = 0; i <= steps; i += 1) {
    const candidate = new Date(from.getTime() + i * stepMinutes * MS_PER_MIN);
    if (isOpenAt(hours, candidate)) return candidate;
  }
  return null;
}

export type ProposeWindowsInput = {
  hours: readonly OperatingHours[];
  /** No earlier than this — usually now plus a little travel slack. */
  earliest: Date;
  /** No later than this — the item's act-by time. */
  latest: Date;
  durationMin?: number;
  count?: number;
};

/**
 * Up to `count` pickup windows that a recipient could actually make.
 *
 * Candidates are spread across the available range rather than bunched at the start, because
 * three options five minutes apart is not a choice. Returns an empty array when the freshness
 * deadline lands outside every opening — the caller treats that as a timing failure, which is
 * exactly the situation that makes a real handoff fall through.
 */
export function proposeWindows(input: ProposeWindowsInput): Window[] {
  const runwayMin = (input.latest.getTime() - input.earliest.getTime()) / MS_PER_MIN;
  if (runwayMin <= 0) return [];

  const count = input.count ?? 3;

  /*
   * Tight runways get ASAP windows, not tidy appointment slots.
   *
   * Cooked surplus routinely has under an hour of usable life left, and a fixed 30-minute window
   * rounded up to the next half hour simply does not fit inside that — which used to send every
   * genuinely urgent item to compost while a recipient sat there open and willing. When time is
   * short, a real coordinator says "come as soon as you can", so the proposal narrows the window
   * and stops rounding.
   */
  const tight = runwayMin <= 120;
  const durationMin =
    input.durationMin ?? (tight ? Math.max(10, Math.floor(runwayMin / 2)) : 30);
  const stepMinutes = tight ? 5 : 30;

  /*
   * A window may be shorter than the ideal duration if that is what fits before the recipient
   * closes.
   *
   * Requiring a full-length slot entirely inside opening hours contradicts how the candidate
   * scorer decides eligibility — `timingFit` counts a recipient as viable if it is open for *part*
   * of the freshness window. That mismatch meant a night kitchen open until 01:30 was ranked first
   * and then handed no window at all, so the food was composted while somebody was still there to
   * take it. "Come in the next twenty minutes, before we close" is a real offer and now gets made.
   */
  const minDurationMin = tight ? 10 : 20;

  const startMs =
    Math.ceil(input.earliest.getTime() / (stepMinutes * MS_PER_MIN)) * (stepMinutes * MS_PER_MIN);
  const viable: Window[] = [];

  for (
    let ms = startMs;
    ms + minDurationMin * MS_PER_MIN <= input.latest.getTime();
    ms += stepMinutes * MS_PER_MIN
  ) {
    const start = new Date(ms);
    if (!isOpenAt(input.hours, start)) continue;

    // Longest end that is still open and still inside the freshness deadline.
    const maxByDeadline = (input.latest.getTime() - ms) / MS_PER_MIN;
    let chosenEnd: Date | null = null;

    for (let d = Math.min(durationMin, maxByDeadline); d >= minDurationMin; d -= 5) {
      const end = new Date(ms + d * MS_PER_MIN);
      if (isOpenAt(input.hours, end)) {
        chosenEnd = end;
        break;
      }
    }

    if (chosenEnd) viable.push({ start, end: chosenEnd });

    // Guard against a pathological range producing an unbounded scan.
    if (viable.length > 200) break;
  }

  if (viable.length === 0) return [];
  if (viable.length <= count) return viable;

  const picked: Window[] = [];
  for (let i = 0; i < count; i += 1) {
    const index = Math.round((i * (viable.length - 1)) / (count - 1 || 1));
    const window = viable[index];
    if (window && !picked.some((p) => p.start.getTime() === window.start.getTime())) {
      picked.push(window);
    }
  }

  return picked;
}

/** Fraction of the remaining freshness window during which the recipient is open. 0 means never. */
export function timingFit(hours: readonly OperatingHours[], from: Date, deadline: Date): number {
  const totalMinutes = (deadline.getTime() - from.getTime()) / MS_PER_MIN;
  if (totalMinutes <= 0) return 0;

  const stepMinutes = 30;
  const steps = Math.max(1, Math.floor(totalMinutes / stepMinutes));
  let open = 0;

  for (let i = 0; i < steps; i += 1) {
    if (isOpenAt(hours, new Date(from.getTime() + i * stepMinutes * MS_PER_MIN))) open += 1;
  }

  return open / steps;
}

/** Convenience for seeding: the same open/close every day of the week. */
export function everyDay(open: string, close: string): OperatingHours[] {
  return [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open, close }));
}

export { instantFromIst, istMidnightMs };
