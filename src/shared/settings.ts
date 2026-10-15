/** The settings schema at the trust boundary: one strict validator for the UI, messages and import. */
import { CATEGORIES, DEFAULT_SETTINGS, SETTINGS_KEY } from '../store/schema.ts';
import type { Category, Settings } from '../store/schema.ts';
import type { KeyValueStore } from '../store/adapter.ts';
import { isForbiddenKey, isPlainObject, isSiteId, keyProblem, nullRecord } from '../store/validate.ts';
import type { Check } from '../store/validate.ts';

/** Any subset of the settings; `blockers` may itself be partial. Lists and the category map replace, never merge. */
export type SettingsPatch = Partial<Omit<Settings, 'blockers'>> & { blockers?: Partial<Settings['blockers']> };
export type SettingsResult = Check<Settings>;

export const MAX_LIST_ENTRIES = 500;
const IDLE_CHOICES: readonly number[] = [30, 60, 120, 300];
const BLOCKER_KEYS: ReadonlySet<string> = new Set(Object.keys(DEFAULT_SETTINGS.blockers));
const SETTINGS_KEYS: ReadonlySet<string> = new Set(Object.keys(DEFAULT_SETTINGS));
const BOOLEAN_KEYS = ['mediaOverride', 'paused', 'eventLog'] as const;

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

function isIdleChoice(value: unknown): value is Settings['idleThresholdSec'] {
  return typeof value === 'number' && IDLE_CHOICES.includes(value);
}

function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

function copySettings(base: Settings): Settings {
  const categories = nullRecord<Category>();
  for (const [site, category] of Object.entries(base.categories)) categories[site] = category;
  return { ...base, blockers: { ...base.blockers }, overrides: [...base.overrides], ignore: [...base.ignore], categories };
}

function hostList(value: unknown, name: string): Check<string[]> {
  if (!Array.isArray(value)) return fail(`Settings "${name}" must be a list of sites.`);
  if (value.length > MAX_LIST_ENTRIES) return fail(`Settings "${name}" has more than ${MAX_LIST_ENTRIES} entries.`);
  for (const host of value) {
    if (!isSiteId(host)) return fail(`Settings "${name}" contains "${String(host)}", which is not a site name like example.com.`);
  }
  return { ok: true, value: [...new Set(value as string[])] };
}

function categoryMap(value: unknown): Check<Record<string, Category>> {
  if (!isPlainObject(value)) return fail('Settings "categories" must be an object.');
  const entries = Object.entries(value);
  if (entries.length > MAX_LIST_ENTRIES) return fail(`Settings "categories" has more than ${MAX_LIST_ENTRIES} entries.`);
  const out = nullRecord<Category>();
  for (const [site, category] of entries) {
    if (!isSiteId(site)) {
      const kind = isForbiddenKey(site) ? 'the forbidden key' : 'the non-site key';
      return fail(`Settings "categories" contains ${kind} "${site}".`);
    }
    if (!isCategory(category)) return fail(`Settings "categories" maps ${site} to "${String(category)}", which is not a category.`);
    out[site] = category;
  }
  return { ok: true, value: out };
}

function blockers(value: unknown, base: Settings['blockers']): Check<Settings['blockers']> {
  if (!isPlainObject(value)) return fail('Settings "blockers" must be an object.');
  const problem = keyProblem(value, BLOCKER_KEYS, 'Settings "blockers"');
  if (problem) return fail(problem.reason);
  const out = { ...base };
  for (const key of Object.keys(value) as (keyof Settings['blockers'])[]) {
    const flag = value[key];
    if (typeof flag !== 'boolean') return fail(`Settings "blockers.${key}" must be true or false.`);
    out[key] = flag;
  }
  return { ok: true, value: out };
}

/**
 * Validates a full value or a partial patch and returns `base` with the patch applied.
 * Strict: only known keys, the four idle choices, booleans, hostnames, known categories,
 * at most 500 entries per list, and no prototype keys at any level.
 */
export function validateSettings(input: unknown, base: Settings = DEFAULT_SETTINGS): SettingsResult {
  if (!isPlainObject(input)) return fail('Settings must be an object.');
  const problem = keyProblem(input, SETTINGS_KEYS, 'Settings');
  if (problem) return fail(problem.reason);
  const out = copySettings(base);

  if (Object.hasOwn(input, 'idleThresholdSec')) {
    const idle = input['idleThresholdSec'];
    if (!isIdleChoice(idle)) return fail('Settings "idleThresholdSec" must be 30, 60, 120 or 300.');
    out.idleThresholdSec = idle;
  }
  for (const key of BOOLEAN_KEYS) {
    if (!Object.hasOwn(input, key)) continue;
    const flag = input[key];
    if (typeof flag !== 'boolean') return fail(`Settings "${key}" must be true or false.`);
    out[key] = flag;
  }
  if (Object.hasOwn(input, 'blockers')) {
    const checked = blockers(input['blockers'], out.blockers);
    if (!checked.ok) return checked;
    out.blockers = checked.value;
  }
  for (const key of ['overrides', 'ignore'] as const) {
    if (!Object.hasOwn(input, key)) continue;
    const checked = hostList(input[key], key);
    if (!checked.ok) return checked;
    out[key] = checked.value;
  }
  if (Object.hasOwn(input, 'categories')) {
    const checked = categoryMap(input['categories']);
    if (!checked.ok) return checked;
    out.categories = checked.value;
  }
  return { ok: true, value: out };
}

/** Stored settings over the defaults. A stored value that fails validation reads as the defaults. */
export async function loadSettings(store: KeyValueStore): Promise<Settings> {
  const stored = (await store.get([SETTINGS_KEY]))[SETTINGS_KEY];
  const result = validateSettings(stored === undefined ? {} : stored);
  return result.ok ? result.value : copySettings(DEFAULT_SETTINGS);
}

/** Applies an untrusted patch over the current settings; writes only when it validates. */
export async function saveSettings(store: KeyValueStore, patch: unknown): Promise<SettingsResult> {
  const result = validateSettings(patch, await loadSettings(store));
  if (result.ok) await store.set({ [SETTINGS_KEY]: result.value });
  return result;
}
