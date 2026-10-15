/**
 * The optional event recorder (KTD10, ADR-1): each engine event the queue reduced becomes one log entry,
 * losslessly, so `replayLog` in `src/tracker/replayLog.ts` turns the entries back into the same events.
 * `site` is the grouped site id the event already carries, never a URL; `win` and `tab` are Chrome's
 * integer ids; `a` is the audible flag. Level events fold their value into `kind` (`idle-locked`,
 * `media-on`, `seed-idle`, `focus-none`). A `start` entry opens the job that built a fresh engine state.
 */
import type { KeyValueStore } from '../store/adapter.ts';
import { appendLogEntries, type LogEntry } from '../store/log.ts';
import { isSiteId } from '../store/validate.ts';
import { START_KIND } from '../tracker/replayLog.ts';
import type { EngineEvent } from '../tracker/types.ts';

/**
 * A site the day records cannot hold either (`localhost`, an IPv6 host) is left out, like an untracked
 * page: its time is never stored, so the replay has nothing to match there.
 */
function siteField(site: string | null): { site?: string } {
  return isSiteId(site) ? { site } : {};
}

function audibleField(audible: boolean | undefined): { a?: 0 | 1 } {
  return audible === undefined ? {} : { a: audible ? 1 : 0 };
}

export function logEntry(event: EngineEvent): LogEntry {
  const { at } = event;
  switch (event.type) {
    case 'focus':
      return event.windowId === null ? { at, kind: 'focus-none' } : { at, kind: 'focus', win: event.windowId };
    case 'activate':
      return { at, kind: 'activate', win: event.windowId, tab: event.tabId };
    case 'url':
      return { at, kind: 'url', ...siteField(event.site), tab: event.tabId, ...audibleField(event.audible) };
    case 'idle':
      return { at, kind: `idle-${event.state}` };
    case 'media':
      return { at, kind: event.playing ? 'media-on' : 'media-off', tab: event.tabId };
    case 'pause':
      return { at, kind: event.paused ? 'pause-on' : 'pause-off' };
    case 'tick':
      return { at, kind: 'tick' };
    case 'close':
      return { at, kind: 'close', tab: event.tabId };
    case 'seed':
      return {
        at,
        kind: `seed-${event.idle}`,
        ...siteField(event.site),
        ...(event.windowId === null ? {} : { win: event.windowId }),
        ...(event.tabId === null ? {} : { tab: event.tabId }),
        ...audibleField(event.audible),
      };
  }
}

/** Appends one job's events; `fresh` when the job started from a new engine state (no hot state). */
export async function appendEvents(store: KeyValueStore, events: readonly EngineEvent[], now: number, fresh = false): Promise<void> {
  const entries = events.map(logEntry);
  const all = fresh ? [{ at: now, kind: START_KIND }, ...entries] : entries;
  if (all.length === 0) return;
  await appendLogEntries(store, all, now);
}
