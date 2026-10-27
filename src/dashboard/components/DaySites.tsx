import { t } from '../../shared/i18n.ts';
import { durationText } from '../../shared/ui/Duration.tsx';
import { LetterMark } from '../../shared/ui/LetterMark.tsx';
import { Track } from '../../shared/ui/Track.tsx';
import type { SiteTime } from '../../stats/aggregate.ts';
import { hourRangeText } from '../labels.ts';
import type { DayModel } from '../model.ts';
import { idSlug } from '../settingsUi.ts';

export const DAY_SITES = 8;

interface DaySitesProps {
  model: DayModel;
  /** The selected hour: the panel then lists every site of that hour. */
  hour: number | null;
  onSite(site: string): void;
  onHour(hour: number | null): void;
}

function SiteRow({ s, max, selected, onSite }: { s: SiteTime; max: number; selected: boolean; onSite(site: string): void }) {
  return (
    <li class={selected ? 'site-row is-selected' : 'site-row'}>
      <button
        type="button"
        class="row-pick"
        id={`day-pick-${idSlug(s.site)}`}
        aria-label={t('focusSite', { s: s.site })}
        aria-pressed={selected ? 'true' : 'false'}
        onClick={() => onSite(s.site)}
      />
      <LetterMark site={s.site} />
      <span class="name">{s.site}</span>
      <span class="time">{durationText(s.seconds)}</span>
      <Track fraction={max > 0 ? s.seconds / max : 0} accent={selected} />
    </li>
  );
}

/** The day's top sites, or every site of the selected hour, busiest first; each row focuses its site. */
export function DaySites({ model, hour, onSite, onHour }: DaySitesProps) {
  const sites: readonly SiteTime[] = hour === null ? model.agg.sites.slice(0, DAY_SITES) : (model.byHour[hour] ?? []);
  const max = sites[0]?.seconds ?? 0;
  const total = hour === null ? model.agg.total : (model.agg.hours[hour] ?? 0);
  return (
    <section class="panel" id="day-sites" aria-labelledby="day-sites-title">
      <div class="panel-head">
        <h2 id="day-sites-title">{hour === null ? t('dayTop') : t('hourSites', { h: hourRangeText(hour) })}</h2>
        <span class="aside">{durationText(total)}</span>
        {hour !== null ? (
          <button type="button" id="hour-clear" class="btn btn-quiet" title={t('hourClearKey')} onClick={() => onHour(null)}>
            {t('hourClear')}
          </button>
        ) : null}
      </div>
      {sites.length === 0 ? (
        <p class="empty-note">{t('dayEmpty')}</p>
      ) : (
        <ol>
          {sites.map((s) => (
            <SiteRow key={s.site} s={s} max={max} selected={s.site === model.focus?.site} onSite={onSite} />
          ))}
        </ol>
      )}
    </section>
  );
}
