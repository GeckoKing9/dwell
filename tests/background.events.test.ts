import { describe, expect, it } from 'vitest';
import {
  WINDOW_ID_NONE,
  activateEvent,
  closeEvent,
  focusEvent,
  idleEvent,
  mediaEvent,
  pauseEvent,
  tickEvent,
  updatedEvent,
  urlEvent,
} from '../src/background/events.ts';
import { groupingChanged } from '../src/background/effects.ts';
import { logEntry } from '../src/background/log.ts';
import { seedEvent } from '../src/background/reseed.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/store/schema.ts';
import type { EngineEvent } from '../src/tracker/types.ts';

const AT = 1_760_450_000_000;
const NONE = { overrides: [], ignore: [] };

describe('focus', () => {
  it('maps WINDOW_ID_NONE to a null window', () => {
    expect(WINDOW_ID_NONE).toBe(-1);
    expect(focusEvent(WINDOW_ID_NONE, AT)).toEqual({ type: 'focus', at: AT, windowId: null });
  });

  it('keeps a real window id', () => {
    expect(focusEvent(12, AT)).toEqual({ type: 'focus', at: AT, windowId: 12 });
  });
});

describe('url', () => {
  it('groups the tab URL to its registrable domain and keeps nothing else of it', () => {
    const event = urlEvent({ id: 4, url: 'https://docs.google.com/document/d/abc?x=1#h', incognito: false }, NONE, AT);
    expect(event).toEqual({ type: 'url', at: AT, tabId: 4, site: 'google.com' });
    expect(JSON.stringify(event)).not.toMatch(/:\/\/|document|abc/);
  });

  it('applies the override and ignore lists', () => {
    const tab = { id: 4, url: 'https://docs.google.com/x', incognito: false };
    expect(urlEvent(tab, { overrides: ['docs.google.com'], ignore: [] }, AT).site).toBe('docs.google.com');
    expect(urlEvent(tab, { overrides: [], ignore: ['google.com'] }, AT).site).toBeNull();
  });

  it('maps incognito tabs to a non-trackable site even on a trackable URL', () => {
    expect(urlEvent({ id: 4, url: 'https://a.example/', incognito: true, audible: true }, NONE, AT)).toEqual({
      type: 'url',
      at: AT,
      tabId: 4,
      site: null,
      audible: true,
    });
  });

  it.each(['chrome://newtab/', 'chrome-extension://abc/page.html', 'file:///home/x.html', 'about:blank', ''])(
    'maps %j to a non-trackable site',
    (url) => {
      expect(urlEvent({ id: 4, url, incognito: false }, NONE, AT).site).toBeNull();
    },
  );

  it('treats a tab with no URL as not trackable', () => {
    expect(urlEvent({ id: 4, incognito: false }, NONE, AT).site).toBeNull();
  });

  it('carries audible when Chrome reports it and omits it otherwise', () => {
    expect(urlEvent({ id: 4, url: 'https://a.example/', incognito: false, audible: false }, NONE, AT)).toHaveProperty('audible', false);
    expect(urlEvent({ id: 4, url: 'https://a.example/', incognito: false }, NONE, AT)).not.toHaveProperty('audible');
  });
});

describe('updated', () => {
  const tab = { id: 9, url: 'https://www.youtube.com/watch?v=abc', incognito: false, audible: true };

  it('maps a URL change to a url event for the tab', () => {
    expect(updatedEvent(9, { url: tab.url }, { ...tab, audible: false }, NONE, AT)).toEqual({
      type: 'url',
      at: AT,
      tabId: 9,
      site: 'youtube.com',
      audible: false,
    });
  });

  it('maps an audible change to a url event carrying the change and the current site', () => {
    expect(updatedEvent(9, { audible: true }, tab, NONE, AT)).toEqual({
      type: 'url',
      at: AT,
      tabId: 9,
      site: 'youtube.com',
      audible: true,
    });
  });

  it('ignores changes that are neither the URL nor audible', () => {
    expect(updatedEvent(9, {}, tab, NONE, AT)).toBeNull();
  });

  it('uses the event tab id, not the tab object', () => {
    expect(updatedEvent(9, { url: 'https://a.example/' }, { url: 'https://a.example/', incognito: false }, NONE, AT)?.tabId).toBe(9);
  });
});

describe('seed', () => {
  const tabs = [
    { id: 1, url: 'https://a.example/', incognito: false, active: false },
    { id: 2, url: 'https://www.youtube.com/watch?v=x', incognito: false, active: true, audible: true },
  ];

  it('takes the active tab of the focused window, with its audible flag', () => {
    expect(seedEvent({ id: 5, focused: true, incognito: false, tabs }, 'idle', NONE, AT)).toEqual({
      type: 'seed',
      at: AT,
      idle: 'idle',
      windowId: 5,
      tabId: 2,
      site: 'youtube.com',
      audible: true,
    });
  });

  it.each([
    ['no window', null],
    ['an unfocused window', { id: 5, focused: false, incognito: false, tabs }],
    ['an incognito window', { id: 5, focused: true, incognito: true, tabs }],
    ['a window without an id', { focused: true, incognito: false, tabs }],
  ])('focuses nothing for %s', (_label, win) => {
    expect(seedEvent(win, 'active', NONE, AT)).toEqual({ type: 'seed', at: AT, idle: 'active', windowId: null, tabId: null, site: null });
  });

  it('keeps the window but no tab when the window has no active tab', () => {
    expect(seedEvent({ id: 5, focused: true, incognito: false, tabs: [] }, 'active', NONE, AT)).toMatchObject({ windowId: 5, tabId: null });
  });
});

describe('log entries', () => {
  it.each([
    [{ type: 'focus', at: AT, windowId: null }, { at: AT, kind: 'focus-none' }],
    [{ type: 'focus', at: AT, windowId: 3 }, { at: AT, kind: 'focus' }],
    [{ type: 'idle', at: AT, state: 'locked' }, { at: AT, kind: 'idle-locked' }],
    [{ type: 'media', at: AT, tabId: 1, playing: true }, { at: AT, kind: 'media-on' }],
    [{ type: 'media', at: AT, tabId: 1, playing: false }, { at: AT, kind: 'media-off' }],
    [{ type: 'pause', at: AT, paused: true }, { at: AT, kind: 'pause-on' }],
    [{ type: 'pause', at: AT, paused: false }, { at: AT, kind: 'pause-off' }],
    [{ type: 'url', at: AT, tabId: 1, site: 'a.example' }, { at: AT, kind: 'url', site: 'a.example' }],
    [{ type: 'url', at: AT, tabId: 1, site: null }, { at: AT, kind: 'url' }],
    [{ type: 'url', at: AT, tabId: 1, site: 'localhost' }, { at: AT, kind: 'url' }],
    [{ type: 'seed', at: AT, windowId: 1, tabId: 1, site: 'b.example', idle: 'active' }, { at: AT, kind: 'seed', site: 'b.example' }],
    [{ type: 'close', at: AT, tabId: 1 }, { at: AT, kind: 'close' }],
  ] as [EngineEvent, object][])('logs %j as %j', (event, entry) => {
    expect(logEntry(event)).toEqual(entry);
  });
});

describe('grouping changes', () => {
  const settingsWith = (patch: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...patch });

  it('notices a changed override or ignore list, including one of the same length', () => {
    expect(groupingChanged(settingsWith({ overrides: ['a.example'] }), settingsWith({ overrides: ['b.example'] }))).toBe(true);
    expect(groupingChanged(settingsWith({ ignore: [] }), settingsWith({ ignore: ['a.example'] }))).toBe(true);
    expect(groupingChanged(settingsWith({ overrides: ['a.example'] }), settingsWith({ overrides: ['a.example'], mediaOverride: false }))).toBe(false);
  });
});

describe('the other events', () => {
  it('maps each payload to its engine event', () => {
    expect(activateEvent({ tabId: 3, windowId: 1 }, AT)).toEqual({ type: 'activate', at: AT, windowId: 1, tabId: 3 });
    expect(closeEvent(3, AT)).toEqual({ type: 'close', at: AT, tabId: 3 });
    expect(idleEvent('locked', AT)).toEqual({ type: 'idle', at: AT, state: 'locked' });
    expect(tickEvent(AT)).toEqual({ type: 'tick', at: AT });
    expect(pauseEvent(true, AT)).toEqual({ type: 'pause', at: AT, paused: true });
    expect(mediaEvent(3, false, AT)).toEqual({ type: 'media', at: AT, tabId: 3, playing: false });
  });
});
