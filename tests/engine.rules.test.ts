import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACKER_SETTINGS, createInitialState, currentSite, reduce, replay } from '../src/tracker/engine.ts';
import { DEFAULTS, Story, openTab } from './support/story.ts';

const NOON = new Date(2026, 9, 14, 12, 0, 0).getTime();
const A = 'alpha.example';
const B = 'beta.example';

function idleListener(site: string, audible?: boolean): Story {
  const seed = audible === undefined
    ? { type: 'seed' as const, windowId: 1, tabId: 1, site, idle: 'idle' as const }
    : { type: 'seed' as const, windowId: 1, tabId: 1, site, audible, idle: 'idle' as const };
  return new Story(NOON).emit(seed);
}

describe('media signals', () => {
  it('defaults match the plan: override on, 60 s heartbeat, a gap past three heartbeats, 60 s visit gap', () => {
    expect(DEFAULT_TRACKER_SETTINGS).toEqual(DEFAULTS);
  });

  it('lets the content script overrule Chrome audible once it has reported playback', () => {
    const story = idleListener(A, true).emit({ type: 'media', tabId: 1, playing: true }).wait(30);
    story.emit({ type: 'media', tabId: 1, playing: false }).wait(120);
    story.emit({ type: 'url', tabId: 1, site: A, audible: true }).wait(60).end();
    expect(story.total(A).seconds).toBe(60);
  });

  it('falls back to Chrome audible with the same 30 s hold', () => {
    const story = idleListener(A, true).wait(40).emit({ type: 'url', tabId: 1, site: A, audible: false }).wait(120).end();
    expect(story.total(A).seconds).toBe(70);
  });

  it('keeps the first stop time when a second stop signal arrives', () => {
    const story = idleListener(A, true).wait(10).emit({ type: 'url', tabId: 1, site: A, audible: false });
    story.wait(20).emit({ type: 'url', tabId: 1, site: A, audible: false }).wait(120).end();
    expect(story.total(A).seconds).toBe(40);
  });

  it('forgets media state when the tab navigates to another site', () => {
    const story = idleListener(A).emit({ type: 'media', tabId: 1, playing: true }).wait(60);
    story.emit({ type: 'url', tabId: 1, site: B }).wait(120).end();
    expect(story.total(A).seconds).toBe(60);
    expect(story.total(B).seconds).toBe(0);
  });

  it('keeps media state when a tab without a site loads one', () => {
    const story = new Story(NOON).emit(...openTab(1, 1, null), { type: 'media', tabId: 1, playing: true });
    story.emit({ type: 'focus', windowId: 1 }, { type: 'idle', state: 'idle' }, { type: 'url', tabId: 1, site: A }).wait(60).end();
    expect(story.total(A).seconds).toBe(60);
  });

  it('drops the content script state when a new document loads in the tab, even on the same site', () => {
    const story = idleListener(A).emit({ type: 'media', tabId: 1, playing: true }).wait(60);
    story.emit({ type: 'url', tabId: 1, site: A, nav: true }).wait(120).end();
    expect(story.state.tabs['1']?.media).toBeUndefined();
    expect(story.total(A).seconds).toBe(60);
  });

  it('trusts Chrome audible after a reload until the new document reports', () => {
    const story = idleListener(A).emit({ type: 'media', tabId: 1, playing: true }).wait(60);
    story.emit({ type: 'url', tabId: 1, site: A, audible: true, nav: true }).wait(60);
    expect(story.state.tabs['1']?.media).toEqual({ src: 'audible', on: true });
    story.emit({ type: 'media', tabId: 1, playing: true }, { type: 'media', tabId: 1, playing: false }).wait(120).end();
    expect(story.total(A).seconds).toBe(60 + 60 + 30);
  });

  it('keeps an audible state across a navigation within the site', () => {
    const story = idleListener(A, true).wait(60).emit({ type: 'url', tabId: 1, site: A, nav: true }).wait(60).end();
    expect(story.total(A).seconds).toBe(120);
  });

  it('counts nothing for an idle tab with no media signal at all', () => {
    expect(idleListener(A).wait(120).end().total(A).seconds).toBe(0);
  });
});

describe('tabs, windows and pause', () => {
  it('stops counting when the active tab closes and drops its state', () => {
    const story = new Story(NOON).emit({ type: 'seed', windowId: 1, tabId: 1, site: A, idle: 'active' }).wait(30);
    story.emit({ type: 'close', tabId: 1 }).wait(120).end();
    expect(story.total(A).seconds).toBe(30);
    expect(story.state.tabs).toEqual({});
    expect(story.state.activeTabs).toEqual({});
  });

  it('keeps other windows when a background tab closes', () => {
    const story = new Story(NOON).emit(...openTab(1, 1, A), ...openTab(2, 2, B), { type: 'focus', windowId: 1 });
    story.emit({ type: 'close', tabId: 2 }).wait(60).end();
    expect(story.state.activeTabs).toEqual({ '1': 1 });
    expect(story.total(A).seconds).toBe(60);
  });

  it('records nothing while paused and resumes after', () => {
    const story = new Story(NOON).emit({ type: 'seed', windowId: 1, tabId: 1, site: A, idle: 'active' }).wait(60);
    story.emit({ type: 'pause', paused: true }).wait(300).emit({ type: 'pause', paused: false }).wait(60).end();
    expect(story.total(A)).toEqual({ seconds: 120, visits: 2 });
  });

  it('seeds an unfocused browser without touching tabs', () => {
    const story = new Story(NOON).emit({ type: 'seed', windowId: null, tabId: null, site: null, idle: 'active' }).wait(60).end();
    expect(story.state.focusedWindow).toBeNull();
    expect(story.state.tabs).toEqual({});
    expect(story.buckets).toEqual({});
  });
});

describe('clock and state', () => {
  it('attributes zero seconds when the clock moves backwards a little and keeps its place', () => {
    const story = new Story(NOON).emit({ type: 'seed', windowId: 1, tabId: 1, site: A, idle: 'active' }).wait(30).end();
    story.at -= 20_000;
    story.emit({ type: 'tick' });
    expect(story.state.lastAt).toBe(NOON + 30_000);
    expect(story.state.needsReseed).toBe(false);
    story.wait(50).end();
    expect(story.total(A).seconds).toBe(30 + 30);
  });

  it('credits a heartbeat that Chrome delayed to 120 s in full and asks for no reseed', () => {
    const seeded = reduce(createInitialState(NOON), { type: 'seed', at: NOON, windowId: 1, tabId: 1, site: A, idle: 'active' }, DEFAULTS);
    const late = reduce(seeded.state, { type: 'tick', at: NOON + 120_000 }, DEFAULTS);
    expect(late.attributions.reduce((sum, a) => sum + a.seconds, 0)).toBe(120);
    expect(late.state.needsReseed).toBe(false);
  });

  it('credits one heartbeat and asks for a reseed once the gap passes three heartbeats (200 s)', () => {
    const seeded = reduce(createInitialState(NOON), { type: 'seed', at: NOON, windowId: 1, tabId: 1, site: A, idle: 'active' }, DEFAULTS);
    const gap = reduce(seeded.state, { type: 'tick', at: NOON + 200_000 }, DEFAULTS);
    expect(gap.attributions.reduce((sum, a) => sum + a.seconds, 0)).toBe(60);
    expect(gap.state.needsReseed).toBe(true);
    expect(gap.state.lastAt).toBe(NOON + 200_000);
  });

  it('resynchronises and asks for a reseed when the clock jumps back past the gap threshold', () => {
    const story = new Story(NOON).emit({ type: 'seed', windowId: 1, tabId: 1, site: A, idle: 'active' }).wait(30).end();
    story.at -= 3_600_000;
    story.emit({ type: 'tick' });
    expect(story.state.lastAt).toBe(NOON + 30_000 - 3_600_000);
    expect(story.state.needsReseed).toBe(true);
    story.wait(60).end();
    expect(story.total(A).seconds).toBe(90);
  });

  it('carries sub-second remainders so short intervals still add up', () => {
    let state = reduce(createInitialState(NOON), { type: 'seed', at: NOON, windowId: 1, tabId: 1, site: A, idle: 'active' }, DEFAULTS).state;
    const seconds: number[] = [];
    for (const offset of [400, 800, 1200, 1600, 2000]) {
      const result = reduce(state, { type: 'tick', at: NOON + offset }, DEFAULTS);
      state = result.state;
      seconds.push(result.attributions.reduce((sum, a) => sum + a.seconds, 0));
    }
    expect(seconds).toEqual([0, 0, 1, 0, 1]);
    expect(state.sites[A]).toEqual({ at: NOON + 2000, carryMs: 0 });
  });

  it('reports a visit even when its first slice is shorter than a second', () => {
    const seeded = reduce(createInitialState(NOON), { type: 'seed', at: NOON, windowId: 1, tabId: 1, site: A, idle: 'active' }, DEFAULTS);
    const { attributions } = reduce(seeded.state, { type: 'tick', at: NOON + 300 }, DEFAULTS);
    expect(attributions).toEqual([{ site: A, day: '2026-10-14', hour: 12, seconds: 0, visit: true }]);
  });

  it('forgets a site one day after it was last counted', () => {
    const story = new Story(NOON).emit({ type: 'seed', windowId: 1, tabId: 1, site: A, idle: 'active' }).wait(60);
    story.emit({ type: 'focus', windowId: null });
    expect(Object.keys(story.state.sites)).toEqual([A]);
    story.sleep(86_400).emit({ type: 'tick' });
    expect(Object.keys(story.state.sites)).toEqual([A]);
    story.sleep(1).emit({ type: 'tick' });
    expect(story.state.sites).toEqual({});
  });

  it('names the counted site, and none once a media hold has run out', () => {
    const story = idleListener(A, true).wait(10).emit({ type: 'url', tabId: 1, site: A, audible: false });
    expect(currentSite(story.state, DEFAULTS)).toBe(A);
    expect(currentSite(story.state, DEFAULTS, story.at + 29_999)).toBe(A);
    expect(currentSite(story.state, DEFAULTS, story.at + 30_000)).toBeNull();
    expect(currentSite(story.state, { ...DEFAULTS, mediaOverride: false })).toBeNull();
    expect(currentSite(createInitialState(NOON), DEFAULTS)).toBeNull();
  });

  it('replays an empty event list to empty buckets', () => {
    expect(replay([], DEFAULTS)).toEqual({ buckets: {}, state: createInitialState(0) });
  });

  it('does not mutate the state it is given', () => {
    const before = createInitialState(NOON);
    const frozen = JSON.stringify(before);
    reduce(before, { type: 'seed', at: NOON + 1000, windowId: 1, tabId: 1, site: A, idle: 'active' }, DEFAULTS);
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it('keeps state keys safe from prototype names', () => {
    const story = new Story(NOON).emit({ type: 'seed', windowId: 1, tabId: 1, site: '__proto__', idle: 'active' }).wait(60);
    story.emit({ type: 'seed', windowId: 1, tabId: 1, site: 'constructor', idle: 'active' }).wait(60).end();
    expect(story.total('__proto__').seconds).toBe(60);
    expect(story.total('constructor')).toEqual({ seconds: 60, visits: 1 });
    expect(Object.getPrototypeOf(story.state.sites)).toBe(Object.prototype);
  });
});
