/**
 * Export and import (R12). Export is the day keys and settings, never the event log or hot state.
 * Import merges by taking the larger value everywhere, so importing a file twice changes nothing,
 * and commits every changed key in one write so a failure leaves the store as it was.
 */
import { BLOCKED_SITES, DAY_KEY_PREFIX, EXPORT_FORMAT, SETTINGS_KEY } from './schema.ts';
import type { DayRecord, ExportFile, SiteRecord } from './schema.ts';
import type { KeyValueStore, StoredRecord } from './adapter.ts';
import { MAX_HOUR_SECONDS, freshDayRecord, loadAllDays, readDayRecord } from './days.ts';
import { loadSettings } from '../shared/settings.ts';
import { MAX_BLOCKED, MAX_SITES_PER_DAY, MAX_VISITS, parseImport } from './import.ts';
import type { ImportRejection, ParsedImportOk } from './import.ts';
import { nullRecord } from './validate.ts';

export { MAX_BLOCKED, MAX_IMPORT_BYTES, MAX_IMPORT_DAYS, MAX_SITES_PER_DAY, MAX_VISITS, parseImport } from './import.ts';
export type { ImportErrorCode, ImportRejection, ParsedImport, ParsedImportOk } from './import.ts';

export interface ImportApplied {
  readonly daysWritten: number;
  readonly settingsWritten: boolean;
}

export type ImportOutcome = ({ readonly ok: true; readonly skipped: number } & ImportApplied) | ImportRejection;

function siteTotal(site: SiteRecord): number {
  return Object.values(site.h).reduce((sum, seconds) => sum + seconds, 0);
}

/** A stored day in the strict import shape: whole seconds, capped counts, at most 500 sites (largest kept). */
function exportDay(record: DayRecord): DayRecord {
  const out = freshDayRecord();
  const sites = Object.entries(record.sites)
    .sort(([, a], [, b]) => siteTotal(b) - siteTotal(a))
    .slice(0, MAX_SITES_PER_DAY);
  for (const [site, data] of sites) {
    const h = nullRecord<number>();
    for (const [hour, seconds] of Object.entries(data.h)) h[hour] = Math.min(MAX_HOUR_SECONDS, Math.round(seconds));
    out.sites[site] = { h, v: Math.min(MAX_VISITS, data.v) };
  }
  for (const name of BLOCKED_SITES) out.blocked[name] = Math.min(MAX_BLOCKED, record.blocked[name]);
  return out;
}

/** Everything a person would want to keep, shaped so it always passes its own import. */
export async function exportAll(store: KeyValueStore, now: Date): Promise<ExportFile> {
  const stored = await loadAllDays(store);
  const days = nullRecord<DayRecord>();
  for (const key of Object.keys(stored).sort()) {
    const record = stored[key];
    if (record) days[key.slice(DAY_KEY_PREFIX.length)] = exportDay(record);
  }
  return { format: EXPORT_FORMAT, version: 1, exportedAt: now.toISOString(), days, settings: await loadSettings(store) };
}

/** Folds `incoming` into `record` (a fresh copy owned by the caller) by maximum; true when anything grew. */
function mergeDay(record: DayRecord, incoming: DayRecord): boolean {
  let changed = false;
  for (const [site, data] of Object.entries(incoming.sites)) {
    let current = record.sites[site];
    if (!current) {
      current = { h: nullRecord<number>(), v: 0 };
      record.sites[site] = current;
      changed = true;
    }
    for (const [hour, seconds] of Object.entries(data.h)) {
      const before = current.h[hour];
      if (before === undefined || seconds > before) {
        current.h[hour] = seconds;
        changed = true;
      }
    }
    if (data.v > current.v) {
      current.v = data.v;
      changed = true;
    }
  }
  for (const name of BLOCKED_SITES) {
    if (incoming.blocked[name] > record.blocked[name]) {
      record.blocked[name] = incoming.blocked[name];
      changed = true;
    }
  }
  return changed;
}

/**
 * Merges a parsed file into the store: per day, site and hour the larger value wins, visits and
 * redirect counts too. Imported settings replace the stored ones except `paused`, which keeps its
 * current value. The whole result is computed first and written with a single set().
 */
export async function applyImport(store: KeyValueStore, parsed: ParsedImportOk): Promise<ImportApplied> {
  const dates = Object.keys(parsed.days);
  const keys = dates.map((date) => DAY_KEY_PREFIX + date);
  const stored = keys.length > 0 ? await store.get(keys) : {};
  const out: StoredRecord = {};
  let daysWritten = 0;
  for (const date of dates) {
    const incoming = parsed.days[date];
    const key = DAY_KEY_PREFIX + date;
    const record = readDayRecord(stored[key]);
    if (incoming && mergeDay(record, incoming)) {
      out[key] = record;
      daysWritten += 1;
    }
  }
  if (parsed.settings) {
    const current = await loadSettings(store);
    out[SETTINGS_KEY] = { ...parsed.settings, paused: current.paused };
  }
  if (Object.keys(out).length > 0) await store.set(out);
  return { daysWritten, settingsWritten: parsed.settings !== null };
}

/** Parse then apply; a rejected file never touches the store. */
export async function importText(store: KeyValueStore, text: unknown, today: Date): Promise<ImportOutcome> {
  const parsed = parseImport(text, today);
  if (!parsed.ok) return parsed;
  const applied = await applyImport(store, parsed);
  return { ok: true, skipped: parsed.skipped, ...applied };
}
