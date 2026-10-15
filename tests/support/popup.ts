import { emptyDayRecord } from '../../src/store/schema.ts';
import type { DayRecord } from '../../src/store/schema.ts';

/** Wed Oct 14 2026, 4:40 pm local: the design prototype's clock. */
export const NOW = new Date(2026, 9, 14, 16, 40, 0);

/** A day record from { site: { hour: seconds } } and optional visits. */
export function day(hours: Record<string, Record<number, number>>, visits: Record<string, number> = {}): DayRecord {
  const record = emptyDayRecord();
  for (const [site, byHour] of Object.entries(hours)) {
    const h: Record<string, number> = {};
    for (const [hour, seconds] of Object.entries(byHour)) h[hour] = seconds;
    record.sites[site] = { h, v: visits[site] ?? 0 };
  }
  return record;
}
