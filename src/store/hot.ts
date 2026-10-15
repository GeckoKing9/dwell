/** Hot engine state in storage.session (KTD3). Opaque here: the worker owns its shape and narrows it. */
import type { KeyValueStore } from './adapter.ts';
import { isPlainObject } from './validate.ts';

export const HOT_STATE_KEY = 'hot';

/** A JSON object with an integer `version`; everything else is the worker's business. */
export type HotState = { readonly version: number; readonly [key: string]: unknown };

/**
 * The stored hot state, or null when it is missing, malformed or (with `expectedVersion`)
 * from another version. Null means "seed from the live browser" (KTD7).
 */
export async function loadHotState(store: KeyValueStore, expectedVersion?: number): Promise<HotState | null> {
  const value: unknown = (await store.get([HOT_STATE_KEY]))[HOT_STATE_KEY];
  if (!isPlainObject(value)) return null;
  const version = value['version'];
  if (typeof version !== 'number' || !Number.isInteger(version)) return null;
  if (expectedVersion !== undefined && version !== expectedVersion) return null;
  return value as HotState;
}

export async function saveHotState(store: KeyValueStore, state: { readonly version: number }): Promise<void> {
  await store.set({ [HOT_STATE_KEY]: state });
}

export async function clearHotState(store: KeyValueStore): Promise<void> {
  await store.remove([HOT_STATE_KEY]);
}
