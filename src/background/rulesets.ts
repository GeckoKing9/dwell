/**
 * Keeps the five static DNR rulesets in step with the blocker toggles (R14, R18). It reads what
 * Chrome has enabled first and writes only when that differs, so a worker that wakes every few
 * minutes makes no DNR write at all while nothing changed; when it does write, it states the whole
 * wanted set, so the result never depends on what was enabled before.
 */
import type { Settings } from '../store/schema.ts';

type Blockers = Settings['blockers'];

/** Blocker toggle -> ruleset id in manifest.json. */
export const RULESET_IDS: Readonly<Record<keyof Blockers, string>> = Object.freeze({
  instagramReels: 'instagram-reels',
  youtubeShorts: 'youtube-shorts',
  facebookReels: 'facebook-reels',
  xVideos: 'x-videos',
  instagramExplore: 'instagram-explore',
});

export async function reconcileRulesets(blockers: Blockers): Promise<void> {
  const enableRulesetIds: string[] = [];
  const disableRulesetIds: string[] = [];
  for (const key of Object.keys(RULESET_IDS) as (keyof Blockers)[]) {
    (blockers[key] ? enableRulesetIds : disableRulesetIds).push(RULESET_IDS[key]);
  }
  const enabled = new Set(await chrome.declarativeNetRequest.getEnabledRulesets());
  const inStep = enableRulesetIds.every((id) => enabled.has(id)) && disableRulesetIds.every((id) => !enabled.has(id));
  if (inStep) return;
  await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
}
