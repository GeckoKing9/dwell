import { dateLocale, t, tParts } from '../../shared/i18n.ts';
import { Duration, durationText } from '../../shared/ui/Duration.tsx';
import type { UsualStats } from '../data.ts';

interface HeroProps {
  now: Date;
  total: number;
  usual: UsualStats;
  paused: boolean;
  firstRun: boolean;
}

/** Like-for-like comparison first, then the 7-day average over the days that have data. */
function Compare({ usual }: { usual: UsualStats }) {
  const avg = durationText(usual.average);
  let line = t('avg7few', { n: usual.recorded, d: avg });
  if (usual.recorded >= 7) line = t('avg7', { d: avg });
  else if (usual.recorded === 1) line = t('avg7one', { d: avg });
  return (
    <p class="pp-compare">
      {tParts('usually', { d: <b>{durationText(usual.byNow)}</b> })}
      <br />
      {line}
    </p>
  );
}

/** Today's total, the one-second read. */
export function Hero({ now, total, usual, paused, firstRun }: HeroProps) {
  const date = new Intl.DateTimeFormat(dateLocale(), { weekday: 'short', month: 'short', day: 'numeric' }).format(now);
  let label = t('todaySoFar');
  if (firstRun) label = t('today');
  else if (paused) label = t('pausedHero');
  return (
    <section class="pp-hero" aria-label={t('today')}>
      <p class="label">
        <span>{label}</span>
        <span class="date">{date}</span>
      </p>
      {firstRun ? (
        <>
          <h1 class="hero-num is-first">{t('firstTitle')}</h1>
          <p class="pp-compare">{t('firstBody')}</p>
        </>
      ) : (
        <>
          <Duration as="h1" class={paused ? 'hero-num is-quiet' : 'hero-num'} seconds={total} />
          {!paused && usual.recorded > 0 ? <Compare usual={usual} /> : null}
        </>
      )}
    </section>
  );
}
