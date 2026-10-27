import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/store/schema.ts';
import { buildModel } from '../src/popup/data.ts';
import { scaleHours, WeekChart } from '../src/popup/components/WeekChart.tsx';
import { ChartTip } from '../src/shared/ui/ChartTip.tsx';
import { barPath, DotChannel } from '../src/shared/ui/chart.tsx';
import { Duration } from '../src/shared/ui/Duration.tsx';
import { ArrowIcon } from '../src/shared/ui/icons.tsx';
import { LetterMark, letterOf } from '../src/shared/ui/LetterMark.tsx';
import { trackPercent } from '../src/shared/ui/Track.tsx';
import { all, byClass, expand, text } from './support/vnode.ts';
import type { El } from './support/vnode.ts';
import { day, NOW } from './support/popup.ts';

/** Seven days of 2h 30m, today 1h 14m. */
const days = buildModel({
  settings: DEFAULT_SETTINGS,
  today: day({ 'github.com': { 10: 2640 }, 'instagram.com': { 15: 960 }, 'music.youtube.com': { 14: 780 }, 'x.com': { 9: 60 } }),
  previous: Array.from({ length: 7 }, () => day({ 'github.com': { 10: 3600, 15: 1800, 20: 3600 } })),
  now: NOW,
  url: null,
}).week;

const DASH = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/src/dashboard/index.html';
const LINKS = { dayUrl: (date: string) => `${DASH}#day/${date}`, onOpenDay: vi.fn() };

describe('week chart', () => {
  it('scales to at least 4 hours, else the busiest day rounded up', () => {
    expect(scaleHours(days)).toBe(4);
    expect(scaleHours(days.map((d, k) => (k === 0 ? { ...d, total: 5 * 3600 + 1 } : d)))).toBe(6);
    expect(scaleHours(days.map((d) => ({ ...d, total: 600 })))).toBe(4);
    expect(scaleHours([])).toBe(4);
  });

  it('shows the hovered day’s total, date and top sites in a tooltip', () => {
    const tree = expand(WeekChart({ days, empty: false, paused: false, active: 5, onActive: vi.fn(), ...LINKS }));
    const tip = byClass(tree, 'tip');
    expect(tip).toHaveLength(1);
    expect(text(byClass(tip, 'tip-head'))).toBe('2h\u00a030mTue, Oct 13');
    expect(byClass(tip, 'tip-row').map((r) => text([r]))).toEqual(['github.com2h\u00a030m']);
  });

  it('makes every day with time a link to that day in the dashboard, in a new tab, and says so in the tooltip', () => {
    const quiet = days.map((d, k) => (k === 2 ? { ...d, total: 0, top: [] } : d));
    const tree = expand(WeekChart({ days: quiet, empty: false, paused: false, active: 5, onActive: vi.fn(), ...LINKS }));
    const links = all(tree, (el) => el.type === 'a');
    expect(links).toHaveLength(6);
    expect(links[4]?.props.href).toBe(`${DASH}#day/2026-10-13`);
    expect(links[4]?.props.target).toBe('_blank');
    expect(links[4]?.props['aria-label']).toBe('Tuesday, 2h\u00a030m. Opens this day in the dashboard');
    expect(links.map((a) => a.props.href)).not.toContain(`${DASH}#day/2026-10-10`);
    expect(text(byClass(byClass(tree, 'tip'), 'tip-foot'))).toBe('Opens this day in the dashboard');
  });

  it('opens the day through the popup’s handler on a plain click, and leaves a new-tab click to the browser', () => {
    const onOpenDay = vi.fn();
    const tree = expand(WeekChart({ days, empty: false, paused: false, active: null, onActive: vi.fn(), dayUrl: LINKS.dayUrl, onOpenDay }));
    const link = all(tree, (el) => el.type === 'a')[5];
    const click = (init: Partial<MouseEvent>) => {
      const preventDefault = vi.fn();
      (link?.props.onClick as (e: unknown) => void)({ button: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...init, preventDefault });
      return preventDefault;
    };
    expect(click({})).toHaveBeenCalled();
    expect(click({ ctrlKey: true })).not.toHaveBeenCalled();
    expect(click({ button: 1 })).not.toHaveBeenCalled();
    expect(onOpenDay.mock.calls).toEqual([['2026-10-13']]);
  });

  it('reports hover on the bar and focus on the link', () => {
    const onActive = vi.fn();
    const tree = expand(WeekChart({ days, empty: false, paused: false, active: null, onActive, ...LINKS }));
    const link = all(tree, (el) => el.type === 'a')[6];
    const hit = byClass(tree, 'hit')[6];
    for (const event of ['onFocus', 'onBlur']) (link?.props[event] as () => void)();
    for (const event of ['onPointerEnter', 'onPointerLeave']) (hit?.props[event] as () => void)();
    expect(onActive.mock.calls).toEqual([[6], [null], [6], [null]]);
  });

  it('shows no tooltip for a day without data', () => {
    const quiet = days.map((d, k) => (k === 2 ? { ...d, total: 0, top: [] } : d));
    expect(byClass(expand(WeekChart({ days: quiet, empty: false, paused: false, active: 2, onActive: vi.fn(), ...LINKS })), 'tip')).toHaveLength(0);
  });

  it('labels the chart with every day and its total', () => {
    const svg = all(expand(WeekChart({ days, empty: false, paused: false, active: null, onActive: vi.fn(), ...LINKS })), (el) => el.type === 'svg')[0];
    expect(svg?.props['aria-label']).toBe('Last 7 days: Thu 2h\u00a030m, Fri 2h\u00a030m, Sat 2h\u00a030m, Sun 2h\u00a030m, Mon 2h\u00a030m, Tue 2h\u00a030m, Wed 1h\u00a014m');
  });
});

describe('shared marks', () => {
  it('rounds the data end of a bar and draws nothing for zero', () => {
    expect(barPath(10, 68, 18, 0)).toBe('');
    expect(barPath(10, 68, 18, 20)).toBe('M10 68V52Q10 48 14 48H24Q28 48 28 52V68Z');
    expect(barPath(0, 10, 18, 2)).toBe('M0 10V10Q0 8 2 8H16Q18 8 18 10V10Z');
  });

  it('puts one dot per unit in the channel, every n-th one larger', () => {
    const dots = all(expand(DotChannel({ cx: 5, base: 50, rows: 4, step: 10, majorEvery: 2, faint: true })), (el) => el.type === 'circle');
    expect(dots.map((d) => d.props.r)).toEqual([0.9, 1.5, 0.9, 1.5]);
    expect(dots.map((d) => d.props.cy)).toEqual(['40.0', '30.0', '20.0', '10.0']);
    expect(dots[0]?.props.class).toBe('chart-dot is-faint');
  });

  it('keeps a track visible for tiny values and inside the bar for large ones', () => {
    expect(trackPercent(0)).toBe(0.6);
    expect(trackPercent(Number.NaN)).toBe(0.6);
    expect(trackPercent(0.5)).toBe(50);
    expect(trackPercent(3)).toBe(100);
  });

  it('marks a site with its first letter', () => {
    expect(letterOf('www.github.com')).toBe('G');
    expect(letterOf('')).toBe('?');
    expect(text(expand(LetterMark({ site: '', blank: true })))).toBe('\u2013');
  });

  it('sets duration units apart and gives assistive technology one plain string', () => {
    const tree = expand(Duration({ seconds: 2 * 3600 + 13 * 60, as: 'h1', class: 'hero-num' }));
    expect(tree[0] && typeof tree[0] !== 'string' ? tree[0].type : '').toBe('h1');
    expect(byClass(tree, 'unit').map((u) => text([u]))).toEqual(['h', 'm']);
    expect(text(byClass(tree, 'sr'))).toBe('2h\u00a013m');
    expect(all(tree, (el) => el.props['aria-hidden'] === 'true')).toHaveLength(1);
  });

  it('draws the arrows the dashboard and popup use', () => {
    for (const dir of ['right', 'left', 'back'] as const) {
      expect(all(expand(ArrowIcon({ dir })), (el) => el.type === 'path')[0]?.props.d).toMatch(/^M/);
    }
  });
});

describe('chart tooltip', () => {
  const tip = (foot?: string): El =>
    expand(ChartTip({ x: 300, y: 40, viewWidth: 328, title: 'Wed, Oct 14', value: '2h 13m', rows: [{ label: 'a.com', value: '1h' }], ...(foot ? { foot } : {}) }))[0] as El;

  function placed(width: number, tw: number, th: number, y = 40, x = 300): { left: string; top: string } {
    const el = { parentElement: { clientWidth: width }, offsetWidth: tw, offsetHeight: th, style: { left: '', top: '' } };
    const node = expand(ChartTip({ x, y, viewWidth: 328, title: 't', value: 'v', rows: [] }))[0] as El;
    (node.ref as (e: unknown) => void)(el);
    return el.style;
  }

  it('renders value, date, rows and an optional foot', () => {
    expect(text([tip()])).toBe('2h 13mWed, Oct 14a.com1h');
    expect(text(byClass([tip('Click for hours')], 'tip-foot'))).toBe('Click for hours');
  });

  it('stays inside the chart and sits above the bar when there is room', () => {
    expect(placed(328, 180, 60, 120)).toEqual({ left: '148px', top: '50px' });
  });

  it('drops below the anchor when there is no room above', () => {
    expect(placed(328, 180, 100, 40)).toEqual({ left: '148px', top: '52px' });
  });

  it('scales the anchor when the chart renders narrower than its viewBox', () => {
    expect(placed(164, 40, 20, 120, 100).left).toBe('30px');
  });

  it('does nothing without an element or a parent', () => {
    const node = tip();
    expect(() => (node.ref as (e: unknown) => void)(null)).not.toThrow();
    expect(() => (node.ref as (e: unknown) => void)({ parentElement: null })).not.toThrow();
  });
});
