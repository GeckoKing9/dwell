import { dayKey, emptyDayRecord } from '../src/store/schema.ts';
import type { DayRecord } from '../src/store/schema.ts';

/** A day record with each site's seconds in one hour (default noon), visits fixed at 1. */
export function day(spec: Record<string, number>, hour = 12): DayRecord {
  const record = emptyDayRecord();
  for (const [site, seconds] of Object.entries(spec)) {
    record.sites[site] = { h: { [String(hour)]: seconds }, v: 1 };
  }
  return record;
}

export function at(y: number, m: number, d: number, hh = 12): Date {
  return new Date(y, m - 1, d, hh, 30, 0);
}

export function addDays(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n, 12, 0, 0);
}

/** Build a days map from [date, record] pairs. */
export function daysMap(entries: [Date, DayRecord][]): Record<string, DayRecord> {
  const out: Record<string, DayRecord> = {};
  for (const [date, record] of entries) out[dayKey(date)] = record;
  return out;
}
