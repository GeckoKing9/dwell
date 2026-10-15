import type { ComponentChildren } from 'preact';
import { t, tParts } from '../../shared/i18n.ts';
import type { MessageKey } from '../../shared/i18n.ts';

/** The permissions Chrome asks for, each with its reason. A unit test compares the names with manifest.json. */
export const PERMISSIONS: readonly [string, MessageKey][] = [
  ['storage', 'perm_storage'],
  ['tabs', 'perm_tabs'],
  ['idle', 'perm_idle'],
  ['alarms', 'perm_alarms'],
  ['declarativeNetRequest', 'perm_dnr'],
];

/** Site access exactly as the manifest lists it: www, m and bare hosts of the three sites, https only. */
export const SITE_ACCESS: readonly string[] = [
  'https://www.instagram.com/*',
  'https://instagram.com/*',
  'https://www.youtube.com/*',
  'https://m.youtube.com/*',
  'https://youtube.com/*',
  'https://www.facebook.com/*',
  'https://m.facebook.com/*',
  'https://facebook.com/*',
];

const KEPT: readonly MessageKey[] = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'];
const NEVER: readonly MessageKey[] = ['n1', 'n2', 'n3', 'n4', 'n5'];

/** What is stored, where, why each permission exists, and what the network policy does and does not cover. */
export function Privacy() {
  return (
    <div class="privacy">
      <article class="prose" id="privacy-prose">
        <h1>{t('pTitle')}</h1>
        <p class="lead" id="privacy-lead">
          {t('pLead')}
        </p>
        <div class="kept">
          <div>
            <h2>{t('pKept')}</h2>
            <ul>
              {KEPT.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
          </div>
          <div>
            <h2>{t('pNever')}</h2>
            <ul>
              {NEVER.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
          </div>
        </div>
        <h2>{t('pWhereT')}</h2>
        <p>{t('pWhere')}</p>
        <h2>{t('pNetT')}</h2>
        <p id="privacy-net">{tParts<ComponentChildren>('pNet', { csp: <code>default-src 'none'</code> })}</p>
        <p>{t('pAudit')}</p>
      </article>
      <aside class="panel" aria-labelledby="perm-title">
        <div class="panel-head">
          <h2 id="perm-title">{t('pPermT')}</h2>
        </div>
        <p class="perm-desc">{t('pPermD')}</p>
        <ul class="perm" id="permissions">
          {PERMISSIONS.map(([name, reason]) => (
            <li key={name}>
              <code>{name}</code>
              <span>{t(reason)}</span>
            </li>
          ))}
          <li>
            <span class="hosts">
              {SITE_ACCESS.map((pattern) => (
                <code key={pattern}>{pattern}</code>
              ))}
            </span>
            <span>{t('perm_hosts')}</span>
          </li>
        </ul>
      </aside>
    </div>
  );
}
