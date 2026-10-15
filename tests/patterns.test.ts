import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classify, type Classification } from '../src/blocker/patterns.ts';
import { REDIRECT_TARGETS, isAllowedTarget, youtubeWatchTarget } from '../src/blocker/targets.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/store/schema.ts';

type Blockers = Settings['blockers'];

const ALL_ON: Blockers = { instagramReels: true, youtubeShorts: true, facebookReels: true, instagramExplore: true };
const ALL_OFF: Blockers = { instagramReels: false, youtubeShorts: false, facebookReels: false, instagramExplore: false };
const IG_HOME = 'https://www.instagram.com/#dwell=instagram';
const FB_HOME = 'https://www.facebook.com/#dwell=facebook';
const ID = 'dQw4w9WgXcQ';
const WATCH = `https://www.youtube.com/watch?v=${ID}#dwell=youtube`;

function expectHit(url: string, site: Classification['site'], kind: Classification['kind'], target: string): void {
  expect(classify(url, ALL_ON)).toEqual({ site, kind, target });
}

describe('classify: Instagram', () => {
  it.each([
    'https://www.instagram.com/reels/',
    'https://www.instagram.com/reels/abc123/',
    'https://instagram.com/reels/abc123/',
    'https://www.instagram.com/reel/C0abc/',
    'https://www.instagram.com/reel/C0abc',
    'https://www.instagram.com/reels',
    'https://www.instagram.com/someuser/reels/',
    'https://www.instagram.com/someuser/reels',
    'https://www.instagram.com/REELS/abc/',
    'https://WWW.INSTAGRAM.COM/Reel/abc/',
    'https://www.instagram.com/reels/abc123/?igsh=xyz',
    'https://www.instagram.com/reel/abc/#comments',
  ])('blocks %s as reels, home target', (url) => {
    expectHit(url, 'instagram', 'reels', IG_HOME);
  });

  it.each([
    'https://www.instagram.com/explore/',
    'https://instagram.com/explore',
    'https://www.instagram.com/explore/tags/cats/',
    'https://www.instagram.com/EXPLORE/',
  ])('blocks %s as explore when the explore toggle is on', (url) => {
    expectHit(url, 'instagram', 'explore', IG_HOME);
  });

  it('prefers reels over explore when both match', () => {
    expectHit('https://www.instagram.com/explore/tags/reels/', 'instagram', 'reels', IG_HOME);
    const exploreOnly = { ...ALL_OFF, instagramExplore: true };
    expect(classify('https://www.instagram.com/explore/tags/reels/', exploreOnly)?.kind).toBe('explore');
  });

  it.each([
    'https://www.instagram.com/',
    'https://www.instagram.com/p/C0abc/',
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
    'https://www.facebook.com/reel/1234567890',
    'https://www.facebook.com/reel/1234567890/',
    'https://facebook.com/reels/',
    'https://m.facebook.com/reel/1234567890',
    'https://www.facebook.com/someone/reels/',
    'https://www.facebook.com/Reel/1?s=x',
  ])('blocks %s as reels, home target', (url) => {
    expectHit(url, 'facebook', 'reels', FB_HOME);
  });

  it.each([
    'https://www.facebook.com/',
    'https://www.facebook.com/watch/',
    'https://www.facebook.com/reelection2026/',
    'https://www.facebook.com/?sk=reels',
    'https://web.facebook.com/reel/1',
    'https://facebook.com.evil.example/reel/1',
  ])('leaves %s alone', (url) => {
    expect(classify(url, ALL_ON)).toBeNull();
  });
});

describe('classify: inputs that are not URLs', () => {
  it.each(['', 'not a url', '/reels/abc', 'javascript:alert(1)', 'chrome://extensions'])('returns null for %j', (url) => {
    expect(classify(url, ALL_ON)).toBeNull();
  });
});

describe('classify: per-site toggles', () => {
  const samples = {
    instagramReels: 'https://www.instagram.com/reels/abc/',
    instagramExplore: 'https://www.instagram.com/explore/',
    youtubeShorts: `https://www.youtube.com/shorts/${ID}`,
    facebookReels: 'https://www.facebook.com/reel/1',
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

  it('follows the defaults: reels and shorts on, explore off', () => {
    const defaults = DEFAULT_SETTINGS.blockers;
    expect(classify(samples.instagramReels, defaults)).not.toBeNull();
    expect(classify(samples.youtubeShorts, defaults)).not.toBeNull();
    expect(classify(samples.facebookReels, defaults)).not.toBeNull();
    expect(classify(samples.instagramExplore, defaults)).toBeNull();
  });
});

describe('targets', () => {
  it('never classify as blocked, for every pattern (loop guard)', () => {
    const targets = [IG_HOME, FB_HOME, WATCH, youtubeWatchTarget('ABCDEFGHIJK') ?? ''];
    for (const target of targets) {
      expect(classify(target, ALL_ON)).toBeNull();
      expect(classify(target.split('#')[0] ?? '', ALL_ON)).toBeNull();
    }
  });

  it('come from the allowlist for every classification', () => {
    const urls = [
      'https://www.instagram.com/reels/x/',
      'https://www.instagram.com/explore/',
      `https://m.youtube.com/shorts/${ID}`,
      'https://www.facebook.com/reel/1',
    ];
    for (const url of urls) {
      const hit = classify(url, ALL_ON);
      expect(hit).not.toBeNull();
      expect(isAllowedTarget(hit?.target ?? '')).toBe(true);
    }
  });

  it('never carry a query parameter named dwell', () => {
    for (const target of [IG_HOME, FB_HOME, WATCH]) {
      expect(new URL(target).searchParams.has('dwell')).toBe(false);
      expect(new URL(target).hash).toMatch(/^#dwell=(instagram|youtube|facebook)$/);
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

  it.each([
    IG_HOME,
    FB_HOME,
    WATCH,
    'https://www.youtube.com/watch?v=a-b_c-d_e-f#dwell=youtube',
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
