import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classify } from '../../src/blocker/patterns.ts';
import { DEFAULT_SETTINGS, type Settings } from '../../src/store/schema.ts';
import { tapReel, tapShort } from './fixtures/taps.ts';

const dist = fileURLToPath(new URL('../../dist', import.meta.url));
const fixture = readFileSync(new URL('./fixtures/instagram.html', import.meta.url), 'utf8');
const SHORT_ID = 'dQw4w9WgXcQ';
const IG = 'https://www.instagram.com';
const YT = 'https://www.youtube.com';
const RULESETS = ['instagram-reels', 'youtube-shorts', 'facebook-reels', 'instagram-explore'] as const;
const TOGGLE: Record<(typeof RULESETS)[number], keyof Settings['blockers']> = {
  'instagram-reels': 'instagramReels',
  'youtube-shorts': 'youtubeShorts',
  'facebook-reels': 'facebookReels',
  'instagram-explore': 'instagramExplore',
};

interface StaticRule {
  id: number;
  condition: { regexFilter: string; isUrlFilterCaseSensitive?: boolean };
}

let context: BrowserContext;
let worker: Worker;
/** Every URL the fixture routes were asked for: a blocked path here means DNR did not redirect it. */
const served: string[] = [];

test.beforeAll(async () => {
  if (!existsSync(`${dist}/manifest.json`)) throw new Error('dist/ missing: run npm run build first');
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await context.route(`${IG}/**`, async (route) => {
    served.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture });
  });
  await context.route('https://www.youtube.com/**', async (route) => {
    served.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>stub</title>' });
  });
});

test.afterAll(async () => {
  await context?.close();
});

test.beforeEach(async () => {
  served.length = 0;
  await worker.evaluate(async () => {
    await chrome.storage.local.clear();
    const g = globalThis as unknown as { dwellSeen?: unknown[] };
    if (g.dwellSeen === undefined) {
      const seen: unknown[] = [];
      g.dwellSeen = seen;
      chrome.runtime.onMessage.addListener((message: unknown) => {
        seen.push(message);
      });
    }
    g.dwellSeen.length = 0;
  });
});

async function setBlockers(patch: Partial<Settings['blockers']>): Promise<void> {
  const settings: Settings = { ...DEFAULT_SETTINGS, blockers: { ...DEFAULT_SETTINGS.blockers, ...patch } };
  await worker.evaluate(async (value) => chrome.storage.local.set({ settings: value }), settings);
}

async function messages(): Promise<unknown[]> {
  return worker.evaluate(() => [...((globalThis as unknown as { dwellSeen?: unknown[] }).dwellSeen ?? [])]);
}

function path(page: Page): string {
  return new URL(page.url()).pathname;
}

test('every DNR rule compiles under Chrome RE2 limits and matches what the classifier blocks', async () => {
  const rules = Object.fromEntries(
    RULESETS.map((id) => [id, JSON.parse(readFileSync(`${dist}/src/blocker/rulesets/${id}.json`, 'utf8')) as StaticRule[]]),
  );
  const samples = [
    `${IG}/reels/abc/`,
    `${IG}/someone/reels/`,
    `${IG}/explore/`,
    `${IG}/p/abc/`,
    `https://www.youtube.com/shorts/${SHORT_ID}`,
    `https://m.youtube.com/shorts/${SHORT_ID}?feature=share`,
    `https://youtube.com/@someone/shorts/${SHORT_ID}`,
    'https://www.youtube.com/shorts/dQw4w9WgXcQx',
    `https://www.youtube.com/watch?v=${SHORT_ID}`,
    'https://www.facebook.com/reel/123',
    'https://m.facebook.com/someone/reels/',
    'https://www.facebook.com/watch/',
  ];
  const expected = samples.map((url) =>
    RULESETS.filter((id) => classify(url, { ...noBlockers(), [TOGGLE[id]]: true }) !== null).sort(),
  );

  const outcome = await worker.evaluate(
    async ({ rules, samples }) => {
      const unsupported: string[] = [];
      for (const [id, list] of Object.entries(rules)) {
        for (const rule of list) {
          const { isSupported, reason } = await chrome.declarativeNetRequest.isRegexSupported({
            regex: rule.condition.regexFilter,
            isCaseSensitive: rule.condition.isUrlFilterCaseSensitive === true,
          });
          if (!isSupported) unsupported.push(`${id}#${rule.id}: ${String(reason)}`);
        }
      }
      await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: ['instagram-explore'] });
      const matched: string[][] = [];
      for (const url of samples) {
        const { matchedRules } = await chrome.declarativeNetRequest.testMatchOutcome({ url, type: 'main_frame' });
        matched.push([...new Set(matchedRules.map((r) => r.rulesetId))].sort());
      }
      // A Reel or Short embedded as a frame in another page is left alone (ADR-3).
      const framed = await Promise.all(
        samples.map((url) => chrome.declarativeNetRequest.testMatchOutcome({ url, type: 'sub_frame' })),
      );
      await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: ['instagram-explore'] });
      return { unsupported, matched, framed: framed.flatMap((o) => o.matchedRules.map((r) => r.rulesetId)) };
    },
    { rules, samples },
  );

  expect(outcome.unsupported).toEqual([]);
  expect(outcome.framed).toEqual([]);
  expect(samples.map((url, i) => ({ url, rulesets: outcome.matched[i] }))).toEqual(
    samples.map((url, i) => ({ url, rulesets: expected[i] })),
  );
});

function noBlockers(): Settings['blockers'] {
  return { instagramReels: false, youtubeShorts: false, facebookReels: false, instagramExplore: false };
}

test('a hard load of a Shorts URL is redirected by DNR to the watch page for the same id', async () => {
  const page = await context.newPage();
  const committed: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) committed.push(frame.url());
  });
  await page.goto(`https://www.youtube.com/shorts/${SHORT_ID}`, { waitUntil: 'commit' });
  await expect.poll(() => page.url()).toBe(`https://www.youtube.com/watch?v=${SHORT_ID}`);
  // The #dwell marker is only ever added by the DNR rule, and the Shorts request never left Chrome.
  expect(committed[0]).toBe(`https://www.youtube.com/watch?v=${SHORT_ID}#dwell=youtube`);
  expect(served).toEqual([`https://www.youtube.com/watch?v=${SHORT_ID}`]);
  await page.close();
});

test('a hard load of an Instagram Reel lands on the home page, counted once, marker stripped', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/reels/abc/`);
  await expect.poll(() => page.url()).toBe(`${IG}/`);
  expect(served.some((url) => url.includes('/reels/'))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.dataset.hashAtHead)).toBe('');
  await expect.poll(messages).toEqual([{ type: 'blocked', site: 'instagram' }]);
  await page.reload();
  await page.waitForTimeout(300);
  expect(await messages()).toEqual([{ type: 'blocked', site: 'instagram' }]);
  await page.close();
});

test('an in-page Reel route change is cancelled before it commits and counted with no marker', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');
  await expect(page.locator('#nav-reels')).toBeHidden();
  await expect(page.locator('#profile-reels')).toBeVisible();

  expect(await tapReel(page)).toEqual({ path: '/', added: 0 });
  await page.waitForTimeout(600);
  expect(page.url()).toBe(`${IG}/`);
  await expect.poll(messages).toEqual([{ type: 'blocked', site: 'instagram' }]);
  await page.close();
});

test('a landing with the marker is stripped before the page runs a script', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/#dwell=instagram`);
  expect(await page.evaluate(() => document.documentElement.dataset.hashAtHead)).toBe('');
  expect(page.url()).toBe(`${IG}/`);
  await expect.poll(messages).toEqual([{ type: 'blocked', site: 'instagram' }]);

  await page.goto(`${IG}/#dwell=youtube`);
  expect(await page.evaluate(() => location.hash)).toBe('#dwell=youtube');
  await page.waitForTimeout(300);
  expect(await messages()).toHaveLength(1);
  await page.close();
});

test('with instagramReels off a landing on the marker is stripped and not counted', async () => {
  await setBlockers({ instagramReels: false });
  const page = await context.newPage();
  await page.goto(`${IG}/#dwell=instagram`);
  expect(await page.evaluate(() => document.documentElement.dataset.hashAtHead)).toBe('');
  expect(page.url()).toBe(`${IG}/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'off');
  await page.waitForTimeout(300);
  expect(await messages()).toEqual([]);
  await page.close();
});

test('with instagramReels off the same tap lands on /reels/abc untouched, and turning it on redirects', async () => {
  await setBlockers({ instagramReels: false });
  const page = await context.newPage();
  await page.goto(`${IG}/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'off');
  await expect(page.locator('#nav-reels')).toBeVisible();

  expect(await tapReel(page)).toEqual({ path: '/reels/abc', added: 1 });
  await page.waitForTimeout(600);
  expect(path(page)).toBe('/reels/abc');
  expect(await messages()).toEqual([]);

  await setBlockers({ instagramReels: true });
  await page.waitForURL(`${IG}/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');
  expect(await page.evaluate(() => document.documentElement.dataset.hashAtHead)).toBe('');
  await expect.poll(messages).toEqual([{ type: 'blocked', site: 'instagram' }]);
  await page.close();
});

test('toggling the blocker in storage flips the hider attribute without a reload', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');
  await setBlockers({ instagramReels: false });
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'off');
  await expect(page.locator('#nav-reels')).toBeVisible();
  await setBlockers({ instagramReels: true });
  await expect(page.locator('#nav-reels')).toBeHidden();
  await page.close();
});

test('the loop guard stops after 2 redirects in 5 s on the same tab', async () => {
  await setBlockers({ instagramReels: false });
  const page = await context.newPage();
  await page.goto(`${IG}/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'off');
  await tapReel(page);
  await page.evaluate(() => sessionStorage.setItem('dwell:redirects', JSON.stringify([Date.now(), Date.now()])));
  await setBlockers({ instagramReels: true });
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');
  await page.waitForTimeout(600);
  expect(path(page)).toBe('/reels/abc');
  await page.close();
});

test('the loop guard lets the third Shorts tap within 5 s through instead of cancelling it', async () => {
  const page = await context.newPage();
  await page.goto(`${YT}/`);
  for (const id of ['AAAAAAAAAAA', 'BBBBBBBBBBB']) {
    const from = path(page);
    expect(await tapShort(page, id)).toEqual({ path: from, added: 0 });
    await expect.poll(() => page.url()).toBe(`${YT}/watch?v=${id}`);
  }
  expect(await tapShort(page, 'CCCCCCCCCCC')).toEqual({ path: '/shorts/CCCCCCCCCCC', added: 1 });
  await page.waitForTimeout(600);
  expect(page.url()).toBe(`${YT}/shorts/CCCCCCCCCCC`);
  const landing = { type: 'blocked', site: 'youtube' };
  await expect.poll(messages).toEqual([landing, landing]);
  await page.close();
});

test('media reports playing and paused, and nothing else', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/`);
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.getContext('2d')?.fillRect(0, 0, 8, 8);
    const video = document.getElementById('clip') as HTMLVideoElement;
    video.srcObject = canvas.captureStream(5);
    await video.play();
  });
  await expect.poll(messages).toEqual([{ type: 'media', playing: true }]);
  await page.evaluate(() => (document.getElementById('clip') as HTMLVideoElement).pause());
  await expect.poll(messages).toEqual([
    { type: 'media', playing: true },
    { type: 'media', playing: false },
  ]);
  await page.close();
});
