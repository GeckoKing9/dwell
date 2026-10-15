/**
 * The one script Dwell runs in Instagram's own page (the MAIN world) rather than its isolated world: a
 * bridge to Instagram's router, so a Reel tapped in search or a grid opens in Instagram's own pop-up over
 * the page, the way a post opened from a message does, instead of in the Reels feed. Instagram's router is
 * reachable only from the page itself.
 *
 * It does one thing. On the guard's `dwell:open-post` event with a `/p/<code>/` path, it asks Instagram's
 * router to open that path with the `content` target, the target Instagram's own links use for a pop-up,
 * and only when the page under it is one the router opens pop-ups over. It answers `opened` or `refused` on
 * `<html>`; anything it cannot do is `refused`, and the guard then leaves the tap to Instagram. It reads no
 * page data, has no extension API, and sends nothing anywhere. A page that fires the event itself can only
 * open an Instagram post, which it could do without Dwell.
 */
import { OPENED_ATTR, OPEN_POST_EVENT, isPopUpPath } from '../blocker/post.ts';

interface RouteInfo {
  route?: { isCometRootContainer?: boolean };
}

interface CometRouter {
  getCurrentRouterState(): { main?: RouteInfo; pushViewStack?: RouteInfo[] };
  dispatcher: { go(path: string, options: { target: 'content' }): unknown };
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

/**
 * Opens `path` in Instagram's pop-up when the page on screen hosts pop-ups (a feed, a search, a profile, the
 * messages); true when the router was asked to.
 */
function open(path: string): boolean {
  try {
    const router = cometRouter();
    if (router === null) return false;
    const state = router.getCurrentRouterState();
    const stack = state.pushViewStack ?? [];
    const top = stack.length > 0 ? stack[stack.length - 1] : state.main;
    if (top?.route?.isCometRootContainer !== true) return false;
    router.dispatcher.go(path, { target: 'content' });
    return true;
  } catch {
    // Instagram changed its router: the tap is left to Instagram, as if Dwell were not here.
    return false;
  }
}

document.addEventListener(OPEN_POST_EVENT, (event) => {
  const path = event instanceof CustomEvent ? (event.detail as unknown) : null;
  const opened = typeof path === 'string' && isPopUpPath(path) && open(path);
  document.documentElement.setAttribute(OPENED_ATTR, opened ? 'opened' : 'refused');
});
