/** Bar width as a percent: at least a sliver so a tiny value still shows, never past the end. */
export function trackPercent(fraction: number): number {
  const f = Number.isFinite(fraction) ? fraction : 0;
  return Math.max(0.6, Math.min(100, f * 100));
}

/** A proportional bar over the time-dot track (the motif's ruler). Decorative: the value is printed beside it. */
export function Track({ fraction, accent = false }: { fraction: number; accent?: boolean }) {
  return (
    <div class={accent ? 'track is-accent' : 'track'} aria-hidden="true">
      <i style={{ width: `${trackPercent(fraction)}%` }} />
    </div>
  );
}
