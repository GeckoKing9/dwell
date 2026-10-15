import { describe, expect, it } from 'vitest';
import { decideViewerMove, lockTarget, viewerKey, viewerLocked } from '../src/blocker/viewer.ts';
import { isAllowedTarget } from '../src/blocker/targets.ts';
import type { Settings } from '../src/store/schema.ts';

type Blockers = Settings['blockers'];

const ALL_ON: Blockers = { instagramReels: true, youtubeShorts: true, facebookReels: true, instagramExplore: true };
const ALL_OFF: Blockers = { instagramReels: false, youtubeShorts: false, facebookReels: false, instagramExplore: false };
const ID = 'dQw4w9WgXcQ';
const ID2 = 'AAAAAAAAAAA';
const CODE = 'DeewiSPpCrm';
const CODE2 = 'C0abcDEFghi';

describe('viewerKey: which single-video viewer a URL shows', () => {
  it.each([
    [`https://www.youtube.com/shorts/${ID}`, 'youtube', ID],
    [`https://m.youtube.com/shorts/${ID}/?feature=share`, 'youtube', ID],
    [`https://youtube.com/SHORTS/${ID}#t=3`, 'youtube', ID],
    [`https://www.youtube.com/@someone/shorts/${ID}`, 'youtube', ID],
    [`https://www.instagram.com/reel/${CODE}/`, 'instagram', CODE],
    [`https://www.instagram.com/reels/${CODE}/?igsh=x`, 'instagram', CODE],
    [`https://instagram.com/someuser/reels/${CODE}`, 'instagram', CODE],
    [`https://www.instagram.com/Reel/${CODE}/#comments`, 'instagram', CODE],
    ['https://www.facebook.com/reel/111', 'facebook', '111'],
    ['https://www.facebook.com/reel/1234567890/?s=x', 'facebook', '1234567890'],
    ['https://m.facebook.com/REEL/222#top', 'facebook', '222'],
  ])('reads %s as %s %s', (url, site, key) => {
    expect(viewerKey(url)).toEqual({ site, key });
  });

  it.each([
    'https://www.youtube.com/shorts/',
    `https://www.youtube.com/watch?v=${ID}`,
    'https://www.youtube.com/shorts/dQw4w9WgXc',
    'https://www.instagram.com/reels/',
    'https://www.instagram.com/someuser/reels/',
    'https://www.instagram.com/reel/abcd/',
    `https://www.instagram.com/p/${CODE}/`,
    'https://www.facebook.com/reel/',
    'https://www.facebook.com/reel/abc',
    'https://www.facebook.com/reels/111',
    'https://www.facebook.com/someone/reel/111',
    'https://web.facebook.com/reel/111',
    `http://www.instagram.com/reel/${CODE}/`,
    `https://evil.example/reel/${CODE}/`,
    'not a url',
  ])('finds no viewer in %s', (url) => {
    expect(viewerKey(url)).toBeNull();
  });
});

describe('lockTarget: where a locked viewer goes back to', () => {
  it('sends each site to its single-video page for the same key, from the allowlist', () => {
    const targets = [
      [lockTarget('youtube', ID), `https://www.youtube.com/watch?v=${ID}#dwell=youtube`],
      [lockTarget('instagram', CODE), `https://www.instagram.com/p/${CODE}/#dwell=instagram`],
      [lockTarget('facebook', '111'), 'https://www.facebook.com/reel/111#dwell=facebook'],
    ] as const;
    for (const [actual, expected] of targets) {
      expect(actual).toBe(expected);
      expect(isAllowedTarget(actual ?? '')).toBe(true);
    }
  });

  it('returns null for a key the site cannot have', () => {
    expect(lockTarget('youtube', 'short')).toBeNull();
    expect(lockTarget('instagram', 'abcd')).toBeNull();
    expect(lockTarget('facebook', 'abc')).toBeNull();
  });
});

describe('viewerLocked: whether the input lock applies to a URL', () => {
  it('locks a viewer only while that site’s toggle is on', () => {
    expect(viewerLocked('https://www.facebook.com/reel/111', ALL_ON)).toBe(true);
    expect(viewerLocked('https://www.facebook.com/reel/111', { ...ALL_ON, facebookReels: false })).toBe(false);
    expect(viewerLocked(`https://www.instagram.com/reel/${CODE}/`, { ...ALL_OFF, instagramReels: true })).toBe(true);
    expect(viewerLocked(`https://www.instagram.com/reel/${CODE}/`, { ...ALL_ON, instagramReels: false })).toBe(false);
    expect(viewerLocked(`https://www.youtube.com/shorts/${ID}`, { ...ALL_OFF, youtubeShorts: true })).toBe(true);
    expect(viewerLocked(`https://www.youtube.com/shorts/${ID}`, ALL_OFF)).toBe(false);
  });

  it('never locks a page that is not a viewer', () => {
    expect(viewerLocked('https://www.facebook.com/', ALL_ON)).toBe(false);
    expect(viewerLocked(`https://www.instagram.com/p/${CODE}/`, ALL_ON)).toBe(false);
    expect(viewerLocked(`https://www.youtube.com/watch?v=${ID}`, ALL_ON)).toBe(false);
  });
});

describe('decideViewerMove: one video, no next', () => {
  it.each([
    ['https://www.facebook.com/reel/111', 'https://www.facebook.com/reel/222', 'facebook', 'https://www.facebook.com/reel/111#dwell=facebook'],
    [
      `https://www.instagram.com/reels/${CODE}/`,
      `https://www.instagram.com/reels/${CODE2}/`,
      'instagram',
      `https://www.instagram.com/p/${CODE}/#dwell=instagram`,
    ],
    [
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/shorts/${ID2}`,
      'youtube',
      `https://www.youtube.com/watch?v=${ID}#dwell=youtube`,
    ],
    [
      'https://m.facebook.com/reel/111?s=a',
      'https://www.facebook.com/reel/222#x',
      'facebook',
      'https://www.facebook.com/reel/111#dwell=facebook',
    ],
  ])('locks a move from %s to %s back to the first video', (from, to, site, target) => {
    expect(decideViewerMove(from, to, ALL_ON)).toEqual({ action: 'lock', site, target });
  });

  it.each([
    ['https://www.facebook.com/', 'https://www.facebook.com/reel/111'],
    ['https://www.facebook.com/reel/111', 'https://www.facebook.com/'],
    ['https://www.facebook.com/reel/111', 'https://www.facebook.com/reel/111?s=x'],
    ['https://www.facebook.com/reel/111', 'https://www.facebook.com/reel/111#comments'],
    [`https://www.instagram.com/reel/${CODE}/`, `https://www.instagram.com/someuser/reels/${CODE}/`],
    [`https://www.instagram.com/reel/${CODE}/`, `https://www.instagram.com/p/${CODE}/`],
    [`https://www.instagram.com/reel/${CODE}/`, `https://www.youtube.com/shorts/${ID}`],
    ['https://www.facebook.com/reel/111', 'not a url'],
  ])('lets a move from %s to %s through', (from, to) => {
    expect(decideViewerMove(from, to, ALL_ON)).toEqual({ action: 'allow' });
  });

  it('lets every move through while that site’s toggle is off', () => {
    const fb = ['https://www.facebook.com/reel/111', 'https://www.facebook.com/reel/222'] as const;
    expect(decideViewerMove(...fb, { ...ALL_ON, facebookReels: false })).toEqual({ action: 'allow' });
    const ig = [`https://www.instagram.com/reel/${CODE}/`, `https://www.instagram.com/reel/${CODE2}/`] as const;
    expect(decideViewerMove(...ig, { ...ALL_ON, instagramReels: false })).toEqual({ action: 'allow' });
    const yt = [`https://www.youtube.com/shorts/${ID}`, `https://www.youtube.com/shorts/${ID2}`] as const;
    expect(decideViewerMove(...yt, { ...ALL_ON, youtubeShorts: false })).toEqual({ action: 'allow' });
  });

  it('compares keys exactly, since Instagram codes are case-sensitive', () => {
    const from = 'https://www.instagram.com/reel/AbCdEfG/';
    expect(decideViewerMove(from, 'https://www.instagram.com/reel/abcdefg/', ALL_ON)).toEqual({
      action: 'lock',
      site: 'instagram',
      target: 'https://www.instagram.com/p/AbCdEfG/#dwell=instagram',
    });
  });
});
