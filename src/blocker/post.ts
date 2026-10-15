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

/** The gap Instagram's own pop-up leaves around a post, in CSS pixels. */
export const POP_UP_MARGIN_PX = 24;
/** Kept clear on each side of the post, so the close button at the window's top right never covers it. */
export const POP_UP_EDGE_PX = 64;
/** The width of the comments column beside the media in Instagram's pop-up. */
export const POP_UP_SIDE_PX = 405;
/** Short videos are vertical: the shape assumed until the video reports its own. */
const DEFAULT_RATIO = 9 / 16;

/**
 * The size of a post shown the way Instagram's pop-up shows it: as tall as the window allows less the
 * margin, the media at the video's own width-to-height `ratio`, the comments column beside it, and never
 * wider than the window less POP_UP_EDGE_PX on each side.
 */
export function popUpBox(view: { width: number; height: number }, ratio: number): { width: number; height: number } {
  const shape = Number.isFinite(ratio) && ratio > 0 ? ratio : DEFAULT_RATIO;
  const height = Math.max(0, view.height - 2 * POP_UP_MARGIN_PX);
  const width = Math.max(0, Math.min(view.width - 2 * POP_UP_EDGE_PX, Math.round(height * shape) + POP_UP_SIDE_PX));
  return { width, height };
}

/**
 * Where closing the pop-up goes: `back` to the Instagram page the post was opened from (a search, a
 * profile), or `stay` on the post with the pop-up lifted when there is none (a link from another site).
 */
export function leaveBy(historyLength: number, referrer: string): 'back' | 'stay' {
  let from: URL;
  try {
    from = new URL(referrer);
  } catch {
    // No referrer, or not an address: the post was not opened from Instagram.
    return 'stay';
  }
  return historyLength > 1 && from.protocol === 'https:' && siteForHost(from.hostname) === 'instagram' ? 'back' : 'stay';
}

/** How much the page around the pop-up is dimmed: `instagram.css` uses the same `brightness()`. */
export const DIM_FACTOR = 0.35;
/** Behind the pop-up when the page's own colour cannot be read. */
const FALLBACK_BACKDROP = 'rgb(18, 18, 18)';
const OPAQUE_RGB = /^rgba?\(\s*(\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})(?:,\s*(1|1\.0+))?\s*\)$/;

/**
 * The page's computed background colour dimmed by DIM_FACTOR, so the bare page behind the pop-up matches
 * the dimmed parts of it. Anything other than an opaque `rgb()`/`rgba()` reads as a dark grey.
 */
export function dimColor(computed: string): string {
  const m = OPAQUE_RGB.exec(computed.trim());
  if (m === null) return FALLBACK_BACKDROP;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => Math.round(Number(v) * DIM_FACTOR));
  return `rgb(${r}, ${g}, ${b})`;
}
