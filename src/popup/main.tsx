/// <reference types="chrome" />
import { render } from 'preact';
import { chromeStore } from '../store/adapter.ts';
import { uiLang } from '../shared/i18n.ts';
import { isRelevantChange } from './data.ts';
import type { PopupDeps } from './data.ts';
import { Popup } from './Popup.tsx';
import { SETTINGS_KEY } from '../store/schema.ts';
import { applyTheme, themeOf } from '../shared/theme.ts';
import { dashboardDayUrl, isAllowedTarget } from '../blocker/targets.ts';

/** The dashboard page as the manifest names it, so the popup never hardcodes where it lives. */
const DASHBOARD = chrome.runtime.getURL(chrome.runtime.getManifest().options_ui?.page ?? 'src/dashboard/index.html');

/** Shows a day in the open dashboard tab (its router follows the hash), else in a new one; any other URL is refused. */
async function openDay(date: string): Promise<void> {
  const url = dashboardDayUrl(DASHBOARD, date);
  if (url === null || !isAllowedTarget(url)) return chrome.runtime.openOptionsPage();
  const open = (await chrome.tabs.query({})).find((tab) => tab.url?.startsWith(DASHBOARD));
  if (open?.id === undefined) {
    await chrome.tabs.create({ url });
    return;
  }
  await chrome.tabs.update(open.id, { url, active: true });
  await chrome.windows.update(open.windowId, { focused: true });
}

/** The popup's only contact with Chrome. Writes go to the worker as messages, never to storage. */
const deps: PopupDeps = {
  store: chromeStore(chrome.storage.local),
  tabs: {
    getCurrent: () => chrome.tabs.getCurrent(),
    query: (query) => chrome.tabs.query(query),
  },
  send: (message) => chrome.runtime.sendMessage(message),
  openDashboard: () => chrome.runtime.openOptionsPage(),
  dayUrl: (date) => dashboardDayUrl(DASHBOARD, date) ?? DASHBOARD,
  openDay,
  onChange(listener) {
    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
      if (isRelevantChange(Object.keys(changes), area)) listener();
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  },
  now: () => new Date(),
};

document.documentElement.lang = uiLang();
void deps.store.get([SETTINGS_KEY]).then((items) => applyTheme(document.documentElement, themeOf(items[SETTINGS_KEY])));
chrome.storage.onChanged.addListener((changes, area) => {
  const change = changes[SETTINGS_KEY];
  if (area === 'local' && change) applyTheme(document.documentElement, themeOf(change.newValue));
});
const root = document.getElementById('app');
if (root) render(<Popup deps={deps} />, root);
