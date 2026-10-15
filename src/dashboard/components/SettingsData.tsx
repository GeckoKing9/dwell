import { t } from '../../shared/i18n.ts';
import { Switch } from '../../shared/ui/Switch.tsx';
import type { Settings } from '../../store/schema.ts';
import type { SettingsHandlers, SettingsUi } from '../settingsUi.ts';
import { Notice, SetRow } from './SetRow.tsx';

interface DataProps {
  settings: Settings;
  ui: SettingsUi;
  on: SettingsHandlers;
}

/** Retention, export, import, the event log, and delete all with its 10-second undo. */
export function SettingsData({ settings, ui, on }: DataProps) {
  return (
    <section class="panel set-group" id="set-data" aria-labelledby="set-data-h">
      <h2 id="set-data-h">{t('sData')}</h2>
      <SetRow id="row-retention" title={t('sRetention')} desc={t('sRetentionDesc')}>
        <span class="chip chip-lg">{t('days90')}</span>
      </SetRow>
      <SetRow id="row-export" title={t('sExport')} desc={t('sExportDesc')} extra={<Notice id="export-notice" text={ui.notices.export} />}>
        <button type="button" class="btn" id="export-json" onClick={on.exportJson}>
          {t('exportBtn')}
        </button>
      </SetRow>
      <SetRow id="row-import" title={t('sImport')} desc={t('sImportDesc')} extra={<Notice id="import-notice" text={ui.notices.import} />}>
        <input
          type="file"
          accept="application/json,.json"
          id="import-file"
          class="sr"
          tabindex={-1}
          aria-hidden="true"
          ref={on.fileRef}
          onChange={(e) => {
            const input = e.currentTarget;
            const file = input.files?.[0];
            if (file) on.importFile(file);
            input.value = '';
          }}
        />
        <button type="button" class="btn" id="import-choose" onClick={() => on.fileRef.current?.click()}>
          {t('importBtn')}
        </button>
      </SetRow>
      <SetRow id="row-log" title={t('sLog')} desc={t('sLogDesc')} extra={<Notice id="log-notice" text={ui.notices.log} />}>
        {settings.eventLog ? (
          <button type="button" class="btn" id="export-log" onClick={on.exportLog}>
            {t('exportLogBtn')}
          </button>
        ) : null}
        <Switch id="eventlog-switch" checked={settings.eventLog} labelledBy="row-log-title" onChange={(v) => on.change({ eventLog: v })} />
      </SetRow>
      <SetRow id="row-delete" title={t('sDelete')} desc={t('sDeleteDesc')} extra={<Notice id="delete-notice" text={ui.notices.delete} />}>
        <button type="button" class="btn" id="delete-all" disabled={ui.undoOpen} onClick={on.deleteAll}>
          {t('deleteBtn')}
        </button>
      </SetRow>
    </section>
  );
}
