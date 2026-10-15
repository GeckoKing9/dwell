/** Pure helpers for chrome.storage.onChanged payloads, shared by the popup and the dashboard. */
import { DAY_KEY_PREFIX, SETTINGS_KEY } from '../store/schema.ts';

/** The part of a chrome.storage change the pages read: the value the key now holds, absent when it was removed. */
export type StorageChanges = Record<string, { newValue?: unknown }>;

/** True when a storage change touches settings or a day record, the only keys the popup and dashboard read. */
export function isRelevantChange(changedKeys: readonly string[], area: string): boolean {
  return area === 'local' && changedKeys.some((key) => key === SETTINGS_KEY || key.startsWith(DAY_KEY_PREFIX));
}
