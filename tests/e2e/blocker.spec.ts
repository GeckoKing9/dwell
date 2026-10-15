import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classify } from '../../src/blocker/patterns.ts';
import { DEFAULT_SETTINGS, type Settings } from '../../src/store/schema.ts';
import { swipeTo, tapFeed, tapReel, tapShort } from './fixtures/taps.ts';

const dist = fileURLToPath(new URL('../../dist', import.meta.url));
const fixture = readFileSync(new URL('./fixtures/instagram.html', import.meta.url), 'utf8');
const fbFixture = readFileSync(new URL('./fixtures/facebook.html', import.meta.url), 'utf8');
const SHORT_ID = 'dQw4w9WgXcQ';
const CODE = 'DeewiSPpCrm';
const IG = 'https://www.instagram.com';
const YT = 'https://www.youtube.com';
const FB = 'https://www.facebook.com';
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
  await context.route(`${FB}/**`, async (route) => {
    served.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fbFixture });
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

/** Only the block reports: every content script also reports its media state on load. */
async function blocked(): Promise<unknown[]> {
  return (await messages()).filter((m) => (m as { type?: string }).type === 'blocked');
}

function path(page: Page): string {
  return new URL(page.url()).pathname;
}

/**
 * The worker reconciles the DNR rulesets when an extension page saves settings; `setBlockers` writes
 * storage directly, so a test that needs hard loads to follow the toggles sets the rulesets here too.
 */
async function setReelRulesets(enabled: boolean): Promise<void> {
  const ids = ['instagram-reels', 'youtube-shorts', 'facebook-reels'];
  await worker.evaluate(
    async ({ ids, enabled }) =>
      chrome.declarativeNetRequest.updateEnabledRulesets(enabled ? { enableRulesetIds: ids } : { disableRulesetIds: ids }),
    { ids, enabled },
  );
}

/** The events the Facebook fixture's own listeners received. */
async function heard(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window as unknown as { heard: string[] }).heard]);
}

async function scrollTop(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((el) => el.scrollTop);
}

/** Wheels over the viewer, then presses ArrowDown, PageDown and a plain letter as a control. */
async function tryToAdvance(page: Page): Promise<void> {
  await page.mouse.move(100, 400);
  await page.mouse.wheel(0, 400);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('PageDown');
  await page.keyboard.press('a');
}

test('every DNR rule compiles under Chrome RE2 limits and matches what the classifier blocks', async () => {
  const rules = Object.fromEntries(
    RULESETS.map((id) => [id, JSON.parse(readFileSync(`${dist}/src/blocker/rulesets/${id}.json`, 'utf8')) as StaticRule[]]),
  );
  const samples = [
    `${IG}/reels/abc/`,
    `${IG}/reels/`,
    `${IG}/reels/${CODE}/`,
    `https://instagram.com/someone/reel/${CODE}/?igsh=x`,
    `${IG}/someone/reels/`,
    `${IG}/explore/`,
    `${IG}/p/abc/`,
    `${IG}/p/${CODE}/`,
    `https://www.youtube.com/shorts/${SHORT_ID}`,
    `https://m.youtube.com/shorts/${SHORT_ID}?feature=share`,
    `https://youtube.com/@someone/shorts/${SHORT_ID}`,
    'https://www.youtube.com/shorts/dQw4w9WgXcQx',
    `https://www.youtube.com/watch?v=${SHORT_ID}`,
    'https://www.facebook.com/reel/123',
    'https://www.facebook.com/reels/',
    'https://m.facebook.com/reel?s=1',
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

test('a hard load of a single Instagram Reel lands on its post page, counted once, marker stripped', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/reels/${CODE}/`);
  await expect.poll(() => page.url()).toBe(`${IG}/p/${CODE}/`);
  expect(served).toEqual([`${IG}/p/${CODE}/`]);
  expect(await page.evaluate(() => document.documentElement.dataset.hashAtHead)).toBe('');
  await expect.poll(blocked).toEqual([{ type: 'blocked', site: 'instagram' }]);
  await page.close();
});

test('a hard load of the Instagram Reels feed lands on the home page, counted once, marker stripped', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/reels/`);
  await expect.poll(() => page.url()).toBe(`${IG}/`);
  expect(served.some((url) => url.includes('/reels/'))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.dataset.hashAtHead)).toBe('');
  await expect.poll(blocked).toEqual([{ type: 'blocked', site: 'instagram' }]);
  await page.reload();
  await page.waitForTimeout(300);
  expect(await blocked()).toEqual([{ type: 'blocked', site: 'instagram' }]);
  await page.close();
});

test('an in-page move to the Reels feed is cancelled before it commits and counted with no marker', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');
  await expect(page.locator('#nav-reels')).toBeHidden();
  await expect(page.locator('#profile-reels')).toBeVisible();

  expect(await tapFeed(page)).toEqual({ path: '/', added: 0 });
  await page.waitForTimeout(600);
  expect(page.url()).toBe(`${IG}/`);
  await expect.poll(blocked).toEqual([{ type: 'blocked', site: 'instagram' }]);
  await page.close();
});

test('an in-page tap on a single Instagram Reel lands on its post page, counted once on landing', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');

  expect(await tapReel(page)).toEqual({ path: '/', added: 0 });
  await expect.poll(() => page.url()).toBe(`${IG}/p/${CODE}/`);
  expect(served.some((url) => url.includes('/reel/'))).toBe(false);
  await expect.poll(blocked).toEqual([{ type: 'blocked', site: 'instagram' }]);
  await page.waitForTimeout(600);
  expect(await blocked()).toHaveLength(1);
  await page.close();
});

test('a profile Reels grid loads untouched', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/someone/reels/`);
  await page.waitForTimeout(600);
  expect(path(page)).toBe('/someone/reels/');
  expect(await blocked()).toEqual([]);
  await page.close();
});

test('a Facebook viewer that moves to the next reel ends back on the first one, counted once', async () => {
  const page = await context.newPage();
  await page.goto(`${FB}/reel/111`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-facebook', 'on');

  expect(await swipeTo(page, '/reel/222')).toEqual({ path: '/reel/111', added: 0 });
  // The first reel is loaded again, so whatever the viewer drew for the next one is gone.
  await expect.poll(() => served).toEqual([`${FB}/reel/111`, `${FB}/reel/111`]);
  await expect.poll(() => page.url()).toBe(`${FB}/reel/111`);
  expect(await page.evaluate(() => document.documentElement.dataset.hashAtHead)).toBe('');
  await expect.poll(blocked).toEqual([{ type: 'blocked', site: 'facebook' }]);
  await page.waitForTimeout(600);
  expect(await blocked()).toHaveLength(1);
  await page.close();
});

test('a Facebook viewer move is still cancelled, and counted in place, when the loop guard refuses the redirect', async () => {
  const page = await context.newPage();
  await page.goto(`${FB}/reel/111`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-facebook', 'on');
  await page.evaluate(() => sessionStorage.setItem('dwell:redirects', JSON.stringify([Date.now(), Date.now()])));

  expect(await swipeTo(page, '/reel/222')).toEqual({ path: '/reel/111', added: 0 });
  await page.waitForTimeout(600);
  expect(page.url()).toBe(`${FB}/reel/111`);
  expect(served).toEqual([`${FB}/reel/111`]);
  await expect.poll(blocked).toEqual([{ type: 'blocked', site: 'facebook' }]);
  await page.close();
});

test('on a Facebook viewer the wheel and arrow keys never reach the page, while a comments panel still scrolls', async () => {
  const page = await context.newPage();
  await page.goto(`${FB}/reel/111`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-facebook', 'on');

  await tryToAdvance(page);
  await expect.poll(() => heard(page)).toEqual(['key:a']);
  expect(await scrollTop(page, '#viewer')).toBe(0);

  await page.mouse.move(1180, 100);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => heard(page)).toEqual(['key:a', 'wheel:comments']);
  await expect.poll(() => scrollTop(page, '#comments')).toBeGreaterThan(0);
  expect(path(page)).toBe('/reel/111');
  expect(await blocked()).toEqual([]);
  await page.close();
});

test('a comments panel at its end does not pass the wheel on to the viewer', async () => {
  const page = await context.newPage();
  await page.goto(`${FB}/reel/111`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-facebook', 'on');
  await page.locator('#comments').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });

  await page.mouse.move(1180, 100);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(300);
  expect(await heard(page)).toEqual([]);
  expect(await scrollTop(page, '#viewer')).toBe(0);
  await page.close();
});

test('with every blocker off, Reels, viewer moves and the wheel all pass untouched', async () => {
  await setBlockers(noBlockers());
  await setReelRulesets(false);
  const ig = await context.newPage();
  await ig.goto(`${IG}/reels/${CODE}/`);
  await expect(ig.locator('html')).toHaveAttribute('data-dwell-instagram', 'off');
  expect(path(ig)).toBe(`/reels/${CODE}/`);
  expect(await tapFeed(ig)).toEqual({ path: '/reels/', added: 1 });
  await ig.close();

  const fb = await context.newPage();
  await fb.goto(`${FB}/reels/`);
  await expect(fb.locator('html')).toHaveAttribute('data-dwell-facebook', 'off');
  expect(path(fb)).toBe('/reels/');
  await fb.goto(`${FB}/reel/111`);
  await expect(fb.locator('html')).toHaveAttribute('data-dwell-facebook', 'off');
  expect(await swipeTo(fb, '/reel/222')).toEqual({ path: '/reel/222', added: 1 });
  await tryToAdvance(fb);
  await expect.poll(() => heard(fb)).toEqual(['wheel:viewer', 'key:ArrowDown', 'key:PageDown', 'key:a']);
  await fb.waitForTimeout(600);
  expect(path(fb)).toBe('/reel/222');
  expect(await blocked()).toEqual([]);
  await fb.close();

  await setReelRulesets(true);
});

test('a landing with the marker is stripped before the page runs a script', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/#dwell=instagram`);
  expect(await page.evaluate(() => document.documentElement.dataset.hashAtHead)).toBe('');
  expect(page.url()).toBe(`${IG}/`);
  await expect.poll(blocked).toEqual([{ type: 'blocked', site: 'instagram' }]);

  await page.goto(`${IG}/#dwell=youtube`);
  expect(await page.evaluate(() => location.hash)).toBe('#dwell=youtube');
  await page.waitForTimeout(300);
  expect(await blocked()).toHaveLength(1);
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
  expect(await blocked()).toEqual([]);
  await page.close();
});

test('with instagramReels off the same tap lands on the Reel untouched, and turning it on rewrites it', async () => {
  await setBlockers({ instagramReels: false });
  const page = await context.newPage();
  await page.goto(`${IG}/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'off');
  await expect(page.locator('#nav-reels')).toBeVisible();

  expect(await tapReel(page)).toEqual({ path: `/reel/${CODE}/`, added: 1 });
  await page.waitForTimeout(600);
  expect(path(page)).toBe(`/reel/${CODE}/`);
  expect(await blocked()).toEqual([]);

  await setBlockers({ instagramReels: true });
  await page.waitForURL(`${IG}/p/${CODE}/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');
  expect(await page.evaluate(() => document.documentElement.dataset.hashAtHead)).toBe('');
  await expect.poll(blocked).toEqual([{ type: 'blocked', site: 'instagram' }]);
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
  expect(path(page)).toBe(`/reel/${CODE}/`);
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
  await expect.poll(blocked).toEqual([landing, landing]);
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
  await expect.poll(messages).toEqual([
    { type: 'media', playing: false },
    { type: 'media', playing: true },
  ]);
  await page.evaluate(() => (document.getElementById('clip') as HTMLVideoElement).pause());
  await expect.poll(messages).toEqual([
    { type: 'media', playing: false },
    { type: 'media', playing: true },
    { type: 'media', playing: false },
  ]);
  await page.close();
});
