/// <reference types="chrome" />
import { render } from 'preact';
import { chromeStore } from '../store/adapter.ts';
import { uiLang } from '../shared/i18n.ts';
import { App } from './App.tsx';
import { SETTINGS_KEY } from '../store/schema.ts';
import { applyTheme, themeOf } from '../shared/theme.ts';
import { isRelevantChange } from './data.ts';
import type { PageDeps } from './data.ts';

/** A local download the person asked for: an object URL on an `<a download>`, never a network request. */
function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(typeof reader.result === 'string' ? reader.result : ''));
    reader.addEventListener('error', () => reject(reader.error ?? new Error('The file could not be read.')));
    reader.readAsText(file);
  });
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** The dashboard's only contact with Chrome and the DOM. Writes go to the worker as messages, never to storage. */
const deps: PageDeps = {
  store: chromeStore(chrome.storage.local),
  send: (message) => chrome.runtime.sendMessage(message),
  onChange(listener) {
    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
      if (isRelevantChange(Object.keys(changes), area)) listener();
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  },
  now: () => new Date(),
  download,
  readFile,
  hash: {
    get: () => location.hash,
    set: (hash) => {
      location.hash = hash;
    },
    onChange(listener) {
      addEventListener('hashchange', listener);
      return () => removeEventListener('hashchange', listener);
    },
  },
  observeWidth(element, listener) {
    listener(element.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width;
      if (width !== undefined && width > 0) listener(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  },
  scrollTo(id) {
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  },
};

document.documentElement.lang = uiLang();
void deps.store.get([SETTINGS_KEY]).then((items) => applyTheme(document.documentElement, themeOf(items[SETTINGS_KEY])));
chrome.storage.onChanged.addListener((changes, area) => {
  const change = changes[SETTINGS_KEY];
  if (area === 'local' && change) applyTheme(document.documentElement, themeOf(change.newValue));
});
const root = document.getElementById('app');
if (root) render(<App deps={deps} />, root);
