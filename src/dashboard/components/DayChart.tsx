import { t } from '../../shared/i18n.ts';
import { durationText } from '../../shared/ui/Duration.tsx';
import { barPath, DotChannel } from '../../shared/ui/chart.tsx';
import { ChartTip } from '../../shared/ui/ChartTip.tsx';
import { hourLabel, hourRangeText, minutesLabel } from '../labels.ts';
import type { DayModel } from '../model.ts';
import type { ChartProps } from './WeekChart.tsx';

const H = 236;
const PAD_L = 34;
const PAD_R = 8;
const TOP = 12;
const PLOT_H = 168;
const BASE = TOP + PLOT_H;
/** 12 dots of 5 minutes: the scale is fixed at 60 minutes, so an hour can never look fuller than it was. */
const ROWS = 12;

/** 24 hourly columns, the busiest hour in the accent, and a `now` line on today. */
export function DayChart({ model, width, active, onActive, wrapRef }: ChartProps & { model: DayModel }) {
  const W = Math.max(280, Math.round(width));
  const step = PLOT_H / ROWS;
  const band = (W - PAD_L - PAD_R) / 24;
  const bw = Math.min(16, band * 0.56);
  const nowHour = model.now.getHours();
  const height = (s: number): number => (s / 3600) * PLOT_H;
  const nowX = PAD_L + band * (nowHour + model.now.getMinutes() / 60);
  const tipHour = active === null ? 0 : (model.agg.hours[active] ?? 0);
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
          const hgt = height(s);
          let barClass = 'chart-bar';
          if (x === model.peak) barClass = 'chart-bar is-accent';
          else if (active === x) barClass = 'chart-bar is-hover';
          return (
            <g key={x}>
              <DotChannel cx={cx} base={BASE} rows={ROWS} step={step} majorEvery={3} faint={model.isToday && x > nowHour} />
              {hgt > 0 ? <path class={barClass} d={barPath(cx - bw / 2, BASE, bw, Math.max(2, hgt))} /> : null}
              {x % 6 === 0 ? (
                <text class="dc-hour" x={PAD_L + band * x} y={BASE + 22}>
                  {hourLabel(x)}
                </text>
              ) : null}
              {s > 0 ? (
                <>
                  <rect
                    class="hit"
                    x={cx - band / 2}
                    y={0}
                    width={band}
                    height={BASE + 4}
                    fill="transparent"
                    tabindex={0}
                    aria-label={`${hourRangeText(x)}, ${durationText(s)}`}
                    onPointerEnter={() => onActive(x)}
                    onPointerLeave={() => onActive(null)}
                    onFocus={() => onActive(x)}
                    onBlur={() => onActive(null)}
                  />
                  <rect class="focus-ring" x={cx - band / 2 + 1} y={1} width={band - 2} height={BASE + 2} rx={4} />
                </>
              ) : null}
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
        />
      ) : null}
    </div>
  );
}
