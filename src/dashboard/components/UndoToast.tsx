import { t } from '../../shared/i18n.ts';

/** The one "are you sure": the history is already gone, and Undo brings it back for 10 seconds. */
export function UndoToast({ onUndo }: { onUndo(): void }) {
  return (
    <div class="toast" id="undo-toast" role="status">
      <p>{t('deletedToast')}</p>
      <button type="button" id="undo-delete" onClick={onUndo}>
        {t('undo')}
      </button>
    </div>
  );
}
