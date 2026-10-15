/**
 * What the guard and the page-world bridge to Instagram's router (`content/instagram-router.ts`) share: the
 * event, the answer attribute and the one path form the bridge opens. No imports, so the bridge's bundle,
 * the only Dwell code in Instagram's own page, carries nothing else.
 */

/** An Instagram post or Reel code. `targets.ts` and the classifier use this same source. */
export const POST_CODE_SOURCE = '[A-Za-z0-9_-]{5,}';
/** The event the guard sends to the bridge, with a `/p/<code>/` path. */
export const OPEN_POST_EVENT = 'dwell:open-post';
/** Where the bridge answers, on `<html>`: `opened`, or `refused` when Instagram's router could not. */
export const OPENED_ATTR = 'data-dwell-opened';

const POP_UP_PATH = new RegExp(`^/p/${POST_CODE_SOURCE}/$`);

/** True only for a path in exactly the form `popUpPath` builds: what the bridge will open. */
export function isPopUpPath(path: string): boolean {
  return POP_UP_PATH.test(path);
}
