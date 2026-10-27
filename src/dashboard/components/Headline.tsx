import type { ComponentChildren } from 'preact';
import { t, tParts } from '../../shared/i18n.ts';
import { Duration, durationText } from '../../shared/ui/Duration.tsx';
import { addDays } from '../../stats/weeks.ts';
import type { DayCell, SiteDelta } from '../../stats/aggregate.ts';
import { fmtDate, percentText } from '../labels.ts';
import type { WeekModel } from '../model.ts';
import { FocusChip } from './FocusChip.tsx';
import { GapNote } from './GapNote.tsx';

/** The headline labels say whose figures they are: the week's, or the selected site's. */
function totalLabel(current: boolean, focused: boolean): string {
  if (focused) return current ? t('focusWeekTotal') : t('focusWeekTotalPast');
  return current ? t('weekTotal') : t('weekTotalPast');
}

function averageLabel(current: boolean, focused: boolean): string {
  if (focused) return current ? t('focusDailyAvgFull') : t('focusDailyAvg');
  return current ? t('dailyAvgFull') : t('dailyAvg');
}

export function Stat({ label, seconds, hero = false }: { label: string; seconds: number; hero?: boolean }) {
  return (
    <div class={hero ? 'stat is-hero' : 'stat'}>
      <div class="label">{label}</div>
      <Duration class="value" seconds={seconds} />
    </div>
  );
}

/** The days of the week before a focused site is compared over, named, for when it was not used on them. */
function notUsedText(model: WeekModel): string {
  const day = (k: number): string => fmtDate(addDays(model.week.start, k), { weekday: 'short' });
  const first = model.agg.compared[0] ?? 0;
  const last = model.agg.compared.at(-1) ?? first;
  return first === last ? t('focusDeltaNewOne', { a: day(first) }) : t('focusDeltaNew', { a: day(first), b: day(last) });
}

/** Week-over-week, with the comparison base named and only the number in bold; `notUsed` words a site's 'new'. */
function DeltaLine({ delta, previousAverage, notUsed = '' }: { delta: SiteDelta; previousAverage: number | null; notUsed?: string }) {
  const d = durationText(previousAverage ?? 0);
  const p = <b>{delta.percent}</b>;
  let parts: ComponentChildren = t('deltaNone');
  if (delta.kind === 'new') parts = notUsed;
  else if (delta.kind === 'same') parts = tParts<ComponentChildren>('deltaSame', { d });
  else if (delta.kind === 'less') parts = tParts<ComponentChildren>('deltaLess', { p, d });
  else if (delta.kind === 'more') parts = tParts<ComponentChildren>('deltaMore', { p, d });
  return <p id="delta-line">{parts}</p>;
}

function dayAndTotal(cell: DayCell): string {
  return `${fmtDate(cell.date, { weekday: 'long' })} ${durationText(cell.total)}`;
}

function Notes({ model, onClear }: { model: WeekModel; onClear(): void }) {
  const { agg, focus } = model;
  if (focus) {
    return (
      <>
        <FocusChip site={focus.site} onClear={onClear} />
        {agg.daysWithData === 0 ? (
          <p>{t('emptyWeek')}</p>
        ) : (
          <>
            {focus.total === 0 ? <p>{t('focusWeekEmpty', { s: focus.site })}</p> : null}
            <DeltaLine delta={focus.delta} previousAverage={focus.previousAverage} notUsed={notUsedText(model)} />
            {focus.total > 0 ? <p id="focus-share">{t('focusShareWeek', { p: percentText(focus.share) })}</p> : null}
            <GapNote model={model} />
          </>
        )}
      </>
    );
  }
  if (agg.daysWithData === 0) return <p>{t('emptyWeek')}</p>;
  return (
    <>
      <DeltaLine delta={agg.delta} previousAverage={agg.previousAverage} />
      {model.fullDays >= 2 && agg.quietest && agg.busiest ? (
        <p>{tParts<ComponentChildren>('quietBusy', { q: <b>{dayAndTotal(agg.quietest)}</b>, b: <b>{dayAndTotal(agg.busiest)}</b> })}</p>
      ) : null}
      <GapNote model={model} />
    </>
  );
}

/**
 * The week in one read: total, daily average over full days, then the plain-words notes. With a site
 * focused, the figures are that site's and the notes open with its chip.
 */
export function Headline({ model, onSite }: { model: WeekModel; onSite(site: string | null): void }) {
  const focus = model.focus;
  return (
    <section class="headline" aria-label={t('weekTotalPast')}>
      <Stat hero label={totalLabel(model.current, focus !== null)} seconds={focus ? focus.total : model.agg.total} />
      <Stat label={averageLabel(model.current, focus !== null)} seconds={focus ? focus.dailyAverage : model.agg.dailyAverage} />
      <div class="headline-notes">
        <Notes model={model} onClear={() => onSite(null)} />
      </div>
    </section>
  );
}
