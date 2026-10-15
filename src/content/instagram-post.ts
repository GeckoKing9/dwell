/**
 * Instagram's full single-post page (`/p/<code>`, `/reel/<code>`, also under a profile) shows the post and,
 * under it, "More posts from <author>": a grid that is another feed. While the Instagram Reels blocker is
 * on, this marks everything after the post with `data-dwell-hidden`, and `instagram.css` hides it.
 *
 * A post opened in Instagram's pop-up (a `[role="dialog"]` holding the post) over another page leaves that
 * page alone. A video post on its own page is drawn as a pop-up too (`instagram-pop-up.ts`). The rules read
 * link addresses and the document's structure only, never visible text, so they hold in every language
 * (`blocker/post.ts`). The grid loads after the post, so the page is checked again on every DOM change, on
 * the next frame and at most every 100 ms. Bundled into Instagram's guard (`guard-instagram.ts`), which
 * calls `syncPostPage`; nothing is stored or sent.
 */
import { MIN_OTHER_POSTS, isOtherPostLink, singlePostCode } from '../blocker/post.ts';
import { raiseCurtainAfterDraw } from './curtain.ts';
import { resetPopUp, syncPopUp } from './instagram-pop-up.ts';

const MARK = 'data-dwell-hidden';
/**
 * The post this document was loaded on. Only that page is Instagram's full post page: an in-app move to a
 * post address opens the pop-up, and the address changes before the pop-up is drawn, so the page behind it
 * would otherwise be taken for the post's own page in between.
 */
const LOADED_CODE = singlePostCode(location.pathname);
/**
 * The page is checked on the frame after it changes, and at most this often while it keeps changing. Frames
 * do not run in a background tab, so a hidden Instagram tab does no checks at all.
 */
const MIN_GAP_MS = 100;

/** The post Dwell last opened as a page in this document through Instagram's router (`markInAppPost`). */
let inAppCode: string | null = null;
let observer: MutationObserver | null = null;
let frame: number | null = null;
let wait: ReturnType<typeof setTimeout> | null = null;
let lastRun = Number.NEGATIVE_INFINITY;

/** Records the post the guard is opening as a page in this document (null: none), so it is treated as a loaded one. */
export function markInAppPost(code: string | null): void {
  inAppCode = code;
}

/** Links inside `main` that open another post. */
function otherPostLinks(main: Element, code: string): HTMLAnchorElement[] {
  return [...main.querySelectorAll('a[href]')].filter(
    (link): link is HTMLAnchorElement => link instanceof HTMLAnchorElement && isOtherPostLink(link.href, code),
  );
}

function holdsAll(container: Element, links: readonly Element[]): boolean {
  return links.every((link) => container.contains(link));
}

/** True for an element that is not inside one of the `others` links (a thumbnail of another post). */
function ownOf(el: Element, others: ReadonlySet<Element>): boolean {
  const link = el.closest('a');
  return link === null || !others.has(link);
}

/** The post's own video: the first one in `main` that is not inside a link to another post. */
function ownVideo(main: Element, others: ReadonlySet<Element>): HTMLVideoElement | null {
  return [...main.querySelectorAll('video')].find((video) => ownOf(video, others)) ?? null;
}

/** The post's own media: its video, else its first article, else its first image; never one inside a link to another post. */
function postMedia(main: Element, others: ReadonlySet<Element>): Element | null {
  const video = ownVideo(main, others);
  if (video !== null) return video;
  const article = main.querySelector('article');
  if (article !== null) return article;
  return [...main.querySelectorAll('img')].find((img) => ownOf(img, others)) ?? null;
}

/**
 * What to hide: in the nearest container holding both the post's media and every link to another post,
 * each element after the one that holds the media (the separator, the "More posts" heading, the grid, the
 * footer). Nothing unless at least MIN_OTHER_POSTS of those links come after the post.
 */
function morePosts(main: Element, others: readonly HTMLAnchorElement[], otherSet: ReadonlySet<Element>): Element[] {
  if (others.length < MIN_OTHER_POSTS) return [];
  const media = postMedia(main, otherSet);
  if (media === null) return [];
  let container = media.parentElement;
  while (container !== null && !holdsAll(container, others)) container = container.parentElement;
  if (container === null) return [];
  let holder: Element = media;
  while (holder.parentElement !== null && holder.parentElement !== container) holder = holder.parentElement;
  const after: Element[] = [];
  for (let el = holder.nextElementSibling; el !== null; el = el.nextElementSibling) after.push(el);
  const linksAfter = others.filter((link) => after.some((el) => el.contains(link)));
  return linksAfter.length < MIN_OTHER_POSTS ? [] : after;
}

/** Marks exactly `next`: a mark on anything else is removed. */
function mark(next: readonly Element[]): void {
  const keep = new Set(next);
  for (const el of document.querySelectorAll(`[${MARK}]`)) if (!keep.has(el)) el.removeAttribute(MARK);
  for (const el of next) if (!el.hasAttribute(MARK)) el.setAttribute(MARK, '');
}

/** A link that opens `code` itself (a post's date links to its own page). */
function linksTo(link: Element, code: string): boolean {
  if (!(link instanceof HTMLAnchorElement)) return false;
  try {
    return singlePostCode(new URL(link.href).pathname) === code;
  } catch {
    // An address the browser cannot parse opens no post.
    return false;
  }
}

/**
 * The post is open in Instagram's pop-up: some dialog holds a video, an article or a link to this post.
 * A sign-up prompt or a notification panel holds none of those, so it does not count.
 */
function postInPopUp(code: string): boolean {
  return [...document.querySelectorAll('[role="dialog"]')].some(
    (dialog) =>
      dialog.querySelector('video, article') !== null ||
      [...dialog.querySelectorAll('a[href]')].some((link) => linksTo(link, code)),
  );
}

/**
 * The post on screen when it is one of this document's own post pages (the one it was loaded on, or one Dwell
 * opened in it), else null: an in-app move Instagram makes itself opens its pop-up over another page.
 */
function ownPageCode(): string | null {
  const code = singlePostCode(location.pathname);
  return code !== null && (code === LOADED_CODE || code === inAppCode) ? code : null;
}

function run(): void {
  const code = ownPageCode();
  const main = document.querySelector('main');
  // The post in a pop-up over another page: that page is not this post's page, so it is left alone.
  if (code === null || main === null || postInPopUp(code)) {
    mark([]);
    syncPopUp(null, main);
    return;
  }
  // Every link to another post, read once per check: both the hider and the pop-up start from them.
  const others = otherPostLinks(main, code);
  const otherSet = new Set<Element>(others);
  mark(morePosts(main, others, otherSet));
  // A video post on its own page is shown the way Instagram's pop-up shows one (`instagram-pop-up.ts`).
  syncPopUp(ownVideo(main, otherSet), main, code !== LOADED_CODE);
}

function onFrame(now: number): void {
  frame = null;
  const early = lastRun + MIN_GAP_MS - now;
  if (early > 0) {
    // Checked moments ago: once more after the gap, on a frame again (only a visible tab reaches here).
    wait = setTimeout(() => {
      wait = null;
      schedule();
    }, early);
    return;
  }
  lastRun = now;
  run();
}

function schedule(): void {
  if (frame === null && wait === null) frame = requestAnimationFrame(onFrame);
}

/**
 * Watches the page while `on` and the address shows one of this document's own post pages; otherwise stops
 * watching, removes every mark and lifts the pop-up. The guard calls it whenever the URL or the settings
 * change, and with `on` false when it stops.
 */
export function syncPostPage(on: boolean): void {
  if (on && ownPageCode() !== null) {
    if (observer === null) {
      // The whole document: Instagram may replace `main` itself while the page loads.
      observer = new MutationObserver(schedule);
      observer.observe(document, { childList: true, subtree: true });
    }
    schedule();
    return;
  }
  observer?.disconnect();
  observer = null;
  if (frame !== null) cancelAnimationFrame(frame);
  if (wait !== null) clearTimeout(wait);
  frame = null;
  wait = null;
  mark([]);
  resetPopUp();
  // Left the post (closed, or Back): a curtain over the swap fades once the page under it is drawn.
  raiseCurtainAfterDraw();
}
