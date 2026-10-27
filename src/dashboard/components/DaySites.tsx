import { t } from '../../shared/i18n.ts';
import { durationText } from '../../shared/ui/Duration.tsx';
import type { SiteTime } from '../../stats/aggregate.ts';
import { hourRangeText } from '../labels.ts';
import type { DayModel } from '../model.ts';
import { DaySiteRow } from './DaySiteRow.tsx';

export const DAY_SITES = 8;

interface DaySitesProps {
  model: DayModel;
  /** The selected hour: the panel then lists every site of that hour. */
  hour: number | null;
  onSite(site: string): void;
  onHour(hour: number | null): void;
}

/** The day's top sites, or every site of the selected hour, busiest first; each row focuses its site. */
export function DaySites({ model, hour, onSite, onHour }: DaySitesProps) {
  const sites: readonly SiteTime[] = hour === null ? model.agg.sites.slice(0, DAY_SITES) : (model.agg.hourAll[hour] ?? []);
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
            <DaySiteRow key={s.site} s={s} max={max} selected={s.site === model.focus?.site} onSite={onSite} />
          ))}
        </ol>
      )}
    </section>
  );
}
