/**
 * Pure decisions for the guard content script (KTD4, KTD4b): what to do with an in-page navigation,
 * the loop guard, and whether a `#dwell=<site>` landing counts. No Chrome APIs, no DOM, no clock:
 * the guard passes in the time and the redirect and undo logs it keeps in sessionStorage.
 *
 * Cancelling alone does not stop a single-page app: when a `pushState` is cancelled the URL stays, but the
 * app's router has usually drawn (or still draws) the new route, so the blocked screen shows under the old
 * URL. So every block ends in a real page load or in an undo, and a bare cancel is only the last resort
 * when the loop guard refuses both.
 */
import type { BlockedSite, Settings } from '../store/schema.ts';
import type { BlockKind, Classification } from './patterns.ts';
import { isAllowedTarget } from './targets.ts';
import type { ViewerMove } from './viewer.ts';

type Blockers = Settings['blockers'];

export const LOOP_WINDOW_MS = 5000;
export const LOOP_MAX_REDIRECTS = 2;

/** The redirects this tab already made (epoch ms) and the current time. */
export interface LoopState {
  now: number;
  redirects: readonly number[];
}

/** The Navigation API's `navigationType`, kept as a plain union so this module needs no DOM types. */
export type NavigationKind = 'push' | 'replace' | 'reload' | 'traverse';

/** What the guard knows about the navigation: its type and whether it stays in the current document. */
export interface NavigationInfo {
  type: NavigationKind;
  sameDocument: boolean;
}

/**
 * Everything a decision reads: the page the navigation leaves, the navigation (null when the change was
 * seen only after it committed and how it happened is not known), the time, the redirect log and the undo log.
 */
export interface GuardContext extends LoopState {
  from: string;
  nav: NavigationInfo | null;
  undos: readonly number[];
}

/** The hard-load path: go to `target`, or, when the loop guard refuses, cancel and count in place. */
export type Fallback = { action: 'cancel'; site: BlockedSite } | { action: 'redirect'; target: string; redirects: number[] };

/**
 * `allow`: let the navigation proceed untouched. `cancel`: cancel it and count a block for `site`.
 * `redirect`: cancel it, store `redirects` as the new loop log, then load `target`.
 * `undo`: let the push commit, store `undos` as the new undo log, then go back one entry so the site's
 * own router draws the previous page again, with no reload; count once. `fallback` is what to do instead
 * when the push turns out not to have committed.
 */
export type Decision = { action: 'allow' } | Fallback | { action: 'undo'; site: BlockedSite; undos: number[]; fallback: Fallback };

/** Kinds rewritten to a single-video page; the others (feeds, Explore) go home. */
const REWRITTEN: ReadonlySet<BlockKind> = new Set(['shorts', 'reel', 'video']);

/** The site's toggles that put a `#dwell=<site>` marker on a landing. */
const SITE_TOGGLES: Readonly<Record<BlockedSite, readonly (keyof Blockers)[]>> = {
  instagram: ['instagramReels', 'instagramExplore'],
  youtube: ['youtubeShorts'],
  facebook: ['facebookReels'],
  x: ['xVideos'],
};

/** The entries of the log inside the window that ends now. */
function recent(loop: LoopState): number[] {
  return loop.redirects.filter((t) => loop.now - t >= 0 && loop.now - t < LOOP_WINDOW_MS);
}

/**
 * Loop guard: at most LOOP_MAX_REDIRECTS redirects per tab within LOOP_WINDOW_MS. Returns the log
 * with `now` added when one more redirect is allowed, or null when it is not. The undo guard reuses it
 * with its own log.
 */
export function admitRedirect(loop: LoopState): number[] | null {
  const kept = recent(loop);
  return kept.length >= LOOP_MAX_REDIRECTS ? null : [...kept, loop.now];
}

/** When `admitRedirect` admits one more entry to the log: `now` when it already does. */
export function admitsAt(loop: LoopState): number {
  const blocking = recent(loop).sort((a, b) => b - a)[LOOP_MAX_REDIRECTS - 1];
  return blocking === undefined ? loop.now : blocking + LOOP_WINDOW_MS;
}

/**
 * Host, path (any trailing slash dropped) and query: the fragment does not make another page, the query
 * can (a YouTube watch page is `/watch?v=<id>`). The guard's one rule for the page already open.
 */
function pageOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`;
  } catch {
    // Not an absolute URL: it is no page the guard could be on.
    return null;
  }
}

export function samePage(a: string, b: string): boolean {
  const page = pageOf(a);
  return page !== null && page === pageOf(b);
}

/** Load `target` when the allowlist and the loop guard admit it; otherwise cancel and count in place. */
function redirectOrCancel(site: BlockedSite, target: string, ctx: GuardContext): Fallback {
  const redirects = isAllowedTarget(target) ? admitRedirect(ctx) : null;
  return redirects === null ? { action: 'cancel', site } : { action: 'redirect', target, redirects };
}

/**
 * Undo a same-document push when the undo guard admits it (at most 2 per tab in 5 s, its own log):
 * the push commits and Back takes it away again. A replace, a traverse, a cross-document navigation, a
 * change of unknown kind, or a refused undo takes `fallback`.
 */
function undoOr(site: BlockedSite, ctx: GuardContext, fallback: Fallback): Decision {
  const pushed = ctx.nav !== null && ctx.nav.type === 'push' && ctx.nav.sameDocument;
  const undos = pushed ? admitRedirect({ now: ctx.now, redirects: ctx.undos }) : null;
  return undos === null ? fallback : { action: 'undo', site, undos, fallback };
}

/**
 * What the guard does with a cancelable in-page navigation the classifier judged as `hit`.
 * A Reels feed and Explore are cancelled and the site's home page is loaded instead, counted on landing;
 * only when the loop guard refuses that load is the cancel left alone, counted in place.
 * A Short, the Instagram Reels scroller on one Reel or an X video viewer is cancelled and its single-video
 * page loaded, but only when the loop guard admits that redirect: otherwise the tap goes through (and the
 * viewer lock keeps that viewer to the one video). When that page is the one already open (the video of
 * the tweet being read), the push is undone instead, so nothing is reloaded; failing that, the page is
 * reloaded.
 */
export function decide(hit: Classification | null, ctx: GuardContext): Decision {
  if (hit === null) return { action: 'allow' };
  if (!REWRITTEN.has(hit.kind)) return redirectOrCancel(hit.site, hit.target, ctx);
  if (!isAllowedTarget(hit.target)) return { action: 'allow' };
  if (samePage(hit.target, ctx.from)) return undoOr(hit.site, ctx, redirectOrCancel(hit.site, hit.target, ctx));
  const redirects = admitRedirect(ctx);
  return redirects === null ? { action: 'allow' } : { action: 'redirect', target: hit.target, redirects };
}

/**
 * What the guard does with a move from one viewer video to another (`decideViewerMove`). A same-document
 * push is undone: it commits, and Back makes the site's own router draw the first video again. Anything
 * else is cancelled and the tab goes back to the first video's page by a load, because a viewer can draw
 * the next video before it changes the URL; when the loop guard or the allowlist refuses that load, the
 * cancel stands alone and is counted in place.
 */
export function decideLock(move: ViewerMove, ctx: GuardContext): Decision {
  if (move.action === 'allow') return { action: 'allow' };
  return undoOr(move.site, ctx, redirectOrCancel(move.site, move.target, ctx));
}

/** A `#dwell=<site>` landing counts only while one of that site's blockers is on. */
export function markerCounts(site: BlockedSite, blockers: Blockers): boolean {
  return SITE_TOGGLES[site].some((toggle) => blockers[toggle]);
}
