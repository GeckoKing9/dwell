import type { Buckets, EngineEvent, IdleState, TrackerSettings } from '../../src/tracker/types.ts';

/*
 * Naive reference model. It shares nothing with src/tracker except the types: it keeps the
 * browser inputs in mutable maps, walks time one step at a time (1 s by default), asks the
 * presence question at every step, and drops each completed second into the local day and hour
 * of the step in which it completed. Gap cap, media hold, visits and the sub-second carry are
 * modelled explicitly, step by step.
 */

const MEDIA_HOLD_MS = 30_000;
const DAY_MS = 86_400_000;

interface OracleTab {
  site: string | null;
  source: 'msg' | 'audible' | null;
  on: boolean;
  offAt: number | null;
}

class Browser {
  focused: number | null = null;
  active = new Map<number, number>();
  tabs = new Map<number, OracleTab>();
  idle: IdleState = 'active';
  paused = false;

  private tab(tabId: number): OracleTab {
    let tab = this.tabs.get(tabId);
    if (!tab) {
      tab = { site: null, source: null, on: false, offAt: null };
      this.tabs.set(tabId, tab);
    }
    return tab;
  }

  private signal(tab: OracleTab, source: 'msg' | 'audible', playing: boolean, at: number): void {
    if (source === 'audible' && tab.source === 'msg') return;
    // A stop from a content script ends only playback the content script itself reported.
    if (source === 'msg' && !playing && tab.source !== 'msg') return;
    tab.source = source;
    if (playing) {
      tab.on = true;
    } else if (tab.on) {
      tab.on = false;
      tab.offAt = at;
    }
  }

  private navigate(tabId: number, site: string | null, audible: boolean | undefined, nav: boolean, at: number): void {
    const tab = this.tab(tabId);
    const left = tab.site !== null && tab.site !== site;
    if (left || (nav && tab.source === 'msg')) {
      tab.source = null;
      tab.on = false;
      tab.offAt = null;
    }
    tab.site = site;
    if (audible !== undefined) this.signal(tab, 'audible', audible, at);
  }

  apply(event: EngineEvent): void {
    switch (event.type) {
      case 'focus':
        this.focused = event.windowId;
        break;
      case 'activate':
        this.active.set(event.windowId, event.tabId);
        break;
      case 'url':
        this.navigate(event.tabId, event.site, event.audible, event.nav === true, event.at);
        break;
      case 'idle':
        this.idle = event.state;
        break;
      case 'media':
        this.signal(this.tab(event.tabId), 'msg', event.playing, event.at);
        break;
      case 'pause':
        this.paused = event.paused;
        break;
      case 'tick':
        break;
      case 'close':
        this.tabs.delete(event.tabId);
        for (const [windowId, tabId] of [...this.active]) {
          if (tabId === event.tabId) this.active.delete(windowId);
        }
        break;
      case 'seed':
        this.focused = event.windowId;
        if (event.windowId !== null && event.tabId !== null) {
          this.active.set(event.windowId, event.tabId);
          this.navigate(event.tabId, event.site, event.audible, false, event.at);
        }
        this.idle = event.idle;
        break;
    }
  }

  siteAt(t: number, mediaOverride: boolean): string | null {
    if (this.paused || this.idle === 'locked' || this.focused === null) return null;
    const tabId = this.active.get(this.focused);
    if (tabId === undefined) return null;
    const tab = this.tabs.get(tabId);
    if (!tab || tab.site === null) return null;
    if (this.idle === 'active') return tab.site;
    if (!mediaOverride || tab.source === null) return null;
    const playing = tab.on || (tab.offAt !== null && t < tab.offAt + MEDIA_HOLD_MS);
    return playing ? tab.site : null;
  }
}

function record(out: Buckets, t: number, site: string, second: boolean, visit: boolean): void {
  const d = new Date(t);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const sites = (out[day] ??= {});
  const bucket = (sites[site] ??= { h: {}, v: 0 });
  if (second) {
    const hour = String(d.getHours());
    bucket.h[hour] = (bucket.h[hour] ?? 0) + 1;
  }
  if (visit) bucket.v += 1;
}

/**
 * Buckets for `events` replayed from an initial state whose clock reads `startAt`.
 * Every timestamp must sit on the `stepMs` grid, and `stepMs` must divide 1000.
 */
export function oracleReplay(
  events: readonly EngineEvent[],
  settings: TrackerSettings,
  startAt: number,
  stepMs = 1000,
): Buckets {
  if (1000 % stepMs !== 0) throw new Error('stepMs must divide 1000');
  const browser = new Browser();
  const out: Buckets = {};
  const pendingMs = new Map<string, number>();
  const lastEnd = new Map<string, number>();
  const gapMs = settings.gapMultiplier * settings.heartbeatSec * 1000;
  let last = startAt;

  for (const event of events) {
    if (event.at % stepMs !== 0 || last % stepMs !== 0) throw new Error('timestamp off the step grid');
    if (event.at > last) {
      const stop = event.at - last > gapMs ? last + settings.heartbeatSec * 1000 : event.at;
      for (let t = last; t < stop; t += stepMs) {
        const site = browser.siteAt(t, settings.mediaOverride);
        if (site === null) continue;
        const previous = lastEnd.get(site);
        const visit = previous === undefined || t - previous >= settings.visitGapSec * 1000;
        if (previous !== undefined && t - previous > DAY_MS) pendingMs.set(site, 0);
        const pending = (pendingMs.get(site) ?? 0) + stepMs;
        const second = pending >= 1000;
        pendingMs.set(site, second ? pending - 1000 : pending);
        if (second || visit) record(out, t, site, second, visit);
        lastEnd.set(site, t + stepMs);
      }
      last = event.at;
    }
    browser.apply(event);
  }
  return out;
}
