import { t } from '../../shared/i18n.ts';
import type { MessageKey } from '../../shared/i18n.ts';
import { Switch } from '../../shared/ui/Switch.tsx';
import type { Settings } from '../../store/schema.ts';
import type { SettingsHandlers } from '../settingsUi.ts';
import { SetRow } from './SetRow.tsx';

const IDLE: readonly [Settings['idleThresholdSec'], MessageKey][] = [
  [30, 'idle30'],
  [60, 'idle60'],
  [120, 'idle120'],
  [300, 'idle300'],
];

interface GroupProps {
  settings: Settings;
  on: SettingsHandlers;
}

/** Idle threshold as a segmented control, the media override and pause. */
export function SettingsTracking({ settings, on }: GroupProps) {
  return (
    <section class="panel set-group" id="set-tracking" aria-labelledby="set-tracking-h">
      <h2 id="set-tracking-h">{t('sTracking')}</h2>
      <SetRow id="row-idle" title={t('sIdle')} desc={t('sIdleDesc')}>
        <div class="seg" role="radiogroup" aria-labelledby="row-idle-title">
          {IDLE.map(([seconds, key]) => (
            <button
              type="button"
              key={seconds}
              id={`idle-${seconds}`}
              role="radio"
              aria-checked={settings.idleThresholdSec === seconds ? 'true' : 'false'}
              onClick={() => {
                if (settings.idleThresholdSec !== seconds) on.change({ idleThresholdSec: seconds });
              }}
            >
              {t(key)}
            </button>
          ))}
        </div>
      </SetRow>
      <SetRow id="row-media" title={t('sMedia')} desc={t('sMediaDesc')}>
        <Switch id="media-switch" checked={settings.mediaOverride} labelledBy="row-media-title" onChange={(v) => on.change({ mediaOverride: v })} />
      </SetRow>
      <SetRow id="row-pause" title={t('pause')} desc={t('sPauseDesc')}>
        <Switch id="pause-switch" checked={settings.paused} labelledBy="row-pause-title" onChange={on.pause} />
      </SetRow>
    </section>
  );
}

const BLOCKERS: readonly [keyof Settings['blockers'], MessageKey, MessageKey][] = [
  ['instagramReels', 'bIgReels', 'bIgReelsD'],
  ['youtubeShorts', 'bYtShorts', 'bYtShortsD'],
  ['facebookReels', 'bFbReels', 'bFbReelsD'],
  ['instagramExplore', 'bIgExplore', 'bIgExploreD'],
];

/** Each blocker on its own switch; one tap, no confirmation. */
export function SettingsBlockers({ settings, on }: GroupProps) {
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
