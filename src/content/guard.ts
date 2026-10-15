/**
 * In-page navigation guard for short-video routes (KTD4, KTD4b). Isolated world, document_start,
 * top frame, on the three sites only. It reads `location`, its own settings and its own loop-guard
 * key, and sends only `{ type: 'blocked', site }`. Nothing else from the page is read or sent.
 *
 * 1. Navigation API: a cancelable `navigate` to a blocked URL is cancelled. A Reels feed and Explore
 *    stay on the current page and are counted here, with no marker. A single Short or Instagram Reel goes
 *    on to its single-video page (AE6), and is cancelled only when the loop guard allows that redirect;
 *    otherwise the tap goes through untouched.
 * 2. One-video mode: on a viewer route (`blocker/viewer.ts`), a move to another video of the same viewer
 *    is cancelled and the tab goes back to the first video's page; the input lock (`viewer-lock.ts`)
 *    swallows the wheel, keys and touch moves that would advance the viewer.
 * 3. Fallbacks (`popstate`, `yt-navigate-finish`, a 250 ms poll, a settings change): a viewer that moved
 *    to another video anyway, or a blocked URL that is current, is replaced by its allowlisted target, at
 *    most 2 redirects per tab in 5 s.
 * 4. A landing that carries `#dwell=<site>` (DNR or a redirect from here) is stripped at once, and counted
 *    once after the settings load, only while that site's blocker is on.
 */
import { admitRedirect, decide, decideLock, markerCounts, type Decision } from '../blocker/decide.ts';
import { classify, siteForHost } from '../blocker/patterns.ts';
import { TARGET_FRAGMENT, isAllowedTarget } from '../blocker/targets.ts';
import { decideViewerMove, viewerLocked } from '../blocker/viewer.ts';
import { DEFAULT_SETTINGS, SETTINGS_KEY, type BlockedSite, type Settings } from '../store/schema.ts';
import { extensionAlive, sendToWorker } from './runtime.ts';
import { setInputLock } from './viewer-lock.ts';

type Blockers = Settings['blockers'];

const POLL_MS = 250;
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
let markerPending = false;
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
  setInputLock(false);
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

/** Loop guard (`admitRedirect`): records one more redirect and returns true, or refuses it. */
function mayRedirect(): boolean {
  const next = admitRedirect({ now: Date.now(), redirects: loadRedirects() });
  if (next === null) return false;
  saveRedirects(next);
  return true;
}

function withoutFragment(url: string): string {
  const hash = url.indexOf('#');
  return hash === -1 ? url : url.slice(0, hash);
}

/**
 * Every redirect the guard makes goes through here, and only to an allowlisted target.
 * Callers have already passed the loop guard, before anything was cancelled. A target that differs from
 * the current URL only by its fragment (Facebook's viewer locked on its own reel) would be a same-document
 * jump that leaves the next video on screen, so the page is then reloaded on that target.
 */
function go(target: string, mode: 'assign' | 'replace'): void {
  if (!alive || !isAllowedTarget(target)) return;
  const sameDocument = withoutFragment(target) === withoutFragment(location.href);
  if (mode === 'replace') location.replace(target);
  else location.assign(target);
  if (sameDocument) location.reload();
}

/** The input lock is on exactly while the current URL is a viewer route and its site's toggle is on. */
function syncInputLock(): void {
  setInputLock(alive && viewerLocked(location.href, blockers));
}

/** Cancels a cancelable navigation per `decision`: counts a cancel, or goes on to the redirect target. */
function apply(event: NavigateEvent, decision: Decision, mode: 'assign' | 'replace'): void {
  if (decision.action === 'allow') return;
  event.preventDefault();
  if (decision.action === 'cancel') {
    count(decision.site);
    return;
  }
  saveRedirects(decision.redirects);
  // The target page is the destination (R15); its marker is what gets counted on landing.
  setTimeout(() => go(decision.target, mode), 0);
}

function onNavigate(event: NavigateEvent): void {
  if (!alive || !event.cancelable) return;
  const loop = { now: Date.now(), redirects: loadRedirects() };
  const move = decideViewerMove(location.href, event.destination.url, blockers);
  if (move.action === 'lock') {
    // Next video in the viewer: cancelled, then back to the first video's page (loop guard permitting).
    apply(event, decideLock(move, loop), 'replace');
    return;
  }
  const hit = classify(event.destination.url, blockers);
  if (hit === null) return;
  // The loop guard is asked before cancelling, so a refused rewrite is never cancelled with nothing after it.
  apply(event, decide(hit, loop), 'assign');
}

/** Fallback: if the current URL is blocked anyway, replace it with its target. */
function enforceCurrent(): void {
  if (!alive || !loaded) return;
  const hit = classify(location.href, blockers);
  if (hit !== null && mayRedirect()) go(hit.target, 'replace');
}

/**
 * Fallback for every URL change the Navigation API did not stop: a viewer that moved to another video
 * goes back to the first one; anything else blocked goes to its target. Then the input lock follows the URL.
 */
function settleUrl(): void {
  if (!alive || !loaded) return;
  const from = lastHref;
  lastHref = location.href;
  const move = decideViewerMove(from, lastHref, blockers);
  if (move.action === 'lock') {
    if (mayRedirect()) go(move.target, 'replace');
  } else {
    enforceCurrent();
  }
  syncInputLock();
}

function tick(site: BlockedSite): void {
  if (!extensionAlive()) {
    stop(site);
    return;
  }
  if (location.href !== lastHref) settleUrl();
}

/** A redirect landing: strip the marker before the page's own scripts run; `settleMarker` counts it. */
function consumeMarker(site: BlockedSite): void {
  if (location.hash !== TARGET_FRAGMENT[site]) return;
  markerPending = true;
  history.replaceState(history.state, '', location.pathname + location.search);
}

/** Once the settings are known: count the stripped marker once, only while that site's blocker is on. */
function settleMarker(site: BlockedSite): void {
  if (!markerPending) return;
  markerPending = false;
  if (markerCounts(site, blockers)) sendToWorker({ type: 'blocked', site }, () => stop(site));
}

function applySettings(site: BlockedSite, stored: unknown): void {
  blockers = readBlockers(stored);
  loaded = true;
  settleMarker(site);
  setHiderAttribute(site);
  settleUrl();
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
  syncInputLock();
  listen(window, 'popstate', settleUrl);
  listen(window, 'yt-navigate-finish', settleUrl);
  const timer = setInterval(() => tick(site), POLL_MS);
  cleanups.push(() => clearInterval(timer));
  watchSettings(site);
}

const site = siteForHost(location.hostname);
if (site !== null) main(site);
