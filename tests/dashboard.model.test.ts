import { describe, expect, it } from 'vitest';
import { buildView, clampBack, dayModel, deltaText, weekModel } from '../src/dashboard/model.ts';
import { simulateDays } from '../src/stats/simulate.ts';
import { navigableWeeks } from '../src/stats/weeks.ts';
import { NOW, sampleData } from './support/dashboard.ts';

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
    expect([...week.previous.entries()].sort()).toEqual([
      ['github.com', 9000],
      ['netflix.com', 1800],
    ]);
    const [github, youtube] = week.agg.sites;
    expect(github && deltaText(github, week.previous)).toBe('+3h\u00a020m');
    expect(youtube && deltaText(youtube, week.previous)).toBe('new');
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
