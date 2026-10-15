/**
 * Keeps the four static DNR rulesets in step with the blocker toggles (R14, R18). Idempotent: it
 * states the whole wanted set every time, so it is safe on every start and after every change.
 */
import type { Settings } from '../store/schema.ts';

type Blockers = Settings['blockers'];

/** Blocker toggle -> ruleset id in manifest.json. */
export const RULESET_IDS: Readonly<Record<keyof Blockers, string>> = Object.freeze({
  instagramReels: 'instagram-reels',
  youtubeShorts: 'youtube-shorts',
  facebookReels: 'facebook-reels',
  instagramExplore: 'instagram-explore',
});

export async function reconcileRulesets(blockers: Blockers): Promise<void> {
  const enableRulesetIds: string[] = [];
  const disableRulesetIds: string[] = [];
  for (const key of Object.keys(RULESET_IDS) as (keyof Blockers)[]) {
    (blockers[key] ? enableRulesetIds : disableRulesetIds).push(RULESET_IDS[key]);
  }
  await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
}
