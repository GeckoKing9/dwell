/**
 * The optional event recorder (KTD10): each engine event the queue reduced becomes `{ at, kind, site? }`.
 * `site` is the grouped site id the event already carries, never a URL. Level events fold their value
 * into `kind` (`idle-locked`, `media-on`, `focus-none`) so a recorded day says what changed.
 */
import type { KeyValueStore } from '../store/adapter.ts';
import { appendLogEntries, type LogEntry } from '../store/log.ts';
import { isSiteId } from '../store/validate.ts';
import type { EngineEvent } from '../tracker/types.ts';

function kindOf(event: EngineEvent): string {
  switch (event.type) {
    case 'focus':
      return event.windowId === null ? 'focus-none' : 'focus';
    case 'idle':
      return `idle-${event.state}`;
    case 'media':
      return event.playing ? 'media-on' : 'media-off';
    case 'pause':
      return event.paused ? 'pause-on' : 'pause-off';
    default:
      return event.type;
  }
}

/** A site the day records cannot hold either (an IP address, `localhost`) is left out, like an untracked page. */
export function logEntry(event: EngineEvent): LogEntry {
  const site = event.type === 'url' || event.type === 'seed' ? event.site : null;
  return isSiteId(site) ? { at: event.at, kind: kindOf(event), site } : { at: event.at, kind: kindOf(event) };
}

export async function appendEvents(store: KeyValueStore, events: readonly EngineEvent[], now: number): Promise<void> {
  if (events.length === 0) return;
  await appendLogEntries(store, events.map(logEntry), now);
}
