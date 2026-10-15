/**
 * Pure URL classifier for the blocker (U5). No Chrome APIs, no DOM: the guard content script, the DNR
 * ruleset tests and the worker all agree with this function. Matching is case-insensitive and unanchored
 * on the path, on whole path segments, and reads only the pathname (never the query or the fragment).
 */
import type { BlockedSite, Settings } from '../store/schema.ts';
import { REDIRECT_TARGETS, SHORTS_ID_SOURCE, youtubeWatchTarget } from './targets.ts';

export type BlockKind = 'reels' | 'shorts' | 'explore';

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

/** `/reel` or `/reels` as a whole path segment, anywhere in the path (`/someuser/reels/` counts). */
const REEL_SEGMENT = /\/reels?(?:\/|$)/i;
const EXPLORE_SEGMENT = /\/explore(?:\/|$)/i;
/** `/shorts/<id>` where the id is exactly one 11-character segment. */
const SHORTS_SEGMENT = new RegExp(`/shorts/(${SHORTS_ID_SOURCE})(?:/|$)`, 'i');

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

function instagram(path: string, blockers: Blockers): Classification | null {
  if (blockers.instagramReels && REEL_SEGMENT.test(path)) {
    return { site: 'instagram', kind: 'reels', target: REDIRECT_TARGETS.instagram };
  }
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

function facebook(path: string, blockers: Blockers): Classification | null {
  if (!blockers.facebookReels || !REEL_SEGMENT.test(path)) return null;
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
