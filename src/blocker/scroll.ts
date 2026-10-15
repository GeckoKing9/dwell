/**
 * Pure input decisions for the viewer lock (one-video mode). The content script describes the event
 * target's ancestors (below the document scroller) as plain boxes; nothing here touches the DOM, so the
 * rules run in Node.
 *
 * A wheel, key or touch that would advance a short-video viewer to the next video is swallowed, unless
 * an ancestor can take the scroll itself: a scroll container that does not snap vertically, holds no
 * video, and still has room in that direction (a comments panel at its end would otherwise chain the
 * scroll to the viewer). A scroller with a video inside is the viewer, snap or not: Facebook's may be a
 * plain `overflow-y: auto` container.
 */

/** What the lock needs to know about one ancestor of the event target. */
export interface ScrollBox {
  readonly overflowY: string;
  readonly snapType: string;
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  /** True when a `<video>` is inside it; only read for an ancestor that overflows. */
  readonly hasVideo: boolean;
}

/** What the lock needs to know about a key event's target; null when it is not an element. */
export interface EditableLike {
  readonly tagName: string;
  readonly isContentEditable: boolean;
  readonly role: string | null;
}

/** 1: down, -1: up, 0: no vertical movement yet. */
export type Direction = -1 | 0 | 1;

/** Scroll metrics are fractional under zoom; a pixel of slack keeps a panel at its end from counting. */
const SLACK_PX = 1;
const SCROLLABLE = new Set(['auto', 'scroll', 'overlay']);
const VERTICAL_SNAP = /\b(?:y|block|both)\b/;
const LOCKED_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp']);
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
/** ARIA widgets that use the arrow keys or a drag themselves: a volume slider, a menu, a list. */
const WIDGET_ROLES = new Set([
  'textbox',
  'searchbox',
  'slider',
  'spinbutton',
  'scrollbar',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'listbox',
  'option',
  'combobox',
  'radiogroup',
  'radio',
  'tablist',
  'tab',
  'tree',
  'treeitem',
  'grid',
  'gridcell',
]);

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
    !box.hasVideo &&
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

/** A touch move since its touchstart: `dy` > 0 when the finger moved up, which scrolls the content down. */
export interface TouchMove {
  readonly dx: number;
  readonly dy: number;
  readonly touches: number;
}

function usesInput(target: EditableLike | null): boolean {
  if (target === null) return false;
  return (
    target.isContentEditable ||
    (target.role !== null && WIDGET_ROLES.has(target.role)) ||
    EDITABLE_TAGS.has(target.tagName.toUpperCase())
  );
}

/**
 * A one-finger vertical swipe is swallowed unless an ancestor can take it. A horizontal drag (a seek bar,
 * a carousel), a pinch, and a drag on a slider or other widget go through.
 */
export function touchSwallowed(move: TouchMove, target: EditableLike | null, chain: Iterable<ScrollBox>): boolean {
  if (move.touches !== 1 || Math.abs(move.dx) > Math.abs(move.dy) || usesInput(target)) return false;
  return !canAbsorb(chain, move.dy > 0 ? 1 : move.dy < 0 ? -1 : 0);
}

/** Arrow and page keys are swallowed unless the user is typing or a focused widget uses them. */
export function keySwallowed(key: string, target: EditableLike | null): boolean {
  return LOCKED_KEYS.has(key) && !usesInput(target);
}
