import { t } from '../../shared/i18n.ts';
import { PauseIcon } from '../../shared/ui/icons.tsx';

/** Pause is honest: an inverse band at the top while nothing is being recorded. */
export function PausedBand({ onResume }: { onResume(): void }) {
  return (
    <div class="pp-paused" role="status" id="paused-band">
      <PauseIcon />
      <div class="txt" title={t('pausedSub')}>
        <strong>{t('pausedTitle')}</strong>
        <span class="sr">{t('pausedSub')}</span>
      </div>
      <button type="button" id="resume" onClick={onResume}>
        {t('resume')}
      </button>
    </div>
  );
}
