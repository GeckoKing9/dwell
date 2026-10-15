import { addDays, startOfDay } from './weeks.ts';
import { dayKey, emptyDayRecord } from '../store/schema.ts';
import type { DayRecord } from '../store/schema.ts';

/** Seeded PRNG (mulberry32): same seed, same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

type Shape = 'work' | 'evening' | 'night' | 'morning' | 'spread';
type Kind = 'work' | 'social' | 'video' | 'shopping' | 'news' | 'other';

/** [site, kind, mean minutes per day, hour shape, minutes per visit, chance of appearing on a day] */
type SiteSpec = [string, Kind, number, Shape, number, number];

const SITES: SiteSpec[] = [
  ['github.com', 'work', 58, 'work', 12, 0.95],
  ['docs.google.com', 'work', 30, 'work', 9, 0.9],
  ['mail.google.com', 'work', 16, 'work', 3, 0.97],
  ['stackoverflow.com', 'work', 12, 'work', 4, 0.8],
  ['notion.so', 'work', 15, 'work', 8, 0.8],
  ['instagram.com', 'social', 32, 'evening', 4, 0.95],
  ['facebook.com', 'social', 11, 'evening', 5, 0.8],
  ['messenger.com', 'social', 8, 'spread', 2, 0.85],
  ['reddit.com', 'social', 18, 'evening', 6, 0.85],
  ['x.com', 'social', 9, 'spread', 4, 0.7],
  ['youtube.com', 'video', 34, 'evening', 10, 0.92],
  ['music.youtube.com', 'other', 14, 'work', 40, 0.55],
  ['netflix.com', 'video', 40, 'night', 45, 0.35],
  ['twitch.tv', 'video', 26, 'night', 30, 0.2],
  ['amazon.ca', 'shopping', 9, 'spread', 5, 0.45],
  ['lapresse.ca', 'news', 11, 'morning', 5, 0.85],
  ['nytimes.com', 'news', 7, 'morning', 4, 0.6],
];

const WEEKEND: Record<Kind, number> = { work: 0.12, social: 1.4, video: 1.6, shopping: 1.8, news: 1.15, other: 0.5 };

/** Bumps as [centre hour, weight, spread] per shape. */
const BUMPS: Record<Shape, [number, number, number][]> = {
  work: [[10, 1, 1.4], [14.5, 1.1, 1.8], [21, 0.25, 1]],
  evening: [[8, 0.25, 0.8], [12.5, 0.45, 0.8], [20.5, 1.2, 1.6]],
  night: [[21.5, 1, 1.3]],
  morning: [[7.5, 1, 0.9], [12.5, 0.4, 0.7], [18, 0.2, 1]],
  spread: [[10, 0.5, 2.5], [16, 0.5, 2.5], [21, 0.6, 1.5]],
};

/** Days back from today: two near-empty days and a two-day gap, as in the design prototype. */
const NEAR_EMPTY = new Set([53, 35]);
const GAP = new Set([18, 17]);
const HOUR_CAP = 3300;

function hourWeights(shape: Shape, weekend: boolean): number[] {
  const shift = weekend ? 1.5 : 0;
  const a = new Array<number>(24).fill(0.004);
  for (const [c, w, s] of BUMPS[shape]) {
    for (let x = 0; x < 24; x++) a[x] = (a[x] ?? 0) + w * Math.exp(-((x - (c + shift)) ** 2) / (2 * s * s));
  }
  for (let x = 0; x < 7; x++) a[x] = (a[x] ?? 0) * 0.04;
  return a;
}

/**
 * Ninety plausible local days ending on `today`: weekday and weekend shapes, evening peaks,
 * 2 to 7 hours on ordinary days, two near-empty days and a two-day gap. Deterministic per seed.
 * Hours after the current hour of `today` stay empty.
 */
export function simulateDays(seed: number, today: Date, days = 90): Record<string, DayRecord> {
  const rnd = mulberry32(seed);
  /** X redirects draw from their own stream, so adding them left every other simulated value as it was. */
  const xRnd = mulberry32(seed ^ 0x78);
  const gauss = (): number => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const poisson = (lambda: number, next: () => number = rnd): number => {
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= next();
    } while (p > limit);
    return k - 1;
  };

  const out: Record<string, DayRecord> = {};
  const last = startOfDay(today);
  for (let back = days - 1; back >= 0; back--) {
    const date = addDays(last, -back);
    const record = emptyDayRecord();
    out[dayKey(date)] = record;
    if (GAP.has(back)) continue;
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const nearEmpty = NEAR_EMPTY.has(back);
    const dayFactor = nearEmpty ? 0.03 : Math.exp(gauss() * 0.22) * 0.82;

    const minutes = new Map<string, number>();
    for (const [site, kind, mean, , , p] of SITES) {
      if (rnd() > p) continue;
      minutes.set(site, mean * (weekend ? WEEKEND[kind] : 1) * dayFactor * Math.exp(gauss() * 0.45));
    }
    let sum = 0;
    for (const m of minutes.values()) sum += m;
    if (!nearEmpty && sum > 0) {
      const lo = 125 + rnd() * 20;
      const hi = 400 + rnd() * 15;
      const k = sum < lo ? lo / sum : sum > hi ? hi / sum : 1;
      for (const [site, m] of minutes) minutes.set(site, m * k);
    }

    const hours: Record<string, number>[] = Array.from({ length: 24 }, () => ({}));
    const visits: Record<string, number> = {};
    for (const [site, , , shape, perVisit] of SITES) {
      const m = minutes.get(site);
      if (!m) continue;
      const w = hourWeights(shape, weekend).map((x) => x * (0.55 + rnd() * 0.9));
      const ws = w.reduce((a, b) => a + b, 0);
      for (let x = 0; x < 24; x++) {
        const s = Math.round((m * 60 * (w[x] ?? 0)) / ws);
        if (s >= (nearEmpty ? 1 : 15)) (hours[x] as Record<string, number>)[site] = s;
      }
      visits[site] = Math.max(1, Math.round((m / perVisit) * Math.exp(gauss() * 0.3)));
    }
    for (const hs of hours) {
      const hourSum = Object.values(hs).reduce((a, b) => a + b, 0);
      if (hourSum > HOUR_CAP) for (const site of Object.keys(hs)) hs[site] = Math.round(((hs[site] ?? 0) * HOUR_CAP) / hourSum);
    }
    if (back === 0) {
      const now = today.getHours();
      const fraction = Math.max(today.getMinutes(), 1) / 60;
      for (let x = now + 1; x < 24; x++) hours[x] = {};
      const current = hours[now] as Record<string, number>;
      for (const site of Object.keys(current)) current[site] = Math.round((current[site] ?? 0) * fraction);
      for (const site of Object.keys(visits)) {
        if (!hours.some((hs) => hs[site])) delete visits[site];
        else visits[site] = Math.max(1, Math.round((visits[site] ?? 1) * 0.7));
      }
    }

    for (const site of Object.keys(visits)) {
      const h: Record<string, number> = {};
      hours.forEach((hs, x) => {
        const s = hs[site];
        if (s && s > 0) h[String(x)] = s;
      });
      if (Object.keys(h).length > 0) record.sites[site] = { h, v: visits[site] ?? 1 };
    }
    if (!nearEmpty) {
      record.blocked.instagram = poisson(weekend ? 1.7 : 1.1);
      record.blocked.youtube = poisson(weekend ? 1.0 : 0.6);
      record.blocked.facebook = poisson(0.18);
      record.blocked.x = poisson(0.35, xRnd);
    }
  }
  return out;
}
