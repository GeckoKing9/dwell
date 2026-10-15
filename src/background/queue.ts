/**
 * The one serialised queue (KTD6). Every job that reads or writes hot state, day keys or settings runs
 * here, one at a time, in the order Chrome delivered the events. `Date.now()` is read only here, once
 * per job, when the job is queued; everything downstream uses that `at`.
 *
 * A tracking job: load settings and hot state -> seed from the live browser if the hot state is missing
 * -> align the engine with the stored pause -> map the Chrome payload to engine events -> reduce them
 * -> reseed if the engine asks -> write the attributions -> save the hot state -> append the event log.
 */
import type { KeyValueStore } from '../store/adapter.ts';
import { applyAttributions } from '../store/days.ts';
import { loadHotState, saveHotState } from '../store/hot.ts';
import type { Settings } from '../store/schema.ts';
import { loadSettings } from '../shared/settings.ts';
import { DEFAULT_TRACKER_SETTINGS, createInitialState, reduce } from '../tracker/engine.ts';
import type { Attribution, EngineEvent, EngineState, TrackerSettings } from '../tracker/types.ts';
import { pauseEvent } from './events.ts';
import { appendEvents } from './log.ts';
import { readSeed } from './reseed.ts';
import { HOT_VERSION, readEngineState, toHotState } from './state.ts';

export interface Stores {
  /** storage.local: day keys, settings, the event log. */
  readonly local: KeyValueStore;
  /** storage.session: the hot state. */
  readonly session: KeyValueStore;
}

/** What a tracking job's producer sees: the job's time, the engine state so far, the stored settings. */
export interface JobContext {
  readonly at: number;
  readonly state: EngineState;
  readonly settings: Settings;
}

/** Turns one Chrome event into engine events; may read the live browser or write settings first. */
export type Producer = (ctx: JobContext) => Promise<readonly EngineEvent[]> | readonly EngineEvent[];

export interface Queue {
  /** Runs `job(at)` after every job queued before it. Never rejects: a failure is logged and yields `fallback`. */
  run<T>(job: (at: number) => Promise<T>, fallback: T): Promise<T>;
  /** Runs one tracking job for the events `produce` returns; false when the job failed. */
  track(produce: Producer): Promise<boolean>;
}

export function trackerSettings(settings: Settings): TrackerSettings {
  return { ...DEFAULT_TRACKER_SETTINGS, idleThresholdSec: settings.idleThresholdSec, mediaOverride: settings.mediaOverride };
}

async function trackJob(stores: Stores, at: number, produce: Producer): Promise<void> {
  const settings = await loadSettings(stores.local);
  const tracker = trackerSettings(settings);
  const stored = readEngineState(await loadHotState(stores.session, HOT_VERSION));
  let state = stored ?? createInitialState(at);
  const reduced: EngineEvent[] = [];
  const attributions: Attribution[] = [];
  const step = (event: EngineEvent): void => {
    const result = reduce(state, event, tracker);
    state = result.state;
    attributions.push(...result.attributions);
    reduced.push(event);
  };

  if (stored === null) step(await readSeed(at, settings));
  if (state.paused !== settings.paused) step(pauseEvent(settings.paused, at));
  for (const event of await produce({ at, state, settings })) step(event);
  if (state.needsReseed) step(await readSeed(at, settings));

  await applyAttributions(stores.local, attributions);
  await saveHotState(stores.session, toHotState(state));
  if (settings.eventLog) await appendEvents(stores.local, reduced, at, stored === null);
}

export function createQueue(stores: Stores): Queue {
  let tail: Promise<unknown> = Promise.resolve();

  function run<T>(job: (at: number) => Promise<T>, fallback: T): Promise<T> {
    const at = Date.now();
    // `tail` never rejects: every link catches its own failure below.
    const result = tail.then(() => job(at)).catch((error: unknown) => {
      console.error('Dwell: a worker job failed', error);
      return fallback;
    });
    tail = result;
    return result;
  }

  return {
    run,
    track: (produce) =>
      run(async (at) => {
        await trackJob(stores, at, produce);
        return true;
      }, false),
  };
}
