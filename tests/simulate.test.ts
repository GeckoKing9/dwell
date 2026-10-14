import { describe, expect, it } from 'vitest';
import { weekAggregate } from '../src/stats/aggregate.ts';
import { simulateDays } from '../src/stats/simulate.ts';
import { navigableWeeks } from '../src/stats/weeks.ts';
import { isDayKey } from '../src/store/schema.ts';
import { at } from './stats-helpers.ts';

const TODAY = at(2026, 10, 14, 16);

describe('simulateDays', () => {
  it('is identical twice for one seed and different for another', () => {
    const a = simulateDays(20261014, TODAY);
    const b = simulateDays(20261014, TODAY);
    const c = simulateDays(7, TODAY);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('produces 90 day keys ending today', () => {
    const days = simulateDays(1, TODAY);
    const keys = Object.keys(days).sort();
    expect(keys).toHaveLength(90);
    expect(keys.at(-1)).toBe('d:2026-10-14');
    expect(keys[0]).toBe('d:2026-07-17');
    expect(keys.every(isDayKey)).toBe(true);
  });

  it('honours a custom day count', () => {
    expect(Object.keys(simulateDays(1, TODAY, 10))).toHaveLength(10);
  });

  it('validates against the schema: integer hours 0..3600, visits >= 0, hour sums capped', () => {
    for (const seed of [1, 2, 20261014]) {
      const days = simulateDays(seed, TODAY);
      for (const [key, rec] of Object.entries(days)) {
        expect(isDayKey(key)).toBe(true);
        const perHour: Record<string, number> = {};
        for (const [site, sr] of Object.entries(rec.sites)) {
          expect(site).toMatch(/^[a-z0-9.-]+\.[a-z]+$/);
          expect(Number.isInteger(sr.v) && sr.v >= 0).toBe(true);
          for (const [h, s] of Object.entries(sr.h)) {
            expect(Number(h)).toBeGreaterThanOrEqual(0);
            expect(Number(h)).toBeLessThanOrEqual(23);
            expect(Number.isInteger(s) && s >= 0 && s <= 3600).toBe(true);
            perHour[h] = (perHour[h] ?? 0) + s;
          }
        }
        for (const total of Object.values(perHour)) expect(total).toBeLessThanOrEqual(3600);
        for (const n of Object.values(rec.blocked)) expect(Number.isInteger(n) && n >= 0).toBe(true);
      }
    }
  });

  it('has two near-empty days, a two-day gap and 2 to 7 hours on ordinary days', () => {
    const days = simulateDays(20261014, TODAY);
    const totals = Object.entries(days).map(([key, rec]) => {
      let t = 0;
      for (const sr of Object.values(rec.sites)) for (const s of Object.values(sr.h)) t += s;
      return { key, t };
    });
    const gap = totals.filter((d) => d.t === 0);
    const near = totals.filter((d) => d.t > 0 && d.t < 3600);
    expect(gap).toHaveLength(2);
    expect(near).toHaveLength(2);
    const [g1, g2] = gap.map((d) => d.key).sort();
    expect(g1 && g2 && Number(g2.slice(-2)) - Number(g1.slice(-2))).toBe(1);
    const ordinary = totals.filter((d) => d.t >= 3600 && d.key !== 'd:2026-10-14');
    expect(ordinary.length).toBeGreaterThan(80);
    for (const d of ordinary) {
      expect(d.t).toBeGreaterThanOrEqual(2 * 3600);
      expect(d.t).toBeLessThanOrEqual(7 * 3600);
    }
  });

  it('stays empty after the current hour today and feeds the aggregation without NaN', () => {
    const days = simulateDays(20261014, TODAY);
    const rec = days['d:2026-10-14'];
    expect(rec).toBeDefined();
    for (const sr of Object.values(rec?.sites ?? {})) {
      for (const h of Object.keys(sr.h)) expect(Number(h)).toBeLessThanOrEqual(16);
    }
    const weeks = navigableWeeks(Object.keys(days), TODAY);
    expect(weeks.length === 13 || weeks.length === 14).toBe(true);
    for (const w of weeks) {
      const agg = weekAggregate(days, w, TODAY);
      expect(Number.isFinite(agg.dailyAverage)).toBe(true);
      expect(agg.categories.reduce((a, c) => a + c.seconds, 0)).toBe(agg.total);
    }
  });
});
