/**
 * A dimmed curtain over the whole Instagram page while Instagram swaps one page for another under it, so a
 * post opened in place, or closed, never shows the swap: it fades in, holds while the page changes, and fades
 * out once the new page is drawn. Only an attribute on `<html>`; `instagram.css` draws it, as dark as the
 * pop-up's own dimming, so handing over to the framed post (or back to the page) shows no jump.
 */

const ATTR = 'data-dwell-curtain';
/** Matches the fade in `instagram.css`. */
const FADE_MS = 160;
/** A swap that never lands (a failed route) lifts the curtain anyway. */
const LIMIT_MS = 1500;

let limit: ReturnType<typeof setTimeout> | null = null;
let fade: ReturnType<typeof setTimeout> | null = null;

function clearTimers(): void {
  if (limit !== null) clearTimeout(limit);
  if (fade !== null) clearTimeout(fade);
  limit = null;
  fade = null;
}

/** Lowers the curtain: it fades in from the next frame, so one lifted in the same task never shows. */
export function lowerCurtain(): void {
  clearTimers();
  const root = document.documentElement;
  root.setAttribute(ATTR, 'pending');
  requestAnimationFrame(() => {
    if (root.getAttribute(ATTR) === 'pending') root.setAttribute(ATTR, 'down');
  });
  limit = setTimeout(raiseCurtain, LIMIT_MS);
}

/** Takes the curtain away at once, before it shows (Instagram opened its own pop-up instead). */
export function cancelCurtain(): void {
  clearTimers();
  document.documentElement.removeAttribute(ATTR);
}

/** Fades the curtain out, then removes it; nothing to do when none is down. */
export function raiseCurtain(): void {
  const root = document.documentElement;
  const state = root.getAttribute(ATTR);
  if (state === null || state === 'up') return;
  if (state === 'pending') {
    cancelCurtain();
    return;
  }
  clearTimers();
  root.setAttribute(ATTR, 'up');
  fade = setTimeout(cancelCurtain, FADE_MS);
}

/** Raises the curtain after Instagram has had two frames to draw the page now under it. */
export function raiseCurtainAfterDraw(): void {
  if (document.documentElement.getAttribute(ATTR) === null) return;
  requestAnimationFrame(() => requestAnimationFrame(raiseCurtain));
}
