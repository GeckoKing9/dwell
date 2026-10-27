/**
 * The worker's hot state in storage.session: `{ version, engine }`. Anything that does not read back
 * as a well-formed engine state counts as missing, and the queue seeds from the live browser (KTD7).
 */
import { isPlainObject } from '../store/validate.ts';
import type { HotState } from '../store/hot.ts';
import type { EngineState } from '../tracker/types.ts';

export const HOT_VERSION = 1;

export interface WorkerHotState {
  readonly version: typeof HOT_VERSION;
  readonly engine: EngineState;
}

const IDLE_STATES: readonly unknown[] = ['active', 'idle', 'locked'];

function isNumberMap(value: unknown): boolean {
  return isPlainObject(value) && Object.values(value).every((v) => typeof v === 'number');
}

function isTabMap(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every(
    (tab) => isPlainObject(tab) && (tab['site'] === null || typeof tab['site'] === 'string') && (tab['media'] === undefined || isPlainObject(tab['media'])),
  );
}

function isSiteMemoryMap(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every((m) => isPlainObject(m) && typeof m['at'] === 'number' && typeof m['carryMs'] === 'number');
}

/** Absent, or the tab and window ids of the page holding attention and the time of its input. */
function isAttention(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isPlainObject(value)) return false;
  const { tabId, windowId, at, capped } = value;
  return Number.isInteger(tabId) && Number.isInteger(windowId) && typeof at === 'number' && Number.isFinite(at) && (capped === undefined || capped === true);
}

function isEngineState(value: unknown): value is EngineState {
  if (!isPlainObject(value)) return false;
  const { v, lastAt, focusedWindow, activeTabs, tabs, idle, paused, sites, needsReseed, attention } = value;
  return (
    v === 1 &&
    typeof lastAt === 'number' &&
    Number.isFinite(lastAt) &&
    (focusedWindow === null || typeof focusedWindow === 'number') &&
    isNumberMap(activeTabs) &&
    isTabMap(tabs) &&
    IDLE_STATES.includes(idle) &&
    typeof paused === 'boolean' &&
    isSiteMemoryMap(sites) &&
    typeof needsReseed === 'boolean' &&
    isAttention(attention)
  );
}

/** The engine state inside a stored hot state, or null when it is missing or malformed. */
export function readEngineState(hot: HotState | null): EngineState | null {
  if (hot === null || hot.version !== HOT_VERSION) return null;
  const engine = hot['engine'];
  return isEngineState(engine) ? engine : null;
}

export function toHotState(engine: EngineState): WorkerHotState {
  return { version: HOT_VERSION, engine };
}
