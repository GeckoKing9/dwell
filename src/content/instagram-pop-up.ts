/**
 * Shows a video post loaded on its own page the way Instagram's pop-up shows a post opened inside the app:
 * the post large in the middle of the window, its comments beside it, the rest of the page dimmed, and a
 * close button. Instagram opens a Reel from search in its Reels feed, which Dwell sends to the post's own
 * page; Instagram's real pop-up can only be opened by Instagram's own code, so this draws the same thing
 * around the page Instagram already drew.
 *
 * Closing (the button, Escape, or a click on the dimmed page) goes back to the Instagram page the post was
 * opened from, or, with none to go back to, lifts the pop-up for as long as this post is open. Dialogs and
 * menus Instagram opens from the post are never dimmed. Only attributes and custom properties are added to
 * Instagram's page, plus one button; `instagram.css` does the rest. Called by `instagram-post.ts`; nothing is
 * stored or sent.
 */
import { DIM_FACTOR, dimColor, leaveBy, popUpBox } from '../blocker/post.ts';

const POST = 'data-dwell-post';
const SIDE = 'data-dwell-post-side';
const PATH = 'data-dwell-post-path';
const DIM = 'data-dwell-dim';
const OPEN = 'data-dwell-post-open';
const CLOSE = 'data-dwell-close';
/** A column narrower than this beside the video is a control strip, not the comments. */
const MIN_SIDE_PX = 150;
/** Behind the pop-up when neither the body's nor the page's colour can be read. */
const FALLBACK_BACKDROP = 'rgb(18, 18, 18)';
/** Instagram's own dialogs, menus and popovers: whatever holds one is never dimmed. */
const OVERLAY = '[role="dialog"], [role="menu"], [role="listbox"], [role="tooltip"], [aria-modal="true"]';
/** The dimmed parts are checked again at most this often while the page changes under the pop-up. */
const REDIM_MS = 1000;

interface Shown {
  readonly card: Element;
  readonly video: HTMLVideoElement;
  redimmedAt: number;
}

let shown: Shown | null = null;
/** Closed with nothing to go back to: stays lifted until this post's page is left (`resetPopUp`). */
let dismissed = false;

/**
 * The element whose children are the media column and, to its right, the comments column, with that
 * comments column; null when the post is not laid out that way.
 */
function findCard(video: HTMLVideoElement, main: Element): { card: Element; side: Element } | null {
  for (let el = video.parentElement; el !== null && el !== main; el = el.parentElement) {
    const media = [...el.children].find((child) => child.contains(video));
    if (media === undefined) continue;
    const m = media.getBoundingClientRect();
    const side = [...el.children].find((child) => {
      if (child === media) return false;
      const r = child.getBoundingClientRect();
      return r.left >= m.right - 2 && r.width >= MIN_SIDE_PX && r.height >= m.height / 2;
    });
    if (side !== undefined) return { card: el, side };
  }
  return null;
}

/** The page's own background, read before the pop-up restyles it, dimmed like the parts around the card. */
function setBackdrop(): void {
  const color =
    dimColor(getComputedStyle(document.body).backgroundColor) ??
    dimColor(getComputedStyle(document.documentElement).backgroundColor) ??
    FALLBACK_BACKDROP;
  const root = document.documentElement.style;
  root.setProperty('--dwell-post-backdrop', color);
  root.setProperty('--dwell-dim', String(DIM_FACTOR));
}

/** Sizes the pop-up to the window and the video; a window too narrow for it shows the page as Instagram drew it. */
function resize(): void {
  if (shown === null) return;
  const box = popUpBox({ width: innerWidth, height: innerHeight }, shown.video.videoWidth / shown.video.videoHeight);
  const root = document.documentElement;
  root.toggleAttribute(OPEN, box !== null);
  if (box === null) return;
  root.style.setProperty('--dwell-post-w', `${box.width}px`);
  root.style.setProperty('--dwell-post-h', `${box.height}px`);
  root.style.setProperty('--dwell-post-side', `${box.side}px`);
}

/**
 * Dims everything on screen beside the card's line of ancestors. Empty portals are skipped, and anything
 * holding one of Instagram's dialogs or menus is skipped, or brought back if it was dimmed before it held one.
 */
function markAround(card: Element): void {
  for (let el: Element | null = card.parentElement; el !== null && el !== document.body; el = el.parentElement) {
    el.setAttribute(PATH, '');
  }
  for (let el: Element = card; el.parentElement !== null && el !== document.body; el = el.parentElement) {
    for (const sibling of el.parentElement.children) {
      if (sibling === el || sibling.hasAttribute(CLOSE) || sibling.hasAttribute('data-dwell-hidden')) continue;
      if (sibling.matches(OVERLAY) || sibling.querySelector(OVERLAY) !== null) {
        sibling.removeAttribute(DIM);
        continue;
      }
      const r = sibling.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) sibling.setAttribute(DIM, '');
    }
  }
}

function unmark(): void {
  for (const name of [POST, SIDE, PATH, DIM]) {
    for (const el of document.querySelectorAll(`[${name}]`)) el.removeAttribute(name);
  }
  const root = document.documentElement;
  root.removeAttribute(OPEN);
  for (const name of ['--dwell-post-w', '--dwell-post-h', '--dwell-post-side', '--dwell-post-backdrop', '--dwell-dim']) {
    root.style.removeProperty(name);
  }
  document.querySelector(`[${CLOSE}]`)?.remove();
}

/** True when the tab has a page to go back to; the Navigation API knows, `history.length` also counts forward ones. */
function canGoBack(): boolean {
  return 'navigation' in window ? window.navigation.canGoBack : history.length > 1;
}

function leave(): void {
  if (leaveBy(canGoBack(), document.referrer) === 'back') {
    history.back();
    return;
  }
  dismissed = true;
  lift();
}

function closeButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute(CLOSE, '');
  button.setAttribute('aria-label', chrome.i18n.getMessage('closePost') || 'Close');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const cross = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  cross.setAttribute('d', 'M5 5l14 14M19 5L5 19');
  svg.append(cross);
  button.append(svg);
  button.addEventListener('click', leave);
  return button;
}

/** A click on the dimmed page (an ancestor of the card outside it, or the page itself) closes the pop-up. */
function onClick(event: MouseEvent): void {
  if (shown === null || !document.documentElement.hasAttribute(OPEN) || !(event.target instanceof Element)) return;
  const target = event.target;
  const backdrop =
    target === document.documentElement || target === document.body || (target.hasAttribute(PATH) && !shown.card.contains(target));
  if (!backdrop) return;
  event.preventDefault();
  event.stopPropagation();
  leave();
}

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.getAttribute('role') === 'textbox' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Escape closes it, unless the user is typing or one of Instagram's own dialogs or menus takes the key. */
function onKeyDown(event: KeyboardEvent): void {
  if (shown === null || event.key !== 'Escape' || !document.documentElement.hasAttribute(OPEN)) return;
  if (typing(event.target) || document.querySelector(OVERLAY) !== null) return;
  event.preventDefault();
  leave();
}

/** Removes the pop-up and everything it added; nothing to do when none is shown. */
function lift(): void {
  if (shown === null) return;
  shown.video.removeEventListener('loadedmetadata', resize);
  shown = null;
  unmark();
  document.removeEventListener('click', onClick, true);
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('resize', resize);
}

/** Lifts the pop-up and forgets a close: the post's page was left or the Reels switch turned off. */
export function resetPopUp(): void {
  dismissed = false;
  lift();
}

/**
 * Shows the post around `video` as a pop-up, or lifts it while `video` is null (the post redrawing, an image
 * slide), keeping a close the user made. Called on every check of the post page; cheap when nothing changed.
 */
export function syncPopUp(video: HTMLVideoElement | null, main: Element | null): void {
  if (video === null || main === null) {
    lift();
    return;
  }
  if (dismissed) return;
  if (shown !== null && shown.video === video && shown.card.isConnected && shown.card.hasAttribute(POST)) {
    // A dialog Instagram just opened inside something dimmed is brought back at once, not on the next pass.
    for (const dimmed of document.querySelectorAll(`[${DIM}]`)) if (dimmed.querySelector(OVERLAY) !== null) dimmed.removeAttribute(DIM);
    const now = Date.now();
    if (now - shown.redimmedAt >= REDIM_MS) {
      shown.redimmedAt = now;
      markAround(shown.card);
    }
    return;
  }
  const found = findCard(video, main);
  lift();
  if (found === null) return;
  shown = { card: found.card, video, redimmedAt: Date.now() };
  found.card.setAttribute(POST, '');
  found.side.setAttribute(SIDE, '');
  setBackdrop();
  resize();
  document.body.append(closeButton());
  markAround(found.card);
  video.addEventListener('loadedmetadata', resize);
  document.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', resize);
}
