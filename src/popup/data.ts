/**
 * Everything the popup knows, loaded through injected dependencies so it runs against a fake Chrome in
 * tests: settings, today and the 7 days before it, and the site in the tab being inspected. The view
 * model is a pure function of that snapshot.
 */
import { siteOf } from '../tracker/grouping.ts';
import { siteForHost } from '../blocker/patterns.ts';
import { dayAggregate } from '../stats/aggregate.ts';
import type { SiteDay, SiteTime } from '../stats/aggregate.ts';
import { addDays } from '../stats/weeks.ts';
import { loadDay } from '../store/days.ts';
import { dateString, emptyDayRecord } from '../store/schema.ts';
import type { BlockedSite, DayRecord, Settings } from '../store/schema.ts';
import type { KeyValueStore } from '../store/adapter.ts';
import { loadSettings } from '../shared/settings.ts';
import type { PauseMessage, SettingsMessage } from '../shared/messages.ts';

export const HISTORY_DAYS = 7;
const TOP_SITES = 3;

export type BlockerKey = 'instagramReels' | 'youtubeShorts' | 'facebookReels';
export type BlockerKind = 'reels' | 'shorts';

const BLOCKERS: Readonly<Record<BlockedSite, { key: BlockerKey; kind: BlockerKind }>> = {
  instagram: { key: 'instagramReels', kind: 'reels' },
  youtube: { key: 'youtubeShorts', kind: 'shorts' },
  facebook: { key: 'facebookReels', kind: 'reels' },
};

/** Chrome's new tab page in its several spellings; anything else non-web is a "browser page". */
const NEW_TAB = /^(?:chrome:\/\/(?:newtab|new-tab-page)\/?|chrome-search:\/\/local-ntp|about:blank|about:newtab)/;

export interface TabLike {
  id?: number | undefined;
  url?: string | undefined;
  lastAccessed?: number | undefined;
}

export interface TabsApi {
  /** The tab this page runs in; undefined in the toolbar popup. */
  getCurrent(): Promise<TabLike | undefined>;
  query(query: { active?: boolean; lastFocusedWindow?: boolean }): Promise<TabLike[]>;
}

export interface PopupDeps {
  store: KeyValueStore;
  tabs: TabsApi;
  send(message: PauseMessage | SettingsMessage): Promise<unknown>;
  openDashboard(): Promise<void>;
  /** Calls `listener` when a stored key the popup shows changes; returns the unsubscribe function. */
  onChange(listener: () => void): () => void;
  now(): Date;
}

export interface PopupData {
  settings: Settings;
  today: DayRecord;
  /** The 7 days before today, oldest first. */
  previous: DayRecord[];
  now: Date;
  /** URL of the inspected tab, or null when there is none. */
  url: string | null;
}

/** Local dates read on open: today first, then the 7 days before it, newest first. */
export function popupDays(now: Date): string[] {
  return Array.from({ length: HISTORY_DAYS + 1 }, (_, k) => dateString(addDays(now, -k)));
}

/** The most recently active tab other than `ownId`. */
export function mostRecentOther(tabs: readonly TabLike[], ownId: number | undefined): TabLike | undefined {
  let best: TabLike | undefined;
  for (const tab of tabs) {
    if (tab.id === ownId) continue;
    if (!best || (tab.lastAccessed ?? 0) > (best.lastAccessed ?? 0)) best = tab;
  }
  return best;
}

/**
 * The tab the popup describes. From the toolbar: the active tab of the last focused window. When the
 * popup page is itself open in a tab, that tab would describe only itself, so it describes the tab the
 * person was on before it instead.
 */
export async function inspectedTab(tabs: TabsApi): Promise<TabLike | undefined> {
  const own = await tabs.getCurrent();
  if (own === undefined) return (await tabs.query({ active: true, lastFocusedWindow: true }))[0];
  return mostRecentOther(await tabs.query({}), own.id);
}

export async function loadPopupData(deps: PopupDeps): Promise<PopupData> {
  const now = deps.now();
  const [settings, tab, records] = await Promise.all([
    loadSettings(deps.store),
    inspectedTab(deps.tabs),
    Promise.all(popupDays(now).map((day) => loadDay(deps.store, day))),
  ]);
  const [today = emptyDayRecord(), ...before] = records;
  return { settings, today, previous: before.reverse(), now, url: tab?.url ?? null };
}

export { isRelevantChange } from '../shared/storageChanges.ts';

export interface UsualStats {
  /** Previous days with any data, 0 to 7. */
  recorded: number;
  /** Mean daily total over the recorded days. */
  average: number;
  /** Mean time recorded by this hour and minute over the recorded days. */
  byNow: number;
}

/** "Usually X by this time of day": the recorded previous days, each summed up to the current minute. */
export function usualStats(previous: readonly DayRecord[], now: Date): UsualStats {
  const hour = now.getHours();
  const partial = now.getMinutes() / 60;
  let recorded = 0;
  let total = 0;
  let byNow = 0;
  for (const record of previous) {
    const agg = dayAggregate(record);
    if (agg.total <= 0) continue;
    recorded++;
    total += agg.total;
    for (let x = 0; x < hour; x++) byNow += agg.hours[x] ?? 0;
    byNow += (agg.hours[hour] ?? 0) * partial;
  }
  return { recorded, average: recorded ? total / recorded : 0, byNow: recorded ? byNow / recorded : 0 };
}

export interface BlockerModel {
  key: BlockerKey;
  kind: BlockerKind;
  on: boolean;
}

export type Tracking =
  | { kind: 'site'; site: string; seconds: number; visits: number }
  | { kind: 'ignored'; site: string }
  | { kind: 'newtab' }
  | { kind: 'browser' };

export interface ThisSiteModel {
  tracking: Tracking;
  blocker: BlockerModel | null;
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** What the "This site" card shows for a URL; the blocker row follows the hostname, tracked or not. */
export function thisSite(url: string | null, settings: Settings, today: DayRecord): ThisSiteModel {
  const host = url === null ? null : hostnameOf(url);
  const blocked = host === null ? null : siteForHost(host);
  const spec = blocked === null ? null : BLOCKERS[blocked];
  const blocker = spec === null ? null : { ...spec, on: settings.blockers[spec.key] };
  if (url === null || url === '' || NEW_TAB.test(url)) return { tracking: { kind: 'newtab' }, blocker };
  const site = siteOf(url, settings.overrides, settings.ignore);
  if (site === null) {
    const unfiltered = siteOf(url, settings.overrides, []);
    return { tracking: unfiltered === null ? { kind: 'browser' } : { kind: 'ignored', site: unfiltered }, blocker };
  }
  const record = today.sites[site];
  const seconds = record ? Object.values(record.h).reduce((sum, s) => sum + s, 0) : 0;
  return { tracking: { kind: 'site', site, seconds, visits: record?.v ?? 0 }, blocker };
}

export type PopupState = 'normal' | 'first' | 'paused' | 'untrackable' | 'noblocker';

export interface WeekDay {
  date: Date;
  total: number;
  isToday: boolean;
  top: SiteTime[];
}

export interface PopupModel {
  state: PopupState;
  paused: boolean;
  firstRun: boolean;
  now: Date;
  total: number;
  usual: UsualStats;
  /** Today and the 6 days before it, oldest first. */
  week: WeekDay[];
  top: SiteDay[];
  site: ThisSiteModel;
}

/** The primary state for `data-state`; paused, first run and the card variant can coexist on screen. */
export function popupState(paused: boolean, firstRun: boolean, site: ThisSiteModel): PopupState {
  if (paused) return 'paused';
  if (firstRun) return 'first';
  if (site.tracking.kind !== 'site') return 'untrackable';
  return site.blocker === null ? 'noblocker' : 'normal';
}

export function buildModel(data: PopupData): PopupModel {
  const today = dayAggregate(data.today);
  const previous = data.previous.map(dayAggregate);
  const firstRun = today.total <= 0 && previous.every((a) => a.total <= 0);
  const paused = data.settings.paused;
  const site = thisSite(data.url, data.settings, data.today);
  const last = [...previous.slice(-(HISTORY_DAYS - 1)), today];
  const week = last.map((agg, k) => ({
    date: addDays(data.now, k - (last.length - 1)),
    total: agg.total,
    isToday: k === last.length - 1,
    top: agg.sites.slice(0, TOP_SITES).map(({ site: s, seconds }) => ({ site: s, seconds })),
  }));
  return {
    state: popupState(paused, firstRun, site),
    paused,
    firstRun,
    now: data.now,
    total: today.total,
    usual: usualStats(data.previous, data.now),
    week,
    top: today.sites.slice(0, TOP_SITES),
    site,
  };
}

/** Pending one-tap changes shown before the worker confirms them. */
export interface Pending {
  paused?: boolean;
  blockers?: Partial<Record<BlockerKey, boolean>>;
}

/** Settings as the person last set them: stored values with any unconfirmed tap on top. */
export function withPending(settings: Settings, pending: Pending): Settings {
  return {
    ...settings,
    paused: pending.paused ?? settings.paused,
    blockers: { ...settings.blockers, ...pending.blockers },
  };
}

/** Adds a tap to the pending changes; a later tap on the same control replaces an earlier one. */
export function addPending(pending: Pending, change: Pending): Pending {
  const next: Pending = { ...pending, blockers: { ...pending.blockers, ...change.blockers } };
  if (change.paused !== undefined) next.paused = change.paused;
  return next;
}

/** Drops a settled tap, unless a newer tap on the same control has replaced it since. */
export function settlePending(pending: Pending, change: Pending): Pending {
  const blockers = { ...pending.blockers };
  for (const [key, value] of Object.entries(change.blockers ?? {})) {
    if (blockers[key as BlockerKey] === value) delete blockers[key as BlockerKey];
  }
  const next: Pending = { blockers };
  if (pending.paused !== undefined && pending.paused !== change.paused) next.paused = pending.paused;
  return next;
}
