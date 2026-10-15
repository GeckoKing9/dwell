import { describe, expect, it } from 'vitest';
import { addAttributions, localDayKey, splitByLocalHour } from '../src/tracker/buckets.ts';
import type { Buckets } from '../src/tracker/types.ts';
import { siteTotals } from './support/helpers.ts';
import { Story } from './support/story.ts';

const HOUR = 3_600_000;
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Local calendar days that are 23, 23.5, 24.5 or 25 hours long in one of the test zones. */
const DAYS: [string, number, number, number][] = [
  ['North America spring forward', 2026, 2, 8],
  ['North America fall back', 2026, 10, 1],
  ['Lord Howe fall back', 2026, 3, 5],
  ['Lord Howe spring forward', 2026, 9, 4],
  ['ordinary day', 2026, 5, 15],
];

const allDays = (hours: number) => Object.fromEntries(DAYS.map(([label]) => [label, hours]));
const EXPECTED_HOURS: Record<string, Record<string, number>> = {
  UTC: allDays(24),
  'Asia/Kolkata': allDays(24),
  'Asia/Calcutta': allDays(24),
  'America/Toronto': { 'North America spring forward': 23, 'North America fall back': 25 },
  'Australia/Lord_Howe': { 'Lord Howe fall back': 24.5, 'Lord Howe spring forward': 23.5 },
};

describe('localDayKey', () => {
  it('formats the local calendar day with zero padding', () => {
    expect(localDayKey(new Date(2026, 0, 5, 10, 30).getTime())).toBe('2026-01-05');
    expect(localDayKey(new Date(2026, 11, 31, 23, 59, 59).getTime())).toBe('2026-12-31');
  });
});

describe('splitByLocalHour', () => {
  it('returns one piece for an interval inside one hour', () => {
    const start = new Date(2026, 9, 14, 9, 10).getTime();
    expect(splitByLocalHour(start, start + 60_000)).toEqual([{ day: '2026-10-14', hour: 9, start, end: start + 60_000 }]);
  });

  it('splits at midnight into the right day and hour (AE4)', () => {
    const start = new Date(2026, 9, 14, 23, 58).getTime();
    const midnight = new Date(2026, 9, 15, 0, 0).getTime();
    expect(splitByLocalHour(start, start + 300_000)).toEqual([
      { day: '2026-10-14', hour: 23, start, end: midnight },
      { day: '2026-10-15', hour: 0, start: midnight, end: start + 300_000 },
    ]);
  });

  it('yields nothing for a clock that moved backwards, a zero interval or a non-finite time', () => {
    const now = new Date(2026, 9, 14, 12).getTime();
    expect(splitByLocalHour(now, now - 5_000)).toEqual([]);
    expect(splitByLocalHour(now, now)).toEqual([]);
    expect(splitByLocalHour(Number.NaN, now)).toEqual([]);
  });

  it.each(DAYS)('covers a whole local day without loss: %s', (label, y, m, d) => {
    const start = new Date(y, m, d).getTime();
    const end = new Date(y, m, d + 1).getTime();
    const pieces = splitByLocalHour(start, end);
    expect(pieces.reduce((sum, p) => sum + p.end - p.start, 0)).toBe(end - start);
    pieces.forEach((piece, i) => {
      expect(piece.day).toBe(localDayKey(start));
      expect(piece.hour).toBe(new Date(piece.start).getHours());
      expect(piece.end).toBeGreaterThan(piece.start);
      if (i > 0) {
        expect(piece.start).toBe(pieces[i - 1]?.end);
        expect(piece.hour).toBeGreaterThan(pieces[i - 1]?.hour ?? -1);
      }
    });
    expect((end - start) / HOUR).toBe(EXPECTED_HOURS[zone]?.[label] ?? (end - start) / HOUR);
  });

  it.each(DAYS)('lets the engine count a full day of ticks with totals preserved: %s', (_label, y, m, d) => {
    const start = new Date(y, m, d).getTime();
    const end = new Date(y, m, d + 1).getTime();
    const story = new Story(start).emit({ type: 'seed', windowId: 1, tabId: 1, site: 'alpha.example', idle: 'active' });
    story.wait((end - start) / 1000).end();
    expect(story.total('alpha.example').seconds).toBe((end - start) / 1000);
    expect(Object.keys(story.buckets)).toEqual([localDayKey(start)]);
  });
});

describe('addAttributions', () => {
  it('sums seconds into sparse hours and counts visits without mutating its input', () => {
    const empty: Buckets = {};
    const once = addAttributions(empty, [
      { site: 'alpha.example', day: '2026-10-14', hour: 9, seconds: 40, visit: true },
      { site: 'alpha.example', day: '2026-10-14', hour: 10, seconds: 0 },
    ]);
    const twice = addAttributions(once, [
      { site: 'alpha.example', day: '2026-10-14', hour: 9, seconds: 20 },
      { site: 'beta.example', day: '2026-10-15', hour: 0, seconds: 0, visit: true },
    ]);
    expect(empty).toEqual({});
    expect(once).toEqual({ '2026-10-14': { 'alpha.example': { h: { '9': 40 }, v: 1 } } });
    expect(twice).toEqual({
      '2026-10-14': { 'alpha.example': { h: { '9': 60 }, v: 1 } },
      '2026-10-15': { 'beta.example': { h: {}, v: 1 } },
    });
  });

  it('stores a site called __proto__ as data, not as a prototype', () => {
    const buckets = addAttributions({}, [{ site: '__proto__', day: '2026-10-14', hour: 1, seconds: 5, visit: true }]);
    expect(siteTotals(buckets)['__proto__']).toEqual({ seconds: 5, visits: 1 });
    expect(Object.getPrototypeOf(buckets['2026-10-14'])).toBe(Object.prototype);
  });
});
