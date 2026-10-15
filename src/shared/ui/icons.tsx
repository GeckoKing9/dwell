/** Two bars, as on a media player. */
export function PauseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="5" y="4" width="3.5" height="12" rx="1" fill="currentColor" />
      <rect x="11.5" y="4" width="3.5" height="12" rx="1" fill="currentColor" />
    </svg>
  );
}

const ARROWS = {
  right: 'M5.5 3l4 4-4 4',
  left: 'M8.5 3 4.5 7l4 4',
  back: 'M11 7H3m3.5-3.5L3 7l3.5 3.5',
} as const;

export function ArrowIcon({ dir = 'right' }: { dir?: keyof typeof ARROWS }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d={ARROWS[dir]} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}
