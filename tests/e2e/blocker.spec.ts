import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classify } from '../../src/blocker/patterns.ts';
import { DEFAULT_SETTINGS, type Settings } from '../../src/store/schema.ts';
import { routeTo, swipeTo, tapFeed, tapLink, tapPhoto, tapReel, tapReelsCode, tapShort, tapUserReel, tapVideo } from './fixtures/taps.ts';

const dist = fileURLToPath(new URL('../../dist', import.meta.url));
const fixture = readFileSync(new URL('./fixtures/instagram.html', import.meta.url), 'utf8');
const igPostFixture = readFileSync(new URL('./fixtures/instagram-post.html', import.meta.url), 'utf8');
/** Instagram's full single-post page: `/p/<code>/` or `/reel/<code>/`, also under a profile. */
const IG_POST_PATH = /^\/(?:[^/]+\/)?(?:p|reel)\/[^/]+\/?$/;
const fbFixture = readFileSync(new URL('./fixtures/facebook.html', import.meta.url), 'utf8');
const xFixture = readFileSync(new URL('./fixtures/x.html', import.meta.url), 'utf8');
const SHORT_ID = 'dQw4w9WgXcQ';
const CODE = 'DeewiSPpCrm';
const IG = 'https://www.instagram.com';
const YT = 'https://www.youtube.com';
const FB = 'https://www.facebook.com';
const X = 'https://x.com';
const RULESETS = ['instagram-reels', 'youtube-shorts', 'facebook-reels', 'x-videos', 'instagram-explore'] as const;
const TOGGLE: Record<(typeof RULESETS)[number], keyof Settings['blockers']> = {
  'instagram-reels': 'instagramReels',
  'youtube-shorts': 'youtubeShorts',
  'facebook-reels': 'facebookReels',
  'x-videos': 'xVideos',
  'instagram-explore': 'instagramExplore',
};

interface StaticRule {
  id: number;
  action: { type: string };
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
    const url = route.request().url();
    served.push(url);
    const body = IG_POST_PATH.test(new URL(url).pathname) ? igPostFixture : fixture;
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });
  await context.route('https://www.youtube.com/**', async (route) => {
    served.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>stub</title>' });
  });
  await context.route(`${FB}/**`, async (route) => {
    served.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fbFixture });
  });
  await context.route(`${X}/**`, async (route) => {
    served.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: xFixture });
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
async function setReelRulesets(enabled: boolean, ids = ['instagram-reels', 'youtube-shorts', 'facebook-reels', 'x-videos']): Promise<void> {
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

/** The keys a window listener the Facebook fixture added after the guard started received. */
async function heardOnWindow(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window as unknown as { heardOnWindow: string[] }).heardOnWindow]);
}

/** Leaves a value on the page that only survives while no reload happens. */
async function markPage(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.dataset.draft = 'kept';
  });
}

async function pageMark(page: Page): Promise<string | undefined> {
  return page.evaluate(() => document.documentElement.dataset.draft);
}

async function hiddenMarks(page: Page): Promise<number> {
  return page.locator('[data-dwell-hidden]').count();
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
    `${IG}/reel/${CODE}/`,
    `https://instagram.com/someone/reel/${CODE}/?igsh=x`,
    `https://instagram.com/someone/reels/${CODE}/?igsh=x`,
    `${IG}/reel/`,
    `${IG}/explore/reel/${CODE}/`,
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
    `${X}/someuser/status/123/video/1`,
    `${X}/i/status/1234567890123456789/video/2?s=20`,
    `${X}/Some_User/STATUS/123/Video/1/`,
    `${X}/${'a'.repeat(20)}/status/${'9'.repeat(25)}/video/1`,
    `${X}/someuser/status/${'9'.repeat(26)}/video/1`,
    `${X}/someuser/status/123`,
    `${X}/someuser/status/123/photo/1`,
    `${X}/someuser/status/123/video/1/likes`,
    `${X}/home`,
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
      // An allow rule that wins lets the request through: only redirects count as a match.
      const redirects = (r: { rulesetId: string; ruleId: number }): boolean =>
        rules[r.rulesetId]?.find((rule) => rule.id === r.ruleId)?.action.type === 'redirect';
      for (const url of samples) {
        const { matchedRules } = await chrome.declarativeNetRequest.testMatchOutcome({ url, type: 'main_frame' });
        matched.push([...new Set(matchedRules.filter(redirects).map((r) => r.rulesetId))].sort());
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
  return { instagramReels: false, youtubeShorts: false, facebookReels: false, xVideos: false, instagramExplore: false };
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

test('a hard load of the Instagram Reels scroller on one Reel lands on its post page, counted once, marker stripped', async () => {
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

test('a hard load of a single Instagram Reel loads untouched and uncounted: Instagram’s own post page', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/reel/${CODE}/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');
  await page.waitForTimeout(600);
  expect(path(page)).toBe(`/reel/${CODE}/`);
  expect(served).toEqual([`${IG}/reel/${CODE}/`]);
  expect(await blocked()).toEqual([]);
  await page.close();
});

test('an in-app move to the Reels feed lands on the home page by a real load, counted once on landing', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/someuser/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');
  await expect(page.locator('#nav-reels')).toBeHidden();
  await expect(page.locator('#profile-reels')).toBeVisible();
  await markPage(page);

  expect(await tapFeed(page)).toEqual({ path: '/someuser/', added: 0 });
  // A cancel alone would leave the app drawing the feed under the old URL: the home page is loaded instead.
  await expect.poll(() => page.url()).toBe(`${IG}/`);
  expect(served).toEqual([`${IG}/someuser/`, `${IG}/`]);
  expect(await pageMark(page)).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.dataset.hashAtHead)).toBe('');
  await expect.poll(blocked).toEqual([{ type: 'blocked', site: 'instagram' }]);
  await page.waitForTimeout(600);
  expect(await blocked()).toHaveLength(1);
  await page.close();
});

test('an in-app move to the Reels feed from the home page reloads the home page', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');
  await markPage(page);

  expect(await tapFeed(page)).toEqual({ path: '/', added: 0 });
  await expect.poll(() => served).toEqual([`${IG}/`, `${IG}/`]);
  await expect.poll(() => page.url()).toBe(`${IG}/`);
  expect(await pageMark(page)).toBeUndefined();
  await expect.poll(blocked).toEqual([{ type: 'blocked', site: 'instagram' }]);
  await page.close();
});

test('an in-app tap on a single Reel, also under a profile, opens in the pop-up untouched and uncounted', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');

  expect(await tapReel(page)).toEqual({ path: `/reel/${CODE}/`, added: 1 });
  await expect(page.locator('[role="dialog"]')).toBeVisible();
  await page.goto(`${IG}/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');
  expect(await tapUserReel(page)).toEqual({ path: `/someuser/reel/${CODE}/`, added: 1 });
  await page.waitForTimeout(600);
  expect(path(page)).toBe(`/someuser/reel/${CODE}/`);
  expect(served).toEqual([`${IG}/`, `${IG}/`]);
  expect(await blocked()).toEqual([]);
  await page.close();
});

test('an in-app move to the Reels scroller on one Reel lands on its post page, counted once on landing', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');

  expect(await tapReelsCode(page)).toEqual({ path: '/', added: 0 });
  await expect.poll(() => page.url()).toBe(`${IG}/p/${CODE}/`);
  expect(served.some((url) => url.includes('/reels/'))).toBe(false);
  await expect.poll(blocked).toEqual([{ type: 'blocked', site: 'instagram' }]);
  await page.waitForTimeout(600);
  expect(await blocked()).toHaveLength(1);
  await page.close();
});

/**
 * Stands in for Instagram's router in the page: `go` records the call and opens the post in a pop-up, the
 * way Instagram's `content` target does; `root` says whether the page on screen hosts pop-ups.
 */
async function installRouter(page: Page, root: boolean): Promise<void> {
  await page.evaluate((isRoot) => {
    const w = window as unknown as { goCalls: unknown[]; require: (name: string) => unknown; openDialog: () => void };
    w.goCalls = [];
    w.require = (name: string) =>
      name === 'currentCometRouterInstance'
        ? {
            get_THIS_IS_NOT_WHAT_YOU_WANT: () => ({
              getCurrentRouterState: () => ({ main: { route: { isCometRootContainer: isRoot } } }),
              dispatcher: {
                go: (path: string, options: unknown) => {
                  w.goCalls.push([path, options]);
                  history.pushState({}, '', path);
                  w.openDialog();
                },
              },
            }),
          }
        : undefined;
  }, root);
}

async function pageState(page: Page): Promise<{ goCalls: unknown[]; siteHandledTap: boolean }> {
  return page.evaluate(() => {
    const w = window as unknown as { goCalls?: unknown[]; siteHandledTap?: boolean };
    return { goCalls: w.goCalls ?? [], siteHandledTap: w.siteHandledTap === true };
  });
}

test('a Reel tapped in search opens in Instagram\'s own pop-up through its router: no page load, nothing counted', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/explore/search/keyword/?q=hugo`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');
  await installRouter(page, true);
  await markPage(page);

  await page.locator('#search-reel').click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
  expect(path(page)).toBe('/p/EEEEE5/');
  expect(await pageState(page)).toEqual({ goCalls: [['/p/EEEEE5/', { target: 'content' }]], siteHandledTap: false });
  expect(await pageMark(page)).toBe('kept');
  expect(served).toEqual([`${IG}/explore/search/keyword/?q=hugo`]);
  await page.waitForTimeout(400);
  expect(await blocked()).toEqual([]);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-dwell-opened'))).toBe(false);
  await page.close();
});

test('when the page under the tap hosts no pop-ups, the tap is Instagram\'s and its Reels feed still lands on the post page', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/explore/search/keyword/?q=hugo`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');
  await installRouter(page, false);
  await page.locator('#search-reel').click();
  await expect.poll(() => page.url()).toBe(`${IG}/p/EEEEE5/`);
  expect(served).toContain(`${IG}/p/EEEEE5/`);
  await page.close();
});

test('with no router on the page (signed out, or Instagram changed it), a tap is left to Instagram', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/explore/search/keyword/?q=hugo`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');
  await page.locator('#search-reel').click();
  await expect.poll(() => page.url()).toBe(`${IG}/p/EEEEE5/`);
  expect((await pageState(page)).goCalls).toEqual([]);
  await page.close();
});

test('a Ctrl-click, a click a page script fakes, and every tap with instagramReels off stay Instagram\'s', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/explore/search/keyword/?q=hugo`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');
  await installRouter(page, true);

  await page.locator('#tile-1').click({ modifiers: ['Control'] });
  expect(await pageState(page)).toEqual({ goCalls: [], siteHandledTap: true });

  await page.evaluate(() => {
    (window as unknown as { siteHandledTap: boolean }).siteHandledTap = false;
    document.getElementById('tile-2')?.click();
  });
  expect(await pageState(page)).toEqual({ goCalls: [], siteHandledTap: true });

  await page.goto(`${IG}/explore/search/keyword/?q=hugo`);
  await setBlockers({ instagramReels: false });
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'off');
  await installRouter(page, true);
  await page.locator('#tile-4').click();
  expect(await pageState(page)).toEqual({ goCalls: [], siteHandledTap: true });
  await page.close();
});

test('a page script firing the bridge\'s event can open nothing but a post path', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');
  await installRouter(page, true);
  const answers = await page.evaluate(() =>
    ['https://evil.example/', '/reel/EEEEE5/', '/p/EEEEE5/?next=/evil', '/p/EEEEE5/'].map((detail) => {
      document.dispatchEvent(new CustomEvent('dwell:open-post', { detail }));
      return document.documentElement.getAttribute('data-dwell-opened');
    }),
  );
  expect(answers).toEqual(['refused', 'refused', 'refused', 'opened']);
  expect((await pageState(page)).goCalls).toEqual([['/p/EEEEE5/', { target: 'content' }]]);
  await page.close();
});

test('a full single-post page hides the "More posts" that load under the post, and nothing of the post', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/p/${CODE}/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');
  await expect(page.locator('#more-grid')).toBeAttached();

  for (const id of ['#separator', '#more-heading', '#more-grid', '#more-footer']) await expect(page.locator(id)).toBeHidden();
  for (const id of ['#post-video', '#comments', '#post-time']) await expect(page.locator(id)).toBeVisible();
  expect(await hiddenMarks(page)).toBe(4);
  await page.close();
});

test('a sign-up prompt or any pop-up without the post in it does not bring the "More posts" back', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/p/${CODE}/`);
  await expect(page.locator('#more-grid')).toBeAttached();
  await expect(page.locator('#more-grid')).toBeHidden();

  await page.evaluate(() => {
    const prompt = document.createElement('div');
    prompt.setAttribute('role', 'dialog');
    prompt.innerHTML = '<img src="data:," alt=""><p>Never miss a post</p><a href="/accounts/emailsignup/">Sign up</a>';
    document.body.append(prompt);
  });
  await page.waitForTimeout(300);
  await expect(page.locator('#more-grid')).toBeHidden();
  expect(await hiddenMarks(page)).toBe(4);
  await page.close();
});

test('a move to a post address before its pop-up is drawn leaves the page behind it alone', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/someuser/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');

  // Instagram changes the address first and draws the pop-up afterwards; here it never does.
  await page.evaluate(() => history.pushState(null, '', '/p/AAAAA1/'));
  await page.waitForTimeout(800);
  expect(path(page)).toBe('/p/AAAAA1/');
  expect(await hiddenMarks(page)).toBe(0);
  for (const id of ['#grid', '#tile-4', '#clip']) await expect(page.locator(id)).toBeVisible();
  await page.close();
});

/** Opens the post from an Instagram page, as a search result does: the referrer and a page to go back to. */
async function openPostFromInstagram(page: Page): Promise<void> {
  await page.goto(`${IG}/explore/search/keyword/?q=hugo`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');
  await page.evaluate((code) => location.assign(`/p/${code}/`), CODE);
  await expect(page.locator('#post')).toHaveAttribute('data-dwell-post', '');
}

test('a video post loaded on its own page is shown the way Instagram\'s pop-up shows it', async () => {
  const page = await context.newPage();
  await openPostFromInstagram(page);

  await expect(page.locator('html')).toHaveAttribute('data-dwell-post-open', '');
  const box = await page.locator('#post').boundingBox();
  const view = page.viewportSize();
  expect(box).not.toBeNull();
  expect(view).not.toBeNull();
  if (box === null || view === null) return;
  expect(Math.round(box.height)).toBe(view.height - 48);
  expect(Math.round(box.y)).toBe(24);
  expect(Math.round(box.x + box.width / 2)).toBe(Math.round(view.width / 2));
  await expect(page.locator('[data-dwell-close]')).toBeVisible();
  await expect(page.locator('nav')).toHaveAttribute('data-dwell-dim', '');
  for (const id of ['#post-video', '#comments', '#post-time']) await expect(page.locator(id)).toBeVisible();
  await expect(page.locator('#more-grid')).toBeHidden();
  await page.close();
});

test('closing the pop-up goes back to the Instagram page it was opened from', async () => {
  const page = await context.newPage();
  await openPostFromInstagram(page);
  await page.locator('[data-dwell-close]').click();
  await expect.poll(() => path(page)).toBe('/explore/search/keyword/');
  await page.close();
});

test('Escape and a click on the dimmed area close it, a click inside the post does not', async () => {
  const page = await context.newPage();
  await openPostFromInstagram(page);
  await page.locator('#comments').click();
  await page.waitForTimeout(300);
  expect(path(page)).toBe(`/p/${CODE}/`);
  await page.keyboard.press('Escape');
  await expect.poll(() => path(page)).toBe('/explore/search/keyword/');

  await page.evaluate((code) => location.assign(`/p/${code}/`), CODE);
  await expect(page.locator('#post')).toHaveAttribute('data-dwell-post', '');
  await page.mouse.click(5, 300);
  await expect.poll(() => path(page)).toBe('/explore/search/keyword/');
  await page.close();
});

test('a post opened from another site has nothing to go back to: closing lifts the pop-up and stays', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/p/${CODE}/`);
  await expect(page.locator('#post')).toHaveAttribute('data-dwell-post', '');
  await page.locator('[data-dwell-close]').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-dwell-post-open', '');
  await expect(page.locator('[data-dwell-close]')).toHaveCount(0);
  expect(path(page)).toBe(`/p/${CODE}/`);
  await expect(page.locator('#more-grid')).toBeHidden();
  await page.waitForTimeout(400);
  await expect(page.locator('#post')).not.toHaveAttribute('data-dwell-post', '');
  await page.close();
});

test('a dialog Instagram opens from the pop-up (share, likes, the ... menu) stays bright and clickable', async () => {
  const page = await context.newPage();
  await openPostFromInstagram(page);
  await page.evaluate(() => {
    const portal = document.createElement('div');
    portal.id = 'portal';
    document.body.append(portal);
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.style.cssText = 'margin:40px;width:240px;height:120px;background:#fff';
    dialog.innerHTML = '<button id="share">Share</button>';
    dialog.querySelector('button')?.addEventListener('click', () => document.body.setAttribute('data-shared', 'yes'));
    // An open portal covers the window, as overlay containers do while a dialog is up.
    const portal = document.getElementById('portal');
    if (portal !== null) portal.style.cssText = 'position:fixed;inset:0;z-index:5';
    portal?.append(dialog);
  });
  await page.waitForTimeout(1500);
  await expect(page.locator('#portal')).not.toHaveAttribute('data-dwell-dim', '');
  await page.locator('#share').click();
  await expect(page.locator('body')).toHaveAttribute('data-shared', 'yes');
  expect(path(page)).toBe(`/p/${CODE}/`);
  await page.close();
});

test('Escape while typing a comment keeps the pop-up and the text', async () => {
  const page = await context.newPage();
  await openPostFromInstagram(page);
  await page.locator('#comment-box').fill('half a thought');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  expect(path(page)).toBe(`/p/${CODE}/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-post-open', '');
  await expect(page.locator('#comment-box')).toHaveValue('half a thought');
  await page.close();
});

test('a pop-up closed with nothing to go back to stays closed when Instagram redraws the video', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/p/${CODE}/`);
  await expect(page.locator('#post')).toHaveAttribute('data-dwell-post', '');
  await page.locator('[data-dwell-close]').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-dwell-post-open', '');
  await page.evaluate(() => {
    const media = document.getElementById('media');
    const video = document.getElementById('post-video');
    video?.remove();
    setTimeout(() => {
      const again = document.createElement('video');
      again.id = 'post-video';
      media?.append(again);
    }, 100);
  });
  await page.waitForTimeout(800);
  await expect(page.locator('html')).not.toHaveAttribute('data-dwell-post-open', '');
  await page.close();
});

test('opened in a new tab from Instagram, the first page of the tab: closing lifts the pop-up instead of a Back that goes nowhere', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/p/${CODE}/`, { referer: `${IG}/explore/` });
  await expect(page.locator('#post')).toHaveAttribute('data-dwell-post', '');
  expect(await page.evaluate(() => document.referrer)).toBe(`${IG}/explore/`);
  await page.locator('[data-dwell-close]').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-dwell-post-open', '');
  expect(path(page)).toBe(`/p/${CODE}/`);
  await page.close();
});

test('a window too narrow for the video beside the comments shows the page as Instagram drew it, and the pop-up again when widened', async () => {
  const page = await context.newPage();
  await openPostFromInstagram(page);
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(page.locator('html')).not.toHaveAttribute('data-dwell-post-open', '');
  await expect(page.locator('[data-dwell-close]')).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator('html')).toHaveAttribute('data-dwell-post-open', '');
  await page.close();
});

test('with instagramReels off a post page stays as Instagram drew it', async () => {
  const page = await context.newPage();
  await openPostFromInstagram(page);
  await setBlockers({ instagramReels: false });
  await expect(page.locator('html')).not.toHaveAttribute('data-dwell-post-open', '');
  await expect(page.locator('#post')).not.toHaveAttribute('data-dwell-post', '');
  await expect(page.locator('[data-dwell-close]')).toHaveCount(0);
  await expect(page.locator('[data-dwell-dim]')).toHaveCount(0);
  await page.close();
});

test('a post opened in the pop-up over a profile grid leaves the page behind it alone', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/someuser/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');

  expect(await tapLink(page, 'tile-1')).toEqual({ path: '/p/AAAAA1/', added: 1 });
  await expect(page.locator('[role="dialog"]')).toBeVisible();
  await page.waitForTimeout(600);
  expect(await hiddenMarks(page)).toBe(0);
  await expect(page.locator('[data-dwell-post], [data-dwell-close], [data-dwell-dim]')).toHaveCount(0);
  for (const id of ['#grid', '#tile-4', '#clip', '#open-feed']) await expect(page.locator(id)).toBeVisible();
  await page.close();
});

test('with instagramReels off the "More posts" stay, and turning it off on an open post shows them again', async () => {
  const page = await context.newPage();
  await page.goto(`${IG}/reel/${CODE}/`);
  await expect(page.locator('#more-grid')).toBeAttached();
  await expect(page.locator('#more-grid')).toBeHidden();

  await setBlockers({ instagramReels: false });
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'off');
  await expect(page.locator('#more-grid')).toBeVisible();
  expect(await hiddenMarks(page)).toBe(0);

  await page.goto(`${IG}/p/${CODE}/`);
  await expect(page.locator('#more-grid')).toBeAttached();
  await page.waitForTimeout(300);
  await expect(page.locator('#more-grid')).toBeVisible();
  expect(await hiddenMarks(page)).toBe(0);
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

test('a Facebook viewer pushed to the next reel is taken back to the first by Back, with no reload, counted once', async () => {
  const page = await context.newPage();
  await page.goto(`${FB}/reel/111`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-facebook', 'on');
  await markPage(page);

  expect(await routeTo(page, '/reel/222')).toEqual({ path: '/reel/222', added: 1 });
  await expect.poll(() => path(page)).toBe('/reel/111');
  // The site's own router drew the first reel again: what is on screen matches the URL.
  await expect(page.locator('#viewer')).toHaveAttribute('data-shown', '111');
  expect(await pageMark(page)).toBe('kept');
  expect(served).toEqual([`${FB}/reel/111`]);
  await expect.poll(blocked).toEqual([{ type: 'blocked', site: 'facebook' }]);
  await page.waitForTimeout(600);
  expect(path(page)).toBe('/reel/111');
  expect(await blocked()).toHaveLength(1);
  await page.close();
});

test('a Facebook viewer moved by replaceState is cancelled and the first reel loaded again, counted once', async () => {
  const page = await context.newPage();
  await page.goto(`${FB}/reel/111`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-facebook', 'on');

  expect(await routeTo(page, '/reel/222', 'replace')).toEqual({ path: '/reel/111', added: 0 });
  // The first reel is loaded again, so whatever the viewer drew for the next one is gone.
  await expect.poll(() => served).toEqual([`${FB}/reel/111`, `${FB}/reel/111`]);
  await expect.poll(() => page.url()).toBe(`${FB}/reel/111`);
  await expect(page.locator('#viewer')).toHaveAttribute('data-shown', '111');
  expect(await page.evaluate(() => document.documentElement.dataset.hashAtHead)).toBe('');
  await expect.poll(blocked).toEqual([{ type: 'blocked', site: 'facebook' }]);
  await page.waitForTimeout(600);
  expect(await blocked()).toHaveLength(1);
  await page.close();
});

test('a push the site then rewrites in place (router state, a tracking query) is still undone by Back, not reloaded', async () => {
  const page = await context.newPage();
  await page.goto(`${FB}/reel/111`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-facebook', 'on');
  await markPage(page);

  await page.evaluate(() => {
    const router = (window as unknown as { router: Record<'push' | 'replace', (path: string) => void> }).router;
    router.push('/reel/222');
    router.replace('/reel/222?s=feed');
  });
  await expect.poll(() => path(page)).toBe('/reel/111');
  await expect(page.locator('#viewer')).toHaveAttribute('data-shown', '111');
  expect(await pageMark(page)).toBe('kept');
  expect(served).toEqual([`${FB}/reel/111`]);
  await expect.poll(blocked).toEqual([{ type: 'blocked', site: 'facebook' }]);
  await page.close();
});

test('a third viewer push within 5 s is not undone: it is cancelled and the first reel loaded again', async () => {
  const page = await context.newPage();
  await page.goto(`${FB}/reel/111`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-facebook', 'on');

  for (let i = 0; i < 2; i += 1) {
    // The push commits; after the first undo it replaces the forward entry, so history does not grow.
    expect((await routeTo(page, '/reel/222')).path).toBe('/reel/222');
    await expect.poll(() => path(page)).toBe('/reel/111');
    await expect(page.locator('#viewer')).toHaveAttribute('data-shown', '111');
  }
  expect(served).toEqual([`${FB}/reel/111`]);

  expect(await routeTo(page, '/reel/222')).toEqual({ path: '/reel/111', added: 0 });
  await expect.poll(() => served).toEqual([`${FB}/reel/111`, `${FB}/reel/111`]);
  await expect.poll(() => page.url()).toBe(`${FB}/reel/111`);
  await expect(page.locator('#viewer')).toHaveAttribute('data-shown', '111');
  await page.close();
});

test('a Facebook viewer move is still cancelled, and counted in place, when the undo and loop guards both refuse', async () => {
  const page = await context.newPage();
  await page.goto(`${FB}/reel/111`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-facebook', 'on');
  await page.evaluate(() => {
    for (const key of ['dwell:redirects', 'dwell:undos']) sessionStorage.setItem(key, JSON.stringify([Date.now(), Date.now()]));
  });

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

test('arrow keys on a viewer entered in-app never reach a window listener the page added after the guard started', async () => {
  const page = await context.newPage();
  await page.goto(`${FB}/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-facebook', 'on');

  expect(await routeTo(page, '/reel/111')).toEqual({ path: '/reel/111', added: 1 });
  // The guard's poll turns the input lock on for the viewer it now shows.
  await page.waitForTimeout(600);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('PageDown');
  await page.keyboard.press('a');
  await expect.poll(() => heardOnWindow(page)).toEqual(['a']);
  await page.close();
});

test('the Facebook left-column Reels entry and the feed’s Reels suggestions are hidden, other entries are not', async () => {
  const page = await context.newPage();
  await page.goto(`${FB}/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-facebook', 'on');
  await expect(page.locator('#left-reels')).toBeHidden();
  await expect(page.locator('#feed-reels-unit')).toBeHidden();
  await expect(page.locator('#left-friends')).toBeVisible();
  await expect(page.locator('#feed-post')).toBeVisible();
  await page.close();
});

test('a comments panel holding a small GIF video still scrolls on a Facebook viewer', async () => {
  const page = await context.newPage();
  await page.goto(`${FB}/reel/111`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-facebook', 'on');
  await page.locator('#comments-body').evaluate((body) => {
    const gif = document.createElement('video');
    gif.style.cssText = 'display:block;width:120px;height:80px';
    body.prepend(gif);
  });

  await page.mouse.move(1180, 100);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => scrollTop(page, '#comments')).toBeGreaterThan(0);
  expect(path(page)).toBe('/reel/111');
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
  await expect(fb.locator('#left-reels')).toBeVisible();
  await expect(fb.locator('#feed-reels-unit')).toBeVisible();
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

test('with instagramReels off the Reels scroller opens untouched, and turning it on rewrites it', async () => {
  await setBlockers({ instagramReels: false });
  const page = await context.newPage();
  await page.goto(`${IG}/`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'off');
  await expect(page.locator('#nav-reels')).toBeVisible();

  expect(await tapReelsCode(page)).toEqual({ path: `/reels/${CODE}/`, added: 1 });
  await page.waitForTimeout(600);
  expect(path(page)).toBe(`/reels/${CODE}/`);
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
  await tapReelsCode(page);
  await page.evaluate(() => sessionStorage.setItem('dwell:redirects', JSON.stringify([Date.now(), Date.now()])));
  await setBlockers({ instagramReels: true });
  await expect(page.locator('html')).toHaveAttribute('data-dwell-instagram', 'on');
  await page.waitForTimeout(600);
  expect(path(page)).toBe(`/reels/${CODE}/`);
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

test('a hard load of an X video viewer lands on its tweet page, counted once, marker stripped', async () => {
  const page = await context.newPage();
  await page.goto(`${X}/someuser/status/123/video/1`);
  await expect.poll(() => page.url()).toBe(`${X}/someuser/status/123`);
  // DNR redirected before any request: the viewer URL never reached the server.
  expect(served).toEqual([`${X}/someuser/status/123`]);
  expect(await page.evaluate(() => document.documentElement.dataset.hashAtHead)).toBe('');
  await expect(page.locator('html')).toHaveAttribute('data-dwell-x', 'on');
  await expect.poll(blocked).toEqual([{ type: 'blocked', site: 'x' }]);
  await page.close();
});

test('an in-page tap on an X video lands on its tweet page, counted once on landing', async () => {
  const page = await context.newPage();
  await page.goto(`${X}/home`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-x', 'on');

  expect(await tapVideo(page)).toEqual({ path: '/home', added: 0 });
  await expect.poll(() => page.url()).toBe(`${X}/someuser/status/123`);
  expect(served.some((url) => url.includes('/video/'))).toBe(false);
  await expect.poll(blocked).toEqual([{ type: 'blocked', site: 'x' }]);
  await page.waitForTimeout(600);
  expect(await blocked()).toHaveLength(1);
  await page.close();
});

test('a tap on the video of the tweet page you are on is taken back by Back, no reload, counted once', async () => {
  const page = await context.newPage();
  await page.goto(`${X}/someuser/status/123`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-x', 'on');
  await markPage(page);

  expect(await routeTo(page, '/someuser/status/123/video/1')).toEqual({ path: '/someuser/status/123/video/1', added: 1 });
  await expect.poll(() => path(page)).toBe('/someuser/status/123');
  // The site's own router drew the tweet again: what is on screen matches the URL.
  await expect(page.locator('main')).toHaveAttribute('data-shown', '/someuser/status/123');
  await page.waitForTimeout(600);
  expect(path(page)).toBe('/someuser/status/123');
  // Same document: nothing was reloaded, so what the user had on the page is still there.
  expect(await pageMark(page)).toBe('kept');
  expect(served).toEqual([`${X}/someuser/status/123`]);
  await expect.poll(blocked).toEqual([{ type: 'blocked', site: 'x' }]);
  await page.close();
});

test('an X photo viewer and the rest of X load untouched', async () => {
  const page = await context.newPage();
  await page.goto(`${X}/someuser/status/123/photo/1`);
  expect(path(page)).toBe('/someuser/status/123/photo/1');
  await page.goto(`${X}/home`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-x', 'on');
  expect(await tapPhoto(page)).toEqual({ path: '/someuser/status/123/photo/1', added: 1 });
  await page.waitForTimeout(600);
  expect(path(page)).toBe('/someuser/status/123/photo/1');
  expect(await blocked()).toEqual([]);
  await page.close();
});

test('an X viewer reached while the loop guard refused stays on its video: a move to the next one is undone', async () => {
  const page = await context.newPage();
  await page.goto(`${X}/home`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-x', 'on');
  await page.evaluate(() => sessionStorage.setItem('dwell:redirects', JSON.stringify([Date.now(), Date.now()])));

  expect(await tapVideo(page)).toEqual({ path: '/someuser/status/123/video/1', added: 1 });
  expect(await routeTo(page, '/other/status/456/video/1')).toEqual({ path: '/other/status/456/video/1', added: 1 });
  await expect.poll(() => path(page)).toBe('/someuser/status/123/video/1');
  await expect(page.locator('main')).toHaveAttribute('data-shown', '/someuser/status/123/video/1');
  await page.waitForTimeout(600);
  expect(path(page)).toBe('/someuser/status/123/video/1');
  await expect.poll(blocked).toEqual([{ type: 'blocked', site: 'x' }]);
  await page.close();
});

test('with xVideos off, the X viewer loads and moves untouched, and the other blockers stay on', async () => {
  await setBlockers({ xVideos: false });
  await setReelRulesets(false, ['x-videos']);
  const page = await context.newPage();
  await page.goto(`${X}/someuser/status/123/video/1`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-x', 'off');
  expect(path(page)).toBe('/someuser/status/123/video/1');
  expect(await swipeTo(page, '/other/status/456/video/1')).toEqual({ path: '/other/status/456/video/1', added: 1 });
  await page.waitForTimeout(600);
  expect(path(page)).toBe('/other/status/456/video/1');
  expect(await blocked()).toEqual([]);
  await page.close();

  const yt = await context.newPage();
  await yt.goto(`https://www.youtube.com/shorts/${SHORT_ID}`);
  await expect.poll(() => yt.url()).toBe(`https://www.youtube.com/watch?v=${SHORT_ID}`);
  await yt.close();
  await setReelRulesets(true, ['x-videos']);
});

test('settings stored before X existed read the missing X toggle as on, live in an open X tab', async () => {
  await setBlockers({ xVideos: false });
  const page = await context.newPage();
  await page.goto(`${X}/home`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-x', 'off');

  const old = { ...DEFAULT_SETTINGS, blockers: { instagramReels: true, youtubeShorts: true, facebookReels: true, instagramExplore: false } };
  await worker.evaluate(async (value) => chrome.storage.local.set({ settings: value }), old);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-x', 'on');
  expect(await tapVideo(page)).toEqual({ path: '/home', added: 0 });
  await expect.poll(() => page.url()).toBe(`${X}/someuser/status/123`);
  await expect.poll(blocked).toEqual([{ type: 'blocked', site: 'x' }]);
  await page.close();
});

test('YouTube search results hide Short videos and the Shorts shelf, and keep regular videos', async () => {
  const page = await context.newPage();
  await page.goto(`${YT}/results?search_query=cats`);
  await expect(page.locator('html')).toHaveAttribute('data-dwell-youtube', 'on');
  await page.evaluate(() => {
    document.body.innerHTML = [
      '<ytd-search>',
      '<ytd-video-renderer id="short-result"><a href="/shorts/AAAAAAAAAAA">a Short</a></ytd-video-renderer>',
      '<ytd-video-renderer id="video-result"><a href="/watch?v=AAAAAAAAAAA">a video</a></ytd-video-renderer>',
      '<ytd-reel-shelf-renderer id="shorts-shelf">Shorts</ytd-reel-shelf-renderer>',
      '</ytd-search>',
    ].join('');
  });
  await expect(page.locator('#short-result')).toBeHidden();
  await expect(page.locator('#shorts-shelf')).toBeHidden();
  await expect(page.locator('#video-result')).toBeVisible();
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
