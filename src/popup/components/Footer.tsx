import { t } from '../../shared/i18n.ts';
import { ArrowIcon } from '../../shared/ui/icons.tsx';
import { Switch } from '../../shared/ui/Switch.tsx';

interface FooterProps {
  paused: boolean;
  onPause(paused: boolean): void;
  onOpenDashboard(): void;
}

export function Footer({ paused, onPause, onOpenDashboard }: FooterProps) {
  return (
    <footer class="pp-foot">
      <button type="button" id="open-dashboard" class="btn btn-quiet" onClick={onOpenDashboard}>
        {t('openDash')}
        <ArrowIcon />
      </button>
      <span class="pause-ctl">
        <span id="pause-label">{paused ? t('paused') : t('pause')}</span>
        <Switch id="pause-switch" checked={paused} labelledBy="pause-label" onChange={onPause} />
      </span>
    </footer>
  );
}
