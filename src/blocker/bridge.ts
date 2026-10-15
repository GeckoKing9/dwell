/**
 * What the guard and the page-world bridge to Instagram's router (`content/instagram-router.ts`) share: the
 * event, the answer attribute and the one path form the bridge opens. No imports, so the bridge's bundle,
 * the only Dwell code in Instagram's own page, carries nothing else.
 */

/** An Instagram post or Reel code. `targets.ts` and the classifier use this same source. */
export const POST_CODE_SOURCE = '[A-Za-z0-9_-]{5,}';
/** The event the guard sends to the bridge, with an `openRequest` detail. */
export const OPEN_POST_EVENT = 'dwell:open-post';
/** Where the bridge answers on `<html>`, with an `OpenAnswer`. */
export const OPENED_ATTR = 'data-dwell-opened';

const POP_UP_PATH = new RegExp(`^/p/${POST_CODE_SOURCE}/$`);

/** True only for a path in exactly the form `popUpPath` builds: what the bridge will open. */
export function isPopUpPath(path: string): boolean {
  return POP_UP_PATH.test(path);
}

/**
 * How the guard asks. `pop-up`: only Instagram's own pop-up over the page, else nothing. `page`: the pop-up
 * when the page hosts one, else the post opened as a page in the same document (no page load). `swap`: the
 * post replaces the entry on screen (one Instagram itself just navigated to), so its router's history and
 * the browser's stay the same and Back leaves the post.
 */
export type OpenMode = 'pop-up' | 'page' | 'swap';
/** How the bridge opened the post, or `refused` when Instagram's router could not. */
export type OpenAnswer = 'pop-up' | 'page' | 'refused';

const MODES: ReadonlySet<string> = new Set<OpenMode>(['pop-up', 'page', 'swap']);

/** The event detail for one request: a primitive string, since it crosses from the isolated world to the page's. */
export function openRequest(mode: OpenMode, path: string): string {
  return `${mode} ${path}`;
}

/** A request the bridge accepts, or null for anything not built by `openRequest` from a post path. */
export function readOpenRequest(detail: unknown): { mode: OpenMode; path: string } | null {
  if (typeof detail !== 'string') return null;
  const parts = detail.split(' ');
  if (parts.length !== 2) return null;
  const [mode, path] = parts as [string, string];
  return MODES.has(mode) && isPopUpPath(path) ? { mode: mode as OpenMode, path } : null;
}

/** The bridge's answer as read from `<html>`; anything else is `refused`. */
export function readOpenAnswer(value: string | null): OpenAnswer {
  return value === 'pop-up' || value === 'page' ? value : 'refused';
}
