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
import { parseMessage, type Message } from '../shared/messages.ts';
import { authorize, type SenderLike } from './authorize.ts';
import { applySettings, groupingChanged } from './effects.ts';
import { mediaEvent, pauseEvent } from './events.ts';
import type { Queue, Stores } from './queue.ts';
import { activeTabEvents } from './reseed.ts';

export const UNDO_MS = 10_000;

export type Failure = { ok: false; reason: string };
export type Reply =
  | { ok: true }
  | { ok: true; paused: boolean }
  | { ok: true; settings: Settings }
  | { ok: true; undoUntil: number }
  | ImportOutcome
  | Failure;

export interface MessageDeps extends Stores {
  readonly queue: Queue;
  readonly extensionId: string;
}

const OK: Reply = { ok: true };
const FAILED: Failure = { ok: false, reason: 'Dwell could not complete this change.' };
const EXPIRED: Failure = { ok: false, reason: 'expired' };
const UNKNOWN: Failure = { ok: false, reason: 'The message is not one Dwell understands.' };

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
    return (await queue.track(({ at }) => [mediaEvent(tabId, message.playing, at)])) ? OK : FAILED;
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
      await applySettings(before, result.value);
      reply = { ok: true, settings: result.value };
      return groupingChanged(before, result.value) ? activeTabEvents(null, result.value, at) : [];
    });
    return reply;
  }

  const importFile = (message: Of<'import'>): Promise<Reply> =>
    queue.run<Reply>(async (at) => {
      const before = await loadSettings(local);
      const outcome = await importText(local, message.text, new Date(at));
      if (outcome.ok && outcome.settingsWritten) await applySettings(before, await loadSettings(local));
      return outcome;
    }, FAILED);

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
    const message = parseMessage(raw);
    if (message === null) return UNKNOWN;
    const auth = authorize(message, sender, deps.extensionId);
    if (!auth.ok) return auth;
    switch (message.type) {
      case 'blocked':
        return blocked(message);
      case 'media':
        return media(message, sender.tab?.id);
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
