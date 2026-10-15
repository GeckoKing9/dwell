/**
 * Pure decisions for the guard content script (KTD4, KTD4b): what to do with an in-page navigation,
 * the loop guard, and whether a `#dwell=<site>` landing counts. No Chrome APIs, no DOM, no clock:
 * the guard passes in the time and the redirect log it keeps in sessionStorage.
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

/**
 * `allow`: let the navigation proceed untouched. `cancel`: cancel it and count a block for `site`.
 * `redirect`: cancel it, store `redirects` as the new loop log, then go to `target`.
 */
export type Decision =
  | { action: 'allow' }
  | { action: 'cancel'; site: BlockedSite }
  | { action: 'redirect'; target: string; redirects: number[] };

/** Kinds rewritten to a single-video page rather than cancelled in place. */
const REWRITTEN: ReadonlySet<BlockKind> = new Set(['shorts', 'reel', 'video']);

/** The site's toggles that put a `#dwell=<site>` marker on a landing. */
const SITE_TOGGLES: Readonly<Record<BlockedSite, readonly (keyof Blockers)[]>> = {
  instagram: ['instagramReels', 'instagramExplore'],
  youtube: ['youtubeShorts'],
  facebook: ['facebookReels'],
  x: ['xVideos'],
};

/**
 * Loop guard: at most LOOP_MAX_REDIRECTS redirects per tab within LOOP_WINDOW_MS. Returns the log
 * with `now` added when one more redirect is allowed, or null when it is not.
 */
export function admitRedirect(loop: LoopState): number[] | null {
  const recent = loop.redirects.filter((t) => loop.now - t >= 0 && loop.now - t < LOOP_WINDOW_MS);
  return recent.length >= LOOP_MAX_REDIRECTS ? null : [...recent, loop.now];
}

/**
 * What the guard does with a cancelable in-page navigation the classifier judged as `hit`.
 * A Reels feed and Explore are cancelled in place and counted. A single Reel, Short or X video viewer is
 * cancelled only when its redirect to the single-video page will happen: when the loop guard or the allowlist refuses
 * it, the tap goes through (and the viewer lock keeps that viewer to the one video).
 */
export function decide(hit: Classification | null, loop: LoopState): Decision {
  if (hit === null) return { action: 'allow' };
  if (!REWRITTEN.has(hit.kind)) return { action: 'cancel', site: hit.site };
  if (!isAllowedTarget(hit.target)) return { action: 'allow' };
  const redirects = admitRedirect(loop);
  return redirects === null ? { action: 'allow' } : { action: 'redirect', target: hit.target, redirects };
}

/**
 * What the guard does with a move from one viewer video to another (`decideViewerMove`). The move is
 * always cancelled. The tab then goes back to the first video's page, because some viewers draw the next
 * video before they change the URL; when the loop guard or the allowlist refuses that redirect, the
 * cancel stands alone and is counted in place.
 */
export function decideLock(move: ViewerMove, loop: LoopState): Decision {
  if (move.action === 'allow') return { action: 'allow' };
  const redirects = isAllowedTarget(move.target) ? admitRedirect(loop) : null;
  return redirects === null ? { action: 'cancel', site: move.site } : { action: 'redirect', target: move.target, redirects };
}

/** A `#dwell=<site>` landing counts only while one of that site's blockers is on. */
export function markerCounts(site: BlockedSite, blockers: Blockers): boolean {
  return SITE_TOGGLES[site].some((toggle) => blockers[toggle]);
}
