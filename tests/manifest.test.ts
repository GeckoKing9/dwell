import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EXPECTED_CSP,
  EXPECTED_PERMISSIONS,
  EXPECTED_RULESETS,
  SITE_PATTERNS,
  manifestProblems,
} from '../scripts/manifest-rules.ts';

const source: Record<string, unknown> = JSON.parse(
  readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'),
);

function clone(): Record<string, unknown> {
  return structuredClone(source);
}

describe('source manifest', () => {
  it('passes every privacy rule', () => {
    expect(manifestProblems(source)).toEqual([]);
  });

  it('declares exactly the five permissions', () => {
    expect(source.permissions).toEqual([...EXPECTED_PERMISSIONS]);
  });

  it('declares the literal host list and nothing else', () => {
    expect(source.host_permissions).toEqual([...SITE_PATTERNS]);
  });

  it('reaches X on https://x.com only: twitter.com and www.x.com redirect there before any script runs', () => {
    const x = SITE_PATTERNS.filter((pattern) => /x\.com|twitter/.test(pattern));
    expect(x).toEqual(['https://x.com/*']);
  });

  it('runs Facebook\'s own guard entry, the media reporter and its hiders on Facebook', () => {
    const scripts = source.content_scripts as { matches: string[]; js: string[]; css?: string[] }[];
    const facebook = scripts.find((s) => s.matches.includes('https://www.facebook.com/*'));
    expect(facebook?.js).toEqual(['src/content/guard-facebook.ts', 'src/content/media.ts']);
    expect(facebook?.css).toEqual(['src/content/facebook.css']);
  });

  it('runs the guard and the media reporter on X, with no hider stylesheet', () => {
    const scripts = source.content_scripts as { matches: string[]; js: string[]; css?: string[] }[];
    const x = scripts.find((s) => s.matches.includes('https://x.com/*'));
    expect(x).toEqual({
      matches: ['https://x.com/*'],
      js: ['src/content/guard.ts', 'src/content/media.ts'],
      run_at: 'document_start',
      all_frames: false,
      match_about_blank: false,
    });
  });

  it('declares the X ruleset, enabled like the other one-video rulesets', () => {
    expect(EXPECTED_RULESETS).toContainEqual({ id: 'x-videos', enabled: true });
    const dnr = source.declarative_net_request as { rule_resources: { id: string; enabled: boolean; path: string }[] };
    expect(dnr.rule_resources).toContainEqual({ id: 'x-videos', enabled: true, path: 'src/blocker/rulesets/x-videos.json' });
  });

  it('runs one script in Instagram\'s own page, the bridge to its router, and nothing else outside the isolated world', () => {
    const scripts = source.content_scripts as { matches: string[]; js: string[]; world?: string }[];
    const main = scripts.filter((s) => s.world !== undefined);
    expect(main).toEqual([
      {
        matches: ['https://www.instagram.com/*', 'https://instagram.com/*'],
        js: ['src/content/instagram-router.ts'],
        run_at: 'document_start',
        all_frames: false,
        match_about_blank: false,
        world: 'MAIN',
      },
    ]);
    expect(manifestProblems(source)).toEqual([]);
  });

  it('requires Chrome 111 or later, where the Navigation API and page-world scripts the guard relies on exist', () => {
    expect(source.minimum_chrome_version).toBe('111');
    for (const version of [undefined, '100', '110', 'abc']) {
      const m = structuredClone(source) as Record<string, unknown>;
      if (version === undefined) delete m.minimum_chrome_version;
      else m.minimum_chrome_version = version;
      expect(manifestProblems(m)).toContain('minimum_chrome_version must be 111 or later');
    }
  });

  it('does not count the router bridge as Instagram\'s guard', () => {
    const m = structuredClone(source) as Record<string, unknown>;
    m.content_scripts = (m.content_scripts as { matches: string[]; world?: string }[]).filter(
      (s) => s.world !== undefined || !s.matches.includes('https://www.instagram.com/*'),
    );
    expect(manifestProblems(m)).toContain('content_scripts must cover every site pattern');
  });

  it.each([
    ['another file', { js: ['src/content/guard.ts'] }],
    ['two files', { js: ['src/content/instagram-router.ts', 'src/content/media.ts'] }],
    ['another site', { matches: ['https://www.facebook.com/*'] }],
    ['another world name', { world: 'ISOLATED_PLUS' }],
  ])('refuses a page-world script with %s', (_label, patch) => {
    const m = structuredClone(source) as Record<string, unknown>;
    const scripts = m.content_scripts as Record<string, unknown>[];
    const index = scripts.findIndex((s) => s.world !== undefined);
    scripts[index] = { ...scripts[index], ...patch };
    expect(manifestProblems(m).some((p) => p.includes('world'))).toBe(true);
  });

  it('runs every content script in the top frame only', () => {
    const scripts = source.content_scripts as { all_frames: boolean; matches: string[] }[];
    expect(scripts.length).toBe(5);
    for (const script of scripts) expect(script.all_frames).toBe(false);
    // Every site exactly once among the isolated-world entries; the router bridge is an extra on Instagram.
    const isolated = (scripts as { matches: string[]; world?: string }[]).filter((s) => s.world === undefined);
    expect(isolated.flatMap((s) => s.matches).sort()).toEqual([...SITE_PATTERNS].sort());
  });

  it('forbids incognito and external connections', () => {
    expect(source.incognito).toBe('not_allowed');
    expect(source).not.toHaveProperty('externally_connectable');
  });

  it('sets the locked-down extension page CSP', () => {
    expect(source.content_security_policy).toEqual({ extension_pages: EXPECTED_CSP });
  });

  it('uses English as the default locale', () => {
    expect(source.default_locale).toBe('en');
  });
});

describe('manifestProblems', () => {
  it('rejects an extra permission', () => {
    const m = clone();
    m.permissions = [...EXPECTED_PERMISSIONS, 'webRequest'];
    expect(manifestProblems(m)).toContain(`permissions must equal ${JSON.stringify(EXPECTED_PERMISSIONS)}`);
  });

  it('rejects <all_urls> in a content script', () => {
    const m = clone();
    m.content_scripts = [{ matches: ['<all_urls>'], all_frames: false, match_about_blank: false, run_at: 'document_start' }];
    const problems = manifestProblems(m);
    expect(problems).toContain('content_scripts[0].matches outside the site list');
    expect(problems).toContain('<all_urls> is not allowed anywhere');
  });

  it('rejects a content script in every frame', () => {
    const m = clone();
    const scripts = m.content_scripts as Record<string, unknown>[];
    scripts[0] = { ...scripts[0], all_frames: true };
    expect(manifestProblems(m)).toContain('content_scripts[0].all_frames must be false');
  });

  it('rejects externally_connectable and incognito spanning', () => {
    const m = clone();
    m.externally_connectable = { matches: ['https://example.com/*'] };
    m.incognito = 'spanning';
    const problems = manifestProblems(m);
    expect(problems).toContain('externally_connectable is not allowed');
    expect(problems).toContain('incognito must be not_allowed');
  });

  it('rejects a relaxed CSP', () => {
    const m = clone();
    m.content_security_policy = { extension_pages: "script-src 'self'; connect-src *" };
    expect(manifestProblems(m)).toContain("CSP must contain default-src 'none'");
  });

  it('rejects web accessible resources exposed beyond the three sites', () => {
    const m = clone();
    m.web_accessible_resources = [{ resources: ['assets/*'], matches: ['https://example.com/*'] }];
    expect(manifestProblems(m)).toContain('web_accessible_resources[0].matches outside the site list');
  });

  it('rejects a wildcard host pattern', () => {
    const m = clone();
    m.host_permissions = ['*://*/*'];
    expect(manifestProblems(m)).toContain('wildcard host patterns are not allowed');
  });

  it('rejects a non-object manifest', () => {
    expect(manifestProblems(null)).toEqual(['manifest is not an object']);
  });
});
