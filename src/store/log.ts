/**
 * The optional 24-hour event ring (KTD10, ADR-1) in storage.local: one `log:<UTC hour>` key per hour,
 * each entry `{ at, kind, site?, win?, tab?, a? }`. `win` and `tab` are Chrome's integer window and tab
 * ids and `a` the audible flag, so a recorded day replays through the engine exactly. A guard refuses
 * any other field, a kind outside LOG_KINDS, and anything that looks like a URL, path or title.
 * UTC hour keys keep the ring monotonic across DST; local time never matters here.
 */
import type { KeyValueStore, StoredRecord } from './adapter.ts';
import { loadSettings, validateSettings } from '../shared/settings.ts';
import { loadAllDays, readDayRecord } from './days.ts';
import { DAY_KEY_PREFIX, dateString, isDayKey, type DayRecord, type Settings } from './schema.ts';
import { isForbiddenKey, isIntInRange, isPlainObject, isSiteId, nullRecord } from './validate.ts';

export const LOG_KEY_PREFIX = 'log:';
export const LOG_FORMAT = 'dwell-event-log';
export const LOG_VERSION = 2;
export const LOG_WINDOW_MS = 24 * 3_600_000;
export const MAX_ENTRIES_PER_HOUR = 3600;

/**
 * Every kind an entry may have: one per engine event, with level values folded in (`idle-locked`,
 * `media-on`, `seed-idle`), plus `start`, written when the worker built a fresh engine state.
 */
export const LOG_KINDS = [
  'focus',
  'focus-none',
  'activate',
  'url',
  'url-nav',
  'idle-active',
  'idle-idle',
  'idle-locked',
  'media-on',
  'media-off',
  'pause-on',
  'pause-off',
  'tick',
  'close',
  'seed-active',
  'seed-idle',
  'seed-locked',
  'start',
] as const;

export type LogVersion = 1 | typeof LOG_VERSION;

const HOUR_MS = 3_600_000;
const MAX_TIME = 8.64e15;
const MAX_FILE_ENTRIES = 25 * MAX_ENTRIES_PER_HOUR;
const LOG_KEY_RE = /^log:(\d{4})-(\d{2})-(\d{2})T(\d{2})$/;
const URL_MARKS = ['://', '/', '?'] as const;
const KINDS: ReadonlySet<string> = new Set(LOG_KINDS);
/** Version 1 held only `{ at, kind, site? }`, and its seed carried no idle state. Read only, never written. */
const V1_KINDS: ReadonlySet<string> = new Set([
  ...LOG_KINDS.filter((kind) => kind !== 'start' && kind !== 'url-nav' && !kind.startsWith('seed-')),
  'seed',
]);
const ENTRY_KEYS: ReadonlySet<string> = new Set(['at', 'kind', 'site', 'win', 'tab', 'a']);
const V1_ENTRY_KEYS: ReadonlySet<string> = new Set(['at', 'kind', 'site']);
const FILE_KEYS: ReadonlySet<string> = new Set(['format', 'version', 'entries', 'days', 'settings']);

export interface LogEntry {
  readonly at: number;
  readonly kind: string;
  readonly site?: string;
  readonly win?: number;
  readonly tab?: number;
  readonly a?: 0 | 1;
}

/** The two settings that change how a day replays; the rest of the settings never reach the engine. */
export type LogSettings = Pick<Settings, 'idleThresholdSec' | 'mediaOverride'>;

export interface LogExport {
  readonly format: typeof LOG_FORMAT;
  readonly version: typeof LOG_VERSION;
  readonly entries: LogEntry[];
  /** The stored day records, keyed 'YYYY-MM-DD', of every local day from the first entry to the last. */
  readonly days: Record<string, DayRecord>;
  /** The idle threshold and media override in force at export time. */
  readonly settings: LogSettings;
}

/** A log file read back: version 1 files have no ids and no days. */
export interface LogFile {
  readonly version: LogVersion;
  readonly entries: LogEntry[];
  readonly days: Record<string, DayRecord>;
  /** Absent in files exported before the field existed. */
  readonly settings?: LogSettings;
}

/** Thrown when an entry could carry more than a time, an event kind, a site id and integer ids. */
export class LogPrivacyError extends Error {
  override name = 'LogPrivacyError';
}

function isId(value: unknown): boolean {
  return value === undefined || isIntInRange(value, 0, Number.MAX_SAFE_INTEGER);
}

/** Why `entry` may not be logged, or null. Messages never echo the offending value. */
function entryProblem(entry: unknown, version: LogVersion = LOG_VERSION): string | null {
  if (!isPlainObject(entry)) return 'A log entry must be an object.';
  const allowed = version === 1 ? V1_ENTRY_KEYS : ENTRY_KEYS;
  for (const key of Object.keys(entry)) {
    if (!allowed.has(key)) return 'A log entry may hold only at, kind, site, win, tab and a.';
  }
  for (const value of Object.values(entry)) {
    if (typeof value === 'string' && URL_MARKS.some((mark) => value.includes(mark))) {
      return 'A log entry contains "://", "/" or "?", which only a URL would.';
    }
  }
  const { at, kind, site, win, tab, a } = entry;
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0 || at > MAX_TIME) return 'A log entry needs a valid time.';
  if (typeof kind !== 'string' || !(version === 1 ? V1_KINDS : KINDS).has(kind)) return 'A log entry kind must be one of LOG_KINDS.';
  if (site !== undefined && !isSiteId(site)) return 'A log entry site must be a grouped site id like example.com.';
  if (!isId(win) || !isId(tab)) return 'A log entry window or tab id must be a non-negative integer.';
  if (a !== undefined && a !== 0 && a !== 1) return 'A log entry audible flag must be 0 or 1.';
  return null;
}

/** Throws LogPrivacyError unless `entry` is `{ at, kind, site?, win?, tab?, a? }` with a listed kind and safe values. */
export function assertLogEntrySafe(entry: unknown, version: LogVersion = LOG_VERSION): asserts entry is LogEntry {
  const problem = entryProblem(entry, version);
  if (problem !== null) throw new LogPrivacyError(problem);
}

/** A fresh object with only the allowed fields that are present, in a fixed order. */
function clean(entry: LogEntry): LogEntry {
  const { at, kind, site, win, tab, a } = entry;
  return {
    at,
    kind,
    ...(site === undefined ? {} : { site }),
    ...(win === undefined ? {} : { win }),
    ...(tab === undefined ? {} : { tab }),
    ...(a === undefined ? {} : { a }),
  };
}

/** 'log:YYYY-MM-DDTHH' for the UTC hour containing `at`. */
export function logKey(at: number): string {
  return LOG_KEY_PREFIX + new Date(at).toISOString().slice(0, 13);
}

/** A log key whose whole hour ended at or before `cutoff`, or one that is not a valid hour key. */
function isStale(key: string, cutoff: number): boolean {
  const m = LOG_KEY_RE.exec(key);
  if (!m) return true;
  const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]));
  return start + HOUR_MS <= cutoff;
}

/** Per store, the hour key of `now` at the last sweep: an hour key can only expire when that hour changes. */
const sweptHour = new WeakMap<KeyValueStore, string>();

/** Removes the log hour keys that ended more than 24 h before `now`, and junk log keys; returns them. */
export async function pruneLog(store: KeyValueStore, now: number): Promise<string[]> {
  const cutoff = now - LOG_WINDOW_MS;
  const stale = (await store.keys()).filter((key) => key.startsWith(LOG_KEY_PREFIX) && isStale(key, cutoff));
  if (stale.length > 0) await store.remove(stale);
  sweptHour.set(store, logKey(now));
  return stale;
}

/**
 * Appends entries to their hour keys in arrival order, never sorted: the worker reduced them in that
 * order, and an exact replay needs it even across a backward clock step. Once per hour of `now` it
 * also drops hour keys that ended more than 24 h before `now` (listing every key is a full read on
 * Chrome without `getKeys`). Every entry is checked first; one unsafe entry throws and nothing is written.
 */
export async function appendLogEntries(store: KeyValueStore, entries: readonly LogEntry[], now: number): Promise<void> {
  for (const entry of entries) assertLogEntrySafe(entry);
  const cutoff = now - LOG_WINDOW_MS;
  if (sweptHour.get(store) !== logKey(now)) await pruneLog(store, now);

  const groups = new Map<string, LogEntry[]>();
  for (const entry of entries) {
    if (entry.at < cutoff) continue;
    const key = logKey(entry.at);
    const list = groups.get(key);
    if (list) list.push(clean(entry));
    else groups.set(key, [clean(entry)]);
  }
  if (groups.size === 0) return;

  const stored = await store.get([...groups.keys()]);
  const out: StoredRecord = {};
  for (const [key, list] of groups) {
    const previous: unknown = stored[key];
    const kept = Array.isArray(previous) ? previous.filter((e): e is LogEntry => entryProblem(e) === null).map(clean) : [];
    out[key] = [...kept, ...list].slice(-MAX_ENTRIES_PER_HOUR);
  }
  await store.set(out);
}

/** A version 1 entry still in the ring after an upgrade: harmless, but it cannot replay exactly. */
function isLegacyEntry(entry: unknown): boolean {
  return entryProblem(entry) !== null && entryProblem(entry, 1) === null;
}

/** Stored day records of every local day from `first` to `last`, keyed 'YYYY-MM-DD'. */
async function daysBetween(store: KeyValueStore, first: number, last: number): Promise<Record<string, DayRecord>> {
  const from = dateString(new Date(first));
  const to = dateString(new Date(last));
  const days = nullRecord<DayRecord>();
  const stored = await loadAllDays(store);
  for (const key of Object.keys(stored).sort()) {
    const day = key.slice(DAY_KEY_PREFIX.length);
    const record = stored[key];
    if (record && day >= from && day <= to) days[day] = record;
  }
  return days;
}

/**
 * Every stored entry, hour by hour and in arrival order within the hour, plus the day records they
 * cover, for the separate "export event log" action. Never part of the data export. A tampered
 * entry throws; a version 1 entry left from before an upgrade is skipped.
 */
export async function exportLog(store: KeyValueStore): Promise<LogExport> {
  const keys = (await store.keys()).filter((key) => key.startsWith(LOG_KEY_PREFIX)).sort();
  const stored = keys.length > 0 ? await store.get(keys) : {};
  const entries: LogEntry[] = [];
  for (const key of keys) {
    const list: unknown = stored[key];
    if (!Array.isArray(list)) throw new LogPrivacyError(`Log key ${key} does not hold a list.`);
    for (const entry of list) {
      if (isLegacyEntry(entry)) continue;
      assertLogEntrySafe(entry);
      entries.push(clean(entry));
    }
  }
  const first = entries.reduce((min, entry) => Math.min(min, entry.at), Infinity);
  const last = entries.reduce((max, entry) => Math.max(max, entry.at), -Infinity);
  const days = entries.length > 0 ? await daysBetween(store, first, last) : nullRecord<DayRecord>();
  const { idleThresholdSec, mediaOverride } = await loadSettings(store);
  return { format: LOG_FORMAT, version: LOG_VERSION, entries, days, settings: { idleThresholdSec, mediaOverride } };
}

function readDays(value: unknown): Record<string, DayRecord> {
  const days = nullRecord<DayRecord>();
  if (value === undefined) return days;
  if (!isPlainObject(value)) throw new TypeError('The days of an event log file must be an object.');
  for (const [day, record] of Object.entries(value)) {
    if (isForbiddenKey(day) || !isDayKey(DAY_KEY_PREFIX + day)) throw new TypeError('An event log file names a day that is not a date.');
    days[day] = readDayRecord(record);
  }
  return days;
}

function readSettings(value: unknown): LogSettings | undefined {
  if (value === undefined) return undefined;
  const checked = isPlainObject(value) && Object.keys(value).length === 2 ? validateSettings(value) : null;
  if (!checked?.ok) throw new TypeError('The settings of an event log file must hold idleThresholdSec and mediaOverride.');
  return { idleThresholdSec: checked.value.idleThresholdSec, mediaOverride: checked.value.mediaOverride };
}

/**
 * Reads an exported event log file (parsed JSON). Version 2 files replay exactly; version 1 files
 * carry no window or tab ids and replay approximately (see `replayLog`). Throws TypeError for a file
 * of the wrong shape and LogPrivacyError for an entry the guard refuses.
 */
export function readLogExport(value: unknown): LogFile {
  if (!isPlainObject(value) || value['format'] !== LOG_FORMAT) throw new TypeError('Not a Dwell event log file.');
  if (Object.keys(value).some((key) => !FILE_KEYS.has(key))) throw new TypeError('An event log file has an unknown field.');
  const version = value['version'];
  if (version !== 1 && version !== LOG_VERSION) throw new TypeError('Unsupported event log version.');
  const list = value['entries'];
  if (!Array.isArray(list) || list.length > MAX_FILE_ENTRIES) throw new TypeError('An event log file needs a list of at most 90,000 entries.');
  const entries = list.map((entry: unknown) => {
    assertLogEntrySafe(entry, version);
    return clean(entry);
  });
  const settings = readSettings(value['settings']);
  return { version, entries, days: readDays(value['days']), ...(settings ? { settings } : {}) };
}
