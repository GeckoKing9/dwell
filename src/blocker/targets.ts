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

const YOUTUBE_TARGET_RE = new RegExp(
  `^https://www\\.youtube\\.com/watch\\?v=${SHORTS_ID_SOURCE}${TARGET_FRAGMENT.youtube}$`,
);

const FIXED: ReadonlySet<string> = new Set(Object.values(REDIRECT_TARGETS));

/** The watch-page target for a Shorts id, or null when the id is not exactly 11 safe characters. */
export function youtubeWatchTarget(id: string): string | null {
  return SHORTS_ID_RE.test(id) ? `${YOUTUBE_WATCH_PREFIX}${id}${TARGET_FRAGMENT.youtube}` : null;
}

/** True only for a fixed home target or a watch-page target built from a valid id. */
export function isAllowedTarget(url: string): boolean {
  return FIXED.has(url) || YOUTUBE_TARGET_RE.test(url);
}
