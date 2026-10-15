import { own, without } from './records.ts';
import type { EngineEvent, EngineState, MediaState, TabState } from './types.ts';

/**
 * A playback signal. Playing is a level; when it falls, `offAt` starts the hold. A repeated stop
 * keeps the first stop time. Chrome's `audible` is ignored once the content script owns the tab.
 */
function signal(media: MediaState | undefined, src: MediaState['src'], playing: boolean, at: number): MediaState {
  if (src === 'audible' && media?.src === 'msg') return media;
  if (playing) return { src, on: true };
  if (media?.on) return { src, on: false, offAt: at };
  return media?.offAt === undefined ? { src, on: false } : { src, on: false, offAt: media.offAt };
}

function tabWith(site: string | null, media: MediaState | undefined): TabState {
  return media ? { site, media } : { site };
}

/**
 * A tab shows a (possibly new) site. Leaving one site for another drops the media state: the
 * old page and its content script are gone, so a stale "playing" cannot outlive them.
 */
function navigate(state: EngineState, tabId: number, site: string | null, audible: boolean | undefined, at: number): EngineState {
  const key = String(tabId);
  const previous = own(state.tabs, key);
  const left = previous !== undefined && previous.site !== null && previous.site !== site;
  const kept = left ? undefined : previous?.media;
  const media = audible === undefined ? kept : signal(kept, 'audible', audible, at);
  return { ...state, tabs: { ...state.tabs, [key]: tabWith(site, media) } };
}

/** Applies one event to the browser inputs held in the state. */
export function applyEvent(state: EngineState, event: EngineEvent): EngineState {
  switch (event.type) {
    case 'focus':
      return { ...state, focusedWindow: event.windowId };
    case 'activate':
      return { ...state, activeTabs: { ...state.activeTabs, [String(event.windowId)]: event.tabId } };
    case 'url':
      return navigate(state, event.tabId, event.site, event.audible, event.at);
    case 'idle':
      return { ...state, idle: event.state };
    case 'media': {
      const key = String(event.tabId);
      const tab = own(state.tabs, key);
      const media = signal(tab?.media, 'msg', event.playing, event.at);
      return { ...state, tabs: { ...state.tabs, [key]: tabWith(tab?.site ?? null, media) } };
    }
    case 'pause':
      return { ...state, paused: event.paused };
    case 'tick':
      return state;
    case 'close':
      return {
        ...state,
        tabs: without(state.tabs, (key) => key === String(event.tabId)),
        activeTabs: without(state.activeTabs, (_, tabId) => tabId === event.tabId),
      };
    case 'seed': {
      const seeded = { ...state, focusedWindow: event.windowId, idle: event.idle, needsReseed: false };
      if (event.windowId === null || event.tabId === null) return seeded;
      const active = { ...seeded, activeTabs: { ...seeded.activeTabs, [String(event.windowId)]: event.tabId } };
      return navigate(active, event.tabId, event.site, event.audible, event.at);
    }
  }
}
