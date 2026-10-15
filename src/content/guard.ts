/**
 * In-page navigation guard for short-video routes (KTD4, KTD4b). Isolated world, document_start,
 * top frame, on the four sites only (Instagram, YouTube, Facebook, X). It reads `location`, its own settings
 * and its own loop-guard and undo keys, and sends only `{ type: 'blocked', site }`. Nothing else from the
 * page is read or sent.
 *
 * Cancelling a navigation alone does not stop a single-page app: the URL stays, but the app's router has
 * usually drawn the new route already, so the blocked screen would show under the old URL. So every block
 * here ends in a page load or an undo (`blocker/decide.ts`); a bare cancel is the last resort.
 *
 * 1. Navigation API: a cancelable `navigate` to a blocked URL is cancelled and a page loaded instead. A Reels
 *    feed or Explore loads the site's home page. A Short, the Instagram Reels scroller on one Reel or X's
 *    video viewer loads its single-video page (AE6), and is cancelled only when the loop guard allows that
 *    load; otherwise the tap goes through untouched. A single Instagram Reel is not blocked: it opens in
 *    Instagram's own pop-up.
 * 2. Undo: a same-document push that must be taken back (a viewer moving to its next video, or a rewrite to
 *    the page already open) is let through, then `history.back()` on the next task makes the site's own
 *    router draw the page it left, with nothing reloaded; at most 2 undos per tab in 5 s. A replace, a
 *    traverse, a cross-document move or a refused undo is cancelled and the first video's page loaded
 *    instead, reloaded when only the fragment differs.
 * 3. One-video mode: on a viewer route (`blocker/viewer.ts`) the input lock (`viewer-lock.ts`) swallows the
 *    wheel, keys and touch moves that would advance the viewer.
 * 4. Fallbacks (`popstate`, `yt-navigate-finish`, a 250 ms poll, a settings change): a viewer that moved
 *    to another video anyway is undone when the Navigation API reported that move as a same-document push,
 *    and otherwise sent back to the first video's page; a blocked URL that is current is replaced by its
 *    allowlisted target; at most 2 redirects per tab in 5 s.
 * 5. A landing that carries `#dwell=<site>` (DNR or a redirect from here) is stripped at once, and counted
 *    once after the settings load, only while that site's blocker is on.
 * 6. On Instagram, the "More posts" under a full single-post page are hidden (`instagram-post.ts`).
 */
import {
  admitRedirect,
  decide,
  decideLock,
  markerCounts,
  type Decision,
  type Fallback,
  type GuardContext,
  type NavigationInfo,
} from '../blocker/decide.ts';
import { classify, siteForHost } from '../blocker/patterns.ts';
import { TARGET_FRAGMENT, isAllowedTarget } from '../blocker/targets.ts';
import { VIEWER_TOGGLE, decideViewerMove, viewerLocked, type ViewerMove } from '../blocker/viewer.ts';
import { DEFAULT_SETTINGS, SETTINGS_KEY, type BlockedSite, type Settings } from '../store/schema.ts';
import { syncPostPage } from './instagram-post.ts';
import { extensionAlive, sendToWorker } from './runtime.ts';
import { setInputLock, startKeyLock } from './viewer-lock.ts';

type Blockers = Settings['blockers'];
type Undo = Extract<Decision, { action: 'undo' }>;

const POLL_MS = 250;
const COUNT_DEDUPE_MS = 1000;
/** How long the poll waits for an undo's Back to land before it treats the move like any other. */
const UNDO_SETTLE_MS = 1000;
/** sessionStorage is per tab and per origin, so the loop guard survives the redirect it caused. */
const LOOP_KEY = 'dwell:redirects';
/** The undo guard's own log, kept like the loop guard's. */
const UNDO_KEY = 'dwell:undos';

let blockers: Blockers = { ...DEFAULT_SETTINGS.blockers };
let loaded = false;
let changedSinceStart = false;
let alive = true;
let markerPending = false;
let lastCountAt = 0;
let lastHref = '';
let watchesPosts = false;
/** The latest navigation the Navigation API reported, so the poll can tell a push from anything else. */
let lastNav: { url: string; nav: NavigationInfo } | null = null;
/** An undo in flight: the page its Back returns to, and until when the poll waits for it. */
let undoing: { from: string; until: number } | null = null;
/** In-memory copies of the two logs, for a page where sessionStorage is blocked. */
const memoryLogs = new Map<string, number[]>();
const cleanups: (() => void)[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Blocker flags from stored settings; a missing or malformed flag falls back to its default, so settings
 * stored before a toggle existed (v0.1.0 has no `xVideos`) read that toggle as on.
 */
function readBlockers(stored: unknown): Blockers {
  const raw: Record<string, unknown> = isRecord(stored) && isRecord(stored.blockers) ? stored.blockers : {};
  const out: Blockers = { ...DEFAULT_SETTINGS.blockers };
  for (const key of Object.keys(out) as (keyof Blockers)[]) {
    const flag = raw[key];
    if (typeof flag === 'boolean') out[key] = flag;
  }
  return out;
}

/** The site's hider stylesheet follows its one-video toggle; X has no stylesheet, its attribute is set all the same. */
function setHiderAttribute(site: BlockedSite): void {
  document.documentElement.setAttribute(`data-dwell-${site}`, blockers[VIEWER_TOGGLE[site]] ? 'on' : 'off');
}

/**
 * The input lock is on exactly while the current URL is a viewer route and its site's toggle is on. On
 * Instagram the single-post page hider follows the Reels toggle and the URL the same way.
 */
function syncPage(): void {
  setInputLock(alive && viewerLocked(location.href, blockers));
  if (watchesPosts) syncPostPage(alive && blockers.instagramReels);
}

function stop(site: BlockedSite): void {
  if (!alive) return;
  alive = false;
  syncPage();
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

function loadLog(key: string): number[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]');
    if (Array.isArray(parsed)) return parsed.filter((t): t is number => typeof t === 'number');
  } catch {
    // Storage blocked or the value is not ours: this document's memory still guards it.
  }
  return memoryLogs.get(key) ?? [];
}

function saveLog(key: string, list: number[]): void {
  memoryLogs.set(key, list);
  try {
    sessionStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Storage blocked: the in-memory copy above still guards this document.
  }
}

/** Loop guard (`admitRedirect`): records one more redirect and returns true, or refuses it. */
function mayRedirect(): boolean {
  const next = admitRedirect({ now: Date.now(), redirects: loadLog(LOOP_KEY) });
  if (next === null) return false;
  saveLog(LOOP_KEY, next);
  return true;
}

/** What a decision reads: the page left, the navigation, the time and both logs. */
function context(from: string, nav: NavigationInfo | null): GuardContext {
  return { from, nav, now: Date.now(), redirects: loadLog(LOOP_KEY), undos: loadLog(UNDO_KEY) };
}

function withoutFragment(url: string): string {
  const hash = url.indexOf('#');
  return hash === -1 ? url : url.slice(0, hash);
}

/**
 * Every redirect the guard makes goes through here, and only to an allowlisted target.
 * Callers have already passed the loop guard, before anything was cancelled. A target that differs from
 * the current URL only by its fragment (a feed tapped on the home page, Facebook's viewer locked on its own
 * reel) would be a same-document jump that leaves the blocked screen drawn, so the page is then replaced
 * and reloaded on that target.
 */
function go(target: string, mode: 'assign' | 'replace'): void {
  if (!alive || !isAllowedTarget(target)) return;
  const sameDocument = withoutFragment(target) === withoutFragment(location.href);
  if (mode === 'replace' || sameDocument) location.replace(target);
  else location.assign(target);
  if (sameDocument) location.reload();
}

/** The load path of a decision: a redirect goes to its target, a cancel that already happened is counted. */
function settleFallback(fallback: Fallback): void {
  if (fallback.action === 'cancel') {
    count(fallback.site);
    return;
  }
  saveLog(LOOP_KEY, fallback.redirects);
  go(fallback.target, 'replace');
}

/** Takes back a push that has committed: Back makes the site's own router draw `from` again. Counted once. */
function goBack(site: BlockedSite, from: string): void {
  undoing = { from, until: Date.now() + UNDO_SETTLE_MS };
  count(site);
  history.back();
}

/**
 * Lets the push commit, then goes back on the next task. When it turns out the push never committed (the
 * page or another listener stopped it), the page may still have drawn its route, so the fallback loads instead.
 */
function undoAfterCommit(event: NavigateEvent, decision: Undo): void {
  const from = location.href;
  const pushed = event.destination.url;
  saveLog(UNDO_KEY, decision.undos);
  undoing = { from, until: Date.now() + UNDO_SETTLE_MS };
  setTimeout(() => {
    if (!alive) return;
    if (location.href === pushed) {
      goBack(decision.site, from);
      return;
    }
    undoing = null;
    settleFallback(decision.fallback);
  }, 0);
}

/** Applies a decision to a cancelable navigation: undo it after it commits, or cancel it and count or load. */
function apply(event: NavigateEvent, decision: Decision, mode: 'assign' | 'replace'): void {
  if (decision.action === 'allow') return;
  if (decision.action === 'undo') {
    undoAfterCommit(event, decision);
    return;
  }
  event.preventDefault();
  if (decision.action === 'cancel') {
    count(decision.site);
    return;
  }
  saveLog(LOOP_KEY, decision.redirects);
  // The target page is the destination (R15); its marker is what gets counted on landing.
  setTimeout(() => go(decision.target, mode), 0);
}

/**
 * While an undo is in flight its own Back goes through, and any other move to another video or to a
 * blocked page is cancelled: the Back already on its way restores the page the undo started from.
 */
function holdDuringUndo(event: NavigateEvent, from: string): void {
  if (event.navigationType === 'traverse') return;
  const destination = event.destination.url;
  if (decideViewerMove(from, destination, blockers).action === 'lock' || classify(destination, blockers) !== null) {
    event.preventDefault();
  }
}

function onNavigate(event: NavigateEvent): void {
  const nav: NavigationInfo = { type: event.navigationType, sameDocument: event.destination.sameDocument };
  lastNav = { url: event.destination.url, nav };
  if (!alive || !event.cancelable) return;
  if (undoing !== null) {
    holdDuringUndo(event, undoing.from);
    return;
  }
  const ctx = context(location.href, nav);
  const move = decideViewerMove(location.href, event.destination.url, blockers);
  if (move.action === 'lock') {
    // Next video in the viewer: undone, or cancelled and the first video's page loaded again.
    apply(event, decideLock(move, ctx), 'replace');
    return;
  }
  apply(event, decide(classify(event.destination.url, blockers), ctx), 'assign');
}

/** Fallback: if the current URL is blocked anyway, replace it with its target. */
function enforceCurrent(): void {
  if (!alive || !loaded) return;
  const hit = classify(location.href, blockers);
  if (hit !== null && mayRedirect()) go(hit.target, 'replace');
}

/**
 * A viewer that moved to another video without being stopped: undone when the Navigation API reported the
 * move as a same-document push, else sent back to the first video's page. Refused by both guards, the
 * first video stays the anchor, so the next poll tries again.
 */
function settleMove(move: ViewerMove, from: string): void {
  const nav = lastNav !== null && lastNav.url === location.href ? lastNav.nav : null;
  const decision = decideLock(move, context(from, nav));
  if (decision.action === 'undo') {
    saveLog(UNDO_KEY, decision.undos);
    lastHref = from;
    goBack(decision.site, from);
  } else if (decision.action === 'redirect') {
    saveLog(LOOP_KEY, decision.redirects);
    go(decision.target, 'replace');
  } else {
    lastHref = from;
  }
}

/**
 * Fallback for every URL change the Navigation API did not stop: a viewer that moved to another video goes
 * back to the first one; anything else blocked goes to its target. Then the input lock and the post page
 * hider follow the URL. While an undo is in flight it waits for the Back to land, for at most UNDO_SETTLE_MS;
 * a Back that never lands leaves the move to the load path.
 */
function settleUrl(): void {
  if (!alive || !loaded) return;
  if (undoing !== null) {
    const landed = location.href === undoing.from;
    if (!landed && Date.now() < undoing.until) return;
    if (!landed) lastNav = null;
    undoing = null;
  }
  const from = lastHref;
  lastHref = location.href;
  const move = decideViewerMove(from, lastHref, blockers);
  if (move.action === 'lock') settleMove(move, from);
  else enforceCurrent();
  syncPage();
}

function tick(site: BlockedSite): void {
  if (!extensionAlive()) {
    stop(site);
    return;
  }
  if (undoing !== null || location.href !== lastHref) settleUrl();
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
  // First on window, before any page script runs: the key lock comes before every key listener the page adds.
  cleanups.push(startKeyLock());
  consumeMarker(site);
  // Defaults until the stored settings arrive: hide first rather than flash a Reels entry.
  setHiderAttribute(site);
  lastHref = location.href;
  watchesPosts = site === 'instagram';

  if ('navigation' in window) {
    const nav = window.navigation;
    nav.addEventListener('navigate', onNavigate);
    cleanups.push(() => nav.removeEventListener('navigate', onNavigate));
  }
  syncPage();
  listen(window, 'popstate', settleUrl);
  listen(window, 'yt-navigate-finish', settleUrl);
  const timer = setInterval(() => tick(site), POLL_MS);
  cleanups.push(() => clearInterval(timer));
  watchSettings(site);
}

const site = siteForHost(location.hostname);
if (site !== null) main(site);
