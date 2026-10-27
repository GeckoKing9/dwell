import { describe, expect, it } from 'vitest';
import { authorize, type SenderLike } from '../src/background/authorize.ts';
import type { Message } from '../src/shared/messages.ts';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const OTHER = 'ponmlkjihgfedcbaponmlkjihgfedcba';
const DASHBOARD = `chrome-extension://${ID}/src/dashboard/index.html`;
const POPUP = `chrome-extension://${ID}/src/popup/index.html`;

const CONTENT: Message[] = [
  { type: 'blocked', site: 'instagram' },
  { type: 'media', playing: true },
];
const PAGE: Message[] = [
  { type: 'settings', patch: { mediaOverride: false } },
  { type: 'pause', paused: true },
  { type: 'import', text: '{}' },
  { type: 'deleteAll' },
  { type: 'undoDelete' },
];

function content(url: string, extra: Partial<SenderLike> = {}): SenderLike {
  return { id: ID, url, tab: { id: 7 }, frameId: 0, ...extra };
}

describe('authorize: content scripts on the four sites', () => {
  it.each(CONTENT)('accepts %j from a top-frame tab on www.instagram.com', (message) => {
    expect(authorize(message, content('https://www.instagram.com/'), ID)).toEqual({ ok: true, origin: 'content' });
  });

  it.each(PAGE)('rejects the page-only %j from a content script', (message) => {
    const result = authorize(message, content('https://www.instagram.com/p/abc/'), ID);
    expect(result.ok).toBe(false);
  });

  it.each([
    'https://instagram.com/',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://m.youtube.com/',
    'https://youtube.com/',
    'https://www.facebook.com/',
    'https://m.facebook.com/',
    'https://facebook.com/',
    'https://x.com/home',
    'https://x.com/someuser/status/123',
  ])('accepts media from %s', (url) => {
    expect(authorize({ type: 'media', playing: false }, content(url), ID)).toEqual({ ok: true, origin: 'content' });
    expect(authorize({ type: 'attention', present: true }, content(url), ID)).toEqual({ ok: true, origin: 'content' });
  });

  it('accepts blocked only for the site the sender is on', () => {
    expect(authorize({ type: 'blocked', site: 'youtube' }, content('https://www.youtube.com/'), ID).ok).toBe(true);
    expect(authorize({ type: 'blocked', site: 'youtube' }, content('https://www.instagram.com/'), ID).ok).toBe(false);
    expect(authorize({ type: 'blocked', site: 'facebook' }, content('https://m.youtube.com/'), ID).ok).toBe(false);
    expect(authorize({ type: 'blocked', site: 'x' }, content('https://x.com/someuser/status/123'), ID)).toEqual({ ok: true, origin: 'content' });
    expect(authorize({ type: 'blocked', site: 'x' }, content('https://www.instagram.com/'), ID).ok).toBe(false);
    expect(authorize({ type: 'blocked', site: 'instagram' }, content('https://x.com/'), ID).ok).toBe(false);
  });

  it.each(PAGE)('rejects the page-only %j from a content script on x.com', (message) => {
    expect(authorize(message, content('https://x.com/home'), ID).ok).toBe(false);
  });

  it.each([
    ['a tab on another site', 'https://a.example/'],
    ['a look-alike host', 'https://www.instagram.com.evil.example/'],
    ['a subdomain outside the list', 'https://music.youtube.com/'],
    ['the www host of X, which X redirects away from', 'https://www.x.com/'],
    ['twitter.com, which X redirects to x.com', 'https://twitter.com/'],
    ['an X look-alike host', 'https://x.com.evil.example/'],
    ['plain http on X', 'http://x.com/'],
    ['plain http', 'http://www.instagram.com/'],
    ['a non-web URL', 'about:blank'],
    ['a malformed URL', 'not a url'],
  ])('rejects blocked and media from %s', (_label, url) => {
    for (const message of CONTENT) expect(authorize(message, content(url), ID).ok).toBe(false);
  });

  it('rejects a sender on the site that is not a tab, and one in a subframe', () => {
    const noTab: SenderLike = { id: ID, url: 'https://www.instagram.com/' };
    expect(authorize({ type: 'media', playing: true }, noTab, ID).ok).toBe(false);
    expect(authorize({ type: 'media', playing: true }, content('https://www.instagram.com/', { frameId: 3 }), ID).ok).toBe(false);
  });
});

describe('authorize: extension pages', () => {
  it.each(PAGE)('accepts %j from the popup (no tab)', (message) => {
    expect(authorize(message, { id: ID, url: POPUP }, ID)).toEqual({ ok: true, origin: 'page' });
  });

  it.each(PAGE)('accepts %j from the dashboard open in a tab', (message) => {
    expect(authorize(message, { id: ID, url: DASHBOARD, tab: { id: 3 }, frameId: 0 }, ID)).toEqual({ ok: true, origin: 'page' });
  });

  it.each(CONTENT)('rejects the content-only %j from an extension page in a tab', (message) => {
    const result = authorize(message, { id: ID, url: DASHBOARD, tab: { id: 3 }, frameId: 0 }, ID);
    expect(result).toEqual({ ok: false, reason: expect.stringContaining(message.type) });
  });

  it('rejects an extension page framed inside another page', () => {
    expect(authorize({ type: 'deleteAll' }, { id: ID, url: DASHBOARD, tab: { id: 3 }, frameId: 2 }, ID).ok).toBe(false);
  });

  it.each([
    ['the origin of another extension', `chrome-extension://${OTHER}/page.html`],
    ['a prefix look-alike', `chrome-extension://${ID}evil/page.html`],
    ['the origin without a path', `chrome-extension://${ID}`],
  ])('rejects %s', (_label, url) => {
    expect(authorize({ type: 'deleteAll' }, { id: ID, url }, ID).ok).toBe(false);
  });
});

describe('authorize: the sender id', () => {
  it('rejects another extension, a missing id and an empty extension id', () => {
    expect(authorize({ type: 'pause', paused: true }, { id: OTHER, url: POPUP }, ID).ok).toBe(false);
    expect(authorize({ type: 'pause', paused: true }, { url: POPUP }, ID).ok).toBe(false);
    expect(authorize({ type: 'pause', paused: true }, { id: '', url: 'chrome-extension:///x' }, '').ok).toBe(false);
  });

  it('rejects a sender with no URL', () => {
    expect(authorize({ type: 'media', playing: true }, { id: ID, tab: { id: 7 }, frameId: 0 }, ID).ok).toBe(false);
  });

  it('never echoes the sender URL in the reason', () => {
    const result = authorize({ type: 'media', playing: true }, content('https://a.example/secret/path?q=1'), ID);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('a.example');
  });
});
