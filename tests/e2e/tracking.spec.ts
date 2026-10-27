import { chromium, expect, test, type BrowserContext, type CDPSession, type Page, type Worker } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../../dist', import.meta.url));
const instagram = readFileSync(new URL('./fixtures/instagram.html', import.meta.url), 'utf8');
const A = 'https://a.example/';
const B = 'https://b.example/';
const IG = 'https://www.instagram.com';
const YT_WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

interface Day {
  sites?: Record<string, { h: Record<string, number>; v: number }>;
  blocked?: Record<string, number>;
}
interface Hot {
  engine?: {
    activeTabs?: Record<string, number>;
    tabs?: Record<string, { media?: { src: string; on: boolean } }>;
    attention?: { tabId: number; windowId: number; at: number };
  };
}
interface World {
  id: number;
  origin: string;
  auxData?: { type?: string };
}

let context: BrowserContext;
let extensionId: string;
/** An about:blank tab: bringing it to the front closes the open interval without counting anything. */
let neutral: Page;
/** An extension page: sends page messages, and its CDP session can stop the extension's worker. */
let dashboard: Page;
let devtools: CDPSession;
/** Every running status the worker went through, as CDP reports it. */
const statuses: string[] = [];

function html(title: string, body = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><p>${title}</p>${body}</body></html>`;
}

async function fulfil(context: BrowserContext, pattern: string, body: string): Promise<void> {
  await context.route(pattern, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body }));
}

async function sw(): Promise<Worker> {
  return context.serviceWorkers()[0] ?? context.waitForEvent('serviceworker');
}

async function days(): Promise<Record<string, Day>> {
  const all = await (await sw()).evaluate(() => chrome.storage.local.get(null));
  return Object.fromEntries(Object.entries(all).filter(([key]) => key.startsWith('d:'))) as Record<string, Day>;
}

async function seconds(site: string): Promise<number> {
  return Object.values(await days()).reduce((sum, day) => sum + Object.values(day.sites?.[site]?.h ?? {}).reduce((a, b) => a + b, 0), 0);
}

async function blocked(site: string): Promise<number> {
  return Object.values(await days()).reduce((sum, day) => sum + (day.blocked?.[site] ?? 0), 0);
}

/** True once the queue has processed the activation of the tab that is in front now. */
async function settled(): Promise<boolean> {
  return (await sw()).evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const { hot } = (await chrome.storage.session.get('hot')) as { hot?: Hot };
    return tab !== undefined && hot?.engine?.activeTabs?.[String(tab.windowId)] === tab.id;
  });
}

/** Brings a tab to the front and waits until the worker has attributed the interval it closed. */
async function front(page: Page): Promise<void> {
  await page.bringToFront();
  await expect.poll(settled).toBe(true);
}

async function open(url: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url);
  return page;
}

function fromPage(message: unknown): Promise<unknown> {
  return dashboard.evaluate((m) => chrome.runtime.sendMessage(m), message);
}

/** Sends a message from the extension's real content-script world in `page` (a CDP isolated world). */
async function fromContentScript(page: Page, message: unknown): Promise<unknown> {
  const session = await context.newCDPSession(page);
  const worlds: World[] = [];
  session.on('Runtime.executionContextCreated', (event) => worlds.push(event.context));
  await session.send('Runtime.enable');
  const world = worlds.find((w) => w.auxData?.type === 'isolated' && w.origin.includes(extensionId));
  if (world === undefined) throw new Error('the content-script world was not found');
  const { result } = await session.send('Runtime.evaluate', {
    expression: `chrome.runtime.sendMessage(${JSON.stringify(message)})`,
    contextId: world.id,
    awaitPromise: true,
    returnByValue: true,
  });
  await session.detach();
  return result.value;
}

test.beforeAll(async () => {
  if (!existsSync(`${dist}/manifest.json`)) throw new Error('dist/ missing: run npm run build first');
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  extensionId = new URL((await sw()).url()).host;
  await fulfil(context, `${A}**`, html('Fixture A'));
  await fulfil(context, `${B}**`, html('Fixture B'));
  await fulfil(context, `${IG}/**`, instagram);
  await fulfil(context, 'https://www.youtube.com/**', html('Video', '<video id="clip" muted playsinline width="32" height="32"></video>'));
  neutral = context.pages()[0] ?? (await context.newPage());
  dashboard = await open(`chrome-extension://${extensionId}/src/dashboard/index.html`);
  devtools = await context.newCDPSession(dashboard);
  devtools.on('ServiceWorker.workerVersionUpdated', (event) => {
    for (const version of event.versions) {
      if (version.scriptURL.startsWith(`chrome-extension://${extensionId}/`)) statuses.push(version.runningStatus);
    }
  });
  await devtools.send('ServiceWorker.enable');
});

test.afterAll(async () => {
  await context?.close();
});

test.beforeEach(async () => {
  await front(neutral);
  await (await sw()).evaluate(() => chrome.storage.local.clear());
});

test('fixture A for 10 s, then fixture B for 5 s: A has 9 to 11 s and B 4 to 6 s', async () => {
  test.setTimeout(45_000);
  expect(await (await sw()).evaluate(() => chrome.idle.queryState(60))).toBe('active');
  const a = await open(A);
  await a.waitForTimeout(10_000);
  const b = await open(B);
  await b.waitForTimeout(5_000);
  await front(neutral);
  expect(await seconds('a.example')).toBeGreaterThanOrEqual(9);
  expect(await seconds('a.example')).toBeLessThanOrEqual(13);
  expect(await seconds('b.example')).toBeGreaterThanOrEqual(4);
  expect(await seconds('b.example')).toBeLessThanOrEqual(8);
  await Promise.all([a.close(), b.close()]);
});

test('a worker stopped mid-session wakes on the next tab switch and the totals continue (AE8)', async () => {
  test.setTimeout(45_000);
  const a = await open(A);
  await a.waitForTimeout(4_000);
  statuses.length = 0;
  await devtools.send('ServiceWorker.stopAllWorkers');
  await expect.poll(() => statuses.at(-1)).toBe('stopped');
  await a.waitForTimeout(3_000);
  const b = await open(B);
  await expect.poll(() => statuses.at(-1)).toBe('running');
  await b.waitForTimeout(3_000);
  await front(neutral);
  // The worker really was down, and the tab switch (not this test reading storage) started it again.
  expect(statuses.indexOf('stopped')).toBeGreaterThan(-1);
  expect(statuses.lastIndexOf('running')).toBeGreaterThan(statuses.indexOf('stopped'));
  expect(await seconds('a.example')).toBeGreaterThanOrEqual(6);
  expect(await seconds('a.example')).toBeLessThanOrEqual(10);
  expect(await seconds('b.example')).toBeGreaterThanOrEqual(2);
  expect(await seconds('b.example')).toBeLessThanOrEqual(6);
  await Promise.all([a.close(), b.close()]);
});

test('paused from an extension page, 10 s of browsing records nothing; after resume it counts again', async () => {
  test.setTimeout(45_000);
  expect(await fromPage({ type: 'pause', paused: true })).toEqual({ ok: true, paused: true });
  const a = await open(A);
  await a.waitForTimeout(10_000);
  await front(neutral);
  expect(await seconds('a.example')).toBe(0);

  expect(await fromPage({ type: 'pause', paused: false })).toEqual({ ok: true, paused: false });
  await front(a);
  await a.waitForTimeout(3_000);
  await front(neutral);
  expect(await seconds('a.example')).toBeGreaterThanOrEqual(2);
  expect(await seconds('a.example')).toBeLessThanOrEqual(6);
  await a.close();
});

test('the worker rejects blocked from a tab off the three sites, and page messages from a content script', async () => {
  expect(await fromPage({ type: 'blocked', site: 'instagram' })).toMatchObject({ ok: false });

  const ig = await open(`${IG}/`);
  expect(await fromContentScript(ig, { type: 'settings', patch: { mediaOverride: false } })).toMatchObject({ ok: false });
  expect(await fromContentScript(ig, { type: 'pause', paused: true })).toMatchObject({ ok: false });
  expect(await fromContentScript(ig, { type: 'blocked', site: 'youtube' })).toMatchObject({ ok: false });
  expect(await blocked('instagram')).toBe(0);
  expect(await blocked('youtube')).toBe(0);
  expect(await (await sw()).evaluate(() => chrome.storage.local.get('settings'))).toEqual({});
  await ig.close();
});

test('landing on instagram.com/#dwell=instagram counts one redirect today, and a reload does not count again', async () => {
  const ig = await open(`${IG}/#dwell=instagram`);
  await expect.poll(() => blocked('instagram')).toBe(1);
  const now = new Date();
  const today = `d:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  expect((await days())[today]?.blocked?.instagram).toBe(1);
  await ig.reload();
  await ig.waitForTimeout(500);
  expect(await blocked('instagram')).toBe(1);
  await ig.close();
});

test('a muted video playing on the YouTube host reaches the engine as media for its tab, and the tab counts', async () => {
  test.setTimeout(45_000);
  const yt = await open(YT_WATCH);
  await yt.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.getContext('2d')?.fillRect(0, 0, 8, 8);
    const video = document.getElementById('clip') as HTMLVideoElement;
    video.srcObject = canvas.captureStream(5);
    await video.play();
  });
  const media = async () =>
    (await sw()).evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const { hot } = (await chrome.storage.session.get('hot')) as { hot?: Hot };
      return tab?.id === undefined ? undefined : hot?.engine?.tabs?.[String(tab.id)]?.media;
    });
  await expect.poll(media).toEqual({ src: 'msg', on: true });
  await yt.waitForTimeout(3_000);
  await front(neutral);
  expect(await seconds('youtube.com')).toBeGreaterThanOrEqual(2);
  expect(await seconds('youtube.com')).toBeLessThanOrEqual(7);
  await yt.close();
});

test('input a page takes outside Chrome focus gives its tab attention, under the sender tab and window, until it takes it back', async () => {
  const ig = await open(`${IG}/`);
  await front(ig);
  const attention = async () =>
    (await sw()).evaluate(async () => ((await chrome.storage.session.get('hot')) as { hot?: Hot }).hot?.engine?.attention);
  const tab = await (await sw()).evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]);
  expect(await fromContentScript(ig, { type: 'attention', present: true })).toMatchObject({ ok: true });
  await expect.poll(attention).toMatchObject({ tabId: tab?.id, windowId: tab?.windowId });
  expect(await fromContentScript(ig, { type: 'attention', present: false })).toMatchObject({ ok: true });
  await expect.poll(attention).toBeUndefined();
  await ig.close();
});
