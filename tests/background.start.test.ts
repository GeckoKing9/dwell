import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackground } from '../src/background/listeners.ts';
import { DEFAULT_SETTINGS } from '../src/store/schema.ts';
import { installFakeChrome, openWindow, totals, type FakeChrome } from './support/fake-chrome.ts';

const T0 = new Date(2026, 9, 14, 9, 0, 0).getTime();
const A = 'https://a.example/page';

let fake: FakeChrome;

beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  fake = installFakeChrome();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function logged(): { kind: string }[] {
  return [...fake.local.data.entries()].filter(([key]) => key.startsWith('log:')).flatMap(([, value]) => value as { kind: string }[]);
}

describe('worker start (F13)', () => {
  it('makes no ruleset call when Chrome already has the wanted set, on the first start or any later one', async () => {
    await createBackground().start();
    await createBackground().start();
    expect(fake.rulesetUpdates).toEqual([]);
    expect([...fake.enabledRulesets].sort()).toEqual(['facebook-reels', 'instagram-reels', 'x-videos', 'youtube-shorts']);
  });

  it('keeps the X ruleset on, with no ruleset call, over settings stored before X existed', async () => {
    const old = { instagramReels: true, youtubeShorts: true, facebookReels: true, instagramExplore: false };
    fake.local.data.set('settings', { ...DEFAULT_SETTINGS, blockers: old });
    await createBackground().start();
    expect(fake.rulesetUpdates).toEqual([]);
    expect(fake.enabledRulesets.has('x-videos')).toBe(true);
  });

  it('enables the X ruleset when Chrome has it off and the settings predate X', async () => {
    const old = { instagramReels: true, youtubeShorts: true, facebookReels: true, instagramExplore: false };
    fake.local.data.set('settings', { ...DEFAULT_SETTINGS, blockers: old });
    fake.enabledRulesets.delete('x-videos');
    await createBackground().start();
    expect(fake.rulesetUpdates).toHaveLength(1);
    expect(fake.enabledRulesets.has('x-videos')).toBe(true);
  });

  it('makes one ruleset call when Chrome differs from the settings, then none on the next start', async () => {
    fake.enabledRulesets.add('instagram-explore');
    await createBackground().start();
    expect(fake.rulesetUpdates).toHaveLength(1);
    expect(fake.enabledRulesets.has('instagram-explore')).toBe(false);
    await createBackground().start();
    expect(fake.rulesetUpdates).toHaveLength(1);
  });

  it('sets the idle interval on every start, because chrome.idle has no getter and the call is a cheap local setter', async () => {
    fake.local.data.set('settings', { ...DEFAULT_SETTINGS, idleThresholdSec: 120 });
    await createBackground().start();
    expect(fake.detectionInterval).toBe(120);
    fake.detectionInterval = null;
    await createBackground().start();
    expect(fake.detectionInterval).toBe(120);
  });
});

describe('browser start and install (F15)', () => {
  it.each(['onStartup', 'onInstalled'] as const)('%s reads the live browser and logs a seed exactly once', async (listener) => {
    openWindow(fake, 1, [{ id: 10, url: A }]);
    fake.local.data.set('settings', { ...DEFAULT_SETTINGS, eventLog: true });
    const bg = createBackground();
    await bg.start();
    await bg[listener]();
    expect(fake.idleQueries).toHaveLength(1);
    expect(logged().filter((entry) => entry.kind.startsWith('seed'))).toHaveLength(1);
  });

  it.each(['onStartup', 'onInstalled'] as const)('%s prunes, reconciles the rulesets and ensures the alarms', async (listener) => {
    fake.local.data.set('d:2026-01-01', { sites: {}, blocked: {} });
    fake.enabledRulesets.add('instagram-explore');
    await createBackground()[listener]();
    expect(fake.local.data.has('d:2026-01-01')).toBe(false);
    expect(fake.enabledRulesets.has('instagram-explore')).toBe(false);
    expect([...fake.alarms.keys()].sort()).toEqual(['heartbeat', 'prune']);
  });

  it('counts from the moment the browser started, not from the first heartbeat', async () => {
    openWindow(fake, 1, [{ id: 10, url: A }]);
    const bg = createBackground();
    await bg.onStartup();
    vi.advanceTimersByTime(10_000);
    await bg.onAlarm({ name: 'heartbeat' });
    expect(totals(fake, 'a.example').seconds).toBe(10);
    expect(fake.idleQueries).toHaveLength(1);
  });
});
