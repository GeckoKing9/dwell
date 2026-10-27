import { t } from '../../shared/i18n.ts';
import { durationText } from '../../shared/ui/Duration.tsx';
import { DotChannel } from '../../shared/ui/chart.tsx';
import { ChartTip } from '../../shared/ui/ChartTip.tsx';
import { barClass, column, columnLabel } from '../bars.ts';
import { hourLabel, hourRangeText, minutesLabel } from '../labels.ts';
import type { DayModel } from '../model.ts';
import { ChartHit } from './ChartHit.tsx';
import type { ChartProps } from './WeekChart.tsx';

/** The week chart's height, so moving between the week and a day does not shift the panels below. */
const H = 256;
const PAD_L = 34;
const PAD_R = 8;
const TOP = 12;
const PLOT_H = 188;
const BASE = TOP + PLOT_H;
/** 12 dots of 5 minutes: the scale is fixed at 60 minutes, so an hour can never look fuller than it was. */
const ROWS = 12;

interface DayChartProps extends ChartProps {
  model: DayModel;
  /** The selected hour, or null. */
  hour: number | null;
  /** Selects an hour; the selected one again clears it. */
  onHour(hour: number): void;
}

/** Which column carries the accent: the selected hour, else the busiest; none while a site is focused (its parts do). */
function accentHour(model: DayModel, hour: number | null): number | null {
  if (model.focus) return null;
  return hour ?? model.peak;
}

/**
 * 24 hourly columns, the busiest (or selected) hour in the accent, and a `now` line on today. With a site
 * focused, every column is the neutral bar with the site's part in the accent. Each hour with time is a
 * button that selects it; the selected hour stays shaded while a site is focused.
 */
export function DayChart({ model, hour, onHour, width, active, onActive, wrapRef }: DayChartProps) {
  const W = Math.max(280, Math.round(width));
  const step = PLOT_H / ROWS;
  const band = (W - PAD_L - PAD_R) / 24;
  const bw = Math.min(16, band * 0.56);
  const nowHour = model.now.getHours();
  const height = (s: number): number => (s / 3600) * PLOT_H;
  const nowX = PAD_L + band * (nowHour + model.now.getMinutes() / 60);
  const tipHour = active === null ? 0 : (model.agg.hours[active] ?? 0);
  const focus = model.focus;
  const accent = accentHour(model, hour);
  return (
    <div class="chart-wrap" data-chart="day" ref={wrapRef}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={t('hourlyTitle')}>
        {[6, 12].map((r) => (
          <text key={r} class="wc-axis" x={PAD_L - 10} y={BASE - r * step + 4} text-anchor="end">
            {minutesLabel(r * 5)}
          </text>
        ))}
        {model.agg.hours.map((s, x) => {
          const cx = PAD_L + band * (x + 0.5);
          const site = focus ? (focus.hours[x] ?? 0) : 0;
          const bar = column(cx - bw / 2, BASE, bw, height(s));
          const part = column(cx - bw / 2, BASE, bw, height(site));
          const sitePart = focus ? { site: focus.site, part: site > 0 ? durationText(site) : t('colNotUsed') } : null;
          const label = s > 0 ? columnLabel(hourRangeText(x), durationText(s), sitePart) : hourRangeText(x);
          return (
            <g key={x}>
              <DotChannel cx={cx} base={BASE} rows={ROWS} step={step} majorEvery={3} faint={model.isToday && x > nowHour} />
              <path class={barClass('chart-bar', bar, x === accent, active === x, focus !== null && hour === x)} d={bar.d} />
              <path class={part.empty ? 'chart-part is-empty' : 'chart-part'} d={part.d} />
              {x % 6 === 0 ? (
                <text class="dc-hour" x={PAD_L + band * x} y={BASE + 22}>
                  {hourLabel(x)}
                </text>
              ) : null}
              <ChartHit
                  id={`day-hour-${x}`}
                  disabled={!(s > 0)}
                  x={cx - band / 2}
                  width={band}
                  height={BASE + 4}
                  rx={4}
                  label={label}
                  pressed={hour === x}
                  data={{ 'data-hour': String(x) }}
                  onActive={(on) => onActive(on ? x : null)}
                  onActivate={() => onHour(x)}
                />
            </g>
          );
        })}
        {model.isToday ? (
          <>
            <line class="dc-now-line" x1={nowX} x2={nowX} y1={TOP - 4} y2={BASE} />
            <text class="dc-now" x={nowX + 4} y={TOP + 4}>
              {t('nowMark')}
            </text>
          </>
        ) : null}
      </svg>
      {active !== null && tipHour > 0 ? (
        <ChartTip
          x={PAD_L + band * (active + 0.5)}
          y={BASE - height(tipHour)}
          viewWidth={W}
          title={hourRangeText(active)}
          value={durationText(tipHour)}
          rows={(model.agg.hourSites[active] ?? []).map((s) => ({ label: s.site, value: durationText(s.seconds) }))}
          foot={hour === active ? t('tipHourSelected') : t('tipHour')}
        />
      ) : null}
    </div>
  );
}
