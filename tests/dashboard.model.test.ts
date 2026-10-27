import { describe, expect, it } from 'vitest';
import { buildView, clampBack, dayModel, deltaText, weekModel } from '../src/dashboard/model.ts';
import { simulateDays } from '../src/stats/simulate.ts';
import { navigableWeeks } from '../src/stats/weeks.ts';
import type { DayRecord } from '../src/store/schema.ts';
import { day, NOW, sampleData } from './support/dashboard.ts';

describe('week model', () => {
  const week = weekModel(sampleData(), 0);

  it('is the current week, three weeks deep', () => {
    expect(week.week.start).toEqual(new Date(2026, 9, 12));
    expect(week.current).toBe(true);
    expect(week.maxBack).toBe(2);
    expect(week.days.map((d) => d.isToday)).toEqual([false, false, true, false, false, false, false]);
    expect(week.days.map((d) => d.cell.status)).toEqual(['data', 'data', 'data', 'future', 'future', 'future', 'future']);
  });

  it('averages the full days only and counts them', () => {
    expect(week.agg.total).toBe(26_400);
    expect(week.agg.dailyAverage).toBe(11_400);
    expect(week.fullDays).toBe(2);
    expect(week.averaged).toBe(2);
    expect(week.gaps).toEqual([]);
  });

  it('keeps each day’s three busiest sites for the tooltip', () => {
    expect(week.days[1]?.top.map((s) => s.site)).toEqual(['github.com', 'youtube.com']);
    expect(week.days[5]?.top).toEqual([]);
  });

  it('compares sites with the same weekdays of the week before', () => {
    expect([...week.agg.previous.entries()].sort()).toEqual([
      ['github.com', 9000],
      ['netflix.com', 1800],
    ]);
    const [github, youtube] = week.agg.sites;
    expect(github && deltaText(github, week.agg.previous)).toBe('+3h\u00a020m');
    expect(youtube && deltaText(youtube, week.agg.previous)).toBe('new');
  });

  it('lists past empty days as gaps and averages over the recorded ones', () => {
    const before = weekModel(sampleData(), 1);
    expect(before.current).toBe(false);
    expect(before.gaps.map((g) => g.date.getDate())).toEqual([8, 9]);
    expect(before.averaged).toBe(5);
    expect(before.agg.dailyAverage).toBe(3240);
  });

  it('stops at the oldest week and at this week', () => {
    expect(weekModel(sampleData(), 99).back).toBe(2);
    expect(weekModel(sampleData(), -4).back).toBe(0);
    expect(clampBack(3.7, 2)).toBe(1);
    expect(clampBack(1, 0)).toBe(0);
  });

  it('is one empty current week when nothing is stored', () => {
    const empty = weekModel(sampleData({}), 3);
    expect(empty.back).toBe(0);
    expect(empty.maxBack).toBe(0);
    expect(empty.agg.daysWithData).toBe(0);
    expect(empty.averaged).toBe(0);
  });

  it('counts today in the average when it is the only day with data', () => {
    const onlyToday = weekModel(sampleData({ 'd:2026-10-14': sampleData().days['d:2026-10-14']! }), 0);
    expect(onlyToday.fullDays).toBe(0);
    expect(onlyToday.averaged).toBe(1);
  });

  it('spans 13 or 14 weeks over 90 simulated days', () => {
    const days = simulateDays(20261014, NOW);
    const model = weekModel(sampleData(days), 0);
    expect(model.maxBack + 1).toBe(navigableWeeks(Object.keys(days), NOW).length);
    expect([13, 14]).toContain(model.maxBack + 1);
  });
});

describe('site change text', () => {
  const row = { site: 'a.com', seconds: 600, share: 10, visits: 1, category: 'Other' as const };
  it('says same within a minute, a dash without a baseline, and a signed duration otherwise', () => {
    expect(deltaText({ ...row, delta: { kind: 'same', percent: 0 } }, new Map())).toBe('same');
    expect(deltaText({ ...row, delta: { kind: 'none', percent: 0 } }, new Map())).toBe('–');
    expect(deltaText({ ...row, delta: { kind: 'less', percent: 50 } }, new Map([['a.com', 1800]]))).toBe('−20m');
  });
});

describe('day model', () => {
  it('finds the busiest hour, totals and neighbours', () => {
    const tue = dayModel(sampleData(), '2026-10-13');
    expect(tue?.agg.total).toBe(13_800);
    expect(tue?.peak).toBe(21);
    expect(tue?.visits).toBe(5);
    expect(tue?.prev).toBe('2026-10-12');
    expect(tue?.next).toBe('2026-10-14');
    expect(tue?.weekBack).toBe(0);
    expect(tue?.isToday).toBe(false);
  });

  it('has no next day on today and no previous day on the oldest week’s Monday', () => {
    expect(dayModel(sampleData(), '2026-10-14')?.next).toBeNull();
    expect(dayModel(sampleData(), '2026-10-14')?.isToday).toBe(true);
    expect(dayModel(sampleData(), '2026-09-28')?.prev).toBeNull();
    expect(dayModel(sampleData(), '2026-10-07')?.weekBack).toBe(1);
  });

  it('shows an empty day without a peak, and refuses the future or a bad date', () => {
    const thu = dayModel(sampleData(), '2026-10-08');
    expect(thu?.peak).toBeNull();
    expect(thu?.agg.total).toBe(0);
    expect(dayModel(sampleData(), '2026-10-15')).toBeNull();
    expect(dayModel(sampleData(), 'nope')).toBeNull();
  });
});

describe('views', () => {
  it('builds the view for each route, a future day falling back to this week', () => {
    const data = sampleData();
    expect(buildView({ view: 'week', back: 1 }, data).kind).toBe('week');
    expect(buildView({ view: 'day', date: '2026-10-13' }, data).kind).toBe('day');
    const future = buildView({ view: 'day', date: '2026-12-01' }, data);
    expect(future.kind === 'week' && future.model.back).toBe(0);
    const settings = buildView({ view: 'settings' }, data);
    expect(settings.kind === 'settings' && settings.sites).toEqual(['github.com', 'instagram.com', 'netflix.com', 'youtube.com']);
    expect(buildView({ view: 'privacy' }, data).kind).toBe('privacy');
  });
});

describe('week model cost', () => {
  it('reduces each of 14 days at most once for a week model with its previous week', () => {
    const reads = new Map<string, number>();
    const days: Record<string, DayRecord> = {};
    for (let d = 1; d <= 14; d++) {
      const key = `d:2026-10-${String(d).padStart(2, '0')}`;
      const record = { ...day({ 'github.com': { 9: 600 }, 'netflix.com': { 20: 300 } }), blocked: { instagram: 1, youtube: 0, facebook: 0, x: 0 } };
      days[key] = new Proxy(record, {
        get(target, prop, receiver) {
          if (prop === 'sites') reads.set(key, (reads.get(key) ?? 0) + 1);
          return Reflect.get(target, prop, receiver);
        },
      });
    }
    const model = weekModel(sampleData(days), 0);
    expect(model.agg.total).toBeGreaterThan(0);
    expect(model.agg.previous.get('github.com')).toBeGreaterThan(0);
    expect(model.agg.blocked.instagram).toBe(3);
    expect(reads.size).toBe(6); // Mon-Wed of this week and of the like-for-like previous window
    expect(Math.max(...reads.values())).toBe(1);
  });
});

describe('site focus on a week', () => {
  it('splits each day into the site’s part and averages it over the same full days as the week', () => {
    const focus = weekModel(sampleData(), 0, 'github.com').focus;
    expect(focus?.site).toBe('github.com');
    expect(focus?.days).toEqual([7200, 10_200, 3600, 0, 0, 0, 0]);
    expect(focus?.total).toBe(21_000);
    expect(focus?.dailyAverage).toBe(8700);
    expect(focus?.share).toBeCloseTo((21_000 / 26_400) * 100);
  });

  it('compares its daily average over the very days the week headline compares, by the headline’s rule', () => {
    const model = weekModel(sampleData(), 0, 'github.com');
    expect(model.agg.averaged).toEqual([0, 1]);
    expect(model.agg.compared).toEqual([0, 1]);
    expect(model.focus?.previousAverage).toBe(2700);
    expect(model.focus?.delta).toEqual({ kind: 'more', percent: 222 });
    expect(weekModel(sampleData(), 0, 'netflix.com').focus?.delta).toEqual({ kind: 'less', percent: 100 });
  });

  it('calls a site new when the week before had data but not this site', () => {
    const focus = weekModel(sampleData(), 0, 'instagram.com').focus;
    expect(focus?.days).toEqual([1800, 0, 0, 0, 0, 0, 0]);
    expect(focus?.dailyAverage).toBe(900);
    expect(focus?.previousAverage).toBe(0);
    expect(focus?.delta.kind).toBe('new');
  });

  it('averages a past week over all its recorded days', () => {
    const focus = weekModel(sampleData(), 1, 'youtube.com').focus;
    expect(focus?.days).toEqual([0, 0, 0, 0, 0, 3600, 1800]);
    expect(focus?.dailyAverage).toBe(1080);
    expect(focus?.delta.kind).toBe('new');
  });

  it('has nothing to compare with in an empty week and no focus without a site', () => {
    const focus = weekModel(sampleData({}), 0, 'a.com').focus;
    expect(focus).toMatchObject({ total: 0, dailyAverage: 0, previousAverage: null, share: 0, delta: { kind: 'none', percent: 0 } });
    expect(weekModel(sampleData(), 0).focus).toBeNull();
  });

  it('uses today alone when it is the only day with data', () => {
    const only = { 'd:2026-10-14': sampleData().days['d:2026-10-14']! };
    const focus = weekModel(sampleData(only), 0, 'github.com').focus;
    expect(focus?.dailyAverage).toBe(3600);
    expect(focus?.previousAverage).toBeNull();
  });
});

describe('site focus on a day', () => {
  it('gives the site’s hours, total, busiest hour, visits and share of the day', () => {
    const tue = dayModel(sampleData(), '2026-10-13', 'github.com');
    expect(tue?.focus?.hours.slice(9, 13)).toEqual([3000, 3000, 3000, 1200]);
    expect(tue?.focus).toMatchObject({ site: 'github.com', total: 10_200, peak: 9, visits: 3 });
    expect(tue?.focus?.share).toBeCloseTo((10_200 / 13_800) * 100);
  });

  it('is an empty focus on a day the site was not used, and none without a site', () => {
    const tue = dayModel(sampleData(), '2026-10-13', 'instagram.com');
    expect(tue?.focus).toMatchObject({ total: 0, peak: null, visits: 0, share: 0 });
    expect(dayModel(sampleData(), '2026-10-08', 'a.com')?.focus?.share).toBe(0);
    expect(dayModel(sampleData(), '2026-10-13')?.focus).toBeNull();
  });

  it('lists every site of every hour and names today', () => {
    const many = { 'd:2026-10-13': day({ 'a.com': { 9: 400 }, 'b.com': { 9: 300 }, 'c.com': { 9: 200 }, 'd.com': { 9: 100 } }) };
    const tue = dayModel(sampleData(many), '2026-10-13');
    expect(tue?.agg.hourAll[9]?.map((s) => s.site)).toEqual(['a.com', 'b.com', 'c.com', 'd.com']);
    expect(tue?.agg.hourAll).toHaveLength(24);
    expect(tue?.today).toBe('2026-10-14');
  });

  it('passes the route’s site to the week and day views', () => {
    const week = buildView({ view: 'week', back: 0, site: 'github.com' }, sampleData());
    expect(week.kind === 'week' && week.model.focus?.total).toBe(21_000);
    const tue = buildView({ view: 'day', date: '2026-10-13', site: 'github.com' }, sampleData());
    expect(tue.kind === 'day' && tue.model.focus?.total).toBe(10_200);
    const future = buildView({ view: 'day', date: '2026-12-01', site: 'github.com' }, sampleData());
    expect(future.kind === 'week' && future.model.focus?.site).toBe('github.com');
  });
});
