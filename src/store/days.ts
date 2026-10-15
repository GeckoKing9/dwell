/**
 * Day keys in storage.local (KTD3): attributions in, day records out.
 * Read-modify-write is not atomic across callers; the worker's serialised queue (KTD6) is what orders them.
 */
import { BLOCKED_SITES, DAY_KEY_PREFIX, isDayKey } from './schema.ts';
import type { BlockedSite, DayRecord, SiteRecord } from './schema.ts';
import type { KeyValueStore, StoredRecord } from './adapter.ts';
import { isIntInRange, isPlainObject, isSiteId, nullRecord } from './validate.ts';

export const MAX_HOUR_SECONDS = 3600;

/** One slice of counted time, as the engine emits it (structural, so this layer does not import the engine). */
export interface AttributionLike {
  readonly site: string;
  /** Local date, 'YYYY-MM-DD'. */
  readonly day: string;
  /** Local hour, 0..23. */
  readonly hour: number;
  readonly seconds: number;
  readonly visit?: boolean;
}

export interface ApplyResult {
  /** Day keys written. */
  readonly written: number;
  /** Attributions dropped as malformed: bad site id, date, hour or seconds. */
  readonly skipped: number;
}

const HOUR_KEY_RE = /^(?:\d|1\d|2[0-3])$/;

/** '0'..'23' with no padding or sign. */
export function isHourKey(key: string): boolean {
  return HOUR_KEY_RE.test(key);
}

/** 'd:YYYY-MM-DD' for a bare date or a day key; RangeError when it does not name a real date. */
export function toDayKey(day: string): string {
  const key = day.startsWith(DAY_KEY_PREFIX) ? day : DAY_KEY_PREFIX + day;
  if (!isDayKey(key)) throw new RangeError(`Not a day key: ${day}`);
  return key;
}

function emptyBlocked(): Record<BlockedSite, number> {
  const blocked = nullRecord<number>() as Record<BlockedSite, number>;
  for (const name of BLOCKED_SITES) blocked[name] = 0;
  return blocked;
}

/** An empty day record whose maps have no prototype. */
export function freshDayRecord(): DayRecord {
  return { sites: nullRecord<SiteRecord>(), blocked: emptyBlocked() };
}

function readSiteRecord(raw: Record<string, unknown>): SiteRecord {
  const h = nullRecord<number>();
  const hours = raw['h'];
  if (isPlainObject(hours)) {
    for (const [hour, seconds] of Object.entries(hours)) {
      if (isHourKey(hour) && typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) {
        h[hour] = Math.min(seconds, MAX_HOUR_SECONDS);
      }
    }
  }
  const v = raw['v'];
  return { h, v: isIntInRange(v, 0, Number.MAX_SAFE_INTEGER) ? v : 0 };
}

/**
 * Lenient reader for a stored day value: keeps every well-formed part, drops the rest,
 * and returns prototype-free maps. Untrusted files go through the strict import parser instead.
 */
export function readDayRecord(value: unknown): DayRecord {
  const record = freshDayRecord();
  if (!isPlainObject(value)) return record;
  const sites = value['sites'];
  if (isPlainObject(sites)) {
    for (const [site, raw] of Object.entries(sites)) {
      if (isSiteId(site) && isPlainObject(raw)) record.sites[site] = readSiteRecord(raw);
    }
  }
  const blocked = value['blocked'];
  if (isPlainObject(blocked)) {
    for (const name of BLOCKED_SITES) {
      const count = blocked[name];
      if (isIntInRange(count, 0, Number.MAX_SAFE_INTEGER)) record.blocked[name] = count;
    }
  }
  return record;
}

function isValidAttribution(a: AttributionLike): boolean {
  return (
    isSiteId(a.site) &&
    isDayKey(DAY_KEY_PREFIX + a.day) &&
    isIntInRange(a.hour, 0, 23) &&
    typeof a.seconds === 'number' &&
    Number.isFinite(a.seconds) &&
    a.seconds >= 0
  );
}

/** Millisecond precision keeps float noise (0.1 + 0.2) out of storage. */
function roundMs(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/** Adds one attribution; false when it carries nothing to record. */
function addAttribution(record: DayRecord, a: AttributionLike): boolean {
  if (a.seconds === 0 && a.visit !== true) return false;
  let site = record.sites[a.site];
  if (!site) {
    site = { h: nullRecord<number>(), v: 0 };
    record.sites[a.site] = site;
  }
  if (a.seconds > 0) {
    const hour = String(a.hour);
    site.h[hour] = roundMs(Math.min(MAX_HOUR_SECONDS, (site.h[hour] ?? 0) + a.seconds));
  }
  if (a.visit === true) site.v += 1;
  return true;
}

/** Adds attributions to their day keys: one read and one write for the whole batch, each day key touched once. */
export async function applyAttributions(store: KeyValueStore, attributions: readonly AttributionLike[]): Promise<ApplyResult> {
  const byDay = new Map<string, AttributionLike[]>();
  let skipped = 0;
  for (const a of attributions) {
    if (!isValidAttribution(a)) {
      skipped += 1;
      continue;
    }
    const key = DAY_KEY_PREFIX + a.day;
    const list = byDay.get(key);
    if (list) list.push(a);
    else byDay.set(key, [a]);
  }
  if (byDay.size === 0) return { written: 0, skipped };

  const stored = await store.get([...byDay.keys()]);
  const out: StoredRecord = {};
  for (const [key, list] of byDay) {
    const record = readDayRecord(stored[key]);
    let changed = false;
    for (const a of list) changed = addAttribution(record, a) || changed;
    if (changed) out[key] = record;
  }
  const written = Object.keys(out).length;
  if (written > 0) await store.set(out);
  return { written, skipped };
}

/** The record for one day ('YYYY-MM-DD' or 'd:YYYY-MM-DD'), empty when nothing is stored. */
export async function loadDay(store: KeyValueStore, day: string): Promise<DayRecord> {
  const key = toDayKey(day);
  return readDayRecord((await store.get([key]))[key]);
}

/** Every stored day, keyed 'd:YYYY-MM-DD' like the aggregation expects. */
export async function loadAllDays(store: KeyValueStore): Promise<Record<string, DayRecord>> {
  const keys = (await store.keys()).filter(isDayKey);
  const out = nullRecord<DayRecord>();
  if (keys.length === 0) return out;
  const stored = await store.get(keys);
  for (const key of keys) out[key] = readDayRecord(stored[key]);
  return out;
}

/** Counts one redirect for `site` on `day`; RangeError for an unknown site or a bad day. */
export async function incrementBlocked(store: KeyValueStore, day: string, site: BlockedSite): Promise<void> {
  if (!(BLOCKED_SITES as readonly string[]).includes(site)) throw new RangeError(`Not a blocked site: ${String(site)}`);
  const key = toDayKey(day);
  const record = readDayRecord((await store.get([key]))[key]);
  record.blocked[site] += 1;
  await store.set({ [key]: record });
}
