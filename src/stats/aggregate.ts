import { categoryOf } from './categories.ts';
import { addDays, dayDiff, startOfDay, weekOf } from './weeks.ts';
import type { WeekRange } from './weeks.ts';
import { BLOCKED_SITES, CATEGORIES, dayKey } from '../store/schema.ts';
import type { BlockedSite, Category, DayRecord, Site } from '../store/schema.ts';

/** Days kept by the 90-day prune: today and the 89 before it. */
export const RETENTION_DAYS = 90;
const SAME_SITE_SECONDS = 60;
const SAME_PERCENT = 0.03;
const TOP_SITES_PER_HOUR = 3;

export interface SiteTime {
  site: Site;
  seconds: number;
}

export interface SiteDay extends SiteTime {
  visits: number;
}

export interface DayAggregate {
  total: number;
  sites: SiteDay[];
  /** Always 24 entries, zeros included. */
  hours: number[];
  /** Always 24 entries; each lists that hour's top sites, busiest first. */
  hourSites: SiteTime[][];
  /** Always 24 entries; each lists every site of that hour, busiest first (`hourSites` is cut from it). */
  hourAll: SiteTime[][];
  blocked: Record<BlockedSite, number>;
}

export type DeltaKind = 'none' | 'same' | 'less' | 'more';
export interface Delta {
  kind: DeltaKind;
  percent: number;
}
export interface SiteDelta {
  kind: DeltaKind | 'new';
  percent: number;
}

export type DayStatus = 'data' | 'empty' | 'future' | 'old';
export interface DayCell {
  date: Date;
  key: string;
  status: DayStatus;
  total: number;
}

export interface SiteRow {
  site: Site;
  seconds: number;
  /** Percent of the week total, 0 to 100. */
  share: number;
  visits: number;
  delta: SiteDelta;
  category: Category;
}

export interface WeekAggregate {
  days: DayCell[];
  total: number;
  dailyAverage: number;
  daysWithData: number;
  /** Average of the comparison window one week earlier, null when there is nothing to compare with. */
  previousAverage: number | null;
  delta: Delta;
  sites: SiteRow[];
  categories: { category: Category; seconds: number }[];
  blocked: Record<BlockedSite, number>;
  quietest: DayCell | null;
  busiest: DayCell | null;
  /** partial: the week is still running and is compared Monday to today. throughDay: 0 = Monday. */
  compare: { partial: boolean; throughDay: number };
  /** Weekday indices (0 = Monday) of this week's days the daily average is taken over, ascending. */
  averaged: number[];
  /** Weekday indices of the week before's days `previousAverage` is taken over, ascending; empty when it is null. */
  compared: number[];
  /** Seconds per site over the same days of the week before (Monday to today while the week runs): the rows' base. */
  previous: ReadonlyMap<Site, number>;
}

const HOUR_RE = /^(?:[0-9]|1[0-9]|2[0-3])$/;

function safeSeconds(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

function bySecondsThenName(a: SiteTime, b: SiteTime): number {
  return b.seconds - a.seconds || (a.site < b.site ? -1 : a.site > b.site ? 1 : 0);
}

const memo = new WeakMap<DayRecord, DayAggregate>();

/**
 * The reduction of one stored day. Memoised by record identity: a record is replaced, never edited, when
 * storage changes, so the week model, the previous week and the day view share one reduction per day.
 */
export function dayAggregate(record: DayRecord): DayAggregate {
  const cached = memo.get(record);
  if (cached) return cached;
  const agg = reduceDay(record);
  memo.set(record, agg);
  return agg;
}

function reduceDay(record: DayRecord): DayAggregate {
  const hours = new Array<number>(24).fill(0);
  const perHour: Map<Site, number>[] = Array.from({ length: 24 }, () => new Map());
  const sites: SiteDay[] = [];
  let total = 0;
  for (const [site, data] of Object.entries(record.sites)) {
    let seconds = 0;
    for (const [h, value] of Object.entries(data.h)) {
      const s = safeSeconds(value);
      if (!HOUR_RE.test(h) || s === 0) continue;
      const hour = Number(h);
      hours[hour] = (hours[hour] ?? 0) + s;
      perHour[hour]?.set(site, s);
      seconds += s;
    }
    total += seconds;
    if (seconds > 0) sites.push({ site, seconds, visits: Math.max(0, Math.trunc(safeSeconds(data.v))) });
  }
  sites.sort(bySecondsThenName);
  const hourAll = perHour.map((m) =>
    [...m.entries()].map(([site, seconds]): SiteTime => ({ site, seconds })).sort(bySecondsThenName),
  );
  const hourSites = hourAll.map((list) => list.slice(0, TOP_SITES_PER_HOUR));
  const blocked = { instagram: 0, youtube: 0, facebook: 0, x: 0 };
  for (const b of BLOCKED_SITES) blocked[b] = Math.trunc(safeSeconds(record.blocked[b]));
  return { total, sites, hours, hourSites, hourAll, blocked };
}

/** Each valid hour's seconds of one site's record, by the same rules as the day reduction. */
function eachHour(data: { h: Record<string, unknown> }, visit: (hour: number, seconds: number) => void): void {
  for (const [h, value] of Object.entries(data.h)) {
    const s = safeSeconds(value);
    if (HOUR_RE.test(h) && s > 0) visit(Number(h), s);
  }
}

/** One site's seconds in each of the 24 hours of a stored day; zeros when the site is absent. */
export function siteHours(record: DayRecord, site: Site): number[] {
  const hours = new Array<number>(24).fill(0);
  const data = Object.hasOwn(record.sites, site) ? record.sites[site] : undefined;
  if (data) eachHour(data, (hour, s) => (hours[hour] = s));
  return hours;
}

/** Change of `current` against `previous`; same under 3 percent, none without a usable baseline (under one second counts as none, which also keeps the ratio finite). */
export function weekDelta(current: number, previous: number | null): Delta {
  if (previous === null || !Number.isFinite(previous) || previous < 1) return { kind: 'none', percent: 0 };
  const cur = Number.isFinite(current) && current > 0 ? current : 0;
  const ratio = Math.abs(cur - previous) / previous;
  const percent = Math.round(ratio * 100);
  if (ratio < SAME_PERCENT) return { kind: 'same', percent };
  return { kind: cur < previous ? 'less' : 'more', percent };
}

function siteDelta(current: number, previous: number, previousTotal: number): SiteDelta {
  if (previousTotal <= 0) return { kind: 'none', percent: 0 };
  if (previous < 1) return { kind: 'new', percent: 0 };
  if (Math.abs(current - previous) <= SAME_SITE_SECONDS) return { kind: 'same', percent: 0 };
  return { kind: current < previous ? 'less' : 'more', percent: Math.round((Math.abs(current - previous) / previous) * 100) };
}

interface Collected {
  /** Aggregates of the days with data, by weekday index. */
  byDay: Map<number, DayAggregate>;
  /** Redirects counted over the window's stored days, including days with no time. */
  blocked: Record<BlockedSite, number>;
  sites: Map<Site, SiteDay>;
  total: number;
}

function collect(days: Record<string, DayRecord>, week: WeekRange, retentionStart: Date, lastIdx: number): Collected {
  const byDay = new Map<number, DayAggregate>();
  const sites = new Map<Site, SiteDay>();
  const blocked = { instagram: 0, youtube: 0, facebook: 0, x: 0 };
  let total = 0;
  for (let k = 0; k <= lastIdx; k++) {
    const date = addDays(week.start, k);
    if (date.getTime() < retentionStart.getTime()) continue;
    const record = days[dayKey(date)];
    if (!record) continue;
    const agg = dayAggregate(record);
    for (const site of BLOCKED_SITES) blocked[site] += agg.blocked[site];
    if (agg.total <= 0) continue;
    byDay.set(k, agg);
    total += agg.total;
    for (const s of agg.sites) {
      const prev = sites.get(s.site);
      sites.set(s.site, { site: s.site, seconds: (prev?.seconds ?? 0) + s.seconds, visits: (prev?.visits ?? 0) + s.visits });
    }
  }
  return { byDay, blocked, sites, total };
}

function daysThrough(win: Collected, lastIdx: number): number[] {
  return [...win.byDay.keys()].filter((k) => k <= lastIdx).sort((a, b) => a - b);
}

function average(win: Collected, lastIdx: number): number | null {
  let sum = 0;
  let count = 0;
  for (const [k, agg] of win.byDay) {
    if (k > lastIdx) continue;
    sum += agg.total;
    count++;
  }
  return count > 0 ? sum / count : null;
}

export function weekAggregate(
  days: Record<string, DayRecord>,
  week: WeekRange,
  today: Date,
  categories: Record<Site, Category> = {},
): WeekAggregate {
  const todayMidnight = startOfDay(today);
  const retentionStart = addDays(todayMidnight, -(RETENTION_DAYS - 1));
  const isCurrent = week.start.getTime() === weekOf(today).start.getTime();
  const lastIdx = Math.min(6, dayDiff(week.start, todayMidnight));
  const cur = collect(days, week, retentionStart, lastIdx);
  const prevWeek = { start: addDays(week.start, -7), end: addDays(week.start, -1) };
  const prev = collect(days, prevWeek, retentionStart, lastIdx);

  const cells: DayCell[] = Array.from({ length: 7 }, (_, k) => {
    const date = addDays(week.start, k);
    const agg = cur.byDay.get(k);
    let status: DayStatus = 'empty';
    if (date.getTime() > todayMidnight.getTime()) status = 'future';
    else if (date.getTime() < retentionStart.getTime()) status = 'old';
    else if (agg) status = 'data';
    return { date, key: dayKey(date), status, total: status === 'data' ? (agg?.total ?? 0) : 0 };
  });

  // Averages use full days only: today is left out of the running week unless it is all there is.
  const fullDaysEnd = isCurrent ? lastIdx - 1 : lastIdx;
  const fullAverage = average(cur, fullDaysEnd);
  const usedToday = fullAverage === null;
  const dailyAverage = fullAverage ?? average(cur, lastIdx) ?? 0;
  const compareEnd = usedToday ? lastIdx : fullDaysEnd;
  const previousAverage = cur.byDay.size > 0 ? average(prev, compareEnd) : null;

  const total = cur.total;
  const siteRows: SiteRow[] = [...cur.sites.values()]
    .sort(bySecondsThenName)
    .map((s) => ({
      site: s.site,
      seconds: s.seconds,
      share: total > 0 ? (s.seconds / total) * 100 : 0,
      visits: s.visits,
      delta: siteDelta(s.seconds, prev.sites.get(s.site)?.seconds ?? 0, prev.total),
      category: categoryOf(s.site, categories),
    }));

  const sums = new Map<Category, number>(CATEGORIES.map((c) => [c, 0]));
  for (const row of siteRows) sums.set(row.category, (sums.get(row.category) ?? 0) + row.seconds);

  const full = cells.filter((c) => c.status === 'data' && c.date.getTime() < todayMidnight.getTime());
  let quietest: DayCell | null = null;
  let busiest: DayCell | null = null;
  for (const c of full) {
    if (!quietest || c.total < quietest.total) quietest = c;
    if (!busiest || c.total > busiest.total) busiest = c;
  }

  return {
    days: cells,
    total,
    dailyAverage,
    daysWithData: cur.byDay.size,
    previousAverage,
    delta: cur.byDay.size > 0 ? weekDelta(dailyAverage, previousAverage) : { kind: 'none', percent: 0 },
    sites: siteRows,
    categories: CATEGORIES.map((category) => ({ category, seconds: sums.get(category) ?? 0 })),
    blocked: cur.blocked,
    quietest,
    busiest,
    compare: { partial: isCurrent, throughDay: Math.max(-1, lastIdx) },
    averaged: daysThrough(cur, compareEnd),
    compared: previousAverage === null ? [] : daysThrough(prev, compareEnd),
    previous: new Map([...prev.sites.values()].map((s) => [s.site, s.seconds])),
  };
}
