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
 * The code of the one post or Reel `url` (an absolute link address) opens on Instagram, or null when it opens
 * something else. Shared by the "More posts" hider and the pop-up, so both read links the same way.
 */
export function postLinkCode(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not an absolute URL: not a link this page resolved to a post.
    return null;
  }
  if (parsed.protocol !== 'https:' || siteForHost(parsed.hostname) !== 'instagram') return null;
  return POST_LINK.exec(parsed.pathname)?.[1] ?? null;
}

/**
 * True when `url` (an absolute link address) opens an Instagram post other than `current`. Codes compare
 * exactly: Instagram codes are case-sensitive.
 */
export function isOtherPostLink(url: string, current: string): boolean {
  const code = postLinkCode(url);
  return code !== null && code !== current;
}

/** The gap Instagram's own pop-up leaves around a post, in CSS pixels. */
export const POP_UP_MARGIN_PX = 24;
/** Kept clear on each side of the post, so the close button at the window's top right never covers it. */
export const POP_UP_EDGE_PX = 64;
/** The width of the comments column beside the media in Instagram's pop-up. */
export const POP_UP_SIDE_PX = 405;
/** Less room than this for the video beside the comments, and the page is left as Instagram drew it. */
const MIN_MEDIA_PX = 160;
/** Short videos are vertical: the shape assumed until the video reports its own. */
const DEFAULT_RATIO = 9 / 16;

/** A pop-up's outer size and its comments column, in CSS pixels. */
export interface PopUpBox {
  width: number;
  height: number;
  side: number;
}

/**
 * The size of a post shown the way Instagram's pop-up shows it: the video at its own width-to-height
 * `ratio`, as tall as the window allows less the margin, with the comments column beside it. In a window too
 * narrow for that the box keeps the video's shape and gets shorter, never wider than the window less
 * POP_UP_EDGE_PX a side; null when even that leaves the video less than MIN_MEDIA_PX.
 */
export function popUpBox(view: { width: number; height: number }, ratio: number): PopUpBox | null {
  const shape = Number.isFinite(ratio) && ratio > 0 ? ratio : DEFAULT_RATIO;
  const tallest = view.height - 2 * POP_UP_MARGIN_PX;
  const room = view.width - 2 * POP_UP_EDGE_PX - POP_UP_SIDE_PX;
  if (tallest <= 0 || room < MIN_MEDIA_PX) return null;
  const full = Math.round(tallest * shape);
  if (full <= room) return { width: full + POP_UP_SIDE_PX, height: tallest, side: POP_UP_SIDE_PX };
  return { width: room + POP_UP_SIDE_PX, height: Math.round(room / shape), side: POP_UP_SIDE_PX };
}

/**
 * Where closing the pop-up goes: `back` to the Instagram page the post was opened from (a search, a
 * profile) when the tab can go back, or `stay` on the post with the pop-up lifted when there is none (a
 * link from another site, the first page of a new tab).
 */
export function leaveBy(canGoBack: boolean, referrer: string): 'back' | 'stay' {
  let from: URL;
  try {
    from = new URL(referrer);
  } catch {
    // No referrer, or not an address: the post was not opened from Instagram.
    return 'stay';
  }
  return canGoBack && from.protocol === 'https:' && siteForHost(from.hostname) === 'instagram' ? 'back' : 'stay';
}

/** How much the page around the pop-up is dimmed: `instagram.css` reads it as `--dwell-dim`. */
export const DIM_FACTOR = 0.35;
const OPAQUE_RGB = /^rgba?\(\s*(\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})(?:,\s*(1|1\.0+))?\s*\)$/;

/**
 * The page's computed background colour dimmed by DIM_FACTOR, so the bare page behind the pop-up matches
 * the dimmed parts of it; null when the colour is not an opaque `rgb()`/`rgba()`.
 */
export function dimColor(computed: string): string | null {
  const m = OPAQUE_RGB.exec(computed.trim());
  if (m === null) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => Math.round(Number(v) * DIM_FACTOR));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * The post address a link opens in Instagram's pop-up, always `/p/<code>/` (Instagram's post route shows a
 * Reel too), or null when the link does not open one post or Reel on Instagram.
 */
export function popUpPath(url: string): string | null {
  const code = postLinkCode(url);
  return code === null ? null : `/p/${code}/`;
}
