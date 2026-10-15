import { t } from '../../shared/i18n.ts';
import type { MessageKey } from '../../shared/i18n.ts';
import { Switch } from '../../shared/ui/Switch.tsx';
import type { Settings } from '../../store/schema.ts';
import type { SettingsHandlers } from '../settingsUi.ts';
import { SetRow } from './SetRow.tsx';

const BLOCKERS: readonly [keyof Settings['blockers'], MessageKey, MessageKey][] = [
  ['instagramReels', 'bIgReels', 'bIgReelsD'],
  ['youtubeShorts', 'bYtShorts', 'bYtShortsD'],
  ['facebookReels', 'bFbReels', 'bFbReelsD'],
  ['xVideos', 'bXVideos', 'bXVideosD'],
  ['instagramExplore', 'bIgExplore', 'bIgExploreD'],
];

/** Each blocker on its own switch; one tap, no confirmation. */
export function SettingsBlockers({ settings, on }: { settings: Settings; on: SettingsHandlers }) {
  return (
    <section class="panel set-group" id="set-blockers" aria-labelledby="set-blockers-h">
      <h2 id="set-blockers-h">{t('sBlockers')}</h2>
      {BLOCKERS.map(([key, title, desc]) => (
        <SetRow key={key} id={`row-${key}`} title={t(title)} desc={t(desc)}>
          <Switch
            id={`blocker-${key}`}
            checked={settings.blockers[key]}
            labelledBy={`row-${key}-title`}
            onChange={(v) => on.change({ blockers: { [key]: v } })}
          />
        </SetRow>
      ))}
    </section>
  );
}
