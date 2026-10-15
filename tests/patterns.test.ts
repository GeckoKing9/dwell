import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classify, type Classification } from '../src/blocker/patterns.ts';
import {
  REDIRECT_TARGETS,
  facebookReelTarget,
  instagramPostTarget,
  isAllowedTarget,
  xTweetTarget,
  youtubeWatchTarget,
} from '../src/blocker/targets.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/store/schema.ts';

type Blockers = Settings['blockers'];

const ALL_ON: Blockers = { instagramReels: true, youtubeShorts: true, facebookReels: true, xVideos: true, instagramExplore: true };
const ALL_OFF: Blockers = { instagramReels: false, youtubeShorts: false, facebookReels: false, xVideos: false, instagramExplore: false };
const IG_HOME = 'https://www.instagram.com/#dwell=instagram';
const FB_HOME = 'https://www.facebook.com/#dwell=facebook';
const ID = 'dQw4w9WgXcQ';
const WATCH = `https://www.youtube.com/watch?v=${ID}#dwell=youtube`;
const CODE = 'DeewiSPpCrm';
const POST = `https://www.instagram.com/p/${CODE}/#dwell=instagram`;
const FB_REEL = 'https://www.facebook.com/reel/1234567890#dwell=facebook';
const TWEET = 'https://x.com/someuser/status/1234567890#dwell=x';
const TWEET_I = 'https://x.com/i/status/1234567890#dwell=x';

function expectHit(url: string, site: Classification['site'], kind: Classification['kind'], target: string): void {
  expect(classify(url, ALL_ON)).toEqual({ site, kind, target });
}

describe('classify: Instagram', () => {
  it.each([
    'https://www.instagram.com/reels/',
    'https://www.instagram.com/reels',
    'https://instagram.com/reels/',
    'https://www.instagram.com/reel/',
    'https://www.instagram.com/reel',
    'https://www.instagram.com/REELS/',
    'https://www.instagram.com/reels/?igsh=xyz',
    'https://www.instagram.com/reels/#top',
    'https://www.instagram.com/reels/abcd/',
    'https://www.instagram.com/reel/abcd/',
    'https://www.instagram.com/reel/ab.cde/',
    'https://www.instagram.com/reel/ab%2Fcde/',
    'https://www.instagram.com/reels/audio/1234567890/',
    `https://www.instagram.com/reel/${CODE}/liked_by/`,
  ])('sends the Reels feed %s home', (url) => {
    expectHit(url, 'instagram', 'reels', IG_HOME);
  });

  it.each([
    [`https://www.instagram.com/reels/${CODE}/`, CODE],
    [`https://www.instagram.com/reels/${CODE}`, CODE],
    [`https://instagram.com/reels/${CODE}/?igsh=xyz`, CODE],
    [`https://www.instagram.com/reels/${CODE}/#comments`, CODE],
    [`https://www.instagram.com/some.user_1/reels/${CODE}/`, CODE],
    ['https://WWW.INSTAGRAM.COM/Reels/C0abc/', 'C0abc'],
    ['https://www.instagram.com/reels/a-b_c/', 'a-b_c'],
    [`https://www.instagram.com/reels/${'x'.repeat(80)}/`, 'x'.repeat(80)],
  ])('rewrites the Reels scroller on one Reel, %s, to the post page for %s', (url, code) => {
    expectHit(url, 'instagram', 'reel', `https://www.instagram.com/p/${code}/#dwell=instagram`);
  });

  it.each([
    `https://www.instagram.com/reel/${CODE}/`,
    `https://www.instagram.com/reel/${CODE}`,
    `https://instagram.com/reel/${CODE}/?igsh=xyz`,
    `https://www.instagram.com/reel/${CODE}/#comments`,
    `https://www.instagram.com/someuser/reel/${CODE}/`,
    `https://www.instagram.com/some.user_1/reel/${CODE}`,
    'https://WWW.INSTAGRAM.COM/Reel/C0abc/',
    'https://www.instagram.com/reel/a-b_c/',
    `https://www.instagram.com/reel/${'x'.repeat(80)}/`,
  ])('lets the single Reel %s load: it opens in Instagram’s own pop-up or post page', (url) => {
    expect(classify(url, ALL_ON)).toBeNull();
  });

  it.each([
    'https://www.instagram.com/explore/',
    'https://instagram.com/explore',
    'https://www.instagram.com/explore/tags/cats/',
    'https://www.instagram.com/EXPLORE/',
    `https://www.instagram.com/explore/reel/${CODE}/`,
  ])('blocks %s as explore when the explore toggle is on', (url) => {
    expectHit(url, 'instagram', 'explore', IG_HOME);
  });

  it('treats a hashtag named reels as Explore, not as the Reels feed', () => {
    expectHit('https://www.instagram.com/explore/tags/reels/', 'instagram', 'explore', IG_HOME);
    const reelsOnly = { ...ALL_OFF, instagramReels: true };
    expect(classify('https://www.instagram.com/explore/tags/reels/', reelsOnly)).toBeNull();
  });

  it.each([
    'https://www.instagram.com/',
    `https://www.instagram.com/p/${CODE}/`,
    'https://www.instagram.com/someuser/reels/',
    'https://www.instagram.com/someuser/reels',
    'https://www.instagram.com/someuser/reel/',
    'https://www.instagram.com/someuser/reels/abcd/',
    `https://www.instagram.com/a/b/reels/${CODE}/`,
    `https://www.instagram.com/someuser/reel/${CODE}/liked_by/`,
    'https://www.instagram.com/reelsfan/',
    'https://www.instagram.com/myreel/',
    'https://www.instagram.com/explorer/',
    'https://www.instagram.com/?next=/reels/abc/',
    'https://www.instagram.com/#/reels/',
    'https://m.instagram.com/reels/',
    'https://instagram.com.evil.example/reels/',
    'https://evil.example/www.instagram.com/reels/',
    'http://www.instagram.com/reels/',
  ])('leaves %s alone', (url) => {
    expect(classify(url, ALL_ON)).toBeNull();
  });
});

describe('classify: YouTube', () => {
  it.each([
    [`https://www.youtube.com/shorts/${ID}`, ID],
    [`https://youtube.com/shorts/${ID}`, ID],
    [`https://m.youtube.com/shorts/${ID}`, ID],
    [`https://www.youtube.com/shorts/${ID}/`, ID],
    [`https://www.youtube.com/shorts/${ID}?feature=share`, ID],
    [`https://www.youtube.com/shorts/${ID}#t=3`, ID],
    ['https://www.youtube.com/shorts/ABCDEFGHIJK', 'ABCDEFGHIJK'],
    ['https://www.youtube.com/SHORTS/a-b_c-d_e-f', 'a-b_c-d_e-f'],
    [`https://www.youtube.com/@someone/shorts/${ID}`, ID],
  ])('rewrites %s to the watch page for %s', (url, id) => {
    expectHit(url, 'youtube', 'shorts', `https://www.youtube.com/watch?v=${id}#dwell=youtube`);
  });

  it.each([
    'https://www.youtube.com/shorts/',
    'https://www.youtube.com/shorts',
    'https://www.youtube.com/@someone/shorts',
    'https://www.youtube.com/shorts/dQw4w9WgXcQx',
    'https://www.youtube.com/shorts/dQw4w9WgXc',
    'https://www.youtube.com/shorts/dQw4w?9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w/9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgX.Q',
    'https://www.youtube.com/shorts/dQw4w9WgX%51',
    `https://www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/?next=/shorts/${ID}`,
    `https://music.youtube.com/shorts/${ID}`,
    `https://www.youtube-nocookie.com/shorts/${ID}`,
    `https://www.youtube.com.evil.example/shorts/${ID}`,
  ])('leaves %s alone', (url) => {
    expect(classify(url, ALL_ON)).toBeNull();
  });
});

describe('classify: Facebook', () => {
  it.each([
    'https://www.facebook.com/reel/',
    'https://www.facebook.com/reel',
    'https://www.facebook.com/reels/',
    'https://facebook.com/reels',
    'https://m.facebook.com/reel/',
    'https://www.facebook.com/Reels/?s=x',
    'https://www.facebook.com/reel/#top',
  ])('sends the Reels feed %s home', (url) => {
    expectHit(url, 'facebook', 'reels', FB_HOME);
  });

  it.each([
    'https://www.facebook.com/',
    'https://www.facebook.com/reel/1234567890',
    'https://www.facebook.com/reel/1234567890/',
    'https://m.facebook.com/reel/1234567890',
    'https://www.facebook.com/Reel/1?s=x',
    'https://www.facebook.com/reel/abc',
    'https://www.facebook.com/someone/reels/',
    'https://www.facebook.com/watch/',
    'https://www.facebook.com/reelection2026/',
    'https://www.facebook.com/?sk=reels',
    'https://web.facebook.com/reels/',
    'https://facebook.com.evil.example/reels/',
  ])('leaves %s alone', (url) => {
    expect(classify(url, ALL_ON)).toBeNull();
  });
});

describe('classify: X', () => {
  it.each([
    ['https://x.com/someuser/status/1234567890/video/1', 'someuser', '1234567890'],
    ['https://x.com/someuser/status/1234567890/video/1/', 'someuser', '1234567890'],
    ['https://x.com/someuser/status/1234567890/video/2?s=20&t=abc', 'someuser', '1234567890'],
    ['https://x.com/someuser/status/1234567890/video/1#top', 'someuser', '1234567890'],
    ['https://x.com/i/status/1234567890/video/1', 'i', '1234567890'],
    ['https://x.com/Some_User/STATUS/1234567890/Video/1', 'Some_User', '1234567890'],
    [`https://x.com/${'a'.repeat(15)}/status/1/video/1`, 'a'.repeat(15), '1'],
    [`https://x.com/someuser/status/${'9'.repeat(25)}/video/1`, 'someuser', '9'.repeat(25)],
  ])('rewrites the video viewer %s to the tweet page of %s, status %s', (url, user, id) => {
    expectHit(url, 'x', 'video', `https://x.com/${user}/status/${id}#dwell=x`);
  });

  it.each([
    'https://x.com/',
    'https://x.com/home',
    'https://x.com/someuser',
    'https://x.com/someuser/media',
    'https://x.com/someuser/status/1234567890',
    'https://x.com/someuser/status/1234567890/',
    'https://x.com/someuser/status/1234567890/photo/1',
    'https://x.com/someuser/status/1234567890/analytics',
    'https://x.com/someuser/status/1234567890/video',
    'https://x.com/someuser/status/1234567890/video/',
    'https://x.com/someuser/status/1234567890/video/one',
    'https://x.com/someuser/status/1234567890/video/1/likes',
    'https://x.com/someuser/status/12a/video/1',
    'https://x.com/someuser/status//video/1',
    `https://x.com/someuser/status/${'9'.repeat(26)}/video/1`,
    'https://x.com/some.user/status/1/video/1',
    'https://x.com/some-user/status/1/video/1',
    'https://x.com/i/web/status/1/video/1',
    'https://x.com/a/b/status/1/video/1',
    'https://x.com/search?q=/someuser/status/1/video/1',
    'https://x.com/#/someuser/status/1/video/1',
    'https://www.x.com/someuser/status/1/video/1',
    'https://mobile.x.com/someuser/status/1/video/1',
    'https://twitter.com/someuser/status/1/video/1',
    'https://x.com.evil.example/someuser/status/1/video/1',
    'http://x.com/someuser/status/1/video/1',
  ])('leaves %s alone', (url) => {
    expect(classify(url, ALL_ON)).toBeNull();
  });

  it('leaves the viewer alone while the X toggle is off, whatever the others say', () => {
    expect(classify('https://x.com/someuser/status/1/video/1', { ...ALL_ON, xVideos: false })).toBeNull();
    expect(classify('https://x.com/someuser/status/1/video/1', { ...ALL_OFF, xVideos: true })).not.toBeNull();
  });
});

describe('classify: inputs that are not URLs', () => {
  it.each(['', 'not a url', '/reels/abc', 'javascript:alert(1)', 'chrome://extensions'])('returns null for %j', (url) => {
    expect(classify(url, ALL_ON)).toBeNull();
  });
});

describe('classify: per-site toggles', () => {
  const samples = {
    instagramReels: `https://www.instagram.com/reels/${CODE}/`,
    instagramExplore: 'https://www.instagram.com/explore/',
    youtubeShorts: `https://www.youtube.com/shorts/${ID}`,
    facebookReels: 'https://www.facebook.com/reels/',
    xVideos: 'https://x.com/someuser/status/1234567890/video/1',
  } as const;
  const keys = Object.keys(samples) as (keyof typeof samples)[];

  it.each(keys)('turning %s off frees its own pattern and leaves the others intact', (off) => {
    const blockers = { ...ALL_ON, [off]: false };
    for (const key of keys) {
      const result = classify(samples[key], blockers);
      if (key === off) expect(result).toBeNull();
      else expect(result).not.toBeNull();
    }
  });

  it('blocks nothing with every toggle off', () => {
    for (const key of keys) expect(classify(samples[key], ALL_OFF)).toBeNull();
  });

  it('follows the defaults: reels, shorts and X videos on, explore off', () => {
    const defaults = DEFAULT_SETTINGS.blockers;
    expect(classify(samples.instagramReels, defaults)).not.toBeNull();
    expect(classify(samples.youtubeShorts, defaults)).not.toBeNull();
    expect(classify(samples.facebookReels, defaults)).not.toBeNull();
    expect(classify(samples.xVideos, defaults)).not.toBeNull();
    expect(classify(samples.instagramExplore, defaults)).toBeNull();
  });
});

describe('targets', () => {
  it('never classify as blocked, for every pattern (loop guard)', () => {
    const targets = [IG_HOME, FB_HOME, WATCH, POST, FB_REEL, TWEET, TWEET_I, youtubeWatchTarget('ABCDEFGHIJK') ?? ''];
    for (const target of targets) {
      expect(classify(target, ALL_ON)).toBeNull();
      expect(classify(target.split('#')[0] ?? '', ALL_ON)).toBeNull();
    }
  });

  it('come from the allowlist for every classification', () => {
    const urls = [
      'https://www.instagram.com/reels/x/',
      `https://www.instagram.com/someuser/reels/${CODE}/`,
      'https://www.instagram.com/explore/',
      `https://m.youtube.com/shorts/${ID}`,
      'https://www.facebook.com/reels/',
      'https://x.com/Some_User/status/1/video/1',
      'https://x.com/i/status/1234567890/video/3',
    ];
    for (const url of urls) {
      const hit = classify(url, ALL_ON);
      expect(hit).not.toBeNull();
      expect(isAllowedTarget(hit?.target ?? '')).toBe(true);
    }
  });

  it('never carry a query parameter named dwell', () => {
    for (const target of [IG_HOME, FB_HOME, WATCH, POST, FB_REEL, TWEET, TWEET_I]) {
      expect(new URL(target).searchParams.has('dwell')).toBe(false);
      expect(new URL(target).hash).toMatch(/^#dwell=(instagram|youtube|facebook|x)$/);
    }
  });

  it('keep the fixed allowlist frozen', () => {
    expect(Object.isFrozen(REDIRECT_TARGETS)).toBe(true);
    expect(REDIRECT_TARGETS).toEqual({ instagram: IG_HOME, facebook: FB_HOME });
  });

  it('builds the YouTube target only from a valid 11-character id', () => {
    expect(youtubeWatchTarget(ID)).toBe(WATCH);
    expect(youtubeWatchTarget('short')).toBeNull();
    expect(youtubeWatchTarget('dQw4w9WgXcQx')).toBeNull();
    expect(youtubeWatchTarget('dQw4w9WgX&Q')).toBeNull();
    expect(youtubeWatchTarget('dQw4w9WgX#Q')).toBeNull();
  });

  it('builds the Instagram post target only from a code of 5 or more safe characters', () => {
    expect(instagramPostTarget(CODE)).toBe(POST);
    expect(instagramPostTarget('a-b_c')).toBe('https://www.instagram.com/p/a-b_c/#dwell=instagram');
    expect(instagramPostTarget('x'.repeat(80))).not.toBeNull();
    expect(instagramPostTarget('abcd')).toBeNull();
    expect(instagramPostTarget('')).toBeNull();
    expect(instagramPostTarget('ab/cde')).toBeNull();
    expect(instagramPostTarget('ab.cde')).toBeNull();
    expect(instagramPostTarget('abcde#x')).toBeNull();
  });

  it('builds the Facebook reel target only from a numeric id', () => {
    expect(facebookReelTarget('1234567890')).toBe(FB_REEL);
    expect(facebookReelTarget('1')).toBe('https://www.facebook.com/reel/1#dwell=facebook');
    expect(facebookReelTarget('')).toBeNull();
    expect(facebookReelTarget('12a')).toBeNull();
    expect(facebookReelTarget('1'.repeat(33))).toBeNull();
    expect(facebookReelTarget('12/3')).toBeNull();
  });

  it('builds the X tweet target only from a valid user, or i, and a status id of 1 to 25 digits', () => {
    expect(xTweetTarget('someuser', '1234567890')).toBe(TWEET);
    expect(xTweetTarget('i', '1234567890')).toBe(TWEET_I);
    expect(xTweetTarget('Some_User', '1')).toBe('https://x.com/Some_User/status/1#dwell=x');
    expect(xTweetTarget('someuser', '9'.repeat(25))).not.toBeNull();
    expect(xTweetTarget('someuser', '9'.repeat(26))).toBeNull();
    expect(xTweetTarget('someuser', '')).toBeNull();
    expect(xTweetTarget('someuser', '12a')).toBeNull();
    expect(xTweetTarget('', '1')).toBeNull();
    expect(xTweetTarget('some.user', '1')).toBeNull();
    expect(xTweetTarget('some/user', '1')).toBeNull();
    expect(xTweetTarget('someuser#x', '1')).toBeNull();
  });

  it.each([
    IG_HOME,
    FB_HOME,
    WATCH,
    POST,
    FB_REEL,
    TWEET,
    TWEET_I,
    'https://x.com/Some_User/status/1#dwell=x',
    'https://www.youtube.com/watch?v=a-b_c-d_e-f#dwell=youtube',
    'https://www.instagram.com/p/a-b_c/#dwell=instagram',
  ])('allows %s', (url) => {
    expect(isAllowedTarget(url)).toBe(true);
  });

  it.each([
    'https://www.instagram.com/',
    'https://www.instagram.com/#dwell=facebook',
    'https://www.instagram.com/?dwell=instagram',
    'https://evil.example/#dwell=instagram',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&x=1#dwell=youtube',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQx#dwell=youtube',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ#dwell=youtube',
    'http://www.youtube.com/watch?v=dQw4w9WgXcQ#dwell=youtube',
    'javascript:alert(1)//#dwell=youtube',
    'https://www.instagram.com/p/abcd/#dwell=instagram',
    `https://www.instagram.com/p/${CODE}#dwell=instagram`,
    `https://instagram.com/p/${CODE}/#dwell=instagram`,
    `https://www.instagram.com/p/${CODE}/?x=1#dwell=instagram`,
    `https://www.instagram.com/reel/${CODE}/#dwell=instagram`,
    `https://www.instagram.com/p/${CODE}/#dwell=facebook`,
    'https://www.instagram.com/p/ab.cde/#dwell=instagram',
    'https://www.facebook.com/reel/#dwell=facebook',
    'https://www.facebook.com/reel/12a#dwell=facebook',
    'https://www.facebook.com/reel/123/#dwell=facebook',
    'https://m.facebook.com/reel/123#dwell=facebook',
    'https://www.facebook.com/reel/123#dwell=instagram',
    'https://www.facebook.com/reel/123?x=1#dwell=facebook',
    'https://x.com/someuser/status/1234567890',
    'https://x.com/someuser/status/1234567890/#dwell=x',
    'https://x.com/someuser/status/1234567890/video/1#dwell=x',
    'https://x.com/someuser/status/1234567890?s=20#dwell=x',
    'https://x.com/someuser/status/12a#dwell=x',
    `https://x.com/someuser/status/${'9'.repeat(26)}#dwell=x`,
    'https://x.com/some.user/status/1#dwell=x',
    'https://x.com//status/1#dwell=x',
    'https://www.x.com/someuser/status/1#dwell=x',
    'https://twitter.com/someuser/status/1#dwell=x',
    'http://x.com/someuser/status/1#dwell=x',
    'https://x.com/someuser/status/1#dwell=twitter',
    'https://x.com/someuser/status/1#dwell=instagram',
    'https://x.com/#dwell=x',
    '',
  ])('refuses %j', (url) => {
    expect(isAllowedTarget(url)).toBe(false);
  });
});

describe('redirect sinks in src/ (KTD5)', () => {
  const root = fileURLToPath(new URL('../src', import.meta.url));
  const SINK = /\b(?:location\.(?:replace|assign)|tabs\.(?:update|create)|windows\.create)\s*\(|\blocation\.href\s*=(?!=)/g;

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /\.tsx?$/.test(entry.name) ? [path] : [];
    });
  }

  it('route every navigation through isAllowedTarget', () => {
    for (const file of sources(root)) {
      const text = readFileSync(file, 'utf8');
      if ([...text.matchAll(SINK)].length === 0) continue;
      expect({ file: relative(root, file), usesAllowlist: text.includes('isAllowedTarget(') }).toEqual({
        file: relative(root, file),
        usesAllowlist: true,
      });
    }
  });

  it('keep the guard navigating only inside go(), after the allowlist check', () => {
    const guard = readFileSync(join(root, 'content/guard.ts'), 'utf8');
    const start = guard.indexOf('function go(');
    const end = guard.indexOf('\n}\n', start);
    const body = guard.slice(start, end);
    const hits = [...guard.matchAll(SINK)].map((m) => m.index);
    expect(hits).toHaveLength(2);
    for (const index of hits) expect(index > start && index < end).toBe(true);
    expect(body.indexOf('!isAllowedTarget(target)')).toBeGreaterThan(-1);
    expect(body.indexOf('!isAllowedTarget(target)')).toBeLessThan(body.indexOf('location.'));
  });
});
