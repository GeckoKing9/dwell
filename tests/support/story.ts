import { addAttributions } from '../../src/tracker/buckets.ts';
import { createInitialState, reduce } from '../../src/tracker/engine.ts';
import type { Buckets, EngineEvent, EngineState, TrackerSettings } from '../../src/tracker/types.ts';
import type { EventBody } from './arbitraries.ts';
import { siteTotals, type SiteTotal } from './helpers.ts';

export const DEFAULTS: TrackerSettings = { idleThresholdSec: 60, mediaOverride: true, heartbeatSec: 60, gapMultiplier: 3, visitGapSec: 60 };

/** A scripted session: events at a moving clock, with the heartbeat alarm firing while time passes. */
export class Story {
  at: number;
  state: EngineState;
  buckets: Buckets = {};
  readonly log: EngineEvent[] = [];

  constructor(
    startAt: number,
    readonly settings: TrackerSettings = DEFAULTS,
  ) {
    this.at = startAt;
    this.state = createInitialState(startAt);
  }

  emit(...bodies: EventBody[]): this {
    for (const body of bodies) {
      const event = { ...body, at: this.at } as EngineEvent;
      this.log.push(event);
      const result = reduce(this.state, event, this.settings);
      this.state = result.state;
      this.buckets = addAttributions(this.buckets, result.attributions);
    }
    return this;
  }

  /** Lets `seconds` pass with a heartbeat tick every full heartbeat. */
  wait(seconds: number): this {
    let left = seconds;
    while (left >= this.settings.heartbeatSec) {
      this.at += this.settings.heartbeatSec * 1000;
      left -= this.settings.heartbeatSec;
      this.emit({ type: 'tick' });
    }
    this.at += left * 1000;
    return this;
  }

  /** Lets time pass with no event at all (sleep, a dead worker, a lost alarm). */
  sleep(seconds: number): this {
    this.at += seconds * 1000;
    return this;
  }

  /** Worker termination: the state goes through storage as JSON. */
  restart(): this {
    this.state = JSON.parse(JSON.stringify(this.state)) as EngineState;
    return this;
  }

  end(): this {
    return this.emit({ type: 'tick' });
  }

  total(site: string): SiteTotal {
    return siteTotals(this.buckets)[site] ?? { seconds: 0, visits: 0 };
  }
}

export function openTab(windowId: number, tabId: number, site: string | null, audible?: boolean): EventBody[] {
  const url: EventBody = audible === undefined ? { type: 'url', tabId, site } : { type: 'url', tabId, site, audible };
  return [url, { type: 'activate', windowId, tabId }];
}
