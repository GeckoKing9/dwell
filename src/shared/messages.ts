/**
 * Every runtime message in Dwell (content script, popup, dashboard -> worker) and its strict validator
 * (KTD4c). `checkMessage` accepts only plain objects with exactly the documented keys and types, and
 * returns a fresh copy so nothing else the sender attached survives. A settings patch goes through the
 * field validators of `settings.ts`, the same ones import and storage use, so the caps and the site
 * rule cannot drift apart. The worker authorises by sender with `CONTENT_MESSAGE_TYPES` /
 * `PAGE_MESSAGE_TYPES` (or `allowedFrom`). Pure: no Chrome APIs.
 */
import { BLOCKED_SITES, type BlockedSite } from '../store/schema.ts';
import { isPlainObject, type Check } from '../store/validate.ts';
import { validateSettingsPatch, type SettingsPatch } from './settings.ts';

export type { SettingsPatch } from './settings.ts';
/** The one site rule (`isSiteId`), under the name the dashboard's host checks import. */
export { isSiteId as isHostname } from '../store/validate.ts';

export interface BlockedMessage {
  type: 'blocked';
  site: BlockedSite;
}
export interface MediaMessage {
  type: 'media';
  playing: boolean;
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

const UNKNOWN: { ok: false; reason: string } = { ok: false, reason: 'The message is not one Dwell understands.' };

type Json = Record<string, unknown>;

/** Own keys are a subset of `allowed` and include every key in `required`. */
function keysWithin(value: Json, allowed: readonly string[], required: readonly string[] = allowed): boolean {
  const keys = Object.keys(value);
  return keys.every((k) => allowed.includes(k)) && required.every((k) => Object.hasOwn(value, k));
}

function isBlockedSite(value: unknown): value is BlockedSite {
  return typeof value === 'string' && (BLOCKED_SITES as readonly string[]).includes(value);
}

/** A validated, freshly built settings patch: the settings field validators, and never an empty change. */
export function parseSettingsPatch(value: unknown): Check<SettingsPatch> {
  const patch = validateSettingsPatch(value);
  if (patch.ok && Object.keys(patch.value).length === 0) return { ok: false, reason: 'A settings change must name at least one setting.' };
  return patch;
}

/** Every message but `settings`, validated and copied, or null when the shape is anything other than documented. */
function parseFixedShape(value: Json): Exclude<Message, SettingsMessage> | null {
  switch (value.type) {
    case 'blocked':
      return keysWithin(value, ['type', 'site']) && isBlockedSite(value.site) ? { type: 'blocked', site: value.site } : null;
    case 'media':
      return keysWithin(value, ['type', 'playing']) && typeof value.playing === 'boolean'
        ? { type: 'media', playing: value.playing }
        : null;
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

/** The message, validated and copied, or the reason it was refused (a settings patch names its key). */
export function checkMessage(value: unknown): Check<Message> {
  if (!isPlainObject(value)) return UNKNOWN;
  if (value.type === 'settings') {
    if (!keysWithin(value, ['type', 'patch'])) return UNKNOWN;
    const patch = parseSettingsPatch(value.patch);
    return patch.ok ? { ok: true, value: { type: 'settings', patch: patch.value } } : patch;
  }
  const message = parseFixedShape(value);
  return message === null ? UNKNOWN : { ok: true, value: message };
}

/** The message, validated and copied, or null when the shape is anything other than documented. */
export function parseMessage(value: unknown): Message | null {
  const checked = checkMessage(value);
  return checked.ok ? checked.value : null;
}

/** True when a sender of this class may send this message type. */
export function allowedFrom(message: Message, sender: 'content' | 'page'): boolean {
  const allowed: readonly string[] = sender === 'content' ? CONTENT_MESSAGE_TYPES : PAGE_MESSAGE_TYPES;
  return allowed.includes(message.type);
}
