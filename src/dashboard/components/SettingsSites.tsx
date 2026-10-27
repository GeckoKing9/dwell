import { t } from '../../shared/i18n.ts';
import { Switch } from '../../shared/ui/Switch.tsx';
import type { Settings } from '../../store/schema.ts';
import { registrableDomain } from '../../tracker/grouping.ts';
import { idSlug } from '../settingsUi.ts';
import type { SettingsHandlers, SettingsUi } from '../settingsUi.ts';
import { CategoryEditor } from './CategoryEditor.tsx';
import { FieldError } from './FieldError.tsx';
import { HostInput } from './HostInput.tsx';
import { SetRow } from './SetRow.tsx';

interface SitesProps {
  settings: Settings;
  sites: readonly string[];
  ui: SettingsUi;
  on: SettingsHandlers;
}

/** Grouping overrides, the never-record list and the category editor. */
/** A kept-apart host's state: already its own site, counted separately, or counted with its domain. */
function splitState(own: boolean, separate: boolean, domain: string): string {
  if (own) return t('splitOwnSite');
  return separate ? t('countSeparately') : t('countWith', { d: domain });
}

export function SettingsSites({ settings, sites, ui, on }: SitesProps) {
  const toggleSplit = (host: string, separate: boolean): void =>
    on.change({ overrides: separate ? [...settings.overrides, host] : settings.overrides.filter((h) => h !== host) });
  return (
    <section class="panel set-group" id="set-sites" aria-labelledby="set-sites-h">
      <h2 id="set-sites-h">{t('sSites')}</h2>
      <SetRow
        id="row-split"
        title={t('sGroup')}
        desc={t('sGroupDesc')}
        extra={
          <div class="set-list">
            <FieldError field="split" ui={ui} />
            {ui.seenSplits.map((host) => {
              const separate = settings.overrides.includes(host);
              const domain = registrableDomain(host);
              // Grouping already counts a hosting customer or a tailnet machine on its own: the switch stays
              // only while the entry is on, so it can still be removed.
              const own = domain === host;
              return (
                <div class="ovr-row" key={host}>
                  <span id={`split-label-${idSlug(host)}`}>
                    <span class="mono">{host}</span>
                    <span class="muted">{` \u00b7 ${splitState(own, separate, domain)}`}</span>
                  </span>
                  {own && !separate ? null : (
                    <Switch id={`split-${idSlug(host)}`} checked={separate} labelledBy={`split-label-${idSlug(host)}`} onChange={(v) => toggleSplit(host, v)} />
                  )}
                </div>
              );
            })}
          </div>
        }
      >
        <HostInput field="split" label={t('splitLabel')} placeholder="mail.google.com" ui={ui} on={on} />
      </SetRow>
      <SetRow
        id="row-ignore"
        title={t('sIgnore')}
        desc={t('sIgnoreDesc')}
        extra={
          <div class="set-list">
            <FieldError field="ignore" ui={ui} />
            <div class="chips" id="ignore-chips">
              {settings.ignore.map((host) => (
                <span class="chip-x" key={host}>
                  {host}
                  <button type="button" id={`ignore-remove-${idSlug(host)}`} aria-label={t('remove', { d: host })} onClick={() => on.removeIgnore(host)}>
                    {'\u00d7'}
                  </button>
                </span>
              ))}
            </div>
          </div>
        }
      >
        <HostInput field="ignore" label={t('sIgnore')} placeholder="example.com" ui={ui} on={on} />
      </SetRow>
      <SetRow id="row-cats" title={t('sCats')} desc={t('sCatsDesc')} extra={<CategoryEditor settings={settings} sites={sites} on={on} />} />
    </section>
  );
}
