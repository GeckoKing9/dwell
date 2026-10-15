import { describe, expect, it, vi } from 'vitest';
import { all, byClass, byId, everything, text } from './support/vnode.ts';
import type { El, Tree } from './support/vnode.ts';
import { day, sampleData, sampleDays } from './support/dashboard.ts';
import { handlers, renderDashboard } from './support/dashboardView.ts';

const NB = '\u00a0';

function one(trees: Tree[], cls: string): El {
  const found = byClass(trees, cls)[0];
  if (!found) throw new Error(`no .${cls}`);
  return found;
}

function call(el: El | undefined, prop: string, arg?: unknown): void {
  const fn = el?.props[prop];
  if (typeof fn !== 'function') throw new Error(`no ${prop}`);
  (fn as (a: unknown) => void)(arg);
}

describe('week view', () => {
  const on = handlers();
  const tree = renderDashboard({ view: 'week', back: 0 }, sampleData(), { on });

  it('has the header with Activity current and the recording pill', () => {
    expect(byId(tree, 'nav-activity')?.props['aria-current']).toBe('page');
    expect(byId(tree, 'nav-settings')?.props['aria-current']).toBeUndefined();
    expect(text([byId(tree, 'status-pill') as El])).toBe('Recording');
    expect(byId(tree, 'paused-banner')).toBeUndefined();
  });

  it('navigates back while older weeks exist and not past this week', () => {
    expect(byId(tree, 'week-prev')?.props.disabled).toBe(false);
    expect(byId(tree, 'week-next')?.props.disabled).toBe(true);
    expect(text(byClass(tree, 'range')).replace(/\s+/g, ' ')).toBe('Oct 12 – 18, 2026');
    expect(text(byClass(tree, 'rel'))).toBe('This week');
    call(byId(tree, 'week-prev'), 'onClick');
    expect(on.onWeek).toHaveBeenCalledWith(1);
  });

  it('reads total, full-day average, the change in plain words and the quietest and busiest days', () => {
    const headline = one(tree, 'headline');
    expect(text(byClass([headline], 'label'))).toBe('This week so farDaily average, full days');
    expect(byClass([headline], 'sr').map((s) => text([s]))).toEqual([`7h${NB}20m`, `3h${NB}10m`]);
    expect(text([byId(tree, 'delta-line') as El])).toBe('Daily average is 217% higher than the week before (1h).');
    expect(all([headline], (el) => el.type === 'b').map((b) => text([b]))).toEqual(['217', `Monday 2h${NB}30m`, `Tuesday 3h${NB}50m`]);
    expect(byId(tree, 'gap-note')).toBeUndefined();
  });

  it('draws seven columns to scale with today in the accent, the average line and every value as text', () => {
    expect(byClass(tree, 'wc-day').map((d) => text([d]))).toEqual(['12 Mon', '13 Tue', 'Today', '15 Thu', '16 Fri', '17 Sat', '18 Sun']);
    expect(byClass(tree, 'wc-val').map((d) => text([d]))).toEqual([`2h${NB}30m`, `3h${NB}50m`, '1h', '', '', '', '']);
    expect(byClass(tree, 'is-accent')).toHaveLength(1);
    expect(byClass(tree, 'wc-axis').map((d) => text([d]))).toEqual(['2h', '4h']);
    expect(text(byClass(tree, 'wc-avg'))).toBe(`avg 3h${NB}10m`);
    expect(byClass(tree, 'hit').map((h) => h.props['data-day'])).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
    expect(all(byClass(tree, 'chart-wrap'), (el) => el.type === 'circle')).toHaveLength(7 * 16);
  });

  it('opens a day on click, Enter or Space, and ignores other keys', () => {
    const tuesday = byClass(tree, 'hit')[1];
    call(tuesday, 'onClick');
    const preventDefault = vi.fn();
    call(tuesday, 'onKeyDown', { key: 'Enter', preventDefault });
    call(tuesday, 'onKeyDown', { key: ' ', preventDefault });
    call(tuesday, 'onKeyDown', { key: 'Tab', preventDefault });
    expect(vi.mocked(on.onDay).mock.calls).toEqual([['2026-10-13'], ['2026-10-13'], ['2026-10-13']]);
    expect(preventDefault).toHaveBeenCalledTimes(2);
  });

  it('reports hover and focus so the bar lightens and the tooltip shows', () => {
    const onActive = vi.fn();
    const hovered = renderDashboard({ view: 'week', back: 0 }, sampleData(), { chart: { active: 1, onActive } });
    const hit = byClass(hovered, 'hit')[0];
    for (const event of ['onPointerEnter', 'onFocus', 'onPointerLeave', 'onBlur']) call(hit, event);
    expect(onActive.mock.calls).toEqual([[0], [0], [null], [null]]);
    expect(byClass(hovered, 'is-hover')).toHaveLength(1);
    const tip = one(hovered, 'tip');
    expect(text(byClass([tip], 'tip-head'))).toBe(`3h${NB}50mTue, Oct 13`);
    expect(byClass([tip], 'tip-row').map((r) => text([r]))).toEqual([`github.com2h${NB}50m`, 'youtube.com1h']);
    expect(text(byClass([tip], 'tip-foot'))).toBe('Click for the hourly view');
  });

  it('sorts categories by time with every value printed', () => {
    const rows = byClass(byClass(tree, 'panel').filter((p) => p.props.id === 'categories'), 'cat-row');
    expect(rows.map((r) => text([r]))).toEqual([
      `Work5h${NB}50m80%`,
      'Video1h14%',
      'Social30m7%',
      'Shopping–0%',
      'News–0%',
      'Other–0%',
    ]);
  });

  it('ranks the sites with category, time, share, like-for-like change and visits', () => {
    const rows = byClass(byId(tree, 'most-used') ? [byId(tree, 'most-used') as El] : [], 'mu-row').filter((r) => r.type === 'li');
    expect(rows.map((r) => [text(byClass([r], 'd')), text(byClass([r], 'chip')), text(byClass([r], 't')), text(byClass([r], 'sh')), text(byClass([r], 'dl')), text(byClass([r], 'vi'))])).toEqual([
      ['github.com', 'Work', `5h${NB}50m`, '80%', `+3h${NB}20m`, '8'],
      ['youtube.com', 'Video', '1h', '14%', 'new', '2'],
      ['instagram.com', 'Social', '30m', '7%', 'new', '6'],
    ]);
    expect(text(byClass(rows, 'meta').slice(0, 1))).toBe(`Work · 80% · +3h${NB}20m · 8 visits`);
    expect(text(byClass([byId(tree, 'most-used') as El], 'aside'))).toBe('Changes compare Mon–Wed with the same days last week');
    expect(byId(tree, 'mu-toggle')).toBeUndefined();
  });

  it('counts the week’s redirects with one dot each', () => {
    const blocked = byId(tree, 'blocked') as El;
    expect(text(byClass([blocked], 'blk-total'))).toBe('4Reels and Shorts redirects this week');
    expect(byClass([blocked], 'blk-row').map((r) => [text(byClass([r], 'n')), text(byClass([r], 'c')), all([r], (el) => el.type === 'i').length])).toEqual([
      ['Instagram', '3', 3],
      ['YouTube', '1', 1],
      ['Facebook', '0', 0],
    ]);
  });

  it('never prints NaN, undefined or Infinity', () => {
    expect(everything(tree)).not.toMatch(/NaN|undefined|Infinity/);
  });
});

describe('week view, other weeks', () => {
  it('explains gaps and labels a past week', () => {
    const tree = renderDashboard({ view: 'week', back: 1 }, sampleData());
    expect(text(byClass(tree, 'rel'))).toBe('Last week');
    expect(text(byClass(tree, 'label'))).toContain('Week total');
    expect(text([byId(tree, 'gap-note') as El])).toBe('No data for Thu, Oct 8, Fri, Oct 9. Chrome was closed or tracking was paused; averages use the 5 recorded days.');
    expect(text([byId(tree, 'delta-line') as El])).toBe('Daily average is 10% lower than the week before (1h).');
    expect(text(byClass(byId(tree, 'most-used') ? [byId(tree, 'most-used') as El] : [], 'aside'))).toBe('3 sites');
  });

  it('moves forward a week from a past one', () => {
    const on = handlers();
    const tree = renderDashboard({ view: 'week', back: 1 }, sampleData(), { on });
    expect(byId(tree, 'week-next')?.props.disabled).toBe(false);
    call(byId(tree, 'week-next'), 'onClick');
    expect(on.onWeek).toHaveBeenCalledWith(0);
  });

  it('disables previous on the oldest week and says when there is nothing to compare', () => {
    const tree = renderDashboard({ view: 'week', back: 2 }, sampleData());
    expect(text(byClass(tree, 'rel'))).toBe('2 weeks ago');
    expect(byId(tree, 'week-prev')?.props.disabled).toBe(true);
    expect(byId(tree, 'week-prev')?.props.title).toBe('Older weeks are past the 90-day limit');
    expect(text([byId(tree, 'delta-line') as El])).toBe('No data for the week before to compare with.');
    expect(text([byId(tree, 'gap-note') as El])).toContain('averages use the 1 recorded day.');
    expect(byClass(tree, 'wc-avg')).toHaveLength(0);
  });

  it('uses one-letter days and dashes in a narrow chart', () => {
    const tree = renderDashboard({ view: 'week', back: 1 }, sampleData(), { chart: { width: 300 } });
    expect(byClass(tree, 'wc-day').map((d) => text([d]))).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(byClass(tree, 'wc-val').map((d) => text([d]))[3]).toBe('–');
  });

  it('says the same about a week within 3 percent', () => {
    const days = { 'd:2026-10-05': day({ 'a.com': { 9: 3600 } }), 'd:2026-10-12': day({ 'a.com': { 9: 3550 } }), 'd:2026-10-13': day({ 'a.com': { 9: 3600 } }), 'd:2026-10-06': day({ 'a.com': { 9: 3600 } }) };
    const tree = renderDashboard({ view: 'week', back: 0 }, sampleData(days));
    expect(text([byId(tree, 'delta-line') as El])).toBe('Daily average is about the same as the week before (1h).');
  });

  it('shows the empty copy when nothing was recorded', () => {
    const tree = renderDashboard({ view: 'week', back: 0 }, sampleData({}));
    expect(text(byClass(tree, 'headline-notes'))).toBe('Nothing was recorded this week. Days fill in as soon as you browse with tracking on.');
    expect(text(byClass(tree, 'empty-note'))).toBe('Nothing was recorded this week. Days fill in as soon as you browse with tracking on.');
    expect(byClass(tree, 'hit')).toHaveLength(0);
    expect(byClass(tree, 'wc-val').map((d) => text([d]))).toEqual(['No data', 'No data', 'No data', '', '', '', '']);
    expect(everything(tree)).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('marks days past the 90-day limit as not kept', () => {
    const old = { 'd:2026-07-13': day({ 'a.com': { 9: 600 } }) };
    const tree = renderDashboard({ view: 'week', back: 13 }, sampleData(old));
    expect(byClass(tree, 'wc-val').map((d) => text([d]))).toEqual(['Not kept', 'Not kept', 'Not kept', 'Not kept', 'No data', 'No data', 'No data']);
    expect(all(tree, (el) => el.type === 'circle' && el.props.class === 'chart-dot is-faint').length).toBe(4 * 16);
  });

  it('shows the top 10 sites, then all of them on request', () => {
    const many: Record<string, Record<number, number>> = {};
    for (let i = 0; i < 12; i++) many[`site${String(i).padStart(2, '0')}.com`] = { 9: 600 + i * 60 };
    const days = { 'd:2026-10-12': day(many) };
    const on = handlers();
    const short = renderDashboard({ view: 'week', back: 0 }, sampleData(days), { on });
    expect(all(short, (el) => el.type === 'li' && el.props.class === 'mu-row')).toHaveLength(10);
    expect(text([byId(short, 'mu-toggle') as El])).toBe('Show all 12 sites');
    call(byId(short, 'mu-toggle'), 'onClick');
    expect(on.onToggleAll).toHaveBeenCalled();
    const long = renderDashboard({ view: 'week', back: 0 }, sampleData(days), { showAll: true });
    expect(all(long, (el) => el.type === 'li' && el.props.class === 'mu-row')).toHaveLength(12);
    expect(text([byId(long, 'mu-toggle') as El])).toBe('Show top 10');
  });
});

describe('paused state', () => {
  it('shows the banner on the week and day views and the inverse pill everywhere', () => {
    const on = handlers();
    const data = sampleData(sampleDays(), { paused: true });
    for (const route of [{ view: 'week', back: 0 } as const, { view: 'day', date: '2026-10-13' } as const]) {
      const tree = renderDashboard(route, data, { on });
      expect(text([byId(tree, 'paused-banner') as El])).toBe('Tracking is pausedNothing is recorded until you resume.Resume');
      call(byId(tree, 'resume'), 'onClick');
    }
    expect(on.onResume).toHaveBeenCalledTimes(2);
    const settings = renderDashboard({ view: 'settings' }, data);
    expect(byId(settings, 'paused-banner')).toBeUndefined();
    expect(byId(settings, 'status-pill')?.props.class).toBe('status-pill is-paused');
    expect(text([byId(settings, 'status-pill') as El])).toBe('Tracking paused');
  });
});

describe('day view', () => {
  const on = handlers();
  const tree = renderDashboard({ view: 'day', date: '2026-10-13' }, sampleData(), { on });

  it('heads with the date, total, busiest hour and counts', () => {
    expect(text(all(tree, (el) => el.type === 'h1'))).toBe('Tuesday, October 13, 2026');
    expect(text([byId(tree, 'busiest-hour') as El])).toBe('Busiest hour: 9 – 10 PM, 1h.');
    expect(text(byClass(tree, 'headline-notes'))).toContain('2 sites · 5 visits');
    expect(byId(tree, 'nav-activity')?.props['aria-current']).toBe('page');
  });

  it('goes back to its week and to the neighbouring days', () => {
    expect(text([byId(tree, 'day-back') as El]).replace(/\s+/g, ' ')).toBe('Back to Oct 12 – 18, 2026');
    call(byId(tree, 'day-back'), 'onClick');
    call(byId(tree, 'day-prev'), 'onClick');
    call(byId(tree, 'day-next'), 'onClick');
    expect(on.onWeek).toHaveBeenCalledWith(0);
    expect(vi.mocked(on.onDay).mock.calls).toEqual([['2026-10-12'], ['2026-10-14']]);
  });

  it('draws 24 hourly columns of 12 five-minute dots, the busiest hour in the accent', () => {
    expect(all(byClass(tree, 'chart-wrap'), (el) => el.type === 'circle')).toHaveLength(24 * 12);
    expect(byClass(tree, 'is-accent')).toHaveLength(1);
    expect(byClass(tree, 'dc-hour').map((d) => text([d]))).toEqual(['12 AM', '6 AM', '12 PM', '6 PM']);
    expect(byClass(tree, 'wc-axis').map((d) => text([d]))).toEqual(['30m', '60m']);
    expect(byClass(tree, 'hit').map((h) => h.props['aria-label'])).toEqual([
      '9 – 10 AM, 50m',
      '10 – 11 AM, 50m',
      '11 AM – 12 PM, 50m',
      '12 – 1 PM, 20m',
      '9 – 10 PM, 1h',
    ]);
    expect(byClass(tree, 'dc-now')).toHaveLength(0);
  });

  it('lists that day’s sites', () => {
    const rows = byClass([byId(tree, 'day-sites') as El], 'site-row');
    expect(rows.map((r) => text([r]))).toEqual([`Ggithub.com2h${NB}50m`, 'Yyoutube.com1h']);
  });

  it('shows the hovered hour’s top sites', () => {
    const onActive = vi.fn();
    const hovered = renderDashboard({ view: 'day', date: '2026-10-13' }, sampleData(), { chart: { active: 21, onActive } });
    expect(text(byClass(hovered, 'tip-head'))).toBe('1h9 – 10 PM');
    expect(byClass(hovered, 'tip-row').map((r) => text([r]))).toEqual(['youtube.com1h']);
    const hit = byClass(hovered, 'hit')[0];
    for (const event of ['onPointerEnter', 'onFocus', 'onPointerLeave', 'onBlur']) call(hit, event);
    expect(onActive.mock.calls).toEqual([[9], [9], [null], [null]]);
  });

  it('marks now on today and fades the hours still to come', () => {
    const today = renderDashboard({ view: 'day', date: '2026-10-14' }, sampleData());
    expect(text(byClass(today, 'dc-now'))).toBe('now');
    expect(byId(today, 'day-next')?.props.disabled).toBe(true);
    expect(all(today, (el) => el.type === 'circle' && el.props.class === 'chart-dot is-faint')).toHaveLength(7 * 12);
  });

  it('says so when nothing was recorded', () => {
    const empty = renderDashboard({ view: 'day', date: '2026-10-08' }, sampleData());
    expect(text(byClass(empty, 'headline-notes'))).toBe('Nothing was recorded on this day.');
    expect(text(byClass(empty, 'empty-note'))).toBe('Nothing was recorded on this day.');
    expect(byClass(empty, 'is-accent')).toHaveLength(0);
    expect(everything(empty)).not.toMatch(/NaN|undefined|Infinity/);
  });
});
