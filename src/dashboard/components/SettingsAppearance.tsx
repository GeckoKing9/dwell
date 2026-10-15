import { t } from '../../shared/i18n.ts';
import type { MessageKey } from '../../shared/i18n.ts';
import type { Settings, Theme } from '../../store/schema.ts';
import type { SettingsHandlers } from '../settingsUi.ts';
import { SetRow } from './SetRow.tsx';

const CHOICES: readonly [Theme, MessageKey][] = [
  ['system', 'themeSystem'],
  ['light', 'themeLight'],
  ['dark', 'themeDark'],
];

interface AppearanceProps {
  settings: Settings;
  on: SettingsHandlers;
}

/** Theme as a three-way segmented control; the pages react to the stored value. */
export function SettingsAppearance({ settings, on }: AppearanceProps) {
  return (
    <section class="panel set-group" id="set-appearance" aria-labelledby="set-appearance-h">
      <h2 id="set-appearance-h">{t('sAppearance')}</h2>
      <SetRow id="row-theme" title={t('sTheme')} desc={t('sThemeDesc')}>
        <div class="seg" role="radiogroup" aria-labelledby="row-theme-title">
          {CHOICES.map(([theme, key]) => (
            <button
              type="button"
              key={theme}
              id={`theme-${theme}`}
              role="radio"
              aria-checked={settings.theme === theme ? 'true' : 'false'}
              onClick={() => {
                if (settings.theme !== theme) on.change({ theme });
              }}
            >
              {t(key)}
            </button>
          ))}
        </div>
      </SetRow>
    </section>
  );
}
