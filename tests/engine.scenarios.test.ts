import { describe, expect, it } from 'vitest';
import { DEFAULTS, Story, openTab } from './support/story.ts';

const MORNING = new Date(2026, 9, 14, 9, 0, 0).getTime();
const YT = 'youtube.com';
const DOCS = 'docs.google.com';
const SPOTIFY = 'spotify.com';

function watching(settings = DEFAULTS): Story {
  return new Story(MORNING, settings).emit(
    { type: 'seed', windowId: 1, tabId: 1, site: YT, idle: 'active' },
    { type: 'media', tabId: 1, playing: true },
  );
}

describe('F1: counting a session', () => {
  it('counts while active, keeps counting idle with a video playing, stops on blur, opens a new visit on return', () => {
    const story = new Story(MORNING)
      .emit({ type: 'seed', windowId: 1, tabId: 1, site: YT, idle: 'active' })
      .wait(10)
      .emit({ type: 'media', tabId: 1, playing: true })
      .wait(120)
      .emit({ type: 'idle', state: 'idle' })
      .wait(300)
      .emit({ type: 'focus', windowId: null })
      .wait(600)
      .emit({ type: 'focus', windowId: 1 }, { type: 'idle', state: 'active' })
      .wait(60)
      .end();
    expect(story.total(YT)).toEqual({ seconds: 430 + 60, visits: 2 });
  });
});

describe('AE1: music in another window', () => {
  it('gives 30 minutes of typing to the docs tab and nothing to the audible tab in window A', () => {
    const story = new Story(MORNING)
      .emit(...openTab(1, 10, SPOTIFY, true), ...openTab(2, 20, DOCS))
      .emit({ type: 'focus', windowId: 2 }, { type: 'idle', state: 'active' })
      .wait(1800)
      .end();
    expect(story.total(DOCS)).toEqual({ seconds: 1800, visits: 1 });
    expect(story.total(SPOTIFY).seconds).toBe(0);

    story.emit({ type: 'idle', state: 'idle' }).wait(300).end();
    expect(story.total(DOCS).seconds).toBe(1800);
    expect(story.total(SPOTIFY).seconds).toBe(0);
  });
});

describe('AE2: a video plays with no input for 25 minutes', () => {
  function play(mediaOverride: boolean): Story {
    return watching({ ...DEFAULTS, mediaOverride })
      .wait(60)
      .emit({ type: 'idle', state: 'idle' })
      .wait(1440)
      .end();
  }

  it('gains 25 minutes with the media override on', () => {
    expect(play(true).total(YT)).toEqual({ seconds: 1500, visits: 1 });
  });

  it('gains about one minute (the idle threshold) with the override off', () => {
    expect(play(false).total(YT)).toEqual({ seconds: 60, visits: 1 });
  });

  it('keeps counting 30 s after the video stops, then stops', () => {
    const story = play(true).emit({ type: 'media', tabId: 1, playing: false }).wait(300).end();
    expect(story.total(YT).seconds).toBe(1500 + 30);
  });

  it('bridges a gap between two songs shorter than 30 s', () => {
    const story = play(true)
      .emit({ type: 'media', tabId: 1, playing: false })
      .wait(20)
      .emit({ type: 'media', tabId: 1, playing: true })
      .wait(120)
      .end();
    expect(story.total(YT)).toEqual({ seconds: 1500 + 140, visits: 1 });
  });
});

describe('AE3: the laptop sleeps for 8 hours', () => {
  it.each([
    ['tick first, then the idle event', ['tick', 'idle']],
    ['idle event first, then the tick', ['idle', 'tick']],
  ])('attributes at most one heartbeat to the state before the gap (%s)', (_label, order) => {
    const story = new Story(MORNING).emit({ type: 'seed', windowId: 1, tabId: 1, site: YT, idle: 'active' }).wait(600).sleep(8 * 3600);
    for (const kind of order) story.emit(kind === 'tick' ? { type: 'tick' } : { type: 'idle', state: 'locked' });
    expect(story.total(YT).seconds).toBe(600 + 60);
    expect(story.state.needsReseed).toBe(true);

    story.emit({ type: 'seed', windowId: 1, tabId: 1, site: YT, idle: 'active' }).wait(120).end();
    expect(story.state.needsReseed).toBe(false);
    expect(story.total(YT)).toEqual({ seconds: 660 + 120, visits: 2 });
  });
});

describe('AE4: a session across midnight', () => {
  it('puts 2 minutes in hour 23 of the first day and 3 minutes in hour 0 of the next', () => {
    const story = new Story(new Date(2026, 9, 14, 23, 58, 0).getTime())
      .emit({ type: 'seed', windowId: 1, tabId: 1, site: YT, idle: 'active' })
      .wait(300)
      .end();
    expect(story.buckets).toEqual({
      '2026-10-14': { [YT]: { h: { '23': 120 }, v: 1 } },
      '2026-10-15': { [YT]: { h: { '0': 180 }, v: 0 } },
    });
  });
});

describe('AE7: the screen locks while a video plays', () => {
  it('stops at the lock event although the content script reports playing', () => {
    const story = watching().wait(60).emit({ type: 'idle', state: 'idle' }).wait(120).emit({ type: 'idle', state: 'locked' }).wait(600).end();
    expect(story.total(YT).seconds).toBe(180);
  });

  it('stops at the lock event although Chrome reports the tab audible', () => {
    const story = new Story(MORNING)
      .emit({ type: 'seed', windowId: 1, tabId: 1, site: SPOTIFY, audible: true, idle: 'idle' })
      .wait(90)
      .emit({ type: 'idle', state: 'locked' })
      .wait(600)
      .end();
    expect(story.total(SPOTIFY).seconds).toBe(90);
  });
});

describe('AE8: the service worker is terminated mid-session', () => {
  function session(options: { restart: boolean; loseTick: boolean }): Story {
    const story = new Story(MORNING)
      .emit({ type: 'seed', windowId: 1, tabId: 1, site: YT, idle: 'active' }, ...openTab(1, 2, DOCS))
      .emit({ type: 'activate', windowId: 1, tabId: 1 })
      .wait(300);
    if (options.restart) story.restart();
    if (options.loseTick) story.sleep(60).wait(250);
    else story.wait(310);
    return story.emit({ type: 'activate', windowId: 1, tabId: 2 }).wait(300).end();
  }

  it('equals the uninterrupted run exactly when the alarm wakes the worker on time', () => {
    const uninterrupted = session({ restart: false, loseTick: false });
    const restarted = session({ restart: true, loseTick: false });
    expect(uninterrupted.total(YT)).toEqual({ seconds: 610, visits: 1 });
    expect(restarted.buckets).toEqual(uninterrupted.buckets);
  });

  it('stays within one heartbeat when the wake-up tick is lost', () => {
    const uninterrupted = session({ restart: false, loseTick: false });
    const lost = session({ restart: true, loseTick: true });
    expect(lost.total(DOCS)).toEqual(uninterrupted.total(DOCS));
    expect(uninterrupted.total(YT).seconds - lost.total(YT).seconds).toBe(60);
  });
});
