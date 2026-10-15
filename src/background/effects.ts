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

/**
 * `applySettings` for a value that is already saved. Chrome refusing the change is logged, never
 * thrown: storage holds the truth and the next worker start applies it again. False when it failed.
 */
export async function applySaved(before: Settings | null, after: Settings): Promise<boolean> {
  try {
    await applySettings(before, after);
    return true;
  } catch (error) {
    console.error('Dwell: saved settings not applied yet; the next worker start applies them', error);
    return false;
  }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** True when the override or ignore list changed, so the open tabs may now count as other sites. */
export function groupingChanged(before: Settings, after: Settings): boolean {
  return !sameList(before.overrides, after.overrides) || !sameList(before.ignore, after.ignore);
}
