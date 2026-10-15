/**
 * Input lock for a short-video viewer in one-video mode. While it is on, a wheel, an arrow or page key,
 * or a one-finger vertical swipe that would advance the viewer to the next video is cancelled on `window`
 * in the capture phase, before any handler on the page's elements sees it. The guard turns it on at
 * document_start on a hard load, so it also comes before the page's own `window` listeners; after an
 * in-page move into a viewer it is added later than those, and the guard's URL lock is the backstop. The
 * decisions are the pure rules in `blocker/scroll.ts`; this file only describes the event target's
 * ancestors to them: computed overflow-y and scroll-snap-type plus scroll metrics. Nothing is stored or sent.
 */
import { keySwallowed, touchSwallowed, wheelSwallowed, type EditableLike, type ScrollBox } from '../blocker/scroll.ts';

/** Non-passive so `preventDefault` can stop the scroll; capture so the page's handlers come after. */
const OPTIONS: AddEventListenerOptions = { capture: true, passive: false };
/** The touch start is only read, never cancelled. */
const PASSIVE: AddEventListenerOptions = { capture: true, passive: true };

/** A non-overflowing ancestor cannot take a scroll, so its computed style is never read. */
const STILL: Omit<ScrollBox, 'scrollTop' | 'scrollHeight' | 'clientHeight'> = { overflowY: 'visible', snapType: 'none' };

let attached = false;
let touchStart: { x: number; y: number } | null = null;

/** The event path's elements below the document scroller, read lazily, innermost first. */
function* ancestors(event: Event): Generator<ScrollBox> {
  const roots: readonly (EventTarget | null)[] = [document.scrollingElement, document.documentElement, document.body];
  for (const node of event.composedPath()) {
    if (roots.includes(node)) return;
    if (!(node instanceof Element)) continue;
    const metrics = { scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight };
    if (metrics.scrollHeight <= metrics.clientHeight + 1) {
      yield { ...STILL, ...metrics };
      continue;
    }
    const style = getComputedStyle(node);
    yield { overflowY: style.overflowY, snapType: style.scrollSnapType, ...metrics };
  }
}

function editable(target: EventTarget | undefined): EditableLike | null {
  if (!(target instanceof Element)) return null;
  return {
    tagName: target.tagName,
    isContentEditable: target instanceof HTMLElement && target.isContentEditable,
    role: target.getAttribute('role'),
  };
}

function swallow(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function onWheel(event: WheelEvent): void {
  if (wheelSwallowed(event.deltaX, event.deltaY, ancestors(event))) swallow(event);
}

function onKeyDown(event: KeyboardEvent): void {
  if (keySwallowed(event.key, editable(event.composedPath()[0]))) swallow(event);
}

function onTouchStart(event: TouchEvent): void {
  const touch = event.touches[0];
  touchStart = event.touches.length === 1 && touch !== undefined ? { x: touch.clientX, y: touch.clientY } : null;
}

function onTouchMove(event: TouchEvent): void {
  const touch = event.touches[0];
  if (touchStart === null || touch === undefined) return;
  const move = { dx: touchStart.x - touch.clientX, dy: touchStart.y - touch.clientY, touches: event.touches.length };
  if (touchSwallowed(move, editable(event.composedPath()[0]), ancestors(event))) swallow(event);
}

/** Attaches or detaches the three listeners; a no-op when already in the wanted state. */
export function setInputLock(on: boolean): void {
  if (on === attached) return;
  attached = on;
  if (on) {
    window.addEventListener('wheel', onWheel, OPTIONS);
    window.addEventListener('keydown', onKeyDown, OPTIONS);
    window.addEventListener('touchstart', onTouchStart, PASSIVE);
    window.addEventListener('touchmove', onTouchMove, OPTIONS);
    return;
  }
  window.removeEventListener('wheel', onWheel, OPTIONS);
  window.removeEventListener('keydown', onKeyDown, OPTIONS);
  window.removeEventListener('touchstart', onTouchStart, PASSIVE);
  window.removeEventListener('touchmove', onTouchMove, OPTIONS);
  touchStart = null;
}
