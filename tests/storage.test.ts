import { describe, expect, it } from 'vitest';
import { memoryStore } from '../src/store/adapter.ts';
import { applyAttributions, incrementBlocked, loadAllDays, loadDay } from '../src/store/days.ts';
import { pruneOldDays, retentionWindow, shiftDate } from '../src/store/prune.ts';
import { HOT_STATE_KEY, clearHotState, loadHotState, saveHotState } from '../src/store/hot.ts';
import { deleteAll, restoreSnapshot, snapshotAll } from '../src/store/delete.ts';
import { exportAll } from '../src/store/export.ts';
import { DEFAULT_SETTINGS, SETTINGS_KEY, dateString } from '../src/store/schema.ts';
import { simulateDays } from '../src/stats/simulate.ts';

const TODAY = new Date(2026, 9, 14, 16, 30);
const D = '2026-10-14';

/** Every 'YYYY-MM-DD' from `first` to `last` inclusive, by calendar day. */
function dateRange(first: string, last: string): string[] {
  const out: string[] = [];
  for (let d = first; d <= last; d = shiftDate(d, 1)) out.push(d);
  return out;
}

describe('applyAttributions', () => {
  it('accumulates two sites in the same hour under the same day key', async () => {
    const store = memoryStore();
    await applyAttributions(store, [
      { site: 'github.com', day: D, hour: 9, seconds: 30 },
      { site: 'youtube.com', day: D, hour: 9, seconds: 20 },
      { site: 'github.com', day: D, hour: 9, seconds: 15 },
    ]);
    expect(await store.keys()).toEqual([`d:${D}`]);
    const day = await loadDay(store, D);
    expect(day.sites['github.com']).toEqual({ h: { '9': 45 }, v: 0 });
    expect(day.sites['youtube.com']).toEqual({ h: { '9': 20 }, v: 0 });
  });

  it('adds to stored values and writes a batch spanning two days in one set call', async () => {
    const store = memoryStore({ [`d:${D}`]: { sites: { 'a.com': { h: { '23': 100 }, v: 2 } }, blocked: { instagram: 1, youtube: 0, facebook: 0 } } });
    const result = await applyAttributions(store, [
      { site: 'a.com', day: D, hour: 23, seconds: 40 },
      { site: 'a.com', day: '2026-10-15', hour: 0, seconds: 25 },
    ]);
    expect(result).toEqual({ written: 2, skipped: 0 });
    expect(store.setCalls).toBe(1);
    expect(store.dump()).toEqual({
      // The stored day predates X: writing it back adds its X count of 0.
      [`d:${D}`]: { sites: { 'a.com': { h: { '23': 140 }, v: 2 } }, blocked: { instagram: 1, youtube: 0, facebook: 0, x: 0 } },
      'd:2026-10-15': { sites: { 'a.com': { h: { '0': 25 }, v: 0 } }, blocked: { instagram: 0, youtube: 0, facebook: 0, x: 0 } },
    });
  });

  it('a visit flag increments v by one, with or without seconds', async () => {
    const store = memoryStore();
    await applyAttributions(store, [
      { site: 'a.com', day: D, hour: 8, seconds: 5, visit: true },
      { site: 'a.com', day: D, hour: 9, seconds: 0, visit: true },
      { site: 'a.com', day: D, hour: 9, seconds: 3, visit: false },
    ]);
    expect((await loadDay(store, `d:${D}`)).sites['a.com']).toEqual({ h: { '8': 5, '9': 3 }, v: 2 });
  });

  it('caps an hour at 3600 seconds and keeps millisecond precision', async () => {
    const store = memoryStore();
    await applyAttributions(store, [
      { site: 'a.com', day: D, hour: 1, seconds: 0.1 },
      { site: 'a.com', day: D, hour: 1, seconds: 0.2 },
      { site: 'b.com', day: D, hour: 1, seconds: 3000 },
      { site: 'b.com', day: D, hour: 1, seconds: 3000 },
    ]);
    const day = await loadDay(store, D);
    expect(day.sites['a.com']?.h['1']).toBe(0.3);
    expect(day.sites['b.com']?.h['1']).toBe(3600);
  });

  it('skips malformed attributions, counts them and writes nothing for them', async () => {
    const store = memoryStore();
    const result = await applyAttributions(store, [
      { site: 'https://a.com/x', day: D, hour: 1, seconds: 5 },
      { site: '__proto__', day: D, hour: 1, seconds: 5 },
      { site: 'a.com', day: '2026-02-30', hour: 1, seconds: 5 },
      { site: 'a.com', day: D, hour: 24, seconds: 5 },
      { site: 'a.com', day: D, hour: 1.5, seconds: 5 },
      { site: 'a.com', day: D, hour: 1, seconds: -1 },
      { site: 'a.com', day: D, hour: 1, seconds: Number.NaN },
      { site: 'a.com', day: D, hour: 1, seconds: 0 },
    ]);
    expect(result).toEqual({ written: 0, skipped: 7 });
    expect(store.setCalls).toBe(0);
    expect(({} as Record<string, unknown>)['h']).toBeUndefined();
  });
});

describe('loading days and blocked counts', () => {
  it('loadDay returns an empty record for a day with no data and rejects a bad key', async () => {
    const store = memoryStore();
    expect(await loadDay(store, D)).toEqual({ sites: {}, blocked: { instagram: 0, youtube: 0, facebook: 0, x: 0 } });
    await expect(loadDay(store, '2026-14-01')).rejects.toThrow(RangeError);
  });

  it('loadAllDays returns every day key, tolerates damaged records and ignores other keys', async () => {
    const store = memoryStore({
      'd:2026-10-13': { sites: { 'a.com': { h: { '1': 5, '99': 7, '2': 'x' }, v: -3 }, 'bad site': { h: {}, v: 1 } }, blocked: { instagram: 2, tiktok: 9 } },
      'd:2026-10-14': 'garbage',
      [SETTINGS_KEY]: DEFAULT_SETTINGS,
      'log:2026-10-14T10': [],
    });
    const days = await loadAllDays(store);
    expect(Object.keys(days).sort()).toEqual(['d:2026-10-13', 'd:2026-10-14']);
    expect(days['d:2026-10-13']).toEqual({ sites: { 'a.com': { h: { '1': 5 }, v: 0 } }, blocked: { instagram: 2, youtube: 0, facebook: 0, x: 0 } });
    expect(days['d:2026-10-14']).toEqual({ sites: {}, blocked: { instagram: 0, youtube: 0, facebook: 0, x: 0 } });
  });

  it('loadAllDays on an empty store is empty, and odd shapes read as empty parts', async () => {
    expect(await loadAllDays(memoryStore())).toEqual({});
    const store = memoryStore({ [`d:${D}`]: { sites: [], blocked: 'none' }, 'd:2026-10-13': { sites: { 'a.com': { h: [], v: 1 } } } });
    const days = await loadAllDays(store);
    expect(days[`d:${D}`]).toEqual({ sites: {}, blocked: { instagram: 0, youtube: 0, facebook: 0, x: 0 } });
    expect(days['d:2026-10-13']?.sites['a.com']).toEqual({ h: {}, v: 1 });
  });

  it('reads a day stored before X existed with an X count of 0, and counts X on top of it', async () => {
    const store = memoryStore({ [`d:${D}`]: { sites: {}, blocked: { instagram: 3, youtube: 1, facebook: 2 } } });
    expect((await loadDay(store, D)).blocked).toEqual({ instagram: 3, youtube: 1, facebook: 2, x: 0 });
    await incrementBlocked(store, D, 'x');
    expect((await loadDay(store, D)).blocked).toEqual({ instagram: 3, youtube: 1, facebook: 2, x: 1 });
  });

  it('incrementBlocked counts per site per day', async () => {
    const store = memoryStore();
    await incrementBlocked(store, `d:${D}`, 'youtube');
    await incrementBlocked(store, D, 'youtube');
    await incrementBlocked(store, D, 'instagram');
    await incrementBlocked(store, D, 'x');
    expect((await loadDay(store, D)).blocked).toEqual({ instagram: 1, youtube: 2, facebook: 0, x: 1 });
    await expect(incrementBlocked(store, 'd:yesterday', 'youtube')).rejects.toThrow(RangeError);
    await expect(incrementBlocked(store, D, 'tiktok' as 'youtube')).rejects.toThrow(RangeError);
  });
});

describe('pruneOldDays', () => {
  async function seeded(first: string, last: string): Promise<ReturnType<typeof memoryStore>> {
    const store = memoryStore({ [SETTINGS_KEY]: DEFAULT_SETTINGS, 'log:2020-01-01T00': [{ at: 1, kind: 'tick' }], hot: { version: 1 } });
    await store.set(Object.fromEntries(dateRange(first, last).map((d) => [`d:${d}`, { sites: {}, blocked: {} }])));
    return store;
  }

  it('deletes exactly the day keys older than the newest 90 local dates', async () => {
    const store = await seeded('2026-07-10', '2026-10-15');
    const removed = await pruneOldDays(store, TODAY);
    expect(removed.sort()).toEqual(dateRange('2026-07-10', '2026-07-16').map((d) => `d:${d}`));
    const left = (await store.keys()).filter((k) => k.startsWith('d:')).sort();
    expect(left[0]).toBe('d:2026-07-17');
    expect(left.at(-1)).toBe('d:2026-10-15');
    expect(left.filter((k) => k <= `d:${D}`)).toHaveLength(90);
  });

  it('never touches settings, log, hot state or malformed keys', async () => {
    const store = await seeded('2026-01-01', '2026-01-03');
    await store.set({ 'd:not-a-date': 1 });
    await pruneOldDays(store, TODAY);
    expect((await store.keys()).sort()).toEqual(['d:not-a-date', 'hot', 'log:2020-01-01T00', SETTINGS_KEY]);
  });

  it.each([
    ['after the November fall-back', new Date(2026, 10, 2, 0, 30), '2026-08-05'],
    ['late on the November fall-back day', new Date(2026, 10, 1, 23, 30), '2026-08-04'],
    ['after the March spring-forward, across a year end', new Date(2026, 2, 20, 0, 30), '2025-12-21'],
    ['across the Lord Howe October shift', new Date(2026, 9, 5, 1, 0), '2026-07-08'],
  ])('counts calendar dates, not 24-hour blocks, %s', async (_label, today, firstKept) => {
    expect(retentionWindow(today)).toEqual({ first: firstKept, last: dateString(today) });
    const store = await seeded(shiftDate(firstKept, -3), dateString(today));
    const removed = await pruneOldDays(store, today);
    expect(removed.sort()).toEqual([-3, -2, -1].map((n) => `d:${shiftDate(firstKept, n)}`));
    expect((await store.keys()).filter((k) => k.startsWith('d:'))).toHaveLength(90);
  });

  it('shiftDate refuses text that is not a date', () => {
    expect(() => shiftDate('yesterday', 1)).toThrow(RangeError);
  });

  it('removes nothing when every day is inside the window', async () => {
    const store = await seeded('2026-10-01', D);
    expect(await pruneOldDays(store, TODAY)).toEqual([]);
  });
});

describe('hot state', () => {
  it('round-trips an opaque versioned value through the session store', async () => {
    const session = memoryStore();
    const state = { version: 3, currentDomain: 'a.com', lastAt: 1_760_000_000_000, lastCountedAt: { 'a.com': 5 } };
    await saveHotState(session, state);
    expect(await loadHotState(session)).toEqual(state);
    expect(await loadHotState(session, 3)).toEqual(state);
    expect(await loadHotState(session, 4)).toBeNull();
    await clearHotState(session);
    expect(await session.keys()).toEqual([]);
  });

  it.each([undefined, null, 'x', [1], { version: 'one' }, { version: 1.5 }, {}])('returns null for the stored value %j', async (value) => {
    const session = memoryStore(value === undefined ? {} : { [HOT_STATE_KEY]: value });
    expect(await loadHotState(session)).toBeNull();
  });
});

describe('delete all and undo', () => {
  const recorded = {
    'd:2026-10-13': { sites: { 'a.com': { h: { '9': 12.5 }, v: 1 } }, blocked: { instagram: 0, youtube: 3, facebook: 0 } },
    [`d:${D}`]: { sites: { 'b.com': { h: { '10': 60 }, v: 2 } }, blocked: { instagram: 1, youtube: 0, facebook: 0 } },
    'log:2026-10-14T09': [{ at: 1, kind: 'focus', site: 'a.com' }],
    [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, idleThresholdSec: 120 },
  };

  it('removes day and log keys and session state, keeps settings, writes nothing for undo', async () => {
    const local = memoryStore(recorded);
    const session = memoryStore({ [HOT_STATE_KEY]: { version: 1 } });
    const snapshot = await deleteAll(local, session);
    expect(await local.keys()).toEqual([SETTINGS_KEY]);
    expect(await session.keys()).toEqual([]);
    expect(local.setCalls + session.setCalls).toBe(0);
    expect(Object.keys(snapshot.records).sort()).toEqual(Object.keys(recorded).sort());
  });

  it('restoring the snapshot brings every key back byte-identical', async () => {
    const local = memoryStore(recorded);
    const before = JSON.stringify(local.dump());
    const snapshot = await deleteAll(local, memoryStore());
    await restoreSnapshot(local, snapshot);
    expect(JSON.stringify(local.dump())).toBe(before);
    expect(local.setCalls).toBe(1);
  });

  it('deleting an empty store removes nothing, and an empty snapshot restores nothing', async () => {
    const local = memoryStore({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
    const snapshot = await deleteAll(local, memoryStore());
    expect(Object.keys(snapshot.records)).toEqual([SETTINGS_KEY]);
    await restoreSnapshot(local, await snapshotAll(memoryStore()));
    expect(local.setCalls).toBe(0);
    expect(local.dump()).toEqual({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  });

  it('takes a snapshot that later writes cannot change', async () => {
    const local = memoryStore(recorded);
    const snapshot = await snapshotAll(local);
    await applyAttributions(local, [{ site: 'b.com', day: D, hour: 10, seconds: 5 }]);
    expect(snapshot.records[`d:${D}`]).toEqual(recorded[`d:${D}`]);
    expect(Object.getPrototypeOf(snapshot.records)).toBeNull();
  });
});

describe('size budget', () => {
  it('keeps a 90-day simulated store under 1 MB and its export under the 2 MB import cap', async () => {
    const store = memoryStore(simulateDays(20261014, TODAY));
    const stored = new TextEncoder().encode(JSON.stringify(store.dump())).byteLength;
    const exported = new TextEncoder().encode(JSON.stringify(await exportAll(store, TODAY))).byteLength;
    expect(stored).toBeLessThan(1024 * 1024);
    expect(exported).toBeLessThan(2 * 1024 * 1024);
  });
});
