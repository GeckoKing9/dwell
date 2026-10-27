/** View models for the week and day views: pure functions of the stored days, the settings and the clock. */
import { dayAggregate, RETENTION_DAYS, weekAggregate } from '../stats/aggregate.ts';
import type { DayAggregate, DayCell, SiteRow, SiteTime, WeekAggregate } from '../stats/aggregate.ts';
import { addDays, startOfDay, weekIndexFromToday, weekOf } from '../stats/weeks.ts';
import type { WeekRange } from '../stats/weeks.ts';
import { dateString, dayKey, emptyDayRecord, parseDayKey } from '../store/schema.ts';
import type { DayRecord } from '../store/schema.ts';
import { t } from '../shared/i18n.ts';
import { durationText } from '../shared/ui/Duration.tsx';
import { knownSites, weeksOf } from './data.ts';
import { siteDay, siteWeek } from './focus.ts';
import type { SiteDay, SiteWeek } from './focus.ts';
import type { DashboardData } from './data.ts';
import type { Route } from './route.ts';

const TOP = 3;

export interface ChartDay {
  cell: DayCell;
  isToday: boolean;
  /** The day's three busiest sites, for the tooltip. */
  top: SiteTime[];
}

export interface WeekModel {
  back: number;
  /** How far back the oldest navigable week is. */
  maxBack: number;
  week: WeekRange;
  current: boolean;
  agg: WeekAggregate;
  days: ChartDay[];
  /** Like-for-like seconds per site one week earlier: Monday to the same weekday while the week runs. */
  previous: ReadonlyMap<string, number>;
  /** Days with data the daily average is taken over. */
  averaged: number;
  /** Full days (today excluded) with data: the average line and the quietest/busiest need two. */
  fullDays: number;
  /** Past days of the week with nothing recorded. */
  gaps: DayCell[];
  /** The focused site's part of the week, or null with no site focused. */
  focus: SiteWeek | null;
}

export interface DayModel {
  date: Date;
  key: string;
  agg: DayAggregate;
  isToday: boolean;
  now: Date;
  week: WeekRange;
  weekBack: number;
  visits: number;
  /** Busiest hour, or null on a day without data. */
  peak: number | null;
  prev: string | null;
  next: string | null;
  /** Today's 'YYYY-MM-DD', for the Today control. */
  today: string;
  /** The focused site's part of the day, or null with no site focused. */
  focus: SiteDay | null;
}

export type View =
  | { kind: 'week'; model: WeekModel }
  | { kind: 'day'; model: DayModel }
  | { kind: 'settings'; sites: string[] }
  | { kind: 'privacy' };

function record(days: Record<string, DayRecord>, key: string): DayRecord {
  return days[key] ?? emptyDayRecord();
}

export function clampBack(back: number, weekCount: number): number {
  return Math.min(Math.max(0, Math.trunc(back)), Math.max(0, weekCount - 1));
}

export function weekModel(data: DashboardData, back: number, site?: string): WeekModel {
  const weeks = weeksOf(data);
  const b = clampBack(back, weeks.length);
  const week = weeks[weeks.length - 1 - b] ?? weekOf(data.now);
  const agg = weekAggregate(data.days, week, data.now, data.settings.categories);
  const today = startOfDay(data.now).getTime();
  const days = agg.days.map((cell) => ({
    cell,
    isToday: cell.date.getTime() === today,
    top: cell.status === 'data' ? dayAggregate(record(data.days, cell.key)).sites.slice(0, TOP) : [],
  }));
  const fullDays = days.filter((d) => d.cell.status === 'data' && !d.isToday).length;
  const todayData = days.some((d) => d.isToday && d.cell.status === 'data');
  return {
    back: b,
    maxBack: weeks.length - 1,
    week,
    current: b === 0,
    agg,
    days,
    previous: agg.previous,
    averaged: fullDays > 0 ? fullDays : Number(todayData),
    fullDays,
    gaps: days.filter((d) => d.cell.status === 'empty' && !d.isToday).map((d) => d.cell),
    focus: site === undefined ? null : siteWeek(agg, data.days, site),
  };
}

/** The change against last week as the most-used list prints it: 'new', 'same', '+28m', '−46m' or a dash. */
export function deltaText(row: SiteRow, previous: ReadonlyMap<string, number>): string {
  if (row.delta.kind === 'none') return '\u2013';
  if (row.delta.kind === 'new') return t('deltaNew');
  if (row.delta.kind === 'same') return t('deltaSameShort');
  const diff = row.seconds - (previous.get(row.site) ?? 0);
  return `${diff > 0 ? '+' : '\u2212'}${durationText(Math.abs(diff))}`;
}

/** The day view for a stored or empty day up to today; null for a future date. */
export function dayModel(data: DashboardData, date: string, site?: string): DayModel | null {
  const day = parseDayKey(date);
  const today = startOfDay(data.now);
  if (day === null || day.getTime() > today.getTime()) return null;
  const weeks = weeksOf(data);
  const keepFrom = addDays(today, -(RETENTION_DAYS - 1));
  const first = weeks[0]?.start ?? keepFrom;
  const earliest = first.getTime() > keepFrom.getTime() ? first : keepFrom;
  const stored = record(data.days, dayKey(day));
  const agg = dayAggregate(stored);
  const busiest = Math.max(...agg.hours);
  const week = weekOf(day);
  return {
    date: day,
    key: dateString(day),
    agg,
    isToday: day.getTime() === today.getTime(),
    now: data.now,
    week,
    weekBack: weekIndexFromToday(week, data.now),
    visits: agg.sites.reduce((sum, s) => sum + s.visits, 0),
    peak: agg.total > 0 ? agg.hours.indexOf(busiest) : null,
    prev: day.getTime() > earliest.getTime() ? dateString(addDays(day, -1)) : null,
    next: day.getTime() < today.getTime() ? dateString(addDays(day, 1)) : null,
    today: dateString(today),
    focus: site === undefined ? null : siteDay(stored, site),
  };
}

/** What the main area shows for a route; a day in the future falls back to this week. */
export function buildView(route: Route, data: DashboardData): View {
  switch (route.view) {
    case 'settings':
      return { kind: 'settings', sites: knownSites(data) };
    case 'privacy':
      return { kind: 'privacy' };
    case 'day': {
      const model = dayModel(data, route.date, route.site);
      return model ? { kind: 'day', model } : { kind: 'week', model: weekModel(data, 0, route.site) };
    }
    case 'week':
      return { kind: 'week', model: weekModel(data, route.back, route.site) };
  }
}
