/**
 * Site focus: one site's part of a week or a day, for the charts and the headline. Pure: it averages
 * the site over the same days the week's own average uses, so the two figures can be read side by side.
 */
import { dayAggregate, RETENTION_DAYS, siteHours, weekDelta } from '../stats/aggregate.ts';
import type { SiteDelta } from '../stats/aggregate.ts';
import { addDays, dayDiff, startOfDay } from '../stats/weeks.ts';
import type { WeekRange } from '../stats/weeks.ts';
import { dayKey } from '../store/schema.ts';
import type { DayRecord } from '../store/schema.ts';

export interface SiteWeek {
  site: string;
  /** The site's seconds on each day, Monday first; 0 where it, or the day, has nothing. */
  days: number[];
  total: number;
  /** Over the full days with data, like the week's average; today alone when it is all there is. */
  dailyAverage: number;
  /** Over the same days of the week before; 0 when the site was not used then, null with nothing to compare. */
  previousAverage: number | null;
  delta: SiteDelta;
  /** Percent of the week's total, 0 to 100. */
  share: number;
}

export interface SiteDay {
  site: string;
  /** Always 24 entries. */
  hours: number[];
  total: number;
  visits: number;
  /** The site's busiest hour, or null when it was not used that day. */
  peak: number | null;
  /** Percent of the day's total, 0 to 100. */
  share: number;
}

interface Sum {
  /** Days with any data. */
  count: number;
  /** The site's seconds over those days. */
  seconds: number;
}

function percent(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/** 'new' when the week before had data but not this site (true whatever this week holds); the week's own rule otherwise. */
function siteWeekDelta(average: number, previous: number | null): SiteDelta {
  if (previous !== null && previous < 1) return { kind: 'new', percent: 0 };
  return weekDelta(average, previous);
}

export function siteWeek(days: Record<string, DayRecord>, week: WeekRange, now: Date, site: string, weekTotal: number): SiteWeek {
  const today = startOfDay(now);
  const keepFrom = addDays(today, -(RETENTION_DAYS - 1)).getTime();
  const sinceStart = dayDiff(week.start, today);
  const lastIdx = Math.min(6, sinceStart);
  const fullEnd = sinceStart <= 6 ? lastIdx - 1 : lastIdx;
  const dayAt = (start: Date, k: number): { data: boolean; seconds: number } => {
    const date = addDays(start, k);
    const record = date.getTime() < keepFrom ? undefined : days[dayKey(date)];
    const agg = record ? dayAggregate(record) : undefined;
    return { data: (agg?.total ?? 0) > 0, seconds: agg?.sites.find((s) => s.site === site)?.seconds ?? 0 };
  };
  const sum = (start: Date, end: number): Sum => {
    const out = { count: 0, seconds: 0 };
    for (let k = 0; k <= end; k++) {
      const d = dayAt(start, k);
      if (!d.data) continue;
      out.count++;
      out.seconds += d.seconds;
    }
    return out;
  };
  const perDay = Array.from({ length: 7 }, (_, k) => (k <= lastIdx ? dayAt(week.start, k).seconds : 0));
  const all = sum(week.start, lastIdx);
  const full = sum(week.start, fullEnd);
  const usedToday = full.count === 0;
  const current = usedToday ? all : full;
  const dailyAverage = current.count > 0 ? current.seconds / current.count : 0;
  const prev = sum(addDays(week.start, -7), usedToday ? lastIdx : fullEnd);
  const previousAverage = all.count > 0 && prev.count > 0 ? prev.seconds / prev.count : null;
  const total = perDay.reduce((a, b) => a + b, 0);
  return { site, days: perDay, total, dailyAverage, previousAverage, delta: siteWeekDelta(dailyAverage, previousAverage), share: percent(total, weekTotal) };
}

export function siteDay(record: DayRecord, site: string): SiteDay {
  const hours = siteHours(record, site);
  const agg = dayAggregate(record);
  const total = hours.reduce((a, b) => a + b, 0);
  return {
    site,
    hours,
    total,
    visits: agg.sites.find((s) => s.site === site)?.visits ?? 0,
    peak: total > 0 ? hours.indexOf(Math.max(...hours)) : null,
    share: percent(total, agg.total),
  };
}
