/**
 * Site focus: one site's part of a week or a day, for the charts and the headline. Pure, and built on the
 * week's own aggregate: the site is averaged over the very days the week's average uses, and compared with
 * the week before by the same rule as its Most used row, so no two figures on the page can disagree.
 */
import { dayAggregate, siteDelta, siteHours } from '../stats/aggregate.ts';
import type { SiteDelta, WeekAggregate } from '../stats/aggregate.ts';
import type { DayRecord } from '../store/schema.ts';

export interface SiteWeek {
  site: string;
  /** The site's seconds on each day, Monday first; 0 where it, or the day, has nothing. */
  days: number[];
  total: number;
  /** Over the days the week's own daily average uses. */
  dailyAverage: number;
  /** The site's seconds over the same days of the week before, as its Most used row compares. */
  previous: number;
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

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function siteWeek(agg: WeekAggregate, days: Record<string, DayRecord>, site: string): SiteWeek {
  const record = (key: string): DayRecord | undefined => (Object.hasOwn(days, key) ? days[key] : undefined);
  const perDay = agg.days.map((cell) => {
    const stored = cell.status === 'data' ? record(cell.key) : undefined;
    return stored ? (dayAggregate(stored).sites.find((s) => s.site === site)?.seconds ?? 0) : 0;
  });
  const averaged = perDay.filter((_, k) => k <= agg.averageEnd && agg.days[k]?.status === 'data');
  const total = sum(perDay);
  const previous = agg.previous.get(site) ?? 0;
  const row = agg.sites.find((r) => r.site === site);
  return {
    site,
    days: perDay,
    total,
    dailyAverage: averaged.length > 0 ? sum(averaged) / averaged.length : 0,
    previous,
    delta: row?.delta ?? siteDelta(0, previous, agg.previousTotal),
    share: percent(total, agg.total),
  };
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
