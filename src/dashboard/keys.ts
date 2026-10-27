/**
 * Dashboard keys as a pure function of the key and what is on screen: Left and Right move a week or a
 * day, T goes to this week or today, Escape clears the hour, then the site. Keys held with a modifier,
 * keys typed into a field, and every key on settings and privacy are left to the browser.
 */
import type { View } from './model.ts';
import { withSite } from './route.ts';
import type { Route } from './route.ts';

export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** The focused element, if any: keys typed into a field belong to the field. */
  target: { tagName?: string | undefined; isContentEditable?: boolean } | null;
}

export interface KeyContext {
  view: View;
  site: string | undefined;
  hour: number | null;
}

export type KeyAction = { kind: 'go'; route: Route } | { kind: 'clearHour' };

/** The parts of a keyboard event the rules read; the target is read by shape so the rules run without a DOM. */
export function pressOf(event: Omit<KeyPress, 'target'> & { target: unknown }): KeyPress {
  const { key, ctrlKey, metaKey, altKey, shiftKey } = event;
  const el = typeof event.target === 'object' && event.target !== null ? (event.target as { tagName?: unknown; isContentEditable?: unknown }) : null;
  const target = el && { tagName: typeof el.tagName === 'string' ? el.tagName : undefined, isContentEditable: el.isContentEditable === true };
  return { key, ctrlKey, metaKey, altKey, shiftKey, target };
}

const FIELDS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

function ignored(press: KeyPress): boolean {
  if (press.ctrlKey || press.metaKey || press.altKey || press.shiftKey) return true;
  const target = press.target;
  return target !== null && (FIELDS.has((target.tagName ?? '').toUpperCase()) || target.isContentEditable === true);
}

/** Where a key leads from a week or a day, as the plain route there (the site is added by the caller). */
function step(key: string, view: View): Route | null {
  if (view.kind === 'week') {
    const { back, maxBack } = view.model;
    if (key === 'ArrowLeft') return back < maxBack ? { view: 'week', back: back + 1 } : null;
    if (key === 'ArrowRight') return back > 0 ? { view: 'week', back: back - 1 } : null;
    if (key === 't' || key === 'T') return back > 0 ? { view: 'week', back: 0 } : null;
    return null;
  }
  if (view.kind === 'day') {
    const { prev, next, isToday, today } = view.model;
    if (key === 'ArrowLeft') return prev === null ? null : { view: 'day', date: prev };
    if (key === 'ArrowRight') return next === null ? null : { view: 'day', date: next };
    if (key === 't' || key === 'T') return isToday ? null : { view: 'day', date: today };
  }
  return null;
}

/** The route of the week or day on screen, without a site. */
function here(view: View): Route | null {
  if (view.kind === 'week') return { view: 'week', back: view.model.back };
  if (view.kind === 'day') return { view: 'day', date: view.model.key };
  return null;
}

export function keyAction(press: KeyPress, at: KeyContext): KeyAction | null {
  if (ignored(press)) return null;
  if (press.key === 'Escape') {
    if (at.view.kind === 'day' && at.hour !== null) return { kind: 'clearHour' };
    const route = here(at.view);
    return route !== null && at.site !== undefined ? { kind: 'go', route } : null;
  }
  const route = step(press.key, at.view);
  return route === null ? null : { kind: 'go', route: withSite(route, at.site) };
}
