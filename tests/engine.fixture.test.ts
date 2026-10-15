import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createInitialState, replay } from '../src/tracker/engine.ts';
import type { EngineEvent, TrackerSettings } from '../src/tracker/types.ts';
import { siteTotals } from './support/helpers.ts';
import { oracleReplay } from './support/oracle.ts';
import { type Fixture, simulateSession } from './support/simulator.ts';

const PATH = new URL('./fixtures/sim-session-001.json', import.meta.url);
const SEED = 1;
const START_AT = Date.UTC(2026, 9, 14, 7, 0, 0);
const SETTINGS: TrackerSettings = { idleThresholdSec: 60, mediaOverride: true, heartbeatSec: 60, visitGapSec: 60 };

function format(fixture: Fixture): string {
  const { events, ...meta } = fixture;
  const head = JSON.stringify(meta, null, 2).replace(/\n}$/, '');
  return `${head},\n  "events": [\n${events.map((e) => `    ${JSON.stringify(e)}`).join(',\n')}\n  ]\n}\n`;
}

if (process.env.UPDATE_FIXTURES === '1') {
  const events = simulateSession(SEED, START_AT);
  const totals = siteTotals(replay(events, SETTINGS, createInitialState(START_AT)).buckets);
  const fixture: Fixture = {
    description: 'Four hours of simulated browsing with a two-hour sleep; synthetic site ids only.',
    generator: `tests/support/simulator.ts simulateSession(${SEED}, ${START_AT})`,
    settings: SETTINGS,
    startAt: START_AT,
    expected: Object.fromEntries(Object.entries(totals).sort(([a], [b]) => a.localeCompare(b))),
    events,
  };
  writeFileSync(PATH, format(fixture));
}

const fixture = JSON.parse(readFileSync(PATH, 'utf8')) as Fixture;

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => [k, ...strings(v)]);
  return [];
}

describe('replayable fixture produced by the simulator', () => {
  it('regenerates byte for byte from its seed', () => {
    expect(simulateSession(SEED, START_AT)).toEqual(fixture.events);
    expect(fixture.events.length).toBeGreaterThan(200);
  });

  it('replays to the recorded per-site totals', () => {
    const { buckets } = replay(fixture.events, fixture.settings, createInitialState(fixture.startAt));
    expect(siteTotals(buckets)).toEqual(fixture.expected);
    expect(Object.keys(fixture.expected).length).toBeGreaterThanOrEqual(3);
  });

  it('replays to the same buckets as the oracle in this time zone', () => {
    const events: EngineEvent[] = fixture.events;
    const { buckets } = replay(events, fixture.settings, createInitialState(fixture.startAt));
    expect(buckets).toEqual(oracleReplay(events, fixture.settings, fixture.startAt));
  });

  it('holds site ids only: no scheme, no path, nothing outside the synthetic namespace', () => {
    const text = readFileSync(PATH, 'utf8');
    expect(text).not.toContain('://');
    for (const event of fixture.events) {
      if ('site' in event && event.site !== null) expect(event.site).toMatch(/^[a-z]+\.example$/);
    }
    for (const value of strings(fixture.expected)) expect(value).not.toContain('/');
  });
});
