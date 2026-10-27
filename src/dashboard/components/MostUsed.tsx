import { t } from '../../shared/i18n.ts';
import { durationText } from '../../shared/ui/Duration.tsx';
import { LetterMark } from '../../shared/ui/LetterMark.tsx';
import { Track } from '../../shared/ui/Track.tsx';
import { addDays } from '../../stats/weeks.ts';
import { categoryName, fmtDate, percentText, sitesText, visitsText } from '../labels.ts';
import { deltaText } from '../model.ts';
import { idSlug } from '../settingsUi.ts';
import type { WeekModel } from '../model.ts';

export const TOP_ROWS = 10;

interface MostUsedProps {
  model: WeekModel;
  showAll: boolean;
  onToggle(): void;
  /** Focuses a row's site; the focused row again clears it. */
  onSite(site: string): void;
}

/** While the week runs, changes compare Monday to today with the same days of the week before, and the panel says so. */
function spanText(model: WeekModel): string {
  const through = model.agg.compare.throughDay;
  if (!model.current || through >= 6) return sitesText(model.agg.sites.length);
  const day = (k: number): string => fmtDate(addDays(model.week.start, k), { weekday: 'short' });
  return t('spanNote', { a: day(0), b: day(Math.max(0, through)) });
}

/** Ranked sites: time, share, change against last week, visits; one meta line under 620px. Each row focuses its site. */
export function MostUsed({ model, showAll, onToggle, onSite }: MostUsedProps) {
  const sites = model.agg.sites;
  const shown = showAll ? sites : sites.slice(0, TOP_ROWS);
  const max = sites[0]?.seconds ?? 0;
  const focused = model.focus?.site;
  return (
    <section class="panel mu" id="most-used" aria-labelledby="mu-title">
      <div class="panel-head">
        <h2 id="mu-title">{t('mostUsed')}</h2>
        <span class="aside">{spanText(model)}</span>
      </div>
      {sites.length === 0 ? (
        <p class="empty-note">{t('emptyWeek')}</p>
      ) : (
        <>
          <div class="mu-row is-head" aria-hidden="true">
            <span />
            <span />
            <span>{t('colSite')}</span>
            <span>{t('colCategory')}</span>
            <span class="t is-label">{t('colTime')}</span>
            <span class="sh">{t('colShare')}</span>
            <span class="dl">{t('colVsLast')}</span>
            <span class="vi">{t('colVisits')}</span>
          </div>
          <ol>
            {shown.map((row, k) => {
              const delta = deltaText(row, model.previous);
              const share = percentText(row.share);
              const category = categoryName(row.category);
              const selected = row.site === focused;
              return (
                <li class={selected ? 'mu-row is-selected' : 'mu-row'} key={row.site}>
                  <button
                    type="button"
                    class="row-pick"
                    id={`mu-pick-${idSlug(row.site)}`}
                    aria-label={t('focusSite', { s: row.site })}
                    aria-pressed={selected ? 'true' : 'false'}
                    onClick={() => onSite(row.site)}
                  />
                  <span class="rank">{k + 1}</span>
                  <LetterMark site={row.site} />
                  <div class="site">
                    <span class="d">{row.site}</span>
                    <Track fraction={max > 0 ? row.seconds / max : 0} accent={selected} />
                    <span class="meta">{[category, share, delta, visitsText(row.visits)].join(' \u00b7 ')}</span>
                  </div>
                  <span class="cat">
                    <span class="chip">{category}</span>
                  </span>
                  <span class="t">{durationText(row.seconds)}</span>
                  <span class="sh">{share}</span>
                  <span class="dl">{delta}</span>
                  <span class="vi">{row.visits}</span>
                </li>
              );
            })}
          </ol>
          {sites.length > TOP_ROWS ? (
            <div class="mu-more">
              <button type="button" id="mu-toggle" class="btn btn-quiet" aria-expanded={showAll ? 'true' : 'false'} onClick={onToggle}>
                {showAll ? t('showFewer') : t('showAll', { n: sites.length })}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
