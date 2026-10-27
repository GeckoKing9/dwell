import { addAttributions, splitByLocalHour } from './buckets.ts';
import { applyEvent } from './inputs.ts';
import { own } from './records.ts';
import type {
  Attribution,
  Buckets,
  EngineEvent,
  EngineState,
  MediaState,
  ReduceResult,
  SiteMemory,
  TrackerSettings,
} from './types.ts';

/** A tab keeps counting as playing for this long after its media stops (gaps between songs). */
export const MEDIA_HOLD_MS = 30_000;
/**
 * How long one input to a page without focus outranks an active focused window: two of the content
 * script's 10 s pings, so continuous scrolling keeps it and a stray wheel tick costs at most this.
 */
export const ATTENTION_LEAD_MS = 20_000;
/** Site memory (visit clock and carry) is dropped this long after the site was last counted. */
export const SITE_MEMORY_MS = 86_400_000;
/** Outside the range of `Date`; such a timestamp cannot be bucketed. */
const MAX_TIME_MS = 8.64e15;

export const DEFAULT_TRACKER_SETTINGS: TrackerSettings = {
  idleThresholdSec: 60,
  mediaOverride: true,
  heartbeatSec: 60,
  gapMultiplier: 3,
  visitGapSec: 60,
};

export function createInitialState(now: number): EngineState {
  return {
    v: 1,
    lastAt: now,
    focusedWindow: null,
    activeTabs: {},
    tabs: {},
    idle: 'active',
    paused: false,
    sites: {},
    needsReseed: false,
  };
}

interface Presence {
  site: string;
  /** The instant counting stops by itself (a hold or the attention running out), or Infinity. */
  until: number;
}

function tabSite(state: EngineState, tabId: number | undefined): string | null {
  return tabId === undefined ? null : (own(state.tabs, String(tabId))?.site ?? null);
}

/** Until when a tab's media counts as playing: forever while on, the hold after a stop, else never. */
function playingUntil(media: MediaState): number {
  if (media.on) return Infinity;
  return media.offAt === undefined ? -Infinity : media.offAt + MEDIA_HOLD_MS;
}

/** The page that last took input outside Chrome's focus, for `lastsMs` after that input (the lead at most once capped). */
function attended(state: EngineState, lastsMs: number): Presence | null {
  const held = state.attention;
  const site = tabSite(state, held?.tabId);
  if (held === undefined || site === null) return null;
  return { site, until: held.at + (held.capped ? Math.min(lastsMs, ATTENTION_LEAD_MS) : lastsMs) };
}

/** KTD2: the focused window's active tab, while the user is active or its media plays. */
function focused(state: EngineState, settings: TrackerSettings): Presence | null {
  if (state.focusedWindow === null) return null;
  const tabId = own(state.activeTabs, String(state.focusedWindow));
  const site = tabSite(state, tabId);
  if (site === null) return null;
  if (state.idle === 'active') return { site, until: Infinity };
  const media = settings.mediaOverride && tabId !== undefined ? own(state.tabs, String(tabId))?.media : undefined;
  return media ? { site, until: playingUntil(media) } : null;
}

/**
 * A window's active tab playing with sound on screen, first by window id when there are several. Its
 * content script says `watched` only for a visible page or picture-in-picture; requiring the active tab
 * as well means a page that can no longer report (crashed, cut off) stops counting at the next tab switch.
 */
function watched(state: EngineState, settings: TrackerSettings, at: number): Presence | null {
  if (!settings.mediaOverride) return null;
  for (const tabId of Object.values(state.activeTabs)) {
    const tab = own(state.tabs, String(tabId));
    if (tab === undefined || tab.site === null || tab.media?.src !== 'msg' || tab.media.watched !== true) continue;
    const until = playingUntil(tab.media);
    if (at < until) return { site: tab.site, until };
  }
  return null;
}

/**
 * The presence predicate at instant `at`, ranked (ADR-6): the page holding attention for
 * ATTENTION_LEAD_MS after its input; the focused window's active tab (KTD2); that page again for the
 * rest of the idle threshold; a watched tab. Locked and paused always win. Each answer lasts until
 * `until`; past it, the next rank may answer, so one interval can be split between sites.
 */
function presence(state: EngineState, settings: TrackerSettings, at: number): Presence | null {
  if (state.paused || state.idle === 'locked') return null;
  const idleMs = settings.idleThresholdSec * 1000;
  const ranked = [attended(state, Math.min(ATTENTION_LEAD_MS, idleMs)), focused(state, settings), attended(state, idleMs)];
  for (const candidate of ranked) {
    if (candidate !== null && at < candidate.until) return candidate;
  }
  return watched(state, settings, at);
}

/** The site being counted at `at` (default: the last event), for the popup and the worker. */
export function currentSite(state: EngineState, settings: TrackerSettings, at: number = state.lastAt): string | null {
  return presence(state, settings, at)?.site ?? null;
}

/** Splits a counted range into hour attributions, deciding the visit and carrying sub-second ms. */
function attribute(
  sites: Record<string, SiteMemory>,
  site: string,
  from: number,
  to: number,
  settings: TrackerSettings,
): { attributions: Attribution[]; sites: Record<string, SiteMemory> } {
  const memory = own(sites, site);
  const visit = memory === undefined || from - memory.at >= settings.visitGapSec * 1000;
  let carry = memory?.carryMs ?? 0;
  const attributions: Attribution[] = [];
  splitByLocalHour(from, to).forEach((piece, index) => {
    const ms = piece.end - piece.start + carry;
    const seconds = Math.floor(ms / 1000);
    carry = ms - seconds * 1000;
    const base = { site, day: piece.day, hour: piece.hour, seconds };
    if (index === 0 && visit) attributions.push({ ...base, visit: true });
    else if (seconds > 0) attributions.push(base);
  });
  return { attributions, sites: { ...sites, [site]: { at: to, carryMs: carry } } };
}

function prune(sites: Record<string, SiteMemory>, now: number): Record<string, SiteMemory> {
  const stale = (memory: SiteMemory) => now - memory.at > SITE_MEMORY_MS;
  if (!Object.values(sites).some(stale)) return sites;
  return Object.fromEntries(Object.entries(sites).filter(([, memory]) => !stale(memory)));
}

/**
 * Closes the interval [state.lastAt, at) against the state before the event (never lookahead).
 * A jump of more than `gapMultiplier` heartbeats either way is a discontinuity (sleep, a dead
 * worker, a clock change): forward it attributes at most one heartbeat (R4), backward nothing,
 * and both resynchronise the clock and ask for a reseed. A shorter forward step is counted in
 * full, so a heartbeat Chrome delayed loses nothing. A smaller backward step is delivery jitter:
 * zero seconds and the clock stays where it was.
 */
function closeInterval(state: EngineState, at: number, settings: TrackerSettings): EngineState & { attributions: Attribution[] } {
  const from = state.lastAt;
  const gapMs = settings.gapMultiplier * settings.heartbeatSec * 1000;
  if (at <= from) {
    const jumped = from - at > gapMs;
    return { ...state, lastAt: jumped ? at : from, needsReseed: state.needsReseed || jumped, attributions: [] };
  }
  const gap = at - from > gapMs;
  const end = gap ? from + settings.heartbeatSec * 1000 : at;
  // Presence only ever runs out between events, never starts: walk the ranked answers until none is left.
  let sites = state.sites;
  const attributions: Attribution[] = [];
  let t = from;
  let now = presence(state, settings, t);
  while (now !== null && t < end) {
    const until = Math.min(end, now.until);
    const counted = attribute(sites, now.site, t, until, settings);
    sites = counted.sites;
    attributions.push(...counted.attributions);
    t = until;
    now = presence(state, settings, t);
  }
  return { ...state, lastAt: at, needsReseed: state.needsReseed || gap, sites, attributions };
}

/**
 * The counting rule as a pure reducer (KTD1): attributes the time since the previous event to
 * the site counted before this event, then applies the event. All time comes from `event.at`.
 */
export function reduce(state: EngineState, event: EngineEvent, settings: TrackerSettings): ReduceResult {
  if (!Number.isFinite(event.at) || Math.abs(event.at) > MAX_TIME_MS) return { state, attributions: [] };
  const { attributions, ...closed } = closeInterval(state, event.at, settings);
  const next = applyEvent({ ...closed, sites: prune(closed.sites, closed.lastAt) }, event);
  return { state: next, attributions };
}

/** Folds `events` from `state` (default: a fresh state at the first event) into day buckets. */
export function replay(
  events: readonly EngineEvent[],
  settings: TrackerSettings,
  state?: EngineState,
): { buckets: Buckets; state: EngineState } {
  let current = state ?? createInitialState(events[0]?.at ?? 0);
  let buckets: Buckets = {};
  for (const event of events) {
    const result = reduce(current, event, settings);
    current = result.state;
    buckets = addAttributions(buckets, result.attributions);
  }
  return { buckets, state: current };
}
