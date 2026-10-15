import { addAttributions, splitByLocalHour } from './buckets.ts';
import { applyEvent } from './inputs.ts';
import { own } from './records.ts';
import type {
  Attribution,
  Buckets,
  EngineEvent,
  EngineState,
  ReduceResult,
  SiteMemory,
  TrackerSettings,
} from './types.ts';

/** A tab keeps counting as playing for this long after its media stops (gaps between songs). */
export const MEDIA_HOLD_MS = 30_000;
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

/**
 * The presence predicate (KTD2) for the inputs in `state`: the counted site, and the instant at
 * which counting stops by itself (a media hold running out) or Infinity.
 */
function presence(state: EngineState, settings: TrackerSettings): { site: string; until: number } | null {
  if (state.paused || state.idle === 'locked' || state.focusedWindow === null) return null;
  const tabId = own(state.activeTabs, String(state.focusedWindow));
  const tab = tabId === undefined ? undefined : own(state.tabs, String(tabId));
  if (!tab || tab.site === null) return null;
  if (state.idle === 'active') return { site: tab.site, until: Infinity };
  const media = settings.mediaOverride ? tab.media : undefined;
  if (!media) return null;
  if (media.on) return { site: tab.site, until: Infinity };
  return media.offAt === undefined ? null : { site: tab.site, until: media.offAt + MEDIA_HOLD_MS };
}

/** The site being counted at `at` (default: the last event), for the popup and the worker. */
export function currentSite(state: EngineState, settings: TrackerSettings, at: number = state.lastAt): string | null {
  const now = presence(state, settings);
  return now !== null && at < now.until ? now.site : null;
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
  const now = presence(state, settings);
  const until = now === null ? from : Math.min(end, now.until);
  const counted = now !== null && until > from ? attribute(state.sites, now.site, from, until, settings) : null;
  return {
    ...state,
    lastAt: at,
    needsReseed: state.needsReseed || gap,
    sites: counted?.sites ?? state.sites,
    attributions: counted?.attributions ?? [],
  };
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
