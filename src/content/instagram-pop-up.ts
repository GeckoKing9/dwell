/**
 * Shows a video post loaded on its own page the way Instagram's pop-up shows a post opened inside the app:
 * the post large in the middle of the window, its comments beside it, the rest of the page dimmed, and a
 * close button. Instagram opens a Reel from search in its Reels feed, which Dwell sends to the post's own
 * page; Instagram's real pop-up can only be opened by Instagram's own code, so this draws the same thing
 * around the page Instagram already drew.
 *
 * Closing (the button, Escape, or a click on the dimmed page) goes back to the Instagram page the post was
 * opened from, or, with none to go back to, lifts the pop-up and leaves the post page as it was. Only
 * attributes are added to Instagram's elements and one button to the page; `instagram.css` does the rest.
 * Called by `instagram-post.ts`; nothing is stored or sent.
 */
import { dimColor, leaveBy, popUpBox } from '../blocker/post.ts';

const POST = 'data-dwell-post';
const SIDE = 'data-dwell-post-side';
const PATH = 'data-dwell-post-path';
const DIM = 'data-dwell-dim';
const OPEN = 'data-dwell-post-open';
const CLOSE = 'data-dwell-close';
/** A column narrower than this beside the video is a control strip, not the comments. */
const MIN_SIDE_PX = 150;

interface Shown {
  readonly card: Element;
  readonly video: HTMLVideoElement;
}

let shown: Shown | null = null;
/** Closed with nothing to go back to: stays lifted until the page changes. */
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
  const body = getComputedStyle(document.body).backgroundColor;
  const page = dimColor(body) === dimColor('') ? getComputedStyle(document.documentElement).backgroundColor : body;
  document.documentElement.style.setProperty('--dwell-post-backdrop', dimColor(page));
}

function size(video: HTMLVideoElement): void {
  const box = popUpBox({ width: innerWidth, height: innerHeight }, video.videoWidth / video.videoHeight);
  document.documentElement.style.setProperty('--dwell-post-w', `${box.width}px`);
  document.documentElement.style.setProperty('--dwell-post-h', `${box.height}px`);
}

/** Everything on screen beside the card's line of ancestors is dimmed; empty portals stay as they are. */
function markAround(card: Element): void {
  for (let el: Element | null = card.parentElement; el !== null && el !== document.body; el = el.parentElement) {
    el.setAttribute(PATH, '');
  }
  for (let el: Element = card; el.parentElement !== null && el !== document.body; el = el.parentElement) {
    for (const sibling of el.parentElement.children) {
      if (sibling === el || sibling.hasAttribute(CLOSE) || sibling.hasAttribute('data-dwell-hidden')) continue;
      const r = sibling.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) sibling.setAttribute(DIM, '');
    }
  }
}

function unmark(): void {
  for (const name of [POST, SIDE, PATH, DIM]) {
    for (const el of document.querySelectorAll(`[${name}]`)) el.removeAttribute(name);
  }
  document.documentElement.removeAttribute(OPEN);
  document.documentElement.style.removeProperty('--dwell-post-w');
  document.documentElement.style.removeProperty('--dwell-post-h');
  document.documentElement.style.removeProperty('--dwell-post-backdrop');
  document.querySelector(`[${CLOSE}]`)?.remove();
}

function leave(): void {
  if (leaveBy(history.length, document.referrer) === 'back') {
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
  if (shown === null || !(event.target instanceof Element)) return;
  const target = event.target;
  const backdrop =
    target === document.documentElement || target === document.body || (target.hasAttribute(PATH) && !shown.card.contains(target));
  if (!backdrop) return;
  event.preventDefault();
  event.stopPropagation();
  leave();
}

/** Escape closes it, unless one of Instagram's own dialogs or menus is open and takes the key itself. */
function onKeyDown(event: KeyboardEvent): void {
  if (shown === null || event.key !== 'Escape' || document.querySelector('[role="dialog"], [role="menu"]') !== null) return;
  event.preventDefault();
  leave();
}

function onResize(): void {
  if (shown !== null) size(shown.video);
}

function onMetadata(): void {
  if (shown !== null) size(shown.video);
}

/** Removes the pop-up and everything it added. */
function lift(): void {
  if (shown !== null) shown.video.removeEventListener('loadedmetadata', onMetadata);
  shown = null;
  unmark();
  document.removeEventListener('click', onClick, true);
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('resize', onResize);
}

/**
 * Shows the post around `video` as a pop-up, or lifts it when `video` is null. Called on every check of
 * the post page; cheap when nothing changed, and redone when Instagram redraws the post.
 */
export function syncPopUp(video: HTMLVideoElement | null, main: Element | null): void {
  if (video === null || main === null) {
    dismissed = false;
    lift();
    return;
  }
  if (dismissed) return;
  if (shown !== null && shown.video === video && shown.card.isConnected && shown.card.hasAttribute(POST)) {
    markAround(shown.card);
    return;
  }
  const found = findCard(video, main);
  if (found === null) {
    lift();
    return;
  }
  lift();
  shown = { card: found.card, video };
  found.card.setAttribute(POST, '');
  found.side.setAttribute(SIDE, '');
  setBackdrop();
  size(video);
  document.body.append(closeButton());
  markAround(found.card);
  document.documentElement.setAttribute(OPEN, '');
  video.addEventListener('loadedmetadata', onMetadata);
  document.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', onResize);
}
