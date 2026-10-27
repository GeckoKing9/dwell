/** Column shapes shared by the week and day charts. */
import { barPath } from '../shared/ui/chart.tsx';

/** An empty column keeps a flat path of the same shape, so the same element can grow from the baseline. */
const FLAT = 0.01;

export interface Column {
  d: string;
  /** Nothing to draw: the path is flat and hidden. */
  empty: boolean;
}

/**
 * A column's path. Every column keeps one path element whose commands never change shape, so a change of
 * week, day or focus animates the height (CSS transition on `d`) instead of swapping elements. A column
 * with any time is at least 2 units tall, so a minute still shows.
 */
export function column(x: number, base: number, w: number, hgt: number): Column {
  const empty = !(hgt > 0);
  return { d: barPath(x, base, w, empty ? FLAT : Math.max(2, hgt)), empty };
}

/** The bar's class: hidden when empty, else the accent, the hover shade or the neutral bar. */
export function barClass(base: string, col: Column, accent: boolean, hover: boolean): string {
  if (col.empty) return `${base} is-empty`;
  if (accent) return `${base} is-accent`;
  return hover ? `${base} is-hover` : base;
}
