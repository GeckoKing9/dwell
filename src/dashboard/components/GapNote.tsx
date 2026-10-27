import { t } from '../../shared/i18n.ts';
import { fmtDate } from '../labels.ts';
import type { WeekModel } from '../model.ts';

/** Past days of the week with nothing recorded, and how many days the average is taken over. */
export function GapNote({ model }: { model: WeekModel }) {
  const { gaps, averaged } = model;
  if (gaps.length === 0) return null;
  const days = gaps.map((g) => fmtDate(g.date, { weekday: 'short', month: 'short', day: 'numeric' })).join(', ');
  return <p id="gap-note">{averaged === 1 ? t('gapNoteOne', { days }) : t('gapNote', { days, n: averaged })}</p>;
}
