import { describe, expect, it } from 'vitest';
import { appendEvents } from '../src/background/log.ts';
import { memoryStore } from '../src/store/adapter.ts';
import {
  LOG_KINDS,
  LogPrivacyError,
  appendLogEntries,
  assertLogEntrySafe,
  exportLog,
  logKey,
  readLogExport,
} from '../src/store/log.ts';
import type { LogEntry } from '../src/store/log.ts';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 14, 16, 30);
/** Noon UTC is 2026-10-14 in every zone `npm run test:tz` uses (UTC-4 to UTC+11). */
const NOON = Date.UTC(2026, 9, 14, 12, 0);

function storedValues(store: ReturnType<typeof memoryStore>): string[] {
  return Object.entries(store.dump())
    .filter(([key]) => key.startsWith('log:'))
    .map(([, value]) => JSON.stringify(value));
}

describe('appendLogEntries', () => {
  it('stores entries under one UTC hour key each, holding only at, kind, site and the integer ids', async () => {
    const store = memoryStore();
    await appendLogEntries(store, [
      { at: NOW - HOUR, kind: 'focus', win: 1 },
      { at: NOW, kind: 'url', tab: 4, a: 0, site: 'youtube.com' },
      { at: NOW + 1000, kind: 'tick' },
    ], NOW + 1000);
    expect(store.dump()).toEqual({
      'log:2026-10-14T15': [{ at: NOW - HOUR, kind: 'focus', win: 1 }],
      'log:2026-10-14T16': [{ at: NOW, kind: 'url', site: 'youtube.com', tab: 4, a: 0 }, { at: NOW + 1000, kind: 'tick' }],
    });
    expect(logKey(NOW)).toBe('log:2026-10-14T16');
  });

  it('keeps 24 hours and drops older hour keys and older entries', async () => {
    const store = memoryStore({ 'd:2026-10-01': { sites: {}, blocked: {} }, settings: {} });
    for (let h = 30; h >= 0; h -= 1) await appendLogEntries(store, [{ at: NOW - h * HOUR, kind: 'tick' }], NOW - h * HOUR);
    const keys = (await store.keys()).filter((k) => k.startsWith('log:')).sort();
    expect(keys).toHaveLength(25);
    expect(keys[0]).toBe(logKey(NOW - 24 * HOUR));
    expect(keys.at(-1)).toBe(logKey(NOW));
    await appendLogEntries(store, [{ at: NOW - 25 * HOUR, kind: 'close', tab: 4242 }], NOW);
    expect(JSON.stringify(store.dump())).not.toContain('4242');
    expect(await store.keys()).toEqual(expect.arrayContaining(['d:2026-10-01', 'settings']));
  });

  it('drops a junk log key and a tampered entry in the hour it appends to', async () => {
    const store = memoryStore({ 'log:garbage': [], [logKey(NOW)]: [{ at: NOW - 5, kind: 'url', site: 'a.com/x' }, { at: NOW - 4, kind: 'tick' }] });
    await appendLogEntries(store, [{ at: NOW, kind: 'tick' }], NOW);
    expect(store.dump()).toEqual({ [logKey(NOW)]: [{ at: NOW - 4, kind: 'tick' }, { at: NOW, kind: 'tick' }] });
    const other = memoryStore({ [logKey(NOW)]: 'not a list' });
    await appendLogEntries(other, [{ at: NOW, kind: 'tick' }], NOW);
    expect(other.dump()).toEqual({ [logKey(NOW)]: [{ at: NOW, kind: 'tick' }] });
  });

  it('caps one hour at 3600 entries, keeping the newest', async () => {
    const store = memoryStore();
    const burst: LogEntry[] = Array.from({ length: 3700 }, (_, i) => ({ at: NOW + i, kind: 'tick' }));
    await appendLogEntries(store, burst, NOW + 3700);
    const stored = store.dump()[logKey(NOW)] as LogEntry[];
    expect(stored).toHaveLength(3600);
    expect(stored[0]?.at).toBe(NOW + 100);
  });

  it('never stores ://, / or ? for a recorded sequence of grouped events', async () => {
    const store = memoryStore();
    const sequence: LogEntry[] = ['github.com', 'youtube.com', 'news.ycombinator.com', 'bbc.co.uk'].flatMap((site, i) => [
      { at: NOW + i * 1000, kind: 'url', site, tab: i, a: 1 },
      { at: NOW + i * 1000 + 1, kind: 'media-on', tab: i },
    ]);
    await appendLogEntries(store, sequence, NOW + 10_000);
    const values = storedValues(store);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).not.toMatch(/:\/\/|\/|\?/);
  });

  it('reads and writes nothing for a recorder job with no events that did not start fresh', async () => {
    const store = memoryStore({ [logKey(NOW)]: [{ at: NOW, kind: 'tick' }] });
    await appendEvents(store, [], NOW + 1);
    expect(store.setCalls).toBe(0);
    await appendEvents(store, [], NOW + 2, true);
    expect(store.dump()[logKey(NOW)]).toEqual([{ at: NOW, kind: 'tick' }, { at: NOW + 2, kind: 'start' }]);
  });

  it('throws and writes nothing when a sequence carries a full URL', async () => {
    const store = memoryStore();
    const sequence = [
      { at: NOW, kind: 'url', site: 'github.com' },
      { at: NOW + 1, kind: 'url', site: 'https://www.youtube.com/watch?v=abc' },
    ];
    await expect(appendLogEntries(store, sequence, NOW + 2)).rejects.toThrow(LogPrivacyError);
    expect(store.setCalls).toBe(0);
    expect(storedValues(store)).toEqual([]);
  });
});

describe('assertLogEntrySafe', () => {
  it.each([
    ['a scheme', { at: 1, kind: 'url', site: 'https://a.com' }],
    ['a path', { at: 1, kind: 'url', site: 'a.com/path' }],
    ['a query', { at: 1, kind: 'url', site: 'a.com?q=1' }],
    ['a slash in the kind', { at: 1, kind: 'url/x' }],
    ['a query in the kind', { at: 1, kind: 'url?x' }],
    ['a title as site', { at: 1, kind: 'url', site: 'My Inbox (3)' }],
    ['an extra url field', { at: 1, kind: 'url', url: 'a.com' }],
    ['an extra title field', { at: 1, kind: 'url', title: 'Inbox' }],
    ['a non-numeric time', { at: '1', kind: 'url' }],
    ['a time out of range', { at: -1, kind: 'url' }],
    ['an uppercase kind', { at: 1, kind: 'URL' }],
    ['a short word outside the list', { at: 1, kind: 'gap' }],
    ['a window id past the safe range', { at: 1, kind: 'focus', win: 2 ** 53 }],
    ['an audible flag as a boolean', { at: 1, kind: 'url', tab: 1, a: true }],
    ['a non-object', 'a.com'],
  ])('throws for %s', (_label, entry) => {
    expect(() => assertLogEntrySafe(entry)).toThrow(LogPrivacyError);
  });

  it('accepts every listed kind, a grouped site and integer ids', () => {
    for (const kind of LOG_KINDS) expect(() => assertLogEntrySafe({ at: 1, kind })).not.toThrow();
    expect(() => assertLogEntrySafe({ at: 1, kind: 'seed-idle', site: 'music.youtube.com', win: 0, tab: 7, a: 1 })).not.toThrow();
  });
});

describe('exportLog', () => {
  it('returns every stored entry in time order with the day records of the days they cover', async () => {
    const day = { sites: { 'a.com': { h: { '11': 60 }, v: 1 } }, blocked: { instagram: 0, youtube: 0, facebook: 1 } };
    const store = memoryStore({ 'd:2026-10-14': day, 'd:2026-10-10': { sites: {}, blocked: {} }, settings: {} });
    await appendLogEntries(store, [{ at: NOON, kind: 'focus', win: 2 }, { at: NOON - HOUR / 2, kind: 'tick' }], NOON);
    expect(await exportLog(store)).toEqual({
      format: 'dwell-event-log',
      version: 2,
      entries: [{ at: NOON - HOUR / 2, kind: 'tick' }, { at: NOON, kind: 'focus', win: 2 }],
      days: { '2026-10-14': day },
      settings: { idleThresholdSec: 60, mediaOverride: true },
    });
    const custom = memoryStore({ settings: { idleThresholdSec: 300, mediaOverride: false } });
    expect((await exportLog(custom)).settings).toEqual({ idleThresholdSec: 300, mediaOverride: false });
    expect((await exportLog(memoryStore())).days).toEqual({});
  });

  it('skips a version 1 seed left in the ring by an upgrade, and still throws on a tampered entry', async () => {
    const legacy = memoryStore({ [logKey(NOW)]: [{ at: NOW, kind: 'seed', site: 'a.com' }, { at: NOW + 1, kind: 'tick' }] });
    expect((await exportLog(legacy)).entries).toEqual([{ at: NOW + 1, kind: 'tick' }]);
    const store = memoryStore({ [logKey(NOW)]: [{ at: NOW, kind: 'url', site: 'a.com/secret' }] });
    await expect(exportLog(store)).rejects.toThrow(LogPrivacyError);
    const damaged = memoryStore({ [logKey(NOW)]: 'not a list' });
    await expect(exportLog(damaged)).rejects.toThrow(LogPrivacyError);
  });
});

describe('readLogExport', () => {
  it('reads back its own export, days as prototype-free records', async () => {
    const store = memoryStore({ 'd:2026-10-14': { sites: { 'a.com': { h: { '12': 5 }, v: 1 } }, blocked: {} } });
    await appendLogEntries(store, [{ at: NOON, kind: 'url', site: 'a.com', tab: 3, a: 1 }], NOON);
    const file = readLogExport(JSON.parse(JSON.stringify(await exportLog(store))));
    expect(file.version).toBe(2);
    expect(file.entries).toEqual([{ at: NOON, kind: 'url', site: 'a.com', tab: 3, a: 1 }]);
    expect(file.days['2026-10-14']?.sites['a.com']).toEqual({ h: { '12': 5 }, v: 1 });
    expect(Object.getPrototypeOf(file.days)).toBeNull();
  });

  it('reads the settings field when present and accepts a file without it', async () => {
    const withField = readLogExport(file({ settings: { idleThresholdSec: 120, mediaOverride: false } }));
    expect(withField.settings).toEqual({ idleThresholdSec: 120, mediaOverride: false });
    expect(readLogExport(file({})).settings).toBeUndefined();
    const store = memoryStore({ settings: { idleThresholdSec: 30 } });
    expect(readLogExport(JSON.parse(JSON.stringify(await exportLog(store)))).settings).toEqual({ idleThresholdSec: 30, mediaOverride: true });
  });

  it('accepts a version 1 file, with its seed kind and no days', () => {
    const file = readLogExport({ format: 'dwell-event-log', version: 1, entries: [{ at: 1, kind: 'seed', site: 'a.com' }, { at: 2, kind: 'tick' }] });
    expect(file).toEqual({ version: 1, entries: [{ at: 1, kind: 'seed', site: 'a.com' }, { at: 2, kind: 'tick' }], days: {} });
  });

  const file = (patch: Record<string, unknown>): Record<string, unknown> => ({ format: 'dwell-event-log', version: 2, entries: [], ...patch });

  it.each([
    ['a non-object', 'dwell-event-log'],
    ['another format', file({ format: 'dwell-export' })],
    ['an unknown field', file({ extra: {} })],
    ['settings with a bad idle threshold', file({ settings: { idleThresholdSec: 45, mediaOverride: true } })],
    ['settings with an extra key', file({ settings: { idleThresholdSec: 60, mediaOverride: true, theme: 'dark' } })],
    ['settings that are not an object', file({ settings: 'x' })],
    ['an unknown version', file({ version: 3 })],
    ['entries that are not a list', file({ entries: {} })],
    ['too many entries', file({ entries: Array.from({ length: 90_001 }, () => ({ at: 1, kind: 'tick' })) })],
    ['days that are not an object', file({ days: [] })],
    ['a day that is not a date', file({ days: { '2026-02-30': {} } })],
    ['a prototype key as a day', JSON.parse('{"format":"dwell-event-log","version":2,"entries":[],"days":{"__proto__":{}}}') as unknown],
  ])('rejects %s', (_label, value) => {
    expect(() => readLogExport(value)).toThrow(TypeError);
  });

  it.each([
    ['ids in a version 1 file', { format: 'dwell-event-log', version: 1, entries: [{ at: 1, kind: 'close', tab: 1 }] }],
    ['a start entry in a version 1 file', { format: 'dwell-event-log', version: 1, entries: [{ at: 1, kind: 'start' }] }],
    ['a URL in a version 2 file', file({ entries: [{ at: 1, kind: 'url', tab: 1, site: 'https://a.com/x' }] })],
  ])('refuses %s with the privacy guard', (_label, value) => {
    expect(() => readLogExport(value)).toThrow(LogPrivacyError);
  });
});
