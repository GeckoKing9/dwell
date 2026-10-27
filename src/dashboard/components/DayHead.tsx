import { t } from '../../shared/i18n.ts';
import { ArrowIcon } from '../../shared/ui/icons.tsx';
import { weekRangeText } from '../labels.ts';
import type { DayModel } from '../model.ts';

interface DayHeadProps {
  model: DayModel;
  onWeek(back: number): void;
  onDay(date: string): void;
}

/** Back to the day's week; then Today on an earlier day and the previous and next day, kept together so they wrap as one. */
export function DayHead({ model, onWeek, onDay }: DayHeadProps) {
  return (
    <div class="dayhead">
      <button type="button" id="day-back" class="btn" onClick={() => onWeek(model.weekBack)}>
        <ArrowIcon dir="back" />
        {t('backWeek', { r: weekRangeText(model.week) })}
      </button>
      <span class="spacer" />
      <span class="day-step">
        <button type="button" id="day-today" class="btn btn-quiet" title={t('todayKey')} hidden={model.isToday} onClick={() => onDay(model.today)}>
          {t('today')}
        </button>
        <button
          type="button"
          id="day-prev"
          class="icon-btn"
          aria-label={t('prevDay')}
          title={t('prevDayKey')}
          disabled={model.prev === null}
          onClick={() => model.prev && onDay(model.prev)}
        >
          <ArrowIcon dir="left" />
        </button>
        <button
          type="button"
          id="day-next"
          class="icon-btn"
          aria-label={t('nextDay')}
          title={t('nextDayKey')}
          disabled={model.next === null}
          onClick={() => model.next && onDay(model.next)}
        >
          <ArrowIcon />
        </button>
      </span>
    </div>
  );
}
