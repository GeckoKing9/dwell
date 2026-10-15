/**
 * Media state for the tracking engine (KTD2). Reports whether any <video> or <audio> element in the
 * top frame is playing: not paused, not ended, with current data, muted or not. Sends only
 * `{ type: 'media', playing }`: the first answer always, so the worker drops a playing state the
 * previous document left, then only when the answer changes. Reads nothing else from the page.
 */
import { extensionAlive, sendToWorker } from './runtime.ts';

const FALLBACK_MS = 5000;
/** Media events do not bubble, so they are captured on the document. */
const MEDIA_EVENTS = ['play', 'playing', 'pause', 'ended', 'emptied'] as const;

/** The last answer sent; null until the first one, which is always sent. */
let last: boolean | null = null;
let alive = true;
const cleanups: (() => void)[] = [];

function isPlaying(el: HTMLMediaElement): boolean {
  return !el.paused && !el.ended && el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
}

function anyPlaying(): boolean {
  for (const el of document.querySelectorAll<HTMLMediaElement>('video, audio')) {
    if (isPlaying(el)) return true;
  }
  return false;
}

function stop(): void {
  if (!alive) return;
  alive = false;
  for (const cleanup of cleanups.splice(0)) {
    try {
      cleanup();
    } catch {
      // The extension context is already gone; there is nothing left to detach.
    }
  }
}

function report(playing: boolean): void {
  if (!alive || playing === last) return;
  last = playing;
  sendToWorker({ type: 'media', playing }, stop);
}

function check(): void {
  report(anyPlaying());
}

function tick(): void {
  if (!extensionAlive()) stop();
  else check();
}

function listen(target: EventTarget, type: string, handler: () => void, capture: boolean): void {
  target.addEventListener(type, handler, capture);
  cleanups.push(() => target.removeEventListener(type, handler, capture));
}

function main(): void {
  for (const type of MEDIA_EVENTS) listen(document, type, check, true);
  // Leaving the page ends its playback; a page restored from the back-forward cache is checked again.
  listen(window, 'pagehide', () => report(false), false);
  listen(window, 'pageshow', check, false);
  const timer = setInterval(tick, FALLBACK_MS);
  cleanups.push(() => clearInterval(timer));
}

main();
