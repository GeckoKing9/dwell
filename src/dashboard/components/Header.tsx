import { t } from '../../shared/i18n.ts';
import type { MessageKey } from '../../shared/i18n.ts';
import { Wordmark } from '../../shared/ui/Wordmark.tsx';

type Section = 'activity' | 'settings' | 'privacy';

const LINKS: readonly { id: Section; href: string; label: MessageKey }[] = [
  { id: 'activity', href: '#week', label: 'navActivity' },
  { id: 'settings', href: '#settings', label: 'navSettings' },
  { id: 'privacy', href: '#privacy', label: 'navPrivacy' },
];

/** Wordmark, the three sections, and the recording or paused pill: pause is shown on every view. */
export function Header({ current, paused }: { current: Section; paused: boolean }) {
  return (
    <header class="dash-top">
      <Wordmark />
      <nav aria-label={t('extName')}>
        {LINKS.map((link) => (
          <a key={link.id} id={`nav-${link.id}`} href={link.href} aria-current={current === link.id ? 'page' : undefined}>
            {t(link.label)}
          </a>
        ))}
      </nav>
      <span id="status-pill" class={paused ? 'status-pill is-paused' : 'status-pill'} role="status">
        <span class="led" aria-hidden="true" />
        {paused ? t('pausedPill') : t('recording')}
      </span>
    </header>
  );
}
