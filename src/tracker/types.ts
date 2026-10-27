export type IdleState = 'active' | 'idle' | 'locked';

export type IdleThresholdSec = 30 | 60 | 120 | 300;

/** `windowId: null` is Chrome's WINDOW_ID_NONE: no Chrome window has focus. */
export interface FocusEvent {
  type: 'focus';
  at: number;
  windowId: number | null;
}

export interface ActivateEvent {
  type: 'activate';
  at: number;
  windowId: number;
  tabId: number;
}

/**
 * The tab now shows `site` (already grouped; null = not trackable). `audible` is Chrome's
 * `tab.audible`; when omitted the previous value is kept. `nav` marks a navigation (a new URL, a
 * reload, a discarded tab loading again): the page whose content script reported media may be gone.
 */
export interface UrlEvent {
  type: 'url';
  at: number;
  tabId: number;
  site: string | null;
  audible?: boolean;
  nav?: true;
}

export interface IdleEvent {
  type: 'idle';
  at: number;
  state: IdleState;
}

/**
 * From the media content script: a level signal, sent when either level changes. `watched`: the
 * playback has sound and its page is on screen (visible, or in picture-in-picture), so it counts
 * even when its window has no focus. Absent in logs from before it existed: read as false.
 */
export interface MediaEvent {
  type: 'media';
  at: number;
  tabId: number;
  playing: boolean;
  /** Only with `playing`: a stop is never watched. */
  watched?: true;
}

/**
 * From a content script: the user gave the page input through the page itself, not through Chrome's
 * focus (hover-scrolling a window that does not have focus), or (`present: false`) the pointer left
 * the page or the page was hidden. A page that takes input is its window's active tab.
 */
export interface AttentionEvent {
  type: 'attention';
  at: number;
  tabId: number;
  windowId: number;
  present: boolean;
}

export interface PauseEvent {
  type: 'pause';
  at: number;
  paused: boolean;
}

/** The heartbeat alarm. It changes no input; it only closes the open interval. */
export interface TickEvent {
  type: 'tick';
  at: number;
}

/** The tab was closed; its state is dropped so the engine state stays bounded. */
export interface CloseEvent {
  type: 'close';
  at: number;
  tabId: number;
}

/**
 * A snapshot of the live browser (startup, or after `needsReseed`): the focused window, its
 * active tab and that tab's site, and the idle state. Clears `needsReseed`.
 */
export interface SeedEvent {
  type: 'seed';
  at: number;
  windowId: number | null;
  tabId: number | null;
  site: string | null;
  audible?: boolean;
  idle: IdleState;
}

export type EngineEvent =
  | FocusEvent
  | ActivateEvent
  | UrlEvent
  | IdleEvent
  | MediaEvent
  | AttentionEvent
  | PauseEvent
  | TickEvent
  | CloseEvent
  | SeedEvent;

export interface TrackerSettings {
  /**
   * The worker hands it to the idle detector, and the reducer trusts the idle events. The reducer
   * also uses it as the page's own idle threshold: attention lasts this long after the last input.
   */
  idleThresholdSec: IdleThresholdSec;
  mediaOverride: boolean;
  heartbeatSec: number;
  /**
   * Two events further apart than this many heartbeats are a discontinuity (sleep, a dead worker, a
   * clock change). Chrome delays alarms to 95 to 120 s under battery saver, so it sits well above 1.
   */
  gapMultiplier: number;
  visitGapSec: number;
}

/**
 * Playback state of one tab. `src` says which signal owns it: once the content script has
 * reported (`msg`), Chrome's `audible` flag is ignored for that tab. `offAt` is the instant
 * playback stopped; the tab still counts as playing for MEDIA_HOLD_MS after it.
 */
export interface MediaState {
  src: 'msg' | 'audible';
  on: boolean;
  offAt?: number;
  /** Content script only: the playback had sound on a page on screen; kept through the hold after a stop. */
  watched?: true;
}

export interface TabState {
  site: string | null;
  media?: MediaState;
}

/** `at`: end of the last counted interval for the site (visits). `carryMs`: sub-second remainder. */
export interface SiteMemory {
  at: number;
  carryMs: number;
}

/** The tab whose page last took the user's input outside Chrome's focus; `at` is that input. */
export interface Attention {
  tabId: number;
  windowId: number;
  at: number;
}

/** Plain JSON: it survives `JSON.stringify`/`JSON.parse` unchanged (restart equivalence). */
export interface EngineState {
  v: 1;
  lastAt: number;
  focusedWindow: number | null;
  /** windowId -> active tabId */
  activeTabs: Record<string, number>;
  /** tabId -> tab state, only for tabs seen and not closed */
  tabs: Record<string, TabState>;
  idle: IdleState;
  paused: boolean;
  /** site -> memory, pruned one day after the site was last counted */
  sites: Record<string, SiteMemory>;
  /** Set after a clock jump; the worker should answer with a `seed` event read from the live tabs. */
  needsReseed: boolean;
  /** Absent when no page holds attention; any focus, tab switch or seed clears it. */
  attention?: Attention;
}

export interface Attribution {
  site: string;
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
  /** Local hour, 0 to 23. */
  hour: number;
  seconds: number;
  visit?: boolean;
}

export interface ReduceResult {
  state: EngineState;
  attributions: Attribution[];
}

export interface SiteBucket {
  /** local hour ("0" to "23") -> seconds; sparse */
  h: Record<string, number>;
  /** visits */
  v: number;
}

/** day -> site -> bucket (the KTD3 day-key shape without `blocked`). */
export type Buckets = Record<string, Record<string, SiteBucket>>;
