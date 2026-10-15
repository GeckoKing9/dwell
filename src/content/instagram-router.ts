/**
 * The one script Dwell runs in Instagram's own page (the MAIN world) rather than its isolated world: a
 * bridge to Instagram's router, which is reachable only from the page itself. With it, a Reel opens the way
 * a post from a message does, in Instagram's own pop-up over the page, or at least in the same document,
 * instead of in the Reels feed or a page load.
 *
 * On the guard's `dwell:open-post` event (an `openRequest`: a mode and a `/p/<code>/` path) it asks the
 * router to open the path: with the `content` target, the one Instagram's own links use for its pop-up,
 * when the page under it hosts pop-ups; otherwise, for a `page` request, as an ordinary in-app navigation;
 * for a `swap`, as a navigation that replaces the entry on screen.
 * It answers `pop-up`, `page` or `refused` on `<html>`, and the guard falls back to its usual rules on
 * `refused`. It reads no page data, has no extension API and sends nothing anywhere; a page that fires the
 * event itself can only open an Instagram post, which it could do without Dwell.
 */
import { OPENED_ATTR, OPEN_POST_EVENT, readOpenRequest, type OpenAnswer, type OpenMode } from '../blocker/bridge.ts';

interface RouteInfo {
  route?: { isCometRootContainer?: boolean };
}

/** The navigation options Instagram's own links pass to its router. */
interface GoOptions {
  target?: 'content';
  replace?: boolean;
}

interface CometRouter {
  getCurrentRouterState(): { main?: RouteInfo; pushViewStack?: RouteInfo[] };
  dispatcher: { go(path: string, options: GoOptions): unknown };
}

/** Instagram's router, from its own module registry; null when the page has none or it changed shape. */
function cometRouter(): CometRouter | null {
  const registry = (window as unknown as { require?: unknown }).require;
  if (typeof registry !== 'function') return null;
  const holder: unknown = registry('currentCometRouterInstance');
  if (typeof holder !== 'object' || holder === null) return null;
  const get = (holder as { get_THIS_IS_NOT_WHAT_YOU_WANT?: unknown }).get_THIS_IS_NOT_WHAT_YOU_WANT;
  if (typeof get !== 'function') return null;
  const router: unknown = get.call(holder);
  if (typeof router !== 'object' || router === null) return null;
  const candidate = router as Partial<CometRouter>;
  return typeof candidate.getCurrentRouterState === 'function' && typeof candidate.dispatcher?.go === 'function'
    ? (candidate as CometRouter)
    : null;
}

/** Instagram's router, or null when the page has none or reading it throws. */
function safeRouter(): CometRouter | null {
  try {
    return cometRouter();
  } catch (error) {
    // Instagram changed its router: the request is refused and the guard keeps its usual rules.
    console.error('Dwell: Instagram router not usable', error);
    return null;
  }
}

/** True when the page on screen hosts pop-ups (a feed, a search, a profile, the messages). */
function hostsPopUps(router: CometRouter): boolean {
  try {
    const state = router.getCurrentRouterState();
    const stack = state.pushViewStack ?? [];
    const top = stack.length > 0 ? stack[stack.length - 1] : state.main;
    return top?.route?.isCometRootContainer === true;
  } catch (error) {
    console.error('Dwell: Instagram router state not readable', error);
    return false;
  }
}

/**
 * Asks the router to go to `path`; true when it took the navigation. An error after the router already moved
 * still counts as taken, so nothing navigates on top of it.
 */
function go(router: CometRouter, path: string, options: GoOptions): boolean {
  try {
    const result: unknown = router.dispatcher.go(path, options);
    if (result instanceof Promise) {
      result.catch((error: unknown) => console.error('Dwell: Instagram router could not open the post', error));
    }
    return true;
  } catch (error) {
    console.error('Dwell: Instagram router could not open the post', error);
    return location.pathname === path;
  }
}

function open(mode: OpenMode, path: string): OpenAnswer {
  const router = safeRouter();
  if (router === null) return 'refused';
  // The entry on screen is the one Instagram just moved to: replace it, so its history and the browser's agree.
  if (mode === 'swap') return go(router, path, { replace: true }) ? 'page' : 'refused';
  if (hostsPopUps(router)) return go(router, path, { target: 'content' }) ? 'pop-up' : 'refused';
  if (mode === 'page') return go(router, path, {}) ? 'page' : 'refused';
  return 'refused';
}

document.addEventListener(OPEN_POST_EVENT, (event) => {
  const request = readOpenRequest(event instanceof CustomEvent ? (event.detail as unknown) : null);
  document.documentElement.setAttribute(OPENED_ATTR, request === null ? 'refused' : open(request.mode, request.path));
});
