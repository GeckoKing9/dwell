import type { Page } from '@playwright/test';

/** Where a tap left the page, read synchronously after the site's pushState returned. */
export interface Tap {
  path: string;
  added: number;
}

/** Clicks one of a fixture's in-page links (Instagram, X); its own router pushes the link's path. */
export async function tapLink(page: Page, id: string): Promise<Tap> {
  return page.evaluate((linkId) => {
    const before = history.length;
    document.getElementById(linkId)?.click();
    return { path: location.pathname, added: history.length - before };
  }, id);
}

/** Taps a single Reel in the Instagram fixture: its router pushes `/reel/DeewiSPpCrm/` and opens the pop-up. */
export async function tapReel(page: Page): Promise<Tap> {
  return tapLink(page, 'open-reel');
}

/** Taps a single Reel under a profile in the Instagram fixture: `/someuser/reel/DeewiSPpCrm/`, in the pop-up. */
export async function tapUserReel(page: Page): Promise<Tap> {
  return tapLink(page, 'open-user-reel');
}

/** Opens the Reels scroller on one Reel in the Instagram fixture: its router pushes `/reels/DeewiSPpCrm/`. */
export async function tapReelsCode(page: Page): Promise<Tap> {
  return tapLink(page, 'open-reels-code');
}

/** Taps the Reels tab in the Instagram fixture: its router pushes the bare feed `/reels/`. */
export async function tapFeed(page: Page): Promise<Tap> {
  return tapLink(page, 'open-feed');
}

/** Taps a video in the X fixture's timeline: its router pushes `/someuser/status/123/video/1`. */
export async function tapVideo(page: Page): Promise<Tap> {
  return tapLink(page, 'open-video');
}

/** Taps a photo in the X fixture's timeline: its router pushes `/someuser/status/123/photo/1`. */
export async function tapPhoto(page: Page): Promise<Tap> {
  return tapLink(page, 'open-photo');
}

/**
 * Changes the route through the Facebook or X fixture's own router, which draws the route it was asked
 * for (`data-shown`) whatever the URL ends up being, like a real single-page app.
 */
export async function routeTo(page: Page, path: string, mode: 'push' | 'replace' = 'push'): Promise<Tap> {
  return page.evaluate(
    ({ next, how }) => {
      const before = history.length;
      const router = (window as unknown as { router: Record<'push' | 'replace', (path: string) => void> }).router;
      router[how](next);
      return { path: location.pathname, added: history.length - before };
    },
    { next: path, how: mode },
  );
}

/** Does what a viewer does when the user scrolls to the next video: a pushState to that video's path. */
export async function swipeTo(page: Page, path: string): Promise<Tap> {
  return page.evaluate((next) => {
    const before = history.length;
    history.pushState({}, '', next);
    return { path: location.pathname, added: history.length - before };
  }, path);
}

/** Does what YouTube's router does when a Short is tapped in the feed: a pushState to `/shorts/<id>`. */
export async function tapShort(page: Page, id: string): Promise<Tap> {
  return page.evaluate((shortId) => {
    const before = history.length;
    history.pushState({}, '', `/shorts/${shortId}`);
    return { path: location.pathname, added: history.length - before };
  }, id);
}
