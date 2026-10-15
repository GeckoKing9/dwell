import { describe, expect, it } from 'vitest';
import { memoryStore } from '../src/store/adapter.ts';
import { loadSettings, saveSettings, validateSettings } from '../src/shared/settings.ts';
import type { SettingsResult } from '../src/shared/settings.ts';
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../src/store/schema.ts';
import { defaultCategories } from '../src/stats/categories.ts';

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
      blockers: { instagramReels: false, youtubeShorts: false, facebookReels: true, instagramExplore: true },
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

  it.each(['https://a.com/', 'localhost', 'A.com', 'a com.org', 42])('rejects the non-hostname %s in every host list', (host) => {
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

describe('loadSettings and saveSettings', () => {
  it('returns defaults when nothing or something corrupt is stored', async () => {
    expect(await loadSettings(memoryStore())).toEqual(DEFAULT_SETTINGS);
    expect(await loadSettings(memoryStore({ [SETTINGS_KEY]: { idleThresholdSec: 7 } }))).toEqual(DEFAULT_SETTINGS);
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
