/**
 * A minimal in-memory `chrome` for the service worker tests: the storage areas, windows, tabs, idle,
 * alarms, declarativeNetRequest and runtime calls the worker makes, and nothing else.
 */
import { vi } from 'vitest';

export const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';

export interface FakeTab {
  id: number;
  windowId: number;
  active: boolean;
  url?: string;
  audible?: boolean;
  incognito: boolean;
}

export interface FakeWindow {
  id: number;
  focused: boolean;
  incognito: boolean;
}

export interface FakeAlarm {
  name: string;
  periodInMinutes?: number;
  scheduledTime: number;
}

/** Values go through JSON like chrome.storage does. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class FakeArea {
  readonly data = new Map<string, unknown>();
  failNextSet = false;

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    const list = keys === null ? [...this.data.keys()] : typeof keys === 'string' ? [keys] : keys;
    const out: Record<string, unknown> = {};
    for (const key of list) if (this.data.has(key)) out[key] = clone(this.data.get(key));
    return out;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    if (this.failNextSet) {
      this.failNextSet = false;
      throw new Error('storage write failed');
    }
    for (const [key, value] of Object.entries(clone(items))) this.data.set(key, value);
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === 'string' ? [keys] : keys) this.data.delete(key);
  }

  async getKeys(): Promise<string[]> {
    return [...this.data.keys()];
  }
}

export interface FakeChrome {
  local: FakeArea;
  session: FakeArea;
  windows: FakeWindow[];
  tabs: FakeTab[];
  lastFocusedId: number | null;
  idle: 'active' | 'idle' | 'locked';
  idleQueries: number[];
  detectionInterval: number | null;
  alarms: Map<string, FakeAlarm>;
  alarmCreates: string[];
  enabledRulesets: Set<string>;
  rulesetUpdates: { enableRulesetIds: string[]; disableRulesetIds: string[] }[];
  /** The next `updateEnabledRulesets` call rejects, as Chrome does when it refuses the change. */
  failNextRulesetUpdate: boolean;
}

interface UpdateRulesetOptions {
  enableRulesetIds?: string[];
  disableRulesetIds?: string[];
}

/** Installs a fresh fake as the `chrome` global and returns its state for the test to drive and read. */
export function installFakeChrome(): FakeChrome {
  const fake: FakeChrome = {
    local: new FakeArea(),
    session: new FakeArea(),
    windows: [],
    tabs: [],
    lastFocusedId: null,
    idle: 'active',
    idleQueries: [],
    detectionInterval: null,
    alarms: new Map(),
    alarmCreates: [],
    enabledRulesets: new Set(['instagram-reels', 'youtube-shorts', 'facebook-reels']),
    rulesetUpdates: [],
    failNextRulesetUpdate: false,
  };
  const api = {
    runtime: { id: EXTENSION_ID },
    storage: { local: fake.local, session: fake.session },
    windows: {
      WINDOW_ID_NONE: -1,
      async getLastFocused(options?: { populate?: boolean }) {
        const win = fake.windows.find((w) => w.id === fake.lastFocusedId);
        if (!win) throw new Error('No last-focused window');
        const tabs = fake.tabs.filter((t) => t.windowId === win.id).map((t) => ({ ...t }));
        return options?.populate ? { ...win, tabs } : { ...win };
      },
    },
    tabs: {
      async get(tabId: number) {
        const tab = fake.tabs.find((t) => t.id === tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}.`);
        return { ...tab };
      },
      async query(query: { active?: boolean; windowId?: number }) {
        return fake.tabs
          .filter((t) => query.active === undefined || t.active === query.active)
          .filter((t) => query.windowId === undefined || t.windowId === query.windowId)
          .map((t) => ({ ...t }));
      },
    },
    idle: {
      async queryState(seconds: number) {
        fake.idleQueries.push(seconds);
        return fake.idle;
      },
      setDetectionInterval(seconds: number) {
        fake.detectionInterval = seconds;
      },
    },
    alarms: {
      async get(name: string) {
        const alarm = fake.alarms.get(name);
        return alarm ? { ...alarm } : undefined;
      },
      async create(name: string, info: { periodInMinutes?: number; delayInMinutes?: number }) {
        fake.alarmCreates.push(name);
        const delay = info.delayInMinutes ?? info.periodInMinutes ?? 0;
        const alarm: FakeAlarm = { name, scheduledTime: Date.now() + delay * 60_000 };
        if (info.periodInMinutes !== undefined) alarm.periodInMinutes = info.periodInMinutes;
        fake.alarms.set(name, alarm);
      },
    },
    declarativeNetRequest: {
      async getEnabledRulesets() {
        return [...fake.enabledRulesets];
      },
      async updateEnabledRulesets(options: UpdateRulesetOptions) {
        if (fake.failNextRulesetUpdate) {
          fake.failNextRulesetUpdate = false;
          throw new Error('ruleset update refused');
        }
        const enable = options.enableRulesetIds ?? [];
        const disable = options.disableRulesetIds ?? [];
        fake.rulesetUpdates.push({ enableRulesetIds: [...enable], disableRulesetIds: [...disable] });
        for (const id of disable) fake.enabledRulesets.delete(id);
        for (const id of enable) fake.enabledRulesets.add(id);
      },
    },
  };
  vi.stubGlobal('chrome', api);
  return fake;
}

/** One focused normal window with the given tabs; the first tab is active unless one says otherwise. */
export function openWindow(fake: FakeChrome, windowId: number, tabs: { id: number; url: string; active?: boolean }[]): void {
  fake.windows.push({ id: windowId, focused: true, incognito: false });
  for (const w of fake.windows) if (w.id !== windowId) w.focused = false;
  fake.lastFocusedId = windowId;
  const anyActive = tabs.some((t) => t.active === true);
  tabs.forEach((t, i) => {
    fake.tabs.push({ id: t.id, windowId, url: t.url, active: anyActive ? t.active === true : i === 0, incognito: false });
  });
}

interface StoredDay {
  sites?: Record<string, { h: Record<string, number>; v: number }>;
  blocked?: Record<string, number>;
}

function storedDays(fake: FakeChrome): StoredDay[] {
  return [...fake.local.data.entries()].filter(([key]) => key.startsWith('d:')).map(([, value]) => value as StoredDay);
}

/** Seconds and visits for `site` summed over every stored day. */
export function totals(fake: FakeChrome, site: string): { seconds: number; visits: number } {
  let seconds = 0;
  let visits = 0;
  for (const day of storedDays(fake)) {
    const record = day.sites?.[site];
    if (!record) continue;
    seconds += Object.values(record.h).reduce((sum, s) => sum + s, 0);
    visits += record.v;
  }
  return { seconds, visits };
}

export function blockedCount(fake: FakeChrome, site: string): number {
  return storedDays(fake).reduce((sum, day) => sum + (day.blocked?.[site] ?? 0), 0);
}

export interface StoredEngine {
  paused: boolean;
  lastAt: number;
  focusedWindow: number | null;
  activeTabs: Record<string, number>;
  tabs: Record<string, { site: string | null; media?: { src: string; on: boolean } }>;
  needsReseed: boolean;
}

/** The engine state inside the stored hot state, as the worker saved it. */
export function engineState(fake: FakeChrome): StoredEngine {
  const hot = fake.session.data.get('hot') as { version: number; engine: StoredEngine } | undefined;
  if (!hot) throw new Error('no hot state stored');
  return hot.engine;
}

/** Makes `tabId` the active tab of its window in the fake (the caller fires the event). */
export function activate(fake: FakeChrome, tabId: number): { tabId: number; windowId: number } {
  const tab = fake.tabs.find((t) => t.id === tabId);
  if (!tab) throw new Error(`no tab ${tabId}`);
  for (const t of fake.tabs) if (t.windowId === tab.windowId) t.active = t.id === tabId;
  return { tabId, windowId: tab.windowId };
}
