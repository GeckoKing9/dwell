import { t } from '../../shared/i18n.ts';
import { durationText } from '../../shared/ui/Duration.tsx';
import { Track } from '../../shared/ui/Track.tsx';
import type { WeekAggregate } from '../../stats/aggregate.ts';
import { categoryName, percentText } from '../labels.ts';

/** Horizontal bars sorted by time, never a pie; every value is printed beside its bar. */
export function Categories({ agg }: { agg: WeekAggregate }) {
  const rows = [...agg.categories].sort((a, b) => b.seconds - a.seconds);
  const max = Math.max(1, rows[0]?.seconds ?? 0);
  return (
    <section class="panel" id="categories" aria-labelledby="categories-title">
      <div class="panel-head">
        <h2 id="categories-title">{t('categories')}</h2>
        <span class="aside">{durationText(agg.total)}</span>
      </div>
      {rows.map((row) => (
        <div class="cat-row" key={row.category}>
          <span class="n">{categoryName(row.category)}</span>
          <Track fraction={row.seconds / max} />
          <span class="v">
            {row.seconds > 0 ? durationText(row.seconds) : '\u2013'}
            <span>{agg.total > 0 ? percentText((row.seconds / agg.total) * 100) : ''}</span>
          </span>
        </div>
      ))}
    </section>
  );
}
