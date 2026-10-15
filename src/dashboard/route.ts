/**
 * Hash routes: `#week` (this week), `#week/<n>` (n weeks back), `#day/<YYYY-MM-DD>`, `#settings`, `#privacy`.
 * Anything else reads as this week, so a stale or hand-typed link never lands on a blank page.
 */
import { parseDayKey } from '../store/schema.ts';

export type Route =
  | { view: 'week'; back: number }
  | { view: 'day'; date: string }
  | { view: 'settings' }
  | { view: 'privacy' };

export const HOME: Route = { view: 'week', back: 0 };
const WEEK_RE = /^week(?:\/(\d{1,3}))?$/;
const DAY_RE = /^day\/(\d{4}-\d{2}-\d{2})$/;

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path === 'settings' || path === 'privacy') return { view: path };
  const week = WEEK_RE.exec(path);
  if (week) return { view: 'week', back: Number(week[1] ?? 0) };
  const day = DAY_RE.exec(path);
  if (day?.[1] && parseDayKey(day[1]) !== null) return { view: 'day', date: day[1] };
  return HOME;
}

export function routeHash(route: Route): string {
  switch (route.view) {
    case 'week':
      return route.back > 0 ? `#week/${route.back}` : '#week';
    case 'day':
      return `#day/${route.date}`;
    default:
      return `#${route.view}`;
  }
}
