/**
 * Every Chrome listener the worker registers, as plain functions over one queue. `index.ts` only
 * registers them; tests call them directly against a fake `chrome`. Each returns its job's promise.
 */
import { chromeStore, type KeyValueStore } from '../store/adapter.ts';
import { loadSettings } from '../shared/settings.ts';
import type { IdleState } from '../tracker/types.ts';
import { ensureAlarms, handleAlarm, prune } from './alarms.ts';
import type { SenderLike } from './authorize.ts';
import { applySettings } from './effects.ts';
import {
  WINDOW_ID_NONE,
  activateEvent,
  closeEvent,
  focusEvent,
  idleEvent,
  isTrackedChange,
  updatedEvent,
  urlEvent,
  type TabChange,
  type TabLike,
} from './events.ts';
import { createMessageHandler, type Reply } from './messages.ts';
import { createQueue, type Queue } from './queue.ts';
import { activeTabEvents } from './reseed.ts';

export interface Background {
  /** Runs on every worker start: alarms, idle interval and rulesets brought in line with the settings. */
  start(): Promise<void>;
  onStartup(): Promise<void>;
  onInstalled(): Promise<void>;
  onTabActivated(info: { tabId: number; windowId: number }): Promise<void>;
  onTabUpdated(tabId: number, change: TabChange, tab: TabLike): Promise<void>;
  onTabRemoved(tabId: number): Promise<void>;
  onFocusChanged(windowId: number): Promise<void>;
  onWindowRemoved(windowId: number): Promise<void>;
  onIdleChanged(state: IdleState): Promise<void>;
  onAlarm(alarm: { name: string }): Promise<void>;
  /** The `runtime.onMessage` listener: answers through `sendResponse` and keeps the channel open. */
  onMessage(raw: unknown, sender: SenderLike, sendResponse: (reply: Reply) => void): boolean;
  handleMessage(raw: unknown, sender: SenderLike): Promise<Reply>;
}

/**
 * Drops expired days, reconciles the rulesets and ensures the alarms. It never seeds itself: the empty
 * tracking job only opens the queue, and that job seeds from the live browser (once) when the hot
 * state is missing, which is exactly the case after a browser start.
 */
async function browserStart(queue: Queue, local: KeyValueStore): Promise<void> {
  await queue.track(() => []);
  await prune(queue, local);
  await queue.run(async () => {
    await ensureAlarms();
    await applySettings(null, await loadSettings(local));
  }, undefined);
}

export function createBackground(): Background {
  const local = chromeStore(chrome.storage.local);
  const session = chromeStore(chrome.storage.session);
  const queue = createQueue({ local, session });
  const handleMessage = createMessageHandler({ queue, local, session, extensionId: chrome.runtime.id });
  const done = async (job: Promise<unknown>): Promise<void> => {
    await job;
  };

  return {
    start: () =>
      queue.run(async () => {
        await ensureAlarms();
        await applySettings(null, await loadSettings(local));
      }, undefined),
    onStartup: () => browserStart(queue, local),
    onInstalled: () => browserStart(queue, local),
    onTabActivated: (info) =>
      done(
        queue.track(async ({ at, settings }) => {
          const tab = await chrome.tabs.get(info.tabId).catch(() => null);
          const url = tab === null ? [] : [urlEvent({ ...tab, id: info.tabId }, settings, at)];
          return [...url, activateEvent(info, at)];
        }),
      ),
    onTabUpdated: (tabId, change, tab) => {
      // A title, favicon or load-complete update is dropped here, before it costs a queued storage round trip.
      if (!isTrackedChange(change)) return Promise.resolve();
      return done(
        queue.track(({ at, settings }) => {
          const event = updatedEvent(tabId, change, tab, settings, at);
          return event === null ? [] : [event];
        }),
      );
    },
    onTabRemoved: (tabId) => done(queue.track(({ at }) => [closeEvent(tabId, at)])),
    onFocusChanged: (windowId) =>
      done(
        queue.track(async ({ at, settings }) => {
          if (windowId === WINDOW_ID_NONE) return [focusEvent(windowId, at)];
          const known = await activeTabEvents(windowId, settings, at).catch(() => []);
          return [...known, focusEvent(windowId, at)];
        }),
      ),
    onWindowRemoved: (windowId) =>
      done(queue.track(({ at, state }) => (state.focusedWindow === windowId ? [focusEvent(WINDOW_ID_NONE, at)] : []))),
    onIdleChanged: (state) => done(queue.track(({ at }) => [idleEvent(state, at)])),
    onAlarm: (alarm) => handleAlarm(alarm.name, queue, local),
    onMessage: (raw, sender, sendResponse) => {
      void handleMessage(raw, sender).then(sendResponse);
      return true;
    },
    handleMessage,
  };
}
