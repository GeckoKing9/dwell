/** Chart marks shared by the popup and the dashboard: rounded data ends and the time-dot channel. */

/** A column with a 4px rounded data end and a square baseline; empty for a zero height. */
export function barPath(x: number, base: number, w: number, hgt: number): string {
  if (!(hgt > 0)) return '';
  const r = Math.min(4, w / 2, hgt);
  const top = base - hgt;
  return `M${x} ${base}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + w - r}Q${x + w} ${top} ${x + w} ${top + r}V${base}Z`;
}

interface DotChannelProps {
  cx: number;
  base: number;
  /** Number of dots; each one is a real unit of time stated in the chart's caption. */
  rows: number;
  step: number;
  /** Every n-th dot is drawn larger (the hour dots). */
  majorEvery: number;
  /** Future or not-kept columns use the fainter dot. */
  faint?: boolean;
}

/** The single motif: a column of time-dots behind every bar. */
export function DotChannel({ cx, base, rows, step, majorEvery, faint = false }: DotChannelProps) {
  const cls = faint ? 'chart-dot is-faint' : 'chart-dot';
  return (
    <g aria-hidden="true">
      {Array.from({ length: rows }, (_, k) => {
        const r = k + 1;
        return <circle key={r} class={cls} cx={cx.toFixed(1)} cy={(base - r * step).toFixed(1)} r={r % majorEvery === 0 ? 1.5 : 0.9} />;
      })}
    </g>
  );
}
