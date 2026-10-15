/**
 * The hardened import parser (R12): untrusted text in, validated prototype-free day records out.
 * Any problem rejects the whole file with a specific reason; the one exception is a well-formed
 * day outside the 90-day window, which is skipped and counted.
 */
import { BLOCKED_SITES, DAY_KEY_PREFIX, EXPORT_FORMAT, isDayKey } from './schema.ts';
import type { BlockedSite, DayRecord, Settings, SiteRecord } from './schema.ts';
import { validateSettings } from '../shared/settings.ts';
import { MAX_HOUR_SECONDS, freshDayRecord, isHourKey } from './days.ts';
import { retentionWindow } from './prune.ts';
import { isForbiddenKey, isIntInRange, isPlainObject, isSiteId, keyProblem, nullRecord } from './validate.ts';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_DAYS = 400;
export const MAX_SITES_PER_DAY = 500;
export const MAX_VISITS = 100_000;
export const MAX_BLOCKED = 100_000;

export type ImportErrorCode =
  | 'not-text'
  | 'too-large'
  | 'bad-json'
  | 'bad-format'
  | 'bad-version'
  | 'bad-shape'
  | 'forbidden-key'
  | 'too-many-days'
  | 'bad-date'
  | 'too-many-sites'
  | 'bad-site'
  | 'bad-hour'
  | 'bad-seconds'
  | 'bad-visits'
  | 'bad-blocked'
  | 'bad-settings';

/** `code` is stable for i18n lookup; `reason` is a readable English sentence. */
export interface ImportRejection {
  readonly ok: false;
  readonly code: ImportErrorCode;
  readonly reason: string;
}

export interface ParsedImportOk {
  readonly ok: true;
  /** Keyed by bare 'YYYY-MM-DD', only dates inside the window. */
  readonly days: Record<string, DayRecord>;
  readonly settings: Settings | null;
  /** Well-formed days dropped because they fall outside the 90-day window. */
  readonly skipped: number;
}

export type ParsedImport = ParsedImportOk | ImportRejection;

const ROOT_KEYS: ReadonlySet<string> = new Set(['format', 'version', 'exportedAt', 'days', 'settings']);
const DAY_KEYS: ReadonlySet<string> = new Set(['sites', 'blocked']);
const SITE_KEYS: ReadonlySet<string> = new Set(['h', 'v']);
const BLOCKED_KEYS: ReadonlySet<string> = new Set(BLOCKED_SITES);

class Rejected extends Error {
  readonly code: ImportErrorCode;
  constructor(code: ImportErrorCode, reason: string) {
    super(reason);
    this.code = code;
  }
}

function reject(code: ImportErrorCode, reason: string): never {
  throw new Rejected(code, reason);
}

/** Echo of an untrusted key in a reason, cut short. */
function show(text: string): string {
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function checkKeys(obj: Record<string, unknown>, allowed: ReadonlySet<string>, where: string): void {
  const problem = keyProblem(obj, allowed, where);
  if (problem) reject(problem.forbidden ? 'forbidden-key' : 'bad-shape', problem.reason);
}

function checkForbidden(key: string, where: string): void {
  if (isForbiddenKey(key)) reject('forbidden-key', `${where} contains the forbidden key "${key}".`);
}

function parseSite(date: string, site: string, raw: unknown): SiteRecord {
  checkForbidden(site, `Day ${date}`);
  if (!isSiteId(site)) reject('bad-site', `Day ${date} lists "${show(site)}", which is not a site name like example.com.`);
  const where = `Site ${site} on ${date}`;
  if (!isPlainObject(raw)) reject('bad-shape', `${where} must be an object.`);
  checkKeys(raw, SITE_KEYS, where);
  const hours = raw['h'];
  if (!isPlainObject(hours)) reject('bad-shape', `${where} needs an "h" object of hours.`);
  const h = nullRecord<number>();
  for (const [hour, seconds] of Object.entries(hours)) {
    checkForbidden(hour, where);
    if (!isHourKey(hour)) reject('bad-hour', `${where} has the hour "${show(hour)}"; hours run from 0 to 23.`);
    if (!isIntInRange(seconds, 0, MAX_HOUR_SECONDS)) {
      reject('bad-seconds', `${where} at hour ${hour} must be a whole number of seconds from 0 to ${MAX_HOUR_SECONDS}.`);
    }
    h[hour] = seconds;
  }
  const v = raw['v'];
  if (!isIntInRange(v, 0, MAX_VISITS)) reject('bad-visits', `${where} needs visits as a whole number from 0 to ${MAX_VISITS}.`);
  return { h, v };
}

function parseBlocked(date: string, value: unknown, into: Record<BlockedSite, number>): void {
  if (!isPlainObject(value)) reject('bad-blocked', `Day ${date} must have "blocked" as an object.`);
  for (const [name, count] of Object.entries(value)) {
    checkForbidden(name, `Day ${date} blocked counts`);
    if (!BLOCKED_KEYS.has(name)) reject('bad-blocked', `Day ${date} counts redirects for "${show(name)}", which Dwell does not block.`);
    if (!isIntInRange(count, 0, MAX_BLOCKED)) reject('bad-blocked', `Day ${date} must count ${name} redirects as a whole number from 0 to ${MAX_BLOCKED}.`);
    into[name as BlockedSite] = count;
  }
}

function parseDay(date: string, value: unknown): DayRecord {
  checkForbidden(date, 'The days');
  if (!isDayKey(DAY_KEY_PREFIX + date)) reject('bad-date', `The day "${show(date)}" is not a real date written YYYY-MM-DD.`);
  if (!isPlainObject(value)) reject('bad-shape', `Day ${date} must be an object.`);
  checkKeys(value, DAY_KEYS, `Day ${date}`);
  const sites = value['sites'];
  if (!isPlainObject(sites)) reject('bad-shape', `Day ${date} needs a "sites" object.`);
  const entries = Object.entries(sites);
  if (entries.length > MAX_SITES_PER_DAY) reject('too-many-sites', `Day ${date} lists more than ${MAX_SITES_PER_DAY} sites.`);
  const record = freshDayRecord();
  for (const [site, raw] of entries) record.sites[site] = parseSite(date, site, raw);
  if (Object.hasOwn(value, 'blocked')) parseBlocked(date, value['blocked'], record.blocked);
  return record;
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function parseRoot(text: unknown): Record<string, unknown> {
  if (typeof text !== 'string') reject('not-text', 'The import must be the text of a Dwell export file.');
  if (text.length > MAX_IMPORT_BYTES || utf8Length(text) > MAX_IMPORT_BYTES) {
    reject('too-large', 'The file is larger than 2 MB, which is more than any Dwell export.');
  }
  let root: unknown = null;
  try {
    root = JSON.parse(text);
  } catch {
    reject('bad-json', 'The file is not valid JSON, so it cannot be a Dwell export.');
  }
  if (!isPlainObject(root)) reject('bad-shape', 'The file must hold a JSON object.');
  checkKeys(root, ROOT_KEYS, 'The file');
  if (root['format'] !== EXPORT_FORMAT) reject('bad-format', 'This is not a Dwell export file.');
  if (root['version'] !== 1) reject('bad-version', 'This export uses a file version this copy of Dwell cannot read.');
  if (Object.hasOwn(root, 'exportedAt') && typeof root['exportedAt'] !== 'string') {
    reject('bad-shape', 'The file\'s "exportedAt" must be text.');
  }
  return root;
}

function parse(text: unknown, today: Date): ParsedImportOk {
  const root = parseRoot(text);
  const days = root['days'];
  if (!isPlainObject(days)) reject('bad-shape', 'The file\'s "days" must be an object.');
  const entries = Object.entries(days);
  if (entries.length > MAX_IMPORT_DAYS) reject('too-many-days', `The file holds more than ${MAX_IMPORT_DAYS} days.`);

  const window = retentionWindow(today);
  const out = nullRecord<DayRecord>();
  let skipped = 0;
  for (const [date, value] of entries) {
    const record = parseDay(date, value);
    if (date < window.first || date > window.last) skipped += 1;
    else out[date] = record;
  }

  let settings: Settings | null = null;
  if (Object.hasOwn(root, 'settings')) {
    const result = validateSettings(root['settings']);
    if (!result.ok) reject('bad-settings', `The file's settings were refused: ${result.reason}`);
    settings = result.value;
  }
  return { ok: true, days: out, settings, skipped };
}

/**
 * Validates an export file's text. Caps: 2 MB, 400 days, 500 sites per day, 500 entries per settings
 * list. Keys must be real dates, hostnames, hours 0..23; values whole numbers in range; no prototype keys.
 */
export function parseImport(text: unknown, today: Date): ParsedImport {
  try {
    return parse(text, today);
  } catch (error) {
    if (error instanceof Rejected) return { ok: false, code: error.code, reason: error.message };
    throw error;
  }
}
