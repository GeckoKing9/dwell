/**
 * Site focus: one site's part of a week or a day, for the charts and the headline. Pure, and built on the
 * week's own aggregate: the site's daily average and its comparison are taken over the very days the
 * week's headline uses (`averaged`, `compared`), by the headline's rule, so the two read side by side.
 */
import { dayAggregate, siteHours, weekDelta } from '../stats/aggregate.ts';
import type { SiteDelta, WeekAggregate } from '../stats/aggregate.ts';
import { addDays } from '../stats/weeks.ts';
import { dayKey } from '../store/schema.ts';
import type { DayRecord } from '../store/schema.ts';
import { own } from '../tracker/records.ts';

export interface SiteWeek {
  site: string;
  /** The site's seconds on each day, Monday first; 0 where it, or the day, has nothing. */
  days: number[];
  total: number;
  /** Over the days the week's own daily average uses. */
  dailyAverage: number;
  /** Over the days of the week before the week's own comparison uses; 0 when the site was not used then, null with nothing to compare. */
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

function percent(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

function mean(values: readonly number[]): number | null {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** 'new' when the week before had data but not this site (true whatever this week holds); the headline's rule otherwise. */
function siteWeekDelta(average: number, previous: number | null): SiteDelta {
  if (previous !== null && previous < 1) return { kind: 'new', percent: 0 };
  return weekDelta(average, previous);
}

export function siteWeek(agg: WeekAggregate, days: Record<string, DayRecord>, site: string): SiteWeek {
  const seconds = (date: Date): number => {
    const stored = own(days, dayKey(date));
    return stored ? (dayAggregate(stored).sites.find((s) => s.site === site)?.seconds ?? 0) : 0;
  };
  const perDay = agg.days.map((cell) => (cell.status === 'data' ? seconds(cell.date) : 0));
  const monday = agg.days[0]?.date;
  const dailyAverage = mean(agg.averaged.map((k) => perDay[k] ?? 0)) ?? 0;
  const previousAverage = monday === undefined ? null : mean(agg.compared.map((k) => seconds(addDays(monday, k - 7))));
  const total = perDay.reduce((a, b) => a + b, 0);
  return { site, days: perDay, total, dailyAverage, previousAverage, delta: siteWeekDelta(dailyAverage, previousAverage), share: percent(total, agg.total) };
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
