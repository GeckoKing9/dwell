import { describe, expect, it } from 'vitest';
import { memoryStore } from '../src/store/adapter.ts';
import { DEFAULT_SETTINGS, dayKey, SETTINGS_KEY } from '../src/store/schema.ts';
import { addDays } from '../src/stats/weeks.ts';
import { buildModel, inspectedTab, isRelevantChange, loadPopupData, mostRecentOther, popupDays } from '../src/popup/data.ts';
import type { PopupDeps, TabLike, TabsApi } from '../src/popup/data.ts';
import { day, NOW } from './support/popup.ts';

describe('popupDays', () => {
  it('lists today then the 7 days before it, across a month end', () => {
    expect(popupDays(new Date(2026, 9, 3, 12))).toEqual([
      '2026-10-03',
      '2026-10-02',
      '2026-10-01',
      '2026-09-30',
      '2026-09-29',
      '2026-09-28',
      '2026-09-27',
      '2026-09-26',
    ]);
  });

  it('keeps calendar days across a DST change', () => {
    expect(popupDays(new Date(2026, 10, 3, 0, 30))).toContain('2026-11-01');
    expect(new Set(popupDays(new Date(2026, 2, 10, 23, 30))).size).toBe(8);
  });
});

describe('inspected tab', () => {
  function tabs(own: TabLike | undefined, all: TabLike[]): TabsApi & { queries: unknown[] } {
    const queries: unknown[] = [];
    return {
      queries,
      getCurrent: async () => own,
      query: async (q) => {
        queries.push(q);
        return q.active ? all.filter((t) => t.id === 1) : all;
      },
    };
  }

  it('is the active tab of the last focused window when opened from the toolbar', async () => {
    const api = tabs(undefined, [{ id: 1, url: 'https://a.com/' }]);
    expect(await inspectedTab(api)).toEqual({ id: 1, url: 'https://a.com/' });
    expect(api.queries).toEqual([{ active: true, lastFocusedWindow: true }]);
  });

  it('is the tab used before the popup page when the page itself is a tab', async () => {
    const all = [
      { id: 1, url: 'https://a.com/', lastAccessed: 100 },
      { id: 2, url: 'https://b.com/', lastAccessed: 300 },
      { id: 9, url: 'chrome-extension://x/src/popup/index.html', lastAccessed: 400 },
    ];
    expect((await inspectedTab(tabs({ id: 9 }, all)))?.url).toBe('https://b.com/');
  });

  it('picks the most recently used tab other than its own', () => {
    expect(mostRecentOther([{ id: 1 }, { id: 2, lastAccessed: 5 }], 1)).toEqual({ id: 2, lastAccessed: 5 });
    expect(mostRecentOther([{ id: 1, lastAccessed: 9 }, { id: 2 }], 3)).toEqual({ id: 1, lastAccessed: 9 });
    expect(mostRecentOther([{ id: 1 }], 1)).toBeUndefined();
  });
});

describe('loadPopupData', () => {
  function deps(store: ReturnType<typeof memoryStore>, url: string | undefined): PopupDeps {
    return {
      store,
      tabs: { getCurrent: async () => undefined, query: async () => (url === undefined ? [] : [{ id: 1, url }]) },
      send: async () => undefined,
      openDashboard: async () => undefined,
      onChange: () => () => undefined,
      now: () => NOW,
    };
  }

  it('reads settings, today and the 7 days before it, oldest first', async () => {
    const store = memoryStore({
      [SETTINGS_KEY]: { paused: true },
      [dayKey(NOW)]: day({ 'a.com': { 9: 60 } }),
      [dayKey(addDays(NOW, -1))]: day({ 'b.com': { 9: 120 } }),
      [dayKey(addDays(NOW, -7))]: day({ 'c.com': { 9: 180 } }),
      [dayKey(addDays(NOW, -8))]: day({ 'd.com': { 9: 240 } }),
    });
    const loaded = await loadPopupData(deps(store, 'https://a.com/'));
    expect(loaded.settings.paused).toBe(true);
    expect(loaded.now).toBe(NOW);
    expect(loaded.url).toBe('https://a.com/');
    expect(Object.keys(loaded.today.sites)).toEqual(['a.com']);
    expect(loaded.previous).toHaveLength(7);
    expect(Object.keys(loaded.previous[0]?.sites ?? {})).toEqual(['c.com']);
    expect(Object.keys(loaded.previous[6]?.sites ?? {})).toEqual(['b.com']);
  });

  it('falls back to defaults and empty days for an empty store and no tab', async () => {
    const loaded = await loadPopupData(deps(memoryStore(), undefined));
    expect(loaded.settings).toEqual(DEFAULT_SETTINGS);
    expect(loaded.url).toBeNull();
    expect(buildModel(loaded).state).toBe('first');
  });
});

describe('isRelevantChange', () => {
  it('reacts to settings and day keys in local storage only', () => {
    expect(isRelevantChange(['settings'], 'local')).toBe(true);
    expect(isRelevantChange(['x', 'd:2026-10-14'], 'local')).toBe(true);
    expect(isRelevantChange(['d:2026-10-14'], 'session')).toBe(false);
    expect(isRelevantChange(['hot', 'log'], 'local')).toBe(false);
  });
});
