import fc from 'fast-check';
import type { EngineEvent, IdleState, TrackerSettings } from '../../src/tracker/types.ts';

/** Synthetic site ids only; nothing here is a real browsing history. */
export const SITES = ['alpha.example', 'beta.example', 'gamma.example'] as const;

export type EventBody = EngineEvent extends infer E ? (E extends EngineEvent ? Omit<E, 'at'> : never) : never;

export interface Sequence {
  startAt: number;
  settings: TrackerSettings;
  events: EngineEvent[];
}

const THREE_DAYS_MS = 3 * 86_400_000;

const siteArb = fc.option(fc.constantFrom(...SITES), { freq: 5, nil: null });
const windowArb = fc.integer({ min: 1, max: 2 });
const tabArb = fc.integer({ min: 1, max: 4 });
const idleArb = fc.constantFrom<IdleState>('active', 'active', 'active', 'idle', 'idle', 'locked');

export const bodyArb: fc.Arbitrary<EventBody> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ type: fc.constant('focus' as const), windowId: fc.option(windowArb, { freq: 4, nil: null }) }) },
  { weight: 4, arbitrary: fc.record({ type: fc.constant('activate' as const), windowId: windowArb, tabId: tabArb }) },
  {
    weight: 4,
    arbitrary: fc.record(
      { type: fc.constant('url' as const), tabId: tabArb, site: siteArb, audible: fc.boolean(), nav: fc.constant(true as const) },
      { requiredKeys: ['type', 'tabId', 'site'] },
    ),
  },
  { weight: 3, arbitrary: fc.record({ type: fc.constant('idle' as const), state: idleArb }) },
  { weight: 3, arbitrary: fc.record({ type: fc.constant('media' as const), tabId: tabArb, playing: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ type: fc.constant('pause' as const), paused: fc.constantFrom(false, false, true) }) },
  { weight: 4, arbitrary: fc.record({ type: fc.constant('tick' as const) }) },
  { weight: 1, arbitrary: fc.record({ type: fc.constant('close' as const), tabId: tabArb }) },
  {
    weight: 1,
    arbitrary: fc.record(
      {
        type: fc.constant('seed' as const),
        windowId: fc.option(windowArb, { freq: 4, nil: null }),
        tabId: fc.option(tabArb, { freq: 4, nil: null }),
        site: siteArb,
        audible: fc.boolean(),
        idle: idleArb,
      },
      { requiredKeys: ['type', 'windowId', 'tabId', 'site', 'idle'] },
    ),
  },
);

/**
 * Delay before an event, in ms: mostly heartbeat-sized, sometimes a heartbeat Chrome delayed (on
 * either side of the gap threshold), equal timestamps or hours of sleep.
 */
function delayArb(unitMs: 1000 | 100): fc.Arbitrary<number> {
  const seconds = fc.oneof(
    { weight: 2, arbitrary: fc.constant(0) },
    { weight: 6, arbitrary: fc.integer({ min: 1, max: 30 }) },
    { weight: 5, arbitrary: fc.integer({ min: 31, max: 90 }) },
    { weight: 2, arbitrary: fc.integer({ min: 91, max: 200 }) },
    { weight: 1, arbitrary: fc.integer({ min: 201, max: 600 }) },
    { weight: 1, arbitrary: fc.integer({ min: 601, max: 6 * 3600 }) },
  );
  if (unitMs === 1000) return seconds.map((s) => s * 1000);
  return fc.tuple(seconds, fc.integer({ min: 0, max: 9 })).map(([s, tenths]) => s * 1000 + tenths * 100);
}

/** Local wall times near midnights and the DST changes of the zones `npm run test:tz` uses. */
function interestingStarts(): number[] {
  const wall: [number, number, number, number][] = [
    [2026, 2, 8, 2], // North America spring forward
    [2026, 10, 1, 2], // North America fall back
    [2026, 3, 5, 2], // Lord Howe fall back (2:00 -> 1:30)
    [2026, 9, 4, 2], // Lord Howe spring forward (2:00 -> 2:30)
    [2026, 2, 29, 2], // Europe spring forward
    [2026, 9, 25, 3], // Europe fall back
    [2026, 11, 31, 24], // New Year
    [2027, 1, 28, 24], // end of February
  ];
  return wall.map(([y, m, d, h]) => new Date(y, m, d, h).getTime());
}

export const startArb: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: Date.UTC(2024, 0, 1) / 1000, max: Date.UTC(2028, 0, 1) / 1000 }).map((s) => s * 1000),
  fc
    .tuple(fc.constantFrom(...interestingStarts()), fc.integer({ min: -3 * 3600, max: 3600 }))
    .map(([base, offset]) => base + offset * 1000),
);

export const settingsArb: fc.Arbitrary<TrackerSettings> = fc.record({
  idleThresholdSec: fc.constantFrom(30, 60, 120, 300),
  mediaOverride: fc.boolean(),
  heartbeatSec: fc.constant(60),
  gapMultiplier: fc.constantFrom(3, 1.5),
  visitGapSec: fc.constant(60),
});

export function build(startAt: number, steps: readonly (readonly [number, EventBody])[]): EngineEvent[] {
  let at = startAt;
  return steps.map(([delay, body]) => {
    at = Math.min(at + delay, startAt + THREE_DAYS_MS);
    return { ...body, at } as EngineEvent;
  });
}

/** The worker seeds from the live browser at startup; most sequences open that way. */
const openingArb: fc.Arbitrary<EventBody | null> = fc.option(
  fc.record(
    {
      type: fc.constant('seed' as const),
      windowId: windowArb,
      tabId: tabArb,
      site: fc.constantFrom(...SITES),
      audible: fc.boolean(),
      idle: fc.constant('active' as const),
    },
    { requiredKeys: ['type', 'windowId', 'tabId', 'site', 'idle'] },
  ),
  { freq: 4, nil: null },
);

/** 1 to 60 events with monotonic timestamps on a `unitMs` grid, spanning at most 3 days. */
export function sequenceArb(options: { unitMs?: 1000 | 100; maxEvents?: number } = {}): fc.Arbitrary<Sequence> {
  const unitMs = options.unitMs ?? 1000;
  const maxEvents = options.maxEvents ?? 60;
  return fc
    .record({
      startAt: startArb,
      settings: settingsArb,
      opening: openingArb,
      steps: fc.array(fc.tuple(delayArb(unitMs), bodyArb), { minLength: 1, maxLength: maxEvents - 1, size: 'max' }),
    })
    .map(({ startAt, settings, opening, steps }) => ({
      startAt,
      settings,
      events: build(startAt, opening === null ? steps : [[0, opening] as const, ...steps]),
    }));
}

/**
 * A heartbeat stream: a tick at the start of every minute, up to two other events inside the
 * minute, and now and then a sleep with no events at all, longer than any gap threshold (three
 * heartbeats). `drop` picks one tick to lose.
 */
export const heartbeatStreamArb = fc
  .record({
    startAt: startArb,
    settings: settingsArb,
    minutes: fc.array(
      fc.record({
        sleepSec: fc.oneof({ weight: 9, arbitrary: fc.constant(0) }, { weight: 1, arbitrary: fc.integer({ min: 181, max: 8 * 3600 }) }),
        extras: fc.array(fc.tuple(fc.integer({ min: 1, max: 59 }), bodyArb), { maxLength: 2 }),
      }),
      { minLength: 2, maxLength: 60, size: 'max' },
    ),
    opening: openingArb,
    drop: fc.nat(),
  })
  .map(({ startAt, settings, minutes, opening, drop }) => {
    const events: EngineEvent[] = opening === null ? [] : [{ ...opening, at: startAt } as EngineEvent];
    let minuteStart = startAt;
    for (const minute of minutes) {
      minuteStart += minute.sleepSec * 1000;
      events.push({ type: 'tick', at: minuteStart });
      const extras = [...minute.extras].sort((a, b) => a[0] - b[0]);
      for (const [offset, body] of extras) events.push({ ...body, at: minuteStart + offset * 1000 } as EngineEvent);
      minuteStart += 60_000;
    }
    const ticks = events.flatMap((event, index) => (event.type === 'tick' ? [index] : []));
    const dropIndex = ticks[drop % ticks.length] ?? 0;
    return { startAt, settings, events, dropped: events.filter((_, index) => index !== dropIndex) };
  });
