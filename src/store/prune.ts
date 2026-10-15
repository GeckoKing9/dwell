/**
 * 90 rolling days by local calendar date (R10). Dates are compared as 'YYYY-MM-DD' strings;
 * the only local-time step is reading today's date, so DST can never move the cutoff.
 */
import { DAY_KEY_PREFIX, dateString, isDayKey } from './schema.ts';
import type { KeyValueStore } from './adapter.ts';

export const RETENTION_DAYS = 90;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** Moves a 'YYYY-MM-DD' date by whole calendar days. Pure calendar arithmetic in UTC, so no zone or DST applies. */
export function shiftDate(date: string, days: number): string {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError(`Not a date: ${date}`);
  const shifted = new Date(0);
  shifted.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1, 2)}-${pad(shifted.getUTCDate(), 2)}`;
}

/** The newest 90 local dates ending on `today`'s local date, both ends inclusive. */
export function retentionWindow(today: Date): { first: string; last: string } {
  const last = dateString(today);
  return { first: shiftDate(last, -(RETENTION_DAYS - 1)), last };
}

/**
 * Removes day keys dated before the window and returns them. Only valid 'd:YYYY-MM-DD' keys are
 * considered; settings, log, hot state and anything malformed are never touched.
 */
export async function pruneOldDays(store: KeyValueStore, today: Date): Promise<string[]> {
  const { first } = retentionWindow(today);
  const stale = (await store.keys()).filter((key) => isDayKey(key) && key.slice(DAY_KEY_PREFIX.length) < first);
  if (stale.length > 0) await store.remove(stale);
  return stale;
}
