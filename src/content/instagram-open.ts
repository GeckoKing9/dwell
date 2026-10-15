/**
 * Opening a post through Instagram's own router, from the isolated world, by way of the page-world bridge
 * (`instagram-router.ts`). A tap on a Reel's own link is caught before Instagram's handler would send it to
 * the Reels feed (`watchReelTaps`), and `guard-instagram.ts` asks the bridge (`askBridge`) to open the post in
 * this document, for a tap and whenever the guard would otherwise load a post page.
 */
import { OPENED_ATTR, OPEN_POST_EVENT, openRequest, readOpenAnswer, type OpenAnswer, type OpenMode } from '../blocker/bridge.ts';
import { INSTAGRAM_REEL } from '../blocker/patterns.ts';
import { postLinkCode } from '../blocker/post.ts';

/** How Instagram's router opened `path`, or `refused`. Dispatch is synchronous: the answer is there when it returns. */
export function askBridge(mode: OpenMode, path: string): OpenAnswer {
  const root = document.documentElement;
  root.removeAttribute(OPENED_ATTR);
  document.dispatchEvent(new CustomEvent(OPEN_POST_EVENT, { detail: openRequest(mode, path) }));
  const answer = readOpenAnswer(root.getAttribute(OPENED_ATTR));
  root.removeAttribute(OPENED_ATTR);
  return answer;
}

/** A plain left click by the user: a new-tab click, a synthetic click or an already handled one is not ours. */
function plainClick(event: MouseEvent): boolean {
  return (
    event.isTrusted &&
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/**
 * Catches a plain tap on a Reel's own link (`/reel/<code>`, `/reels/<code>`) on `window` in the capture
 * phase, before Instagram's handler, while `enabled()`. When `open` opens it in this document (Instagram's
 * pop-up, or the post as a page), Instagram's handler is stopped, so its Reels feed never draws; anything else
 * is left to Instagram, and the guard handles the Reels feed it may open. Returns the function that stops it.
 */
export function watchReelTaps(enabled: () => boolean, open: (code: string) => boolean): () => void {
  const onClick = (event: MouseEvent): void => {
    if (!plainClick(event) || !enabled() || !(event.target instanceof Element)) return;
    if (event.target.closest('[role="dialog"]') !== null) return;
    const link = event.target.closest('a[href]');
    if (!(link instanceof HTMLAnchorElement) || (link.target !== '' && link.target !== '_self')) return;
    const code = postLinkCode(link.href);
    if (code === null || !INSTAGRAM_REEL.test(link.pathname) || !open(code)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  window.addEventListener('click', onClick, { capture: true });
  return () => window.removeEventListener('click', onClick, { capture: true });
}
