/**
 * Pure URL classifier for the blocker (U5), in one-video mode: a single Reel or Short is rewritten to a
 * page that plays only that video, and the feeds go home. No Chrome APIs, no DOM: the guard content
 * script, the DNR ruleset tests and the worker all agree with this function. Matching is
 * case-insensitive on whole path segments and reads only the pathname (never the query or the fragment).
 */
import type { BlockedSite, Settings } from '../store/schema.ts';
import { REDIRECT_TARGETS, REEL_CODE_SOURCE, SHORTS_ID_SOURCE, instagramPostTarget, youtubeWatchTarget } from './targets.ts';

/** `reels`: a Reels feed, sent home. `reel` and `shorts`: one video, rewritten to its single-video page. */
export type BlockKind = 'reels' | 'reel' | 'shorts' | 'explore';

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
};

/** `/reel` or `/reels` as the first path segment: the Reels feed, whatever follows unless it is a code. */
const REEL_FEED = /^\/reels?(?:\/|$)/i;
/** A bare `/reel` or `/reels` as the first path segment, with nothing after it. */
const REEL_FEED_BARE = /^\/reels?\/?$/i;
/**
 * One Instagram Reel: `/reel(s)/<code>` as the end of the path, optionally under one profile segment
 * (`/<user>/reel/<code>`). A deeper path (`/reels/audio/<id>/`, `/reel/<code>/liked_by/`) is not one Reel.
 */
export const INSTAGRAM_REEL = new RegExp(`^/(?:[^/]+/)?reels?/(${REEL_CODE_SOURCE})/?$`, 'i');
const EXPLORE_SEGMENT = /\/explore(?:\/|$)/i;
/** `/shorts/<id>` where the id is exactly one 11-character segment. */
export const SHORTS_SEGMENT = new RegExp(`/shorts/(${SHORTS_ID_SOURCE})(?:/|$)`, 'i');

/** Which of the three sites a hostname belongs to (www, m and bare hosts only), or null. */
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
 * A single Reel goes to its post page, which plays it with no feed below. The Reels feed goes home.
 * A profile's Reels grid (`/<user>/reels/`) is a grid like search, so it loads.
 */
function instagramReels(path: string): Classification | null {
  const code = INSTAGRAM_REEL.exec(path)?.[1];
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
 * The block decision for `url` under the current toggles, or null when the URL may load.
 * Only `https:` URLs on the www, m (YouTube, Facebook) and bare hosts of the three sites can match.
 */
export function classify(url: string, blockers: Blockers): Classification | null {
  const parsed = parse(url);
  if (parsed === null || parsed.protocol !== 'https:') return null;
  const site = siteForHost(parsed.hostname);
  if (site === 'instagram') return instagram(parsed.pathname, blockers);
  if (site === 'youtube') return youtube(parsed.pathname, blockers);
  if (site === 'facebook') return facebook(parsed.pathname, blockers);
  return null;
}
