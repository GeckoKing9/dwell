/**
 * What the dashboard reads, through injected dependencies so it runs against a memory store in tests:
 * every day key and the settings. Writes never happen here; they go to the worker as messages.
 */
import { loadAllDays, readDayRecord } from '../store/days.ts';
import { isDayKey, SETTINGS_KEY } from '../store/schema.ts';
import { isPlainObject } from '../store/validate.ts';
import type { DayRecord, Settings } from '../store/schema.ts';
import type { KeyValueStore } from '../store/adapter.ts';
import { loadSettings, validateSettings } from '../shared/settings.ts';
import type { StorageChanges } from '../shared/storageChanges.ts';
import type { PageMessage, SettingsPatch } from '../shared/messages.ts';
import { navigableWeeks } from '../stats/weeks.ts';
import type { WeekRange } from '../stats/weeks.ts';

export interface DashboardDeps {
  store: KeyValueStore;
  send(message: PageMessage): Promise<unknown>;
  /** Calls `listener` with the changed keys when a stored key the dashboard shows changes; returns the unsubscribe function. */
  onChange(listener: (changes: StorageChanges) => void): () => void;
  now(): Date;
  /** Saves `text` as a local file the person downloads; never a network request. */
  download(filename: string, text: string): void;
}

/** The page's DOM seams, wired in main.tsx: the location hash, file reading, element sizes, scrolling and keys. */
export interface PageDeps extends DashboardDeps {
  hash: { get(): string; set(hash: string): void; onChange(listener: () => void): () => void };
  readFile(file: File): Promise<string>;
  observeWidth(element: HTMLElement, listener: (width: number) => void): () => void;
  scrollTo(id: string): void;
  /** Scrolls the page to the top, for a move between the week and the day view. */
  scrollTop(): void;
  /** Calls `listener` for each key pressed on the page; returns the unsubscribe function. */
  onKeyDown(listener: (event: KeyboardEvent) => void): () => void;
}

export interface DashboardData {
  days: Record<string, DayRecord>;
  settings: Settings;
  now: Date;
}

export async function loadDashboardData(deps: Pick<DashboardDeps, 'store' | 'now'>): Promise<DashboardData> {
  const [days, settings] = await Promise.all([loadAllDays(deps.store), loadSettings(deps.store)]);
  return { days, settings, now: deps.now() };
}

/**
 * The data after applying a storage change in memory, or null when a full reload is needed: a key was
 * removed, or a value does not read as a day record or valid settings. Untouched days keep their identity.
 */
export function applyChanges(data: DashboardData, changes: StorageChanges, now: Date): DashboardData | null {
  let days = data.days;
  let settings = data.settings;
  for (const [key, change] of Object.entries(changes)) {
    if (key === SETTINGS_KEY) {
      const result = validateSettings(change.newValue);
      if (change.newValue === undefined || !result.ok) return null;
      settings = result.value;
    } else if (isDayKey(key)) {
      if (!isPlainObject(change.newValue)) return null;
      days = { ...days, [key]: readDayRecord(change.newValue) };
    }
  }
  return { days, settings, now };
}

/** Every Monday-start week the stored days touch, oldest first, ending with the current week. */
export function weeksOf(data: DashboardData): WeekRange[] {
  return navigableWeeks(Object.keys(data.days), data.now);
}

/** Settings values shown before the worker confirms them; each key holds the full value it will have. */
export type Pending = Partial<Settings>;

export function withPending(settings: Settings, pending: Pending): Settings {
  return { ...settings, ...pending };
}

/** The full values a patch leaves on screen: a partial blockers patch merges over the current switches. */
export function shownFor(settings: Settings, patch: SettingsPatch): Pending {
  const { blockers, ...rest } = patch;
  return blockers ? { ...rest, blockers: { ...settings.blockers, ...blockers } } : { ...rest };
}

/** Drops the keys a settled change set, unless a newer change to the same key has replaced it since. */
export function settlePending(pending: Pending, settled: Pending): Pending {
  const next: Record<string, unknown> = { ...pending };
  for (const [key, value] of Object.entries(settled)) {
    if (next[key] === value) delete next[key];
  }
  return next as Pending;
}

/** The failure reason in a worker reply, or null when the reply is a success. */
export function replyFailure(reply: unknown): string | null {
  if (typeof reply !== 'object' || reply === null) return 'No reply from the background worker.';
  const r = reply as { ok?: unknown; reason?: unknown };
  if (r.ok === true) return null;
  return typeof r.reason === 'string' ? r.reason : 'The background worker refused the change.';
}

/** Every site seen in the stored days or named in the category map, sorted, for the category editor. */
export function knownSites(data: DashboardData): string[] {
  const sites = new Set<string>(Object.keys(data.settings.categories));
  for (const record of Object.values(data.days)) {
    for (const site of Object.keys(record.sites)) sites.add(site);
  }
  return [...sites].sort();
}
