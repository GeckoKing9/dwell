import type { ListField, SettingsUi } from '../settingsUi.ts';

export function FieldError({ field, ui }: { field: ListField; ui: SettingsUi }) {
  return ui.errors[field] ? (
    <p class="field-err" id={`${field}-error`} role="alert">
      {ui.errors[field]}
    </p>
  ) : null;
}
