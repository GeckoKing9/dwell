/**
 * One-video mode for a site's own short-video viewer: pure decisions only, no Chrome APIs, no DOM.
 *
 * A viewer route shows one video and swipes to the next by changing the URL: YouTube `/shorts/<id>`,
 * Instagram `/reel(s)/<code>` (also under a profile segment), Facebook `/reel/<id>`, X
 * `/<user>/status/<id>/video/<n>` (keyed by the status id). Entering a viewer is
 * allowed (that is the one video); leaving it for any other page is allowed; moving from one video to
 * another inside the viewer is not, and the tab goes back to the first video's single-video page.
 */
import type { BlockedSite, Settings } from '../store/schema.ts';
import { INSTAGRAM_REEL, INSTAGRAM_SINGLE_REEL, SHORTS_SEGMENT, X_VIDEO, siteForHost } from './patterns.ts';
import { FACEBOOK_REEL_ID_SOURCE, facebookReelTarget, instagramPostTarget, xTweetTarget, youtubeWatchTarget } from './targets.ts';

type Blockers = Settings['blockers'];

export interface ViewerKey {
  site: BlockedSite;
  key: string;
  /** X only: the username in the viewer's path, as written, for the tweet page the lock goes back to. */
  owner?: string;
}

/** `allow`: let the move happen. `lock`: stop it and send the tab to `target`, the first video's page. */
export type ViewerMove = { action: 'allow' } | { action: 'lock'; site: BlockedSite; target: string };

/** The toggle that turns one-video mode on for each site's viewer. */
export const VIEWER_TOGGLE: Readonly<Record<BlockedSite, keyof Blockers>> = Object.freeze({
  instagram: 'instagramReels',
  youtube: 'youtubeShorts',
  facebook: 'facebookReels',
  x: 'xVideos',
});

/** Facebook's viewer: `/reel/<digits>` as the first path segment. */
const FACEBOOK_REEL = new RegExp(`^/reel/(${FACEBOOK_REEL_ID_SOURCE})(?:/|$)`, 'i');

const VIEWER_PATH: Readonly<Record<BlockedSite, RegExp>> = {
  instagram: INSTAGRAM_REEL,
  youtube: SHORTS_SEGMENT,
  facebook: FACEBOOK_REEL,
  x: X_VIDEO,
};

/** The key in a viewer path that matched: the first capture, except on X (user, then status id). */
function keyFrom(site: BlockedSite, match: RegExpExecArray): ViewerKey | null {
  if (site !== 'x') return match[1] === undefined ? null : { site, key: match[1] };
  const [, owner, key] = match;
  return owner === undefined || key === undefined ? null : { site, key, owner };
}

/** Which viewer video `url` shows, or null when it is not a viewer route on one of the four sites. */
export function viewerKey(url: string): ViewerKey | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not an absolute URL: it cannot be a viewer route.
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const site = siteForHost(parsed.hostname);
  if (site === null) return null;
  const match = VIEWER_PATH[site].exec(parsed.pathname);
  return match === null ? null : keyFrom(site, match);
}

/** The reel a Facebook viewer address shows, or null: the machine's rule for which Facebook moves it puts back. */
export function facebookReelCode(url: string): string | null {
  const viewer = viewerKey(url);
  return viewer?.site === 'facebook' ? viewer.key : null;
}

/**
 * The allowlisted single-video page for one viewer key, or null when the key is not valid for the site.
 * On X it is the tweet page under `owner`, or under `i` when the owner is not known.
 */
export function lockTarget(site: BlockedSite, key: string, owner = 'i'): string | null {
  if (site === 'youtube') return youtubeWatchTarget(key);
  if (site === 'instagram') return instagramPostTarget(key);
  if (site === 'x') return xTweetTarget(owner, key);
  return facebookReelTarget(key);
}

/** True while `url` is a viewer route with a feed to swipe through and its site's toggle is on: the input lock applies. */
export function viewerLocked(url: string, blockers: Blockers): boolean {
  const viewer = viewerKey(url);
  if (viewer === null || !blockers[VIEWER_TOGGLE[viewer.site]]) return false;
  // A single Instagram Reel is a post (its page or Instagram's pop-up), with a caption and comments to
  // scroll; only a move to another Reel is stopped there, by `decideViewerMove`.
  return !(viewer.site === 'instagram' && INSTAGRAM_SINGLE_REEL.test(new URL(url).pathname));
}

/**
 * A move from `fromUrl` to `toUrl`: locked only when both are viewer routes of the same site with
 * different keys and that site's toggle is on. Keys compare exactly (Instagram codes are case-sensitive);
 * on X the key is the status id, so another video of the same tweet is not a move.
 */
export function decideViewerMove(fromUrl: string, toUrl: string, blockers: Blockers): ViewerMove {
  const from = viewerKey(fromUrl);
  const to = viewerKey(toUrl);
  if (from === null || to === null || from.site !== to.site || from.key === to.key) return { action: 'allow' };
  if (!blockers[VIEWER_TOGGLE[from.site]]) return { action: 'allow' };
  const target = lockTarget(from.site, from.key, from.owner);
  return target === null ? { action: 'allow' } : { action: 'lock', site: from.site, target };
}
