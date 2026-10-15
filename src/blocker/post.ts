/**
 * Pure rules for Instagram's full single-post page (`/p/<code>`, `/reel/<code>`, also under a profile
 * segment): which post it shows, and which links point at other posts, such as the "More posts from"
 * grid under it. Paths and link addresses only; no DOM, no visible text, so it works in every language.
 */
import { siteForHost } from './patterns.ts';
import { REEL_CODE_SOURCE } from './targets.ts';

/** Fewer links to other posts than this is not a "More posts" grid, so nothing is hidden. */
export const MIN_OTHER_POSTS = 3;

/** A single-post path: `/p/<code>` or `/reel/<code>`, optionally under one profile segment. */
const SINGLE_POST = new RegExp(`^/(?:[^/]+/)?(?:p|reel)/(${REEL_CODE_SOURCE})/?$`, 'i');
/** A link to one post: `/p/`, `/reel/` or `/reels/` and a code, optionally under one profile segment. */
const POST_LINK = new RegExp(`^/(?:[^/]+/)?(?:p|reels?)/(${REEL_CODE_SOURCE})/?$`, 'i');

/** The code of the post a single-post path shows, or null when the path is not one. */
export function singlePostCode(path: string): string | null {
  return SINGLE_POST.exec(path)?.[1] ?? null;
}

/**
 * True when `url` (an absolute link address) opens an Instagram post other than `current`. Codes compare
 * exactly: Instagram codes are case-sensitive.
 */
export function isOtherPostLink(url: string, current: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not an absolute URL: not a link this page resolved to a post.
    return false;
  }
  if (parsed.protocol !== 'https:' || siteForHost(parsed.hostname) !== 'instagram') return false;
  const code = POST_LINK.exec(parsed.pathname)?.[1];
  return code !== undefined && code !== current;
}
