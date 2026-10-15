/**
 * Sender authorisation for every runtime message (KTD4c). Pure: the worker passes `chrome.runtime.id`.
 * - The sender must be this extension.
 * - An extension page (popup, dashboard; top frame only) may send only the page message types.
 * - A content script (a top-frame tab on an https www, m or bare host of Instagram, YouTube or Facebook,
 *   or on x.com) may send only `blocked` and `media`, and `blocked` only for the site it runs on.
 * Reasons name the rule that failed and never echo the sender URL.
 */
import { siteForHost } from '../blocker/patterns.ts';
import type { BlockedSite } from '../store/schema.ts';
import { allowedFrom, type Message } from '../shared/messages.ts';

export type Origin = 'content' | 'page';
export type Authorization = { ok: true; origin: Origin } | { ok: false; reason: string };

/** The fields of `chrome.runtime.MessageSender` that decide who sent a message. */
export interface SenderLike {
  readonly id?: string | undefined;
  readonly url?: string | undefined;
  readonly tab?: { readonly id?: number | undefined } | undefined;
  readonly frameId?: number | undefined;
}

type Classified = { kind: 'page' } | { kind: 'content'; site: BlockedSite };

function deny(reason: string): Authorization {
  return { ok: false, reason };
}

function hostOf(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    // Not an absolute URL: no host, so not one of the four sites.
    return null;
  }
}

function classify(sender: SenderLike, extensionId: string): Classified | null {
  const url = sender.url;
  if (url === undefined) return null;
  if (sender.frameId !== undefined && sender.frameId !== 0) return null;
  if (url.startsWith(`chrome-extension://${extensionId}/`)) return { kind: 'page' };
  if (sender.tab === undefined) return null;
  const parsed = hostOf(url);
  if (parsed === null || parsed.protocol !== 'https:') return null;
  const site = siteForHost(parsed.hostname);
  return site === null ? null : { kind: 'content', site };
}

export function authorize(message: Message, sender: SenderLike, extensionId: string): Authorization {
  if (extensionId === '' || sender.id !== extensionId) return deny('The sender is not this extension.');
  const from = classify(sender, extensionId);
  if (from === null) return deny('The sender is neither a Dwell page nor a Dwell content script on a supported site.');
  if (!allowedFrom(message, from.kind)) return deny(`A "${message.type}" message is not accepted from a ${from.kind} sender.`);
  if (message.type === 'blocked' && from.kind === 'content' && message.site !== from.site) {
    return deny('A "blocked" message must name the site its sender runs on.');
  }
  return { ok: true, origin: from.kind };
}
