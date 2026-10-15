import { t } from '../../shared/i18n.ts';
import type { ListField, SettingsHandlers, SettingsUi } from '../settingsUi.ts';

/** A domain field with an Add button; Enter adds too. */
export function HostInput({ field, label, placeholder, ui, on }: { field: ListField; label: string; placeholder: string; ui: SettingsUi; on: SettingsHandlers }) {
  const error = ui.errors[field];
  return (
    <>
      <input
        class="field"
        id={`${field}-input`}
        type="text"
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${field}-error` : undefined}
        autocomplete="off"
        spellcheck={false}
        value={ui.drafts[field]}
        onInput={(e) => on.draft(field, e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') on.add(field);
        }}
      />
      <button type="button" class="btn" id={`${field}-add`} onClick={() => on.add(field)}>
        {t('add')}
      </button>
    </>
  );
}
