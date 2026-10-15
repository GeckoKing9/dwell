import type { ComponentChildren } from 'preact';
import { t, tParts } from '../../shared/i18n.ts';
import { Duration, durationText } from '../../shared/ui/Duration.tsx';
import type { DayCell } from '../../stats/aggregate.ts';
import { fmtDate } from '../labels.ts';
import type { WeekModel } from '../model.ts';

export function Stat({ label, seconds, hero = false }: { label: string; seconds: number; hero?: boolean }) {
  return (
    <div class={hero ? 'stat is-hero' : 'stat'}>
      <div class="label">{label}</div>
      <Duration class="value" seconds={seconds} />
    </div>
  );
}

/** Week-over-week, with the comparison base named and only the number in bold. */
function DeltaLine({ model }: { model: WeekModel }) {
  const { delta, previousAverage } = model.agg;
  const d = durationText(previousAverage ?? 0);
  const p = <b>{delta.percent}</b>;
  let parts: ComponentChildren = t('deltaNone');
  if (delta.kind === 'same') parts = tParts<ComponentChildren>('deltaSame', { d });
  else if (delta.kind === 'less') parts = tParts<ComponentChildren>('deltaLess', { p, d });
  else if (delta.kind === 'more') parts = tParts<ComponentChildren>('deltaMore', { p, d });
  return <p id="delta-line">{parts}</p>;
}

function dayAndTotal(cell: DayCell): string {
  return `${fmtDate(cell.date, { weekday: 'long' })} ${durationText(cell.total)}`;
}

function Notes({ model }: { model: WeekModel }) {
  const { agg, gaps, averaged } = model;
  if (agg.daysWithData === 0) return <p>{t('emptyWeek')}</p>;
  const days = gaps.map((g) => fmtDate(g.date, { weekday: 'short', month: 'short', day: 'numeric' })).join(', ');
  return (
    <>
      <DeltaLine model={model} />
      {model.fullDays >= 2 && agg.quietest && agg.busiest ? (
        <p>{tParts<ComponentChildren>('quietBusy', { q: <b>{dayAndTotal(agg.quietest)}</b>, b: <b>{dayAndTotal(agg.busiest)}</b> })}</p>
      ) : null}
      {gaps.length > 0 ? <p id="gap-note">{averaged === 1 ? t('gapNoteOne', { days }) : t('gapNote', { days, n: averaged })}</p> : null}
    </>
  );
}

/** The week in one read: total, daily average over full days, then the plain-words notes. */
export function Headline({ model }: { model: WeekModel }) {
  return (
    <section class="headline" aria-label={t('weekTotalPast')}>
      <Stat hero label={model.current ? t('weekTotal') : t('weekTotalPast')} seconds={model.agg.total} />
      <Stat label={model.current ? t('dailyAvgFull') : t('dailyAvg')} seconds={model.agg.dailyAverage} />
      <div class="headline-notes">
        <Notes model={model} />
      </div>
    </section>
  );
}
