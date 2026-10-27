import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, emptyDayRecord } from '../src/store/schema.ts';
import type { DayRecord, Settings } from '../src/store/schema.ts';
import { buildModel } from '../src/popup/data.ts';
import type { PopupData, PopupModel } from '../src/popup/data.ts';
import { PopupView } from '../src/popup/components/PopupView.tsx';
import { all, byClass, byId, everything, expand, text } from './support/vnode.ts';
import type { El, Tree } from './support/vnode.ts';
import { day, NOW } from './support/popup.ts';

function history(recorded: number): DayRecord[] {
  return Array.from({ length: 7 }, (_, k) => (k >= 7 - recorded ? day({ 'github.com': { 10: 3600, 15: 1800, 20: 3600 } }) : emptyDayRecord()));
}

const TODAY = day({ 'github.com': { 10: 2640 }, 'instagram.com': { 15: 960 }, 'music.youtube.com': { 14: 780 }, 'x.com': { 9: 60 } }, { 'instagram.com': 11 });

function model(patch: Partial<PopupData> = {}, settings: Partial<Settings> = {}): PopupModel {
  return buildModel({
    settings: { ...DEFAULT_SETTINGS, ...settings },
    today: TODAY,
    previous: history(7),
    now: NOW,
    url: 'https://www.instagram.com/',
    ...patch,
  });
}

function render(m: PopupModel, activeDay: number | null = null, handlers: Partial<Record<string, unknown>> = {}): Tree[] {
  return expand(
    PopupView({
      model: m,
      activeDay,
      onPause: vi.fn(),
      onBlocker: vi.fn(),
      onOpenDay: vi.fn(),
      dayUrl: (date: string) => `#day/${date}`,
      onOpenDashboard: vi.fn(),
      onActiveDay: vi.fn(),
      ...handlers,
    }),
  );
}

describe('popup, normal state', () => {
  const tree = render(model());

  it('reads today first, then the like-for-like comparison and the 7-day average', () => {
    const hero = byClass(tree, 'pp-hero')[0];
    expect(text(hero ? [hero] : [])).toContain('Today so far');
    expect(text(hero ? [hero] : [])).toContain('Wed, Oct 14');
    expect(text(byClass(tree, 'hero-num'))).toContain('1h\u00a014m');
    expect(text(byClass(tree, 'pp-compare'))).toBe('Usually 1h\u00a030m by this time of day7-day average: 2h\u00a030m a day');
    expect(all(tree, (el) => el.type === 'b').map((b) => text([b]))).toEqual(['1h\u00a030m']);
  });

  it('lists the top three sites with time and a proportional track', () => {
    const rows = byClass(tree, 'site-row');
    expect(rows.map((r) => text(byClass([r], 'name')))).toEqual(['github.com', 'instagram.com', 'music.youtube.com']);
    expect(rows.map((r) => text(byClass([r], 'time')))).toEqual(['44m', '16m', '13m']);
    const widths = all(rows, (el) => el.type === 'i').map((i) => (i.props.style as { width: string }).width);
    expect(widths).toEqual(['100%', `${(960 / 2640) * 100}%`, `${(780 / 2640) * 100}%`]);
  });

  it('shows this site with its time and visits, and the Reels toggle saying what it does', () => {
    const card = byClass(tree, 'pp-site');
    expect(text(byClass(card, 'dom'))).toBe('instagram.com');
    expect(text(byClass(card, 'facts-r'))).toBe('16m11 visits');
    expect(text(byClass(card, 'state'))).toBe('Reels off');
    expect(text(byClass(card, 'sub'))).toBe('One Reel at a time, no scrolling to the next');
    expect(byId(tree, 'blocker-switch')?.props['aria-checked']).toBe('true');
    expect(byId(tree, 'blocker-switch')?.props['aria-labelledby']).toBe('blocker-label');
  });

  it('draws today in the accent and labels it, other days by their initial', () => {
    expect(byClass(tree, 'is-accent')).toHaveLength(1);
    expect(byClass(tree, 'pw-day').map((d) => text([d]))).toEqual(['T', 'F', 'S', 'S', 'M', 'T', 'Today']);
    expect(text(byClass(tree, 'pw-cap'))).toBe('Last 7 days · each dot is 30 minutes');
    expect(text(byClass(tree, 'pw-max'))).toBe('4h');
  });

  it('has a footer with the dashboard link and the pause switch off', () => {
    expect(text([byId(tree, 'open-dashboard') as El])).toBe('Open dashboard');
    expect(text([byId(tree, 'pause-label') as El])).toBe('Pause tracking');
    expect(byId(tree, 'pause-switch')?.props['aria-checked']).toBe('false');
    expect(byId(tree, 'paused-band')).toBeUndefined();
  });
});

describe('popup controls', () => {
  it('sends the flipped value on one tap, with no confirmation', () => {
    const onPause = vi.fn();
    const onBlocker = vi.fn();
    const onOpenDashboard = vi.fn();
    const tree = render(model(), null, { onPause, onBlocker, onOpenDashboard });
    (byId(tree, 'pause-switch')?.props.onClick as () => void)();
    (byId(tree, 'blocker-switch')?.props.onClick as () => void)();
    (byId(tree, 'open-dashboard')?.props.onClick as () => void)();
    expect(onPause).toHaveBeenCalledWith(true);
    expect(onBlocker).toHaveBeenCalledWith('instagramReels', false);
    expect(onOpenDashboard).toHaveBeenCalledOnce();
  });

  it('resumes from the paused band', () => {
    const onPause = vi.fn();
    const tree = render(model({}, { paused: true }), null, { onPause });
    (byId(tree, 'resume')?.props.onClick as () => void)();
    expect(onPause).toHaveBeenCalledWith(false);
  });

  it('reports hover and focus on a day, and leaving it', () => {
    const onActiveDay = vi.fn();
    const tree = render(model(), null, { onActiveDay });
    const hits = byClass(tree, 'hit');
    const link = byClass(tree, 'day-link')[6];
    expect(hits).toHaveLength(7);
    (hits[6]?.props.onPointerEnter as () => void)();
    (link?.props.onFocus as () => void)();
    (hits[6]?.props.onPointerLeave as () => void)();
    (link?.props.onBlur as () => void)();
    expect(onActiveDay.mock.calls).toEqual([[6], [6], [null], [null]]);
  });
});

describe('popup, other states', () => {
  it('paused: inverse band, quiet hero, neutral today, no comparison, blocker still there', () => {
    const tree = render(model({}, { paused: true }));
    expect(text([byId(tree, 'paused-band') as El])).toBe('Tracking is pausedNothing is recorded until you resume.Resume');
    expect(byClass(tree, 'popup')[0]?.props.class).toBe('popup is-paused');
    expect(byClass(tree, 'hero-num')[0]?.props.class).toBe('hero-num is-quiet');
    expect(text(byClass(tree, 'pp-hero'))).toContain('Recorded today before pausing');
    expect(byClass(tree, 'pp-compare')).toHaveLength(0);
    expect(byClass(tree, 'is-accent')).toHaveLength(0);
    expect(text(byClass(tree, 'facts-r'))).toBe('Not recording while paused');
    expect(byId(tree, 'blocker-switch')).toBeDefined();
    expect(text([byId(tree, 'pause-label') as El])).toBe('Paused');
    expect(byId(tree, 'pause-switch')?.props['aria-checked']).toBe('true');
  });

  it('first run: explains counting, empty ruler, no NaN or undefined anywhere', () => {
    const tree = render(model({ today: emptyDayRecord(), previous: history(0), url: 'https://github.com/' }));
    expect(byClass(tree, 'popup')[0]?.props['data-state']).toBe('first');
    expect(text(all(tree, (el) => el.type === 'h1'))).toBe('Nothing recorded yet');
    expect(text(byClass(tree, 'pp-hero'))).toContain('Dwell counts time while a tab is in front');
    expect(text(byClass(tree, 'empty-note'))).toBe('Your top sites appear after a few minutes of browsing.');
    expect(text(byClass(tree, 'pw-cap'))).toBe('Your week fills in as you browse');
    expect(byClass(tree, 'pw-max')).toHaveLength(0);
    expect(byClass(tree, 'chart-bar')).toHaveLength(0);
    expect(byClass(tree, 'chart-dot')).toHaveLength(7 * 8);
    expect(text(byClass(tree, 'facts-r'))).toBe('<1mJust started');
    expect(byClass(tree, 'day-link')).toHaveLength(0);
    expect(everything(tree)).not.toMatch(/NaN|undefined|Infinity|\$[A-Z]+\$/);
  });

  it('today with data but no earlier days: total without a comparison', () => {
    const tree = render(model({ previous: history(0) }));
    expect(byClass(tree, 'pp-compare')).toHaveLength(0);
    expect(text(byClass(tree, 'hero-num'))).toContain('1h\u00a014m');
  });

  it('names how many earlier days the average covers', () => {
    expect(text(byClass(render(model({ previous: history(1) })), 'pp-compare'))).toContain('Average of the 1 recorded day: 2h\u00a030m');
    expect(text(byClass(render(model({ previous: history(3) })), 'pp-compare'))).toContain('Average of the 3 recorded days: 2h\u00a030m');
  });

  it('non-trackable: new tab or browser page, no blocker row', () => {
    const newTab = render(model({ url: 'chrome://newtab/' }));
    expect(text(byClass(newTab, 'pp-site'))).toBe('\u2013This siteNew tabBrowser pages such as new tabs and settings aren’t recorded.');
    expect(byClass(newTab, 'is-blank')).toHaveLength(1);
    expect(byId(newTab, 'blocker-switch')).toBeUndefined();
    expect(text(byClass(render(model({ url: 'chrome://settings/' })), 'page'))).toBe('Browser page');
  });

  it('ignored site: says so, and keeps its blocker', () => {
    const tree = render(model({ url: 'https://www.youtube.com/' }, { ignore: ['youtube.com'] }));
    expect(text(byClass(tree, 'dom'))).toBe('youtube.com');
    expect(text(byClass(tree, 'facts'))).toBe('On your Never record list, so time here isn’t written down.');
    expect(text(byClass(tree, 'state'))).toBe('Shorts off');
  });

  it('no blocker: the same card without the row, nothing advertised', () => {
    const tree = render(model({ url: 'https://github.com/' }));
    expect(byClass(tree, 'blocker-row')).toHaveLength(0);
    expect(text(byClass(tree, 'facts-r'))).toBe('44m0 visits');
  });

  it('X: the video feed toggle says what it does, and one tap sends the X key', () => {
    const onBlocker = vi.fn();
    const tree = render(model({ url: 'https://x.com/someuser/status/123' }), null, { onBlocker });
    expect(text(byClass(tree, 'dom'))).toBe('x.com');
    expect(text(byClass(tree, 'state'))).toBe('Video feed off');
    expect(text(byClass(tree, 'sub'))).toBe('One video at a time, no scrolling to the next');
    expect(byId(tree, 'blocker-switch')?.props['aria-checked']).toBe('true');
    (byId(tree, 'blocker-switch')?.props.onClick as () => void)();
    expect(onBlocker).toHaveBeenCalledWith('xVideos', false);
  });

  it('X with the blocker off: the toggle says what switching it on does', () => {
    const tree = render(model({ url: 'https://x.com/home' }, { blockers: { ...DEFAULT_SETTINGS.blockers, xVideos: false } }));
    expect(text(byClass(tree, 'state'))).toBe('Video feed on');
    expect(text(byClass(tree, 'sub'))).toBe('Switch on to watch one video at a time');
    expect(byId(tree, 'blocker-switch')?.props['aria-checked']).toBe('false');
  });

  it('blocker off: the toggle says what switching it on does', () => {
    const off = { ...DEFAULT_SETTINGS.blockers, youtubeShorts: false };
    const tree = render(model({ url: 'https://www.youtube.com/' }, { blockers: off }));
    expect(text(byClass(tree, 'state'))).toBe('Shorts on');
    expect(text(byClass(tree, 'sub'))).toBe('Switch on to watch one Short at a time');
    expect(byId(tree, 'blocker-switch')?.props['aria-checked']).toBe('false');
  });

  it('one visit is singular', () => {
    const today = day({ 'github.com': { 10: 120 } }, { 'github.com': 1 });
    expect(text(byClass(render(model({ today, url: 'https://github.com/' })), 'facts-r'))).toBe('2m1 visit');
  });
});
