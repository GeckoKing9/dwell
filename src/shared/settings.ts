/**
 * The settings schema at the trust boundary. One table of field validators serves every path: the
 * strict checks for a settings message, an imported file and a save, and the lenient read of the
 * stored value, which repairs field by field instead of falling back to the defaults wholesale.
 */
import { CATEGORIES, DEFAULT_SETTINGS, SETTINGS_KEY, THEMES } from '../store/schema.ts';
import type { Category, Settings, Theme } from '../store/schema.ts';
import type { KeyValueStore } from '../store/adapter.ts';
import { isForbiddenKey, isPlainObject, isSiteId, keyProblem, nullRecord } from '../store/validate.ts';
import type { Check } from '../store/validate.ts';

type Blockers = Settings['blockers'];
/** What each field validator yields: the field itself, except `blockers`, which may be partial. */
type Fields = { [K in keyof Settings]: K extends 'blockers' ? Partial<Blockers> : Settings[K] };
/** A change sent from an extension page: any field but `paused` (it has its own message). Lists and the category map replace, never merge. */
export type SettingsPatch = Partial<Omit<Fields, 'paused'>>;
export type SettingsResult = Check<Settings>;
type Failure = { ok: false; reason: string };

/** The cap on every host list and on the category map, wherever they come from. */
export const MAX_LIST_ENTRIES = 500;
const IDLE_CHOICES: readonly number[] = [30, 60, 120, 300];
const BLOCKER_KEYS: ReadonlySet<string> = new Set(Object.keys(DEFAULT_SETTINGS.blockers));
const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];
/** The keys a settings message may carry. */
export const PATCH_KEYS = SETTINGS_KEYS.filter((key) => key !== 'paused') as (keyof SettingsPatch)[];

function fail(reason: string): Failure {
  return { ok: false, reason };
}

/** An untrusted value echoed in a reason: strings quoted and cut short, objects named, never dumped. */
function preview(value: unknown): string {
  if (typeof value === 'object' && value !== null) return Array.isArray(value) ? 'a list' : 'an object';
  if (typeof value !== 'string') return String(value);
  return value.length > 40 ? `"${value.slice(0, 40)}..."` : `"${value}"`;
}

function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

function flag(name: string): (value: unknown) => Check<boolean> {
  return (value) => (typeof value === 'boolean' ? { ok: true, value } : fail(`Settings "${name}" must be true or false, not ${preview(value)}.`));
}

function hostList(name: string): (value: unknown) => Check<string[]> {
  return (value) => {
    if (!Array.isArray(value)) return fail(`Settings "${name}" must be a list of sites.`);
    if (value.length > MAX_LIST_ENTRIES) return fail(`Settings "${name}" has more than ${MAX_LIST_ENTRIES} entries.`);
    for (const host of value as unknown[]) {
      if (!isSiteId(host)) return fail(`Settings "${name}" contains ${preview(host)}, which is not a site name like example.com.`);
    }
    return { ok: true, value: [...new Set(value as string[])] };
  };
}

function categoryMap(value: unknown): Check<Record<string, Category>> {
  if (!isPlainObject(value)) return fail('Settings "categories" must be an object.');
  const entries = Object.entries(value);
  if (entries.length > MAX_LIST_ENTRIES) return fail(`Settings "categories" has more than ${MAX_LIST_ENTRIES} entries.`);
  const out = nullRecord<Category>();
  for (const [site, category] of entries) {
    if (!isSiteId(site)) {
      const kind = isForbiddenKey(site) ? 'the forbidden key' : 'the non-site key';
      return fail(`Settings "categories" contains ${kind} ${preview(site)}.`);
    }
    if (!isCategory(category)) return fail(`Settings "categories" maps ${site} to ${preview(category)}, which is not a category.`);
    out[site] = category;
  }
  return { ok: true, value: out };
}

function blockers(value: unknown): Check<Partial<Blockers>> {
  if (!isPlainObject(value)) return fail('Settings "blockers" must be an object.');
  const problem = keyProblem(value, BLOCKER_KEYS, 'Settings "blockers"');
  if (problem) return fail(problem.reason);
  const out: Partial<Blockers> = {};
  for (const key of Object.keys(value) as (keyof Blockers)[]) {
    const checked = flag(`blockers.${key}`)(value[key]);
    if (!checked.ok) return checked;
    out[key] = checked.value;
  }
  return Object.keys(out).length > 0 ? { ok: true, value: out } : fail('Settings "blockers" must name at least one blocker.');
}

/** The one validator per field, shared by every path in and out of storage. */
const FIELDS: { readonly [K in keyof Settings]: (value: unknown) => Check<Fields[K]> } = {
  idleThresholdSec: (value) =>
    typeof value === 'number' && IDLE_CHOICES.includes(value)
      ? { ok: true, value: value as Settings['idleThresholdSec'] }
      : fail(`Settings "idleThresholdSec" must be 30, 60, 120 or 300, not ${preview(value)}.`),
  mediaOverride: flag('mediaOverride'),
  paused: flag('paused'),
  blockers,
  overrides: hostList('overrides'),
  ignore: hostList('ignore'),
  categories: categoryMap,
  eventLog: flag('eventLog'),
  theme: (value) =>
    typeof value === 'string' && (THEMES as readonly string[]).includes(value)
      ? { ok: true, value: value as Theme }
      : fail(`Settings "theme" must be system, light or dark, not ${preview(value)}.`),
};

/** Checks `value` for `key` and copies it into `out`; the failure, or null when it passed. */
function take<K extends keyof Settings>(out: Partial<Fields>, key: K, value: unknown): Failure | null {
  const checked = FIELDS[key](value);
  if (!checked.ok) return checked;
  out[key] = checked.value;
  return null;
}

/** Strict: only the allowed keys, no prototype keys, every present field valid. */
function checkFields(input: unknown, keys: readonly (keyof Settings)[]): Check<Partial<Fields>> {
  if (!isPlainObject(input)) return fail('Settings must be an object.');
  const problem = keyProblem(input, new Set<string>(keys), 'Settings');
  if (problem) return fail(problem.reason);
  const out: Partial<Fields> = {};
  for (const key of keys) {
    const failure = Object.hasOwn(input, key) ? take(out, key, input[key]) : null;
    if (failure) return failure;
  }
  return { ok: true, value: out };
}

function copySettings(base: Settings): Settings {
  const categories = nullRecord<Category>();
  for (const [site, category] of Object.entries(base.categories)) categories[site] = category;
  return { ...base, blockers: { ...base.blockers }, overrides: [...base.overrides], ignore: [...base.ignore], categories };
}

/** `base` with checked fields applied; `blockers` merges flag by flag. */
function merge(base: Settings, fields: Partial<Fields>): Settings {
  const { blockers: flags, ...rest } = fields;
  const out: Settings = { ...copySettings(base), ...rest };
  if (flags) out.blockers = { ...out.blockers, ...flags };
  return out;
}

/**
 * Validates a full value or a partial one and returns `base` with it applied. Strict: only known
 * keys, the four idle choices, booleans, site ids, known categories, at most 500 entries per list,
 * and no prototype keys at any level. The first problem names its key and the start of its value.
 */
export function validateSettings(input: unknown, base: Settings = DEFAULT_SETTINGS): SettingsResult {
  const fields = checkFields(input, SETTINGS_KEYS);
  return fields.ok ? { ok: true, value: merge(base, fields.value) } : fields;
}

/** A settings message's patch, checked by the same field validators; `paused` is not one of its keys. */
export function validateSettingsPatch(input: unknown): Check<SettingsPatch> {
  return checkFields(input, PATCH_KEYS);
}

/** The usable part of a stored field: lists and the map keep their valid entries, blockers their valid flags. */
function salvage(key: keyof Settings, value: unknown): unknown {
  if ((key === 'overrides' || key === 'ignore') && Array.isArray(value)) {
    return (value as unknown[]).filter(isSiteId).slice(0, MAX_LIST_ENTRIES);
  }
  if (key === 'categories' && isPlainObject(value)) {
    const out = nullRecord<Category>();
    const valid = Object.entries(value).filter(([site, category]) => isSiteId(site) && isCategory(category));
    for (const [site, category] of valid.slice(0, MAX_LIST_ENTRIES)) out[site] = category as Category;
    return out;
  }
  if (key === 'blockers') return repairBlockers(value);
  return value;
}

/**
 * The flags of a stored `blockers` value: each true or false flag kept, a missing or malformed one at its
 * default, so settings stored before a toggle existed (v0.1.0 has no `xVideos`) read that toggle as on. The
 * one rule for stored flags: the settings repair and the guard (`blocker/guard-machine.ts`) both read them here.
 */
export function repairBlockers(stored: unknown): Blockers {
  const out: Blockers = { ...DEFAULT_SETTINGS.blockers };
  if (!isPlainObject(stored)) return out;
  for (const key of BLOCKER_KEYS) {
    const flag = stored[key];
    if (typeof flag === 'boolean') out[key as keyof Blockers] = flag;
  }
  return out;
}

/**
 * A stored value read leniently, field by field: each valid field is kept, an invalid one reads as
 * its default, a bad entry of a list or the category map is dropped, an unknown key is ignored. A
 * problem in one field therefore never resets another (the pause, the lists, the categories).
 */
export function repairSettings(stored: unknown): Settings {
  const fields: Partial<Fields> = {};
  if (isPlainObject(stored)) {
    for (const key of SETTINGS_KEYS) if (Object.hasOwn(stored, key)) take(fields, key, salvage(key, stored[key]));
  }
  return merge(DEFAULT_SETTINGS, fields);
}

/** The stored settings over the defaults, repaired field by field. */
export async function loadSettings(store: KeyValueStore): Promise<Settings> {
  return repairSettings((await store.get([SETTINGS_KEY]))[SETTINGS_KEY]);
}

/** Applies an untrusted patch over the current settings; writes only when it validates. */
export async function saveSettings(store: KeyValueStore, patch: unknown): Promise<SettingsResult> {
  const result = validateSettings(patch, await loadSettings(store));
  if (result.ok) await store.set({ [SETTINGS_KEY]: result.value });
  return result;
}
