/**
 * The one way a content script talks to the worker. Bundled into each content-script IIFE.
 * When the extension is reloaded or removed, a content script already in a page is orphaned:
 * `chrome.runtime.id` disappears and `sendMessage` throws. Callers pass `onDead` to shut down.
 */
import type { ContentMessage } from '../shared/messages.ts';

export function extensionAlive(): boolean {
  try {
    return typeof chrome.runtime?.id === 'string';
  } catch {
    // Reading chrome.runtime on an invalidated context can throw; that is the answer.
    return false;
  }
}

export function sendToWorker(message: ContentMessage, onDead: () => void): void {
  if (!extensionAlive()) {
    onDead();
    return;
  }
  try {
    chrome.runtime.sendMessage(message).catch(() => {
      // No receiver (the worker is starting or not listening) drops this one message by design:
      // content scripts log nothing on third-party pages. An invalidated context shuts the script down.
      if (!extensionAlive()) onDead();
    });
  } catch {
    onDead();
  }
}
