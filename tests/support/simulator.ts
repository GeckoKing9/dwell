import type { EngineEvent, TrackerSettings } from '../../src/tracker/types.ts';

/*
 * A deterministic browsing-session simulator for replayable fixtures. It uses its own seeded
 * PRNG (not fast-check) so a fixture regenerates byte for byte on any machine and any version
 * of the test tooling. Site ids are synthetic.
 */

export interface Fixture {
  description: string;
  generator: string;
  settings: TrackerSettings;
  startAt: number;
  expected: Record<string, { seconds: number; visits: number }>;
  events: EngineEvent[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const TAB_SITES: Record<number, string | null> = {
  1: 'alpha.example',
  2: 'beta.example',
  3: 'gamma.example',
  4: 'delta.example',
  5: null,
};
const WINDOW_OF_TAB: Record<number, number> = { 1: 1, 2: 1, 3: 1, 4: 2, 5: 2 };
const VIDEO_TAB = 3;

/** About four hours of use with a two-hour sleep in the middle, heartbeat every 60 s. */
export function simulateSession(seed: number, startAt: number, minutes = 240): EngineEvent[] {
  const random = mulberry32(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const events: EngineEvent[] = [];
  let focused: number | null = 1;
  let paused = false;
  let playing = false;

  for (const tabId of [1, 2, 3, 4, 5]) {
    events.push({ type: 'url', at: startAt, tabId, site: TAB_SITES[tabId] ?? null, audible: false });
  }
  events.push(
    { type: 'activate', at: startAt, windowId: 1, tabId: 1 },
    { type: 'activate', at: startAt, windowId: 2, tabId: 4 },
    { type: 'seed', at: startAt, windowId: 1, tabId: 1, site: 'alpha.example', idle: 'active' },
  );

  let minuteStart = startAt;
  for (let minute = 1; minute <= minutes; minute++) {
    minuteStart += 60_000;
    if (minute === Math.floor(minutes / 2)) {
      minuteStart += 2 * 3_600_000;
      events.push({ type: 'idle', at: minuteStart, state: 'active' });
      events.push({ type: 'seed', at: minuteStart, windowId: focused, tabId: focused === null ? null : 1, site: 'alpha.example', idle: 'active' });
      continue;
    }
    events.push({ type: 'tick', at: minuteStart });
    const at = minuteStart + (1 + Math.floor(random() * 58)) * 1000;
    const roll = random();
    if (roll < 0.25) {
      const tabId = pick([1, 2, 3, 4, 5]);
      const windowId = WINDOW_OF_TAB[tabId] ?? 1;
      events.push({ type: 'activate', at, windowId, tabId });
      if (focused !== windowId) events.push({ type: 'focus', at, windowId });
      focused = windowId;
    } else if (roll < 0.35) {
      focused = focused === null ? pick([1, 2]) : null;
      events.push({ type: 'focus', at, windowId: focused });
    } else if (roll < 0.5) {
      const state = pick(['active', 'idle', 'idle', 'locked'] as const);
      events.push({ type: 'idle', at, state });
    } else if (roll < 0.62) {
      playing = !playing;
      events.push({ type: 'media', at, tabId: VIDEO_TAB, playing });
    } else if (roll < 0.68) {
      events.push({ type: 'url', at, tabId: 2, site: pick(['beta.example', 'epsilon.example']), audible: random() < 0.3 });
    } else if (roll < 0.7) {
      paused = !paused;
      events.push({ type: 'pause', at, paused });
    }
  }
  return events;
}
