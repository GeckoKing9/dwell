import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackground, type Background } from '../src/background/listeners.ts';
import { RULESET_IDS } from '../src/background/rulesets.ts';
import { DEFAULT_SETTINGS, EXPORT_FORMAT, type Settings } from '../src/store/schema.ts';
import { EXTENSION_ID, blockedCount, engineState, installFakeChrome, openWindow, totals, type FakeChrome } from './support/fake-chrome.ts';

const T0 = new Date(2026, 9, 14, 9, 0, 0).getTime();
const DASHBOARD = { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/src/dashboard/index.html`, tab: { id: 3 }, frameId: 0 };
const POPUP = { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/src/popup/index.html` };
const INSTAGRAM = { id: EXTENSION_ID, url: 'https://www.instagram.com/', tab: { id: 8 }, frameId: 0 };

let fake: FakeChrome;
let bg: Background;

beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  fake = installFakeChrome();
  openWindow(fake, 1, [{ id: 10, url: 'https://maps.google.com/d/1' }]);
  bg = createBackground();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function advance(seconds: number): void {
  vi.advanceTimersByTime(seconds * 1000);
}

function settings(): typeof DEFAULT_SETTINGS {
  return fake.local.data.get('settings') as typeof DEFAULT_SETTINGS;
}

describe('rejected messages', () => {
  it.each([
    ['a malformed message', { type: 'blocked', site: 'myspace' }, INSTAGRAM],
    ['an unknown type', { type: 'export' }, POPUP],
    ['a non-object', 'pause', POPUP],
    ['settings from a content script', { type: 'settings', patch: { mediaOverride: false } }, INSTAGRAM],
    ['pause from a content script', { type: 'pause', paused: true }, INSTAGRAM],
    ['blocked from an extension page in a tab', { type: 'blocked', site: 'instagram' }, DASHBOARD],
    ['another extension', { type: 'pause', paused: true }, { ...POPUP, id: 'ponmlkjihgfedcbaponmlkjihgfedcba' }],
  ])('rejects %s and changes nothing', async (_label, message, sender) => {
    const reply = await bg.handleMessage(message, sender);
    expect(reply.ok).toBe(false);
    expect([...fake.local.data.keys()]).toEqual([]);
    expect(fake.session.data.size).toBe(0);
  });

  it('answers through sendResponse and keeps the channel open', async () => {
    const sendResponse = vi.fn();
    expect(bg.onMessage({ type: 'undoDelete' }, POPUP, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: false, reason: 'expired' }));
  });
});

describe('content-script messages', () => {
  it('counts each blocked message for its site on today', async () => {
    expect(await bg.handleMessage({ type: 'blocked', site: 'instagram' }, INSTAGRAM)).toEqual({ ok: true });
    expect(await bg.handleMessage({ type: 'blocked', site: 'instagram' }, INSTAGRAM)).toEqual({ ok: true });
    expect(blockedCount(fake, 'instagram')).toBe(2);
    expect(fake.local.data.has('d:2026-10-14')).toBe(true);
  });

  it('gives a media message to the engine for the sender tab', async () => {
    await bg.handleMessage({ type: 'media', playing: true }, { ...INSTAGRAM, url: 'https://www.youtube.com/' });
    expect(engineState(fake).tabs['8']?.media).toMatchObject({ src: 'msg', on: true });
  });
});

describe('pause', () => {
  it('stores the pause, stops counting while paused and counts again after resume', async () => {
    await bg.onInstalled();
    advance(2);
    expect(await bg.handleMessage({ type: 'pause', paused: true }, POPUP)).toEqual({ ok: true, paused: true });
    expect(settings().paused).toBe(true);
    expect(engineState(fake).paused).toBe(true);
    advance(10);
    await bg.handleMessage({ type: 'pause', paused: false }, DASHBOARD);
    advance(3);
    await bg.onAlarm({ name: 'heartbeat' });
    expect(totals(fake, 'google.com').seconds).toBe(5);
  });
});

describe('settings', () => {
  it('saves the patch and reconciles the rulesets with the blocker toggles', async () => {
    const patch = { blockers: { instagramReels: false, instagramExplore: true } };
    const reply = await bg.handleMessage({ type: 'settings', patch }, DASHBOARD);
    expect(reply).toMatchObject({ ok: true, settings: { blockers: { instagramReels: false, instagramExplore: true } } });
    expect(settings().blockers).toEqual({ instagramReels: false, youtubeShorts: true, facebookReels: true, instagramExplore: true });
    expect([...fake.enabledRulesets].sort()).toEqual(['facebook-reels', 'instagram-explore', 'youtube-shorts']);
    expect(RULESET_IDS).toEqual({
      instagramReels: 'instagram-reels',
      youtubeShorts: 'youtube-shorts',
      facebookReels: 'facebook-reels',
      instagramExplore: 'instagram-explore',
    });
  });

  it('sets the idle detection interval only when the threshold changes', async () => {
    await bg.handleMessage({ type: 'settings', patch: { mediaOverride: false } }, POPUP);
    expect(fake.detectionInterval).toBeNull();
    await bg.handleMessage({ type: 'settings', patch: { idleThresholdSec: 120 } }, POPUP);
    expect(fake.detectionInterval).toBe(120);
  });

  it('applies a grouping change to the active tab at once', async () => {
    await bg.onInstalled();
    advance(4);
    await bg.handleMessage({ type: 'settings', patch: { overrides: ['maps.google.com'] } }, DASHBOARD);
    advance(6);
    await bg.onAlarm({ name: 'heartbeat' });
    expect(totals(fake, 'google.com').seconds).toBe(4);
    expect(totals(fake, 'maps.google.com').seconds).toBe(6);
  });

  it('stops counting the active tab at once when its site joins the ignore list', async () => {
    await bg.onInstalled();
    advance(4);
    await bg.handleMessage({ type: 'settings', patch: { ignore: ['google.com'] } }, DASHBOARD);
    advance(6);
    await bg.onAlarm({ name: 'heartbeat' });
    expect(totals(fake, 'google.com').seconds).toBe(4);
  });

  it('replies ok with a warning, keeps the saved value and lets the next start apply it when Chrome refuses the change (F7)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await bg.onInstalled();
    advance(4);
    fake.failNextRulesetUpdate = true;
    const patch = { blockers: { youtubeShorts: false }, overrides: ['maps.google.com'] };
    const reply = await bg.handleMessage({ type: 'settings', patch }, DASHBOARD);
    expect(reply).toMatchObject({ ok: true, warning: 'applied-later', settings: { blockers: { youtubeShorts: false } } });
    expect(settings().blockers.youtubeShorts).toBe(false);
    expect(fake.enabledRulesets.has('youtube-shorts')).toBe(true);
    expect(error).toHaveBeenCalledTimes(1);
    advance(6);
    await bg.onAlarm({ name: 'heartbeat' });
    expect(totals(fake, 'maps.google.com').seconds).toBe(6);
    await createBackground().start();
    expect(fake.enabledRulesets.has('youtube-shorts')).toBe(false);
    error.mockRestore();
  });

  it('answers with the reason when the stored settings would be invalid', async () => {
    const categories = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`s${i}.example`, 'Work']));
    const reply = await bg.handleMessage({ type: 'settings', patch: { categories } }, DASHBOARD);
    expect(reply).toEqual({ ok: false, reason: expect.stringContaining('categories') });
    expect(fake.local.data.has('settings')).toBe(false);
  });
});

describe('failures', () => {
  it('answers with a failure when a write fails or a media sender has no tab id', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.local.failNextSet = true;
    expect(await bg.handleMessage({ type: 'pause', paused: true }, POPUP)).toEqual({ ok: false, reason: expect.any(String) });
    fake.session.failNextSet = true;
    expect((await bg.handleMessage({ type: 'media', playing: true }, INSTAGRAM)).ok).toBe(false);
    expect((await bg.handleMessage({ type: 'media', playing: true }, { ...INSTAGRAM, tab: {} })).ok).toBe(false);
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});

describe('import', () => {
  const file = (change: Partial<Settings>) =>
    JSON.stringify({
      format: EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date(T0).toISOString(),
      days: { '2026-10-13': { sites: { 'a.example': { h: { '9': 60 }, v: 1 } }, blocked: { instagram: 1, youtube: 0, facebook: 0 } } },
      settings: { ...DEFAULT_SETTINGS, ...change },
    });
  const noShorts = { blockers: { ...DEFAULT_SETTINGS.blockers, youtubeShorts: false } };

  it('merges the file, answers with the outcome and reconciles the imported blockers', async () => {
    const reply = await bg.handleMessage({ type: 'import', text: file(noShorts) }, DASHBOARD);
    expect(reply).toEqual({ ok: true, skipped: 0, daysWritten: 1, settingsWritten: true });
    expect(totals(fake, 'a.example').seconds).toBe(60);
    expect(fake.enabledRulesets.has('youtube-shorts')).toBe(false);
  });

  it('moves the open tabs to their new site at once when the imported settings change the grouping (F12)', async () => {
    await bg.onInstalled();
    advance(4);
    const reply = await bg.handleMessage({ type: 'import', text: file({ overrides: ['maps.google.com'] }) }, DASHBOARD);
    expect(reply).toMatchObject({ ok: true, settingsWritten: true });
    advance(6);
    await bg.onAlarm({ name: 'heartbeat' });
    expect(totals(fake, 'google.com').seconds).toBe(4);
    expect(totals(fake, 'maps.google.com').seconds).toBe(6);
  });

  it('replies with the outcome and a warning when the import was written but Chrome refused the rulesets (F7)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.failNextRulesetUpdate = true;
    const reply = await bg.handleMessage({ type: 'import', text: file(noShorts) }, DASHBOARD);
    expect(reply).toEqual({ ok: true, skipped: 0, daysWritten: 1, settingsWritten: true, warning: 'applied-later' });
    expect(totals(fake, 'a.example').seconds).toBe(60);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('answers with the rejection and writes nothing for a bad file', async () => {
    const reply = await bg.handleMessage({ type: 'import', text: '{"format":"other"}' }, DASHBOARD);
    expect(reply).toMatchObject({ ok: false, code: 'bad-format' });
    expect(fake.local.data.size).toBe(0);
  });
});

describe('delete all and undo', () => {
  async function recordSomething(): Promise<void> {
    await bg.onInstalled();
    advance(5);
    await bg.onAlarm({ name: 'heartbeat' });
  }

  it('deletes every record, keeps an in-memory snapshot and restores it within 10 s', async () => {
    await recordSomething();
    const reply = await bg.handleMessage({ type: 'deleteAll' }, DASHBOARD);
    expect(reply).toEqual({ ok: true, undoUntil: Date.now() + 10_000 });
    expect(totals(fake, 'google.com').seconds).toBe(0);
    expect(fake.session.data.size).toBe(0);
    advance(9);
    expect(await bg.handleMessage({ type: 'undoDelete' }, DASHBOARD)).toEqual({ ok: true });
    expect(totals(fake, 'google.com').seconds).toBe(5);
    expect(await bg.handleMessage({ type: 'undoDelete' }, DASHBOARD)).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses the undo once the 10 s window has passed', async () => {
    await recordSomething();
    await bg.handleMessage({ type: 'deleteAll' }, POPUP);
    advance(10.001);
    expect(await bg.handleMessage({ type: 'undoDelete' }, POPUP)).toEqual({ ok: false, reason: 'expired' });
    expect(totals(fake, 'google.com').seconds).toBe(0);
  });
});
