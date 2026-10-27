interface ChartHitProps {
  /** Stable per column (`week-col-3`, `day-hour-21`), so keyboard focus survives a change of week or day. */
  id: string;
  /** A column with nothing to open or select stays mounted, out of the tab order and inert. */
  disabled: boolean;
  /** The column's band in the chart's viewBox units; the hit area is the whole band, bigger than the mark. */
  x: number;
  width: number;
  height: number;
  /** Corner radius of the keyboard focus ring. */
  rx: number;
  label: string;
  /** aria-pressed for a column that selects (an hour); absent for one that navigates (a day). */
  pressed?: boolean;
  /** `data-day` or `data-hour`, the column's stable handle for the e2e specs. */
  data: Record<`data-${string}`, string>;
  onActive(on: boolean): void;
  onActivate(): void;
}

/**
 * A chart column's hit area and focus ring: hover and focus show the tooltip, click, Enter or Space activate.
 * Every column keeps its element, so a focused column that turns empty keeps focus instead of dropping it.
 */
export function ChartHit({ id, disabled, x, width, height, rx, label, pressed, data, onActive, onActivate }: ChartHitProps) {
  const activate = disabled ? () => undefined : onActivate;
  return (
    <>
      <rect
        class="hit"
        id={id}
        x={x}
        y={0}
        width={width}
        height={height}
        fill="transparent"
        tabindex={disabled ? -1 : 0}
        role="button"
        aria-label={label}
        aria-disabled={disabled ? 'true' : undefined}
        aria-pressed={pressed === undefined || disabled ? undefined : pressed ? 'true' : 'false'}
        {...data}
        onPointerEnter={() => onActive(true)}
        onPointerLeave={() => onActive(false)}
        onFocus={() => onActive(true)}
        onBlur={() => onActive(false)}
        onClick={activate}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          activate();
        }}
      />
      <rect class="focus-ring" x={x + 1} y={1} width={width - 2} height={height - 2} rx={rx} />
    </>
  );
}
