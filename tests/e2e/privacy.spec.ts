import { chromium, expect, test, type BrowserContext, type Worker } from '@playwright/test';
import { existsSync } from 'node:fs';
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
