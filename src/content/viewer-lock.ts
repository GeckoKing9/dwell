/**
 * Input lock for a short-video viewer in one-video mode. While it is on, a wheel, an arrow or page key,
 * or a one-finger vertical swipe that would advance the viewer to the next video is cancelled on `window`
 * in the capture phase, before any handler on the page's elements sees it.
 *
 * The `keydown` listener is attached once, when the guard starts at document_start, and returns at once
 * while the lock is off. Being the first listener on `window`, it always runs before any key listener the
 * page adds there later, also after an in-page move into a viewer. The wheel and touch listeners are
 * attached only while the lock is on, because a permanent non-passive wheel listener would slow scrolling
 * on the whole site; after an in-page move into a viewer they come after the page's own `window`
 * listeners, and the guard's URL lock is the backstop.
 *
 * The decisions are the pure rules in `blocker/scroll.ts`; this file only describes the event target's
 * ancestors to them: computed overflow-y and scroll-snap-type, scroll metrics, and whether a video is
 * inside. Nothing is stored or sent.
 */
import { keySwallowed, touchSwallowed, wheelSwallowed, type EditableLike, type ScrollBox } from '../blocker/scroll.ts';

/** Non-passive so `preventDefault` can stop the scroll; capture so the page's handlers come after. */
const OPTIONS: AddEventListenerOptions = { capture: true, passive: false };
/** The touch start is only read, never cancelled. */
const PASSIVE: AddEventListenerOptions = { capture: true, passive: true };

/** A non-overflowing ancestor cannot take a scroll, so neither its computed style nor its videos are read. */
const STILL: Omit<ScrollBox, 'scrollTop' | 'scrollHeight' | 'clientHeight'> = {
  overflowY: 'visible',
  snapType: 'none',
  hasVideo: false,
};

let locked = false;
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
    yield { overflowY: style.overflowY, snapType: style.scrollSnapType, hasVideo: node.querySelector('video') !== null, ...metrics };
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
  if (!locked) return;
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

/**
 * Attaches the `keydown` listener for the life of the guard; call it once, at document_start. Returns the
 * function that detaches it.
 */
export function startKeyLock(): () => void {
  window.addEventListener('keydown', onKeyDown, OPTIONS);
  return () => window.removeEventListener('keydown', onKeyDown, OPTIONS);
}

/** Turns the lock on or off: the keys follow at once, the wheel and touch listeners are attached or detached. */
export function setInputLock(on: boolean): void {
  if (on === locked) return;
  locked = on;
  if (on) {
    window.addEventListener('wheel', onWheel, OPTIONS);
    window.addEventListener('touchstart', onTouchStart, PASSIVE);
    window.addEventListener('touchmove', onTouchMove, OPTIONS);
    return;
  }
  window.removeEventListener('wheel', onWheel, OPTIONS);
  window.removeEventListener('touchstart', onTouchStart, PASSIVE);
  window.removeEventListener('touchmove', onTouchMove, OPTIONS);
  touchStart = null;
}
