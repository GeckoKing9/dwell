import { own } from './records.ts';
import type { Attribution, Buckets, SiteBucket } from './types.ts';

export interface HourPiece {
  day: string;
  hour: number;
  start: number;
  end: number;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local calendar day of an instant, YYYY-MM-DD. */
export function localDayKey(ms: number): string {
  return dayKeyOf(new Date(ms));
}

/**
 * Splits [start, end) at every local hour boundary (KTD9). Boundaries come from the Date
 * constructor, so a 23- or 25-hour DST day and half-hour zones need no special case: the
 * repeated hour of a fall-back night is one piece under its single label. A backwards or empty
 * interval yields no piece.
 */
export function splitByLocalHour(start: number, end: number): HourPiece[] {
  const pieces: HourPiece[] = [];
  let cursor = start;
  while (cursor < end) {
    const d = new Date(cursor);
    const boundary = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
    // max() guarantees progress even if a zone rule ever produced a boundary at or before cursor.
    const stop = Math.min(end, Math.max(boundary, cursor + 1));
    pieces.push({ day: dayKeyOf(d), hour: d.getHours(), start: cursor, end: stop });
    cursor = stop;
  }
  return pieces;
}

/** Folds attributions into day buckets, returning a new object; the input is never mutated. */
export function addAttributions(buckets: Buckets, attributions: readonly Attribution[]): Buckets {
  let next = buckets;
  for (const a of attributions) {
    const day = own(next, a.day) ?? {};
    const site: SiteBucket = own(day, a.site) ?? { h: {}, v: 0 };
    const hour = String(a.hour);
    const h = a.seconds > 0 ? { ...site.h, [hour]: (own(site.h, hour) ?? 0) + a.seconds } : site.h;
    const v = site.v + (a.visit ? 1 : 0);
    next = { ...next, [a.day]: { ...day, [a.site]: { h, v } } };
  }
  return next;
}
