import { describe, expect, it } from 'vitest';
import { keyAction, pressOf } from '../src/dashboard/keys.ts';
import type { KeyPress } from '../src/dashboard/keys.ts';
import { buildView } from '../src/dashboard/model.ts';
import type { Route } from '../src/dashboard/route.ts';
import { sampleData } from './support/dashboard.ts';

function press(key: string, extra: Partial<KeyPress> = {}): KeyPress {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: { tagName: 'BODY' }, ...extra };
}

function at(route: Route, hour: number | null = null) {
  return { view: buildView(route, sampleData()), site: 'site' in route ? route.site : undefined, hour };
}

describe('dashboard keys on the week view', () => {
  it('moves to the previous and next week, keeping the focused site', () => {
    expect(keyAction(press('ArrowLeft'), at({ view: 'week', back: 1, site: 'a.com' }))).toEqual({ kind: 'go', route: { view: 'week', back: 2, site: 'a.com' } });
    expect(keyAction(press('ArrowRight'), at({ view: 'week', back: 1 }))).toEqual({ kind: 'go', route: { view: 'week', back: 0 } });
  });

  it('does nothing past the oldest week or after this week', () => {
    expect(keyAction(press('ArrowLeft'), at({ view: 'week', back: 2 }))).toBeNull();
    expect(keyAction(press('ArrowRight'), at({ view: 'week', back: 0 }))).toBeNull();
  });

  it('goes to this week on T or t, and does nothing when already there', () => {
    expect(keyAction(press('t'), at({ view: 'week', back: 2, site: 'a.com' }))).toEqual({ kind: 'go', route: { view: 'week', back: 0, site: 'a.com' } });
    expect(keyAction(press('T'), at({ view: 'week', back: 1 }))).toEqual({ kind: 'go', route: { view: 'week', back: 0 } });
    expect(keyAction(press('t'), at({ view: 'week', back: 0 }))).toBeNull();
  });

  it('clears the focused site on Escape, and leaves Escape alone without one', () => {
    expect(keyAction(press('Escape'), at({ view: 'week', back: 1, site: 'a.com' }))).toEqual({ kind: 'go', route: { view: 'week', back: 1 } });
    expect(keyAction(press('Escape'), at({ view: 'week', back: 1 }))).toBeNull();
  });
});

describe('dashboard keys on the day view', () => {
  it('moves to the previous and next day, keeping the focused site', () => {
    expect(keyAction(press('ArrowLeft'), at({ view: 'day', date: '2026-10-13', site: 'a.com' }))).toEqual({
      kind: 'go',
      route: { view: 'day', date: '2026-10-12', site: 'a.com' },
    });
    expect(keyAction(press('ArrowRight'), at({ view: 'day', date: '2026-10-13' }))).toEqual({ kind: 'go', route: { view: 'day', date: '2026-10-14' } });
  });

  it('stops at the oldest day and at today', () => {
    expect(keyAction(press('ArrowLeft'), at({ view: 'day', date: '2026-09-28' }))).toBeNull();
    expect(keyAction(press('ArrowRight'), at({ view: 'day', date: '2026-10-14' }))).toBeNull();
  });

  it('goes to today on T, and does nothing on today', () => {
    expect(keyAction(press('t'), at({ view: 'day', date: '2026-10-06', site: 'a.com' }))).toEqual({
      kind: 'go',
      route: { view: 'day', date: '2026-10-14', site: 'a.com' },
    });
    expect(keyAction(press('t'), at({ view: 'day', date: '2026-10-14' }))).toBeNull();
  });

  it('clears the hour first on Escape, then the site', () => {
    const day: Route = { view: 'day', date: '2026-10-13', site: 'a.com' };
    expect(keyAction(press('Escape'), at(day, 21))).toEqual({ kind: 'clearHour' });
    expect(keyAction(press('Escape'), at(day, null))).toEqual({ kind: 'go', route: { view: 'day', date: '2026-10-13' } });
    expect(keyAction(press('Escape'), at({ view: 'day', date: '2026-10-13' }, 0))).toEqual({ kind: 'clearHour' });
    expect(keyAction(press('Escape'), at({ view: 'day', date: '2026-10-13' }, null))).toBeNull();
  });
});

describe('dashboard keys that are left alone', () => {
  const week: Route = { view: 'week', back: 1, site: 'a.com' };

  it('ignores any key held with a modifier', () => {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const) {
      expect(keyAction(press('ArrowLeft', { [mod]: true }), at(week)), mod).toBeNull();
    }
  });

  it('ignores keys typed into a field or editable content', () => {
    for (const tagName of ['INPUT', 'SELECT', 'TEXTAREA', 'input']) {
      expect(keyAction(press('t', { target: { tagName } }), at(week)), tagName).toBeNull();
    }
    expect(keyAction(press('Escape', { target: { tagName: 'DIV', isContentEditable: true } }), at(week))).toBeNull();
    expect(keyAction(press('ArrowLeft', { target: null }), at(week))).toEqual({ kind: 'go', route: { view: 'week', back: 2, site: 'a.com' } });
  });

  it('ignores every key on settings and privacy, and other keys anywhere', () => {
    expect(keyAction(press('t'), at({ view: 'settings' }))).toBeNull();
    expect(keyAction(press('Escape'), at({ view: 'privacy' }))).toBeNull();
    expect(keyAction(press('x'), at(week))).toBeNull();
    expect(keyAction(press('Enter'), at({ view: 'day', date: '2026-10-13' }))).toBeNull();
  });
});

describe('reading a key event', () => {
  it('keeps the key, the modifiers and what the focused element is', () => {
    const base = { key: 't', ctrlKey: false, metaKey: true, altKey: false, shiftKey: false };
    expect(pressOf({ ...base, target: { tagName: 'INPUT', isContentEditable: false } })).toEqual({ ...base, target: { tagName: 'INPUT', isContentEditable: false } });
    expect(pressOf({ ...base, target: { tagName: 7 } })).toEqual({ ...base, target: { tagName: undefined, isContentEditable: false } });
    expect(pressOf({ ...base, target: null })).toEqual({ ...base, target: null });
  });
});
