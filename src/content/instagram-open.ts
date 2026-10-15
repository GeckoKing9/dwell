/**
 * A tap on a post or Reel link on Instagram opens it in Instagram's own pop-up over the page, the way a post
 * from a message opens, instead of Instagram's Reels feed or a page load. The click is caught on `window` in
 * the capture phase, before Instagram's own handler; the page-world bridge (`instagram-router.ts`) asks
 * Instagram's router for the pop-up, and only when it says `opened` is Instagram's handler stopped. Anything
 * else (a modified click, a link inside a pop-up already open, a page that hosts no pop-ups, a router that
 * changed) is left to Instagram, where the guard's usual rules still apply.
 */
import { OPENED_ATTR, OPEN_POST_EVENT } from '../blocker/bridge.ts';
import { popUpPath } from '../blocker/post.ts';

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

/** The bridge's answer for `path`: true when Instagram's router was asked to open the pop-up. */
function openInPopUp(path: string): boolean {
  const root = document.documentElement;
  root.removeAttribute(OPENED_ATTR);
  // Dispatch is synchronous: the bridge has answered when it returns.
  document.dispatchEvent(new CustomEvent(OPEN_POST_EVENT, { detail: path }));
  const opened = root.getAttribute(OPENED_ATTR) === 'opened';
  root.removeAttribute(OPENED_ATTR);
  return opened;
}

/** A link to a Reel by its own address (`/reel/<code>`, `/reels/<code>`), not a post's. */
const REEL_LINK = /^\/(?:[^/]+\/)?reels?\//i;

/**
 * Starts catching taps on post and Reel links while `enabled()` (the Instagram Reels switch is on), and
 * tells `opened` which post path a pop-up opened on and whether the tap was on a Reel's own link; returns
 * the function that stops it.
 */
export function watchPostTaps(enabled: () => boolean, opened: (path: string, reel: boolean) => void): () => void {
  const onClick = (event: MouseEvent): void => {
    if (!plainClick(event) || !enabled() || !(event.target instanceof Element)) return;
    if (event.target.closest('[role="dialog"]') !== null) return;
    const link = event.target.closest('a[href]');
    if (!(link instanceof HTMLAnchorElement) || (link.target !== '' && link.target !== '_self')) return;
    const path = popUpPath(link.href);
    if (path === null || !openInPopUp(path)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    opened(path, REEL_LINK.test(link.pathname));
  };
  window.addEventListener('click', onClick, { capture: true });
  return () => window.removeEventListener('click', onClick, { capture: true });
}
