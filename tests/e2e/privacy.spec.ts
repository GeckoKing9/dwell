import { chromium, expect, test, type BrowserContext, type Request, type Worker } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../../dist', import.meta.url));

interface Outcome {
  result: string;
  violated: string[];
}

let context: BrowserContext;
let worker: Worker;
let extensionId: string;

test.beforeAll(async () => {
  if (!existsSync(`${dist}/manifest.json`)) throw new Error('dist/ missing: run npm run build first');
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
});

test('the extension service worker is running', () => {
  expect(worker.url()).toBe(`chrome-extension://${extensionId}/service-worker-loader.js`);
  expect(extensionId).toMatch(/^[a-p]{32}$/);
});

test('fetch from the service worker is refused by the CSP', async () => {
  const outcome: Outcome = await worker.evaluate(async () => {
    const violated: string[] = [];
    self.addEventListener('securitypolicyviolation', (e) => violated.push(e.effectiveDirective));
    let result = 'resolved';
    try {
      await fetch('https://example.com/');
    } catch (error) {
      result = `rejected: ${String(error)}`;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { result, violated };
  });
  expect(outcome.result).toMatch(/^rejected/);
  expect(outcome.violated).toContain('connect-src');
});

test('fetch from the dashboard page is refused and a remote image never loads', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/dashboard/index.html`);
  await expect(page.locator('.dash[data-view]')).toBeVisible();

  const outcome: Outcome = await page.evaluate(async () => {
    const violated: string[] = [];
    document.addEventListener('securitypolicyviolation', (e) => violated.push(e.effectiveDirective));
    let result = 'resolved';
    try {
      await fetch('https://example.com/');
    } catch (error) {
      result = `rejected: ${String(error)}`;
    }
    const image = await new Promise<string>((resolve) => {
      const img = document.createElement('img');
      img.addEventListener('load', () => resolve('load'));
      img.addEventListener('error', () => resolve('error'));
      img.src = 'https://example.com/x.png';
      document.body.append(img);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { result: `${result}; image ${image}`, violated };
  });

  expect(outcome.result).toMatch(/^rejected: .*; image error$/);
  expect(outcome.violated).toEqual(expect.arrayContaining(['connect-src', 'img-src']));
  await page.close();
});

const ALLOWED_HOSTS = new Set(['a.example', 'b.example', 'www.instagram.com', 'www.youtube.com', 'www.facebook.com', 'm.youtube.com', 'x.com']);
const INERT = ['data:', 'blob:'];

test('a full tracking and blocking session makes no request outside the fixture hosts and the four sites', async () => {
  test.setTimeout(60_000);
  const fixture = readFileSync(new URL('./fixtures/instagram.html', import.meta.url), 'utf8');
  const stub = (title: string): string => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><p>${title}</p></body></html>`;
  const html = (body: string) => ({ status: 200, contentType: 'text/html; charset=utf-8', body });
  await context.route('https://a.example/**', (route) => route.fulfill(html(stub('A'))));
  await context.route('https://b.example/**', (route) => route.fulfill(html(stub('B'))));
  await context.route('https://www.instagram.com/**', (route) => route.fulfill(html(fixture)));
  await context.route('https://www.youtube.com/**', (route) => route.fulfill(html(stub('stub'))));
  await context.route('https://x.com/**', (route) => route.fulfill(html(stub('X'))));

  interface Seen {
    url: string;
    /** 'worker', an extension page, or a web page. */
    from: 'worker' | 'extension' | 'web';
  }
  const seen: Seen[] = [];
  const onRequest = (request: Request): void => {
    let from: Seen['from'] = 'worker';
    try {
      from = request.frame().url().startsWith(`chrome-extension://${extensionId}/`) ? 'extension' : 'web';
    } catch {
      // Playwright throws for requests that belong to no frame: the service worker's.
    }
    seen.push({ url: request.url(), from });
  };
  context.on('request', onRequest);
  try {
    await worker.evaluate(() => chrome.storage.local.clear());
    const a = await context.newPage();
    await a.goto('https://a.example/');
    await a.waitForTimeout(3000);
    const b = await context.newPage();
    await b.goto('https://b.example/');
    const ig = await context.newPage();
    await ig.goto('https://www.instagram.com/');
    await ig.evaluate(() => document.getElementById('open-reels-code')?.click());
    const shorts = await context.newPage();
    await shorts.goto('https://www.youtube.com/shorts/dQw4w9WgXcQ');
    const x = await context.newPage();
    await x.goto('https://x.com/someuser/status/123/video/1');
    await expect.poll(() => x.url()).toBe('https://x.com/someuser/status/123');
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await expect(popup.locator('#app')).not.toBeEmpty();
    const dash = await context.newPage();
    await dash.goto(`chrome-extension://${extensionId}/src/dashboard/index.html#settings`);
    await dash.locator('#idle-120').click();
    await expect(dash.locator('#idle-120')).toHaveAttribute('aria-checked', 'true');
    const [download] = await Promise.all([dash.waitForEvent('download'), dash.locator('#export-json').click()]);
    expect(download.suggestedFilename()).toMatch(/^dwell-export-/);
    await dash.waitForTimeout(500);
  } finally {
    context.off('request', onRequest);
  }

  const hosts = [...new Set(seen.map((s) => new URL(s.url).host || new URL(s.url).protocol))].sort();
  const ownScheme = `chrome-extension://${extensionId}/`;
  const inert = (url: string): boolean => url.startsWith(ownScheme) || INERT.some((scheme) => url.startsWith(scheme));
  const outside = seen.filter(({ url }) => !inert(url) && !(new URL(url).protocol === 'https:' && ALLOWED_HOSTS.has(new URL(url).host)));
  expect(outside, `requests outside the allowlist; hosts seen: ${hosts.join(', ')}`).toEqual([]);
  const fromOurs = seen.filter((s) => s.from !== 'web' && !inert(s.url));
  expect(fromOurs, `extension-originated requests to anything but chrome-extension:, data: or blob:; hosts seen: ${hosts.join(', ')}`).toEqual([]);
  expect(seen.some((s) => s.url.startsWith('https://a.example/'))).toBe(true);
});
