import { t } from '../../shared/i18n.ts';
import { BLOCKED_SITES } from '../../store/schema.ts';
import type { BlockedSite } from '../../store/schema.ts';
import { blockedSiteName } from '../labels.ts';

/** Past this many redirects in a week the dots stop; the count beside them stays exact. */
export const MAX_DOTS = 500;

/** Redirects as information: the week's count and one dot per redirect, never a score. */
export function Blocked({ blocked }: { blocked: Record<BlockedSite, number> }) {
  const total = BLOCKED_SITES.reduce((sum, site) => sum + blocked[site], 0);
  return (
    <section class="panel" id="blocked" aria-labelledby="blocked-title">
      <div class="panel-head">
        <h2 id="blocked-title">{t('blocked')}</h2>
      </div>
      <div class="blk-total">
        <span class="n num">{total}</span>
        <p>{t('blockedLine')}</p>
      </div>
      {BLOCKED_SITES.map((site) => (
        <div class="blk-row" key={site} data-site={site}>
          <span class="n">{blockedSiteName(site)}</span>
          <span class="c">{blocked[site]}</span>
          <div class="blk-dots" aria-hidden="true">
            {Array.from({ length: Math.min(MAX_DOTS, blocked[site]) }, (_, i) => (
              <i key={i} />
            ))}
          </div>
        </div>
      ))}
      <p class="blk-note">{t('blockedNote')}</p>
    </section>
  );
}
