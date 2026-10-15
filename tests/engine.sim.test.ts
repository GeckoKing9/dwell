import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addAttributions } from '../src/tracker/buckets.ts';
import { createInitialState, reduce, replay } from '../src/tracker/engine.ts';
import type { Buckets, EngineEvent, EngineState, TrackerSettings } from '../src/tracker/types.ts';
import { sequenceArb, settingsArb, startArb } from './support/arbitraries.ts';
import { hourLabels, secondsOf, steps, totalSeconds } from './support/helpers.ts';
import { oracleReplay } from './support/oracle.ts';

const HOLD_MS = 30_000;
const GAP_MS = 90_000;

function activeTab(state: EngineState) {
  if (state.focusedWindow === null) return undefined;
  const tabId = state.activeTabs[String(state.focusedWindow)];
  return tabId === undefined ? undefined : state.tabs[String(tabId)];
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

  it('attributes nothing while no Chrome window has focus', () => {
    fc.assert(
      fc.property(sequenceArb(), ({ startAt, settings, events }) => {
        for (const step of steps(events, settings, startAt)) {
          if (step.before.focusedWindow === null) expect(step.attributions).toEqual([]);
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

  it('attributes nothing while idle unless the active tab plays media and the override is on', () => {
    fc.assert(
      fc.property(sequenceArb(), ({ startAt, settings, events }) => {
        for (const step of steps(events, settings, startAt)) {
          if (step.before.idle !== 'idle') continue;
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

  it('gives every interval to at most one site and never more than its length', () => {
    fc.assert(
      fc.property(sequenceArb(), ({ startAt, settings, events }) => {
        for (const step of steps(events, settings, startAt)) {
          expect(new Set(step.attributions.map((a) => a.site)).size).toBeLessThanOrEqual(1);
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
          const to = Math.min(step.event.at, step.before.lastAt + GAP_MS);
          const labels = hourLabels(step.before.lastAt, to);
          for (const a of step.attributions) expect(labels).toContain(`${a.day}@${a.hour}`);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('splits a continuous session at hour, midnight and DST boundaries without losing a second (AE4)', () => {
    const sessionArb = fc.record({
      startAt: startArb,
      ticks: fc.array(fc.integer({ min: 1, max: 90 }), { minLength: 1, maxLength: 150, size: 'max' }),
    });
    fc.assert(
      fc.property(sessionArb, ({ startAt, ticks }) => {
        const settings: TrackerSettings = { idleThresholdSec: 60, mediaOverride: true, heartbeatSec: 60, visitGapSec: 60 };
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

  it('attributes at most one heartbeat across a gap longer than 1.5 heartbeats (AE3)', () => {
    fc.assert(
      fc.property(sequenceArb(), ({ startAt, settings, events }) => {
        for (const step of steps(events, settings, startAt)) {
          if (step.event.at - step.before.lastAt > GAP_MS) {
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
          const seconds = secondsOf(step.attributions);
          const site = step.attributions[0]?.site;
          const visits = step.attributions.filter((a) => a.visit).length;
          if (site === undefined || seconds === 0) {
            expect(visits).toBe(0);
            continue;
          }
          const from = step.before.lastAt;
          const previous = lastEnd.get(site);
          expect(visits).toBe(previous === undefined || from - previous >= 60_000 ? 1 : 0);
          lastEnd.set(site, from + seconds * 1000);
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
