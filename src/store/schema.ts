/** KTD3 record types and storage key helpers. Pure: no Chrome APIs. */

export type Site = string;
export type HourString = string; // '0'..'23'
export type Seconds = number;
export type Visits = number;

export type Category = 'Social' | 'Video' | 'Work' | 'Shopping' | 'News' | 'Other';
export const CATEGORIES: readonly Category[] = ['Social', 'Video', 'Work', 'Shopping', 'News', 'Other'];

export type BlockedSite = 'instagram' | 'youtube' | 'facebook';
export const BLOCKED_SITES: readonly BlockedSite[] = ['instagram', 'youtube', 'facebook'];

export interface SiteRecord {
  h: Record<HourString, Seconds>;
  v: Visits;
}

export interface DayRecord {
  sites: Record<Site, SiteRecord>;
  blocked: Record<BlockedSite, number>;
}

export interface Settings {
  idleThresholdSec: 30 | 60 | 120 | 300;
  mediaOverride: boolean;
  paused: boolean;
  blockers: {
    instagramReels: boolean;
    youtubeShorts: boolean;
    facebookReels: boolean;
    instagramExplore: boolean;
  };
  /** Hosts counted separately from their registrable domain. */
  overrides: string[];
  ignore: string[];
  /** The user's edits on top of the built-in map in `stats/categories.ts`. */
  categories: Record<Site, Category>;
  eventLog: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  idleThresholdSec: 60,
  mediaOverride: true,
  paused: false,
  blockers: { instagramReels: true, youtubeShorts: true, facebookReels: true, instagramExplore: false },
  overrides: [],
  ignore: [],
  categories: {},
  eventLog: false,
};

export const SETTINGS_KEY = 'settings';
export const DAY_KEY_PREFIX = 'd:';
export const EXPORT_FORMAT = 'dwell-export';

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: 1;
  exportedAt: string;
  /** Keyed by bare 'YYYY-MM-DD'. */
  days: Record<string, DayRecord>;
  settings: Settings;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** 'YYYY-MM-DD' in local time. */
export function dateString(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}

/** Storage key for the local day of `date`: 'd:YYYY-MM-DD'. */
export function dayKey(date: Date): string {
  return DAY_KEY_PREFIX + dateString(date);
}

function parseDateString(s: string): Date | null {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/** True for 'd:YYYY-MM-DD' naming a real calendar date. */
export function isDayKey(key: string): boolean {
  return key.startsWith(DAY_KEY_PREFIX) && parseDateString(key.slice(DAY_KEY_PREFIX.length)) !== null;
}

/** Local midnight of a day key ('d:YYYY-MM-DD' or a bare 'YYYY-MM-DD'), or null when invalid. */
export function parseDayKey(key: string): Date | null {
  return parseDateString(key.startsWith(DAY_KEY_PREFIX) ? key.slice(DAY_KEY_PREFIX.length) : key);
}

export function emptyDayRecord(): DayRecord {
  return { sites: {}, blocked: { instagram: 0, youtube: 0, facebook: 0 } };
}
