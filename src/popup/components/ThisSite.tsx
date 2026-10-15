import { t } from '../../shared/i18n.ts';
import type { MessageKey } from '../../shared/i18n.ts';
import { durationText } from '../../shared/ui/Duration.tsx';
import { LetterMark } from '../../shared/ui/LetterMark.tsx';
import { Switch } from '../../shared/ui/Switch.tsx';
import type { BlockerKey, BlockerModel, ThisSiteModel, Tracking } from '../data.ts';

interface ThisSiteProps {
  site: ThisSiteModel;
  paused: boolean;
  firstRun: boolean;
  onBlocker(key: BlockerKey, on: boolean): void;
}

const BLOCKER_TEXT: Record<BlockerModel['kind'], { on: [MessageKey, MessageKey]; off: [MessageKey, MessageKey] }> = {
  reels: { on: ['reelsOff', 'reelsOffSub'], off: ['reelsOn', 'reelsOnSub'] },
  shorts: { on: ['shortsOff', 'shortsOffSub'], off: ['shortsOn', 'shortsOnSub'] },
};

/** The site's toggle says what it does: with the blocker on, "Shorts off". */
function BlockerRow({ blocker, onBlocker }: { blocker: BlockerModel; onBlocker: ThisSiteProps['onBlocker'] }) {
  const [title, sub] = BLOCKER_TEXT[blocker.kind][blocker.on ? 'on' : 'off'];
  return (
    <div class="blocker-row">
      <div class="txt">
        <div class="state" id="blocker-label">
          {t(title)}
        </div>
        <div class="sub">{t(sub)}</div>
      </div>
      <Switch id="blocker-switch" checked={blocker.on} labelledBy="blocker-label" onChange={(on) => onBlocker(blocker.key, on)} />
    </div>
  );
}

/** Right-hand facts: time and visits, or why nothing is being added. */
function Facts({ tracking, paused, firstRun }: { tracking: Extract<Tracking, { kind: 'site' }>; paused: boolean; firstRun: boolean }) {
  if (paused) {
    return (
      <div class="facts-r">
        <span>{t('pausedSite')}</span>
      </div>
    );
  }
  const visits = tracking.visits === 1 ? t('visits1') : t('visitsN', { n: tracking.visits });
  return (
    <div class="facts-r">
      {durationText(tracking.seconds)}
      <span>{firstRun ? t('justStarted') : visits}</span>
    </div>
  );
}

function Top({ tracking, paused, firstRun }: { tracking: Tracking; paused: boolean; firstRun: boolean }) {
  if (tracking.kind === 'site') {
    return (
      <div class="pp-site-top">
        <LetterMark site={tracking.site} />
        <div class="meta">
          <div class="pp-site-label">{t('thisSite')}</div>
          <div class="dom">{tracking.site}</div>
        </div>
        <Facts tracking={tracking} paused={paused} firstRun={firstRun} />
      </div>
    );
  }
  const ignored = tracking.kind === 'ignored';
  return (
    <div class="pp-site-top">
      <LetterMark site={ignored ? tracking.site : ''} blank={!ignored} />
      <div class="meta">
        <div class="pp-site-label">{t('thisSite')}</div>
        {ignored ? <div class="dom">{tracking.site}</div> : <div class="page">{t(tracking.kind === 'newtab' ? 'untrackTitle' : 'browserTitle')}</div>}
        <div class="facts">{t(ignored ? 'ignoredBody' : 'untrackBody')}</div>
      </div>
    </div>
  );
}

/** The current tab's site with its time and visits, and its blocker when it is one of the three sites. */
export function ThisSite({ site, paused, firstRun, onBlocker }: ThisSiteProps) {
  return (
    <section class="pp-site" aria-label={t('thisSite')}>
      <Top tracking={site.tracking} paused={paused} firstRun={firstRun} />
      {site.blocker ? <BlockerRow blocker={site.blocker} onBlocker={onBlocker} /> : null}
    </section>
  );
}
