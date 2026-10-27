import { own, without } from './records.ts';
import type { EngineEvent, EngineState, MediaState, TabState } from './types.ts';

/**
 * A playback signal. Playing is a level; when it falls, `offAt` starts the hold. A repeated stop
 * keeps the first stop time. Chrome's `audible` is ignored once the content script owns the tab. A
 * content-script stop only ends playback the content script reported: a stop from a page that has
 * already left (its `pagehide` arriving after the next site's url event) has nothing to end.
 * `watched` comes only from the content script; a stop keeps it, so the hold counts the same way.
 */
function signal(media: MediaState | undefined, src: MediaState['src'], playing: boolean, at: number, watched = false): MediaState | undefined {
  if (src === 'audible' && media?.src === 'msg') return media;
  if (src === 'msg' && !playing && media?.src !== 'msg') return media;
  if (playing) return src === 'msg' && watched ? { src, on: true, watched: true } : { src, on: true };
  const kept = media?.watched ? { watched: true as const } : {};
  if (media?.on) return { src, on: false, offAt: at, ...kept };
  return media?.offAt === undefined ? { src, on: false, ...kept } : { src, on: false, offAt: media.offAt, ...kept };
}

/** The state without attention, or unchanged when no page holds it or `when` says to keep it. */
function dropAttention(state: EngineState, when: (tabId: number) => boolean = () => true): EngineState {
  if (state.attention === undefined || !when(state.attention.tabId)) return state;
  const rest = { ...state };
  delete rest.attention;
  return rest;
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
  const next = previous?.site === site ? state : dropAttention(state, (held) => held === tabId);
  return { ...next, tabs: { ...next.tabs, [key]: tabWith(site, media) } };
}

/**
 * Applies one event to the browser inputs held in the state. Attention ends when another Chrome window
 * gets focus, when its own window shows another tab, and when its page leaves the site or closes. Another
 * app taking focus does not end it: the pointer leaving the page does, through the content script.
 */
export function applyEvent(state: EngineState, event: EngineEvent): EngineState {
  switch (event.type) {
    case 'focus': {
      const elsewhere = event.windowId !== null && event.windowId !== state.attention?.windowId;
      return { ...(elsewhere ? dropAttention(state) : state), focusedWindow: event.windowId };
    }
    case 'activate': {
      const hidden = event.windowId === state.attention?.windowId && event.tabId !== state.attention.tabId;
      return { ...(hidden ? dropAttention(state) : state), activeTabs: { ...state.activeTabs, [String(event.windowId)]: event.tabId } };
    }
    case 'attention':
      if (!event.present) return dropAttention(state, (held) => held === event.tabId);
      return { ...state, attention: { tabId: event.tabId, windowId: event.windowId, at: event.at } };
    case 'url':
      return navigate(state, event.tabId, event.site, event.audible, event.nav === true, event.at);
    case 'idle':
      return { ...state, idle: event.state };
    case 'media': {
      const key = String(event.tabId);
      const tab = own(state.tabs, key);
      const media = signal(tab?.media, 'msg', event.playing, event.at, event.watched === true);
      if (media === tab?.media) return state;
      return { ...state, tabs: { ...state.tabs, [key]: tabWith(tab?.site ?? null, media) } };
    }
    case 'pause':
      return { ...state, paused: event.paused };
    case 'tick':
      return state;
    case 'close': {
      const kept = dropAttention(state, (held) => held === event.tabId);
      return {
        ...kept,
        tabs: without(state.tabs, (key) => key === String(event.tabId)),
        activeTabs: without(state.activeTabs, (_, tabId) => tabId === event.tabId),
      };
    }
    case 'seed': {
      const seeded = { ...dropAttention(state), focusedWindow: event.windowId, idle: event.idle, needsReseed: false };
      if (event.windowId === null || event.tabId === null) return seeded;
      const active = { ...seeded, activeTabs: { ...seeded.activeTabs, [String(event.windowId)]: event.tabId } };
      return navigate(active, event.tabId, event.site, event.audible, false, event.at);
    }
  }
}
