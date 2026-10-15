/**
 * The five static DNR rulesets mirror the classifier for hard loads. Chrome evaluates `regexFilter`
 * with RE2; this suite uses JS RegExp as an approximation (same syntax for the subset used here) and
 * separately rejects the constructs RE2 refuses (lookaround, backreferences). JS cannot see RE2's
 * per-rule memory cap: a host alternation plus `{11}` exceeds it and Chrome silently drops the rule,
 * which is why Shorts has one rule per host. tests/e2e/blocker.spec.ts asks Chrome itself
 * (`isRegexSupported`, `testMatchOutcome`) about every rule.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classify } from '../src/blocker/patterns.ts';
import {
  REDIRECT_TARGETS,
  facebookReelTarget,
  instagramPostTarget,
  isAllowedTarget,
  xTweetTarget,
  youtubeWatchTarget,
} from '../src/blocker/targets.ts';
import type { Settings } from '../src/store/schema.ts';

type Blockers = Settings['blockers'];

interface Rule {
  id: number;
  priority: number;
  action: { type: 'redirect'; redirect: { url?: string; regexSubstitution?: string } };
  condition: { regexFilter: string; isUrlFilterCaseSensitive?: boolean; resourceTypes: string[] };
}

const RULESETS: Record<string, keyof Blockers> = {
  'instagram-reels': 'instagramReels',
  'instagram-explore': 'instagramExplore',
  'youtube-shorts': 'youtubeShorts',
  'facebook-reels': 'facebookReels',
  'x-videos': 'xVideos',
};
const NONE: Blockers = { instagramReels: false, youtubeShorts: false, facebookReels: false, xVideos: false, instagramExplore: false };
const ID = 'dQw4w9WgXcQ';
const CODE = 'DeewiSPpCrm';
const TARGETS = [
  REDIRECT_TARGETS.instagram,
  REDIRECT_TARGETS.facebook,
  youtubeWatchTarget(ID) ?? '',
  instagramPostTarget(CODE) ?? '',
  facebookReelTarget('1234567890') ?? '',
  xTweetTarget('someuser', '1234567890') ?? '',
  xTweetTarget('i', '1234567890') ?? '',
  xTweetTarget('Some_User', '1') ?? '',
];

const SAMPLES = [
  'https://www.instagram.com/',
  'https://www.instagram.com/reels/',
  'https://www.instagram.com/reels/abc123/?igsh=xyz',
  'https://instagram.com/reel/C0abc',
  'https://www.instagram.com/reels',
  'https://www.instagram.com/reel/',
  'https://www.instagram.com/someuser/reels/',
  'https://www.instagram.com/someuser/reel/',
  'https://www.instagram.com/someuser/reels/abcd/',
  `https://www.instagram.com/someuser/reel/${CODE}/`,
  `https://instagram.com/some.user_1/reels/${CODE}?igsh=x`,
  `https://www.instagram.com/a/b/reels/${CODE}/`,
  `https://www.instagram.com/reels/${CODE}/`,
  `https://www.instagram.com/reel/${CODE}/#comments`,
  'https://www.instagram.com/reels/audio/1234567890/',
  `https://www.instagram.com/reel/${CODE}/liked_by/?x=1`,
  `https://www.instagram.com/someuser/reel/${CODE}/liked_by/`,
  'https://WWW.INSTAGRAM.COM/Reel/abc/',
  'https://WWW.INSTAGRAM.COM/Reel/C0abcDEF/',
  'https://www.instagram.com/reel/abcd/',
  'https://www.instagram.com/reel/ab.cde/',
  `https://www.instagram.com/reel/${'x'.repeat(80)}/`,
  'https://www.instagram.com/reel/ab%2Fcde/',
  'https://www.instagram.com/explore/tags/reels/',
  'https://www.instagram.com/reelsfan/',
  'https://www.instagram.com/p/C0abc/',
  `https://www.instagram.com/p/${CODE}/`,
  'https://www.instagram.com/?next=/reels/abc/',
  'https://www.instagram.com/#/reels/',
  'https://www.instagram.com/explore/',
  'https://instagram.com/explore',
  'https://www.instagram.com/explore/tags/cats/',
  'https://www.instagram.com/explorer/',
  'https://m.instagram.com/reels/',
  'http://www.instagram.com/reels/',
  `https://www.youtube.com/shorts/${ID}`,
  `https://youtube.com/shorts/${ID}`,
  `https://m.youtube.com/shorts/${ID}/`,
  `https://www.youtube.com/shorts/${ID}?feature=share`,
  `https://www.youtube.com/shorts/${ID}#t=3`,
  'https://www.youtube.com/SHORTS/a-b_c-d_e-f',
  `https://www.youtube.com/@someone/shorts/${ID}`,
  'https://www.youtube.com/shorts/',
  'https://www.youtube.com/@someone/shorts',
  'https://www.youtube.com/shorts/dQw4w9WgXcQx',
  'https://www.youtube.com/shorts/dQw4w9WgXc',
  'https://www.youtube.com/shorts/dQw4w?9WgXcQ',
  'https://www.youtube.com/shorts/dQw4w/9WgXcQ',
  `https://www.youtube.com/?next=/shorts/${ID}`,
  `https://music.youtube.com/shorts/${ID}`,
  `https://www.youtube.com.evil.example/shorts/${ID}`,
  'https://www.facebook.com/reel/1234567890',
  'https://facebook.com/reels/',
  'https://www.facebook.com/reels',
  'https://www.facebook.com/reel/',
  'https://m.facebook.com/reel',
  'https://www.facebook.com/Reels/?s=x',
  'https://m.facebook.com/reel/1234567890/',
  'https://www.facebook.com/reel/abc',
  'https://www.facebook.com/someone/reels/',
  'https://www.facebook.com/Reel/1?s=x',
  'https://www.facebook.com/reelection2026/',
  'https://www.facebook.com/?sk=reels',
  'https://web.facebook.com/reel/1',
  'https://web.facebook.com/reels/',
  'https://x.com/someuser/status/1234567890/video/1',
  'https://x.com/someuser/status/1234567890/video/1/',
  'https://x.com/someuser/status/1234567890/video/2?s=20&t=abc',
  'https://x.com/someuser/status/1234567890/video/1#top',
  'https://x.com/i/status/1234567890/video/1',
  'https://x.com/Some_User/STATUS/1234567890/Video/1',
  `https://x.com/${'a'.repeat(16)}/status/1/video/1`,
  `https://x.com/someuser/status/${'9'.repeat(25)}/video/1`,
  `https://x.com/someuser/status/${'9'.repeat(26)}/video/1`,
  'https://x.com/someuser/status/1234567890',
  'https://x.com/someuser/status/1234567890/photo/1',
  'https://x.com/someuser/status/1234567890/video/',
  'https://x.com/someuser/status/1234567890/video/one',
  'https://x.com/someuser/status/1234567890/video/1/likes',
  'https://x.com/someuser/status/12a/video/1',
  'https://x.com/some.user/status/1/video/1',
  'https://x.com/i/web/status/1/video/1',
  'https://x.com/a/b/status/1/video/1',
  'https://x.com/search?q=/someuser/status/1/video/1',
  'https://x.com/home',
  'https://www.x.com/someuser/status/1/video/1',
  'https://twitter.com/someuser/status/1/video/1',
  'http://x.com/someuser/status/1/video/1',
  ...TARGETS,
];

function load(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../src/blocker/rulesets/${name}.json`, import.meta.url), 'utf8'));
}

function rules(name: string): Rule[] {
  return load(name) as Rule[];
}

/** What Chrome sends to DNR: the canonical URL without its fragment. */
function requestUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  return parsed.href;
}

function compile(rule: Rule): RegExp {
  return new RegExp(rule.condition.regexFilter, rule.condition.isUrlFilterCaseSensitive === true ? '' : 'i');
}

/** The redirect DNR would perform, or null when no rule in the set matches. The highest priority wins. */
function redirectFor(set: Rule[], url: string): string | null {
  for (const rule of [...set].sort((a, b) => b.priority - a.priority)) {
    const re = compile(rule);
    if (!re.test(url)) continue;
    const { url: fixed, regexSubstitution } = rule.action.redirect;
    if (fixed !== undefined) return fixed;
    return url.replace(re, (regexSubstitution ?? '').replace(/\\(\d)/g, '$$$1'));
  }
  return null;
}

describe.each(Object.entries(RULESETS))('ruleset %s', (name, toggle) => {
  const set = rules(name);

  it('has a valid shape with fewer than 10 rules and unique ids', () => {
    const raw = load(name);
    expect(Array.isArray(raw)).toBe(true);
    expect(set.length).toBeGreaterThan(0);
    expect(set.length).toBeLessThan(10);
    expect(new Set(set.map((r) => r.id)).size).toBe(set.length);
    for (const rule of set) {
      expect(Object.keys(rule).sort()).toEqual(['action', 'condition', 'id', 'priority']);
      expect(Number.isInteger(rule.id) && rule.id > 0).toBe(true);
      expect(Number.isInteger(rule.priority) && rule.priority > 0).toBe(true);
      expect(rule.action.type).toBe('redirect');
      expect(Object.keys(rule.action.redirect)).toHaveLength(1);
      expect(Object.keys(rule.condition).sort()).toEqual(['isUrlFilterCaseSensitive', 'regexFilter', 'resourceTypes']);
      expect(typeof rule.condition.regexFilter).toBe('string');
    }
  });

  it('redirects top-level page loads only, never a frame embedded in another page', () => {
    for (const rule of set) expect(rule.condition.resourceTypes).toEqual(['main_frame']);
  });

  it('uses only RE2-compatible, anchored https patterns', () => {
    for (const rule of set) {
      const filter = rule.condition.regexFilter;
      expect(filter).not.toMatch(/\(\?<?[=!]/);
      expect(filter).not.toMatch(/\\[1-9]/);
      expect(filter.startsWith('^https://')).toBe(true);
    }
  });

  it('redirects only to allowlisted targets', () => {
    for (const rule of set) {
      const { url, regexSubstitution } = rule.action.redirect;
      const target = url ?? (regexSubstitution ?? '').replace('\\1', ID).replace('\\2', '1234567890');
      expect(isAllowedTarget(target)).toBe(true);
      expect(new URL(target).searchParams.has('dwell')).toBe(false);
    }
  });

  it('matches exactly the URLs the classifier blocks for its toggle, with the same target', () => {
    const blockers = { ...NONE, [toggle]: true };
    for (const sample of SAMPLES) {
      const expected = classify(sample, blockers)?.target ?? null;
      expect({ sample, redirect: redirectFor(set, requestUrl(sample)) }).toEqual({ sample, redirect: expected });
    }
  });

  it('never matches a redirect target (loop guard)', () => {
    for (const target of TARGETS) {
      expect(redirectFor(set, target)).toBeNull();
      expect(redirectFor(set, requestUrl(target))).toBeNull();
    }
  });
});
