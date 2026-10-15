/**
 * A `seed` event read from the live browser (KTD7): the last-focused window if it has focus, its
 * active tab and that tab's site, and the idle state at the configured threshold. Used on startup,
 * on install, when the hot state is missing, and whenever the engine asks for it (`needsReseed`).
 */
import type { Settings } from '../store/schema.ts';
import type { EngineEvent, IdleState, SeedEvent } from '../tracker/types.ts';
import { activateEvent, siteOfTab, urlEvent, type Grouping, type TabLike } from './events.ts';

/** The fields of a `chrome.windows.Window` read with `populate: true`. */
export interface WindowLike {
  readonly id?: number | undefined;
  readonly focused: boolean;
  readonly incognito: boolean;
  readonly tabs?: readonly (TabLike & { readonly active: boolean })[] | undefined;
}

const NOTHING_FOCUSED = { windowId: null, tabId: null, site: null } as const;

/** Pure: the seed for a window snapshot (null = Chrome has no window) and an idle state. */
export function seedEvent(win: WindowLike | null, idle: IdleState, grouping: Grouping, at: number): SeedEvent {
  if (win === null || win.id === undefined || !win.focused || win.incognito) return { type: 'seed', at, idle, ...NOTHING_FOCUSED };
  const tab = win.tabs?.find((t) => t.active);
  if (tab?.id === undefined) return { type: 'seed', at, idle, windowId: win.id, tabId: null, site: null };
  const seed: SeedEvent = { type: 'seed', at, idle, windowId: win.id, tabId: tab.id, site: siteOfTab(tab, grouping) };
  return tab.audible === undefined ? seed : { ...seed, audible: tab.audible };
}

async function lastFocusedWindow(): Promise<WindowLike | null> {
  try {
    return await chrome.windows.getLastFocused({ populate: true });
  } catch {
    // Chrome throws when it has no window at all (all closed, the browser still running): nothing is focused.
    return null;
  }
}

/** Reads the live browser and returns the seed for `at`. */
export async function readSeed(at: number, settings: Settings): Promise<SeedEvent> {
  const [win, idle] = await Promise.all([lastFocusedWindow(), chrome.idle.queryState(settings.idleThresholdSec)]);
  return seedEvent(win, idle, settings, at);
}

/**
 * `url` and `activate` events for the active tab of every window, or of one window, read from the live
 * browser: the engine learns tabs it never saw (open before install, or a window it was seeded without).
 */
export async function activeTabEvents(windowId: number | null, grouping: Grouping, at: number): Promise<EngineEvent[]> {
  const tabs = await chrome.tabs.query(windowId === null ? { active: true } : { active: true, windowId });
  return tabs.flatMap((tab) =>
    tab.id === undefined ? [] : [urlEvent({ ...tab, id: tab.id }, grouping, at), activateEvent({ tabId: tab.id, windowId: tab.windowId }, at)],
  );
}
