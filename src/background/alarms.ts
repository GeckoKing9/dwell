/**
 * The heartbeat (every minute, closes the open interval) and the daily prune. Created on every worker
 * start but only when missing or wrong: re-creating an alarm reschedules it, and nothing counts ticks.
 */
import type { KeyValueStore } from '../store/adapter.ts';
import { pruneLog } from '../store/log.ts';
import { pruneOldDays } from '../store/prune.ts';
import { tickEvent } from './events.ts';
import type { Queue } from './queue.ts';

export const HEARTBEAT_ALARM = 'heartbeat';
export const PRUNE_ALARM = 'prune';

const PERIODS: Readonly<Record<string, number>> = {
  [HEARTBEAT_ALARM]: 1,
  [PRUNE_ALARM]: 24 * 60,
};

export async function ensureAlarms(): Promise<void> {
  for (const [name, periodInMinutes] of Object.entries(PERIODS)) {
    const existing = await chrome.alarms.get(name);
    if (existing?.periodInMinutes === periodInMinutes) continue;
    await chrome.alarms.create(name, { periodInMinutes });
  }
}

/**
 * Drops day keys older than the 90-day window (R10), on the queue like every other write, and event
 * log hours older than 24 h: a backstop for the hourly sweep, which runs only while the log records.
 */
export function prune(queue: Queue, local: KeyValueStore): Promise<string[]> {
  return queue.run(async (at) => {
    const days = await pruneOldDays(local, new Date(at));
    await pruneLog(local, at);
    return days;
  }, []);
}

/** heartbeat -> a `tick` that closes the open interval; prune -> drop expired days; anything else is ignored. */
export async function handleAlarm(name: string, queue: Queue, local: KeyValueStore): Promise<void> {
  if (name === HEARTBEAT_ALARM) await queue.track(({ at }) => [tickEvent(at)]);
  else if (name === PRUNE_ALARM) await prune(queue, local);
}
