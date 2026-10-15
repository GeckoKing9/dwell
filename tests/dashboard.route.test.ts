import { describe, expect, it } from 'vitest';
import { HOME, parseRoute, routeHash } from '../src/dashboard/route.ts';
import type { Route } from '../src/dashboard/route.ts';

describe('dashboard routes', () => {
  it('reads the week, n weeks back, a day, settings and privacy', () => {
    expect(parseRoute('#week')).toEqual({ view: 'week', back: 0 });
    expect(parseRoute('#week/3')).toEqual({ view: 'week', back: 3 });
    expect(parseRoute('#day/2026-10-13')).toEqual({ view: 'day', date: '2026-10-13' });
    expect(parseRoute('#settings')).toEqual({ view: 'settings' });
    expect(parseRoute('#privacy')).toEqual({ view: 'privacy' });
    expect(parseRoute('#/privacy')).toEqual({ view: 'privacy' });
  });

  it('falls back to this week for an empty, unknown or malformed hash', () => {
    for (const hash of ['', '#', '#weeks', '#week/-1', '#week/x', '#day/2026-02-30', '#day/2026-1-3', '#day/', '#__proto__']) {
      expect(parseRoute(hash), hash).toEqual(HOME);
    }
  });

  it('writes a hash that reads back as the same route', () => {
    const routes: Route[] = [
      { view: 'week', back: 0 },
      { view: 'week', back: 5 },
      { view: 'day', date: '2026-10-13' },
      { view: 'settings' },
      { view: 'privacy' },
    ];
    for (const route of routes) expect(parseRoute(routeHash(route))).toEqual(route);
    expect(routeHash({ view: 'week', back: 0 })).toBe('#week');
  });
});
