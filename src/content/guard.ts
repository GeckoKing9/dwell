/**
 * In-page navigation guard for short-video routes (KTD4, KTD4b). Isolated world, document_start,
 * top frame, on the three sites only. It reads `location`, its own settings and its own loop-guard
 * key, and sends only `{ type: 'blocked', site }`. Nothing else from the page is read or sent.
 *
 * 1. Navigation API: a cancelable `navigate` to a blocked URL is cancelled. Reels and Explore stay on
 *    the current page and are counted here, with no marker. Shorts go on to the watch page (AE6).
 * 2. Fallbacks (`popstate`, `yt-navigate-finish`, a 250 ms poll, a settings change): a blocked URL that
 *    is current is replaced by its allowlisted target, at most 2 redirects per tab in 5 s.
 * 3. A landing that carries `#dwell=<site>` (DNR or a fallback redirect) is counted once and stripped.
 */
import { classify, siteForHost } from '../blocker/patterns.ts';
import { TARGET_FRAGMENT, isAllowedTarget } from '../blocker/targets.ts';
import { DEFAULT_SETTINGS, SETTINGS_KEY, type BlockedSite, type Settings } from '../store/schema.ts';
import { extensionAlive, sendToWorker } from './runtime.ts';

type Blockers = Settings['blockers'];

const POLL_MS = 250;
const LOOP_WINDOW_MS = 5000;
const LOOP_MAX_REDIRECTS = 2;
const COUNT_DEDUPE_MS = 1000;
/** sessionStorage is per tab and per origin, so the loop guard survives the redirect it caused. */
const LOOP_KEY = 'dwell:redirects';

/** The blocker each site's hider CSS follows. */
const HIDER_TOGGLE: Readonly<Record<BlockedSite, keyof Blockers>> = {
  instagram: 'instagramReels',
  youtube: 'youtubeShorts',
  facebook: 'facebookReels',
};

let blockers: Blockers = { ...DEFAULT_SETTINGS.blockers };
let loaded = false;
let changedSinceStart = false;
let alive = true;
let markerCounted = false;
let lastCountAt = 0;
let lastHref = '';
let memoryRedirects: number[] = [];
const cleanups: (() => void)[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Blocker flags from stored settings; a missing or malformed flag falls back to its default. */
function readBlockers(stored: unknown): Blockers {
  const raw: Record<string, unknown> = isRecord(stored) && isRecord(stored.blockers) ? stored.blockers : {};
  const out: Blockers = { ...DEFAULT_SETTINGS.blockers };
  for (const key of Object.keys(out) as (keyof Blockers)[]) {
    const flag = raw[key];
    if (typeof flag === 'boolean') out[key] = flag;
  }
  return out;
}

function setHiderAttribute(site: BlockedSite): void {
  document.documentElement.setAttribute(`data-dwell-${site}`, blockers[HIDER_TOGGLE[site]] ? 'on' : 'off');
}

function stop(site: BlockedSite): void {
  if (!alive) return;
  alive = false;
  for (const cleanup of cleanups.splice(0)) {
    try {
      cleanup();
    } catch {
      // The extension context is already gone; there is nothing left to detach.
    }
  }
  document.documentElement.removeAttribute(`data-dwell-${site}`);
}

function count(site: BlockedSite): void {
  const now = Date.now();
  if (now - lastCountAt < COUNT_DEDUPE_MS) return;
  lastCountAt = now;
  sendToWorker({ type: 'blocked', site }, () => stop(site));
}

function loadRedirects(): number[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(LOOP_KEY) ?? '[]');
    if (Array.isArray(parsed)) return parsed.filter((t): t is number => typeof t === 'number');
  } catch {
    // Storage blocked or the value is not ours: this document's memory still guards it.
  }
  return memoryRedirects;
}

function saveRedirects(list: number[]): void {
  memoryRedirects = list;
  try {
    sessionStorage.setItem(LOOP_KEY, JSON.stringify(list));
  } catch {
    // Storage blocked: the in-memory copy above still guards this document.
  }
}

/** Loop guard: at most LOOP_MAX_REDIRECTS redirects per tab within LOOP_WINDOW_MS. */
function mayRedirect(): boolean {
  const now = Date.now();
  const recent = loadRedirects().filter((t) => now - t >= 0 && now - t < LOOP_WINDOW_MS);
  if (recent.length >= LOOP_MAX_REDIRECTS) return false;
  saveRedirects([...recent, now]);
  return true;
}

/** Every redirect the guard makes goes through here, and only to an allowlisted target. */
function go(target: string, mode: 'assign' | 'replace'): void {
  if (!alive || !isAllowedTarget(target) || !mayRedirect()) return;
  if (mode === 'replace') location.replace(target);
  else location.assign(target);
}

function onNavigate(event: NavigateEvent): void {
  if (!alive || !event.cancelable) return;
  const hit = classify(event.destination.url, blockers);
  if (hit === null) return;
  event.preventDefault();
  if (hit.kind === 'shorts') {
    // The watch page is the destination (R15); its marker is what gets counted on landing.
    setTimeout(() => go(hit.target, 'assign'), 0);
    return;
  }
  count(hit.site);
}

/** Fallback: if the current URL is blocked anyway, replace it with its target. */
function enforceCurrent(): void {
  if (!alive || !loaded) return;
  const hit = classify(location.href, blockers);
  if (hit !== null) go(hit.target, 'replace');
}

function tick(site: BlockedSite): void {
  if (!extensionAlive()) {
    stop(site);
    return;
  }
  if (location.href === lastHref) return;
  lastHref = location.href;
  enforceCurrent();
}

/** A redirect landing: count it once, then strip the marker before the page's own scripts run. */
function consumeMarker(site: BlockedSite): void {
  if (markerCounted || location.hash !== TARGET_FRAGMENT[site]) return;
  markerCounted = true;
  history.replaceState(history.state, '', location.pathname + location.search);
  sendToWorker({ type: 'blocked', site }, () => stop(site));
}

function applySettings(site: BlockedSite, stored: unknown): void {
  blockers = readBlockers(stored);
  loaded = true;
  setHiderAttribute(site);
  enforceCurrent();
}

function listen(target: EventTarget, type: string, handler: () => void): void {
  target.addEventListener(type, handler);
  cleanups.push(() => target.removeEventListener(type, handler));
}

function watchSettings(site: BlockedSite): void {
  const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: chrome.storage.AreaName): void => {
    if (area !== 'local' || !Object.hasOwn(changes, SETTINGS_KEY)) return;
    changedSinceStart = true;
    applySettings(site, changes[SETTINGS_KEY]?.newValue);
  };
  chrome.storage.onChanged.addListener(onChanged);
  cleanups.push(() => chrome.storage.onChanged.removeListener(onChanged));

  chrome.storage.local.get(SETTINGS_KEY).then(
    (items) => {
      if (!changedSinceStart) applySettings(site, items[SETTINGS_KEY]);
    },
    () => {
      if (!extensionAlive()) stop(site);
      else if (!changedSinceStart) applySettings(site, undefined);
    },
  );
}

function main(site: BlockedSite): void {
  consumeMarker(site);
  // Defaults until the stored settings arrive: hide first rather than flash a Reels entry.
  setHiderAttribute(site);
  lastHref = location.href;

  if ('navigation' in window) {
    const nav = window.navigation;
    nav.addEventListener('navigate', onNavigate);
    cleanups.push(() => nav.removeEventListener('navigate', onNavigate));
  }
  listen(window, 'popstate', enforceCurrent);
  listen(window, 'yt-navigate-finish', enforceCurrent);
  const timer = setInterval(() => tick(site), POLL_MS);
  cleanups.push(() => clearInterval(timer));
  watchSettings(site);
}

const site = siteForHost(location.hostname);
if (site !== null) main(site);
