import { DEFAULT_SETTINGS } from '../../src/store/schema.ts';
import type { DayRecord, Settings } from '../../src/store/schema.ts';
import type { DashboardData } from '../../src/dashboard/data.ts';
import { day, NOW } from './popup.ts';

export { day, NOW };

const H = 3600;

/**
 * Two and a half weeks around the prototype's clock (Wed Oct 14 2026, 4:40 pm). This week: Mon 2h 30m,
 * Tue 3h 50m (busiest hour 9 pm), today 1h. The week before: Mon to Wed 1h each, then Sat and Sun; Thu
 * and Fri empty. Plus one day on Sep 28 so the navigator has three weeks.
 */
export function sampleDays(): Record<string, DayRecord> {
  return {
    'd:2026-09-28': day({ 'github.com': { 10: H } }, { 'github.com': 1 }),
    'd:2026-10-05': day({ 'github.com': { 10: H } }, { 'github.com': 2 }),
    'd:2026-10-06': day({ 'github.com': { 10: 1800 }, 'netflix.com': { 21: 1800 } }, { 'github.com': 1, 'netflix.com': 1 }),
    'd:2026-10-07': day({ 'github.com': { 9: H } }, { 'github.com': 1 }),
    'd:2026-10-10': day({ 'youtube.com': { 15: 2 * 1800 } }),
    'd:2026-10-11': day({ 'youtube.com': { 15: 1800 } }),
    'd:2026-10-12': day({ 'github.com': { 10: H, 11: H }, 'instagram.com': { 20: 1800 } }, { 'github.com': 4, 'instagram.com': 6 }),
    'd:2026-10-13': {
      ...day({ 'github.com': { 9: 3000, 10: 3000, 11: 3000, 12: 1200 }, 'youtube.com': { 21: H } }, { 'github.com': 3, 'youtube.com': 2 }),
      blocked: { instagram: 2, youtube: 1, facebook: 0, x: 2 },
    },
    'd:2026-10-14': { ...day({ 'github.com': { 9: H } }, { 'github.com': 1 }), blocked: { instagram: 1, youtube: 0, facebook: 0, x: 0 } },
  };
}

export function sampleData(days: Record<string, DayRecord> = sampleDays(), settings: Partial<Settings> = {}, now: Date = NOW): DashboardData {
  return { days, settings: { ...DEFAULT_SETTINGS, ...settings }, now };
}
