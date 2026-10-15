import { MAX_HOUR_SECONDS } from '../../src/store/days.ts';
import type { DayRecord } from '../../src/store/schema.ts';
import type { Buckets } from '../../src/tracker/types.ts';

/**
 * A replay that begins where the recorder already held a sub-second remainder for a site can end an
 * hour up to this much apart from the stored record. A replay from a `start` entry has no such gap.
 */
export const CARRY_TOLERANCE_SEC = 1;

/** Every hour whose stored and replayed seconds differ by more than the tolerance, and every visit count that differs. */
export function differences(days: Record<string, DayRecord>, buckets: Buckets): { problems: string[]; maxSec: number } {
  const problems: string[] = [];
  let maxSec = 0;
  for (const day of new Set([...Object.keys(days), ...Object.keys(buckets)])) {
    const stored = days[day]?.sites ?? {};
    const replayed = buckets[day] ?? {};
    for (const site of new Set([...Object.keys(stored), ...Object.keys(replayed)])) {
      const a = stored[site];
      const b = replayed[site];
      if ((a?.v ?? 0) !== (b?.v ?? 0)) problems.push(`${day} ${site}: ${a?.v ?? 0} visits stored, ${b?.v ?? 0} replayed`);
      for (const hour of new Set([...Object.keys(a?.h ?? {}), ...Object.keys(b?.h ?? {})])) {
        const diff = Math.abs((a?.h[hour] ?? 0) - Math.min(MAX_HOUR_SECONDS, b?.h[hour] ?? 0));
        maxSec = Math.max(maxSec, diff);
        if (diff > CARRY_TOLERANCE_SEC) problems.push(`${day} ${site} hour ${hour}: off by ${diff} s`);
      }
    }
  }
  return { problems, maxSec };
}
