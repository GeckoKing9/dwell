import { describe, expect, it } from 'vitest';
import { memoryStore } from '../src/store/adapter.ts';
import { LogPrivacyError, appendLogEntries, assertLogEntrySafe, exportLog, logKey } from '../src/store/log.ts';
import type { LogEntry } from '../src/store/log.ts';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 14, 16, 30);

function storedValues(store: ReturnType<typeof memoryStore>): string[] {
  return Object.entries(store.dump())
    .filter(([key]) => key.startsWith('log:'))
    .map(([, value]) => JSON.stringify(value));
}

describe('appendLogEntries', () => {
  it('stores entries under one UTC hour key each, holding only at, kind and site', async () => {
    const store = memoryStore();
    await appendLogEntries(store, [
      { at: NOW - HOUR, kind: 'focus', site: 'github.com' },
      { at: NOW, kind: 'activate', site: 'youtube.com' },
      { at: NOW + 1000, kind: 'tick' },
    ], NOW + 1000);
    expect(store.dump()).toEqual({
      'log:2026-10-14T15': [{ at: NOW - HOUR, kind: 'focus', site: 'github.com' }],
      'log:2026-10-14T16': [{ at: NOW, kind: 'activate', site: 'youtube.com' }, { at: NOW + 1000, kind: 'tick' }],
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
    await appendLogEntries(store, [{ at: NOW - 25 * HOUR, kind: 'late' }], NOW);
    expect(JSON.stringify(store.dump())).not.toContain('late');
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
      { at: NOW + i * 1000, kind: 'url', site },
      { at: NOW + i * 1000 + 1, kind: 'media', site },
    ]);
    await appendLogEntries(store, sequence, NOW + 10_000);
    const values = storedValues(store);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).not.toMatch(/:\/\/|\/|\?/);
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
    ['a non-object', 'a.com'],
  ])('throws for %s', (_label, entry) => {
    expect(() => assertLogEntrySafe(entry)).toThrow(LogPrivacyError);
  });

  it('accepts a grouped site and a bare kind', () => {
    expect(() => assertLogEntrySafe({ at: 1, kind: 'gap' })).not.toThrow();
    expect(() => assertLogEntrySafe({ at: 1, kind: 'focus', site: 'music.youtube.com' })).not.toThrow();
  });
});

describe('exportLog', () => {
  it('returns every stored entry in time order and nothing else', async () => {
    const store = memoryStore({ 'd:2026-10-14': { sites: {}, blocked: {} }, settings: {} });
    await appendLogEntries(store, [{ at: NOW, kind: 'focus', site: 'a.com' }, { at: NOW - HOUR, kind: 'tick' }], NOW);
    expect(await exportLog(store)).toEqual({
      format: 'dwell-event-log',
      version: 1,
      entries: [{ at: NOW - HOUR, kind: 'tick' }, { at: NOW, kind: 'focus', site: 'a.com' }],
    });
  });

  it('throws on a tampered stored entry instead of exporting it', async () => {
    const store = memoryStore({ [logKey(NOW)]: [{ at: NOW, kind: 'url', site: 'a.com/secret' }] });
    await expect(exportLog(store)).rejects.toThrow(LogPrivacyError);
    const damaged = memoryStore({ [logKey(NOW)]: 'not a list' });
    await expect(exportLog(damaged)).rejects.toThrow(LogPrivacyError);
  });
});
