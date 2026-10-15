import { describe, expect, it } from 'vitest';
import { memoryStore } from '../src/store/adapter.ts';
import { loadSettings, repairBlockers, repairSettings, saveSettings, validateSettings } from '../src/shared/settings.ts';
import type { SettingsResult } from '../src/shared/settings.ts';
import { themeOf } from '../src/shared/theme.ts';
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../src/store/schema.ts';
import { categoryOf, defaultCategories } from '../src/stats/categories.ts';
import { siteOf } from '../src/tracker/grouping.ts';

function expectRejected(result: SettingsResult, mention: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toContain(mention);
}

describe('validateSettings', () => {
  it('accepts DEFAULT_SETTINGS and returns an equal, separate value', () => {
    const result = validateSettings(DEFAULT_SETTINGS);
    expect(result).toEqual({ ok: true, value: DEFAULT_SETTINGS });
    if (result.ok) {
      expect(result.value).not.toBe(DEFAULT_SETTINGS);
      expect(result.value.blockers).not.toBe(DEFAULT_SETTINGS.blockers);
    }
  });

  it('accepts the built-in category map and a full custom value', () => {
    const value = {
      idleThresholdSec: 300,
      mediaOverride: false,
      paused: true,
      blockers: { instagramReels: false, youtubeShorts: false, facebookReels: true, xVideos: false, instagramExplore: true },
      overrides: ['music.youtube.com'],
      ignore: ['bank.example.ca'],
      categories: defaultCategories(),
      eventLog: true,
      theme: 'dark' as const,
    };
    expect(validateSettings(value)).toEqual({ ok: true, value });
  });

  it('merges a partial patch over the base, nested blockers included', () => {
    const result = validateSettings({ blockers: { youtubeShorts: false }, idleThresholdSec: 30 });
    expect(result).toEqual({ ok: true, value: { ...DEFAULT_SETTINGS, idleThresholdSec: 30, blockers: { ...DEFAULT_SETTINGS.blockers, youtubeShorts: false } } });
  });

  it('removes duplicate hosts and builds categories without a prototype', () => {
    const result = validateSettings({ ignore: ['a.com', 'a.com', 'b.com'], categories: { 'a.com': 'Work' } });
    expect(result.ok && result.value.ignore).toEqual(['a.com', 'b.com']);
    expect(result.ok && Object.getPrototypeOf(result.value.categories)).toBeNull();
  });

  it('rejects unknown keys at every level', () => {
    expectRejected(validateSettings({ colour: 'dark' }), 'colour');
    expectRejected(validateSettings({ blockers: { tiktok: true } }), 'tiktok');
  });

  it('accepts system, light and dark, defaults to system, and treats a missing key as the default', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('system');
    for (const theme of ['system', 'light', 'dark']) expect(validateSettings({ theme })).toMatchObject({ ok: true, value: { theme } });
    expect(validateSettings({ idleThresholdSec: 30 })).toMatchObject({ ok: true, value: { theme: 'system' } });
  });

  it('rejects any other theme', () => {
    for (const theme of ['auto', 'Dark', '', 1, null, true]) expectRejected(validateSettings({ theme }), 'theme');
  });

  it('rejects bad enums and non-booleans', () => {
    expectRejected(validateSettings({ idleThresholdSec: 45 }), 'idleThresholdSec');
    expectRejected(validateSettings({ idleThresholdSec: '60' }), 'idleThresholdSec');
    expectRejected(validateSettings({ paused: 'yes' }), 'paused');
    expectRejected(validateSettings({ blockers: { youtubeShorts: 1 } }), 'youtubeShorts');
    expectRejected(validateSettings({ categories: { 'a.com': 'Games' } }), 'Games');
  });

  it.each(['https://a.com/', 'www.a.com', 'A.com', 'a com.org', 'a_b.com', 42])('rejects the non-hostname %s in every host list', (host) => {
    expectRejected(validateSettings({ overrides: [host] }), 'overrides');
    expectRejected(validateSettings({ ignore: [host] }), 'ignore');
    if (typeof host === 'string') expectRejected(validateSettings({ categories: { [host]: 'Work' } }), 'categories');
  });

  it.each(['__proto__', 'constructor', 'prototype'])('rejects the prototype key %s anywhere', (key) => {
    expectRejected(validateSettings(JSON.parse(`{"${key}": {"paused": true}}`)), key);
    expectRejected(validateSettings(JSON.parse(`{"categories": {"${key}": "Work"}}`)), key);
    expectRejected(validateSettings(JSON.parse(`{"blockers": {"${key}": true}}`)), key);
  });

  it('rejects lists and maps above 500 entries', () => {
    const hosts = Array.from({ length: 501 }, (_, i) => `s${i}.com`);
    expectRejected(validateSettings({ ignore: hosts }), '500');
    expectRejected(validateSettings({ categories: Object.fromEntries(hosts.map((h) => [h, 'Work'])) }), '500');
    expect(validateSettings({ ignore: hosts.slice(0, 500) }).ok).toBe(true);
  });

  it('rejects values that are not plain objects or arrays where expected', () => {
    for (const input of [null, 'x', [], new Date(), Object.create({ paused: true })]) expectRejected(validateSettings(input), 'object');
    expectRejected(validateSettings({ blockers: [] }), 'blockers');
    expectRejected(validateSettings({ ignore: 'a.com' }), 'ignore');
    expectRejected(validateSettings({ categories: [] }), 'categories');
  });
});

describe('one site rule with the engine (F5)', () => {
  it.each(['http://localhost:5173/', 'http://intranet/', 'http://192.168.0.1/', 'http://[::1]:8080/', 'https://www.bbc.co.uk/'])(
    'accepts the site the engine makes of %s in every host list',
    (url) => {
      const site = siteOf(url, [], []);
      expect(site).not.toBeNull();
      const result = validateSettings({ overrides: [site], ignore: [site], categories: { [String(site)]: 'Work' } });
      expect(result.ok).toBe(true);
    },
  );
});

describe('loadSettings and saveSettings', () => {
  it('returns defaults when nothing or something corrupt is stored', async () => {
    expect(await loadSettings(memoryStore())).toEqual(DEFAULT_SETTINGS);
    expect(await loadSettings(memoryStore({ [SETTINGS_KEY]: { idleThresholdSec: 7 } }))).toEqual(DEFAULT_SETTINGS);
    expect(await loadSettings(memoryStore({ [SETTINGS_KEY]: 'settings' }))).toEqual(DEFAULT_SETTINGS);
  });

  it('merges a stored patch over the defaults', async () => {
    const store = memoryStore({ [SETTINGS_KEY]: { eventLog: true } });
    expect(await loadSettings(store)).toEqual({ ...DEFAULT_SETTINGS, eventLog: true });
  });

  it('saves a patch over the current settings and refuses an invalid one', async () => {
    const store = memoryStore({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, idleThresholdSec: 120 } });
    const saved = await saveSettings(store, { mediaOverride: false });
    expect(saved.ok).toBe(true);
    expect(await loadSettings(store)).toEqual({ ...DEFAULT_SETTINGS, idleThresholdSec: 120, mediaOverride: false });
    const calls = store.setCalls;
    expectRejected(await saveSettings(store, { mediaOverride: 'off' }), 'mediaOverride');
    expect(store.setCalls).toBe(calls);
  });
});

/** Settings exactly as v0.1.0 stored and exported them: four blockers, no `xVideos`. */
const V010_SETTINGS = {
  idleThresholdSec: 120,
  mediaOverride: false,
  paused: true,
  blockers: { instagramReels: true, youtubeShorts: false, facebookReels: false, instagramExplore: true },
  overrides: ['music.youtube.com'],
  ignore: ['bank.example.ca'],
  categories: { 'a.com': 'Work' },
  eventLog: true,
  theme: 'dark',
};
const V010_BLOCKERS = { instagramReels: true, youtubeShorts: false, facebookReels: false, instagramExplore: true };

describe('settings saved before the X toggle existed (v0.1.0)', () => {
  it('turns X videos on by default for a new install', () => {
    expect(DEFAULT_SETTINGS.blockers.xVideos).toBe(true);
  });

  it('validates an old value whole and reads the missing X toggle as on, keeping every other field', () => {
    const result = validateSettings(V010_SETTINGS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.blockers).toEqual({ ...V010_BLOCKERS, xVideos: true });
    expect(result.value).toMatchObject({ idleThresholdSec: 120, mediaOverride: false, paused: true, eventLog: true, theme: 'dark' });
  });

  it('loads an old stored value without resetting it, with the X toggle on', async () => {
    const loaded = await loadSettings(memoryStore({ [SETTINGS_KEY]: V010_SETTINGS }));
    expect(loaded.blockers).toEqual({ ...V010_BLOCKERS, xVideos: true });
    expect(loaded).toMatchObject({ idleThresholdSec: 120, paused: true, ignore: ['bank.example.ca'], categories: { 'a.com': 'Work' } });
  });

  it('writes the X toggle next to the old flags on the next save, and can turn it off', async () => {
    const store = memoryStore({ [SETTINGS_KEY]: V010_SETTINGS });
    expect((await saveSettings(store, { mediaOverride: true })).ok).toBe(true);
    expect((await loadSettings(store)).blockers).toEqual({ ...V010_BLOCKERS, xVideos: true });
    expect((await saveSettings(store, { blockers: { xVideos: false } })).ok).toBe(true);
    expect((await loadSettings(store)).blockers).toEqual({ ...V010_BLOCKERS, xVideos: false });
  });

  it('rejects an X toggle that is not true or false', () => {
    expectRejected(validateSettings({ blockers: { xVideos: 'yes' } }), 'xVideos');
  });
});

describe('a stored value with one bad field (F3)', () => {
  const kept = {
    paused: true,
    overrides: ['music.youtube.com'],
    ignore: ['bank.example.ca'],
    categories: { 'a.com': 'Work' as const },
    eventLog: true,
    theme: 'dark' as const,
  };
  const stored = { ...DEFAULT_SETTINGS, ...kept, idleThresholdSec: 7, colour: 'teal' };

  it('keeps every valid field, defaults only the bad one and drops the unknown key', async () => {
    const loaded = await loadSettings(memoryStore({ [SETTINGS_KEY]: stored }));
    expect(loaded).toEqual({ ...DEFAULT_SETTINGS, ...kept });
    expect(loaded).not.toHaveProperty('colour');
  });

  it('keeps them, pause included, through the next save', async () => {
    const store = memoryStore({ [SETTINGS_KEY]: stored });
    expect((await saveSettings(store, { mediaOverride: false })).ok).toBe(true);
    const written = (await store.get([SETTINGS_KEY]))[SETTINGS_KEY];
    expect(written).toEqual({ ...DEFAULT_SETTINGS, ...kept, mediaOverride: false });
  });

  it('keeps the valid entries of a stored list or map and the valid blocker flags', async () => {
    const value = {
      ...stored,
      idleThresholdSec: 120,
      ignore: ['bank.example.ca', 'Not A Host'],
      categories: { 'a.com': 'Work', 'b.com': 'Games' },
      blockers: { ...DEFAULT_SETTINGS.blockers, youtubeShorts: false, instagramExplore: 'yes', tiktok: true },
    };
    expect(await loadSettings(memoryStore({ [SETTINGS_KEY]: value }))).toEqual({
      ...DEFAULT_SETTINGS,
      ...kept,
      idleThresholdSec: 120,
      blockers: { ...DEFAULT_SETTINGS.blockers, youtubeShorts: false },
    });
  });

  it('reads the theme of a stored value whose other fields are bad', () => {
    expect(themeOf(stored)).toBe('dark');
    expect(themeOf({ theme: 'neon', paused: true })).toBe('system');
  });
});

describe('repairBlockers: the one rule for stored blocker flags (settings repair and the guard)', () => {
  it('keeps every valid flag and reads a missing one as its default, so v0.1.0 flags keep X on', () => {
    expect(repairBlockers(V010_BLOCKERS)).toEqual({ ...V010_BLOCKERS, xVideos: true });
  });

  it('reads a flag that is not true or false as its default and ignores an unknown key', () => {
    expect(repairBlockers({ xVideos: 'off', youtubeShorts: false, tiktok: true })).toEqual({ ...DEFAULT_SETTINGS.blockers, youtubeShorts: false });
  });

  it('accepts an object without a prototype, as a plain one', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { facebookReels: false });
    expect(repairBlockers(bare)).toEqual({ ...DEFAULT_SETTINGS.blockers, facebookReels: false });
  });

  it.each<[string, unknown]>([
    ['nothing', undefined],
    ['null', null],
    ['a string', 'off'],
    ['a list', [false, false]],
    ['an object with a prototype of its own', Object.assign(Object.create({}) as Record<string, unknown>, { youtubeShorts: false })],
  ])('reads %s as the default flags', (_name, stored) => {
    expect(repairBlockers(stored)).toEqual(DEFAULT_SETTINGS.blockers);
  });

  it('returns a new object every time, never the defaults themselves', () => {
    expect(repairBlockers(undefined)).not.toBe(DEFAULT_SETTINGS.blockers);
  });

  it('is what a stored value’s blockers repair to', () => {
    const odd = Object.assign(Object.create({}) as Record<string, unknown>, { youtubeShorts: false });
    for (const blockers of [V010_BLOCKERS, { xVideos: 'off', youtubeShorts: false }, odd, [], 'off']) {
      expect(repairSettings({ blockers }).blockers).toEqual(repairBlockers(blockers));
    }
  });
});

describe('built-in categories under the default grouping (F6)', () => {
  it.each(Object.keys(defaultCategories()))('%s is a site the default grouping can produce', (key) => {
    expect(siteOf(`https://${key}/`, DEFAULT_SETTINGS.overrides, [])).toBe(key);
  });

  it('counts the Google apps and YouTube Music on their own by default and files Google under Work', () => {
    expect(DEFAULT_SETTINGS.overrides).toEqual([
      'music.youtube.com',
      'docs.google.com',
      'mail.google.com',
      'drive.google.com',
      'calendar.google.com',
      'meet.google.com',
    ]);
    expect(siteOf('https://mail.google.com/mail/u/0/', DEFAULT_SETTINGS.overrides, [])).toBe('mail.google.com');
    expect(categoryOf('google.com', {})).toBe('Work');
    expect(categoryOf('docs.google.com', {})).toBe('Work');
  });
});
