import { readFileSync, writeFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { appendEvents, logEntry } from '../src/background/log.ts';
import { memoryStore } from '../src/store/adapter.ts';
import { applyAttributions } from '../src/store/days.ts';
import { LOG_KINDS, LogPrivacyError, assertLogEntrySafe, exportLog, readLogExport, type LogEntry } from '../src/store/log.ts';
import { createInitialState, reduce, replay } from '../src/tracker/engine.ts';
import { START_KIND, logToEvents, replayLog } from '../src/tracker/replayLog.ts';
import type { Buckets, EngineEvent, TrackerSettings } from '../src/tracker/types.ts';
import { sequenceArb } from './support/arbitraries.ts';
import { CARRY_TOLERANCE_SEC, differences } from './support/differences.ts';
import { siteTotals } from './support/helpers.ts';
import { type Fixture, simulateSession } from './support/simulator.ts';

const HOUR_MS = 3_600_000;
const SETTINGS: TrackerSettings = { idleThresholdSec: 60, mediaOverride: true, heartbeatSec: 60, gapMultiplier: 3, visitGapSec: 60 };
const T = Date.UTC(2026, 9, 14, 9, 0, 0);

/** What the worker does per job, one event per job: reduce, write the day keys, append the log. */
async function record(events: readonly EngineEvent[], settings: TrackerSettings): Promise<ReturnType<typeof memoryStore>> {
  const store = memoryStore();
  let state = createInitialState(events[0]?.at ?? 0);
  for (const [index, event] of events.entries()) {
    const result = reduce(state, event, settings);
    state = result.state;
    await applyAttributions(store, result.attributions);
    await appendEvents(store, [event], event.at, index === 0);
  }
  return store;
}

describe('the event log round trip', () => {
  it('decodes every encoded event to itself and replays to the same buckets (1,500 sequences)', () => {
    fc.assert(
      fc.property(sequenceArb(), ({ startAt, settings, events }) => {
        const entries = JSON.parse(JSON.stringify(events.map(logEntry))) as LogEntry[];
        for (const entry of entries) assertLogEntrySafe(entry);
        expect(logToEvents(entries)).toEqual(events);
        const direct = replay(events, settings, createInitialState(startAt));
        const logged = replayLog(entries, settings, createInitialState(startAt));
        expect(logged.buckets).toEqual(direct.buckets);
        expect(logged.state).toEqual(direct.state);
      }),
      { numRuns: 1500 },
    );
  });

  it('replays a backward clock step in the order the worker reduced it, not sorted by time', async () => {
    const events: EngineEvent[] = [
      { type: 'seed', at: T, windowId: 1, tabId: 1, site: 'alpha.example', idle: 'active' },
      { type: 'url', at: T + 30_000, tabId: 1, site: 'beta.example' },
      { type: 'url', at: T + 20_000, tabId: 1, site: 'alpha.example' },
      { type: 'tick', at: T + 60_000 },
    ];
    const store = await record(events, SETTINGS);
    const file = readLogExport(JSON.parse(JSON.stringify(await exportLog(store))));
    expect(file.entries).toEqual([{ at: T, kind: START_KIND }, ...events.map(logEntry)]);
    const direct = replay(events, SETTINGS, createInitialState(T));
    expect(replayLog(file.entries, SETTINGS).buckets).toEqual(direct.buckets);
    expect(siteTotals(direct.buckets)).toEqual({ 'alpha.example': { seconds: 60, visits: 1 } });
  });

  it('decodes every kind in LOG_KINDS except start, and skips unknown kinds and missing ids without throwing', () => {
    for (const kind of LOG_KINDS) {
      const events = logToEvents([{ at: 1, kind, site: 'alpha.example', win: 1, tab: 2, a: 1 }]);
      expect(events).toHaveLength(kind === START_KIND ? 0 : 1);
    }
    const odd = ['warp', 'activate', 'focus', 'url', 'media-on', 'close', 'tick'].map((kind, at) => ({ at, kind }));
    expect(logToEvents(odd)).toEqual([{ type: 'tick', at: 6 }]);
    expect(replayLog([], SETTINGS).buckets).toEqual({});
  });

  it('resets to a fresh state at a start entry, as the worker did after a browser restart', () => {
    const settings = SETTINGS;
    const seed = (at: number): LogEntry => ({ at, kind: 'seed-active', win: 1, tab: 7, site: 'alpha.example' });
    const before = [{ at: T, kind: START_KIND }, seed(T), { at: T + 30_000, kind: 'tick' }];
    const after = [seed(T + 40_000), { at: T + 70_000, kind: 'tick' }];
    const restarted = siteTotals(replayLog([...before, { at: T + 40_000, kind: START_KIND }, ...after], settings).buckets);
    const continuous = siteTotals(replayLog([...before, ...after], settings).buckets);
    expect(restarted['alpha.example']).toEqual({ seconds: 60, visits: 2 });
    expect(continuous['alpha.example']).toEqual({ seconds: 70, visits: 1 });
  });
});

describe('a version 1 log', () => {
  it('replays approximately, as one window holding one tab: close is dropped and a seed counts as active', () => {
    const file = readLogExport({
      format: 'dwell-event-log',
      version: 1,
      entries: [
        { at: T, kind: 'seed', site: 'alpha.example' },
        { at: T + 30_000, kind: 'url', site: 'beta.example' },
        { at: T + 60_000, kind: 'close' },
        { at: T + 90_000, kind: 'focus-none' },
        { at: T + 100_000, kind: 'focus' },
        { at: T + 120_000, kind: 'idle-locked' },
        { at: T + 150_000, kind: 'tick' },
      ],
    });
    expect(logToEvents(file.entries, 1).slice(0, 3)).toEqual([
      { type: 'seed', at: T, windowId: 1, tabId: 1, site: 'alpha.example', idle: 'active' },
      { type: 'url', at: T + 30_000, tabId: 1, site: 'beta.example' },
      { type: 'focus', at: T + 90_000, windowId: null },
    ]);
    expect(siteTotals(replayLog(file.entries, SETTINGS, undefined, file.version).buckets)).toEqual({
      'alpha.example': { seconds: 30, visits: 1 },
      'beta.example': { seconds: 80, visits: 1 },
    });
  });
});

describe('an exported version 2 log', () => {
  it(`replays to the stored day records within ${CARRY_TOLERANCE_SEC} s per site per hour (300 sequences)`, async () => {
    let maxSec = 0;
    await fc.assert(
      fc.asyncProperty(sequenceArb(), async ({ settings, events }) => {
        const first = events[0]?.at ?? 0;
        const day = events.filter((event) => event.at < first + 23 * HOUR_MS);
        const store = await record(day, settings);
        const file = readLogExport(JSON.parse(JSON.stringify(await exportLog(store))));
        expect(file.version).toBe(2);
        expect(file.entries[0]).toEqual({ at: first, kind: START_KIND });
        const result = differences(file.days, replayLog(file.entries, settings).buckets);
        expect(result.problems).toEqual([]);
        maxSec = Math.max(maxSec, result.maxSec);
      }),
      { numRuns: 300 },
    );
    expect(maxSec).toBeLessThanOrEqual(CARRY_TOLERANCE_SEC);
  });
});

const SIM_PATH = new URL('./fixtures/sim-session-001.json', import.meta.url);
const LOG_PATH = new URL('./fixtures/log-session-001.json', import.meta.url);
const sim = JSON.parse(readFileSync(SIM_PATH, 'utf8')) as Fixture;

function formatLog(file: Awaited<ReturnType<typeof exportLog>>): string {
  const entries = file.entries.map((entry) => `    ${JSON.stringify(entry)}`).join(',\n');
  const days = JSON.stringify(file.days, null, 2).replace(/\n/g, '\n  ');
  return `{\n  "format": "${file.format}",\n  "version": ${file.version},\n  "entries": [\n${entries}\n  ],\n  "days": ${days}\n}\n`;
}

if (process.env.UPDATE_FIXTURES === '1') {
  const store = await record(simulateSession(1, sim.startAt), sim.settings);
  writeFileSync(LOG_PATH, formatLog(await exportLog(store)));
}

describe('the log fixture made from the simulator', () => {
  const text = (): string => readFileSync(LOG_PATH, 'utf8');
  const load = () => readLogExport(JSON.parse(text()));

  it('is the encoding of the simulated session, opened by a start entry', () => {
    const encoded = simulateSession(1, sim.startAt).map(logEntry);
    expect(load().entries).toEqual([{ at: sim.startAt, kind: START_KIND }, ...encoded]);
  });

  it('replays to the simulator fixture totals and to the totals of its own day records', () => {
    const file = load();
    const { buckets } = replayLog(file.entries, sim.settings);
    expect(siteTotals(buckets)).toEqual(sim.expected);
    const stored: Buckets = Object.fromEntries(Object.entries(file.days).map(([day, record]) => [day, record.sites]));
    expect(siteTotals(stored)).toEqual(sim.expected);
  });

  it('holds site ids and integer ids only: no scheme, no path, nothing outside the synthetic namespace', () => {
    expect(text()).not.toContain('://');
    for (const entry of load().entries) {
      if (entry.site !== undefined) expect(entry.site).toMatch(/^[a-z]+\.example$/);
    }
  });
});

describe('the privacy guard on the extended entry', () => {
  it.each([
    ['a url field', { at: 1, kind: 'url', tab: 1, url: 'alpha.example' }],
    ['a title field', { at: 1, kind: 'url', tab: 1, title: 'Inbox' }],
    ['a site with a path', { at: 1, kind: 'url', tab: 1, site: 'alpha.example/watch' }],
    ['a kind outside the list', { at: 1, kind: 'navigate', tab: 1 }],
    ['the version 1 seed kind', { at: 1, kind: 'seed' }],
    ['a negative tab', { at: 1, kind: 'close', tab: -1 }],
    ['a non-integer tab', { at: 1, kind: 'close', tab: 1.5 }],
    ['a string tab', { at: 1, kind: 'close', tab: '1' }],
    ['a negative window', { at: 1, kind: 'focus', win: -1 }],
    ['an audible flag other than 0 or 1', { at: 1, kind: 'url', tab: 1, a: 2 }],
  ])('rejects %s', (_label, entry) => {
    expect(() => assertLogEntrySafe(entry)).toThrow(LogPrivacyError);
  });
});
