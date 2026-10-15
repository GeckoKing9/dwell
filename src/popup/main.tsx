/// <reference types="chrome" />
import { render } from 'preact';
import { chromeStore } from '../store/adapter.ts';
import { uiLang } from '../shared/i18n.ts';
import { isRelevantChange } from './data.ts';
import type { PopupDeps } from './data.ts';
import { Popup } from './Popup.tsx';

/** The popup's only contact with Chrome. Writes go to the worker as messages, never to storage. */
const deps: PopupDeps = {
  store: chromeStore(chrome.storage.local),
  tabs: {
    getCurrent: () => chrome.tabs.getCurrent(),
    query: (query) => chrome.tabs.query(query),
  },
  send: (message) => chrome.runtime.sendMessage(message),
  openDashboard: () => chrome.runtime.openOptionsPage(),
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
const root = document.getElementById('app');
if (root) render(<Popup deps={deps} />, root);
