import { t } from '../../shared/i18n.ts';
import { Switch } from '../../shared/ui/Switch.tsx';
import { categoryOf } from '../../stats/categories.ts';
import { CATEGORIES } from '../../store/schema.ts';
import type { Settings } from '../../store/schema.ts';
import { registrableDomain } from '../../tracker/grouping.ts';
import { categoryName } from '../labels.ts';
import type { ListField, SettingsHandlers, SettingsUi } from '../settingsUi.ts';
import { SetRow } from './SetRow.tsx';

interface SitesProps {
  settings: Settings;
  sites: readonly string[];
  ui: SettingsUi;
  on: SettingsHandlers;
}

/** A domain field with an Add button; Enter adds too. */
function HostInput({ field, label, placeholder, ui, on }: { field: ListField; label: string; placeholder: string; ui: SettingsUi; on: SettingsHandlers }) {
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

function FieldError({ field, ui }: { field: ListField; ui: SettingsUi }) {
  return ui.errors[field] ? (
    <p class="field-err" id={`${field}-error`} role="alert">
      {ui.errors[field]}
    </p>
  ) : null;
}

/** Grouping overrides, the never-record list and the category editor. */
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
              return (
                <div class="ovr-row" key={host}>
                  <span id={`split-label-${host}`}>
                    <span class="mono">{host}</span>
                    <span class="muted">{` \u00b7 ${separate ? t('countSeparately') : t('countWith', { d: registrableDomain(host) })}`}</span>
                  </span>
                  <Switch id={`split-${host}`} checked={separate} labelledBy={`split-label-${host}`} onChange={(v) => toggleSplit(host, v)} />
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
                  <button type="button" aria-label={t('remove', { d: host })} onClick={() => on.removeIgnore(host)}>
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

/** One select per recorded site; the change replaces the whole category map. */
function CategoryEditor({ settings, sites, on }: Omit<SitesProps, 'ui'>) {
  if (sites.length === 0) {
    return (
      <p class="empty-note" id="cats-empty">
        {t('catsEmpty')}
      </p>
    );
  }
  return (
    <div class="cat-editor">
      {sites.map((site) => (
        <label key={site}>
          <span class="d">{site}</span>
          <select
            class="field"
            id={`cat-${site}`}
            value={categoryOf(site, settings.categories)}
            onChange={(e) => {
              const picked = CATEGORIES.find((c) => c === e.currentTarget.value);
              if (picked) on.change({ categories: { ...settings.categories, [site]: picked } });
            }}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryName(c)}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
