/** Chrome-side state that follows the settings: the enabled DNR rulesets and the idle detection interval. */
import type { Settings } from '../store/schema.ts';
import { reconcileRulesets } from './rulesets.ts';

/** Applies `after` to Chrome. `before` null means "unknown" (worker start, undo): everything is applied. */
export async function applySettings(before: Settings | null, after: Settings): Promise<void> {
  await reconcileRulesets(after.blockers);
  if (before === null || before.idleThresholdSec !== after.idleThresholdSec) {
    chrome.idle.setDetectionInterval(after.idleThresholdSec);
  }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** True when the override or ignore list changed, so the open tabs may now count as other sites. */
export function groupingChanged(before: Settings, after: Settings): boolean {
  return !sameList(before.overrides, after.overrides) || !sameList(before.ignore, after.ignore);
}
