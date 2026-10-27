import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createInitialState, reduce, replay } from '../src/tracker/engine.ts';
import type { EngineEvent, TrackerSettings } from '../src/tracker/types.ts';
import { bodyArb, heartbeatStreamArb, sequenceArb } from './support/arbitraries.ts';
import { secondsOf, siteTotals, steps, totalSeconds } from './support/helpers.ts';
import { oracleReplay } from './support/oracle.ts';

const SETTINGS: TrackerSettings = { idleThresholdSec: 60, mediaOverride: true, heartbeatSec: 60, gapMultiplier: 3, visitGapSec: 60 };

/** Delivery order: adjacent events whose timestamps differ by at most 200 ms may arrive swapped. */
function deliver(events: readonly EngineEvent[], swaps: readonly boolean[]): EngineEvent[] {
  const out = [...events];
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i];
    const b = out[i + 1];
    if (a && b && swaps[i] && b.at !== a.at && b.at - a.at <= 200) {
      out[i] = b;
      out[i + 1] = a;
      i++;
    }
  }
  return out;
}

const jitterySequenceArb = fc.record({
  sequence: sequenceArb({ unitMs: 100 }),
  swaps: fc.array(fc.boolean(), { maxLength: 60, size: 'max' }),
});

describe('engine robustness', () => {
  it('ignores duplicated events: buckets equal the oracle on the original sequence', () => {
    fc.assert(
      fc.property(sequenceArb(), fc.array(fc.boolean(), { maxLength: 60, size: 'max' }), ({ startAt, settings, events }, dup) => {
        const doubled = events.flatMap((event, i) => (dup[i] ? [event, { ...event }] : [event]));
        const { buckets } = replay(doubled, settings, createInitialState(startAt));
        expect(buckets).toEqual(oracleReplay(events, settings, startAt));
      }),
      { numRuns: 200 },
    );
  });

  it('matches the oracle when events arrive up to 200 ms out of order and are sorted by time first', () => {
    fc.assert(
      fc.property(jitterySequenceArb, ({ sequence: { startAt, settings, events }, swaps }) => {
        const sorted = [...deliver(events, swaps)].sort((a, b) => a.at - b.at);
        const { buckets } = replay(sorted, settings, createInitialState(startAt));
        expect(buckets).toEqual(oracleReplay(events, settings, startAt, 100));
      }),
      { numRuns: 200 },
    );
  });

  it('never throws and keeps the upper bounds when out-of-order events are reduced unsorted', () => {
    fc.assert(
      fc.property(jitterySequenceArb, ({ sequence: { startAt, settings, events }, swaps }) => {
        const delivered = deliver(events, swaps);
        let total = 0;
        for (const step of steps(delivered, settings, startAt)) {
          const length = step.event.at - step.before.lastAt;
          const sites = new Set(step.attributions.map((a) => a.site)).size;
          expect(sites).toBeLessThanOrEqual(3);
          if (length <= 0) expect(step.attributions).toEqual([]);
          // Each site's carried sub-second remainder may complete one second inside a later, shorter step.
          expect(secondsOf(step.attributions) * 1000).toBeLessThan(Math.max(0, length) + 1000 * Math.max(1, sites));
          expect(step.after.lastAt).toBeGreaterThanOrEqual(step.before.lastAt);
          total += secondsOf(step.attributions);
        }
        expect(total * 1000).toBeLessThanOrEqual(Math.max(startAt, ...events.map((e) => e.at)) - startAt);
      }),
      { numRuns: 200 },
    );
  });

  it('tolerates bursts of events with equal timestamps', () => {
    const burstArb = fc.record({
      sequence: sequenceArb({ maxEvents: 20 }),
      burst: fc.array(bodyArb, { minLength: 2, maxLength: 12, size: 'max' }),
    });
    fc.assert(
      fc.property(burstArb, ({ sequence: { startAt, settings, events }, burst }) => {
        const at = events.at(-1)?.at ?? startAt;
        const all = [...events, ...burst.map((body) => ({ ...body, at }) as EngineEvent), { type: 'tick' as const, at: at + 30_000 }];
        const { buckets } = replay(all, settings, createInitialState(startAt));
        expect(buckets).toEqual(oracleReplay(all, settings, startAt));
      }),
      { numRuns: 150 },
    );
  });

  it('stays within one heartbeat of the oracle per site when one heartbeat is dropped', () => {
    fc.assert(
      fc.property(heartbeatStreamArb, ({ startAt, settings, events, dropped }) => {
        const expected = siteTotals(oracleReplay(events, settings, startAt));
        const actual = siteTotals(replay(dropped, settings, createInitialState(startAt)).buckets);
        for (const site of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
          const diff = (expected[site]?.seconds ?? 0) - (actual[site]?.seconds ?? 0);
          expect(diff).toBeGreaterThanOrEqual(0);
          expect(diff).toBeLessThanOrEqual(60);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('never throws on malformed timestamps, unknown tabs or a clock far in the past', () => {
    const odd: EngineEvent[] = [
      { type: 'tick', at: Number.NaN },
      { type: 'tick', at: Number.POSITIVE_INFINITY },
      { type: 'tick', at: 9e15 },
      { type: 'media', at: 1_000, tabId: 99, playing: false },
      { type: 'close', at: 1_000, tabId: 98 },
      { type: 'activate', at: 1_000, windowId: 7, tabId: 97 },
      { type: 'focus', at: 1_000, windowId: 7 },
      { type: 'tick', at: -5_000_000 },
      { type: 'tick', at: 2_000 },
    ];
    let state = createInitialState(0);
    for (const event of odd) {
      const result = reduce(state, event, SETTINGS);
      expect(result.attributions).toEqual([]);
      state = result.state;
    }
    expect(Number.isFinite(state.lastAt)).toBe(true);
    expect(totalSeconds(replay(odd, SETTINGS, createInitialState(0)).buckets)).toBe(0);
  });
});
