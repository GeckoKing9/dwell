/**
 * Every runtime message in Dwell (content script, popup, dashboard -> worker) and its strict validator
 * (KTD4c). `parseMessage` accepts only plain objects with exactly the documented keys and types, and
 * returns a fresh copy so nothing else the sender attached survives. The worker authorises by sender
 * with `CONTENT_MESSAGE_TYPES` / `PAGE_MESSAGE_TYPES` (or `allowedFrom`). Pure: no Chrome APIs.
 */
import { BLOCKED_SITES, CATEGORIES, type BlockedSite, type Category, type Settings } from '../store/schema.ts';

export interface BlockedMessage {
  type: 'blocked';
  site: BlockedSite;
}
export interface MediaMessage {
  type: 'media';
  playing: boolean;
}

type Blockers = Settings['blockers'];
/** A partial settings update. `paused` has its own message; `blockers` may be partial. */
export interface SettingsPatch {
  idleThresholdSec?: Settings['idleThresholdSec'];
  mediaOverride?: boolean;
  blockers?: Partial<Blockers>;
  overrides?: string[];
  ignore?: string[];
  categories?: Record<string, Category>;
  eventLog?: boolean;
}
export interface SettingsMessage {
  type: 'settings';
  patch: SettingsPatch;
}
export interface PauseMessage {
  type: 'pause';
  paused: boolean;
}
export interface ImportMessage {
  type: 'import';
  text: string;
}
export interface DeleteAllMessage {
  type: 'deleteAll';
}
export interface UndoDeleteMessage {
  type: 'undoDelete';
}

export type ContentMessage = BlockedMessage | MediaMessage;
export type PageMessage = SettingsMessage | PauseMessage | ImportMessage | DeleteAllMessage | UndoDeleteMessage;
export type Message = ContentMessage | PageMessage;
export type MessageType = Message['type'];

/** The only types a content script (a tab on one of the three sites) may send. */
export const CONTENT_MESSAGE_TYPES: readonly ContentMessage['type'][] = Object.freeze(['blocked', 'media'] as const);
/** The only types an extension page (popup, dashboard) may send. */
export const PAGE_MESSAGE_TYPES: readonly PageMessage['type'][] = Object.freeze([
  'settings',
  'pause',
  'import',
  'deleteAll',
  'undoDelete',
] as const);

/** chrome.storage.local holds 10 MB without `unlimitedStorage`; an export can never be larger. */
export const MAX_IMPORT_CHARS = 10 * 1024 * 1024;
export const MAX_HOST_LIST = 500;
export const MAX_CATEGORY_ENTRIES = 2000;

const IDLE_THRESHOLDS: readonly number[] = [30, 60, 120, 300];
const BLOCKER_KEYS: readonly (keyof Blockers)[] = ['instagramReels', 'youtubeShorts', 'facebookReels', 'instagramExplore'];
const PATCH_KEYS: readonly (keyof SettingsPatch)[] = [
  'idleThresholdSec',
  'mediaOverride',
  'blockers',
  'overrides',
  'ignore',
  'categories',
  'eventLog',
];
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
/** Lowercase DNS hostname with at least two labels, 253 characters at most. */
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

type Json = Record<string, unknown>;

function isPlainObject(value: unknown): value is Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Own keys are a subset of `allowed` and include every key in `required`. */
function keysWithin(value: Json, allowed: readonly string[], required: readonly string[] = allowed): boolean {
  const keys = Object.keys(value);
  return keys.every((k) => allowed.includes(k)) && required.every((k) => Object.hasOwn(value, k));
}

function isBlockedSite(value: unknown): value is BlockedSite {
  return typeof value === 'string' && (BLOCKED_SITES as readonly string[]).includes(value);
}

export function isHostname(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 253 && !FORBIDDEN_KEYS.has(value) && HOST_RE.test(value);
}

function hostList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_HOST_LIST) return null;
  return value.every(isHostname) ? [...value] : null;
}

function blockersPatch(value: unknown): Partial<Blockers> | null {
  if (!isPlainObject(value) || !keysWithin(value, BLOCKER_KEYS, [])) return null;
  const out: Partial<Blockers> = {};
  for (const key of BLOCKER_KEYS) {
    if (!Object.hasOwn(value, key)) continue;
    const flag = value[key];
    if (typeof flag !== 'boolean') return null;
    out[key] = flag;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function categoryMap(value: unknown): Record<string, Category> | null {
  if (!isPlainObject(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_CATEGORY_ENTRIES) return null;
  const out: Record<string, Category> = Object.create(null) as Record<string, Category>;
  for (const [host, category] of entries) {
    if (!isHostname(host) || !(CATEGORIES as readonly unknown[]).includes(category)) return null;
    out[host] = category as Category;
  }
  return out;
}

const PATCH_FIELDS: { [K in keyof SettingsPatch]-?: (value: unknown) => SettingsPatch[K] | null } = {
  idleThresholdSec: (v) => (typeof v === 'number' && IDLE_THRESHOLDS.includes(v) ? (v as Settings['idleThresholdSec']) : null),
  mediaOverride: (v) => (typeof v === 'boolean' ? v : null),
  blockers: blockersPatch,
  overrides: hostList,
  ignore: hostList,
  categories: categoryMap,
  eventLog: (v) => (typeof v === 'boolean' ? v : null),
};

/** A validated, freshly built settings patch, or null on any unknown key or wrong type. */
export function parseSettingsPatch(value: unknown): SettingsPatch | null {
  if (!isPlainObject(value) || !keysWithin(value, PATCH_KEYS, [])) return null;
  const out: Record<string, unknown> = {};
  for (const key of PATCH_KEYS) {
    if (!Object.hasOwn(value, key)) continue;
    const parsed = PATCH_FIELDS[key](value[key]);
    if (parsed === null) return null;
    out[key] = parsed;
  }
  return Object.keys(out).length > 0 ? (out as SettingsPatch) : null;
}

/** The message, validated and copied, or null when the shape is anything other than documented. */
export function parseMessage(value: unknown): Message | null {
  if (!isPlainObject(value)) return null;
  switch (value.type) {
    case 'blocked':
      return keysWithin(value, ['type', 'site']) && isBlockedSite(value.site) ? { type: 'blocked', site: value.site } : null;
    case 'media':
      return keysWithin(value, ['type', 'playing']) && typeof value.playing === 'boolean'
        ? { type: 'media', playing: value.playing }
        : null;
    case 'settings': {
      const patch = keysWithin(value, ['type', 'patch']) ? parseSettingsPatch(value.patch) : null;
      return patch === null ? null : { type: 'settings', patch };
    }
    case 'pause':
      return keysWithin(value, ['type', 'paused']) && typeof value.paused === 'boolean'
        ? { type: 'pause', paused: value.paused }
        : null;
    case 'import':
      return keysWithin(value, ['type', 'text']) && typeof value.text === 'string' && value.text.length <= MAX_IMPORT_CHARS
        ? { type: 'import', text: value.text }
        : null;
    case 'deleteAll':
    case 'undoDelete':
      return keysWithin(value, ['type']) ? { type: value.type } : null;
    default:
      return null;
  }
}

/** True when a sender of this class may send this message type. */
export function allowedFrom(message: Message, sender: 'content' | 'page'): boolean {
  const allowed: readonly string[] = sender === 'content' ? CONTENT_MESSAGE_TYPES : PAGE_MESSAGE_TYPES;
  return allowed.includes(message.type);
}
