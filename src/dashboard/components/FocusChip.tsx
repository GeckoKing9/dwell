import { t } from '../../shared/i18n.ts';

/** The focused site as a removable chip: its x (or Esc) shows every site again. */
export function FocusChip({ site, onClear }: { site: string; onClear(): void }) {
  return (
    <p class="focus-line">
      <span class="chip-x" id="focus-chip">
        {site}
        <button type="button" id="focus-clear" aria-label={t('clearFocus', { s: site })} title={t('clearFocusKey')} onClick={onClear}>
          {'×'}
        </button>
      </span>
    </p>
  );
}
