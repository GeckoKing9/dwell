/// <reference types="chrome" />
/**
 * The only storage seam: every store function takes a KeyValueStore, so the whole
 * layer runs in tests against memoryStore() and in the extension against chromeStore().
 */

export type StoredRecord = Record<string, unknown>;

export interface KeyValueStore {
  /** Values for the keys that exist; missing keys are absent from the result. */
  get(keys: readonly string[]): Promise<StoredRecord>;
  /** Writes every key of `record` in one call. */
  set(record: StoredRecord): Promise<void>;
  remove(keys: readonly string[]): Promise<void>;
  keys(): Promise<string[]>;
}

/* v8 ignore start -- @preserve: thin Chrome wrapper, exercised by the e2e suite */
/** Wraps chrome.storage.local or chrome.storage.session. */
export function chromeStore(area: chrome.storage.StorageArea): KeyValueStore {
  return {
    async get(keys) {
      if (keys.length === 0) return {};
      return area.get([...keys]);
    },
    async set(record) {
      if (Object.keys(record).length === 0) return;
      await area.set(record);
    },
    async remove(keys) {
      if (keys.length === 0) return;
      await area.remove([...keys]);
    },
    async keys() {
      if (typeof area.getKeys === 'function') return area.getKeys();
      return Object.keys(await area.get(null));
    },
  };
}
/* v8 ignore stop -- @preserve */

export interface MemoryStore extends KeyValueStore {
  /** The next set() rejects with `error` and writes nothing. */
  failNextSet(error?: Error): void;
  /** Number of set() calls so far, failed ones included. */
  readonly setCalls: number;
  /** Number of keys() calls so far: on Chrome without getKeys each one reads the whole area. */
  readonly keysCalls: number;
  /** A deep copy of everything stored, keys sorted, for byte-level comparisons. */
  dump(): StoredRecord;
}

/** Values go through JSON like chrome.storage does, so prototypes and undefined never survive. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** In-memory KeyValueStore for tests, with an injectable write failure. */
export function memoryStore(initial: StoredRecord = {}): MemoryStore {
  const data = new Map<string, unknown>(Object.entries(clone(initial)));
  let pendingFailure: Error | null = null;
  let setCalls = 0;
  let keysCalls = 0;
  return {
    async get(keys) {
      const out: StoredRecord = {};
      for (const key of keys) {
        if (data.has(key)) out[key] = clone(data.get(key));
      }
      return out;
    },
    async set(record) {
      setCalls += 1;
      if (pendingFailure) {
        const error = pendingFailure;
        pendingFailure = null;
        throw error;
      }
      for (const [key, value] of Object.entries(clone(record))) data.set(key, value);
    },
    async remove(keys) {
      for (const key of keys) data.delete(key);
    },
    async keys() {
      keysCalls += 1;
      return [...data.keys()];
    },
    failNextSet(error = new Error('storage write failed')) {
      pendingFailure = error;
    },
    get setCalls() {
      return setCalls;
    },
    get keysCalls() {
      return keysCalls;
    },
    dump() {
      const out: StoredRecord = {};
      for (const key of [...data.keys()].sort()) out[key] = clone(data.get(key));
      return out;
    },
  };
}
