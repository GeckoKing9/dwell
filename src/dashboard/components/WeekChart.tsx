import type { Ref } from 'preact';
import { t } from '../../shared/i18n.ts';
import { durationText } from '../../shared/ui/Duration.tsx';
import { DotChannel } from '../../shared/ui/chart.tsx';
import { ChartTip } from '../../shared/ui/ChartTip.tsx';
import type { DayStatus } from '../../stats/aggregate.ts';
import { dateString } from '../../store/schema.ts';
import { barClass, column, columnLabel } from '../bars.ts';
import { fmtDate, hoursLabel } from '../labels.ts';
import type { ChartDay, WeekModel } from '../model.ts';
import { ChartHit } from './ChartHit.tsx';

const H = 256;
const PAD_L = 34;
const PAD_R = 8;
const PLOT_H = 196;
const BASE = 14 + PLOT_H;
/** Bands narrower than this get one-letter day names. */
const NARROW_BAND = 74;

export interface ChartProps {
  /** Rendered width of the chart wrapper in CSS pixels; the chart is drawn at that width so type stays 11 to 12px. */
  width: number;
  active: number | null;
  onActive(index: number | null): void;
  /** Measures the wrapper; null where nothing needs measuring (tests). */
  wrapRef: Ref<HTMLDivElement>;
}

/** Hours on the scale: at least 4, else the busiest day rounded up to the hour. */
export function weekScaleHours(days: readonly ChartDay[]): number {
  return Math.max(4, Math.ceil(Math.max(0, ...days.map((d) => d.cell.total)) / 3600));
}

function dayName(d: ChartDay, narrow: boolean): string {
  if (narrow) return fmtDate(d.cell.date, { weekday: 'narrow' });
  return d.isToday ? t('today') : fmtDate(d.cell.date, { weekday: 'short', day: 'numeric' });
}

/** The value under a column: the day's total, or the focused site's part of it (a dash when it was not used). */
function dayValue(d: ChartDay, narrow: boolean, site: number | null): string {
  switch (d.cell.status) {
    case 'data':
      if (site === null) return durationText(d.cell.total);
      return site > 0 ? durationText(site) : '–';
    case 'empty':
      return narrow ? '–' : t('noData');
    case 'old':
      return narrow ? '' : t('notKept');
    default:
      return '';
  }
}

/** A column with nothing to open says what its visible text says: no data, not kept, or just its date. */
function inertLabel(date: string, status: DayStatus): string {
  if (status === 'empty') return `${date}, ${t('noData')}`;
  return status === 'old' ? `${date}, ${t('notKept')}` : date;
}

interface WeekChartProps extends ChartProps {
  model: WeekModel;
  /** Opens the day view for a 'YYYY-MM-DD' date. */
  onOpen(date: string): void;
}

/**
 * Seven columns in channels of time-dots (1 dot = 15 minutes), today in the accent, the daily average as a
 * line. With a site focused, every column is the neutral bar with the site's part in the accent, and the
 * line is the site's average. Columns are keyed by weekday so a change of week animates their heights.
 */
export function WeekChart({ model, width, active, onActive, onOpen, wrapRef }: WeekChartProps) {
  const W = Math.max(280, Math.round(width));
  const maxH = weekScaleHours(model.days);
  const rows = maxH * 4;
  const step = PLOT_H / rows;
  const band = (W - PAD_L - PAD_R) / 7;
  const bw = Math.min(24, band * 0.4);
  const narrow = band < NARROW_BAND;
  const focus = model.focus;
  const height = (s: number): number => (s / 3600) * (PLOT_H / maxH);
  const average = focus ? focus.dailyAverage : model.agg.dailyAverage;
  const avgY = BASE - height(average);
  const showAvg = model.fullDays >= 2 && average > 0;
  const tipDay = active === null ? undefined : model.days[active];
  const ticks = Array.from({ length: Math.floor(maxH / 2) }, (_, i) => (i + 1) * 2);
  return (
    <div class="chart-wrap" data-chart="week" ref={wrapRef}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={t('chartTitle')}>
        {showAvg ? <line class="wc-avg-line" x1={PAD_L} x2={W - PAD_R} y1={avgY} y2={avgY} /> : null}
        {ticks.map((hh) => (
          <text key={hh} class="wc-axis" x={PAD_L - 10} y={BASE - height(hh * 3600) + 4} text-anchor="end">
            {hoursLabel(hh)}
          </text>
        ))}
        {model.days.map((d, k) => {
          const cx = PAD_L + band * (k + 0.5);
          const site = focus ? (focus.days[k] ?? 0) : null;
          const bar = column(cx - bw / 2, BASE, bw, height(d.cell.total));
          const part = column(cx - bw / 2, BASE, bw, height(site ?? 0));
          const date = fmtDate(d.cell.date, { weekday: 'long', month: 'long', day: 'numeric' });
          const sitePart = focus && site !== null ? { site: focus.site, part: site > 0 ? durationText(site) : t('colNotUsed') } : null;
          const label = d.cell.status === 'data' ? columnLabel(date, durationText(d.cell.total), sitePart) : inertLabel(date, d.cell.status);
          return (
            <g key={k}>
              <DotChannel cx={cx} base={BASE} rows={rows} step={step} majorEvery={4} faint={d.cell.status === 'future' || d.cell.status === 'old'} />
              <path class={barClass('chart-bar', bar, d.isToday && !focus, active === k)} d={bar.d} />
              <path class={part.empty ? 'chart-part is-empty' : 'chart-part'} d={part.d} />
              <text class={d.isToday ? 'wc-day is-today' : 'wc-day'} x={cx} y={BASE + 22} text-anchor="middle">
                {dayName(d, narrow)}
              </text>
              <text class="wc-val" x={cx} y={BASE + 40} text-anchor="middle">
                {dayValue(d, narrow, site)}
              </text>
              <ChartHit
                  id={`week-col-${k}`}
                  disabled={d.cell.status !== 'data'}
                  x={cx - band / 2 + 2}
                  width={band - 4}
                  height={H}
                  rx={6}
                  label={label}
                  data={{ 'data-day': dateString(d.cell.date) }}
                  onActive={(on) => onActive(on ? k : null)}
                  onActivate={() => onOpen(dateString(d.cell.date))}
                />
            </g>
          );
        })}
        {showAvg ? (
          <text class="wc-avg" x={W - PAD_R} y={avgY - 6} text-anchor="end">
            {t('avgLine', { d: durationText(average) })}
          </text>
        ) : null}
      </svg>
      {tipDay && tipDay.cell.status === 'data' && active !== null ? (
        <ChartTip
          x={PAD_L + band * (active + 0.5)}
          y={BASE - height(tipDay.cell.total)}
          viewWidth={W}
          title={fmtDate(tipDay.cell.date, { weekday: 'short', month: 'short', day: 'numeric' })}
          value={durationText(tipDay.cell.total)}
          rows={tipDay.top.map((s) => ({ label: s.site, value: durationText(s.seconds) }))}
          foot={t('tipHourly')}
        />
      ) : null}
    </div>
  );
}
