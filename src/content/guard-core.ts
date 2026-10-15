/**
 * In-page navigation guard for short-video routes (KTD4, KTD4b): the adapter on every site. Isolated world,
 * document_start, top frame, on the four sites only (Instagram, YouTube, Facebook, X). It hands the page's
 * navigations (`navigate`), its URL commits (`currententrychange`), its own settings and the timers the
 * machine asks for to the pure state machine (`blocker/guard-machine.ts`), and carries out what comes back.
 * It reads `location`, its own settings and its own loop-guard and undo logs (`guard-logs.ts`), and sends
 * only `{ type: 'blocked', site }`. Nothing else from the page is read or sent.
 *
 * Importing it starts nothing: each site's entry does, `guard.ts` on YouTube, Facebook and X, and
 * `guard-instagram.ts` with the pieces only Instagram needs.
 */
import { samePage } from '../blocker/decide.ts';
import { start, step, type Effect, type GuardState, type Input, type Moment, type PostCode } from '../blocker/guard-machine.ts';
import { TARGET_FRAGMENT, isAllowedTarget } from '../blocker/targets.ts';
import { SETTINGS_KEY, type BlockedSite, type Settings } from '../store/schema.ts';
import { readLogs, saveLog } from './guard-logs.ts';
import { extensionAlive, sendToWorker } from './runtime.ts';
import { setInputLock, startKeyLock } from './viewer-lock.ts';

/** What the guard lends a site's own pieces. */
export interface GuardPort {
  /** The blockers once the stored settings are known; null before that and after the guard stops. */
  blockers(): Settings['blockers'] | null;
  /** Reports one block, at most once a second. */
  count(site: BlockedSite): void;
  /** A post Instagram's router opened (`code`, the post it shows): a move from it to another post is undone. */
  opened(code: string | null): void;
}

/** What a site adds to the guard (Instagram: `guard-instagram.ts`). */
export interface SiteHooks {
  /** The machine's post rule: which post an address shows. */
  postCode: PostCode;
  /** Opens an allowlisted target in this document instead of loading it (`replace`: in place of the entry on screen); true when it did. */
  openInPlace(target: string, mode: 'assign' | 'replace'): boolean;
  /** Follows the URL and the settings: on while the site's own pieces apply, off once the guard stops. */
  sync(on: boolean): void;
  stop(): void;
}

const COUNT_DEDUPE_MS = 1000;

let state: GuardState;
let hooks: SiteHooks | null = null;
let alive = true;
let lastCountAt = 0;
const cleanups: (() => void)[] = [];

function moment(): Moment {
  return { here: location.href, now: Date.now(), logs: readLogs };
}

/** Reports one block: at most once a second, except a landing's marker, which is reported as it is. */
function count(site: BlockedSite, landing = false): void {
  if (!landing) {
    const now = Date.now();
    if (now - lastCountAt < COUNT_DEDUPE_MS) return;
    lastCountAt = now;
  }
  sendToWorker({ type: 'blocked', site }, stop);
}

/**
 * Every load the guard makes goes through here, and only to an allowlisted target. A target on the page
 * already open (`samePage`: a feed tapped on the home page, Facebook's viewer locked on its own reel) would
 * be a jump within this document that leaves the blocked screen drawn, so the address is set to the target
 * and the page reloaded on it. A site may open the target in this document instead (Instagram's router).
 */
function go(target: string, mode: 'assign' | 'replace'): void {
  if (!alive || !isAllowedTarget(target)) return;
  if (samePage(target, location.href)) {
    history.replaceState(history.state, '', target);
    location.reload();
  } else if (hooks?.openInPlace(target, mode) !== true) {
    if (mode === 'replace') location.replace(target);
    else location.assign(target);
  }
}

function perform(effect: Effect, event: NavigateEvent | undefined): void {
  switch (effect.type) {
    case 'cancel':
      return event?.preventDefault();
    case 'count':
      return count(effect.site, effect.landing);
    case 'load':
      if (effect.deferred) setTimeout(() => go(effect.target, effect.mode), 0);
      else go(effect.target, effect.mode);
      return;
    case 'back':
      return history.back();
    case 'later':
      setTimeout(() => dispatch({ ...moment(), ...effect.input }), effect.after);
      return;
    case 'saveLog':
      return saveLog(effect.log, effect.times);
    case 'hider':
      return document.documentElement.setAttribute(`data-dwell-${state.site}`, effect.on ? 'on' : 'off');
    case 'sync':
      setInputLock(effect.lock);
      return hooks?.sync(effect.posts);
  }
}

function dispatch(input: Input, event?: NavigateEvent): void {
  if (!alive) return;
  // A reloaded or removed extension leaves this script orphaned; it lets go of the page at its next event.
  if (!extensionAlive()) {
    stop();
    return;
  }
  const next = step(state, input);
  state = next.state;
  for (const effect of next.effects) perform(effect, event);
}

function stop(): void {
  if (!alive) return;
  alive = false;
  setInputLock(false);
  hooks?.sync(false);
  for (const cleanup of cleanups.splice(0)) {
    try {
      cleanup();
    } catch {
      // The extension context is already gone; there is nothing left to detach.
    }
  }
  document.documentElement.removeAttribute(`data-dwell-${state.site}`);
}

/** A redirect landing: the marker is stripped before the page's own scripts run, and counted once the settings load. */
function stripMarker(site: BlockedSite): boolean {
  if (location.hash !== TARGET_FRAGMENT[site]) return false;
  history.replaceState(history.state, '', location.pathname + location.search);
  return true;
}

function watchNavigation(): void {
  const onNavigate = (event: NavigateEvent): void => {
    const { url, sameDocument } = event.destination;
    const nav = { destination: url, navigationType: event.navigationType, sameDocument, cancelable: event.cancelable };
    dispatch({ type: 'navigate', ...moment(), ...nav }, event);
  };
  // Every same-document URL commit: the page's pushState and replaceState, Back and Forward, a fragment.
  const onCommit = (): void => dispatch({ type: 'settle', ...moment() });
  navigation.addEventListener('navigate', onNavigate);
  navigation.addEventListener('currententrychange', onCommit);
  cleanups.push(() => {
    navigation.removeEventListener('navigate', onNavigate);
    navigation.removeEventListener('currententrychange', onCommit);
  });
}

function watchSettings(): void {
  const settings = (stored: unknown, initial: boolean): void => dispatch({ type: 'settings', ...moment(), stored, initial });
  const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: chrome.storage.AreaName): void => {
    if (area === 'local' && Object.hasOwn(changes, SETTINGS_KEY)) settings(changes[SETTINGS_KEY]?.newValue, false);
  };
  chrome.storage.onChanged.addListener(onChanged);
  cleanups.push(() => chrome.storage.onChanged.removeListener(onChanged));
  chrome.storage.local.get(SETTINGS_KEY).then(
    (items) => settings(items[SETTINGS_KEY], true),
    () => settings(undefined, true),
  );
}

/** Starts the guard on `site`, with the site's own pieces when it has some. */
export function startGuard(site: BlockedSite, siteHooks?: (guard: GuardPort) => SiteHooks): void {
  // First on window, before any page script runs: the key lock comes before every key listener the page adds.
  cleanups.push(startKeyLock());
  const marker = stripMarker(site);
  // The site's pieces before the machine, which starts with their post rule; the port reads the state only when called.
  if (siteHooks !== undefined) {
    const own = siteHooks({
      blockers: () => (alive && state.loaded ? state.blockers : null),
      count: (blocked) => count(blocked),
      opened: (code) => dispatch({ type: 'opened', ...moment(), code }),
    });
    hooks = own;
    cleanups.push(() => own.stop());
  }
  const begun = start(site, location.href, marker, hooks?.postCode);
  state = begun.state;
  watchNavigation();
  // Defaults until the stored settings arrive: hide first rather than flash a Reels entry.
  for (const effect of begun.effects) perform(effect, undefined);
  watchSettings();
}
