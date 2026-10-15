/**
 * The guard on Instagram: the core (`guard-core.ts`) plus the pieces only Instagram needs, so YouTube,
 * Facebook and X never load them. A tap on a Reel opens in Instagram's own pop-up (`instagram-open.ts`); a
 * post page the guard would load opens in this document through Instagram's router when it can; a full
 * single-post page hides its "More posts" and shows a video post as a pop-up (`instagram-post.ts`).
 */
import { postLinkCode, postPath, shownPostCode } from '../blocker/post.ts';
import { startGuard, type GuardPort } from './guard-core.ts';
import { askBridge, watchReelTaps } from './instagram-open.ts';
import { markInAppPost, syncPostPage } from './instagram-post.ts';

/**
 * Opens the post `target` names through Instagram's own router in this document (`mode`: `page`, or `swap`
 * in place of the entry on screen), so nothing reloads and closing it goes back without a load. True when
 * the router took it; counted here, since no landing marker will be.
 */
function inPlace(guard: GuardPort, target: string, mode: 'page' | 'swap'): boolean {
  const code = postLinkCode(target);
  if (code === null) return false;
  // Registered before the ask: a router that commits during it already finds the post its own page.
  markInAppPost(code);
  const answer = askBridge(mode, postPath(code));
  if (answer !== 'page') markInAppPost(null);
  if (answer === 'refused') return false;
  guard.count('instagram');
  // A Reel opened this way is one video: a move from it to another post is undone, as in a Reels viewer.
  guard.opened(code);
  return true;
}

startGuard('instagram', (guard) => ({
  postCode: shownPostCode,
  // Taps stay Instagram's until the stored settings are known: a switch turned off is never overridden.
  stop: watchReelTaps(
    () => guard.blockers()?.instagramReels === true,
    (code) => guard.opened(code),
  ),
  openInPlace: (target, mode) => inPlace(guard, target, mode === 'replace' ? 'swap' : 'page'),
  sync: syncPostPage,
}));
