/**
 * Replays the event log (KTD10, ADR-1) through the engine. Pure: entries in, buckets out.
 * `LoggedEvent` is structural, so the tracker does not import the store; `src/store/log.ts` owns
 * the guard and the closed kind list, and `src/background/log.ts` the encoding this file inverts.
 *
 * Version 2 entries carry window and tab ids and the audible flag, so decoding is exact. Version 1
 * entries carried none of them: they replay as one window holding one tab, `close` is dropped (it
 * would close that one tab) and a `seed` counts as active. Their totals are an approximation.
 */
import { addAttributions } from './buckets.ts';
import { createInitialState, reduce } from './engine.ts';
import type { Buckets, EngineEvent, EngineState, IdleState, TrackerSettings } from './types.ts';

export interface LoggedEvent {
  readonly at: number;
  readonly kind: string;
  readonly site?: string;
  readonly win?: number;
  readonly tab?: number;
  readonly a?: 0 | 1;
}

/** The worker built a fresh engine state here (browser start, extension reload): replay resets too. */
export const START_KIND = 'start';

const IDLE_KINDS: ReadonlyMap<string, IdleState> = new Map([
  ['idle-active', 'active'],
  ['idle-idle', 'idle'],
  ['idle-locked', 'locked'],
]);
const SEED_KINDS: ReadonlyMap<string, IdleState> = new Map([
  ['seed-active', 'active'],
  ['seed-idle', 'idle'],
  ['seed-locked', 'locked'],
]);
/** The window and tab every version 1 entry is replayed in. */
const ONLY = 1;

function audible(entry: LoggedEvent): { audible?: boolean } {
  return entry.a === undefined ? {} : { audible: entry.a === 1 };
}

/** The engine event a version 2 entry encodes, or null for an unknown kind or a missing id. */
function toEvent(entry: LoggedEvent): EngineEvent | null {
  const { at, kind, site = null, win, tab } = entry;
  switch (kind) {
    case 'focus':
      return win === undefined ? null : { type: 'focus', at, windowId: win };
    case 'focus-none':
      return { type: 'focus', at, windowId: null };
    case 'activate':
      return win === undefined || tab === undefined ? null : { type: 'activate', at, windowId: win, tabId: tab };
    case 'url':
      return tab === undefined ? null : { type: 'url', at, tabId: tab, site, ...audible(entry) };
    case 'url-nav':
      return tab === undefined ? null : { type: 'url', at, tabId: tab, site, ...audible(entry), nav: true };
    case 'media-on':
    case 'media-off':
      return tab === undefined ? null : { type: 'media', at, tabId: tab, playing: kind === 'media-on' };
    case 'pause-on':
    case 'pause-off':
      return { type: 'pause', at, paused: kind === 'pause-on' };
    case 'tick':
      return { type: 'tick', at };
    case 'close':
      return tab === undefined ? null : { type: 'close', at, tabId: tab };
  }
  const idle = IDLE_KINDS.get(kind);
  if (idle !== undefined) return { type: 'idle', at, state: idle };
  const seeded = SEED_KINDS.get(kind);
  if (seeded === undefined) return null;
  return { type: 'seed', at, windowId: win ?? null, tabId: tab ?? null, site, idle: seeded, ...audible(entry) };
}

/** A version 1 entry, placed in the one window and tab it is replayed in. */
function toV1Event(entry: LoggedEvent): EngineEvent | null {
  const { at, kind, site = null } = entry;
  switch (kind) {
    case 'focus':
    case 'activate':
    case 'url':
    case 'media-on':
    case 'media-off':
      return toEvent({ ...entry, win: ONLY, tab: ONLY });
    case 'seed':
      return { type: 'seed', at, windowId: ONLY, tabId: ONLY, site, idle: 'active' };
    case 'close':
    case START_KIND:
      return null;
    default:
      return toEvent(entry);
  }
}

/** The engine events the entries encode, in order; `start` and unknown kinds are skipped, never thrown on. */
export function logToEvents(entries: readonly LoggedEvent[], version: 1 | 2 = 2): EngineEvent[] {
  const decode = version === 1 ? toV1Event : toEvent;
  return entries.flatMap((entry) => decode(entry) ?? []);
}

/**
 * Folds logged entries into day buckets like `replay`, from `state` (default: a fresh state at the
 * first entry). A `start` entry resets to a fresh state at its time, as the worker did.
 */
export function replayLog(
  entries: readonly LoggedEvent[],
  settings: TrackerSettings,
  state?: EngineState,
  version: 1 | 2 = 2,
): { buckets: Buckets; state: EngineState } {
  const decode = version === 1 ? toV1Event : toEvent;
  let current = state ?? createInitialState(entries[0]?.at ?? 0);
  let buckets: Buckets = {};
  for (const entry of entries) {
    if (entry.kind === START_KIND) {
      current = createInitialState(entry.at);
      continue;
    }
    const event = decode(entry);
    if (event === null) continue;
    const result = reduce(current, event, settings);
    current = result.state;
    buckets = addAttributions(buckets, result.attributions);
  }
  return { buckets, state: current };
}
