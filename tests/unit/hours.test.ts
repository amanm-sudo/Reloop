import { describe, expect, it } from 'vitest';
import { everyDay, formatIst, isOpenAt, nextOpenAt, proposeWindows, timingFit } from '@/lib/hours';

/**
 * Opening hours are stored as IST wall-clock strings and everything persisted is UTC, so this is
 * the one place the two meet — and the place where an off-by-five-and-a-half-hours bug would
 * quietly make every pickup window wrong.
 */

// 12:00 UTC is 17:30 IST.
const EVENING = new Date('2026-09-01T12:00:00.000Z');
// 20:00 UTC is 01:30 IST the following day.
const LATE_NIGHT = new Date('2026-09-01T20:00:00.000Z');
const HOUR = 3_600_000;

describe('IST conversion', () => {
  it('formats an instant in IST, not UTC', () => {
    expect(formatIst(EVENING)).toBe('5:30 PM');
  });

  it('handles noon and midnight without a 0 o\u2019clock', () => {
    expect(formatIst(new Date('2026-09-01T06:30:00.000Z'))).toBe('12:00 PM');
    expect(formatIst(new Date('2026-09-01T18:30:00.000Z'))).toBe('12:00 AM');
  });
});

describe('same-day windows', () => {
  const hours = everyDay('09:00', '18:00');

  it('is open inside the window', () => {
    expect(isOpenAt(hours, new Date('2026-09-01T06:00:00.000Z'))).toBe(true); // 11:30 IST
  });

  it('is open at 17:30 IST, which is inside 09:00-18:00', () => {
    expect(isOpenAt(hours, EVENING)).toBe(true);
  });

  it('is closed after it shuts', () => {
    expect(isOpenAt(hours, new Date('2026-09-01T14:30:00.000Z'))).toBe(false); // 20:00 IST
  });

  it('is closed before it opens', () => {
    expect(isOpenAt(hours, new Date('2026-09-01T01:00:00.000Z'))).toBe(false); // 06:30 IST
  });
});

describe('windows that cross midnight', () => {
  // A night shelter kitchen: the case that matters most for late cooked surplus.
  const hours = everyDay('19:00', '01:30');

  it('is open late in the evening', () => {
    expect(isOpenAt(hours, new Date('2026-09-01T14:00:00.000Z'))).toBe(true); // 19:30 IST
  });

  it('is still open after midnight', () => {
    expect(isOpenAt(hours, LATE_NIGHT)).toBe(true); // 01:30 IST next day
  });

  it('is closed in the small hours after it shuts', () => {
    expect(isOpenAt(hours, new Date('2026-09-01T22:00:00.000Z'))).toBe(false); // 03:30 IST
  });

  it('is closed in the afternoon', () => {
    expect(isOpenAt(hours, new Date('2026-09-01T09:00:00.000Z'))).toBe(false); // 14:30 IST
  });
});

describe('finding the next opening', () => {
  it('returns now when already open', () => {
    const hours = everyDay('00:00', '23:59');
    expect(nextOpenAt(hours, EVENING)).toEqual(EVENING);
  });

  it('finds a later opening within the horizon', () => {
    const hours = everyDay('19:00', '21:00'); // 19:00 IST = 13:30 UTC
    const opens = nextOpenAt(hours, EVENING, 6);
    expect(opens).not.toBeNull();
    expect(formatIst(opens!)).toBe('7:00 PM');
  });

  it('returns null when nothing opens inside the horizon', () => {
    const hours = everyDay('09:00', '10:00');
    // 17:30 IST, looking only two hours ahead.
    expect(nextOpenAt(hours, EVENING, 2)).toBeNull();
  });
});

describe('proposing pickup windows', () => {
  it('offers windows inside opening hours and before the deadline', () => {
    const windows = proposeWindows({
      hours: everyDay('09:00', '23:00'),
      earliest: EVENING,
      latest: new Date(EVENING.getTime() + 4 * HOUR),
    });

    expect(windows.length).toBeGreaterThan(0);
    expect(windows.length).toBeLessThanOrEqual(3);
    for (const window of windows) {
      expect(window.start.getTime()).toBeGreaterThanOrEqual(EVENING.getTime());
      expect(window.end.getTime()).toBeLessThanOrEqual(EVENING.getTime() + 4 * HOUR);
    }
  });

  it('spreads options out rather than bunching them, because three slots five minutes apart is not a choice', () => {
    const windows = proposeWindows({
      hours: everyDay('09:00', '23:00'),
      earliest: EVENING,
      latest: new Date(EVENING.getTime() + 4 * HOUR),
      count: 3,
    });

    if (windows.length === 3) {
      const first = windows[0]!.start.getTime();
      const last = windows[2]!.start.getTime();
      expect(last - first).toBeGreaterThan(HOUR);
    }
  });

  it('still offers something on a tight runway, instead of giving up on an urgent handoff', () => {
    // 40 minutes left and the recipient is open. Rounding to the next half hour with a fixed
    // 30-minute window used to yield nothing here, sending genuinely rescuable food to compost.
    const windows = proposeWindows({
      hours: everyDay('00:00', '23:59'),
      earliest: EVENING,
      latest: new Date(EVENING.getTime() + 40 * 60_000),
    });

    expect(windows.length).toBeGreaterThan(0);
    for (const window of windows) {
      expect(window.end.getTime()).toBeLessThanOrEqual(EVENING.getTime() + 40 * 60_000);
    }
  });

  it('narrows the window rather than overrunning the deadline', () => {
    const windows = proposeWindows({
      hours: everyDay('00:00', '23:59'),
      earliest: EVENING,
      latest: new Date(EVENING.getTime() + 20 * 60_000),
    });

    expect(windows.length).toBeGreaterThan(0);
    const first = windows[0]!;
    expect((first.end.getTime() - first.start.getTime()) / 60_000).toBeLessThanOrEqual(20);
  });

  it('returns nothing when the recipient is shut for the whole window', () => {
    const windows = proposeWindows({
      hours: everyDay('03:00', '04:00'),
      earliest: EVENING,
      latest: new Date(EVENING.getTime() + 3 * HOUR),
    });
    expect(windows).toEqual([]);
  });

  it('returns nothing when the deadline has already passed', () => {
    const windows = proposeWindows({
      hours: everyDay('00:00', '23:59'),
      earliest: EVENING,
      latest: new Date(EVENING.getTime() - HOUR),
    });
    expect(windows).toEqual([]);
  });
});

describe('timing fit', () => {
  it('is 1 when open throughout', () => {
    expect(timingFit(everyDay('00:00', '23:59'), EVENING, new Date(EVENING.getTime() + 3 * HOUR))).toBe(1);
  });

  it('is 0 when shut throughout', () => {
    expect(timingFit(everyDay('03:00', '04:00'), EVENING, new Date(EVENING.getTime() + 3 * HOUR))).toBe(0);
  });

  it('is partial when open for some of it', () => {
    // 17:30 IST to 20:30 IST against a window closing at 19:00 IST.
    const fit = timingFit(everyDay('09:00', '19:00'), EVENING, new Date(EVENING.getTime() + 3 * HOUR));
    expect(fit).toBeGreaterThan(0);
    expect(fit).toBeLessThan(1);
  });

  it('is 0 for a deadline in the past', () => {
    expect(timingFit(everyDay('00:00', '23:59'), EVENING, new Date(EVENING.getTime() - HOUR))).toBe(0);
  });
});
