import { t } from '../../shared/i18n.ts';
import type { MessageKey } from '../../shared/i18n.ts';
import type { Settings } from '../../store/schema.ts';
import type { SettingsHandlers, SettingsUi } from '../settingsUi.ts';
import { Notice } from './SetRow.tsx';
import { SettingsAppearance } from './SettingsAppearance.tsx';
import { SettingsData } from './SettingsData.tsx';
import { SettingsSites } from './SettingsSites.tsx';
import { SettingsBlockers } from './SettingsBlockers.tsx';
import { SettingsTracking } from './SettingsTracking.tsx';

const GROUPS: readonly [string, MessageKey][] = [
  ['set-tracking', 'sTracking'],
  ['set-blockers', 'sBlockers'],
  ['set-sites', 'sSites'],
  ['set-appearance', 'sAppearance'],
  ['set-data', 'sData'],
];

interface SettingsViewProps {
  settings: Settings;
  sites: readonly string[];
  ui: SettingsUi;
  on: SettingsHandlers;
}

/** Every setting writes through the worker; the index on the left scrolls without changing the route. */
export function SettingsView({ settings, sites, ui, on }: SettingsViewProps) {
  return (
    <>
      <h1 class="sr">{t('navSettings')}</h1>
      <Notice id="settings-notice" text={ui.notices.settings} />
      <div class="settings">
        <nav class="set-index" aria-label={t('navSettings')}>
          {GROUPS.map(([id, key]) => (
            <a
              key={id}
              href="#settings"
              onClick={(e) => {
                e.preventDefault();
                on.jump(id);
              }}
            >
              {t(key)}
            </a>
          ))}
        </nav>
        <div class="set-groups">
          <SettingsTracking settings={settings} on={on} />
          <SettingsBlockers settings={settings} on={on} />
          <SettingsSites settings={settings} sites={sites} ui={ui} on={on} />
          <SettingsAppearance settings={settings} on={on} />
          <SettingsData settings={settings} ui={ui} on={on} />
        </div>
      </div>
    </>
  );
}
