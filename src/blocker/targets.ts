/**
 * The one allowlist of redirect targets (KTD4, KTD5). Every `location.replace`, `location.assign`,
 * `tabs.update`, `tabs.create`, `windows.create` and DNR redirect in Dwell must land on a URL that
 * `isAllowedTarget` accepts. Pure: no Chrome APIs.
 *
 * Targets carry a `#dwell=<site>` fragment so the guard can count a hard-load redirect once and strip
 * it (KTD4b). Fragments never reach a server or a Referer; no target carries a `dwell` query parameter.
 */
import type { BlockedSite } from '../store/schema.ts';
import { POST_CODE_SOURCE } from './bridge.ts';

/** A YouTube video id: exactly 11 characters from the URL-safe base64 alphabet. */
export const SHORTS_ID_SOURCE = '[A-Za-z0-9_-]{11}';
const SHORTS_ID_RE = new RegExp(`^${SHORTS_ID_SOURCE}$`);
/**
 * An Instagram shortcode: 5 or more characters from the URL-safe base64 alphabet. No upper bound: Chrome's
 * RE2 refuses any bounded repetition of this class in the DNR rule (memoryLimitExceeded, even at {5,24}),
 * and the classifier, the allowlist and the rule must agree. The alphabet alone keeps targets inert.
 */
export const REEL_CODE_SOURCE = POST_CODE_SOURCE;
const REEL_CODE_RE = new RegExp(`^${REEL_CODE_SOURCE}$`);
/** A Facebook reel id: 1 to 32 digits. */
export const FACEBOOK_REEL_ID_SOURCE = '[0-9]{1,32}';
const FACEBOOK_REEL_ID_RE = new RegExp(`^${FACEBOOK_REEL_ID_SOURCE}$`);
/**
 * An X username, or the literal `i` of X's `/i/status/<id>` form, which the same alphabet covers. X caps
 * usernames at 15 characters, but Chrome's RE2 refuses `{1,15}` here in the DNR rule (memoryLimitExceeded),
 * so like the Instagram code it has no upper bound; the alphabet alone keeps targets inert.
 */
export const X_USER_SOURCE = '[A-Za-z0-9_]+';
const X_USER_RE = new RegExp(`^${X_USER_SOURCE}$`);
/** An X status (tweet) id: 1 to 25 digits. */
export const X_STATUS_ID_SOURCE = '[0-9]{1,25}';
const X_STATUS_ID_RE = new RegExp(`^${X_STATUS_ID_SOURCE}$`);

export const TARGET_FRAGMENT: Readonly<Record<BlockedSite, string>> = Object.freeze({
  instagram: '#dwell=instagram',
  youtube: '#dwell=youtube',
  facebook: '#dwell=facebook',
  x: '#dwell=x',
});

/** Fixed home-page targets. YouTube's and X's targets are the templates below, never a fixed URL. */
export const REDIRECT_TARGETS = Object.freeze({
  instagram: `https://www.instagram.com/${TARGET_FRAGMENT.instagram}`,
  facebook: `https://www.facebook.com/${TARGET_FRAGMENT.facebook}`,
} as const);

export const YOUTUBE_WATCH_PREFIX = 'https://www.youtube.com/watch?v=';
export const INSTAGRAM_POST_PREFIX = 'https://www.instagram.com/p/';
export const FACEBOOK_REEL_PREFIX = 'https://www.facebook.com/reel/';
export const X_ORIGIN = 'https://x.com/';

/** The templates below, as anchored patterns: a target is allowed only when built from a valid key. */
const TEMPLATE_RES: readonly RegExp[] = [
  new RegExp(`^https://www\\.youtube\\.com/watch\\?v=${SHORTS_ID_SOURCE}${TARGET_FRAGMENT.youtube}$`),
  new RegExp(`^https://www\\.instagram\\.com/p/${REEL_CODE_SOURCE}/${TARGET_FRAGMENT.instagram}$`),
  new RegExp(`^https://www\\.facebook\\.com/reel/${FACEBOOK_REEL_ID_SOURCE}${TARGET_FRAGMENT.facebook}$`),
  new RegExp(`^https://x\\.com/${X_USER_SOURCE}/status/${X_STATUS_ID_SOURCE}${TARGET_FRAGMENT.x}$`),
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

/**
 * The tweet page for one status: it plays that tweet's video inline with the replies below, and no video
 * feed. The username keeps the case it was written in (X matches usernames case-insensitively); `i` gives
 * X's `/i/status/<id>` form. Null when either part is not valid.
 */
export function xTweetTarget(user: string, id: string): string | null {
  return X_USER_RE.test(user) && X_STATUS_ID_RE.test(id) ? `${X_ORIGIN}${user}/status/${id}${TARGET_FRAGMENT.x}` : null;
}

/** True only for a fixed home target or a template target built from a valid id or code. */
export function isAllowedTarget(url: string): boolean {
  return FIXED.has(url) || TEMPLATE_RES.some((re) => re.test(url)) || DASHBOARD_DAY_RE.test(url);
}

const DASHBOARD_PAGE = 'chrome-extension:\\/\\/[a-p]{32}\\/[a-z0-9/-]+\\.html';
const DAY = '\\d{4}-\\d{2}-\\d{2}';
const DASHBOARD_RE = new RegExp(`^${DASHBOARD_PAGE}$`);
const DAY_RE = new RegExp(`^${DAY}$`);
/** The popup's one tab target: an extension page (the dashboard) at a day route. A web page can never produce it. */
const DASHBOARD_DAY_RE = new RegExp(`^${DASHBOARD_PAGE}#day\\/${DAY}$`);

/**
 * This extension's own dashboard page (`base`, read from the manifest) at a day route, or null for anything
 * else; `isAllowedTarget` accepts exactly these, so the popup's `tabs.update` or `tabs.create` can land nowhere else.
 */
export function dashboardDayUrl(base: string, date: string): string | null {
  return DASHBOARD_RE.test(base) && DAY_RE.test(date) ? `${base}#day/${date}` : null;
}
