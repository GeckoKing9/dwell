import { t } from '../../shared/i18n.ts';
import { idSlug } from '../settingsUi.ts';

/** A site row's whole-row button: focuses the site, or clears it when it is the focused one. */
export function RowPick({ prefix, site, selected, onSite }: { prefix: string; site: string; selected: boolean; onSite(site: string): void }) {
  return (
    <button
      type="button"
      class="row-pick"
      id={`${prefix}-${idSlug(site)}`}
      aria-label={t('focusSite', { s: site })}
      aria-pressed={selected ? 'true' : 'false'}
      onClick={() => onSite(site)}
    />
  );
}
