export interface TipRow {
  label: string;
  value: string;
}

interface ChartTipProps {
  /** Anchor in the chart's viewBox units: the top centre of the hovered bar. */
  x: number;
  y: number;
  /** The chart's viewBox width, to scale the anchor to the rendered width. */
  viewWidth: number;
  title: string;
  value: string;
  rows: readonly TipRow[];
  foot?: string;
}

/** Centres the tip over the anchor, inside the chart's width, above the bar unless there is no room. */
function place(el: HTMLDivElement | null, x: number, y: number, viewWidth: number): void {
  const wrap = el?.parentElement;
  if (!el || !wrap) return;
  const width = wrap.clientWidth;
  const scale = viewWidth > 0 && width > 0 ? width / viewWidth : 1;
  const ax = x * scale;
  const ay = y * scale;
  const left = Math.max(0, Math.min(width - el.offsetWidth, ax - el.offsetWidth / 2));
  let top = ay - el.offsetHeight - 10;
  if (top < -40) top = ay + 12;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

/** Chart tooltip: value first, date second, then the top sites. Positioned through the CSSOM after render. */
export function ChartTip({ x, y, viewWidth, title, value, rows, foot }: ChartTipProps) {
  return (
    <div class="tip" role="status" ref={(el) => place(el, x, y, viewWidth)}>
      <div class="tip-head">
        <strong>{value}</strong>
        <span class="muted">{title}</span>
      </div>
      {rows.map((row) => (
        <div class="tip-row" key={row.label}>
          <span class="mono">{row.label}</span>
          <span class="num">{row.value}</span>
        </div>
      ))}
      {foot ? <div class="tip-foot">{foot}</div> : null}
    </div>
  );
}
