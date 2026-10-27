/**
 * Presence signals for the tracking engine (KTD2, ADR-6), one script per supported site.
 * Media: whether any <video> or <audio> element in the top frame is playing (not paused, not ended,
 * with current data, muted or not), and whether one plays with sound on a page on screen (visible or
 * in picture-in-picture): `{ type: 'media', playing, watched }`, the first answer always, so the
 * worker drops a playing state the previous document left, then only when either answer changes.
 * Attention: see attention.ts. Reads nothing else from the page.
 */
import { watchAttention } from './attention.ts';
import { extensionAlive, sendToWorker } from './runtime.ts';

const FALLBACK_MS = 5000;
/** Media events do not bubble, so they are captured on the document. */
const MEDIA_EVENTS = ['play', 'playing', 'pause', 'ended', 'emptied', 'volumechange', 'enterpictureinpicture', 'leavepictureinpicture'] as const;

interface Answer {
  playing: boolean;
  watched: boolean;
}

/** The last answer sent; null until the first one, which is always sent. */
let last: Answer | null = null;
let alive = true;
const cleanups: (() => void)[] = [];

function isPlaying(el: HTMLMediaElement): boolean {
  return !el.paused && !el.ended && el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
}

function onScreen(): boolean {
  return document.visibilityState === 'visible' || document.pictureInPictureElement !== null;
}

function current(): Answer {
  let playing = false;
  for (const el of document.querySelectorAll<HTMLMediaElement>('video, audio')) {
    if (!isPlaying(el)) continue;
    playing = true;
    if (!el.muted && el.volume > 0 && onScreen()) return { playing, watched: true };
  }
  return { playing, watched: false };
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

function report(answer: Answer): void {
  if (!alive || (answer.playing === last?.playing && answer.watched === last.watched)) return;
  last = answer;
  sendToWorker({ type: 'media', ...answer }, stop);
}

function check(): void {
  report(current());
}

function tick(): void {
  if (!extensionAlive()) stop();
  else check();
}

function listen(target: EventTarget, type: string, handler: (event: Event) => void, options: AddEventListenerOptions): void {
  target.addEventListener(type, handler, options);
  cleanups.push(() => target.removeEventListener(type, handler, options));
}

function main(): void {
  for (const type of MEDIA_EVENTS) listen(document, type, check, { capture: true });
  listen(document, 'visibilitychange', check, {});
  // Leaving the page ends its playback; a page restored from the back-forward cache is checked again.
  listen(window, 'pagehide', () => report({ playing: false, watched: false }), {});
  listen(window, 'pageshow', check, {});
  watchAttention(listen, (present) => {
    if (alive) sendToWorker({ type: 'attention', present }, stop);
  });
  const timer = setInterval(tick, FALLBACK_MS);
  cleanups.push(() => clearInterval(timer));
}

main();
