/**
 * The guard on Instagram: the core (`guard-core.ts`) plus the pieces only Instagram needs, so YouTube,
 * Facebook and X never load them. A tap on a Reel opens in Instagram's own pop-up (`instagram-open.ts`); a
 * post page the guard would load opens in this document through Instagram's router when it can; a full
 * single-post page hides its "More posts" and shows a video post as a pop-up (`instagram-post.ts`).
 */
import { postLinkCode, postPath, shownPostCode } from '../blocker/post.ts';
import { startGuard, type GuardPort } from './guard-core.ts';
import { lowerCurtain, cancelCurtain } from './curtain.ts';
import { askBridge, watchReelTaps } from './instagram-open.ts';
import { markInAppPost, syncPostPage } from './instagram-post.ts';

/**
 * Opens post `code` through Instagram's own router in this document (`mode`: `page`, or `swap` in place of the
 * entry on screen): Instagram's pop-up when the page hosts one, else the post as a page that Dwell frames. A
 * curtain covers the page while Instagram swaps it, and is cancelled before it shows when the pop-up opened
 * instead. True when the router took it. `counted`: the guard stopped a Reels feed to open it.
 */
function openPost(guard: GuardPort, code: string, mode: 'page' | 'swap', counted: boolean): boolean {
  // Registered before the ask: a router that commits during it already finds the post its own page.
  markInAppPost(code);
  lowerCurtain();
  const answer = askBridge(mode, postPath(code));
  if (answer !== 'page') {
    markInAppPost(null);
    cancelCurtain();
  }
  if (answer === 'refused') return false;
  if (counted) guard.count('instagram');
  // A Reel opened this way is one video: a move from it to another post is undone, as in a Reels viewer.
  guard.opened(code);
  return true;
}

startGuard('instagram', (guard) => ({
  postCode: shownPostCode,
  // Taps stay Instagram's until the stored settings are known: a switch turned off is never overridden.
  stop: watchReelTaps(
    () => guard.blockers()?.instagramReels === true,
    (code) => openPost(guard, code, 'page', false),
  ),
  openInPlace: (target, mode) => {
    const code = postLinkCode(target);
    return code !== null && openPost(guard, code, mode === 'replace' ? 'swap' : 'page', true);
  },
  sync: syncPostPage,
}));
