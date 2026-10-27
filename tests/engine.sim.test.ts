import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addAttributions } from '../src/tracker/buckets.ts';
import { createInitialState, reduce, replay } from '../src/tracker/engine.ts';
import type { Buckets, EngineEvent, EngineState, TrackerSettings } from '../src/tracker/types.ts';
import { sequenceArb, settingsArb, startArb } from './support/arbitraries.ts';
import { hourLabels, secondsOf, steps, totalSeconds } from './support/helpers.ts';
import { oracleReplay } from './support/oracle.ts';

const HOLD_MS = 30_000;

/** Two events further apart than this are a discontinuity. */
function gapMs(settings: TrackerSettings): number {
  return settings.gapMultiplier * settings.heartbeatSec * 1000;
}

function activeTab(state: EngineState) {
  if (state.focusedWindow === null) return undefined;
  const tabId = state.activeTabs[String(state.focusedWindow)];
  return tabId === undefined ? undefined : state.tabs[String(tabId)];
}

/** True when some tab reported playback with sound on screen (now or in its hold). */
function anyWatched(state: EngineState): boolean {
  return Object.values(state.tabs).some((tab) => tab.media?.watched === true);
}

describe('engine invariants over generated sequences', () => {
  it('never attributes more seconds than the wall-clock span', () => {
    fc.assert(
      fc.property(sequenceArb(), ({ startAt, settings, events }) => {
        const { buckets } = replay(events, settings, createInitialState(startAt));
        const span = (events.at(-1)?.at ?? startAt) - startAt;
        expect(totalSeconds(buckets) * 1000).toBeLessThanOrEqual(span);
      }),
      { numRuns: 150 },
    );
  });

  it('attributes nothing while no Chrome window has focus, unless a page holds attention or plays watched media', () => {
    fc.assert(
      fc.property(sequenceArb(), ({ startAt, settings, events }) => {
        for (const step of steps(events, settings, startAt)) {
          const { before } = step;
          if (before.focusedWindow === null && before.attention === undefined && !(settings.mediaOverride && anyWatched(before))) {
            expect(step.attributions).toEqual([]);
          }
        }
      }),
      { numRuns: 150 },
    );
  });

  it('attributes nothing while locked or paused, whatever the media', () => {
    fc.assert(
      fc.property(sequenceArb(), ({ startAt, settings, events }) => {
        for (const step of steps(events, settings, startAt)) {
          if (step.before.idle === 'locked' || step.before.paused) expect(step.attributions).toEqual([]);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('attributes nothing while idle unless a page holds attention or the active tab plays media and the override is on', () => {
    fc.assert(
      fc.property(sequenceArb(), ({ startAt, settings, events }) => {
        for (const step of steps(events, settings, startAt)) {
          if (step.before.idle !== 'idle' || step.before.attention !== undefined || anyWatched(step.before)) continue;
          const media = activeTab(step.before)?.media;
          const seconds = secondsOf(step.attributions);
          if (!settings.mediaOverride || !media) {
            expect(step.attributions).toEqual([]);
          } else if (!media.on) {
            const holdLeft = media.offAt === undefined ? 0 : media.offAt + HOLD_MS - step.before.lastAt;
            expect(seconds * 1000).toBeLessThanOrEqual(Math.max(0, holdLeft));
          }
        }
      }),
      { numRuns: 150 },
    );
  });

  it('splits an interval between at most the three ranked sites and never gives more than its length', () => {
    fc.assert(
      fc.property(sequenceArb(), ({ startAt, settings, events }) => {
        for (const step of steps(events, settings, startAt)) {
          expect(new Set(step.attributions.map((a) => a.site)).size).toBeLessThanOrEqual(3);
          const length = Math.max(0, step.event.at - step.before.lastAt);
          expect(secondsOf(step.attributions) * 1000).toBeLessThanOrEqual(length);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('places every attribution in a local day and hour its own interval touches', () => {
    fc.assert(
      fc.property(sequenceArb(), ({ startAt, settings, events }) => {
        for (const step of steps(events, settings, startAt)) {
          if (step.attributions.length === 0) continue;
          const to = Math.min(step.event.at, step.before.lastAt + gapMs(settings));
          const labels = hourLabels(step.before.lastAt, to);
          for (const a of step.attributions) expect(labels).toContain(`${a.day}@${a.hour}`);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('splits a continuous session at hour, midnight and DST boundaries without losing a second, ticks delayed up to 180 s included (AE4)', () => {
    const sessionArb = fc.record({
      startAt: startArb,
      ticks: fc.array(fc.integer({ min: 1, max: 180 }), { minLength: 1, maxLength: 150, size: 'max' }),
    });
    fc.assert(
      fc.property(sessionArb, ({ startAt, ticks }) => {
        const settings: TrackerSettings = { idleThresholdSec: 60, mediaOverride: true, heartbeatSec: 60, gapMultiplier: 3, visitGapSec: 60 };
        const events: EngineEvent[] = [{ type: 'seed', at: startAt, windowId: 1, tabId: 1, site: 'alpha.example', idle: 'active' }];
        let at = startAt;
        for (const delay of ticks) events.push({ type: 'tick', at: (at += delay * 1000) });
        const expected: Record<string, number> = {};
        for (let t = startAt; t < at; t += 1000) {
          const [label] = hourLabels(t, t + 1000);
          if (label !== undefined) expected[label] = (expected[label] ?? 0) + 1;
        }
        const { buckets } = replay(events, settings, createInitialState(startAt));
        const actual: Record<string, number> = {};
        for (const [day, sites] of Object.entries(buckets)) {
          for (const [hour, seconds] of Object.entries(sites['alpha.example']?.h ?? {})) actual[`${day}@${hour}`] = seconds;
        }
        expect(actual).toEqual(expected);
      }),
      { numRuns: 200 },
    );
  });

  it('attributes at most one heartbeat across a gap longer than the gap threshold (AE3)', () => {
    fc.assert(
      fc.property(sequenceArb(), ({ startAt, settings, events }) => {
        for (const step of steps(events, settings, startAt)) {
          if (step.event.at - step.before.lastAt > gapMs(settings)) {
            expect(secondsOf(step.attributions)).toBeLessThanOrEqual(60);
            expect(step.after.needsReseed).toBe(step.event.type !== 'seed');
          }
        }
      }),
      { numRuns: 150 },
    );
  });

  it('is deterministic: the same sequence twice gives identical buckets and state', () => {
    fc.assert(
      fc.property(sequenceArb(), ({ startAt, settings, events }) => {
        const first = replay(events, settings, createInitialState(startAt));
        const second = replay(structuredClone(events), { ...settings }, createInitialState(startAt));
        expect(second).toEqual(first);
      }),
      { numRuns: 100 },
    );
  });

  it('resumes from JSON-serialised state after any prefix with identical buckets (AE8)', () => {
    fc.assert(
      fc.property(sequenceArb(), fc.nat(), ({ startAt, settings, events }, cut) => {
        const split = cut % (events.length + 1);
        const whole = replay(events, settings, createInitialState(startAt));
        let state = createInitialState(startAt);
        let buckets: Buckets = {};
        events.forEach((event, index) => {
          if (index === split) state = JSON.parse(JSON.stringify(state)) as EngineState;
          const result = reduce(state, event, settings);
          state = result.state;
          buckets = addAttributions(buckets, result.attributions);
        });
        expect(buckets).toEqual(whole.buckets);
        expect(JSON.parse(JSON.stringify(state))).toEqual(JSON.parse(JSON.stringify(whole.state)));
      }),
      { numRuns: 300 },
    );
  });

  it('counts a visit exactly when a site becomes counted after at least 60 s not counted', () => {
    fc.assert(
      fc.property(sequenceArb(), ({ startAt, settings, events }) => {
        const lastEnd = new Map<string, number>();
        for (const step of steps(events, settings, startAt)) {
          // Attributions come in counting order; consecutive ones for the same site are one stretch.
          const stretches: { site: string; seconds: number; visits: number }[] = [];
          for (const a of step.attributions) {
            const last = stretches.at(-1);
            if (last?.site === a.site) {
              last.seconds += a.seconds;
              last.visits += a.visit ? 1 : 0;
            } else {
              stretches.push({ site: a.site, seconds: a.seconds, visits: a.visit ? 1 : 0 });
            }
          }
          let from = step.before.lastAt;
          for (const { site, seconds, visits } of stretches) {
            const previous = lastEnd.get(site);
            expect(visits).toBe(previous === undefined || from - previous >= 60_000 ? 1 : 0);
            from += seconds * 1000;
            lastEnd.set(site, from);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('equals the second-by-second oracle (the lower bound)', () => {
    fc.assert(
      fc.property(sequenceArb(), ({ startAt, settings, events }) => {
        const { buckets } = replay(events, settings, createInitialState(startAt));
        expect(buckets).toEqual(oracleReplay(events, settings, startAt));
      }),
      { numRuns: 2000 },
    );
  });

  it('equals the oracle at 100 ms resolution, carrying sub-second remainders per site', () => {
    fc.assert(
      fc.property(sequenceArb({ unitMs: 100 }), ({ startAt, settings, events }) => {
        const { buckets } = replay(events, settings, createInitialState(startAt));
        expect(buckets).toEqual(oracleReplay(events, settings, startAt, 100));
      }),
      { numRuns: 500 },
    );
  });

  it('keeps every attributed second an integer', () => {
    fc.assert(
      fc.property(sequenceArb({ unitMs: 100 }), settingsArb, ({ startAt, events }, settings) => {
        for (const step of steps(events, settings, startAt)) {
          for (const a of step.attributions) expect(Number.isInteger(a.seconds)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
