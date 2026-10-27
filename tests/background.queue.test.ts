import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackground, type Background } from '../src/background/listeners.ts';
import { createQueue } from '../src/background/queue.ts';
import { memoryStore } from '../src/store/adapter.ts';
import { logKey } from '../src/store/log.ts';
import { DEFAULT_SETTINGS } from '../src/store/schema.ts';
import { activate, engineState, installFakeChrome, openWindow, totals, type FakeChrome } from './support/fake-chrome.ts';

const T0 = new Date(2026, 9, 14, 9, 0, 0).getTime();
const A = 'https://a.example/page?q=1';
const B = 'https://b.example/';

let fake: FakeChrome;

beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  fake = installFakeChrome();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function advance(seconds: number): void {
  vi.advanceTimersByTime(seconds * 1000);
}

const heartbeat = (bg: Background) => bg.onAlarm({ name: 'heartbeat' });

describe('the queue', () => {
  const stores = () => ({ local: memoryStore(), session: memoryStore() });

  it('runs jobs one at a time, in the order they were queued', async () => {
    const queue = createQueue(stores());
    const order: string[] = [];
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = queue.run(async () => {
      order.push('first starts');
      await gate;
      order.push('first ends');
    }, undefined);
    const second = queue.run(async () => {
      order.push('second');
    }, undefined);
    await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first starts', 'first ends', 'second']);
  });

  it('stamps `at` when the job is queued, not when it runs', async () => {
    const queue = createQueue(stores());
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    void queue.run(() => gate, undefined);
    const stamped = queue.run(async (at) => at, 0);
    advance(5);
    release();
    expect(await stamped).toBe(T0);
  });

  it('logs a failing job, answers with the fallback and keeps the chain going', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const queue = createQueue(stores());
    const failed = queue.run(async () => {
      throw new Error('boom');
    }, 'fallback');
    const next = queue.run(async () => 'next', 'fallback');
    expect(await failed).toBe('fallback');
    expect(await next).toBe('next');
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('the tracking job', () => {
  it('seeds from the live browser when no hot state exists, then counts the focused active tab', async () => {
    openWindow(fake, 1, [{ id: 10, url: A }]);
    const bg = createBackground();
    await heartbeat(bg);
    expect(engineState(fake)).toMatchObject({ focusedWindow: 1, activeTabs: { '1': 10 }, tabs: { '10': { site: 'a.example' } } });
    expect(fake.idleQueries).toEqual([60]);
    advance(10);
    await heartbeat(bg);
    expect(totals(fake, 'a.example')).toEqual({ seconds: 10, visits: 1 });
    expect(fake.session.data.get('hot')).toMatchObject({ version: 1 });
  });

  it('learns the active tab of every other window when it seeds, so a video on a second screen is known before it is ever focused', async () => {
    openWindow(fake, 2, [{ id: 20, url: 'https://www.youtube.com/watch?v=1' }]);
    openWindow(fake, 1, [{ id: 10, url: A }]);
    const bg = createBackground();
    await heartbeat(bg);
    expect(engineState(fake)).toMatchObject({ focusedWindow: 1, activeTabs: { '1': 10, '2': 20 }, tabs: { '20': { site: 'youtube.com' } } });
  });

  it('seeds with nothing focused when Chrome has no window at all', async () => {
    const bg = createBackground();
    await heartbeat(bg);
    expect(engineState(fake)).toMatchObject({ focusedWindow: null, activeTabs: {} });
  });

  it('gives fixture A 10 s and fixture B 5 s across a tab switch', async () => {
    openWindow(fake, 1, [{ id: 10, url: A }, { id: 11, url: B }]);
    const bg = createBackground();
    await bg.onInstalled();
    advance(10);
    await bg.onTabActivated(activate(fake, 11));
    advance(5);
    await bg.onTabActivated(activate(fake, 10));
    expect(totals(fake, 'a.example')).toEqual({ seconds: 10, visits: 1 });
    expect(totals(fake, 'b.example')).toEqual({ seconds: 5, visits: 1 });
  });

  it('continues totals across a worker restart from the stored hot state (AE8)', async () => {
    openWindow(fake, 1, [{ id: 10, url: A }, { id: 11, url: B }]);
    const first = createBackground();
    await first.onInstalled();
    advance(5);
    await first.onTabActivated(activate(fake, 11));
    advance(7);
    const second = createBackground();
    await second.start();
    await second.onTabActivated(activate(fake, 10));
    advance(4);
    await heartbeat(second);
    expect(totals(fake, 'a.example').seconds).toBe(9);
    expect(totals(fake, 'b.example').seconds).toBe(7);
  });

  it('caps a gap of hours at one heartbeat and reseeds from the live browser (R4, AE3)', async () => {
    openWindow(fake, 1, [{ id: 10, url: A }, { id: 11, url: B }]);
    const bg = createBackground();
    await bg.onInstalled();
    advance(30);
    await heartbeat(bg);
    activate(fake, 11);
    advance(8 * 3600);
    await heartbeat(bg);
    expect(totals(fake, 'a.example').seconds).toBe(90);
    expect(engineState(fake)).toMatchObject({ activeTabs: { '1': 11 }, needsReseed: false });
    advance(30);
    await heartbeat(bg);
    expect(totals(fake, 'b.example').seconds).toBe(30);
  });

  it('starts paused after a browser restart when the settings say paused', async () => {
    fake.local.data.set('settings', { ...DEFAULT_SETTINGS, paused: true });
    openWindow(fake, 1, [{ id: 10, url: A }]);
    const bg = createBackground();
    await bg.onStartup();
    advance(10);
    await heartbeat(bg);
    expect(engineState(fake).paused).toBe(true);
    expect(totals(fake, 'a.example').seconds).toBe(0);
  });

  it.each([
    ['another version', { version: 99, engine: {} }],
    ['a malformed engine state', { version: 1, engine: { v: 1, lastAt: 'soon' } }],
    ['no engine state', { version: 1 }],
  ])('reseeds when the stored hot state has %s', async (_label, hot) => {
    fake.session.data.set('hot', hot);
    openWindow(fake, 1, [{ id: 10, url: A }]);
    const bg = createBackground();
    await heartbeat(bg);
    advance(3);
    await heartbeat(bg);
    expect(totals(fake, 'a.example').seconds).toBe(3);
  });

  it('attributes the interval again when the day write failed, because the hot state was not saved', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    openWindow(fake, 1, [{ id: 10, url: A }]);
    const bg = createBackground();
    await bg.onInstalled();
    advance(10);
    fake.local.failNextSet = true;
    await heartbeat(bg);
    expect(error).toHaveBeenCalledTimes(1);
    advance(5);
    await heartbeat(bg);
    expect(totals(fake, 'a.example').seconds).toBe(15);
  });

  it('appends site ids and integer ids, never URLs, to the event log only when the log is on', async () => {
    openWindow(fake, 1, [{ id: 10, url: A }, { id: 11, url: B }]);
    const bg = createBackground();
    await bg.onInstalled();
    await bg.onTabActivated(activate(fake, 11));
    expect([...fake.local.data.keys()].filter((k) => k.startsWith('log:'))).toEqual([]);

    fake.local.data.set('settings', { ...DEFAULT_SETTINGS, eventLog: true });
    advance(2);
    await bg.onTabActivated(activate(fake, 10));
    await bg.onIdleChanged('idle');
    const logged = () => [...fake.local.data.entries()].filter(([k]) => k.startsWith('log:')).flatMap(([, v]) => v as object[]);
    expect(logged()).toEqual([
      { at: T0 + 2000, kind: 'url', site: 'a.example', tab: 10 },
      { at: T0 + 2000, kind: 'activate', win: 1, tab: 10 },
      { at: T0 + 2000, kind: 'idle-idle' },
    ]);
    expect(JSON.stringify(logged())).not.toMatch(/:\/\/|page|q=1/);
  });

  it('opens the job that rebuilt a lost hot state with a start entry, then the seed', async () => {
    openWindow(fake, 1, [{ id: 10, url: A }]);
    fake.local.data.set('settings', { ...DEFAULT_SETTINGS, eventLog: true });
    const bg = createBackground();
    await bg.onInstalled();
    fake.session.data.clear();
    advance(5);
    await heartbeat(bg);
    const logged = [...fake.local.data.entries()].filter(([k]) => k.startsWith('log:')).flatMap(([, v]) => v as object[]);
    expect(logged.slice(-3)).toEqual([
      { at: T0 + 5000, kind: 'start' },
      { at: T0 + 5000, kind: 'seed-active', site: 'a.example', win: 1, tab: 10 },
      { at: T0 + 5000, kind: 'tick' },
    ]);
    expect(logged[0]).toEqual({ at: T0, kind: 'start' });
  });
});

describe('start and alarms', () => {
  it('creates the alarms once, sets the idle interval and reconciles the rulesets on every start', async () => {
    const bg = createBackground();
    await bg.start();
    expect(fake.alarms.get('heartbeat')).toMatchObject({ periodInMinutes: 1 });
    expect(fake.alarms.get('prune')).toMatchObject({ periodInMinutes: 1440 });
    expect(fake.detectionInterval).toBe(60);
    expect([...fake.enabledRulesets].sort()).toEqual(['facebook-reels', 'instagram-reels', 'x-videos', 'youtube-shorts']);
    expect(fake.rulesetUpdates).toEqual([]);

    fake.local.data.set('settings', { ...DEFAULT_SETTINGS, idleThresholdSec: 300, blockers: { ...DEFAULT_SETTINGS.blockers, instagramExplore: true } });
    await createBackground().start();
    expect(fake.alarmCreates).toEqual(['heartbeat', 'prune']);
    expect(fake.detectionInterval).toBe(300);
    expect(fake.enabledRulesets.has('instagram-explore')).toBe(true);
  });

  it('recreates an alarm whose period is not the expected one', async () => {
    fake.alarms.set('heartbeat', { name: 'heartbeat', periodInMinutes: 5, scheduledTime: T0 });
    await createBackground().start();
    expect(fake.alarms.get('heartbeat')?.periodInMinutes).toBe(1);
  });

  it('prunes day keys older than 90 days on the prune alarm and on startup, and ignores unknown alarms', async () => {
    fake.local.data.set('d:2026-01-01', { sites: {}, blocked: {} });
    fake.local.data.set('d:2026-10-13', { sites: {}, blocked: {} });
    const bg = createBackground();
    await bg.onAlarm({ name: 'something-else' });
    expect(fake.local.data.has('d:2026-01-01')).toBe(true);
    await bg.onAlarm({ name: 'prune' });
    expect([...fake.local.data.keys()]).toEqual(['d:2026-10-13']);

    fake.local.data.set('d:2026-02-01', { sites: {}, blocked: {} });
    openWindow(fake, 1, [{ id: 10, url: A }]);
    await bg.onStartup();
    expect(fake.local.data.has('d:2026-02-01')).toBe(false);
  });
});

describe('the event log sweep', () => {
  const HOUR = 3_600_000;

  it('lists the storage keys once per hour while the log records, not on every job', async () => {
    const old = logKey(T0 - 30 * HOUR);
    fake.local.data.set(old, [{ at: T0 - 30 * HOUR, kind: 'tick' }]);
    fake.local.data.set('settings', { ...DEFAULT_SETTINGS, eventLog: true });
    openWindow(fake, 1, [{ id: 10, url: A }]);
    const bg = createBackground();
    await bg.onInstalled();
    expect(fake.local.data.has(old)).toBe(false);
    const listed = vi.spyOn(fake.local, 'getKeys');
    for (let minute = 0; minute < 10; minute += 1) {
      advance(60);
      await heartbeat(bg);
    }
    expect(listed).not.toHaveBeenCalled();
    expect(fake.local.data.get(logKey(T0))).toHaveLength(12);
  });

  it('drops log hours older than 24 h on the prune alarm, even with the log off', async () => {
    const old = logKey(T0 - 30 * HOUR);
    const recent = logKey(T0 - HOUR);
    fake.local.data.set(old, [{ at: T0 - 30 * HOUR, kind: 'tick' }]);
    fake.local.data.set(recent, [{ at: T0 - HOUR, kind: 'tick' }]);
    await createBackground().onAlarm({ name: 'prune' });
    expect(fake.local.data.has(old)).toBe(false);
    expect(fake.local.data.has(recent)).toBe(true);
  });
});
