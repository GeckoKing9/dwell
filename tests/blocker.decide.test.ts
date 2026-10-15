import { describe, expect, it } from 'vitest';
import { LOOP_MAX_REDIRECTS, LOOP_WINDOW_MS, admitRedirect, decide, markerCounts } from '../src/blocker/decide.ts';
import { classify } from '../src/blocker/patterns.ts';
import type { Settings } from '../src/store/schema.ts';

type Blockers = Settings['blockers'];

const ALL_ON: Blockers = { instagramReels: true, youtubeShorts: true, facebookReels: true, instagramExplore: true };
const ALL_OFF: Blockers = { instagramReels: false, youtubeShorts: false, facebookReels: false, instagramExplore: false };
const NOW = 1_700_000_000_000;
const SHORT = classify('https://www.youtube.com/shorts/dQw4w9WgXcQ', ALL_ON);
const REEL = classify('https://www.instagram.com/reels/abc/', ALL_ON);
const EXPLORE = classify('https://www.instagram.com/explore/', ALL_ON);
const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ#dwell=youtube';

describe('decide: a cancelable in-page navigation', () => {
  it('lets the navigation through when the classifier blocks nothing', () => {
    expect(decide(null, { now: NOW, redirects: [] })).toEqual({ action: 'allow' });
  });

  it('cancels an in-page Reel or Explore and counts it there, whatever the loop guard holds', () => {
    expect(decide(REEL, { now: NOW, redirects: [NOW - 2, NOW - 1] })).toEqual({ action: 'cancel', site: 'instagram' });
    expect(decide(EXPLORE, { now: NOW, redirects: [] })).toEqual({ action: 'cancel', site: 'instagram' });
  });

  it('redirects a Shorts tap to the watch page and records the redirect', () => {
    expect(decide(SHORT, { now: NOW, redirects: [NOW - 1000] })).toEqual({
      action: 'redirect',
      target: WATCH,
      redirects: [NOW - 1000, NOW],
    });
  });

  it('lets the third Shorts tap within 5 s through instead of cancelling it', () => {
    expect(decide(SHORT, { now: NOW, redirects: [NOW - 1000, NOW - 500] })).toEqual({ action: 'allow' });
  });

  it('never cancels a Shorts tap toward a target outside the allowlist', () => {
    const forged = { site: 'youtube', kind: 'shorts', target: 'https://evil.example/#dwell=youtube' } as const;
    expect(decide(forged, { now: NOW, redirects: [] })).toEqual({ action: 'allow' });
  });
});

describe('admitRedirect: the loop guard', () => {
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
  });
});
