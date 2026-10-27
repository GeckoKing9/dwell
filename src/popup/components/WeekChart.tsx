import { dateLocale, t } from '../../shared/i18n.ts';
import { durationText } from '../../shared/ui/Duration.tsx';
import { barPath, DotChannel } from '../../shared/ui/chart.tsx';
import { ChartTip } from '../../shared/ui/ChartTip.tsx';
import { dateString } from '../../store/schema.ts';
import type { WeekDay } from '../data.ts';

/** Drawn to scale in the popup's 328px content width; each dot is 30 minutes, every hour dot larger. */
export const VIEW_W = 328;
const VIEW_H = 90;
const BASE = 68;
const PLOT_H = 52;
const BAR_W = 18;

interface WeekChartProps {
  days: readonly WeekDay[];
  empty: boolean;
  paused: boolean;
  /** Index of the hovered or focused day, or null. */
  active: number | null;
  onActive(index: number | null): void;
}

/** A day's whole band, bigger than its bar: hover shows the tooltip. */
function Hit({ cx, band, onActive }: { cx: number; band: number; onActive(on: boolean): void }) {
  return (
    <rect
      class="hit"
      x={cx - band / 2}
      y={0}
      width={band}
      height={BASE + 24}
      fill="transparent"
      onPointerEnter={() => onActive(true)}
      onPointerLeave={() => onActive(false)}
    />
  );
}

function fmt(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(dateLocale(), options).format(date);
}

/** Hours on the scale: at least 4, else the busiest day rounded up to the hour. */
export function scaleHours(days: readonly WeekDay[]): number {
  return Math.max(4, Math.ceil(Math.max(0, ...days.map((d) => d.total)) / 3600));
}

/** The dashboard's day view for `date`, from the popup page beside it: a plain link, no extension API. */
export function dayHref(date: Date): string {
  return `../dashboard/index.html#day/${dateString(date)}`;
}

/** Last 7 days in channels of time-dots, today in the accent unless tracking is paused; a day with time opens in the dashboard. */
export function WeekChart({ days, empty, paused, active, onActive }: WeekChartProps) {
  const maxH = scaleHours(days);
  const rows = maxH * 2;
  const step = PLOT_H / rows;
  const band = VIEW_W / days.length;
  const height = (total: number): number => (total / 3600) * (PLOT_H / maxH);
  const summary = days.map((d) => `${fmt(d.date, { weekday: 'short' })} ${d.total > 0 ? durationText(d.total) : '0'}`).join(', ');
  const tipDay = active === null ? undefined : days[active];
  return (
    <figure class="pp-week">
      <div class="chart-wrap">
        <svg width="100%" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={t('weekAria', { chart: t('last7'), list: summary })}>
          {days.map((d, k) => {
            const cx = band * (k + 0.5);
            const hgt = height(d.total);
            const accent = d.isToday && !paused;
            return (
              <g key={k}>
                <DotChannel cx={cx} base={BASE} rows={rows} step={step} majorEvery={2} />
                {hgt > 0 ? <path class={accent ? 'chart-bar is-accent' : 'chart-bar'} d={barPath(cx - BAR_W / 2, BASE, BAR_W, Math.max(2, hgt))} /> : null}
                <text class={d.isToday ? 'pw-day is-today' : 'pw-day'} x={cx} y={BASE + 18} text-anchor="middle">
                  {d.isToday ? t('today') : fmt(d.date, { weekday: 'narrow' })}
                </text>
                {d.total > 0 ? (
                  <a
                    class="day-link"
                    href={dayHref(d.date)}
                    target="_blank"
                    aria-label={t('openDayAria', { day: fmt(d.date, { weekday: 'long' }), time: durationText(d.total) })}
                    onFocus={() => onActive(k)}
                    onBlur={() => onActive(null)}
                  >
                    <Hit cx={cx} band={band} onActive={(on) => onActive(on ? k : null)} />
                  </a>
                ) : (
                  <Hit cx={cx} band={band} onActive={() => onActive(null)} />
                )}
                <rect class="focus-ring" x={cx - band / 2 + 1} y={1} width={band - 2} height={BASE + 22} rx={6} />
              </g>
            );
          })}
          <text class="pw-cap" x={0} y={10}>
            {empty ? t('firstCap') : t('last7Caption')}
          </text>
          {empty ? null : (
            <text class="pw-max" x={VIEW_W} y={9} text-anchor="end">
              {durationText(maxH * 3600)}
            </text>
          )}
        </svg>
        {tipDay && tipDay.total > 0 && active !== null ? (
          <ChartTip
            x={band * (active + 0.5)}
            y={BASE - height(tipDay.total)}
            viewWidth={VIEW_W}
            title={fmt(tipDay.date, { weekday: 'short', month: 'short', day: 'numeric' })}
            value={durationText(tipDay.total)}
            rows={tipDay.top.map((s) => ({ label: s.site, value: durationText(s.seconds) }))}
            foot={t('tipOpenDay')}
          />
        ) : null}
      </div>
    </figure>
  );
}
