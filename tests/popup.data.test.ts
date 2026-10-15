import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, emptyDayRecord } from '../src/store/schema.ts';
import type { DayRecord, Settings } from '../src/store/schema.ts';
import { addPending, buildModel, popupState, settlePending, thisSite, usualStats, withPending } from '../src/popup/data.ts';
import type { PopupData } from '../src/popup/data.ts';
import { day, NOW } from './support/popup.ts';

const empty = (): DayRecord => emptyDayRecord();
const sevenEmpty = (): DayRecord[] => Array.from({ length: 7 }, empty);

function settings(patch: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, blockers: { ...DEFAULT_SETTINGS.blockers }, ...patch };
}

function data(patch: Partial<PopupData> = {}): PopupData {
  return { settings: settings(), today: empty(), previous: sevenEmpty(), now: NOW, url: 'https://github.com/', ...patch };
}
describe('usualStats', () => {
  it('averages the time recorded up to the current minute over the days that have data', () => {
    const previous = sevenEmpty();
    previous[2] = day({ 'a.com': { 9: 3600, 14: 1800, 20: 3600 } });
    previous[5] = day({ 'b.com': { 9: 1800, 14: 3600 } });
    const stats = usualStats(previous, new Date(2026, 9, 14, 14, 30));
    expect(stats.recorded).toBe(2);
    expect(stats.average).toBe((9000 + 5400) / 2);
    expect(stats.byNow).toBe((3600 + 900 + (1800 + 1800)) / 2);
  });

  it('counts nothing of the current hour at minute zero', () => {
    const previous = [day({ 'a.com': { 8: 600, 9: 1200 } })];
    expect(usualStats(previous, new Date(2026, 9, 14, 9, 0)).byNow).toBe(600);
  });

  it('returns zeros when no previous day has data', () => {
    expect(usualStats(sevenEmpty(), NOW)).toEqual({ recorded: 0, average: 0, byNow: 0 });
  });
});

describe('popup state selection', () => {
  it('is first run when nothing was recorded today or in the 7 days before', () => {
    const model = buildModel(data());
    expect(model.firstRun).toBe(true);
    expect(model.state).toBe('first');
  });

  it('is not first run when only an earlier day has data', () => {
    const previous = sevenEmpty();
    previous[0] = day({ 'a.com': { 10: 60 } });
    expect(buildModel(data({ previous })).firstRun).toBe(false);
  });

  it('is not first run when only today has data', () => {
    expect(buildModel(data({ today: day({ 'a.com': { 10: 60 } }) })).firstRun).toBe(false);
  });

  it('is paused whenever the stored flag says so, first run or not', () => {
    expect(buildModel(data({ settings: settings({ paused: true }) })).state).toBe('paused');
    const model = buildModel(data({ settings: settings({ paused: true }), today: day({ 'a.com': { 1: 5 } }) }));
    expect(model.state).toBe('paused');
    expect(model.paused).toBe(true);
  });

  it('is non-trackable when the tab has no site', () => {
    const today = day({ 'a.com': { 10: 60 } });
    for (const url of ['chrome://settings/', 'chrome-extension://abc/src/popup/index.html', 'file:///tmp/a.html', null]) {
      expect(buildModel(data({ today, url })).state).toBe('untrackable');
    }
  });

  it('is no-blocker on a site other than the three', () => {
    expect(buildModel(data({ today: day({ 'a.com': { 10: 60 } }) })).state).toBe('noblocker');
  });

  it('is normal on one of the three sites', () => {
    expect(buildModel(data({ today: day({ 'a.com': { 10: 60 } }), url: 'https://www.youtube.com/' })).state).toBe('normal');
  });

  it('ranks paused, then first run, then the card variant', () => {
    const site = { tracking: { kind: 'site' as const, site: 'a.com', seconds: 0, visits: 0 }, blocker: null };
    expect(popupState(true, true, site)).toBe('paused');
    expect(popupState(false, true, site)).toBe('first');
    expect(popupState(false, false, site)).toBe('noblocker');
  });
});

describe('thisSite', () => {
  const today = day({ 'youtube.com': { 9: 600, 10: 300 }, 'github.com': { 11: 1200 } }, { 'youtube.com': 4 });

  it('shows the Shorts toggle on any YouTube host the blocker covers', () => {
    for (const url of ['https://www.youtube.com/', 'https://m.youtube.com/watch?v=x', 'https://youtube.com/']) {
      const site = thisSite(url, settings(), today);
      expect(site.blocker).toEqual({ key: 'youtubeShorts', kind: 'shorts', on: true });
      expect(site.tracking).toEqual({ kind: 'site', site: 'youtube.com', seconds: 900, visits: 4 });
    }
  });

  it('shows the Reels toggles on Instagram and Facebook', () => {
    expect(thisSite('https://www.instagram.com/', settings(), today).blocker).toEqual({ key: 'instagramReels', kind: 'reels', on: true });
    expect(thisSite('https://m.facebook.com/', settings(), today).blocker).toEqual({ key: 'facebookReels', kind: 'reels', on: true });
  });

  it('reflects the stored blocker value', () => {
    const off = settings({ blockers: { ...DEFAULT_SETTINGS.blockers, youtubeShorts: false } });
    expect(thisSite('https://www.youtube.com/', off, today).blocker?.on).toBe(false);
  });

  it('has no toggle on other sites, including other YouTube subdomains', () => {
    expect(thisSite('https://github.com/x', settings(), today).blocker).toBeNull();
    expect(thisSite('https://music.youtube.com/', settings(), today).blocker).toBeNull();
  });

  it('reports zero time and visits for a site with nothing recorded today', () => {
    expect(thisSite('https://news.example/', settings(), today).tracking).toEqual({ kind: 'site', site: 'news.example', seconds: 0, visits: 0 });
  });

  it('follows the grouping overrides', () => {
    const split = settings({ overrides: ['docs.google.com'] });
    expect(thisSite('https://docs.google.com/d/1', split, today).tracking).toMatchObject({ site: 'docs.google.com' });
  });

  it('tells the new tab page apart from other browser pages', () => {
    for (const url of ['chrome://newtab/', 'chrome://new-tab-page/', 'about:blank', '', null]) {
      expect(thisSite(url, settings(), today).tracking).toEqual({ kind: 'newtab' });
    }
    for (const url of ['chrome://settings/', 'chrome-extension://abc/x.html', 'not a url']) {
      expect(thisSite(url, settings(), today).tracking).toEqual({ kind: 'browser' });
    }
  });

  it('marks an ignored site and still offers its blocker, which keeps working', () => {
    const ignoring = settings({ ignore: ['youtube.com'] });
    const site = thisSite('https://www.youtube.com/', ignoring, today);
    expect(site.tracking).toEqual({ kind: 'ignored', site: 'youtube.com' });
    expect(site.blocker?.key).toBe('youtubeShorts');
  });
});

describe('buildModel', () => {
  it('lays out the last 7 days oldest first, ending today, with each day’s top three sites', () => {
    const previous = sevenEmpty();
    previous[6] = day({ 'a.com': { 9: 100 }, 'b.com': { 9: 400 }, 'c.com': { 9: 300 }, 'd.com': { 9: 200 } });
    const model = buildModel(data({ previous, today: day({ 'a.com': { 10: 50 } }) }));
    expect(model.week).toHaveLength(7);
    expect(model.week.map((d) => d.date.getDate())).toEqual([8, 9, 10, 11, 12, 13, 14]);
    expect(model.week.map((d) => d.isToday)).toEqual([false, false, false, false, false, false, true]);
    expect(model.week[5]?.top.map((s) => s.site)).toEqual(['b.com', 'c.com', 'd.com']);
    expect(model.week[5]?.total).toBe(1000);
    expect(model.week[6]?.total).toBe(50);
  });

  it('lists today’s three busiest sites with their visits', () => {
    const today = day({ 'a.com': { 9: 100 }, 'b.com': { 9: 400 }, 'c.com': { 9: 300 }, 'd.com': { 9: 200 } }, { 'b.com': 2 });
    const model = buildModel(data({ today }));
    expect(model.total).toBe(1000);
    expect(model.top).toEqual([
      { site: 'b.com', seconds: 400, visits: 2 },
      { site: 'c.com', seconds: 300, visits: 0 },
      { site: 'd.com', seconds: 200, visits: 0 },
    ]);
  });
});

describe('pending taps', () => {
  it('show the tapped value until the worker answers', () => {
    const shown = withPending(settings(), { paused: true, blockers: { youtubeShorts: false } });
    expect(shown.paused).toBe(true);
    expect(shown.blockers).toEqual({ ...DEFAULT_SETTINGS.blockers, youtubeShorts: false });
    expect(withPending(settings({ paused: true }), {}).paused).toBe(true);
  });

  it('let a later tap on the same control replace an earlier one', () => {
    const first = addPending({}, { paused: true });
    const second = addPending(first, { paused: false });
    expect(second.paused).toBe(false);
    expect(addPending(first, { blockers: { youtubeShorts: false } })).toEqual({ paused: true, blockers: { youtubeShorts: false } });
  });

  it('are dropped once settled, unless a newer tap replaced them', () => {
    expect(settlePending({ paused: true, blockers: {} }, { paused: true })).toEqual({ blockers: {} });
    expect(settlePending({ paused: false, blockers: {} }, { paused: true })).toEqual({ paused: false, blockers: {} });
    expect(settlePending({ blockers: { youtubeShorts: false, instagramReels: true } }, { blockers: { youtubeShorts: false } })).toEqual({
      blockers: { instagramReels: true },
    });
    expect(settlePending({ blockers: { youtubeShorts: true } }, { blockers: { youtubeShorts: false } })).toEqual({ blockers: { youtubeShorts: true } });
  });
});
