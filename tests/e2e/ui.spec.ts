import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { simulateDays } from '../../src/stats/simulate.ts';
import { DEFAULT_SETTINGS, dayKey } from '../../src/store/schema.ts';
import type { DayRecord, Settings } from '../../src/store/schema.ts';

const dist = fileURLToPath(new URL('../../dist', import.meta.url));
const SEED = 20261014;
const YOUTUBE = 'https://www.youtube.com/';
const NEWS = 'https://news.example/';
const STUB_PAGE = '<!doctype html><title>fixture</title><p>fixture page</p>';

test.describe('popup', () => {
  let context: BrowserContext;
  let worker: Worker;
  let extensionId: string;
  const opened: Page[] = [];
  /** Console errors and uncaught exceptions from popup pages: a CSP refusal shows up here. */
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
    for (const origin of [YOUTUBE, NEWS]) {
      await context.route(`${origin}**`, (route) =>
        route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: STUB_PAGE }),
      );
    }
  });

  test.afterAll(async () => {
    await context?.close();
  });

  /**
   * Empties storage and records every pause and settings message the popup sends. The recorder also
   * applies them to storage the way the worker does, so the popup's read-back sees the change whether
   * or not the worker's own handler is loaded; next to that handler it writes the same value.
   */
  test.beforeEach(async () => {
    await worker.evaluate(async (defaults: Settings) => {
      await chrome.storage.local.clear();
      const g = globalThis as unknown as { dwellPopupSeen?: unknown[] };
      if (g.dwellPopupSeen !== undefined) {
        g.dwellPopupSeen.length = 0;
        return;
      }
      const seen: unknown[] = [];
      g.dwellPopupSeen = seen;
      chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
        const m = message as { type?: string; paused?: boolean; patch?: { blockers?: Partial<Settings['blockers']> } };
        if (m.type !== 'pause' && m.type !== 'settings') return false;
        seen.push(message);
        void chrome.storage.local.get('settings').then(async (stored) => {
          const current = { ...defaults, ...(stored.settings as Partial<Settings> | undefined) };
          const next =
            m.type === 'pause'
              ? { ...current, paused: m.paused === true }
              : { ...current, blockers: { ...current.blockers, ...m.patch?.blockers } };
          await chrome.storage.local.set({ settings: next });
          sendResponse({ ok: true });
        });
        return true;
      });
    }, DEFAULT_SETTINGS);
  });

  test.afterEach(async () => {
    for (const page of opened.splice(0)) await page.close();
    expect(errors.splice(0), 'console errors or CSP violations in the popup').toEqual([]);
  });

  async function seed(days: Record<string, DayRecord>, settings: Partial<Settings> = {}): Promise<void> {
    await worker.evaluate(async (items) => chrome.storage.local.set(items), {
      ...days,
      settings: { ...DEFAULT_SETTINGS, ...settings },
    });
  }

  async function seedSimulated(settings: Partial<Settings> = {}): Promise<void> {
    await seed(simulateDays(SEED, new Date()), settings);
  }

  async function sent(): Promise<unknown[]> {
    return worker.evaluate(() => [...((globalThis as unknown as { dwellPopupSeen?: unknown[] }).dwellPopupSeen ?? [])]);
  }

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
    const popup = await context.newPage();
    opened.push(popup);
    popup.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    popup.on('pageerror', (error) => errors.push(String(error)));
    await popup.setViewportSize({ width: 360, height: 560 });
    await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await expect(popup.locator('.popup[data-state]')).toBeVisible();
    return popup;
  }

  async function noOverflow(popup: Page): Promise<void> {
    for (const theme of ['light', 'dark']) {
      const widths = await popup.evaluate((value) => {
        document.documentElement.dataset.theme = value;
        const body = document.querySelector('.pp-body');
        return {
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          body: body ? body.scrollWidth - body.clientWidth : 0,
        };
      }, theme);
      expect(widths, `overflow in ${theme} theme`).toEqual({ page: 0, body: 0 });
    }
  }

  test('a YouTube tab shows the Shorts toggle, and one tap flips it', async () => {
    await seedSimulated();
    const popup = await openPopup(YOUTUBE);
    await expect(popup.locator('.popup')).toHaveAttribute('data-state', 'normal');
    await expect(popup.locator('.pp-site .dom')).toHaveText('youtube.com');
    const toggle = popup.locator('#blocker-switch');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(popup.locator('#blocker-label')).toHaveText('Shorts off');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(popup.locator('#blocker-label')).toHaveText('Shorts on');
    expect(await sent()).toEqual([{ type: 'settings', patch: { blockers: { youtubeShorts: false } } }]);
    await noOverflow(popup);
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
    await noOverflow(popup);
  });

  test('pause flips the switch and shows the paused band at once', async () => {
    await seedSimulated();
    const popup = await openPopup(YOUTUBE);
    const pause = popup.locator('#pause-switch');
    await expect(pause).toHaveAttribute('aria-checked', 'false');
    await pause.click();
    await expect(pause).toHaveAttribute('aria-checked', 'true');
    await expect(popup.locator('#paused-band')).toBeVisible();
    await expect(popup.locator('#paused-band')).toContainText('Tracking is paused');
    await expect(popup.locator('.pp-hero .label')).toContainText('Recorded today before pausing');
    await expect(popup.locator('.pp-site .facts-r')).toHaveText('Not recording while paused');
    await expect(popup.locator('#blocker-switch')).toBeVisible();
    expect(await sent()).toEqual([{ type: 'pause', paused: true }]);
    await noOverflow(popup);

    await popup.locator('#resume').click();
    await expect(popup.locator('#paused-band')).toHaveCount(0);
    await expect(pause).toHaveAttribute('aria-checked', 'false');
  });

  test('a write by the worker shows while the popup is open', async () => {
    const popup = await openPopup(NEWS);
    await expect(popup.locator('.popup')).toHaveAttribute('data-state', 'first');
    const today: DayRecord = {
      sites: { 'news.example': { h: { [String(new Date().getHours())]: 47 * 60 }, v: 3 } },
      blocked: { instagram: 0, youtube: 0, facebook: 0 },
    };
    await seed({ [dayKey(new Date())]: today });
    await expect(popup.locator('.hero-num .sr')).toHaveText('47m');
    await expect(popup.locator('.pp-site .facts-r')).toContainText('3 visits');
    await expect(popup.locator('.site-row')).toHaveCount(1);
  });

  test('hovering a day shows its total and top sites', async () => {
    await seedSimulated();
    const popup = await openPopup(NEWS);
    const yesterday = popup.locator('.pp-week .hit').nth(5);
    await yesterday.hover();
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
