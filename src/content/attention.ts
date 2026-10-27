/**
 * Attention for the tracking engine: input the page takes outside Chrome's focus. Chrome reports a
 * focused window by itself, but a window without focus still scrolls under the pointer (Windows does
 * this by default) and only the page sees that. Sends `{ type: 'attention', present: true }` on
 * trusted input at most once per PING_MS while the page lacks focus, and `present: false` when the
 * pointer leaves the page or the page is hidden, if it had said present. Browsing in a focused window
 * sends nothing. Reads no content, no position and no key: only that input happened.
 */

export const PING_MS = 10_000;
/** Mouse wheel and touchpad, keys, clicks and taps; wheel is what reaches a window without focus. */
const INPUTS = ['wheel', 'keydown', 'pointerdown', 'touchstart'] as const;

export type Listen = (target: EventTarget, type: string, handler: (event: Event) => void, options: AddEventListenerOptions) => void;

export function watchAttention(listen: Listen, send: (present: boolean) => void): void {
  let pingedAt = -Infinity;
  /** A `present: true` was sent and not yet taken back; a leave resets it, so the next input pings at once. */
  let engaged = false;

  const input = (event: Event): void => {
    if (!event.isTrusted || document.hasFocus()) return;
    const now = Date.now();
    if (engaged && now >= pingedAt && now - pingedAt < PING_MS) return;
    pingedAt = now;
    engaged = true;
    send(true);
  };

  const leave = (): void => {
    if (!engaged) return;
    engaged = false;
    send(false);
  };

  for (const type of INPUTS) listen(window, type, input, { capture: true, passive: true });
  listen(document, 'visibilitychange', () => document.visibilityState === 'hidden' && leave(), {});
  // The root element exists at document_start in Chrome; the fallback covers a document without one yet.
  const root = (): void => listen(document.documentElement, 'mouseleave', leave, {});
  if (document.documentElement) root();
  else listen(document, 'DOMContentLoaded', root, { once: true });
}
