import { durationText } from '../../shared/ui/Duration.tsx';
import { LetterMark } from '../../shared/ui/LetterMark.tsx';
import { Track } from '../../shared/ui/Track.tsx';
import type { SiteTime } from '../../stats/aggregate.ts';
import { RowPick } from './RowPick.tsx';

/** One site of the day (or of the selected hour), its bar scaled to the busiest row; the row focuses the site. */
export function DaySiteRow({ s, max, selected, onSite }: { s: SiteTime; max: number; selected: boolean; onSite(site: string): void }) {
  return (
    <li class={selected ? 'site-row is-selected' : 'site-row'}>
      <RowPick prefix="day-pick" site={s.site} selected={selected} onSite={onSite} />
      <LetterMark site={s.site} />
      <span class="name">{s.site}</span>
      <span class="time">{durationText(s.seconds)}</span>
      <Track fraction={max > 0 ? s.seconds / max : 0} accent={selected} />
    </li>
  );
}
