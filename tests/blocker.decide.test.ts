import { describe, expect, it } from 'vitest';
import {
  LOOP_MAX_REDIRECTS,
  LOOP_WINDOW_MS,
  admitRedirect,
  admitsAt,
  decide,
  decideLock,
  markerCounts,
  samePage,
  type GuardContext,
  type NavigationInfo,
} from '../src/blocker/decide.ts';
import { classify } from '../src/blocker/patterns.ts';
import { decideViewerMove } from '../src/blocker/viewer.ts';
import type { Settings } from '../src/store/schema.ts';

type Blockers = Settings['blockers'];

const ALL_ON: Blockers = { instagramReels: true, youtubeShorts: true, facebookReels: true, xVideos: true, instagramExplore: true };
const ALL_OFF: Blockers = { instagramReels: false, youtubeShorts: false, facebookReels: false, xVideos: false, instagramExplore: false };
const NOW = 1_700_000_000_000;
const FULL = [NOW - 2, NOW - 1];
const SHORT = classify('https://www.youtube.com/shorts/dQw4w9WgXcQ', ALL_ON);
const REEL_FEED = classify('https://www.instagram.com/reels/', ALL_ON);
const FB_FEED = classify('https://www.facebook.com/reels/', ALL_ON);
const REELS_CODE = classify('https://www.instagram.com/reels/DeewiSPpCrm/', ALL_ON);
const EXPLORE = classify('https://www.instagram.com/explore/', ALL_ON);
const POST = 'https://www.instagram.com/p/DeewiSPpCrm/#dwell=instagram';
const IG_HOME = 'https://www.instagram.com/#dwell=instagram';
const FB_HOME = 'https://www.facebook.com/#dwell=facebook';
const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ#dwell=youtube';
const X_VIDEO = classify('https://x.com/someuser/status/123/video/1', ALL_ON);
const TWEET = 'https://x.com/someuser/status/123#dwell=x';
const TWEET_PAGE = 'https://x.com/someuser/status/123';

const PUSH: NavigationInfo = { type: 'push', sameDocument: true };
const REPLACE: NavigationInfo = { type: 'replace', sameDocument: true };
const TRAVERSE: NavigationInfo = { type: 'traverse', sameDocument: true };
const CROSS_DOCUMENT: NavigationInfo = { type: 'push', sameDocument: false };

/** A navigation from `from`, with empty logs unless the test fills them. */
function ctx(from: string, patch: Partial<GuardContext> = {}): GuardContext {
  return { from, nav: PUSH, now: NOW, redirects: [], undos: [], ...patch };
}

describe('decide: a cancelable in-page navigation the classifier judged', () => {
  it('lets the navigation through when the classifier blocks nothing, a toggle being off included', () => {
    expect(decide(null, ctx('https://www.instagram.com/'))).toEqual({ action: 'allow' });
    const off = classify('https://www.instagram.com/reels/', ALL_OFF);
    expect(decide(off, ctx('https://www.instagram.com/'))).toEqual({ action: 'allow' });
  });

  it('hard-loads the home page for an in-app move to a Reels feed or Explore, recording the redirect', () => {
    const from = 'https://www.instagram.com/someuser/';
    expect(decide(REEL_FEED, ctx(from, { redirects: [NOW - 1000] }))).toEqual({
      action: 'redirect',
      target: IG_HOME,
      redirects: [NOW - 1000, NOW],
    });
    expect(decide(EXPLORE, ctx(from))).toEqual({ action: 'redirect', target: IG_HOME, redirects: [NOW] });
    expect(decide(FB_FEED, ctx('https://www.facebook.com/'))).toEqual({ action: 'redirect', target: FB_HOME, redirects: [NOW] });
  });

  it('hard-loads home for a feed whatever kind of navigation reached it, even a replace', () => {
    for (const nav of [REPLACE, TRAVERSE, CROSS_DOCUMENT, null]) {
      expect(decide(REEL_FEED, ctx('https://www.instagram.com/', { nav }))).toEqual({
        action: 'redirect',
        target: IG_HOME,
        redirects: [NOW],
      });
    }
  });

  it('only cancels a feed, counted in place, as the last resort when the loop guard refuses the hard load', () => {
    expect(decide(REEL_FEED, ctx('https://www.instagram.com/', { redirects: FULL }))).toEqual({ action: 'cancel', site: 'instagram' });
    expect(decide(FB_FEED, ctx('https://www.facebook.com/', { redirects: FULL }))).toEqual({ action: 'cancel', site: 'facebook' });
  });

  it('redirects a Shorts tap to the watch page and records the redirect', () => {
    expect(decide(SHORT, ctx('https://www.youtube.com/', { redirects: [NOW - 1000] }))).toEqual({
      action: 'redirect',
      target: WATCH,
      redirects: [NOW - 1000, NOW],
    });
  });

  it('redirects a move into the Instagram Reels scroller to that Reel’s post page', () => {
    expect(decide(REELS_CODE, ctx('https://www.instagram.com/'))).toEqual({ action: 'redirect', target: POST, redirects: [NOW] });
  });

  it('redirects an X video viewer to its tweet page from another page', () => {
    expect(decide(X_VIDEO, ctx('https://x.com/home'))).toEqual({ action: 'redirect', target: TWEET, redirects: [NOW] });
  });

  it('lets a single-video rewrite through when the loop guard refuses it, so it is never cancelled with nothing after', () => {
    expect(decide(X_VIDEO, ctx('https://x.com/home', { redirects: FULL }))).toEqual({ action: 'allow' });
    expect(decide(REELS_CODE, ctx('https://www.instagram.com/', { redirects: FULL }))).toEqual({ action: 'allow' });
    expect(decide(SHORT, ctx('https://www.youtube.com/', { redirects: FULL }))).toEqual({ action: 'allow' });
  });

  it('never cancels a Shorts tap toward a target outside the allowlist', () => {
    const forged = { site: 'youtube', kind: 'shorts', target: 'https://evil.example/#dwell=youtube' } as const;
    expect(decide(forged, ctx('https://www.youtube.com/'))).toEqual({ action: 'allow' });
  });
});

describe('decide: a rewrite whose target is the page already open', () => {
  const reload = { action: 'redirect', target: TWEET, redirects: [NOW] } as const;

  it('undoes a same-document push to the video of the tweet being read, with the reload as its fallback', () => {
    expect(decide(X_VIDEO, ctx(TWEET_PAGE, { undos: [NOW - 1000] }))).toEqual({
      action: 'undo',
      site: 'x',
      undos: [NOW - 1000, NOW],
      fallback: reload,
    });
  });

  it('undoes a push to the Reels scroller on the post page of the same Reel', () => {
    expect(decide(REELS_CODE, ctx('https://www.instagram.com/p/DeewiSPpCrm/'))).toEqual({
      action: 'undo',
      site: 'instagram',
      undos: [NOW],
      fallback: { action: 'redirect', target: POST, redirects: [NOW] },
    });
  });

  it('compares the page by host, path and query, ignoring the fragment and a trailing slash', () => {
    expect(decide(X_VIDEO, ctx(`${TWEET_PAGE}#top`))).toMatchObject({ action: 'undo', site: 'x' });
    expect(decide(REELS_CODE, ctx('https://www.instagram.com/p/DeewiSPpCrm'))).toMatchObject({ action: 'undo' });
    expect(decide(X_VIDEO, ctx('https://x.com/someuser/status/1234'))).toMatchObject({ action: 'redirect' });
    expect(decide(X_VIDEO, ctx(`${TWEET_PAGE}?s=20`))).toMatchObject({ action: 'redirect' });
    expect(decide(X_VIDEO, ctx('not a url'))).toMatchObject({ action: 'redirect' });
  });

  it('tells YouTube watch pages apart by their video id', () => {
    expect(decide(SHORT, ctx('https://www.youtube.com/watch?v=AAAAAAAAAAA'))).toEqual({ action: 'redirect', target: WATCH, redirects: [NOW] });
    expect(decide(SHORT, ctx('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))).toMatchObject({ action: 'undo', site: 'youtube' });
  });

  it.each([
    ['a replace', REPLACE],
    ['a traverse', TRAVERSE],
    ['a cross-document push', CROSS_DOCUMENT],
    ['an unknown navigation', null],
  ])('cancels %s and reloads the page instead of undoing it', (_name, nav) => {
    expect(decide(X_VIDEO, ctx(TWEET_PAGE, { nav }))).toEqual(reload);
  });

  it('falls back to the reload when the undo guard refuses a third undo within 5 s', () => {
    expect(decide(X_VIDEO, ctx(TWEET_PAGE, { undos: FULL }))).toEqual(reload);
  });

  it('cancels in place, counted, when both the undo guard and the loop guard refuse', () => {
    expect(decide(X_VIDEO, ctx(TWEET_PAGE, { undos: FULL, redirects: FULL }))).toEqual({ action: 'cancel', site: 'x' });
  });

  it('undoes even when the loop guard is full, carrying the cancel as its fallback', () => {
    expect(decide(X_VIDEO, ctx(TWEET_PAGE, { redirects: FULL }))).toEqual({
      action: 'undo',
      site: 'x',
      undos: [NOW],
      fallback: { action: 'cancel', site: 'x' },
    });
  });
});

describe('decideLock: a move from one viewer video to the next', () => {
  const FB_LOCK = 'https://www.facebook.com/reel/111#dwell=facebook';
  const lock = { action: 'lock', site: 'facebook', target: FB_LOCK } as const;
  const from = 'https://www.facebook.com/reel/111';
  const reload = { action: 'redirect', target: FB_LOCK, redirects: [NOW] } as const;

  it('undoes a same-document push: the push commits and Back restores the first video', () => {
    expect(decideLock(lock, ctx(from, { undos: [NOW - 1000] }))).toEqual({
      action: 'undo',
      site: 'facebook',
      undos: [NOW - 1000, NOW],
      fallback: reload,
    });
  });

  it.each([
    ['a replace', REPLACE],
    ['a traverse', TRAVERSE],
    ['a cross-document navigation', CROSS_DOCUMENT],
    ['a move seen only after it committed', null],
  ])('cancels %s and goes back to the first video by a reload', (_name, nav) => {
    expect(decideLock(lock, ctx(from, { nav, redirects: [NOW - 1000] }))).toEqual({
      action: 'redirect',
      target: FB_LOCK,
      redirects: [NOW - 1000, NOW],
    });
  });

  it('falls back to the reload when the undo guard refuses: at most 2 undos in 5 s', () => {
    expect(decideLock(lock, ctx(from, { undos: FULL }))).toEqual(reload);
    expect(decideLock(lock, ctx(from, { undos: [NOW - LOOP_WINDOW_MS, NOW - 1] }))).toMatchObject({ action: 'undo' });
  });

  it('still cancels the move, counted in place, when the undo guard and the loop guard both refuse', () => {
    expect(decideLock(lock, ctx(from, { undos: FULL, redirects: FULL }))).toEqual({ action: 'cancel', site: 'facebook' });
  });

  it('cancels without redirecting toward a target outside the allowlist', () => {
    const forged = { action: 'lock', site: 'facebook', target: 'https://evil.example/#dwell=facebook' } as const;
    expect(decideLock(forged, ctx(from, { nav: REPLACE }))).toEqual({ action: 'cancel', site: 'facebook' });
    expect(decideLock(forged, ctx(from))).toEqual({
      action: 'undo',
      site: 'facebook',
      undos: [NOW],
      fallback: { action: 'cancel', site: 'facebook' },
    });
  });

  it('lets a move through that is not a viewer-to-viewer jump, or whose toggle is off', () => {
    expect(decideLock({ action: 'allow' }, ctx(from))).toEqual({ action: 'allow' });
    const off = decideViewerMove(from, 'https://www.facebook.com/reel/222', { ...ALL_ON, facebookReels: false });
    expect(decideLock(off, ctx(from))).toEqual({ action: 'allow' });
  });
});

describe('admitRedirect: the loop guard, also used for undos', () => {
  it(`admits at most ${LOOP_MAX_REDIRECTS} redirects in ${LOOP_WINDOW_MS} ms`, () => {
    expect(admitRedirect({ now: NOW, redirects: [] })).toEqual([NOW]);
    expect(admitRedirect({ now: NOW, redirects: [NOW - 10] })).toEqual([NOW - 10, NOW]);
    expect(admitRedirect({ now: NOW, redirects: [NOW - 10, NOW - 5] })).toBeNull();
  });

  it('forgets redirects 5 s old or older and timestamps from the future', () => {
    expect(admitRedirect({ now: NOW, redirects: [NOW - LOOP_WINDOW_MS, NOW - 9999, NOW + 10] })).toEqual([NOW]);
    expect(admitRedirect({ now: NOW, redirects: [NOW - LOOP_WINDOW_MS + 1, NOW] })).toBeNull();
  });
});

describe('admitsAt: when the loop guard admits one more entry', () => {
  it('is now while it admits, else when the older of the two recent entries turns 5 s old', () => {
    expect(admitsAt({ now: NOW, redirects: [] })).toBe(NOW);
    expect(admitsAt({ now: NOW, redirects: [NOW - 10] })).toBe(NOW);
    expect(admitsAt({ now: NOW, redirects: [NOW - 500, NOW - 1000] })).toBe(NOW - 1000 + LOOP_WINDOW_MS);
    expect(admitsAt({ now: NOW, redirects: [NOW - 3, NOW - 2, NOW - 1] })).toBe(NOW - 2 + LOOP_WINDOW_MS);
  });

  it('agrees with admitRedirect at that moment and just before it', () => {
    const redirects = [NOW - 1000, NOW - 500];
    const when = admitsAt({ now: NOW, redirects });
    expect(admitRedirect({ now: when - 1, redirects })).toBeNull();
    expect(admitRedirect({ now: when, redirects })).not.toBeNull();
  });

  it('ignores entries 5 s old or older and timestamps from the future', () => {
    expect(admitsAt({ now: NOW, redirects: [NOW - LOOP_WINDOW_MS, NOW - 1, NOW + 10] })).toBe(NOW);
  });
});

describe('samePage: the one rule for the page already open', () => {
  it('ignores the fragment and a trailing slash, never the host, the path or the query', () => {
    expect(samePage('https://x.com/someuser/status/123#dwell=x', TWEET_PAGE)).toBe(true);
    expect(samePage(POST, 'https://www.instagram.com/p/DeewiSPpCrm')).toBe(true);
    expect(samePage(IG_HOME, 'https://www.instagram.com')).toBe(true);
    expect(samePage(WATCH, 'https://www.youtube.com/watch?v=AAAAAAAAAAA')).toBe(false);
    expect(samePage(FB_HOME, 'https://m.facebook.com/')).toBe(false);
    expect(samePage(TWEET, 'https://x.com/someuser/status/1234')).toBe(false);
    expect(samePage('not a url', 'not a url')).toBe(false);
  });
});

describe('markerCounts: a #dwell=<site> landing', () => {
  it('counts only while one of that site’s blockers is on', () => {
    expect(markerCounts('instagram', ALL_ON)).toBe(true);
    expect(markerCounts('instagram', ALL_OFF)).toBe(false);
    expect(markerCounts('instagram', { ...ALL_OFF, instagramExplore: true })).toBe(true);
    expect(markerCounts('instagram', { ...ALL_ON, instagramReels: false, instagramExplore: false })).toBe(false);
    expect(markerCounts('youtube', { ...ALL_ON, youtubeShorts: false })).toBe(false);
    expect(markerCounts('youtube', { ...ALL_OFF, youtubeShorts: true })).toBe(true);
    expect(markerCounts('facebook', { ...ALL_ON, facebookReels: false })).toBe(false);
    expect(markerCounts('facebook', { ...ALL_OFF, facebookReels: true })).toBe(true);
    expect(markerCounts('x', { ...ALL_ON, xVideos: false })).toBe(false);
    expect(markerCounts('x', { ...ALL_OFF, xVideos: true })).toBe(true);
  });
});
