/**
 * Delete-all with an in-memory undo (R12). The worker keeps the returned snapshot for 10 s;
 * nothing about the undo is ever written to storage.
 */
import { DAY_KEY_PREFIX, SETTINGS_KEY } from './schema.ts';
import type { KeyValueStore } from './adapter.ts';
import { LOG_KEY_PREFIX } from './log.ts';
import { nullRecord } from './validate.ts';

/** Every recorded key at one moment: day keys, log keys and settings, as stored. */
export interface Snapshot {
  readonly records: Readonly<Record<string, unknown>>;
}

function isRecordedKey(key: string): boolean {
  return key.startsWith(DAY_KEY_PREFIX) || key.startsWith(LOG_KEY_PREFIX);
}

/** A deep copy of every day key, log key and the settings key. */
export async function snapshotAll(store: KeyValueStore): Promise<Snapshot> {
  const keys = (await store.keys()).filter((key) => isRecordedKey(key) || key === SETTINGS_KEY);
  const stored = keys.length > 0 ? await store.get(keys) : {};
  const records = nullRecord<unknown>();
  for (const key of keys) {
    if (Object.hasOwn(stored, key)) records[key] = JSON.parse(JSON.stringify(stored[key])) as unknown;
  }
  return { records };
}

/**
 * Removes every day key and log key from `local` and everything in `session` (hot state).
 * Settings stay. Returns the snapshot taken just before, for the undo window.
 */
export async function deleteAll(local: KeyValueStore, session: KeyValueStore): Promise<Snapshot> {
  const snapshot = await snapshotAll(local);
  const recorded = Object.keys(snapshot.records).filter(isRecordedKey);
  if (recorded.length > 0) await local.remove(recorded);
  const sessionKeys = await session.keys();
  if (sessionKeys.length > 0) await session.remove(sessionKeys);
  return snapshot;
}

/**
 * Writes the snapshot back in one call, byte for byte. Today's key is overwritten, so the
 * few seconds tracked between delete and undo are dropped in favour of the restored day.
 */
export async function restoreSnapshot(store: KeyValueStore, snapshot: Snapshot): Promise<void> {
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot.records)) record[key] = value;
  if (Object.keys(record).length > 0) await store.set(record);
}
