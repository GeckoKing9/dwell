/**
 * Hash routes: `#week` (this week), `#week/<n>` (n weeks back), `#day/<YYYY-MM-DD>`, `#settings`, `#privacy`.
 * The week and day routes take a focused site as `?site=<host>`. Anything else reads as this week, and a
 * site that is not a site name is dropped, so a stale or hand-typed link never lands on a blank page.
 */
import { parseDayKey } from '../store/schema.ts';
import { isSiteId } from '../store/validate.ts';

export type Route =
  | { view: 'week'; back: number; site?: string }
  | { view: 'day'; date: string; site?: string }
  | { view: 'settings' }
  | { view: 'privacy' };

export const HOME: Route = { view: 'week', back: 0 };
const WEEK_RE = /^week(?:\/(\d{1,3}))?$/;
const DAY_RE = /^day\/(\d{4}-\d{2}-\d{2})$/;

/** The `site` query value when it is a valid site id, else undefined. */
function siteParam(query: string): string | undefined {
  const site = new URLSearchParams(query).get('site');
  return isSiteId(site) ? site : undefined;
}

/** The same route with `site` set, or without one; settings and privacy never carry a site. */
export function withSite(route: Route, site: string | undefined): Route {
  if (route.view === 'settings' || route.view === 'privacy') return route;
  const base: Route = route.view === 'week' ? { view: 'week', back: route.back } : { view: 'day', date: route.date };
  return site === undefined ? base : { ...base, site };
}

export function parseRoute(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?', 2);
  if (path === 'settings' || path === 'privacy') return { view: path };
  const site = siteParam(query);
  const week = WEEK_RE.exec(path);
  if (week) return withSite({ view: 'week', back: Number(week[1] ?? 0) }, site);
  const day = DAY_RE.exec(path);
  if (day?.[1] && parseDayKey(day[1]) !== null) return withSite({ view: 'day', date: day[1] }, site);
  return HOME;
}

export function routeHash(route: Route): string {
  switch (route.view) {
    case 'week':
    case 'day': {
      const path = route.view === 'week' ? (route.back > 0 ? `#week/${route.back}` : '#week') : `#day/${route.date}`;
      return route.site === undefined ? path : `${path}?site=${encodeURIComponent(route.site)}`;
    }
    default:
      return `#${route.view}`;
  }
}

/** Focuses `site`; the site already focused, or null, clears the focus. */
export function toggleSite(route: Route, site: string | null): Route {
  const current = 'site' in route ? route.site : undefined;
  return withSite(route, site === null || site === current ? undefined : site);
}

/** True when two routes show the same week or day (or page), whatever site each focuses. */
export function samePage(a: Route, b: Route): boolean {
  return routeHash(withSite(a, undefined)) === routeHash(withSite(b, undefined));
}
