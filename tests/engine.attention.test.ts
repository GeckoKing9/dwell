import { describe, expect, it } from 'vitest';
import { currentSite } from '../src/tracker/engine.ts';
import { DEFAULTS, Story, openTab } from './support/story.ts';

const MORNING = new Date(2026, 9, 27, 9, 0, 0).getTime();
const IG = 'instagram.com';
const YT = 'youtube.com';
const DOCS = 'docs.google.com';

/** Chrome has no focused window (another app has it); window 2 shows Instagram in tab 20. */
function unfocusedInstagram(settings = DEFAULTS): Story {
  return new Story(MORNING, settings).emit(...openTab(2, 20, IG), { type: 'focus', windowId: null }, { type: 'idle', state: 'active' });
}

/** Hover-scrolling: the content script sends one attention ping every 10 s for `seconds`. */
function scroll(story: Story, tabId: number, windowId: number, seconds: number): Story {
  for (let s = 0; s < seconds; s += 10) story.emit({ type: 'attention', tabId, windowId, present: true }).wait(10);
  return story;
}

describe('attention: input given to a page whose window has no focus', () => {
  it('counts 10 minutes of hover-scrolling as 10 minutes, plus the idle threshold after the last input', () => {
    const story = scroll(unfocusedInstagram(), 20, 2, 600).wait(600).end();
    // Pings at 0..590 s; attention lasts 60 s past the last one, like the idle threshold after the last input.
    expect(story.total(IG)).toEqual({ seconds: 650, visits: 1 });
  });

  it('counts the same whether or not a muted video plays in the feed', () => {
    const story = unfocusedInstagram().emit({ type: 'media', tabId: 20, playing: true });
    scroll(story, 20, 2, 600).wait(600).end();
    expect(story.total(IG)).toEqual({ seconds: 650, visits: 1 });
  });

  it('follows the idle threshold setting', () => {
    const story = scroll(unfocusedInstagram({ ...DEFAULTS, idleThresholdSec: 30 }), 20, 2, 120).wait(300).end();
    expect(story.total(IG).seconds).toBe(110 + 30);
  });

  it('stops at once when the pointer leaves the page or the page is hidden', () => {
    const story = scroll(unfocusedInstagram(), 20, 2, 120).wait(5).emit({ type: 'attention', tabId: 20, windowId: 2, present: false }).wait(300).end();
    expect(story.total(IG).seconds).toBe(125);
  });

  it('ignores a leave from another tab', () => {
    const story = scroll(unfocusedInstagram(), 20, 2, 20).emit({ type: 'attention', tabId: 99, windowId: 3, present: false }).wait(300).end();
    expect(story.total(IG).seconds).toBe(10 + 60);
  });

  it('ends when another Chrome window gets focus or its own window shows another tab', () => {
    const focused = scroll(unfocusedInstagram(), 20, 2, 30).emit({ type: 'focus', windowId: 1 }).wait(300).end();
    expect(focused.total(IG).seconds).toBe(30);
    const switched = scroll(unfocusedInstagram(), 20, 2, 30).emit({ type: 'activate', windowId: 2, tabId: 21 }).wait(300).end();
    expect(switched.total(IG).seconds).toBe(30);
  });

  it('lasts at most 20 s past its last input once another app takes focus (Alt-Tab without moving the pointer)', () => {
    const app = scroll(unfocusedInstagram({ ...DEFAULTS, idleThresholdSec: 300 }), 20, 2, 30).emit({ type: 'focus', windowId: null }).wait(300).end();
    expect(app.total(IG).seconds).toBe(20 + 20);
  });

  it('keeps counting without a gap when scrolling goes on after another app took focus', () => {
    const story = scroll(unfocusedInstagram(), 20, 2, 30).emit({ type: 'focus', windowId: null });
    scroll(story, 20, 2, 30).wait(300).end();
    expect(story.total(IG)).toEqual({ seconds: 50 + 60, visits: 1 });
  });

  it('keeps going when another window switches tabs', () => {
    const other = scroll(unfocusedInstagram(), 20, 2, 30).emit(...openTab(1, 10, DOCS)).wait(300).end();
    expect(other.total(IG).seconds).toBe(80);
  });

  it('ends when its tab leaves the site or closes', () => {
    const left = scroll(unfocusedInstagram(), 20, 2, 30).emit({ type: 'url', tabId: 20, site: 'example.com', nav: true }).wait(300).end();
    expect(left.total(IG).seconds).toBe(30);
    expect(left.total('example.com').seconds).toBe(0);
    const closed = scroll(unfocusedInstagram(), 20, 2, 30).emit({ type: 'close', tabId: 20 }).wait(300).end();
    expect(closed.total(IG).seconds).toBe(30);
  });

  it('keeps counting through a navigation inside the site', () => {
    const story = scroll(unfocusedInstagram(), 20, 2, 30).emit({ type: 'url', tabId: 20, site: IG, nav: true }).wait(300).end();
    expect(story.total(IG).seconds).toBe(30 + 60 - 10);
  });

  it('wins over an active focused window for 20 s after each input, so continuous scrolling keeps it, then hands back within the same interval', () => {
    const story = new Story(MORNING).emit(...openTab(2, 20, IG), ...openTab(1, 10, DOCS), { type: 'focus', windowId: 1 });
    scroll(story, 20, 2, 60).wait(240).end();
    // Pings at 0..50 s: Instagram until 70 s, then the typing in the focused docs tab.
    expect(story.total(IG)).toEqual({ seconds: 70, visits: 1 });
    expect(story.total(DOCS).seconds).toBe(300 - 70);
  });

  it('gives a stray wheel tick over another window at most 20 s against an active focused window', () => {
    const story = new Story(MORNING, { ...DEFAULTS, idleThresholdSec: 300 }).emit(...openTab(2, 20, IG), ...openTab(1, 10, DOCS), { type: 'focus', windowId: 1 });
    scroll(story, 20, 2, 10).wait(590).end();
    expect(story.total(IG).seconds).toBe(20);
    expect(story.total(DOCS).seconds).toBe(580);
  });

  it('keeps the full idle threshold once the focused window goes idle', () => {
    const story = new Story(MORNING).emit(...openTab(2, 20, IG), ...openTab(1, 10, DOCS), { type: 'focus', windowId: 1 }, { type: 'idle', state: 'idle' });
    scroll(story, 20, 2, 10).wait(290).end();
    expect(story.total(IG).seconds).toBe(60);
    expect(story.total(DOCS).seconds).toBe(0);
  });

  it('never changes which tab the engine holds as active', () => {
    const story = new Story(MORNING).emit(...openTab(1, 10, DOCS), { type: 'url', tabId: 20, site: IG }, { type: 'focus', windowId: 1 });
    scroll(story, 20, 1, 10).emit({ type: 'attention', tabId: 20, windowId: 1, present: false }).wait(290).end();
    expect(story.state.activeTabs).toEqual({ '1': 10 });
    expect(story.total(IG).seconds).toBe(10);
    expect(story.total(DOCS).seconds).toBe(290);
  });

  it('counts a pinged tab the engine only knows from its address', () => {
    const story = new Story(MORNING).emit({ type: 'url', tabId: 20, site: IG }, { type: 'focus', windowId: null });
    scroll(story, 20, 2, 10).wait(120).end();
    expect(story.total(IG).seconds).toBe(60);
  });

  it('counts nothing while locked or paused', () => {
    const locked = scroll(unfocusedInstagram().emit({ type: 'idle', state: 'locked' }), 20, 2, 60).end();
    expect(locked.total(IG).seconds).toBe(0);
    const paused = scroll(unfocusedInstagram().emit({ type: 'pause', paused: true }), 20, 2, 60).end();
    expect(paused.total(IG).seconds).toBe(0);
  });

  it('survives a worker restart', () => {
    const story = scroll(unfocusedInstagram(), 20, 2, 30).restart().wait(300).end();
    expect(story.total(IG).seconds).toBe(80);
  });

  it('reports the attention site as the current site until it runs out', () => {
    const story = scroll(unfocusedInstagram(), 20, 2, 10);
    expect(currentSite(story.state, DEFAULTS, story.at)).toBe(IG);
    expect(currentSite(story.state, DEFAULTS, MORNING + 60_000)).toBeNull();
  });
});

describe('watched media: playback with sound on a page on screen', () => {
  function unfocusedVideo(watched: boolean, settings = DEFAULTS): Story {
    return new Story(MORNING, settings).emit(
      ...openTab(2, 20, YT),
      { type: 'focus', windowId: null },
      watched ? { type: 'media', tabId: 20, playing: true, watched: true } : { type: 'media', tabId: 20, playing: true },
    );
  }

  it('counts a video playing in a window without focus, idle or not', () => {
    const story = unfocusedVideo(true).wait(120).emit({ type: 'idle', state: 'idle' }).wait(1380).end();
    expect(story.total(YT)).toEqual({ seconds: 1500, visits: 1 });
  });

  it('does not count muted or hidden playback in a window without focus', () => {
    expect(unfocusedVideo(false).wait(600).end().total(YT).seconds).toBe(0);
  });

  it('counts the 30 s hold after a pause, and stops at once when the page is hidden while playing', () => {
    const paused = unfocusedVideo(true).wait(60).emit({ type: 'media', tabId: 20, playing: false }).wait(300).end();
    expect(paused.total(YT).seconds).toBe(90);
    const hidden = unfocusedVideo(true).wait(60).emit({ type: 'media', tabId: 20, playing: true }).wait(300).end();
    expect(hidden.total(YT).seconds).toBe(60);
  });

  it('follows the media override setting', () => {
    expect(unfocusedVideo(true, { ...DEFAULTS, mediaOverride: false }).wait(600).end().total(YT).seconds).toBe(0);
  });

  it('gives way to an active focused window, and counts once that window goes idle', () => {
    const story = unfocusedVideo(true).emit(...openTab(1, 10, DOCS), { type: 'focus', windowId: 1 }).wait(300);
    expect(story.total(YT).seconds).toBe(0);
    story.emit({ type: 'idle', state: 'idle' }).wait(300).end();
    expect(story.total(DOCS).seconds).toBe(300);
    expect(story.total(YT).seconds).toBe(300);
  });

  it('stops at once when a tab switch hides the page and its script says so', () => {
    const story = unfocusedVideo(true)
      .wait(60)
      .emit({ type: 'activate', windowId: 2, tabId: 21 }, { type: 'media', tabId: 20, playing: true })
      .wait(300)
      .end();
    expect(story.total(YT).seconds).toBe(60);
  });

  it('stops counting when the tab is no longer its window active tab, even if its page never reported again', () => {
    const story = unfocusedVideo(true).wait(60).emit({ type: 'activate', windowId: 2, tabId: 21 }).wait(300).end();
    expect(story.total(YT).seconds).toBe(60);
  });

  it('never counts a background tab that last reported watched: its page may be gone', () => {
    const story = new Story(MORNING)
      .emit({ type: 'url', tabId: 20, site: YT }, ...openTab(1, 10, DOCS), { type: 'focus', windowId: 1 }, { type: 'idle', state: 'idle' })
      .emit({ type: 'media', tabId: 20, playing: true, watched: true })
      .wait(300)
      .end();
    expect(story.total(YT).seconds).toBe(0);
  });

  it('reads a media event without the watched field, as in older logs, as not watched', () => {
    const story = new Story(MORNING).emit(...openTab(2, 20, YT), { type: 'focus', windowId: null }, { type: 'media', tabId: 20, playing: true }).wait(300).end();
    expect(story.total(YT).seconds).toBe(0);
  });

  it('never counts locked', () => {
    expect(unfocusedVideo(true).emit({ type: 'idle', state: 'locked' }).wait(600).end().total(YT).seconds).toBe(0);
  });
});
