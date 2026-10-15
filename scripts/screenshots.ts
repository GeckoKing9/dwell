/**
 * Captures the README screenshots into docs/screenshots/ from the built extension, seeded with the
 * simulator's 90 days (seed 20261014). Needs dist/ (`npm run screenshots` builds it first).
 *
 * Each shot is taken at device scale 2 and cropped to its content; a PNG over 400 KB is taken again
 * at scale 1.5. The browser is closed on every path, including a failure.
 */
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateDays } from '../src/stats/simulate.ts';
import { DEFAULT_SETTINGS, dateString } from '../src/store/schema.ts';

const SEED = 20261014;
const MAX_BYTES = 400 * 1024;
const SCALES = [2, 1.5] as const;
const INSTAGRAM = 'https://www.instagram.com/';
const STUB_PAGE = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Instagram</title><p>fixture page</p></html>';

type Theme = 'light' | 'dark';

interface Shot {
  file: string;
  theme: Theme;
  /** Dashboard route; absent for the popup. */
  hash?: string;
}

interface Session {
  context: BrowserContext;
  extensionId: string;
}

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const out = join(root, 'docs', 'screenshots');

/** Tuesday of last week: a full past day the simulator always fills. */
function lastTuesday(): string {
  const now = new Date();
  return dateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) - 6));
}

const SHOTS: readonly Shot[] = [
  { file: 'popup-light.png', theme: 'light' },
  { file: 'popup-dark.png', theme: 'dark' },
  { file: 'dashboard-week-light.png', theme: 'light', hash: '#week/1' },
  { file: 'dashboard-week-dark.png', theme: 'dark', hash: '#week/1' },
  { file: 'dashboard-day-light.png', theme: 'light', hash: `#day/${lastTuesday()}` },
  { file: 'dashboard-settings-light.png', theme: 'light', hash: '#settings' },
  { file: 'dashboard-privacy-light.png', theme: 'light', hash: '#privacy' },
];

async function launch(scale: number): Promise<Session> {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    deviceScaleFactor: scale,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await context.route(`${INSTAGRAM}**`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: STUB_PAGE }),
    );
    const items = { ...simulateDays(SEED, new Date()), settings: DEFAULT_SETTINGS };
    await worker.evaluate(async (seed) => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set(seed);
    }, items);
    return { context, extensionId: new URL(worker.url()).host };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function settle(page: Page, theme: Theme, ready: string): Promise<void> {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.locator(ready).first().waitFor({ state: 'visible' });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

/** The popup page in its own tab describes the tab in front before it: the Instagram fixture. */
async function popup(session: Session, shot: Shot, path: string): Promise<void> {
  const tab = await session.context.newPage();
  await tab.goto(INSTAGRAM);
  await tab.bringToFront();
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 360, height: 560 });
  await page.goto(`chrome-extension://${session.extensionId}/src/popup/index.html`);
  await settle(page, shot.theme, '.popup[data-state]');
  await page.locator('#blocker-switch').waitFor({ state: 'visible' });
  await page.locator('.popup').screenshot({ path, animations: 'disabled' });
  await page.close();
  await tab.close();
}

async function dashboard(session: Session, shot: Shot, path: string): Promise<void> {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${session.extensionId}/src/dashboard/index.html${shot.hash ?? ''}`);
  await settle(page, shot.theme, '.dash[data-view]');
  /** `.dash` fills at least the viewport; crop at the bottom of the content instead. */
  const height = await page.evaluate(() => {
    const full = document.documentElement.scrollHeight;
    const main = document.querySelector('.dash-main');
    return main === null ? full : Math.min(full, Math.ceil(main.getBoundingClientRect().bottom + window.scrollY));
  });
  await page.screenshot({ path, fullPage: true, clip: { x: 0, y: 0, width: 1280, height }, animations: 'disabled' });
  await page.close();
}

async function main(): Promise<number> {
  if (!existsSync(join(dist, 'manifest.json'))) {
    console.error('screenshots: dist/manifest.json not found; run npm run build first.');
    return 1;
  }
  mkdirSync(out, { recursive: true });
  const taken = new Map<string, { bytes: number; scale: number }>();
  let pending: readonly Shot[] = SHOTS;

  for (const scale of SCALES) {
    if (pending.length === 0) break;
    const session = await launch(scale);
    try {
      for (const shot of pending) {
        const path = join(out, shot.file);
        await (shot.hash === undefined ? popup(session, shot, path) : dashboard(session, shot, path));
        taken.set(shot.file, { bytes: statSync(path).size, scale });
      }
    } finally {
      await session.context.close();
    }
    pending = pending.filter((shot) => (taken.get(shot.file)?.bytes ?? 0) > MAX_BYTES);
  }

  for (const shot of SHOTS) {
    const result = taken.get(shot.file);
    if (result === undefined) continue;
    const kb = (result.bytes / 1024).toFixed(0);
    console.log(`screenshots: ${relative(root, join(out, shot.file))} ${kb} KB at scale ${result.scale}`);
  }
  if (pending.length > 0) {
    console.error(`screenshots: still over 400 KB at scale ${SCALES.at(-1)}: ${pending.map((s) => s.file).join(', ')}`);
    return 1;
  }
  return 0;
}

process.exitCode = await main();
