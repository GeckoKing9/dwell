import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dayAggregate, siteHours, weekAggregate, weekDelta } from '../src/stats/aggregate.ts';
import type { WeekAggregate } from '../src/stats/aggregate.ts';
import { CATEGORIES, dayKey, emptyDayRecord } from '../src/store/schema.ts';
import type { DayRecord } from '../src/store/schema.ts';
import { navigableWeeks, weekOf } from '../src/stats/weeks.ts';
import { addDays, at, day, daysMap } from './stats-helpers.ts';

const TODAY = at(2026, 10, 14); // Wednesday
const THIS_MON = at(2026, 10, 12);
const LAST_MON = at(2026, 10, 5);

function assertFinite(agg: WeekAggregate): void {
  const numbers = [agg.total, agg.dailyAverage, agg.delta.percent, ...agg.sites.flatMap((s) => [s.seconds, s.share, s.delta.percent])];
  for (const n of numbers) expect(Number.isFinite(n)).toBe(true);
}

describe('dayAggregate', () => {
  it('returns 24 hourly totals with zeros for empty hours', () => {
    const rec: DayRecord = { sites: { 'a.com': { h: { '9': 600, '21': 300 }, v: 2 } }, blocked: { instagram: 1, youtube: 0, facebook: 0, x: 0 } };
    const agg = dayAggregate(rec);
    expect(agg.hours).toHaveLength(24);
    expect(agg.hours[9]).toBe(600);
    expect(agg.hours[21]).toBe(300);
    expect(agg.hours[0]).toBe(0);
    expect(agg.total).toBe(900);
    expect(agg.blocked.instagram).toBe(1);
  });

  it('lists sites by time with visits and the top sites of each hour', () => {
    const rec = emptyDayRecord();
    rec.sites['a.com'] = { h: { '10': 100, '11': 50 }, v: 3 };
    rec.sites['b.com'] = { h: { '10': 400 }, v: 1 };
    rec.sites['c.com'] = { h: { '10': 10 }, v: 1 };
    const agg = dayAggregate(rec);
    expect(agg.sites.map((s) => s.site)).toEqual(['b.com', 'a.com', 'c.com']);
    expect(agg.sites[1]).toEqual({ site: 'a.com', seconds: 150, visits: 3 });
    expect(agg.hourSites).toHaveLength(24);
    expect(agg.hourSites[10]?.map((s) => s.site)).toEqual(['b.com', 'a.com', 'c.com']);
    expect(agg.hourSites[0]).toEqual([]);
  });

  it('handles an empty record', () => {
    const agg = dayAggregate(emptyDayRecord());
    expect(agg.total).toBe(0);
    expect(agg.hours.every((h) => h === 0)).toBe(true);
  });

  it('ignores malformed hour keys instead of corrupting the series', () => {
    const rec = emptyDayRecord();
    rec.sites['a.com'] = { h: { '24': 100, x: 5, '3': 60 }, v: 1 };
    const agg = dayAggregate(rec);
    expect(agg.hours).toHaveLength(24);
    expect(agg.total).toBe(60);
  });
});

describe('weekDelta', () => {
  it('is none when there is no previous data', () => {
    expect(weekDelta(3600, null)).toEqual({ kind: 'none', percent: 0 });
    expect(weekDelta(3600, 0)).toEqual({ kind: 'none', percent: 0 });
    expect(weekDelta(0, 0)).toEqual({ kind: 'none', percent: 0 });
  });

  it('is same under 3 percent either way', () => {
    expect(weekDelta(1020, 1000).kind).toBe('same');
    expect(weekDelta(980, 1000).kind).toBe('same');
    expect(weekDelta(1000, 1000).kind).toBe('same');
  });

  it('reports less and more with a rounded percent', () => {
    expect(weekDelta(810, 1000)).toEqual({ kind: 'less', percent: 19 });
    expect(weekDelta(1190, 1000)).toEqual({ kind: 'more', percent: 19 });
    expect(weekDelta(1030, 1000).kind).toBe('more');
    expect(weekDelta(0, 1000)).toEqual({ kind: 'less', percent: 100 });
  });

  it('is never NaN or Infinity for any non-negative inputs', () => {
    const num = fc.double({ min: 0, max: 1e7, noNaN: true });
    fc.assert(
      fc.property(num, fc.option(num, { nil: null }), (cur, prev) => {
        const d = weekDelta(cur, prev);
        expect(Number.isFinite(d.percent)).toBe(true);
        expect(d.percent).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});

describe('weekAggregate', () => {
  it('averages over only the days with data (5 of 7)', () => {
    const entries: [Date, DayRecord][] = [0, 1, 2, 3, 4].map((i) => [addDays(LAST_MON, i), day({ 'a.com': 3600 })]);
    const agg = weekAggregate(daysMap(entries), weekOf(LAST_MON), TODAY);
    expect(agg.daysWithData).toBe(5);
    expect(agg.dailyAverage).toBe(3600);
    expect(agg.total).toBe(18000);
  });

  it('marks each day data, empty, future or old', () => {
    const days = daysMap([[THIS_MON, day({ 'a.com': 600 })], [TODAY, day({ 'a.com': 60 })]]);
    const agg = weekAggregate(days, weekOf(TODAY), TODAY);
    expect(agg.days.map((d) => d.status)).toEqual(['data', 'empty', 'data', 'future', 'future', 'future', 'future']);
    const old = weekAggregate(days, weekOf(addDays(TODAY, -98)), TODAY);
    expect(old.days.every((d) => d.status === 'old')).toBe(true);
  });

  it('excludes today from the average in the current week', () => {
    const days = daysMap([[THIS_MON, day({ 'a.com': 7200 })], [addDays(THIS_MON, 1), day({ 'a.com': 7200 })], [TODAY, day({ 'a.com': 1000 })]]);
    const agg = weekAggregate(days, weekOf(TODAY), TODAY);
    expect(agg.dailyAverage).toBe(7200);
    expect(agg.total).toBe(15400);
  });

  it('falls back to today when it is the only day with data', () => {
    const agg = weekAggregate(daysMap([[TODAY, day({ 'a.com': 900 })]]), weekOf(TODAY), TODAY);
    expect(agg.dailyAverage).toBe(900);
  });

  it('has a none delta, and no NaN, when the previous week is empty', () => {
    const agg = weekAggregate(daysMap([[THIS_MON, day({ 'a.com': 600 })]]), weekOf(TODAY), TODAY);
    expect(agg.delta.kind).toBe('none');
    expect(agg.previousAverage).toBeNull();
    expect(agg.sites[0]?.delta.kind).toBe('none');
    assertFinite(agg);
  });

  it('reports none for the oldest navigable week because the week before lies outside retention', () => {
    const entries: [Date, DayRecord][] = Array.from({ length: 90 }, (_, i) => [addDays(TODAY, -i), day({ 'a.com': 1800 })]);
    const days = daysMap(entries);
    const weeks = navigableWeeks(Object.keys(days), TODAY);
    const first = weeks[0];
    expect(first).toBeDefined();
    if (!first) return;
    const agg = weekAggregate(days, first, TODAY);
    expect(agg.delta.kind).toBe('none');
    expect(agg.sites[0]?.delta.kind).toBe('none');
    const second = weeks[1];
    if (second) expect(weekAggregate(days, second, TODAY).delta.kind).toBe('same');
  });

  it('compares the current week like for like: Monday to today against the same weekdays', () => {
    const entries: [Date, DayRecord][] = [];
    for (let i = 0; i < 7; i++) entries.push([addDays(LAST_MON, i), day({ 'a.com': i < 3 ? 1000 : 100000 })]);
    for (let i = 0; i < 3; i++) entries.push([addDays(THIS_MON, i), day({ 'a.com': 1500 })]);
    const agg = weekAggregate(daysMap(entries), weekOf(TODAY), TODAY);
    const row = agg.sites[0];
    expect(row?.seconds).toBe(4500);
    expect(row?.delta).toEqual({ kind: 'more', percent: 50 });
    expect(agg.compare).toEqual({ partial: true, throughDay: 2 });
  });

  it('compares a finished week against the whole week before', () => {
    const entries: [Date, DayRecord][] = [];
    for (let i = 0; i < 7; i++) entries.push([addDays(LAST_MON, i), day({ 'a.com': 1000 })]);
    for (let i = 0; i < 7; i++) entries.push([addDays(LAST_MON, i - 7), day({ 'a.com': 2000 })]);
    const agg = weekAggregate(daysMap(entries), weekOf(LAST_MON), TODAY);
    expect(agg.sites[0]?.delta).toEqual({ kind: 'less', percent: 50 });
    expect(agg.delta).toEqual({ kind: 'less', percent: 50 });
    expect(agg.compare.partial).toBe(false);
  });

  it('marks a site as new when it had nothing before and same within 60 seconds', () => {
    const days = daysMap([
      [LAST_MON, day({ 'a.com': 1000, 'b.com': 1000 })],
      [THIS_MON, day({ 'a.com': 1050, 'b.com': 1200, 'c.com': 300 })],
    ]);
    const agg = weekAggregate(days, weekOf(TODAY), TODAY);
    const by = Object.fromEntries(agg.sites.map((s) => [s.site, s.delta.kind]));
    expect(by).toEqual({ 'a.com': 'same', 'b.com': 'more', 'c.com': 'new' });
  });

  it('adds up category sums to the week total, with unknown sites in Other', () => {
    const days = daysMap([[THIS_MON, day({ 'figma.com': 600, 'instagram.com': 300, 'unknown.example': 100 })]]);
    const agg = weekAggregate(days, weekOf(TODAY), TODAY);
    expect(agg.categories.map((c) => c.category)).toEqual([...CATEGORIES]);
    expect(agg.categories.reduce((a, c) => a + c.seconds, 0)).toBe(agg.total);
    expect(agg.categories.find((c) => c.category === 'Other')?.seconds).toBe(100);
    expect(agg.categories.find((c) => c.category === 'Work')?.seconds).toBe(600);
  });

  it('honours the user category map', () => {
    const days = daysMap([[THIS_MON, day({ 'figma.com': 600 })]]);
    const agg = weekAggregate(days, weekOf(TODAY), TODAY, { 'figma.com': 'News' });
    expect(agg.categories.find((c) => c.category === 'News')?.seconds).toBe(600);
  });

  it('sums blocked redirects per site over the counted days', () => {
    const a = day({ 'a.com': 60 });
    a.blocked = { instagram: 2, youtube: 1, facebook: 0, x: 3 };
    const b = day({ 'a.com': 60 });
    b.blocked = { instagram: 1, youtube: 0, facebook: 4, x: 2 };
    const agg = weekAggregate(daysMap([[THIS_MON, a], [addDays(THIS_MON, 1), b]]), weekOf(TODAY), TODAY);
    expect(agg.blocked).toEqual({ instagram: 3, youtube: 1, facebook: 4, x: 5 });
  });

  it('reads a day recorded before X existed as 0 X redirects', () => {
    const a = day({ 'a.com': 60 });
    a.blocked = { instagram: 2, youtube: 1, facebook: 0 } as DayRecord['blocked'];
    const b = day({ 'a.com': 60 });
    b.blocked = { instagram: 0, youtube: 0, facebook: 0, x: 4 };
    const agg = weekAggregate(daysMap([[THIS_MON, a], [addDays(THIS_MON, 1), b]]), weekOf(TODAY), TODAY);
    expect(agg.blocked).toEqual({ instagram: 2, youtube: 1, facebook: 0, x: 4 });
    expect(dayAggregate(a).blocked).toEqual({ instagram: 2, youtube: 1, facebook: 0, x: 0 });
  });

  it('finds the quietest and busiest full day, never today', () => {
    const days = daysMap([
      [THIS_MON, day({ 'a.com': 3500 })],
      [addDays(THIS_MON, 1), day({ 'a.com': 900 })],
      [TODAY, day({ 'a.com': 100 })],
    ]);
    const agg = weekAggregate(days, weekOf(TODAY), TODAY);
    expect(agg.busiest && dayKey(agg.busiest.date)).toBe(dayKey(THIS_MON));
    expect(agg.quietest && dayKey(agg.quietest.date)).toBe(dayKey(addDays(THIS_MON, 1)));
  });

  it('has no quietest or busiest day without a full day of data', () => {
    const agg = weekAggregate(daysMap([[TODAY, day({ 'a.com': 100 })]]), weekOf(TODAY), TODAY);
    expect(agg.busiest).toBeNull();
    expect(agg.quietest).toBeNull();
  });

  it('is all zeros and finite for a week with no data', () => {
    const agg = weekAggregate({}, weekOf(TODAY), TODAY);
    expect(agg.total).toBe(0);
    expect(agg.dailyAverage).toBe(0);
    expect(agg.sites).toEqual([]);
    assertFinite(agg);
  });
});

const siteArb = fc.constantFrom('figma.com', 'instagram.com', 'youtube.com', 'amazon.ca', 'lapresse.ca', 'x.example', 'y.example');
const hoursArb = fc.dictionary(fc.integer({ min: 0, max: 23 }).map(String), fc.integer({ min: 0, max: 3600 }));
const siteRecordArb = fc.record({ h: hoursArb, v: fc.integer({ min: 0, max: 30 }) });
const recordArb = fc.dictionary(siteArb, siteRecordArb, { maxKeys: 5 }).map(
  (sites): DayRecord => ({ sites, blocked: { instagram: 0, youtube: 0, facebook: 0, x: 0 } }),
);
const weekDataArb = fc.array(fc.option(recordArb, { nil: null }), { minLength: 14, maxLength: 14 });

describe('weekAggregate properties', () => {
  it('keeps category sums equal to the total, shares near 100 percent and deltas finite', () => {
    fc.assert(
      fc.property(weekDataArb, fc.integer({ min: 0, max: 6 }), (records, todayOffset) => {
        const today = addDays(THIS_MON, todayOffset);
        const entries: [Date, DayRecord][] = [];
        records.forEach((rec, i) => {
          if (rec) entries.push([addDays(LAST_MON, i), rec]);
        });
        for (const week of [weekOf(today), weekOf(LAST_MON)]) {
          const agg = weekAggregate(daysMap(entries), week, today);
          expect(agg.categories.reduce((a, c) => a + c.seconds, 0)).toBe(agg.total);
          const share = agg.sites.reduce((a, s) => a + s.share, 0);
          if (agg.total > 0) expect(Math.abs(share - 100)).toBeLessThan(1e-6);
          else expect(share).toBe(0);
          assertFinite(agg);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('siteHours and every site of each hour', () => {
  const record: DayRecord = {
    sites: {
      'a.com': { h: { '9': 600, '10': 1200, '24': 50, x: 30, '11': -5, '12': Number.NaN }, v: 2 },
      'b.com': { h: { '9': 900 }, v: 1 },
      'c.com': { h: { '9': 300 }, v: 1 },
      'd.com': { h: { '9': 600 }, v: 1 },
      'e.com': { h: { '9': 0 }, v: 1 },
    },
    blocked: { instagram: 0, youtube: 0, facebook: 0, x: 0 },
  };

  it('gives one site’s seconds per hour with the same rules as the day total', () => {
    const hours = siteHours(record, 'a.com');
    expect(hours).toHaveLength(24);
    expect(hours[9]).toBe(600);
    expect(hours[10]).toBe(1200);
    expect(hours.reduce((a, b) => a + b, 0)).toBe(1800);
    expect(siteHours(record, 'missing.com')).toEqual(new Array(24).fill(0));
    expect(siteHours(record, 'toString')).toEqual(new Array(24).fill(0));
  });

  it('lists every site of each hour busiest first, past the tooltip’s three', () => {
    const lists = dayAggregate(record).hourAll;
    expect(lists).toHaveLength(24);
    expect(lists[9]).toEqual([
      { site: 'b.com', seconds: 900 },
      { site: 'a.com', seconds: 600 },
      { site: 'd.com', seconds: 600 },
      { site: 'c.com', seconds: 300 },
    ]);
    expect(lists[10]).toEqual([{ site: 'a.com', seconds: 1200 }]);
    expect(lists[11]).toEqual([]);
    expect(dayAggregate(record).hourSites[9]).toEqual(lists[9]?.slice(0, 3));
  });

  it('agrees with the day total for every hour', () => {
    const agg = dayAggregate(record);
    agg.hourAll.forEach((list, h) => expect(list.reduce((a, s) => a + s.seconds, 0)).toBe(agg.hours[h]));
  });
});
