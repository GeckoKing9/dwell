import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackground, type Background } from '../src/background/listeners.ts';
import { DEFAULT_SETTINGS } from '../src/store/schema.ts';
import { EXTENSION_ID, engineState, installFakeChrome, openWindow, totals, type FakeChrome } from './support/fake-chrome.ts';

const T0 = new Date(2026, 9, 14, 9, 0, 0).getTime();
const A = 'https://a.example/';
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

let fake: FakeChrome;

beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  fake = installFakeChrome();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function advance(seconds: number): void {
  vi.advanceTimersByTime(seconds * 1000);
}

const heartbeat = (bg: Background) => bg.onAlarm({ name: 'heartbeat' });

function fromTab(tabId: number, url: string) {
  return { id: EXTENSION_ID, url, tab: { id: tabId }, frameId: 0 };
}

async function watching(mediaOverride: boolean): Promise<Background> {
  fake.local.data.set('settings', { ...DEFAULT_SETTINGS, mediaOverride });
  openWindow(fake, 1, [{ id: 30, url: YT }]);
  const bg = createBackground();
  await bg.onInstalled();
  expect(await bg.handleMessage({ type: 'media', playing: true }, fromTab(30, YT))).toEqual({ ok: true });
  advance(10);
  await bg.onIdleChanged('idle');
  for (let minute = 0; minute < 2; minute += 1) {
    advance(60);
    await heartbeat(bg);
  }
  return bg;
}

describe('media and idle (KTD2)', () => {
  it('a playing muted video on the YouTube tab keeps counting after idle when the override is on (AE2)', async () => {
    await watching(true);
    expect(engineState(fake).tabs['30']?.media).toMatchObject({ src: 'msg', on: true });
    expect(totals(fake, 'youtube.com').seconds).toBe(130);
  });

  it('a reload of the video tab drops the playing state of the page that left and trusts Chrome audible again', async () => {
    const bg = await watching(true);
    await bg.onTabUpdated(30, { status: 'loading' }, { url: YT, incognito: false, audible: false });
    expect(engineState(fake).tabs['30']?.media).toEqual({ src: 'audible', on: false });
    advance(60);
    await heartbeat(bg);
    expect(totals(fake, 'youtube.com').seconds).toBe(130);
  });

  it('stops at idle when the override is off', async () => {
    await watching(false);
    expect(totals(fake, 'youtube.com').seconds).toBe(10);
  });

  it('stops at lock even with the video playing (AE7)', async () => {
    const bg = await watching(true);
    await bg.onIdleChanged('locked');
    advance(60);
    await heartbeat(bg);
    expect(totals(fake, 'youtube.com').seconds).toBe(130);
  });

  it('never counts an audible tab in a window without focus (AE1)', async () => {
    openWindow(fake, 2, [{ id: 40, url: 'https://spotify.example/' }]);
    openWindow(fake, 1, [{ id: 10, url: A }]);
    const bg = createBackground();
    await bg.onInstalled();
    await bg.onTabUpdated(40, { audible: true }, { url: 'https://spotify.example/', incognito: false, audible: true });
    advance(30);
    await bg.onIdleChanged('idle');
    advance(60);
    await heartbeat(bg);
    expect(totals(fake, 'a.example').seconds).toBe(30);
    expect(totals(fake, 'spotify.example').seconds).toBe(0);
  });
});

describe('focus, tabs and windows', () => {
  it('stops counting when Chrome loses focus and looks up the active tab of the window that gains it', async () => {
    openWindow(fake, 2, [{ id: 20, url: 'https://c.example/' }]);
    openWindow(fake, 1, [{ id: 10, url: A }]);
    const bg = createBackground();
    await bg.onInstalled();
    advance(5);
    await bg.onFocusChanged(-1);
    advance(20);
    await bg.onFocusChanged(2);
    advance(5);
    await heartbeat(bg);
    expect(totals(fake, 'a.example').seconds).toBe(5);
    expect(totals(fake, 'c.example').seconds).toBe(5);
  });

  it('still records the focus change when the window has no active tab to look up', async () => {
    openWindow(fake, 1, [{ id: 10, url: A }]);
    const bg = createBackground();
    await bg.onInstalled();
    await bg.onFocusChanged(7);
    expect(engineState(fake).focusedWindow).toBe(7);
  });

  it('follows a navigation in the active tab and ignores changes that are not the URL or audible', async () => {
    openWindow(fake, 1, [{ id: 10, url: A }]);
    const bg = createBackground();
    await bg.onInstalled();
    advance(4);
    await bg.onTabUpdated(10, { url: 'https://b.example/x' }, { url: 'https://b.example/x', incognito: false });
    advance(6);
    await bg.onTabUpdated(10, {}, { url: 'https://b.example/x', incognito: false });
    await heartbeat(bg);
    expect(totals(fake, 'a.example').seconds).toBe(4);
    expect(totals(fake, 'b.example').seconds).toBe(6);
  });

  it('records nothing for an incognito tab', async () => {
    openWindow(fake, 1, [{ id: 10, url: A }]);
    const bg = createBackground();
    await bg.onInstalled();
    await bg.onTabUpdated(10, { url: 'https://secret.example/' }, { url: 'https://secret.example/', incognito: true });
    advance(30);
    await heartbeat(bg);
    expect(totals(fake, 'secret.example').seconds).toBe(0);
    expect(JSON.stringify([...fake.session.data.values()])).not.toContain('secret');
  });

  it('activates a tab it cannot read as not trackable', async () => {
    openWindow(fake, 1, [{ id: 10, url: A }]);
    const bg = createBackground();
    await bg.onInstalled();
    await bg.onTabActivated({ tabId: 99, windowId: 1 });
    advance(10);
    await heartbeat(bg);
    expect(totals(fake, 'a.example').seconds).toBe(0);
  });

  it('stops counting when the active tab closes or the focused window closes', async () => {
    openWindow(fake, 1, [{ id: 10, url: A }]);
    const bg = createBackground();
    await bg.onInstalled();
    advance(3);
    await bg.onTabRemoved(10);
    advance(10);
    await heartbeat(bg);
    expect(totals(fake, 'a.example').seconds).toBe(3);
    expect(engineState(fake).tabs['10']).toBeUndefined();

    await bg.onWindowRemoved(5);
    expect(engineState(fake).focusedWindow).toBe(1);
    await bg.onWindowRemoved(1);
    expect(engineState(fake).focusedWindow).toBeNull();
  });
});
