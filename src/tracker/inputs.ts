import { own, without } from './records.ts';
import type { EngineEvent, EngineState, MediaState, TabState } from './types.ts';

/**
 * A playback signal. Playing is a level; when it falls, `offAt` starts the hold. A repeated stop
 * keeps the first stop time. Chrome's `audible` is ignored once the content script owns the tab. A
 * content-script stop only ends playback the content script reported: a stop from a page that has
 * already left (its `pagehide` arriving after the next site's url event) has nothing to end.
 */
function signal(media: MediaState | undefined, src: MediaState['src'], playing: boolean, at: number): MediaState | undefined {
  if (src === 'audible' && media?.src === 'msg') return media;
  if (src === 'msg' && !playing && media?.src !== 'msg') return media;
  if (playing) return { src, on: true };
  if (media?.on) return { src, on: false, offAt: at };
  return media?.offAt === undefined ? { src, on: false } : { src, on: false, offAt: media.offAt };
}

function tabWith(site: string | null, media: MediaState | undefined): TabState {
  return media ? { site, media } : { site };
}

/**
 * A tab shows a (possibly new) site. Leaving one site for another drops the media state: the
 * old page and its content script are gone, so a stale "playing" cannot outlive them. A
 * navigation within the site (`nav`) drops what the content script reported for the same
 * reason; Chrome's audible flag counts until the new page reports.
 */
function navigate(state: EngineState, tabId: number, site: string | null, audible: boolean | undefined, nav: boolean, at: number): EngineState {
  const key = String(tabId);
  const previous = own(state.tabs, key);
  const left = previous !== undefined && previous.site !== null && previous.site !== site;
  const stale = left || (nav && previous?.media?.src === 'msg');
  const kept = stale ? undefined : previous?.media;
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
      return navigate(state, event.tabId, event.site, event.audible, event.nav === true, event.at);
    case 'idle':
      return { ...state, idle: event.state };
    case 'media': {
      const key = String(event.tabId);
      const tab = own(state.tabs, key);
      const media = signal(tab?.media, 'msg', event.playing, event.at);
      if (media === tab?.media) return state;
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
      return navigate(active, event.tabId, event.site, event.audible, false, event.at);
    }
  }
}
