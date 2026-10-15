/**
 * The four static DNR rulesets mirror the classifier for hard loads. Chrome evaluates `regexFilter`
 * with RE2; this suite uses JS RegExp as an approximation (same syntax for the subset used here) and
 * separately rejects the constructs RE2 refuses (lookaround, backreferences). JS cannot see RE2's
 * per-rule memory cap: a host alternation plus `{11}` exceeds it and Chrome silently drops the rule,
 * which is why Shorts has one rule per host. tests/e2e/blocker.spec.ts asks Chrome itself
 * (`isRegexSupported`, `testMatchOutcome`) about every rule.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classify } from '../src/blocker/patterns.ts';
import { REDIRECT_TARGETS, isAllowedTarget, youtubeWatchTarget } from '../src/blocker/targets.ts';
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
};
const NONE: Blockers = { instagramReels: false, youtubeShorts: false, facebookReels: false, instagramExplore: false };
const ID = 'dQw4w9WgXcQ';

const SAMPLES = [
  'https://www.instagram.com/',
  'https://www.instagram.com/reels/',
  'https://www.instagram.com/reels/abc123/?igsh=xyz',
  'https://instagram.com/reel/C0abc',
  'https://www.instagram.com/reels',
  'https://www.instagram.com/someuser/reels/',
  'https://WWW.INSTAGRAM.COM/Reel/abc/',
  'https://www.instagram.com/reel/abc/#comments',
  'https://www.instagram.com/reelsfan/',
  'https://www.instagram.com/p/C0abc/',
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
  'https://m.facebook.com/reel/1234567890/',
  'https://www.facebook.com/someone/reels/',
  'https://www.facebook.com/Reel/1?s=x',
  'https://www.facebook.com/reelection2026/',
  'https://www.facebook.com/?sk=reels',
  'https://web.facebook.com/reel/1',
  REDIRECT_TARGETS.instagram,
  REDIRECT_TARGETS.facebook,
  youtubeWatchTarget(ID) ?? '',
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

/** The redirect DNR would perform, or null when no rule in the set matches. */
function redirectFor(set: Rule[], url: string): string | null {
  for (const rule of set) {
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

  it('only redirects main_frame and sub_frame', () => {
    for (const rule of set) {
      expect(rule.condition.resourceTypes.length).toBeGreaterThan(0);
      for (const type of rule.condition.resourceTypes) expect(['main_frame', 'sub_frame']).toContain(type);
    }
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
      const target = url ?? (regexSubstitution ?? '').replace('\\1', ID);
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
    const targets = [REDIRECT_TARGETS.instagram, REDIRECT_TARGETS.facebook, youtubeWatchTarget(ID) ?? ''];
    for (const target of targets) {
      expect(redirectFor(set, target)).toBeNull();
      expect(redirectFor(set, requestUrl(target))).toBeNull();
    }
  });
});
