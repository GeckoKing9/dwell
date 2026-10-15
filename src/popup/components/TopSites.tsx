import { t } from '../../shared/i18n.ts';
import { durationText } from '../../shared/ui/Duration.tsx';
import { LetterMark } from '../../shared/ui/LetterMark.tsx';
import { Track } from '../../shared/ui/Track.tsx';
import type { SiteDay } from '../../stats/aggregate.ts';

/** The day's three busiest sites, each bar relative to the busiest. */
export function TopSites({ sites }: { sites: readonly SiteDay[] }) {
  const max = sites[0]?.seconds ?? 0;
  return (
    <section class="pp-top">
      <h2 class="pp-section-title">{t('topToday')}</h2>
      {sites.length === 0 ? (
        <p class="empty-note">{t('firstTop')}</p>
      ) : (
        <ol>
          {sites.map((s) => (
            <li class="site-row" key={s.site}>
              <LetterMark site={s.site} />
              <span class="name">{s.site}</span>
              <span class="time">{durationText(s.seconds)}</span>
              <Track fraction={max > 0 ? s.seconds / max : 0} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
