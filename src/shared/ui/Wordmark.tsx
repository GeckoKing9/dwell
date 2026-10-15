/** The wordmark: the motif's glyph (two time-dots over a short bar) and the name. */
export function Wordmark() {
  return (
    <span class="wordmark">
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle class="wm-dot" cx="7" cy="2.5" r="1" />
        <circle class="wm-dot" cx="7" cy="5.5" r="1" />
        <path class="wm-bar" d="M4.5 13V9.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V13Z" />
      </svg>
      dwell
    </span>
  );
}
