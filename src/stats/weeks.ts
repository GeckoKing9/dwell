import { parseDayKey } from '../store/schema.ts';

/** A Monday-start week in local time: both ends are local midnights. */
export interface WeekRange {
  start: Date;
  end: Date;
}

/** Local midnight of `date`. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Calendar-day arithmetic in local time; DST never shifts the date. */
export function addDays(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

/** Whole calendar days from `a` to `b` (b minus a), independent of DST. */
export function dayDiff(a: Date, b: Date): number {
  const ms = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  return Math.round(ms / 86_400_000);
}

export function weekOf(date: Date): WeekRange {
  const day = startOfDay(date);
  const start = addDays(day, -((day.getDay() + 6) % 7));
  return { start, end: addDays(start, 6) };
}

/** The 7 local days of the week, Monday first. */
export function weekDays(week: WeekRange): Date[] {
  return Array.from({ length: 7 }, (_, k) => addDays(week.start, k));
}

/** 0 for the current week, 1 for the one before, and so on. Labels are the UI's job. */
export function weekIndexFromToday(week: WeekRange, today: Date): number {
  return dayDiff(week.start, weekOf(today).start) / 7;
}

/**
 * Every week from the one holding the oldest stored day up to the current week,
 * oldest first. Keys that are not day keys are ignored.
 */
export function navigableWeeks(dayKeys: string[], today: Date): WeekRange[] {
  const todayMidnight = startOfDay(today);
  let oldest = todayMidnight;
  for (const key of dayKeys) {
    const date = parseDayKey(key);
    if (date && date.getTime() < oldest.getTime()) oldest = date;
  }
  const first = weekOf(oldest);
  const count = weekIndexFromToday(first, today) + 1;
  return Array.from({ length: count }, (_, i) => weekOf(addDays(first.start, i * 7)));
}
