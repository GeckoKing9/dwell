import type { ComponentChildren } from 'preact';
import { t, tParts } from '../../shared/i18n.ts';
import { Duration, durationText } from '../../shared/ui/Duration.tsx';
import { fmtDate, hourRangeText, percentText, sitesText, visitsText } from '../labels.ts';
import type { DayModel } from '../model.ts';
import { DayChart } from './DayChart.tsx';
import type { DashboardHandlers } from './DashboardView.tsx';
import { DayHead } from './DayHead.tsx';
import { DaySites } from './DaySites.tsx';
import { FocusChip } from './FocusChip.tsx';
import { PausedBanner } from './PausedBanner.tsx';
import type { ChartProps } from './WeekChart.tsx';

export interface DayViewProps {
  model: DayModel;
  paused: boolean;
  chart: ChartProps;
  hour: number | null;
  on: Pick<DashboardHandlers, 'onWeek' | 'onDay' | 'onSite' | 'onHour' | 'onResume'>;
}

function BusiestHour({ peak, seconds }: { peak: number; seconds: number }) {
  return <p id="busiest-hour">{tParts<ComponentChildren>('busiestHour', { h: <b>{hourRangeText(peak)}</b>, d: durationText(seconds) })}</p>;
}

function Notes({ model, onClear }: { model: DayModel; onClear(): void }) {
  const { agg, peak, focus } = model;
  if (focus) {
    return (
      <>
        <FocusChip site={focus.site} onClear={onClear} />
        {focus.peak === null ? (
          <p>{t('focusDayEmpty', { s: focus.site })}</p>
        ) : (
          <>
            <BusiestHour peak={focus.peak} seconds={focus.hours[focus.peak] ?? 0} />
            <p id="focus-share">{t('focusShareDay', { p: percentText(focus.share), v: visitsText(focus.visits) })}</p>
          </>
        )}
      </>
    );
  }
  if (peak === null) return <p>{t('dayEmpty')}</p>;
  return (
    <>
      <BusiestHour peak={peak} seconds={agg.hours[peak] ?? 0} />
      <p>{`${sitesText(agg.sites.length)} · ${visitsText(model.visits)}`}</p>
    </>
  );
}

/**
 * One day: back to its week, Today, previous and next day, the hourly chart and that day's sites. With
 * a site focused the total and notes are that site's; with an hour selected the panel lists that hour.
 */
export function DayView({ model, paused, chart, hour, on }: DayViewProps) {
  return (
    <>
      {paused ? <PausedBanner onResume={on.onResume} /> : null}
      <DayHead model={model} onWeek={on.onWeek} onDay={on.onDay} />
      <section class="headline">
        <div class="stat is-hero">
          <h1 class="label">{fmtDate(model.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h1>
          <Duration class="value" seconds={model.focus ? model.focus.total : model.agg.total} />
        </div>
        <div class="headline-notes">
          <Notes model={model} onClear={() => on.onSite(null)} />
        </div>
      </section>
      <div class="grid">
        <section class="panel" aria-labelledby="hourly-title">
          <div class="panel-head">
            <h2 id="hourly-title">{t('hourlyTitle')}</h2>
            <span class="aside">{t('hourlyAside')}</span>
          </div>
          <DayChart model={model} hour={hour} onHour={on.onHour} {...chart} />
        </section>
        <DaySites model={model} hour={hour} onSite={on.onSite} onHour={on.onHour} />
      </div>
    </>
  );
}
