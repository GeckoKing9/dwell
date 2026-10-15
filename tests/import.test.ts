import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { memoryStore } from '../src/store/adapter.ts';
import type { MemoryStore } from '../src/store/adapter.ts';
import { applyAttributions, loadDay } from '../src/store/days.ts';
import { applyImport, exportAll, importText, MAX_IMPORT_BYTES, parseImport } from '../src/store/export.ts';
import type { ParsedImport } from '../src/store/export.ts';
import { DEFAULT_SETTINGS, EXPORT_FORMAT, SETTINGS_KEY, dateString } from '../src/store/schema.ts';

const TODAY = new Date(2026, 9, 14, 16, 30);

/** 'YYYY-MM-DD' n calendar days before TODAY. */
function daysAgo(n: number): string {
  return dateString(new Date(2026, 9, 14 - n, 12));
}

function site(h: Record<string, number>, v = 1): { h: Record<string, number>; v: number } {
  return { h, v };
}

function file(days: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { format: EXPORT_FORMAT, version: 1, exportedAt: TODAY.toISOString(), days, ...extra };
}

const text = (value: unknown): string => JSON.stringify(value);

function expectRejected(result: ParsedImport, code: string, mention: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.code).toBe(code);
  expect(result.reason).toContain(mention);
}

function parsedOk(result: ParsedImport): Extract<ParsedImport, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result;
}

const BASE_DAY = { sites: { 'github.com': site({ '9': 600, '10': 300 }, 2) }, blocked: { instagram: 1, youtube: 0, facebook: 0 } };

describe('export then import', () => {
  it('reproduces identical day keys in an empty store', async () => {
    const source = memoryStore({
      [`d:${daysAgo(0)}`]: BASE_DAY,
      [`d:${daysAgo(3)}`]: { sites: { 'youtube.com': site({ '21': 1340, '22': 610 }, 3) }, blocked: { instagram: 0, youtube: 4, facebook: 0 } },
      [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, idleThresholdSec: 120 },
    });
    const exported = await exportAll(source, TODAY);
    const target = memoryStore();
    const outcome = await importText(target, JSON.stringify(exported), TODAY);
    expect(outcome).toMatchObject({ ok: true, daysWritten: 2, skipped: 0, settingsWritten: true });
    expect(target.dump()).toEqual(source.dump());
  });

  it('never exports the event log or hot state', async () => {
    const store = memoryStore({ [`d:${daysAgo(0)}`]: BASE_DAY, 'log:2026-10-14T10': [{ at: 1, kind: 'tick' }], hot: { version: 1 } });
    const exported = await exportAll(store, TODAY);
    expect(Object.keys(exported).sort()).toEqual(['days', 'exportedAt', 'format', 'settings', 'version']);
    expect(Object.keys(exported.days)).toEqual([daysAgo(0)]);
    expect(JSON.stringify(exported)).not.toContain('tick');
  });

  it('stores, exports and re-imports single-label and IP sites the engine counts (F5)', async () => {
    const source = memoryStore();
    const sites = ['localhost', 'intranet', '192.168.0.1', '[::1]'];
    const result = await applyAttributions(
      source,
      sites.map((s) => ({ site: s, day: daysAgo(1), hour: 9, seconds: 30, visit: true })),
    );
    expect(result).toEqual({ written: 1, skipped: 0 });
    const exported = await exportAll(source, TODAY);
    expect(Object.keys(exported.days[daysAgo(1)]?.sites ?? {}).sort()).toEqual([...sites].sort());
    const target = memoryStore();
    expect(await importText(target, JSON.stringify(exported), TODAY)).toMatchObject({ ok: true, daysWritten: 1 });
    const day = await loadDay(target, daysAgo(1));
    for (const s of sites) expect(day.sites[s]).toEqual({ h: { '9': 30 }, v: 1 });
  });

  it('rounds fractional stored seconds so its own export always re-imports', async () => {
    const store = memoryStore({ [`d:${daysAgo(1)}`]: { sites: { 'a.com': { h: { '3': 10.4, '4': 10.6 }, v: 1 } }, blocked: {} } });
    const exported = await exportAll(store, TODAY);
    expect(exported.days[daysAgo(1)]?.sites['a.com']?.h).toEqual({ '3': 10, '4': 11 });
    expect(parseImport(JSON.stringify(exported), TODAY).ok).toBe(true);
  });
});

describe('merging into existing data', () => {
  it('never lowers a value and never duplicates visits', async () => {
    const day = `d:${daysAgo(1)}`;
    const store = memoryStore({ [day]: { sites: { 'github.com': site({ '9': 900, '11': 50 }, 5) }, blocked: { instagram: 7, youtube: 0, facebook: 0 } } });
    const incoming = file({ [daysAgo(1)]: { sites: { 'github.com': site({ '9': 600, '10': 300 }, 2), 'x.com': site({ '9': 40 }, 1) }, blocked: { instagram: 1, youtube: 2, facebook: 0 } } });
    const first = await importText(store, text(incoming), TODAY);
    expect(first.ok).toBe(true);
    const merged = store.dump()[day];
    expect(merged).toEqual({
      sites: { 'github.com': site({ '9': 900, '10': 300, '11': 50 }, 5), 'x.com': site({ '9': 40 }, 1) },
      blocked: { instagram: 7, youtube: 2, facebook: 0 },
    });
    const calls = store.setCalls;
    expect(await importText(store, text(incoming), TODAY)).toMatchObject({ ok: true, daysWritten: 0 });
    expect(store.setCalls).toBe(calls);
    expect(store.dump()[day]).toEqual(merged);
  });

  it('builds merged records without prototypes and never pollutes Object.prototype', async () => {
    const parsed = parsedOk(parseImport(text(file({ [daysAgo(0)]: BASE_DAY })), TODAY));
    const record = parsed.days[daysAgo(0)];
    expect(Object.getPrototypeOf(parsed.days)).toBeNull();
    expect(Object.getPrototypeOf(record?.sites)).toBeNull();
    expect(Object.getPrototypeOf(record?.sites['github.com']?.h)).toBeNull();
    expect(Object.getPrototypeOf(record?.blocked)).toBeNull();
    const hostile = text(file({ [daysAgo(0)]: BASE_DAY })).replace('"days"', '"__proto__":{"polluted":1},"days"');
    expectRejected(parseImport(hostile, TODAY), 'forbidden-key', '__proto__');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('keeps the current paused state when settings come from a file', async () => {
    const store = memoryStore({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, paused: false } });
    const incoming = file({}, { settings: { ...DEFAULT_SETTINGS, paused: true, idleThresholdSec: 300 } });
    expect(await importText(store, text(incoming), TODAY)).toMatchObject({ ok: true, settingsWritten: true });
    expect(store.dump()[SETTINGS_KEY]).toMatchObject({ paused: false, idleThresholdSec: 300 });
  });
});

describe('single commit', () => {
  const sixty = (): Record<string, unknown> => {
    const days: Record<string, unknown> = {};
    for (let i = 0; i < 60; i += 1) days[daysAgo(i)] = { sites: { 'a.com': site({ '12': 60 + i }) }, blocked: { instagram: 0, youtube: 0, facebook: 0 } };
    return days;
  };

  it('writes all 60 days with exactly one set call', async () => {
    const store = memoryStore();
    expect(await importText(store, text(file(sixty())), TODAY)).toMatchObject({ ok: true, daysWritten: 60 });
    expect(store.setCalls).toBe(1);
  });

  it('leaves all 60 days untouched when the last day fails validation', async () => {
    const days = sixty();
    days[daysAgo(59)] = { sites: { 'a.com': site({ '12': 3601 }) }, blocked: {} };
    const store = memoryStore({ [`d:${daysAgo(0)}`]: BASE_DAY });
    const before = store.dump();
    const outcome = await importText(store, text(file(days)), TODAY);
    expect(outcome).toMatchObject({ ok: false, code: 'bad-seconds' });
    expect(store.dump()).toEqual(before);
    expect(store.setCalls).toBe(0);
  });

  it('leaves the store unchanged when the single write fails', async () => {
    const store = memoryStore({ [`d:${daysAgo(0)}`]: BASE_DAY });
    const before = store.dump();
    const parsed = parsedOk(parseImport(text(file(sixty())), TODAY));
    store.failNextSet();
    await expect(applyImport(store, parsed)).rejects.toThrow('storage write failed');
    expect(store.dump()).toEqual(before);
    expect(store.setCalls).toBe(1);
  });
});

describe('hardened import rejections', () => {
  const day = (sites: Record<string, unknown>, blocked: unknown = {}): Record<string, unknown> => ({ [daysAgo(1)]: { sites, blocked } });
  const parse = (value: unknown): ParsedImport => parseImport(typeof value === 'string' ? value : text(value), TODAY);

  it('rejects malformed JSON with a readable reason and changes nothing', async () => {
    const store = memoryStore({ [`d:${daysAgo(0)}`]: BASE_DAY });
    const before = store.dump();
    const outcome = await importText(store, '{"format": "dwell-export", ', TODAY);
    expect(outcome).toMatchObject({ ok: false, code: 'bad-json' });
    if (!outcome.ok) expect(outcome.reason).toMatch(/not valid JSON/);
    expect(store.dump()).toEqual(before);
  });

  it('rejects non-text, a wrong format, a wrong version and a non-object root', () => {
    expectRejected(parseImport(42, TODAY), 'not-text', 'text');
    expectRejected(parse({ ...file({}), format: 'other' }), 'bad-format', 'Dwell export');
    expectRejected(parse({ ...file({}), version: 2 }), 'bad-version', 'version');
    expectRejected(parse([1, 2]), 'bad-shape', 'object');
    expectRejected(parse({ ...file({}), days: [] }), 'bad-shape', 'days');
    expectRejected(parse({ ...file({}), extra: 1 }), 'bad-shape', 'extra');
    expectRejected(parse({ ...file({}), exportedAt: 5 }), 'bad-shape', 'exportedAt');
  });

  it('throws, rather than reporting a file problem, when the caller passes an invalid date', () => {
    expect(() => parseImport(text(file({})), new Date(Number.NaN))).toThrow(RangeError);
  });

  it('rejects a file above 2 MB, counted in bytes', () => {
    const padded = text(file({})) + ' '.repeat(MAX_IMPORT_BYTES);
    expectRejected(parse(padded), 'too-large', '2 MB');
    const multibyte = text(file({})) + ' '.repeat(MAX_IMPORT_BYTES - 1_000_000) + 'é'.repeat(500_000);
    expect(multibyte.length).toBeLessThan(MAX_IMPORT_BYTES);
    expectRejected(parse(multibyte), 'too-large', '2 MB');
  });

  it('rejects 401 days and 501 sites in one day', () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 401; i += 1) many[daysAgo(i)] = { sites: {}, blocked: {} };
    expectRejected(parse(file(many)), 'too-many-days', '400');
    const sites: Record<string, unknown> = {};
    for (let i = 0; i < 501; i += 1) sites[`s${i}.com`] = site({ '1': 1 });
    expectRejected(parse(file(day(sites))), 'too-many-sites', '500');
  });

  it.each(['__proto__', 'constructor', 'prototype'])('rejects the whole file for a %s site key', (key) => {
    const raw = text(file(day({ 'ok.com': site({ '1': 1 }) }))).replace('"ok.com"', `"${key}"`);
    expectRejected(parse(raw), 'forbidden-key', key);
  });

  it.each(['https://x.com/a', 'www.x.com', 'Example.com', 'a..com', 'a_b.com', `${'a'.repeat(250)}.com`])('rejects the non-hostname site key %s', (key) => {
    expectRejected(parse(file(day({ [key]: site({ '1': 1 }) }))), 'bad-site', 'site');
  });

  it.each(['-1', '24', '05', '1.5', 'x'])('rejects the hour key %s', (hour) => {
    expectRejected(parse(file(day({ 'a.com': site({ [hour]: 1 }) }))), 'bad-hour', hour);
  });

  it.each([-1, 3601, 1.5, '60', null])('rejects the hour value %s', (value) => {
    expectRejected(parse(file(day({ 'a.com': { h: { '3': value }, v: 0 } }))), 'bad-seconds', '3600');
  });

  it('accepts the hour value bounds 0 and 3600', () => {
    expect(parse(file(day({ 'a.com': site({ '0': 0, '23': 3600 }) }))).ok).toBe(true);
  });

  it.each([-1, 1.5, 100_001, undefined])('rejects visits of %s', (v) => {
    expectRejected(parse(file(day({ 'a.com': { h: {}, v } }))), 'bad-visits', 'visits');
  });

  it('rejects bad blocked counts and unknown blocked sites', () => {
    expectRejected(parse(file(day({}, { instagram: -1 }))), 'bad-blocked', 'instagram');
    expectRejected(parse(file(day({}, { instagram: 1.5 }))), 'bad-blocked', 'instagram');
    expectRejected(parse(file(day({}, { tiktok: 1 }))), 'bad-blocked', 'tiktok');
    expectRejected(parse(file(day({}, [1]))), 'bad-blocked', 'blocked');
  });

  it('rejects unknown keys inside day and site records', () => {
    expectRejected(parse(file({ [daysAgo(1)]: { sites: {}, blocked: {}, url: 'x' } })), 'bad-shape', 'url');
    expectRejected(parse(file(day({ 'a.com': { h: {}, v: 0, title: 'x' } }))), 'bad-shape', 'title');
    expectRejected(parse(file({ [daysAgo(1)]: { blocked: {} } })), 'bad-shape', 'sites');
  });

  it.each(['2026-13-01', '2026-02-30', 'd:2026-10-01', '20261001'])('rejects the malformed date key %s', (key) => {
    expectRejected(parse(file({ [key]: { sites: {}, blocked: {} } })), 'bad-date', key);
  });

  it('skips and counts days outside the 90-day window ending today', () => {
    const incoming = file({
      [daysAgo(0)]: BASE_DAY,
      [daysAgo(89)]: BASE_DAY,
      [daysAgo(90)]: BASE_DAY,
      [daysAgo(400)]: BASE_DAY,
      [daysAgo(-1)]: BASE_DAY,
    });
    const parsed = parsedOk(parse(incoming));
    expect(Object.keys(parsed.days).sort()).toEqual([daysAgo(89), daysAgo(0)]);
    expect(parsed.skipped).toBe(3);
  });

  it('runs settings through the settings validator', () => {
    expectRejected(parse(file({}, { settings: { ...DEFAULT_SETTINGS, idleThresholdSec: 45 } })), 'bad-settings', 'idleThresholdSec');
    expectRejected(parse(file({}, { settings: { ...DEFAULT_SETTINGS, ignore: ['https://a.com/'] } })), 'bad-settings', 'ignore');
    expect(parsedOk(parse(file({}))).settings).toBeNull();
  });
});

describe('import is idempotent (property)', () => {
  const host = fc.stringMatching(/^[a-z0-9]{1,6}\.(com|ca|org)$/);
  const hours = fc.dictionary(fc.integer({ min: 0, max: 23 }).map(String), fc.integer({ min: 0, max: 3600 }), { maxKeys: 6 });
  const siteRecord = fc.record({ h: hours, v: fc.integer({ min: 0, max: 100_000 }) });
  const blocked = fc.record({ instagram: fc.nat(500), youtube: fc.nat(500), facebook: fc.nat(500) });
  const dayRecord = fc.record({ sites: fc.dictionary(host, siteRecord, { maxKeys: 5 }), blocked });
  const days = fc.dictionary(fc.integer({ min: -3, max: 95 }).map(daysAgo), dayRecord, { maxKeys: 12 });
  const settings = fc.option(fc.record({ idleThresholdSec: fc.constantFrom(30, 60, 120, 300), eventLog: fc.boolean() }), { nil: undefined });
  const existing = fc.dictionary(fc.integer({ min: 0, max: 89 }).map((n) => `d:${daysAgo(n)}`), dayRecord, { maxKeys: 6 });

  it('importing a valid file twice equals importing it once, over any existing data', async () => {
    await fc.assert(
      fc.asyncProperty(days, settings, existing, async (d, s, seed) => {
        const raw = text(file(d, s === undefined ? {} : { settings: s }));
        const once: MemoryStore = memoryStore(seed);
        const twice: MemoryStore = memoryStore(seed);
        expect((await importText(once, raw, TODAY)).ok).toBe(true);
        await importText(twice, raw, TODAY);
        await importText(twice, raw, TODAY);
        expect(twice.dump()).toEqual(once.dump());
      }),
      { numRuns: 150 },
    );
  });
});
