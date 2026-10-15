import type { ComponentChildren } from 'preact';
import { t, tParts } from '../../shared/i18n.ts';
import { Duration, durationText } from '../../shared/ui/Duration.tsx';
import { ArrowIcon } from '../../shared/ui/icons.tsx';
import { LetterMark } from '../../shared/ui/LetterMark.tsx';
import { Track } from '../../shared/ui/Track.tsx';
import { fmtDate, hourRangeText, sitesText, visitsText, weekRangeText } from '../labels.ts';
import type { DayModel } from '../model.ts';
import { DayChart } from './DayChart.tsx';
import { PausedBanner } from './PausedBanner.tsx';
import type { ChartProps } from './WeekChart.tsx';

export const DAY_SITES = 8;

export interface DayViewProps {
  model: DayModel;
  paused: boolean;
  chart: ChartProps;
  onWeek(back: number): void;
  onDay(date: string): void;
  onResume(): void;
}

function Notes({ model }: { model: DayModel }) {
  const { agg, peak } = model;
  if (peak === null) return <p>{t('dayEmpty')}</p>;
  return (
    <>
      <p id="busiest-hour">{tParts<ComponentChildren>('busiestHour', { h: <b>{hourRangeText(peak)}</b>, d: durationText(agg.hours[peak] ?? 0) })}</p>
      <p>{`${sitesText(agg.sites.length)} \u00b7 ${visitsText(model.visits)}`}</p>
    </>
  );
}

/** One day: back to its week, previous and next day, the hourly chart and that day's sites. */
export function DayView({ model, paused, chart, onWeek, onDay, onResume }: DayViewProps) {
  const sites = model.agg.sites.slice(0, DAY_SITES);
  const max = sites[0]?.seconds ?? 0;
  return (
    <>
      {paused ? <PausedBanner onResume={onResume} /> : null}
      <div class="dayhead">
        <button type="button" id="day-back" class="btn" onClick={() => onWeek(model.weekBack)}>
          <ArrowIcon dir="back" />
          {t('backWeek', { r: weekRangeText(model.week) })}
        </button>
        <span class="spacer" />
        <button type="button" id="day-prev" class="icon-btn" aria-label={t('prevDay')} disabled={model.prev === null} onClick={() => model.prev && onDay(model.prev)}>
          <ArrowIcon dir="left" />
        </button>
        <button type="button" id="day-next" class="icon-btn" aria-label={t('nextDay')} disabled={model.next === null} onClick={() => model.next && onDay(model.next)}>
          <ArrowIcon />
        </button>
      </div>
      <section class="headline">
        <div class="stat is-hero">
          <h1 class="label">{fmtDate(model.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h1>
          <Duration class="value" seconds={model.agg.total} />
        </div>
        <div class="headline-notes">
          <Notes model={model} />
        </div>
      </section>
      <div class="grid">
        <section class="panel" aria-labelledby="hourly-title">
          <div class="panel-head">
            <h2 id="hourly-title">{t('hourlyTitle')}</h2>
            <span class="aside">{t('hourlyAside')}</span>
          </div>
          <DayChart model={model} {...chart} />
        </section>
        <section class="panel" id="day-sites" aria-labelledby="day-sites-title">
          <div class="panel-head">
            <h2 id="day-sites-title">{t('dayTop')}</h2>
            <span class="aside">{durationText(model.agg.total)}</span>
          </div>
          {sites.length === 0 ? (
            <p class="empty-note">{t('dayEmpty')}</p>
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
      </div>
    </>
  );
}
