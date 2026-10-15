/**
 * Pure URL classifier for the blocker (U5), in one-video mode: a Short, the Instagram Reels scroller on one
 * Reel and X's video viewer are rewritten to a page that plays only that video, and the feeds go home. A
 * single Instagram Reel (`/reel/<code>`) loads: Instagram shows it in its own pop-up or post page. No Chrome
 * APIs, no DOM: the guard content script, the DNR ruleset tests and the worker all agree with this function.
 * Matching is case-insensitive on whole path segments and reads only the pathname (never the query or the
 * fragment).
 */
import type { BlockedSite, Settings } from '../store/schema.ts';
import {
  REDIRECT_TARGETS,
  REEL_CODE_SOURCE,
  SHORTS_ID_SOURCE,
  X_STATUS_ID_SOURCE,
  X_USER_SOURCE,
  instagramPostTarget,
  xTweetTarget,
  youtubeWatchTarget,
} from './targets.ts';

/**
 * `reels`: a Reels feed, sent home. `reel` (Instagram's Reels scroller on one Reel), `shorts` and `video`
 * (X's video viewer): one video, rewritten to its single-video page.
 */
export type BlockKind = 'reels' | 'reel' | 'shorts' | 'video' | 'explore';

export interface Classification {
  site: BlockedSite;
  kind: BlockKind;
  target: string;
}

type Blockers = Settings['blockers'];

const HOSTS: Readonly<Record<BlockedSite, readonly string[]>> = {
  instagram: ['instagram.com', 'www.instagram.com'],
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com'],
  facebook: ['facebook.com', 'www.facebook.com', 'm.facebook.com'],
  // x.com only: twitter.com, www.x.com and mobile.x.com redirect to x.com on the server, so a page only
  // ever runs on x.com and the redirect's next request meets the x.com rules there.
  x: ['x.com'],
};

/** `/reel` or `/reels` as the first path segment: the Reels feed, whatever follows unless it is a code. */
const REEL_FEED = /^\/reels?(?:\/|$)/i;
/** A bare `/reel` or `/reels` as the first path segment, with nothing after it. */
const REEL_FEED_BARE = /^\/reels?\/?$/i;
/**
 * One Instagram Reel in a viewer: `/reel(s)/<code>` as the end of the path, optionally under one profile
 * segment (`/<user>/reel/<code>`). A deeper path (`/reels/audio/<id>/`, `/reel/<code>/liked_by/`) is not one Reel.
 */
export const INSTAGRAM_REEL = new RegExp(`^/(?:[^/]+/)?reels?/(${REEL_CODE_SOURCE})/?$`, 'i');
/** The Reels scroller opened on one Reel: plural `/reels/<code>`, optionally under one profile segment. */
const INSTAGRAM_REELS_CODE = new RegExp(`^/(?:[^/]+/)?reels/(${REEL_CODE_SOURCE})/?$`, 'i');
/** A single Reel: singular `/reel/<code>`, optionally under one profile segment. It loads untouched. */
export const INSTAGRAM_SINGLE_REEL = new RegExp(`^/(?:[^/]+/)?reel/${REEL_CODE_SOURCE}/?$`, 'i');
const EXPLORE_SEGMENT = /\/explore(?:\/|$)/i;
/** `/shorts/<id>` where the id is exactly one 11-character segment. */
export const SHORTS_SEGMENT = new RegExp(`/shorts/(${SHORTS_ID_SOURCE})(?:/|$)`, 'i');
/**
 * X's immersive video viewer: `/<user>/status/<id>/video/<n>` as the whole path (`<user>` may be `i`).
 * Captures the user as written and the status id. `/photo/<n>` and every other status path stay out.
 */
export const X_VIDEO = new RegExp(`^/(${X_USER_SOURCE})/status/(${X_STATUS_ID_SOURCE})/video/[0-9]+/?$`, 'i');

/** Which of the four sites a hostname belongs to (the hosts listed above only), or null. */
export function siteForHost(hostname: string): BlockedSite | null {
  for (const site of Object.keys(HOSTS) as BlockedSite[]) {
    if (HOSTS[site].includes(hostname)) return site;
  }
  return null;
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    // Not an absolute URL: nothing to classify, so nothing to block.
    return null;
  }
}

/**
 * A single Reel (`/reel/<code>`) loads: in the app it opens in Instagram's own pop-up over the page, and a
 * hard load shows Instagram's single post page. The Reels scroller on one Reel (`/reels/<code>`) goes to
 * that Reel's post page, which plays it with no feed below. The Reels feed goes home, and so does any
 * other path under `/reel` or `/reels`. A profile's Reels grid (`/<user>/reels/`) is a grid like search,
 * so it loads.
 */
function instagramReels(path: string): Classification | null {
  if (INSTAGRAM_SINGLE_REEL.test(path)) return null;
  const code = INSTAGRAM_REELS_CODE.exec(path)?.[1];
  const target = code === undefined ? null : instagramPostTarget(code);
  if (target !== null) return { site: 'instagram', kind: 'reel', target };
  return REEL_FEED.test(path) ? { site: 'instagram', kind: 'reels', target: REDIRECT_TARGETS.instagram } : null;
}

function instagram(path: string, blockers: Blockers): Classification | null {
  const reels = blockers.instagramReels ? instagramReels(path) : null;
  if (reels !== null) return reels;
  if (blockers.instagramExplore && EXPLORE_SEGMENT.test(path)) {
    return { site: 'instagram', kind: 'explore', target: REDIRECT_TARGETS.instagram };
  }
  return null;
}

function youtube(path: string, blockers: Blockers): Classification | null {
  if (!blockers.youtubeShorts) return null;
  const id = SHORTS_SEGMENT.exec(path)?.[1];
  const target = id === undefined ? null : youtubeWatchTarget(id);
  return target === null ? null : { site: 'youtube', kind: 'shorts', target };
}

/**
 * Only the bare Reels feed goes home. `/reel/<id>` loads: Facebook has no verified single-video page,
 * so its own viewer is kept to that one reel by the viewer lock (`viewer.ts`) instead.
 */
function facebook(path: string, blockers: Blockers): Classification | null {
  if (!blockers.facebookReels || !REEL_FEED_BARE.test(path)) return null;
  return { site: 'facebook', kind: 'reels', target: REDIRECT_TARGETS.facebook };
}

/**
 * X's video viewer goes to the tweet it belongs to, which plays that one video inline with the replies
 * below and no feed of other videos. Everything else on X loads.
 */
function x(path: string, blockers: Blockers): Classification | null {
  if (!blockers.xVideos) return null;
  const match = X_VIDEO.exec(path);
  const target = match?.[1] === undefined || match[2] === undefined ? null : xTweetTarget(match[1], match[2]);
  return target === null ? null : { site: 'x', kind: 'video', target };
}

/**
 * The block decision for `url` under the current toggles, or null when the URL may load.
 * Only `https:` URLs on the www, m (YouTube, Facebook) and bare hosts of the three video sites, and on
 * x.com, can match.
 */
export function classify(url: string, blockers: Blockers): Classification | null {
  const parsed = parse(url);
  if (parsed === null || parsed.protocol !== 'https:') return null;
  const site = siteForHost(parsed.hostname);
  if (site === 'instagram') return instagram(parsed.pathname, blockers);
  if (site === 'youtube') return youtube(parsed.pathname, blockers);
  if (site === 'facebook') return facebook(parsed.pathname, blockers);
  if (site === 'x') return x(parsed.pathname, blockers);
  return null;
}
