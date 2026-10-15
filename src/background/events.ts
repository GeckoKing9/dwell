/**
 * Pure mapping from Chrome event payloads to engine events. The only thing kept from a URL is its
 * grouped site id (R9); incognito tabs map to a non-trackable site even though the manifest already
 * keeps the extension out of incognito (R8). `at` always comes from the queue.
 */
import { siteOf } from '../tracker/grouping.ts';
import type {
  ActivateEvent,
  CloseEvent,
  FocusEvent,
  IdleEvent,
  IdleState,
  MediaEvent,
  PauseEvent,
  TickEvent,
  UrlEvent,
} from '../tracker/types.ts';

/** The value of `chrome.windows.WINDOW_ID_NONE`: no Chrome window has focus. */
export const WINDOW_ID_NONE = -1;

/** The settings that decide what a URL is counted as. */
export interface Grouping {
  readonly overrides: readonly string[];
  readonly ignore: readonly string[];
}

/** The fields of `chrome.tabs.Tab` the worker reads. */
export interface TabLike {
  readonly id?: number | undefined;
  readonly url?: string | undefined;
  readonly incognito: boolean;
  readonly audible?: boolean | undefined;
}

/** The fields of `chrome.tabs.OnUpdatedInfo` the worker reacts to. */
export interface TabChange {
  readonly url?: string | undefined;
  readonly audible?: boolean | undefined;
  /** 'loading' when a new document starts loading: a navigation, a reload, a discarded tab coming back. */
  readonly status?: string | undefined;
}

/** The site a tab counts as, or null when it is incognito, not http(s), or ignored. */
export function siteOfTab(tab: TabLike, grouping: Grouping, url: string | undefined = tab.url): string | null {
  if (tab.incognito || url === undefined) return null;
  return siteOf(url, grouping.overrides, grouping.ignore);
}

function withAudible(event: Omit<UrlEvent, 'audible'>, audible: boolean | undefined): UrlEvent {
  return audible === undefined ? event : { ...event, audible };
}

/** The tab shows its current URL. `tab.id` is required; callers pass tabs that have one. */
export function urlEvent(tab: TabLike & { readonly id: number }, grouping: Grouping, at: number): UrlEvent {
  return withAudible({ type: 'url', at, tabId: tab.id, site: siteOfTab(tab, grouping) }, tab.audible);
}

/** A new URL or a page load: a navigation, after which the page that reported media may be gone. */
function isNavigation(change: TabChange): boolean {
  return change.url !== undefined || change.status === 'loading';
}

/**
 * True when a `tabs.onUpdated` change matters to tracking (the URL, a page load, the audible flag). Anything
 * else (a title, a favicon, a load completing) is dropped before it is queued, so it costs no storage work.
 */
export function isTrackedChange(change: TabChange): boolean {
  return isNavigation(change) || change.audible !== undefined;
}

/** `tabs.onUpdated`: the url event for a tracked change. Untracked ones are dropped before they are queued (`isTrackedChange`). */
export function updatedEvent(tabId: number, change: TabChange, tab: TabLike, grouping: Grouping, at: number): UrlEvent {
  const nav = isNavigation(change);
  const audible = change.audible ?? tab.audible;
  const event = withAudible({ type: 'url', at, tabId, site: siteOfTab(tab, grouping, change.url ?? tab.url) }, audible);
  return nav ? { ...event, nav: true } : event;
}

export function activateEvent(info: { readonly tabId: number; readonly windowId: number }, at: number): ActivateEvent {
  return { type: 'activate', at, windowId: info.windowId, tabId: info.tabId };
}

export function focusEvent(windowId: number, at: number): FocusEvent {
  return { type: 'focus', at, windowId: windowId === WINDOW_ID_NONE ? null : windowId };
}

export function idleEvent(state: IdleState, at: number): IdleEvent {
  return { type: 'idle', at, state };
}

export function closeEvent(tabId: number, at: number): CloseEvent {
  return { type: 'close', at, tabId };
}

export function tickEvent(at: number): TickEvent {
  return { type: 'tick', at };
}

export function pauseEvent(paused: boolean, at: number): PauseEvent {
  return { type: 'pause', at, paused };
}

export function mediaEvent(tabId: number, playing: boolean, at: number): MediaEvent {
  return { type: 'media', at, tabId, playing };
}
