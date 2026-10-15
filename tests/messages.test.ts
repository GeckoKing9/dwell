import { describe, expect, it } from 'vitest';
import {
  CONTENT_MESSAGE_TYPES,
  MAX_IMPORT_CHARS,
  PAGE_MESSAGE_TYPES,
  allowedFrom,
  checkMessage,
  isHostname,
  parseMessage,
  parseSettingsPatch,
  type Message,
} from '../src/shared/messages.ts';
import { MAX_LIST_ENTRIES, validateSettings } from '../src/shared/settings.ts';
import { siteOf } from '../src/tracker/grouping.ts';

const valid: Message[] = [
  { type: 'blocked', site: 'instagram' },
  { type: 'blocked', site: 'youtube' },
  { type: 'blocked', site: 'facebook' },
  { type: 'media', playing: true },
  { type: 'media', playing: false },
  { type: 'settings', patch: { idleThresholdSec: 120 } },
  { type: 'settings', patch: { blockers: { instagramReels: false } } },
  {
    type: 'settings',
    patch: {
      idleThresholdSec: 300,
      mediaOverride: false,
      blockers: { instagramReels: true, youtubeShorts: false, facebookReels: true, instagramExplore: true },
      overrides: ['docs.google.com'],
      ignore: ['localhost.test', 'xn--bcher-kva.example'],
      categories: { 'github.com': 'Work', 'youtube.com': 'Video' },
      eventLog: true,
      theme: 'light',
    },
  },
  { type: 'settings', patch: { theme: 'system' } },
  { type: 'pause', paused: true },
  { type: 'pause', paused: false },
  { type: 'import', text: '{"format":"dwell-export"}' },
  { type: 'import', text: '' },
  { type: 'deleteAll' },
  { type: 'undoDelete' },
];

describe('parseMessage accepts every documented message', () => {
  it.each(valid.map((m) => [m.type, m] as const))('accepts %s', (_type, message) => {
    expect(parseMessage(structuredClone(message))).toEqual(message);
  });

  it('returns a fresh object, not the input', () => {
    const input = { type: 'media', playing: true };
    const parsed = parseMessage(input);
    expect(parsed).not.toBe(input);
  });

  it('accepts a null-prototype object', () => {
    const input = Object.assign(Object.create(null) as Record<string, unknown>, { type: 'pause', paused: true });
    expect(parseMessage(input)).toEqual({ type: 'pause', paused: true });
  });
});

const rejected: [string, unknown][] = [
  ['undefined', undefined],
  ['null', null],
  ['a string', 'blocked'],
  ['an array', [{ type: 'blocked', site: 'instagram' }]],
  ['no type', { site: 'instagram' }],
  ['an unknown type', { type: 'getUrl' }],
  ['a type that is not a string', { type: 1 }],
  ['a class instance', new (class Msg { type = 'deleteAll'; })()],
  ['blocked with an unknown site', { type: 'blocked', site: 'tiktok' }],
  ['blocked with a missing site', { type: 'blocked' }],
  ['blocked with a url', { type: 'blocked', site: 'instagram', url: 'https://www.instagram.com/reels/x/' }],
  ['blocked with the site in another case', { type: 'blocked', site: 'Instagram' }],
  ['media with a string flag', { type: 'media', playing: 'true' }],
  ['media with a number flag', { type: 'media', playing: 1 }],
  ['media with a title', { type: 'media', playing: true, title: 'x' }],
  ['pause with no flag', { type: 'pause' }],
  ['pause with a string flag', { type: 'pause', paused: 'yes' }],
  ['import with an object', { type: 'import', text: { days: {} } }],
  ['import over the size cap', { type: 'import', text: 'x'.repeat(MAX_IMPORT_CHARS + 1) }],
  ['import with an extra key', { type: 'import', text: '{}', merge: true }],
  ['deleteAll with a payload', { type: 'deleteAll', confirm: true }],
  ['undoDelete with a payload', { type: 'undoDelete', id: 1 }],
  ['settings with no patch', { type: 'settings' }],
  ['settings with an extra key', { type: 'settings', patch: { eventLog: true }, force: true }],
  ['settings with an empty patch', { type: 'settings', patch: {} }],
  ['settings with a null patch', { type: 'settings', patch: null }],
  ['settings changing paused', { type: 'settings', patch: { paused: true } }],
];

describe('parseMessage rejects anything else', () => {
  it.each(rejected)('rejects %s', (_label, input) => {
    expect(parseMessage(input)).toBeNull();
  });

  it('rejects an inherited type key', () => {
    const input = Object.create({ type: 'deleteAll' }) as object;
    expect(parseMessage(input)).toBeNull();
  });

  it('rejects a __proto__ own key smuggled through JSON', () => {
    expect(parseMessage(JSON.parse('{"type":"deleteAll","__proto__":{"x":1}}'))).toBeNull();
  });
});

const badPatches: [string, unknown][] = [
  ['an unknown key', { colour: 'dark' }],
  ['a theme off the list', { theme: 'auto' }],
  ['a theme as a number', { theme: 1 }],
  ['an idle threshold off the list', { idleThresholdSec: 45 }],
  ['an idle threshold as a string', { idleThresholdSec: '60' }],
  ['mediaOverride as a number', { mediaOverride: 0 }],
  ['eventLog as null', { eventLog: null }],
  ['blockers as an array', { blockers: [true] }],
  ['blockers with an unknown key', { blockers: { tiktok: true } }],
  ['blockers with a string flag', { blockers: { youtubeShorts: 'off' } }],
  ['blockers empty', { blockers: {} }],
  ['overrides as a string', { overrides: 'docs.google.com' }],
  ['overrides with a URL', { overrides: ['https://docs.google.com/'] }],
  ['overrides with a path', { overrides: ['docs.google.com/x'] }],
  ['overrides with uppercase', { overrides: ['Docs.Google.com'] }],
  ['overrides with an underscore', { overrides: ['bad_host.example'] }],
  ['overrides over the cap', { overrides: Array.from({ length: MAX_LIST_ENTRIES + 1 }, (_, i) => `h${i}.example`) }],
  ['ignore with a number', { ignore: [42] }],
  ['categories with an unknown category', { categories: { 'github.com': 'Games' } }],
  ['categories keyed by a non-host', { categories: { 'not a host': 'Work' } }],
  ['categories with __proto__', JSON.parse('{"categories":{"__proto__":"Work"}}')],
  ['categories as an array', { categories: [['github.com', 'Work']] }],
  [
    'categories over the cap',
    { categories: Object.fromEntries(Array.from({ length: MAX_LIST_ENTRIES + 1 }, (_, i) => [`h${i}.example`, 'Other'])) },
  ],
];

describe('parseSettingsPatch', () => {
  it.each(badPatches)('rejects %s', (_label, patch) => {
    expect(parseSettingsPatch(patch).ok).toBe(false);
    expect(parseMessage({ type: 'settings', patch })).toBeNull();
  });

  it('copies only the validated keys', () => {
    const patch = parseSettingsPatch({ overrides: ['a.example'], blockers: { facebookReels: false } });
    expect(patch).toEqual({ ok: true, value: { overrides: ['a.example'], blockers: { facebookReels: false } } });
  });

  it('accepts every idle threshold on the list', () => {
    for (const idleThresholdSec of [30, 60, 120, 300]) {
      expect(parseSettingsPatch({ idleThresholdSec })).toEqual({ ok: true, value: { idleThresholdSec } });
    }
  });

  it('builds categories without a prototype', () => {
    const patch = parseSettingsPatch({ categories: { 'github.com': 'Work' } });
    expect(patch.ok && Object.getPrototypeOf(patch.value.categories)).toBeNull();
  });
});

describe('one validator for patches and stored settings (F8)', () => {
  it('rejects a 600-entry category map with the same reason on both paths', () => {
    const categories = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`s${i}.example`, 'Work']));
    const patch = parseSettingsPatch({ categories });
    const stored = validateSettings({ categories });
    expect(patch.ok).toBe(false);
    expect(stored.ok).toBe(false);
    expect(!patch.ok && !stored.ok && patch.reason).toBe(!stored.ok && stored.reason);
    expect(checkMessage({ type: 'settings', patch: { categories } })).toEqual(patch);
  });

  it.each(['http://localhost:5173/', 'http://intranet/', 'http://10.0.0.7/', 'http://[::1]:8080/', 'https://news.bbc.co.uk/'])(
    'accepts the site the engine makes of %s',
    (url) => {
      const site = String(siteOf(url, [], []));
      expect(parseSettingsPatch({ ignore: [site], categories: { [site]: 'Work' } })).toMatchObject({ ok: true });
      expect(isHostname(site)).toBe(true);
    },
  );

  it('names the offending key and the start of the value in the reason', () => {
    const long = `Bad_Host-${'x'.repeat(200)}.example`;
    const result = checkMessage({ type: 'settings', patch: { ignore: ['a.example', long] } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('"ignore"');
    expect(result.reason).toContain('Bad_Host-xxx');
    expect(result.reason.length).toBeLessThan(200);
  });
});

describe('isHostname', () => {
  it.each(['youtube.com', 'docs.google.com', 'a.b.c.example', 'xn--bcher-kva.example', '1.example', 'localhost', 'intranet', '127.0.0.1'])(
    'accepts %s',
    (h) => {
      expect(isHostname(h)).toBe(true);
    },
  );

  it.each(['', 'www.example.com', 'a..example', 'a.example.', 'under_score.example', 'Example.com', 'constructor', `${'a.'.repeat(127)}com`])(
    'rejects %j',
    (h) => {
      expect(isHostname(h)).toBe(false);
    },
  );
});

describe('sender authorisation', () => {
  it('lets content scripts send only blocked and media', () => {
    expect([...CONTENT_MESSAGE_TYPES]).toEqual(['blocked', 'media']);
    for (const message of valid) {
      expect(allowedFrom(message, 'content')).toBe(message.type === 'blocked' || message.type === 'media');
    }
  });

  it('lets extension pages send everything except the content-script types', () => {
    expect([...PAGE_MESSAGE_TYPES]).toEqual(['settings', 'pause', 'import', 'deleteAll', 'undoDelete']);
    for (const message of valid) {
      expect(allowedFrom(message, 'page')).toBe(!CONTENT_MESSAGE_TYPES.includes(message.type as 'blocked' | 'media'));
    }
  });

  it('keeps the two lists disjoint and frozen', () => {
    expect(CONTENT_MESSAGE_TYPES.some((t) => (PAGE_MESSAGE_TYPES as readonly string[]).includes(t))).toBe(false);
    expect(Object.isFrozen(CONTENT_MESSAGE_TYPES)).toBe(true);
    expect(Object.isFrozen(PAGE_MESSAGE_TYPES)).toBe(true);
  });
});
