import { t } from '../../shared/i18n.ts';
import { ArrowIcon } from '../../shared/ui/icons.tsx';
import { relWeek, weekRangeText } from '../labels.ts';
import type { WeekModel } from '../model.ts';

interface WeekNavProps {
  model: WeekModel;
  /** Goes to the week `back` weeks before the current one. */
  onWeek(back: number): void;
}

/** Previous and next stop at the oldest kept week and at the current week. */
export function WeekNav({ model, onWeek }: WeekNavProps) {
  const oldest = model.back >= model.maxBack;
  return (
    <div class="weeknav">
      <button
        type="button"
        id="week-prev"
        class="icon-btn"
        aria-label={t('prevWeek')}
        title={oldest ? t('olderGone') : t('prevWeek')}
        disabled={oldest}
        onClick={() => onWeek(model.back + 1)}
      >
        <ArrowIcon dir="left" />
      </button>
      <button type="button" id="week-next" class="icon-btn" aria-label={t('nextWeek')} disabled={model.back === 0} onClick={() => onWeek(model.back - 1)}>
        <ArrowIcon />
      </button>
      <h1 class="range">{weekRangeText(model.week)}</h1>
      <span class="rel">{relWeek(model.back)}</span>
    </div>
  );
}
