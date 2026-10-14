import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EXPECTED_CSP,
  EXPECTED_PERMISSIONS,
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

  it('runs every content script in the top frame only', () => {
    const scripts = source.content_scripts as { all_frames: boolean; matches: string[] }[];
    expect(scripts.length).toBe(3);
    for (const script of scripts) expect(script.all_frames).toBe(false);
    expect(scripts.flatMap((s) => s.matches).sort()).toEqual([...SITE_PATTERNS].sort());
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
