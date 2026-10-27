import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { simulateDays } from '../../src/stats/simulate.ts';
import { navigableWeeks } from '../../src/stats/weeks.ts';
import { DEFAULT_SETTINGS, dateString, dayKey } from '../../src/store/schema.ts';
import type { DayRecord, Settings } from '../../src/store/schema.ts';

const dist = fileURLToPath(new URL('../../dist', import.meta.url));
const SEED = 20261014;
const YOUTUBE = 'https://www.youtube.com/';
const NEWS = 'https://news.example/';
const X_TWEET = 'https://x.com/someuser/status/123';
const STUB_PAGE = '<!doctype html><title>fixture</title><p>fixture page</p>';

let context: BrowserContext;
let worker: Worker;
let extensionId: string;
const opened: Page[] = [];
/** Console errors and uncaught exceptions from extension pages: a CSP refusal shows up here. */
const errors: string[] = [];

test.beforeAll(async () => {
  if (!existsSync(`${dist}/manifest.json`)) throw new Error('dist/ missing: run npm run build first');
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
  for (const origin of [YOUTUBE, NEWS, 'https://x.com/']) {
    await context.route(`${origin}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: STUB_PAGE }));
  }
});

test.afterAll(async () => {
  await context?.close();
});

/** Every test starts from an empty store; the real worker handles pause and settings. */
test.beforeEach(async () => {
  await worker.evaluate(() => chrome.storage.local.clear());
});

test.afterEach(async () => {
  for (const page of opened.splice(0)) await page.close();
  expect(errors.splice(0), 'console errors or CSP violations').toEqual([]);
});

async function seed(days: Record<string, DayRecord>, settings: Partial<Settings> = {}): Promise<void> {
  await worker.evaluate(async (items) => chrome.storage.local.set(items), { ...days, settings: { ...DEFAULT_SETTINGS, ...settings } });
}

async function seedSimulated(settings: Partial<Settings> = {}): Promise<Record<string, DayRecord>> {
  const days = simulateDays(SEED, new Date());
  await seed(days, settings);
  return days;
}

async function storedSettings(): Promise<Settings> {
  return worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings as Settings);
}

async function dayKeyCount(): Promise<number> {
  return worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('d:')).length);
}

async function newPage(width: number, height: number): Promise<Page> {
  const page = await context.newPage();
  opened.push(page);
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.setViewportSize({ width, height });
  return page;
}

/** Page overflow in both themes; `inner` is an element that scrolls on its own. */
async function overflow(page: Page, inner: string | null = null): Promise<Record<string, { page: number; inner: number }>> {
  const out: Record<string, { page: number; inner: number }> = {};
  for (const theme of ['light', 'dark']) {
    out[theme] = await page.evaluate(
      ([value, selector]) => {
        document.documentElement.dataset.theme = value ?? 'light';
        const el = selector ? document.querySelector(selector) : null;
        return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, inner: el ? el.scrollWidth - el.clientWidth : 0 };
      },
      [theme, inner] as const,
    );
  }
  return out;
}

const NO_OVERFLOW = { light: { page: 0, inner: 0 }, dark: { page: 0, inner: 0 } };

test.describe('popup', () => {
  /**
   * Opens a fixture tab, then the popup page in its own tab at the popup's size. A popup page that is
   * itself a tab describes the tab the person was on before it, so the fixture is what it inspects.
   */
  async function openPopup(fixture: string | null = null): Promise<Page> {
    if (fixture !== null) {
      const tab = await context.newPage();
      opened.push(tab);
      await tab.goto(fixture);
      await tab.bringToFront();
    }
    const popup = await newPage(360, 560);
    await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await expect(popup.locator('.popup[data-state]')).toBeVisible();
    return popup;
  }

  test('a day in the popup chart shows that day in the open dashboard tab, or a new one when none is open', async () => {
    await seedSimulated();
    const dash = await context.newPage();
    opened.push(dash);
    await dash.goto(`chrome-extension://${extensionId}/src/dashboard/index.html#week`);
    const popup = await openPopup();
    const link = popup.locator('.pp-week a.day-link').first();
    const date = /#day\/(\d{4}-\d{2}-\d{2})$/.exec((await link.getAttribute('href')) ?? '')?.[1];
    expect(date).toBeDefined();
    await link.hover();
    await expect(popup.locator('.pp-week .tip-foot')).toHaveText('Opens this day in the dashboard');
    const before = context.pages().length;
    await link.click();
    await expect(dash).toHaveURL(new RegExp(`#day/${date}$`));
    await expect(dash.locator('[data-chart="day"]')).toBeVisible();
    expect(context.pages().length).toBe(before);
    await dash.close();
    const [fresh] = await Promise.all([context.waitForEvent('page'), link.click()]);
    opened.push(fresh);
    await expect(fresh).toHaveURL(new RegExp(`/src/dashboard/index\\.html#day/${date}$`));
  });

  test('a YouTube tab shows the Shorts toggle, and one tap flips it in storage', async () => {
    await seedSimulated();
    const popup = await openPopup(YOUTUBE);
    await expect(popup.locator('.popup')).toHaveAttribute('data-state', 'normal');
    await expect(popup.locator('.pp-site .dom')).toHaveText('youtube.com');
    const toggle = popup.locator('#blocker-switch');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(popup.locator('#blocker-label')).toHaveText('Shorts off');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(popup.locator('#blocker-label')).toHaveText('Shorts on');
    await expect.poll(async () => (await storedSettings()).blockers.youtubeShorts).toBe(false);
    expect(await overflow(popup, '.pp-body')).toEqual(NO_OVERFLOW);
    await toggle.click();
    await expect.poll(async () => (await storedSettings()).blockers.youtubeShorts).toBe(true);
  });

  test('an X tab shows the X video toggle, and one tap flips it in storage', async () => {
    await seedSimulated();
    const popup = await openPopup(X_TWEET);
    await expect(popup.locator('.pp-site .dom')).toHaveText('x.com');
    const toggle = popup.locator('#blocker-switch');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(popup.locator('#blocker-label')).toHaveText('Video feed off');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(popup.locator('#blocker-label')).toHaveText('Video feed on');
    await expect.poll(async () => (await storedSettings()).blockers.xVideos).toBe(false);
    expect(await overflow(popup, '.pp-body')).toEqual(NO_OVERFLOW);
    await toggle.click();
    await expect.poll(async () => (await storedSettings()).blockers.xVideos).toBe(true);
  });

  test('a news site shows its time and no toggle', async () => {
    await seedSimulated();
    const popup = await openPopup(NEWS);
    await expect(popup.locator('.popup')).toHaveAttribute('data-state', 'noblocker');
    await expect(popup.locator('.pp-site .dom')).toHaveText('news.example');
    await expect(popup.locator('.pp-site .facts-r')).toContainText(/visit/);
    await expect(popup.locator('#blocker-switch')).toHaveCount(0);
  });

  test('a chrome:// page or a blank tab shows the non-trackable card', async () => {
    await seedSimulated();
    for (const [fixture, title] of [
      ['chrome://version/', 'Browser page'],
      ['about:blank', 'New tab'],
    ] as const) {
      const popup = await openPopup(fixture);
      await expect(popup.locator('.popup')).toHaveAttribute('data-state', 'untrackable');
      await expect(popup.locator('.pp-site .page')).toHaveText(title);
      await expect(popup.locator('.pp-site')).toContainText('aren’t recorded');
      await expect(popup.locator('#blocker-switch')).toHaveCount(0);
      for (const page of opened.splice(0)) await page.close();
    }
  });

  test('an empty store renders the first-run state with no NaN or undefined', async () => {
    const popup = await openPopup(NEWS);
    await expect(popup.locator('.popup')).toHaveAttribute('data-state', 'first');
    await expect(popup.locator('h1')).toHaveText('Nothing recorded yet');
    await expect(popup.locator('.pp-top')).toContainText('Your top sites appear after a few minutes of browsing.');
    await expect(popup.locator('.pp-week')).toContainText('Your week fills in as you browse');
    const text = await popup.evaluate(() => `${document.body.innerText}\n${document.body.innerHTML}`);
    expect(text).not.toMatch(/NaN|undefined|Infinity/);
    expect(await overflow(popup, '.pp-body')).toEqual(NO_OVERFLOW);
  });

  test('pause flips the switch, shows the paused band at once and is stored', async () => {
    await seedSimulated();
    const popup = await openPopup(YOUTUBE);
    const pause = popup.locator('#pause-switch');
    await expect(pause).toHaveAttribute('aria-checked', 'false');
    await pause.click();
    await expect(pause).toHaveAttribute('aria-checked', 'true');
    await expect(popup.locator('#paused-band')).toContainText('Tracking is paused');
    await expect(popup.locator('.pp-hero .label')).toContainText('Recorded today before pausing');
    await expect(popup.locator('.pp-site .facts-r')).toHaveText('Not recording while paused');
    await expect(popup.locator('#blocker-switch')).toBeVisible();
    await expect.poll(async () => (await storedSettings()).paused).toBe(true);
    expect(await overflow(popup, '.pp-body')).toEqual(NO_OVERFLOW);

    await popup.locator('#resume').click();
    await expect(popup.locator('#paused-band')).toHaveCount(0);
    await expect(pause).toHaveAttribute('aria-checked', 'false');
    await expect.poll(async () => (await storedSettings()).paused).toBe(false);
  });

  test('a write by the worker shows while the popup is open', async () => {
    const popup = await openPopup(NEWS);
    await expect(popup.locator('.popup')).toHaveAttribute('data-state', 'first');
    const today: DayRecord = {
      sites: { 'news.example': { h: { [String(new Date().getHours())]: 47 * 60 }, v: 3 } },
      blocked: { instagram: 0, youtube: 0, facebook: 0, x: 0 },
    };
    await seed({ [dayKey(new Date())]: today });
    await expect(popup.locator('.hero-num .sr')).toHaveText('47m');
    await expect(popup.locator('.pp-site .facts-r')).toContainText('3 visits');
    await expect(popup.locator('.site-row')).toHaveCount(1);
  });

  test('hovering a day shows its total and top sites', async () => {
    await seedSimulated();
    const popup = await openPopup(NEWS);
    await popup.locator('.pp-week .hit').nth(5).hover();
    await expect(popup.locator('.tip')).toBeVisible();
    await expect(popup.locator('.tip .tip-row')).toHaveCount(3);
  });

  test('Open dashboard opens the dashboard page', async () => {
    const popup = await openPopup();
    const [dashboard] = await Promise.all([context.waitForEvent('page'), popup.locator('#open-dashboard').click()]);
    opened.push(dashboard);
    await dashboard.waitForLoadState();
    expect(dashboard.url()).toBe(`chrome-extension://${extensionId}/src/dashboard/index.html`);
  });
});

test.describe('dashboard', () => {
  async function openDashboard(hash = '#week', width = 1280): Promise<Page> {
    const page = await newPage(width, 900);
    await page.goto(`chrome-extension://${extensionId}/src/dashboard/index.html${hash}`);
    await expect(page.locator('.dash[data-view]')).toBeVisible();
    return page;
  }

  /** Tuesday of last week, a full past day the simulator always fills. */
  function lastTuesday(): string {
    const now = new Date();
    return dateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) - 6));
  }

  test('week navigation stops at the oldest kept week and at the current week', async () => {
    const days = await seedSimulated();
    const weeks = navigableWeeks(Object.keys(days), new Date()).length;
    expect([13, 14]).toContain(weeks);
    const page = await openDashboard();
    await expect(page.locator('#week-next')).toBeDisabled();
    await expect(page.locator('.weeknav .rel')).toHaveText('This week');
    for (let back = 1; back < weeks; back++) {
      await page.locator('#week-prev').click();
      await expect(page).toHaveURL(new RegExp(`#week/${back}$`));
    }
    await expect(page.locator('#week-prev')).toBeDisabled();
    await expect(page.locator('.weeknav .rel')).toHaveText(`${weeks - 1} weeks ago`);
    await expect(page.locator('.headline-notes')).not.toContainText(/NaN|undefined/);
    await page.locator('#week-next').click();
    await expect(page.locator('#week-prev')).toBeEnabled();
  });

  test('Tuesday’s bar opens its day with 24 hourly columns, and back returns to the same week', async () => {
    await seedSimulated();
    const page = await openDashboard('#week/1');
    const tuesday = lastTuesday();
    await page.locator(`.hit[data-day="${tuesday}"]`).hover();
    await expect(page.locator('[data-chart="week"] .tip .tip-row')).toHaveCount(3);
    await page.locator(`.hit[data-day="${tuesday}"]`).click();
    await expect(page).toHaveURL(new RegExp(`#day/${tuesday}$`));
    await expect(page.locator('[data-chart="day"] svg > g')).toHaveCount(24);
    await expect(page.locator('#busiest-hour')).toContainText('Busiest hour:');
    await page.locator('#day-back').click();
    await expect(page).toHaveURL(/#week\/1$/);
    await expect(page.locator('.weeknav .rel')).toHaveText('Last week');
    await page.locator(`.hit[data-day="${tuesday}"]`).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`#day/${tuesday}$`));
  });

  test('a focused chart column keeps keyboard focus and its tooltip when the arrow keys change the week', async () => {
    await seedSimulated();
    const page = await openDashboard('#week/1');
    await page.locator('#week-col-1').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page).toHaveURL(/#week\/2$/);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('week-col-1');
    await expect(page.locator('[data-chart="week"] .tip')).toHaveCount(1);
  });

  test('a click on a most-used row focuses its site through day and week navigation and a reload, and Escape clears it', async () => {
    await seedSimulated();
    const page = await openDashboard('#week/1');
    const site = (await page.locator('#most-used li.mu-row .d').first().textContent()) ?? '';
    const pick = page.locator('#most-used li.mu-row .row-pick').first();
    await pick.click();
    const focused = (path: string): RegExp => new RegExp(`#${path}\\?site=${site.replaceAll('.', '\\.')}$`);
    await expect(page).toHaveURL(focused('week/1'));
    await expect(pick).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#focus-chip')).toContainText(site);
    await expect(page.locator('[data-chart="week"] path.chart-part:not(.is-empty)')).not.toHaveCount(0);
    const tuesday = lastTuesday();
    await page.locator(`.hit[data-day="${tuesday}"]`).click();
    await expect(page).toHaveURL(focused(`day/${tuesday}`));
    await expect(page.locator('#focus-chip')).toContainText(site);
    await page.locator('#day-back').click();
    await expect(page).toHaveURL(focused('week/1'));
    await page.reload();
    await expect(page.locator('#focus-chip')).toContainText(site);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/#week\/1$/);
    await expect(page.locator('#focus-chip')).toHaveCount(0);
    await expect(page.locator('#most-used .row-pick[aria-pressed="true"]')).toHaveCount(0);
  });

  test('changing the idle threshold is stored and the worker’s idle interval follows', async () => {
    await seedSimulated();
    await worker.evaluate(() => {
      const g = globalThis as unknown as { dwellIdleCalls?: number[]; dwellIdleOriginal?: (s: number) => void };
      g.dwellIdleCalls = [];
      g.dwellIdleOriginal ??= chrome.idle.setDetectionInterval.bind(chrome.idle);
      const original = g.dwellIdleOriginal;
      chrome.idle.setDetectionInterval = (seconds: number) => {
        g.dwellIdleCalls?.push(seconds);
        original(seconds);
      };
    });
    const page = await openDashboard('#settings');
    await expect(page.locator('#idle-60')).toHaveAttribute('aria-checked', 'true');
    await page.locator('#idle-120').click();
    await expect(page.locator('#idle-120')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await storedSettings()).idleThresholdSec).toBe(120);
    await expect.poll(() => worker.evaluate(() => (globalThis as unknown as { dwellIdleCalls: number[] }).dwellIdleCalls.at(-1))).toBe(120);
    await page.locator('#idle-60').click();
    await expect.poll(() => worker.evaluate(() => (globalThis as unknown as { dwellIdleCalls: number[] }).dwellIdleCalls.at(-1))).toBe(60);
  });

  test('the theme setting forces dark on the dashboard and the popup, and System removes it', async () => {
    await seedSimulated();
    const page = await openDashboard('#settings');
    await expect(page.locator('#theme-system')).toHaveAttribute('aria-checked', 'true');
    await page.locator('#theme-dark').click();
    await expect.poll(async () => (await storedSettings()).theme).toBe('dark');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    const popup = await newPage(360, 560);
    await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await expect.poll(() => popup.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    await page.locator('#theme-system').click();
    await expect.poll(async () => (await storedSettings()).theme).toBe('system');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
    await expect.poll(() => popup.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
  });

  test('export downloads a file the import accepts, and the day count is unchanged', async () => {
    await seedSimulated();
    const before = await dayKeyCount();
    const page = await openDashboard('#settings');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-json').click()]);
    expect(download.suggestedFilename()).toMatch(/^dwell-export-\d{4}-\d{2}-\d{2}\.json$/);
    const text = readFileSync(await download.path(), 'utf8');
    const file = JSON.parse(text) as { format: string; days: Record<string, unknown> };
    expect(file.format).toBe('dwell-export');
    expect(Object.keys(file.days)).toHaveLength(before);
    await expect(page.locator('#export-notice')).toContainText(`${before} days`);
    await page.locator('#import-file').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.from(text) });
    await expect(page.locator('#import-notice')).toHaveText(new RegExp(`^Read ${download.suggestedFilename()}: \\d+ days added or updated\\.$`));
    expect(await dayKeyCount()).toBe(before);
    await page.locator('#import-file').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('not json') });
    await expect(page.locator('#import-notice')).toContainText('notes.json wasn’t imported.');
    expect(await dayKeyCount()).toBe(before);
  });

  test('delete all then undo within 10 s restores the data; without undo it stays gone', async () => {
    test.setTimeout(60_000);
    await seedSimulated();
    const before = await dayKeyCount();
    const page = await openDashboard('#settings');
    await page.locator('#delete-all').click();
    await expect(page.locator('#undo-toast')).toContainText('All history deleted.');
    await expect(page.locator('#delete-all')).toBeDisabled();
    await expect.poll(dayKeyCount).toBe(0);
    await page.locator('#undo-delete').click();
    await expect(page.locator('#delete-notice')).toHaveText('History restored.');
    await expect.poll(dayKeyCount).toBe(before);
    await expect(page.locator('#undo-toast')).toHaveCount(0);

    await page.locator('#delete-all').click();
    await expect(page.locator('#undo-toast')).toBeVisible();
    await page.locator('#nav-activity').click();
    await expect(page.locator('#undo-toast')).toBeVisible();
    await expect(page.locator('.headline-notes')).toHaveText('Nothing was recorded this week. Days fill in as soon as you browse with tracking on.');
    await page.waitForTimeout(11_000);
    await expect(page.locator('#undo-toast')).toHaveCount(0);
    expect(await dayKeyCount()).toBe(0);
  });

  test('the paused banner shows on the week and day views while paused and goes on resume, without a reload', async () => {
    await seedSimulated();
    const page = await openDashboard('#week');
    await expect(page.locator('#paused-banner')).toHaveCount(0);
    await worker.evaluate(async (defaults) => chrome.storage.local.set({ settings: { ...defaults, paused: true } }), DEFAULT_SETTINGS);
    await expect(page.locator('#paused-banner')).toContainText('Tracking is paused');
    await expect(page.locator('#status-pill')).toHaveText('Tracking paused');
    await page.locator(`.hit[data-day]`).first().click();
    await expect(page.locator('#paused-banner')).toBeVisible();
    await page.locator('#resume').click();
    await expect(page.locator('#paused-banner')).toHaveCount(0);
    await expect(page.locator('#status-pill')).toHaveText('Recording');
    await expect.poll(async () => (await storedSettings()).paused).toBe(false);
    await page.locator('#nav-settings').click();
    await page.locator('#pause-switch').click();
    await page.locator('#nav-activity').click();
    await expect(page.locator('#paused-banner')).toBeVisible();
    await expect.poll(async () => (await storedSettings()).paused).toBe(true);
  });

  test('no horizontal overflow at 768, 1024 and 1440 px in both themes', async () => {
    await seedSimulated({ ignore: ['very-long-subdomain-name-for-testing.example.com'], overrides: ['mail.google.com'] });
    const page = await openDashboard('#week', 768);
    for (const width of [768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const hash of ['#week', '#week/1', `#day/${lastTuesday()}`, '#settings', '#privacy']) {
        await page.evaluate((h) => {
          location.hash = h;
        }, hash);
        await expect(page.locator('.dash[data-view]')).toBeVisible();
        await page.waitForTimeout(150);
        expect(await overflow(page), `${hash} at ${width}`).toEqual(NO_OVERFLOW);
      }
    }
  });

  test('the privacy panel matches the manifest and keeps its prose between 55 and 80 characters a line', async () => {
    const page = await openDashboard('#privacy');
    const manifest = JSON.parse(readFileSync(`${dist}/manifest.json`, 'utf8')) as { permissions: string[]; host_permissions: string[] };
    const listed = await page.locator('#permissions code').allTextContents();
    expect([...listed].sort()).toEqual([...manifest.permissions, ...manifest.host_permissions].sort());
    const prose = await page.locator('#privacy-prose').innerText();
    expect(prose.toLowerCase()).not.toContain('no network access is possible');
    expect(prose).toContain("default-src 'none'");
    /** Characters per rendered line, measured from each character's box; a paragraph's last line is left out. */
    const lines = await page.evaluate(() => {
      const counts: number[] = [];
      for (const p of document.querySelectorAll('#privacy-prose > p')) {
        const perLine: number[] = [];
        let lastTop = -Infinity;
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent ?? '';
          for (let i = 0; i < text.length; i++) {
            const range = document.createRange();
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            const rect = range.getClientRects()[0];
            if (!rect) continue;
            if (rect.top > lastTop + 10) {
              perLine.push(0);
              lastTop = rect.top;
            }
            perLine[perLine.length - 1] = (perLine.at(-1) ?? 0) + 1;
          }
        }
        counts.push(...perLine.slice(0, -1));
      }
      return counts;
    });
    expect(lines.length).toBeGreaterThan(5);
    expect(Math.min(...lines)).toBeGreaterThanOrEqual(55);
    expect(Math.max(...lines)).toBeLessThanOrEqual(80);
  });
});
