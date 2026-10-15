/// <reference types="chrome" />
/**
 * Every UI string goes through `t()`. Chrome's catalog (`chrome.i18n.getMessage`) is the source in the
 * extension; the bundled English catalog is the fallback outside it (unit tests) and the map from
 * named variables (`{ d: '1h 55m' }`) to Chrome's positional `$1` placeholders.
 */
import en from '../../_locales/en/messages.json';
import type { Locale } from '../stats/format.ts';

interface CatalogEntry {
  message: string;
  placeholders?: Record<string, { content: string }>;
}

export type MessageKey = keyof typeof en;
export type Vars = Readonly<Record<string, string | number>>;

const CATALOG: Readonly<Record<string, CatalogEntry>> = en;
/** Private-use characters frame slot markers, so no translated text can collide with them. */
const SLOT = /\uE000(\d+)\uE001/;

/** Placeholder names in `$1`, `$2` order for one message. */
function placeholderOrder(key: MessageKey): string[] {
  const names: string[] = [];
  for (const [name, p] of Object.entries(CATALOG[key]?.placeholders ?? {})) {
    const match = /^\$([1-9])$/.exec(p.content);
    if (match) names[Number(match[1]) - 1] = name.toLowerCase();
  }
  return names;
}

function fromChrome(key: MessageKey, subs: string[]): string {
  if (typeof chrome === 'undefined' || typeof chrome.i18n?.getMessage !== 'function') return '';
  return chrome.i18n.getMessage(key, subs);
}

/** The English message with `$NAME$` placeholders filled in, as Chrome would. */
function fromCatalog(key: MessageKey, values: Readonly<Record<string, string>>): string {
  const entry = CATALOG[key];
  if (!entry) return key;
  return entry.message.replace(/\$([A-Za-z0-9_]+)\$/g, (whole, name: string) => values[name.toLowerCase()] ?? whole);
}

/** The translated message for `key`, with `vars` filled in by placeholder name. */
export function t(key: MessageKey, vars: Vars = {}): string {
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(vars)) values[name.toLowerCase()] = String(value);
  const subs = placeholderOrder(key).map((name) => values[name] ?? '');
  return fromChrome(key, subs) || fromCatalog(key, values);
}

/**
 * The message split around its placeholders, with each placeholder replaced by the value given in
 * `slots`, so a translated sentence can carry markup (a bold duration) without changing word order.
 */
export function tParts<T>(key: MessageKey, slots: Readonly<Record<string, T>>): (string | T)[] {
  const names = Object.keys(slots);
  const markers: Record<string, string> = {};
  names.forEach((name, i) => {
    markers[name] = `\uE000${i}\uE001`;
  });
  const pieces = t(key, markers).split(SLOT);
  const out: (string | T)[] = [];
  pieces.forEach((piece, i) => {
    if (i % 2 === 0) {
      if (piece !== '') out.push(piece);
      return;
    }
    const name = names[Number(piece)];
    if (name !== undefined) out.push(slots[name] as T);
  });
  return out;
}

/** The language of the catalog Chrome actually serves, so durations match the sentences around them. */
export function uiLang(): Locale {
  return t('lang') === 'fr' ? 'fr' : 'en';
}

/** BCP 47 tag for `Intl` date formatting in the catalog's language. */
export function dateLocale(lang: Locale = uiLang()): string {
  return lang === 'fr' ? 'fr-CA' : 'en-US';
}
