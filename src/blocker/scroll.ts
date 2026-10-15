/**
 * Pure input decisions for the viewer lock (one-video mode). The content script describes the event
 * target's ancestors (below the document scroller) as plain boxes; nothing here touches the DOM, so the
 * rules run in Node.
 *
 * A wheel, key or touch that would advance a short-video viewer to the next video is swallowed, unless
 * an ancestor can take the scroll itself: a scroll container that does not snap vertically and still has
 * room in that direction (a comments panel at its end would otherwise chain the scroll to the viewer).
 */

/** What the lock needs to know about one ancestor of the event target. */
export interface ScrollBox {
  readonly overflowY: string;
  readonly snapType: string;
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/** What the lock needs to know about a key event's target; null when it is not an element. */
export interface EditableLike {
  readonly tagName: string;
  readonly isContentEditable: boolean;
  readonly role: string | null;
}

/** 1: down, -1: up, 0: unknown (a touch move, whose direction is not tracked). */
export type Direction = -1 | 0 | 1;

/** Scroll metrics are fractional under zoom; a pixel of slack keeps a panel at its end from counting. */
const SLACK_PX = 1;
const SCROLLABLE = new Set(['auto', 'scroll', 'overlay']);
const VERTICAL_SNAP = /\b(?:y|block|both)\b/;
const LOCKED_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp']);
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function hasRoom(box: ScrollBox, direction: Direction): boolean {
  if (direction === 0) return true;
  if (direction > 0) return box.scrollTop + box.clientHeight < box.scrollHeight - SLACK_PX;
  return box.scrollTop >= SLACK_PX;
}

function absorbs(box: ScrollBox, direction: Direction): boolean {
  return (
    SCROLLABLE.has(box.overflowY) &&
    box.scrollHeight > box.clientHeight + SLACK_PX &&
    !VERTICAL_SNAP.test(box.snapType) &&
    hasRoom(box, direction)
  );
}

/** True when some ancestor can take the scroll; stops reading ancestors at the first that can. */
export function canAbsorb(chain: Iterable<ScrollBox>, direction: Direction): boolean {
  for (const box of chain) {
    if (absorbs(box, direction)) return true;
  }
  return false;
}

/** A wheel with vertical intent is swallowed unless an ancestor can take it. */
export function wheelSwallowed(deltaX: number, deltaY: number, chain: Iterable<ScrollBox>): boolean {
  if (deltaY === 0 || Math.abs(deltaY) < Math.abs(deltaX)) return false;
  return !canAbsorb(chain, deltaY > 0 ? 1 : -1);
}

/** A touch move is swallowed unless it happens inside a scrollable, non-snapping ancestor. */
export function touchSwallowed(chain: Iterable<ScrollBox>): boolean {
  return !canAbsorb(chain, 0);
}

function isEditable(target: EditableLike | null): boolean {
  if (target === null) return false;
  return target.isContentEditable || target.role === 'textbox' || EDITABLE_TAGS.has(target.tagName.toUpperCase());
}

/** Arrow and page keys are swallowed unless the user is typing. */
export function keySwallowed(key: string, target: EditableLike | null): boolean {
  return LOCKED_KEYS.has(key) && !isEditable(target);
}
