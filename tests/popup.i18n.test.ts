import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../_locales/en/messages.json';
import { dateLocale, t, tParts, uiLang } from '../src/shared/i18n.ts';

type Catalog = Record<string, { message: string; description?: string; placeholders?: Record<string, { content: string }> }>;
const catalog: Catalog = en;

function stubChrome(getMessage: (key: string, subs?: string[]) => string): ReturnType<typeof vi.fn> {
  const spy = vi.fn(getMessage);
  vi.stubGlobal('chrome', { i18n: { getMessage: spy } });
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('t outside Chrome (English catalog)', () => {
  it('fills named placeholders', () => {
    expect(t('usually', { d: '1h 55m' })).toBe('Usually 1h 55m by this time of day');
    expect(t('avg7few', { n: 5, d: '3h 32m' })).toBe('Average of the 5 recorded days: 3h 32m');
  });

  it('leaves a placeholder visible when its value is missing, never "undefined"', () => {
    expect(t('visitsN')).toBe('$N$ visits');
  });

  it('returns plain messages unchanged', () => {
    expect(t('openDash')).toBe('Open dashboard');
  });
});

describe('t in Chrome', () => {
  it('asks chrome.i18n with substitutions in $1, $2 order', () => {
    const spy = stubChrome(() => 'translated');
    expect(t('avg7few', { d: '3h', n: 4 })).toBe('translated');
    expect(spy).toHaveBeenCalledWith('avg7few', ['4', '3h']);
  });

  it('falls back to English when Chrome has no message', () => {
    stubChrome(() => '');
    expect(t('resume')).toBe('Resume');
  });
});

describe('tParts', () => {
  it('splits a sentence around its slot and keeps the word order', () => {
    const bold = { tag: 'b' };
    expect(tParts('usually', { d: bold })).toEqual(['Usually ', bold, ' by this time of day']);
  });

  it('follows a translation that moves the slot', () => {
    stubChrome((key, subs) => (key === 'usually' ? `D’habitude ${subs?.[0] ?? ''} à cette heure-ci` : ''));
    const bold = { tag: 'b' };
    expect(tParts('usually', { d: bold })).toEqual(['D’habitude ', bold, ' à cette heure-ci']);
  });

  it('handles a slot at the very start', () => {
    stubChrome(() => '');
    expect(tParts('weekAria', { chart: 1, list: 2 })).toEqual([1, ': ', 2]);
  });
});

describe('language', () => {
  it('is English with the English catalog', () => {
    expect(uiLang()).toBe('en');
    expect(dateLocale()).toBe('en-US');
  });

  it('is French when Chrome serves the French catalog', () => {
    stubChrome((key) => (key === 'lang' ? 'fr' : ''));
    expect(uiLang()).toBe('fr');
    expect(dateLocale()).toBe('fr-CA');
  });
});

describe('the English catalog', () => {
  it('keeps the extension name and description', () => {
    expect(catalog.extName?.message).toBe('Dwell');
    expect(catalog.extDescription?.message).toBeTruthy();
  });

  it('has keys Chrome accepts, unique without regard to case, each with a description', () => {
    const keys = Object.keys(catalog);
    expect(new Set(keys.map((k) => k.toLowerCase())).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^[A-Za-z0-9_]+$/);
      expect(catalog[key]?.description, key).toBeTruthy();
    }
  });

  it('numbers placeholders $1..$n and uses every one in its message', () => {
    for (const [key, entry] of Object.entries(catalog)) {
      const placeholders = Object.entries(entry.placeholders ?? {});
      const contents = placeholders.map(([, p]) => p.content).sort();
      expect(contents, key).toEqual(placeholders.map((_, i) => `$${i + 1}`));
      for (const [name] of placeholders) expect(entry.message.toLowerCase(), key).toContain(`$${name.toLowerCase()}$`);
      const used = entry.message.match(/\$[A-Za-z0-9_]+\$/g) ?? [];
      expect(used.length, key).toBe(placeholders.length);
    }
  });
});
