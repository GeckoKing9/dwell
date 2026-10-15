/**
 * Instagram's full single-post page (`/p/<code>`, `/reel/<code>`, also under a profile) shows the post and,
 * under it, "More posts from <author>": a grid that is another feed. While the Instagram Reels blocker is
 * on, this marks everything after the post with `data-dwell-hidden`, and `instagram.css` hides it.
 *
 * A post opened in Instagram's pop-up (a `[role="dialog"]` holding the post) over another page leaves that page alone. The
 * rules read link addresses and the document's structure only, never visible text, so they hold in every
 * language (`blocker/post.ts`). The grid loads after the post, so the page is checked again on every DOM
 * change, at most once per animation frame. Bundled into the guard, which calls `syncPostPage` on
 * Instagram only; nothing is stored or sent.
 */
import { MIN_OTHER_POSTS, isOtherPostLink, singlePostCode } from '../blocker/post.ts';

const MARK = 'data-dwell-hidden';

let observer: MutationObserver | null = null;
let frame: number | null = null;

/** Links inside `main` that open another post. */
function otherPostLinks(main: Element, code: string): HTMLAnchorElement[] {
  return [...main.querySelectorAll('a[href]')].filter(
    (link): link is HTMLAnchorElement => link instanceof HTMLAnchorElement && isOtherPostLink(link.href, code),
  );
}

function holdsAll(container: Element, links: readonly Element[]): boolean {
  return links.every((link) => container.contains(link));
}

/** The post's own media: its video, else its first article, else its first image; never one inside a link to another post. */
function postMedia(main: Element, others: ReadonlySet<Element>): Element | null {
  const own = (el: Element): boolean => {
    const link = el.closest('a');
    return link === null || !others.has(link);
  };
  const video = [...main.querySelectorAll('video')].find(own);
  if (video !== undefined) return video;
  const article = main.querySelector('article');
  if (article !== null) return article;
  return [...main.querySelectorAll('img')].find(own) ?? null;
}

/**
 * What to hide: in the nearest container holding both the post's media and every link to another post,
 * each element after the one that holds the media (the separator, the "More posts" heading, the grid, the
 * footer). Nothing unless at least MIN_OTHER_POSTS of those links come after the post.
 */
function morePosts(main: Element, code: string): Element[] {
  const others = otherPostLinks(main, code);
  if (others.length < MIN_OTHER_POSTS) return [];
  const media = postMedia(main, new Set(others));
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

function run(): void {
  frame = null;
  const code = singlePostCode(location.pathname);
  const main = document.querySelector('main');
  // The post in a pop-up over another page: that page is not this post's page, so it is left alone.
  mark(code === null || main === null || postInPopUp(code) ? [] : morePosts(main, code));
}

function schedule(): void {
  if (frame === null) frame = requestAnimationFrame(run);
}

/**
 * Watches the page while `on` and the URL is a single-post path; otherwise stops watching and removes every
 * mark. The guard calls it whenever the URL or the settings change, and with `on` false when it stops.
 */
export function syncPostPage(on: boolean): void {
  if (on && singlePostCode(location.pathname) !== null) {
    if (observer === null) {
      observer = new MutationObserver(schedule);
      observer.observe(document, { childList: true, subtree: true });
    }
    schedule();
    return;
  }
  observer?.disconnect();
  observer = null;
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  mark([]);
}
