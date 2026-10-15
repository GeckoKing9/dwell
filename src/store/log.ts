/**
 * The optional 24-hour event ring (KTD10) in storage.local: one `log:<UTC hour>` key per hour,
 * each entry only `{ at, kind, site? }`. A guard refuses anything that looks like a URL, path or title.
 * UTC hour keys keep the ring monotonic across DST; local time never matters here.
 */
import type { KeyValueStore, StoredRecord } from './adapter.ts';
import { isPlainObject, isSiteId } from './validate.ts';

export const LOG_KEY_PREFIX = 'log:';
export const LOG_FORMAT = 'dwell-event-log';
export const LOG_WINDOW_MS = 24 * 3_600_000;
export const MAX_ENTRIES_PER_HOUR = 3600;

const HOUR_MS = 3_600_000;
const MAX_TIME = 8.64e15;
const KIND_RE = /^[a-z][a-z0-9-]{0,31}$/;
const LOG_KEY_RE = /^log:(\d{4})-(\d{2})-(\d{2})T(\d{2})$/;
const ENTRY_KEYS: ReadonlySet<string> = new Set(['at', 'kind', 'site']);
const URL_MARKS = ['://', '/', '?'] as const;

export interface LogEntry {
  readonly at: number;
  readonly kind: string;
  readonly site?: string;
}

export interface LogExport {
  readonly format: typeof LOG_FORMAT;
  readonly version: 1;
  readonly entries: LogEntry[];
}

/** Thrown when an entry could carry more than a time, an event kind and a site id. */
export class LogPrivacyError extends Error {
  override name = 'LogPrivacyError';
}

/** Why `entry` may not be logged, or null. Messages never echo the offending value. */
function entryProblem(entry: unknown): string | null {
  if (!isPlainObject(entry)) return 'A log entry must be an object.';
  for (const key of Object.keys(entry)) {
    if (!ENTRY_KEYS.has(key)) return 'A log entry may hold only at, kind and site.';
  }
  for (const value of Object.values(entry)) {
    if (typeof value === 'string' && URL_MARKS.some((mark) => value.includes(mark))) {
      return 'A log entry contains "://", "/" or "?", which only a URL would.';
    }
  }
  const { at, kind, site } = entry;
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0 || at > MAX_TIME) return 'A log entry needs a valid time.';
  if (typeof kind !== 'string' || !KIND_RE.test(kind)) return 'A log entry kind must be a short lowercase word.';
  if (site !== undefined && !isSiteId(site)) return 'A log entry site must be a grouped site id like example.com.';
  return null;
}

/** Throws LogPrivacyError unless `entry` is exactly `{ at, kind, site? }` with a safe kind and site id. */
export function assertLogEntrySafe(entry: unknown): asserts entry is LogEntry {
  const problem = entryProblem(entry);
  if (problem !== null) throw new LogPrivacyError(problem);
}

/** A fresh object with only the three allowed fields. */
function clean(entry: LogEntry): LogEntry {
  return entry.site === undefined ? { at: entry.at, kind: entry.kind } : { at: entry.at, kind: entry.kind, site: entry.site };
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

/**
 * Appends entries to their hour keys and drops hour keys that ended more than 24 h before `now`.
 * Every entry is checked first; one unsafe entry throws and nothing is written.
 */
export async function appendLogEntries(store: KeyValueStore, entries: readonly LogEntry[], now: number): Promise<void> {
  for (const entry of entries) assertLogEntrySafe(entry);
  const cutoff = now - LOG_WINDOW_MS;

  const stale = (await store.keys()).filter((key) => key.startsWith(LOG_KEY_PREFIX) && isStale(key, cutoff));
  if (stale.length > 0) await store.remove(stale);

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
    out[key] = [...kept, ...list].sort((a, b) => a.at - b.at).slice(-MAX_ENTRIES_PER_HOUR);
  }
  await store.set(out);
}

/** Every stored entry in time order, for the separate "export event log" action. Never part of the data export. */
export async function exportLog(store: KeyValueStore): Promise<LogExport> {
  const keys = (await store.keys()).filter((key) => key.startsWith(LOG_KEY_PREFIX)).sort();
  const stored = keys.length > 0 ? await store.get(keys) : {};
  const entries: LogEntry[] = [];
  for (const key of keys) {
    const list: unknown = stored[key];
    if (!Array.isArray(list)) throw new LogPrivacyError(`Log key ${key} does not hold a list.`);
    for (const entry of list) {
      assertLogEntrySafe(entry);
      entries.push(clean(entry));
    }
  }
  entries.sort((a, b) => a.at - b.at);
  return { format: LOG_FORMAT, version: 1, entries };
}
