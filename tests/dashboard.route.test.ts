import { describe, expect, it } from 'vitest';
import { HOME, parseRoute, routeHash, samePage, toggleSite, withSite } from '../src/dashboard/route.ts';
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

  it('reads a focused site on the week and day routes', () => {
    expect(parseRoute('#week/1?site=instagram.com')).toEqual({ view: 'week', back: 1, site: 'instagram.com' });
    expect(parseRoute('#week?site=instagram.com')).toEqual({ view: 'week', back: 0, site: 'instagram.com' });
    expect(parseRoute('#day/2026-10-06?site=mail.google.com')).toEqual({ view: 'day', date: '2026-10-06', site: 'mail.google.com' });
  });

  it('drops a site that is not a site name, keeping the rest of the route', () => {
    for (const query of ['?site=', '?site=Instagram.com', '?site=__proto__', '?site=a%20b.com', '?site=https://x.com', '?site=x.com/path', '?other=x.com', '?site=%E0%A4%A', '?']) {
      expect(parseRoute(`#week/1${query}`), query).toEqual({ view: 'week', back: 1 });
      expect(parseRoute(`#day/2026-10-06${query}`), query).toEqual({ view: 'day', date: '2026-10-06' });
    }
  });

  it('ignores a site on settings and privacy, and falls back to this week for a bad path with a site', () => {
    expect(parseRoute('#settings?site=instagram.com')).toEqual({ view: 'settings' });
    expect(parseRoute('#privacy?site=instagram.com')).toEqual({ view: 'privacy' });
    expect(parseRoute('#day/2026-02-30?site=instagram.com')).toEqual(HOME);
    expect(parseRoute('#nope?site=instagram.com')).toEqual(HOME);
  });

  it('writes the site into the hash and reads it back', () => {
    const routes: Route[] = [
      { view: 'week', back: 0, site: 'instagram.com' },
      { view: 'week', back: 3, site: 'docs.google.com' },
      { view: 'day', date: '2026-10-06', site: 'instagram.com' },
    ];
    for (const route of routes) expect(parseRoute(routeHash(route))).toEqual(route);
    expect(routeHash({ view: 'week', back: 1, site: 'instagram.com' })).toBe('#week/1?site=instagram.com');
    expect(routeHash({ view: 'day', date: '2026-10-06', site: 'instagram.com' })).toBe('#day/2026-10-06?site=instagram.com');
  });

  it('focuses a site, clears it when chosen again or cleared, and switches to another', () => {
    const week: Route = { view: 'week', back: 1 };
    expect(toggleSite(week, 'a.com')).toEqual({ view: 'week', back: 1, site: 'a.com' });
    expect(toggleSite({ ...week, site: 'a.com' }, 'a.com')).toEqual(week);
    expect(toggleSite({ ...week, site: 'a.com' }, null)).toEqual(week);
    expect(toggleSite({ ...week, site: 'a.com' }, 'b.com')).toEqual({ ...week, site: 'b.com' });
    expect(toggleSite({ view: 'day', date: '2026-10-06' }, 'a.com')).toEqual({ view: 'day', date: '2026-10-06', site: 'a.com' });
    expect(toggleSite({ view: 'settings' }, 'a.com')).toEqual({ view: 'settings' });
  });

  it('carries a site onto another week or day, and only there', () => {
    expect(withSite({ view: 'week', back: 2 }, 'a.com')).toEqual({ view: 'week', back: 2, site: 'a.com' });
    expect(withSite({ view: 'day', date: '2026-10-06', site: 'b.com' }, undefined)).toEqual({ view: 'day', date: '2026-10-06' });
    expect(withSite({ view: 'privacy' }, 'a.com')).toEqual({ view: 'privacy' });
  });

  it('tells a new page from the same page with another focus', () => {
    expect(samePage({ view: 'week', back: 1 }, { view: 'week', back: 1, site: 'a.com' })).toBe(true);
    expect(samePage({ view: 'day', date: '2026-10-06', site: 'b.com' }, { view: 'day', date: '2026-10-06' })).toBe(true);
    expect(samePage({ view: 'week', back: 1 }, { view: 'week', back: 2 })).toBe(false);
    expect(samePage({ view: 'day', date: '2026-10-06' }, { view: 'day', date: '2026-10-07' })).toBe(false);
    expect(samePage({ view: 'settings' }, { view: 'privacy' })).toBe(false);
  });
});
