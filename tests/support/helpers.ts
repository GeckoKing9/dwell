import { createInitialState, reduce } from '../../src/tracker/engine.ts';
import type { Attribution, Buckets, EngineEvent, EngineState, TrackerSettings } from '../../src/tracker/types.ts';

export interface Step {
  before: EngineState;
  event: EngineEvent;
  attributions: Attribution[];
  after: EngineState;
}

/** Reduces event by event and keeps every intermediate state. */
export function steps(events: readonly EngineEvent[], settings: TrackerSettings, startAt: number): Step[] {
  let state = createInitialState(startAt);
  return events.map((event) => {
    const { state: after, attributions } = reduce(state, event, settings);
    const step = { before: state, event, attributions, after };
    state = after;
    return step;
  });
}

export function secondsOf(attributions: readonly Attribution[]): number {
  return attributions.reduce((sum, a) => sum + a.seconds, 0);
}

export interface SiteTotal {
  seconds: number;
  visits: number;
}

export function siteTotals(buckets: Buckets): Record<string, SiteTotal> {
  const totals: Record<string, SiteTotal> = Object.create(null) as Record<string, SiteTotal>;
  for (const sites of Object.values(buckets)) {
    for (const [site, bucket] of Object.entries(sites)) {
      const total = (totals[site] ??= { seconds: 0, visits: 0 });
      total.seconds += Object.values(bucket.h).reduce((sum, s) => sum + s, 0);
      total.visits += bucket.v;
    }
  }
  return totals;
}

export function totalSeconds(buckets: Buckets): number {
  return Object.values(siteTotals(buckets)).reduce((sum, t) => sum + t.seconds, 0);
}

/** Local day and hour labels of every whole second in [from, to). */
export function hourLabels(from: number, to: number): Set<string> {
  const labels = new Set<string>();
  for (let t = from; t < to; t += 1000) {
    const d = new Date(t);
    labels.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}@${d.getHours()}`);
  }
  return labels;
}
