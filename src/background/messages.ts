/**
 * Runtime messages: parsed for shape, authorised by sender (KTD4c), then handled on the queue so they
 * never interleave with tracking jobs. The delete-all snapshot lives only in this worker's memory for
 * 10 s; it is never written anywhere, so a worker restart inside the window simply expires the undo.
 */
import { incrementBlocked } from '../store/days.ts';
import { deleteAll, restoreSnapshot, type Snapshot } from '../store/delete.ts';
import { importText, type ImportOutcome } from '../store/export.ts';
import { dateString, type Settings } from '../store/schema.ts';
import { loadSettings, saveSettings } from '../shared/settings.ts';
import { checkMessage, type Message } from '../shared/messages.ts';
import { authorize, type SenderLike } from './authorize.ts';
import { applySaved, applySettings, groupingChanged } from './effects.ts';
import { own } from '../tracker/records.ts';
import { attentionEvent, mediaEvent, pauseEvent, urlEvent } from './events.ts';
import type { Queue, Stores } from './queue.ts';
import { activeTabEvents } from './reseed.ts';

export const UNDO_MS = 10_000;

/** The change is saved, but Chrome refused to apply it now; the next worker start applies it. */
export type Warning = 'applied-later';
export type Failure = { ok: false; reason: string };
export type Reply =
  | { ok: true }
  | { ok: true; paused: boolean }
  | { ok: true; settings: Settings; warning?: Warning }
  | { ok: true; undoUntil: number }
  | (ImportOutcome & { warning?: Warning })
  | Failure;

export interface MessageDeps extends Stores {
  readonly queue: Queue;
  readonly extensionId: string;
}

const OK: Reply = { ok: true };
const FAILED: Failure = { ok: false, reason: 'Dwell could not complete this change.' };
const EXPIRED: Failure = { ok: false, reason: 'expired' };

type Of<T extends Message['type']> = Extract<Message, { type: T }>;

export function createMessageHandler(deps: MessageDeps): (raw: unknown, sender: SenderLike) => Promise<Reply> {
  const { queue, local, session } = deps;
  let held: { snapshot: Snapshot; until: number } | null = null;

  const blocked = (message: Of<'blocked'>): Promise<Reply> =>
    queue.run<Reply>(async (at) => {
      await incrementBlocked(local, dateString(new Date(at)), message.site);
      return OK;
    }, FAILED);

  async function media(message: Of<'media'>, tabId: number | undefined): Promise<Reply> {
    if (tabId === undefined) return FAILED;
    return (await queue.track(({ at }) => [mediaEvent(tabId, message.playing, message.watched === true, at)])) ? OK : FAILED;
  }

  /**
   * Input the page took outside Chrome's focus. The engine may not know the tab yet (a window it was never
   * focused in), so a page that takes input first tells it which site the tab shows.
   */
  async function attention(message: Of<'attention'>, tab: SenderLike['tab']): Promise<Reply> {
    const tabId = tab?.id;
    const windowId = tab?.windowId;
    if (tabId === undefined || windowId === undefined) return FAILED;
    const done = await queue.track(({ at, state, settings: grouping }) => {
      const event = attentionEvent(tabId, windowId, message.present, at);
      if (!message.present) return state.attention?.tabId === tabId ? [event] : [];
      const url = urlEvent({ id: tabId, url: tab?.url, incognito: tab?.incognito ?? false }, grouping, at);
      return own(state.tabs, String(tabId))?.site === url.site ? [event] : [url, event];
    });
    return done ? OK : FAILED;
  }

  async function pause(message: Of<'pause'>): Promise<Reply> {
    const done = await queue.track(async ({ at }) => {
      await saveSettings(local, { paused: message.paused });
      return [pauseEvent(message.paused, at)];
    });
    return done ? { ok: true, paused: message.paused } : FAILED;
  }

  async function settings(message: Of<'settings'>): Promise<Reply> {
    let reply: Reply = FAILED;
    await queue.track(async ({ at, settings: before }) => {
      const result = await saveSettings(local, message.patch);
      if (!result.ok) {
        reply = { ok: false, reason: result.reason };
        return [];
      }
      const applied = await applySaved(before, result.value);
      reply = applied ? { ok: true, settings: result.value } : { ok: true, settings: result.value, warning: 'applied-later' };
      return groupingChanged(before, result.value) ? activeTabEvents(null, result.value, at) : [];
    });
    return reply;
  }

  async function importFile(message: Of<'import'>): Promise<Reply> {
    let reply: Reply = FAILED;
    const done = await queue.track(async ({ at, settings: before }) => {
      const outcome = await importText(local, message.text, new Date(at));
      reply = outcome;
      if (!outcome.ok || !outcome.settingsWritten) return [];
      const after = await loadSettings(local);
      if (!(await applySaved(before, after))) reply = { ...outcome, warning: 'applied-later' };
      return groupingChanged(before, after) ? activeTabEvents(null, after, at) : [];
    });
    return done ? reply : FAILED;
  }

  const removeAll = (): Promise<Reply> =>
    queue.run<Reply>(async (at) => {
      const entry = { snapshot: await deleteAll(local, session), until: at + UNDO_MS };
      held = entry;
      setTimeout(() => {
        if (held === entry) held = null;
      }, UNDO_MS);
      return { ok: true, undoUntil: entry.until };
    }, FAILED);

  const undo = (): Promise<Reply> =>
    queue.run<Reply>(async (at) => {
      const entry = held;
      if (entry === null || at > entry.until) return EXPIRED;
      held = null;
      await restoreSnapshot(local, entry.snapshot);
      await applySettings(null, await loadSettings(local));
      return OK;
    }, FAILED);

  return async (raw, sender) => {
    const checked = checkMessage(raw);
    if (!checked.ok) return { ok: false, reason: checked.reason };
    const message = checked.value;
    const auth = authorize(message, sender, deps.extensionId);
    if (!auth.ok) return auth;
    switch (message.type) {
      case 'blocked':
        return blocked(message);
      case 'media':
        return media(message, sender.tab?.id);
      case 'attention':
        return attention(message, sender.tab);
      case 'pause':
        return pause(message);
      case 'settings':
        return settings(message);
      case 'import':
        return importFile(message);
      case 'deleteAll':
        return removeAll();
      case 'undoDelete':
        return undo();
    }
  };
}
