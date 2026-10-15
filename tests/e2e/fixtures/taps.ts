import type { Page } from '@playwright/test';

/** Where a tap left the page, read synchronously after the site's pushState returned. */
export interface Tap {
  path: string;
  added: number;
}

/** Clicks the Instagram fixture's in-page Reel link (its own router pushes `/reels/abc`). */
export async function tapReel(page: Page): Promise<Tap> {
  return page.evaluate(() => {
    const before = history.length;
    document.getElementById('open-reel')?.click();
    return { path: location.pathname, added: history.length - before };
  });
}

/** Does what YouTube's router does when a Short is tapped in the feed: a pushState to `/shorts/<id>`. */
export async function tapShort(page: Page, id: string): Promise<Tap> {
  return page.evaluate((shortId) => {
    const before = history.length;
    history.pushState({}, '', `/shorts/${shortId}`);
    return { path: location.pathname, added: history.length - before };
  }, id);
}
