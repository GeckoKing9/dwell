import { t } from '../../shared/i18n.ts';
import { PauseIcon } from '../../shared/ui/icons.tsx';

/** Pause is honest: an inverse band above the week and day views while nothing is being recorded. */
export function PausedBanner({ onResume }: { onResume(): void }) {
  return (
    <div class="dash-paused" role="status" id="paused-banner">
      <PauseIcon />
      <p class="txt">
        <strong>{t('pausedTitle')}</strong>
        <span>{t('pausedSub')}</span>
      </p>
      <button type="button" id="resume" onClick={onResume}>
        {t('resume')}
      </button>
    </div>
  );
}
