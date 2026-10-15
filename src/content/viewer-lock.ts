/**
 * Input lock for a short-video viewer in one-video mode. While it is on, a wheel, an arrow or page key,
 * or a touch move that would advance the viewer to the next video is cancelled on `window` in the capture
 * phase, before the page's own handlers see it. The decisions are the pure rules in `blocker/scroll.ts`;
 * this file only describes the event target's ancestors to them: computed overflow-y and scroll-snap-type
 * plus scroll metrics. Nothing is stored or sent.
 */
import { keySwallowed, touchSwallowed, wheelSwallowed, type EditableLike, type ScrollBox } from '../blocker/scroll.ts';

/** Non-passive so `preventDefault` can stop the scroll; capture so the page's handlers come after. */
const OPTIONS: AddEventListenerOptions = { capture: true, passive: false };

let attached = false;

/** The event path's elements below the document scroller, read lazily, innermost first. */
function* ancestors(event: Event): Generator<ScrollBox> {
  const roots = new Set<EventTarget | null>([document.scrollingElement, document.documentElement, document.body]);
  for (const node of event.composedPath()) {
    if (roots.has(node)) return;
    if (!(node instanceof Element)) continue;
    const style = getComputedStyle(node);
    yield {
      overflowY: style.overflowY,
      snapType: style.scrollSnapType,
      scrollTop: node.scrollTop,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
    };
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

function onTouchMove(event: TouchEvent): void {
  if (touchSwallowed(ancestors(event))) swallow(event);
}

/** Attaches or detaches the three listeners; a no-op when already in the wanted state. */
export function setInputLock(on: boolean): void {
  if (on === attached) return;
  attached = on;
  if (on) {
    window.addEventListener('wheel', onWheel, OPTIONS);
    window.addEventListener('keydown', onKeyDown, OPTIONS);
    window.addEventListener('touchmove', onTouchMove, OPTIONS);
    return;
  }
  window.removeEventListener('wheel', onWheel, OPTIONS);
  window.removeEventListener('keydown', onKeyDown, OPTIONS);
  window.removeEventListener('touchmove', onTouchMove, OPTIONS);
}
