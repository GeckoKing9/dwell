/**
 * The one allowlist of redirect targets (KTD4, KTD5). Every `location.replace`, `location.assign`,
 * `tabs.update`, `tabs.create`, `windows.create` and DNR redirect in Dwell must land on a URL that
 * `isAllowedTarget` accepts. Pure: no Chrome APIs.
 *
 * Targets carry a `#dwell=<site>` fragment so the guard can count a hard-load redirect once and strip
 * it (KTD4b). Fragments never reach a server or a Referer; no target carries a `dwell` query parameter.
 */
import type { BlockedSite } from '../store/schema.ts';

/** A YouTube video id: exactly 11 characters from the URL-safe base64 alphabet. */
export const SHORTS_ID_SOURCE = '[A-Za-z0-9_-]{11}';
const SHORTS_ID_RE = new RegExp(`^${SHORTS_ID_SOURCE}$`);
/**
 * An Instagram shortcode: 5 or more characters from the URL-safe base64 alphabet. No upper bound: Chrome's
 * RE2 refuses any bounded repetition of this class in the DNR rule (memoryLimitExceeded, even at {5,24}),
 * and the classifier, the allowlist and the rule must agree. The alphabet alone keeps targets inert.
 */
export const REEL_CODE_SOURCE = '[A-Za-z0-9_-]{5,}';
const REEL_CODE_RE = new RegExp(`^${REEL_CODE_SOURCE}$`);
/** A Facebook reel id: 1 to 32 digits. */
export const FACEBOOK_REEL_ID_SOURCE = '[0-9]{1,32}';
const FACEBOOK_REEL_ID_RE = new RegExp(`^${FACEBOOK_REEL_ID_SOURCE}$`);

export const TARGET_FRAGMENT: Readonly<Record<BlockedSite, string>> = Object.freeze({
  instagram: '#dwell=instagram',
  youtube: '#dwell=youtube',
  facebook: '#dwell=facebook',
});

/** Fixed home-page targets. YouTube's target is the template below, never a fixed URL. */
export const REDIRECT_TARGETS = Object.freeze({
  instagram: `https://www.instagram.com/${TARGET_FRAGMENT.instagram}`,
  facebook: `https://www.facebook.com/${TARGET_FRAGMENT.facebook}`,
} as const);

export const YOUTUBE_WATCH_PREFIX = 'https://www.youtube.com/watch?v=';
export const INSTAGRAM_POST_PREFIX = 'https://www.instagram.com/p/';
export const FACEBOOK_REEL_PREFIX = 'https://www.facebook.com/reel/';

/** The templates below, as anchored patterns: a target is allowed only when built from a valid key. */
const TEMPLATE_RES: readonly RegExp[] = [
  new RegExp(`^https://www\\.youtube\\.com/watch\\?v=${SHORTS_ID_SOURCE}${TARGET_FRAGMENT.youtube}$`),
  new RegExp(`^https://www\\.instagram\\.com/p/${REEL_CODE_SOURCE}/${TARGET_FRAGMENT.instagram}$`),
  new RegExp(`^https://www\\.facebook\\.com/reel/${FACEBOOK_REEL_ID_SOURCE}${TARGET_FRAGMENT.facebook}$`),
];

const FIXED: ReadonlySet<string> = new Set(Object.values(REDIRECT_TARGETS));

/** The watch-page target for a Shorts id, or null when the id is not exactly 11 safe characters. */
export function youtubeWatchTarget(id: string): string | null {
  return SHORTS_ID_RE.test(id) ? `${YOUTUBE_WATCH_PREFIX}${id}${TARGET_FRAGMENT.youtube}` : null;
}

/** The single-post page that plays one Reel without the Reels feed, or null for an invalid code. */
export function instagramPostTarget(code: string): string | null {
  return REEL_CODE_RE.test(code) ? `${INSTAGRAM_POST_PREFIX}${code}/${TARGET_FRAGMENT.instagram}` : null;
}

/** Facebook's own viewer for one reel id, where the viewer lock sends a tab back; null for a bad id. */
export function facebookReelTarget(id: string): string | null {
  return FACEBOOK_REEL_ID_RE.test(id) ? `${FACEBOOK_REEL_PREFIX}${id}${TARGET_FRAGMENT.facebook}` : null;
}

/** True only for a fixed home target or a template target built from a valid id or code. */
export function isAllowedTarget(url: string): boolean {
  return FIXED.has(url) || TEMPLATE_RES.some((re) => re.test(url));
}
