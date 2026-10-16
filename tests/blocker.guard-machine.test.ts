import { describe, expect, it, vi } from 'vitest';
import type { NavigationKind } from '../src/blocker/decide.ts';
import {
  UNDO_SETTLE_MS,
  start,
  step,
  type Effect,
  type GuardState,
  type Logs,
  type Moment,
  type PostCode,
  type PushCheck,
  type Step,
} from '../src/blocker/guard-machine.ts';
import { shownPostCode } from '../src/blocker/post.ts';
import { facebookReelCode } from '../src/blocker/viewer.ts';
import { repairSettings } from '../src/shared/settings.ts';
import { DEFAULT_SETTINGS, type BlockedSite, type Settings } from '../src/store/schema.ts';

type Blockers = Settings['blockers'];

const ALL_ON: Blockers = { instagramReels: true, youtubeShorts: true, facebookReels: true, xVideos: true, instagramExplore: true };
const ALL_OFF: Blockers = { instagramReels: false, youtubeShorts: false, facebookReels: false, xVideos: false, instagramExplore: false };
const NOW = 1_700_000_000_000;
const FULL = [NOW - 2, NOW - 1];

const IG = 'https://www.instagram.com';
const IG_HOME = `${IG}/`;
const IG_HOME_TARGET = `${IG}/#dwell=instagram`;
const IG_SEARCH = `${IG}/explore/search/keyword/?q=hugo`;
const POST_E = `${IG}/p/EEEEE5/`;
const POST_E_TARGET = `${IG}/p/EEEEE5/#dwell=instagram`;
const POST_F = `${IG}/p/FFFFF6/`;
const REELS_CODE = `${IG}/reels/DeewiSPpCrm/`;
const REELS_CODE_TARGET = `${IG}/p/DeewiSPpCrm/#dwell=instagram`;
const POST_D = `${IG}/p/DeewiSPpCrm/`;
const YT_HOME = 'https://www.youtube.com/';
const SHORT = 'https://www.youtube.com/shorts/dQw4w9WgXcQ';
const WATCH_TARGET = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ#dwell=youtube';
const FB = 'https://www.facebook.com';
const FB_111 = `${FB}/reel/111`;
const FB_222 = `${FB}/reel/222`;
const FB_333 = `${FB}/reel/333`;
const FB_LOCK = `${FB}/reel/111#dwell=facebook`;
const X_TWEET = 'https://x.com/someuser/status/123';
const X_VIDEO = 'https://x.com/someuser/status/123/video/1';
const X_TWEET_TARGET = 'https://x.com/someuser/status/123#dwell=x';

const CANCEL: Effect = { type: 'cancel' };
const BACK: Effect = { type: 'back' };

function count(site: BlockedSite, landing = false): Effect {
  return { type: 'count', site, landing };
}

function load(target: string, mode: 'assign' | 'replace', deferred = false): Effect {
  return { type: 'load', target, mode, deferred };
}

function saveLog(log: keyof Logs, times: number[]): Effect {
  return { type: 'saveLog', log, times };
}

function settleIn(after: number): Effect {
  return { type: 'later', after, input: { type: 'settle' } };
}

function sync(lock: boolean, posts = true): Effect {
  return { type: 'sync', lock, posts };
}

/** An input's moment: on `here` at `now`, with empty logs unless the test fills them. */
function at(here: string, logs: Partial<Logs> = {}, now = NOW): Moment {
  return { here, now, logs: () => ({ redirects: [], undos: [], ...logs }) };
}

/** A guard on `site` started on `here` whose stored settings have loaded; Instagram gives its post rule, as its entry does. */
function loaded(site: BlockedSite, here: string, blockers: Blockers = ALL_ON, postCode: PostCode | null = site === 'instagram' ? shownPostCode : null): GuardState {
  return step(start(site, here, false, postCode).state, { type: 'settings', ...at(here), stored: { blockers }, initial: true }).state;
}

interface Move {
  here?: string;
  type?: NavigationKind;
  sameDocument?: boolean;
  cancelable?: boolean;
  logs?: Partial<Logs>;
  now?: number;
}

function navigate(state: GuardState, destination: string, move: Move = {}): Step {
  return step(state, {
    type: 'navigate',
    ...at(move.here ?? state.href, move.logs, move.now),
    destination,
    navigationType: move.type ?? 'push',
    sameDocument: move.sameDocument ?? true,
    cancelable: move.cancelable ?? true,
  });
}

function settle(state: GuardState, here: string, logs: Partial<Logs> = {}, now = NOW): Step {
  return step(state, { type: 'settle', ...at(here, logs, now) });
}

/** A Facebook viewer on reel 111 whose push to reel 222 is being undone, before the next task checks it. */
function undoing(): GuardState {
  return navigate(loaded('facebook', FB_111), FB_222).state;
}

describe('start: the guard at document_start', () => {
  it('hides the entry points and locks a viewer on the default toggles before the stored settings arrive', () => {
    const { state, effects } = start('facebook', FB_111, false);
    expect(state).toEqual({
      site: 'facebook',
      blockers: DEFAULT_SETTINGS.blockers,
      loaded: false,
      marker: false,
      href: FB_111,
      lastNav: null,
      undo: null,
      popUp: null,
      swap: null,
      recheckAt: null,
      postCode: null,
      synced: FB_111,
    });
    expect(effects).toEqual([{ type: 'hider', on: true }, sync(true)]);
  });

  it('leaves a page that is not a viewer unlocked', () => {
    expect(start('youtube', YT_HOME, false).effects).toEqual([{ type: 'hider', on: true }, sync(false)]);
  });
});

describe('settings: the stored settings arriving, then every change', () => {
  it('counts a stripped landing marker once, after the settings load, while that site’s blocker is on', () => {
    const first = step(start('instagram', IG_HOME, true).state, { type: 'settings', ...at(IG_HOME), stored: { blockers: ALL_ON }, initial: true });
    expect(first.effects).toEqual([count('instagram', true), { type: 'hider', on: true }, sync(false)]);
    expect(first.state.marker).toBe(false);
    const again = step(first.state, { type: 'settings', ...at(IG_HOME), stored: { blockers: ALL_ON }, initial: false });
    expect(again.effects).toEqual([{ type: 'hider', on: true }, sync(false)]);
  });

  it('drops a stripped marker uncounted while every blocker of that site is off', () => {
    const off = { ...ALL_ON, instagramReels: false, instagramExplore: false };
    const { state, effects } = step(start('instagram', IG_HOME, true).state, {
      type: 'settings',
      ...at(IG_HOME),
      stored: { blockers: off },
      initial: true,
    });
    expect(effects).toEqual([{ type: 'hider', on: false }, sync(false, false)]);
    expect(state.marker).toBe(false);
  });

  it('reads a missing or malformed toggle as its default, so settings stored before X existed keep X on', () => {
    const old = { blockers: { instagramReels: false, youtubeShorts: true, facebookReels: true, instagramExplore: false } };
    const read = (stored: unknown): Blockers =>
      step(start('x', X_TWEET, false).state, { type: 'settings', ...at(X_TWEET), stored, initial: true }).state.blockers;
    expect(read(old)).toEqual({ ...old.blockers, xVideos: true });
    expect(read({ blockers: { xVideos: 'off', youtubeShorts: false } })).toEqual({ ...DEFAULT_SETTINGS.blockers, youtubeShorts: false });
    expect(read('not settings')).toEqual(DEFAULT_SETTINGS.blockers);
    expect(read({ blockers: [] })).toEqual(DEFAULT_SETTINGS.blockers);
    expect(read(undefined)).toEqual(DEFAULT_SETTINGS.blockers);
  });

  it('reads the toggles exactly as the settings repair does, an object with a prototype of its own included', () => {
    const read = (stored: unknown): Blockers =>
      step(start('x', X_TWEET, false).state, { type: 'settings', ...at(X_TWEET), stored, initial: true }).state.blockers;
    const odd = Object.assign(Object.create({}) as Record<string, unknown>, { youtubeShorts: false });
    for (const stored of [{ blockers: odd }, odd, { blockers: { xVideos: 'off', youtubeShorts: false } }, 'not settings']) {
      expect(read(stored)).toEqual(repairSettings(stored).blockers);
    }
  });

  it('sets the hider attribute from the site’s one-video toggle', () => {
    const { effects } = step(start('x', X_TWEET, false).state, {
      type: 'settings',
      ...at(X_TWEET),
      stored: { blockers: { ...ALL_ON, xVideos: false } },
      initial: true,
    });
    expect(effects[0]).toEqual({ type: 'hider', on: false });
  });

  it('ignores the first read when a change arrived before it, and applies every change', () => {
    const changed = step(start('x', X_TWEET, false).state, {
      type: 'settings',
      ...at(X_TWEET),
      stored: { blockers: { ...ALL_ON, xVideos: false } },
      initial: false,
    }).state;
    const late = step(changed, { type: 'settings', ...at(X_TWEET), stored: { blockers: ALL_ON }, initial: true });
    expect(late).toEqual({ state: changed, effects: [] });
    const next = step(changed, { type: 'settings', ...at(X_TWEET), stored: { blockers: ALL_ON }, initial: false });
    expect(next.state.blockers.xVideos).toBe(true);
  });

  it('redirects a blocked page already on screen when a change turns its blocker on', () => {
    const off = loaded('instagram', REELS_CODE, { ...ALL_ON, instagramReels: false });
    const on = step(off, { type: 'settings', ...at(REELS_CODE), stored: { blockers: ALL_ON }, initial: false });
    expect(on.effects).toEqual([
      { type: 'hider', on: true },
      sync(true),
      saveLog('redirects', [NOW]),
      load(REELS_CODE_TARGET, 'replace'),
    ]);
  });

  it('leaves that page when the loop guard refuses the redirect', () => {
    const off = loaded('instagram', REELS_CODE, { ...ALL_ON, instagramReels: false });
    const on = step(off, { type: 'settings', ...at(REELS_CODE, { redirects: FULL }), stored: { blockers: ALL_ON }, initial: false });
    expect(on.effects).toEqual([{ type: 'hider', on: true }, sync(true)]);
  });
});

describe('navigate: a navigation the Navigation API reports', () => {
  it('lets an ordinary navigation through without reading the logs', () => {
    const logs = vi.fn(() => ({ redirects: FULL, undos: FULL }));
    const state = loaded('instagram', IG_HOME);
    const out = step(state, {
      type: 'navigate',
      here: IG_HOME,
      now: NOW,
      logs,
      destination: `${IG}/someuser/`,
      navigationType: 'push',
      sameDocument: true,
      cancelable: true,
    });
    expect(out.effects).toEqual([]);
    expect(out.state.lastNav).toEqual({ url: `${IG}/someuser/`, nav: { type: 'push', sameDocument: true } });
    expect(logs).not.toHaveBeenCalled();
  });

  it('records a navigation it cannot cancel and does nothing else', () => {
    const out = navigate(loaded('instagram', IG_HOME), `${IG}/reels/`, { cancelable: false, type: 'traverse' });
    expect(out.effects).toEqual([]);
    expect(out.state.lastNav).toEqual({ url: `${IG}/reels/`, nav: { type: 'traverse', sameDocument: true } });
  });

  it('cancels a move to a Reels feed and loads the home page on the next task, recording the redirect', () => {
    const out = navigate(loaded('instagram', `${IG}/someuser/`), `${IG}/reels/`, { logs: { redirects: [NOW - 1000] } });
    expect(out.effects).toEqual([CANCEL, saveLog('redirects', [NOW - 1000, NOW]), load(IG_HOME_TARGET, 'assign', true)]);
  });

  it('on Instagram lets an in-app move to the Reels scroller on one Reel commit, then swaps it for the post through the router', () => {
    // Cancelling it would leave Instagram's router remembering the scroller for this entry: Back would bring it back.
    const out = navigate(loaded('instagram', IG_SEARCH), REELS_CODE, { logs: { redirects: [] } });
    expect(out.effects).toEqual([saveLog('redirects', [NOW]), load(REELS_CODE_TARGET, 'replace', true)]);
  });

  it('does not load the post a second time when the swapped move commits, and forgets the swap once the post is on screen', () => {
    const swapped = navigate(loaded('instagram', IG_SEARCH), REELS_CODE, { logs: { redirects: [] } });
    expect(swapped.state.swap).toBe(REELS_CODE);
    const committed = settle(swapped.state, REELS_CODE, { redirects: [NOW] });
    expect(committed.effects.some((effect) => effect.type === 'load')).toBe(false);
    const onPost = settle(committed.state, POST_D);
    expect(onPost.state.swap).toBeNull();
    expect(onPost.effects.some((effect) => effect.type === 'load')).toBe(false);
  });

  it('on Instagram also swaps an in-app move the address replaces, not only a push', () => {
    const out = navigate(loaded('instagram', IG_SEARCH), REELS_CODE, { type: 'replace', logs: { redirects: [] } });
    expect(out.effects).toEqual([saveLog('redirects', [NOW]), load(REELS_CODE_TARGET, 'replace', true)]);
  });

  it('still cancels and loads a move to the scroller that loads a new document', () => {
    const out = navigate(loaded('instagram', IG_SEARCH), REELS_CODE, { sameDocument: false, logs: { redirects: [] } });
    expect(out.effects).toEqual([CANCEL, saveLog('redirects', [NOW]), load(REELS_CODE_TARGET, 'assign', true)]);
  });

  it('swaps nothing on a site that gives no post rule: an in-app move bound for a post is cancelled and loaded', () => {
    const out = navigate(loaded('instagram', IG_SEARCH, ALL_ON, null), REELS_CODE, { logs: { redirects: [] } });
    expect(out.effects).toEqual([CANCEL, saveLog('redirects', [NOW]), load(REELS_CODE_TARGET, 'assign', true)]);
    expect(out.state.swap).toBeNull();
  });

  it('only cancels a feed, counted in place, when the loop guard refuses the load', () => {
    expect(navigate(loaded('instagram', IG_HOME), `${IG}/reels/`, { logs: { redirects: FULL } }).effects).toEqual([
      CANCEL,
      count('instagram'),
    ]);
  });

  it('rewrites a Short to its watch page, and lets it through when the loop guard refuses', () => {
    const state = loaded('youtube', YT_HOME);
    expect(navigate(state, SHORT).effects).toEqual([CANCEL, saveLog('redirects', [NOW]), load(WATCH_TARGET, 'assign', true)]);
    expect(navigate(state, SHORT, { logs: { redirects: FULL } }).effects).toEqual([]);
  });

  it('acts on the default toggles before the stored settings arrive', () => {
    const { state } = start('youtube', YT_HOME, false);
    expect(navigate(state, SHORT).effects).toEqual([CANCEL, saveLog('redirects', [NOW]), load(WATCH_TARGET, 'assign', true)]);
  });

  it('lets feeds and viewer moves through while their toggles are off', () => {
    expect(navigate(loaded('instagram', IG_HOME, ALL_OFF), `${IG}/reels/`).effects).toEqual([]);
    expect(navigate(loaded('facebook', FB_111, ALL_OFF), FB_222).effects).toEqual([]);
  });

  it('undoes a viewer pushed to its next video: the push commits, and the next task checks it', () => {
    const out = navigate(loaded('facebook', FB_111), FB_222, { logs: { undos: [NOW - 1000] } });
    expect(out.state.undo).toEqual({ from: FB_111, until: NOW + UNDO_SETTLE_MS });
    expect(out.effects).toEqual([
      saveLog('undos', [NOW - 1000, NOW]),
      {
        type: 'later',
        after: 0,
        input: {
          type: 'pushed',
          pushed: FB_222,
          from: FB_111,
          site: 'facebook',
          fallback: { action: 'redirect', target: FB_LOCK, redirects: [NOW] },
        },
      },
    ]);
  });

  it.each<[string, Move]>([
    ['a replace', { type: 'replace' }],
    ['a traverse', { type: 'traverse' }],
    ['a cross-document push', { sameDocument: false }],
  ])('cancels a viewer moved by %s and loads the first video again on the next task', (_name, move) => {
    expect(navigate(loaded('facebook', FB_111), FB_222, move).effects).toEqual([
      CANCEL,
      saveLog('redirects', [NOW]),
      load(FB_LOCK, 'replace', true),
    ]);
  });

  it('falls back to the reload when the undo guard refuses a third undo within 5 s', () => {
    expect(navigate(loaded('facebook', FB_111), FB_222, { logs: { undos: FULL } }).effects).toEqual([
      CANCEL,
      saveLog('redirects', [NOW]),
      load(FB_LOCK, 'replace', true),
    ]);
  });

  it('cancels a viewer move in place, counted, when the undo and loop guards both refuse', () => {
    const out = navigate(loaded('facebook', FB_111), FB_222, { logs: { undos: FULL, redirects: FULL } });
    expect(out.effects).toEqual([CANCEL, count('facebook')]);
    expect(out.state.undo).toBeNull();
  });

  it('undoes a tap on the video of the tweet already open instead of reloading it', () => {
    const out = navigate(loaded('x', X_TWEET), X_VIDEO);
    expect(out.state.undo).toEqual({ from: X_TWEET, until: NOW + UNDO_SETTLE_MS });
    expect(out.effects[1]).toMatchObject({
      type: 'later',
      after: 0,
      input: { type: 'pushed', pushed: X_VIDEO, from: X_TWEET, site: 'x', fallback: { action: 'redirect', target: X_TWEET_TARGET } },
    });
  });
});

describe('navigate while an undo is in flight', () => {
  it('lets the undo’s own Back through', () => {
    expect(navigate(undoing(), FB_111, { here: FB_222, type: 'traverse' }).effects).toEqual([]);
  });

  it('cancels any other move to another video or to a blocked page, uncounted', () => {
    const state = undoing();
    expect(navigate(state, FB_333, { here: FB_222 }).effects).toEqual([CANCEL]);
    expect(navigate(state, `${FB_222}?s=feed`, { here: FB_222, type: 'replace' }).effects).toEqual([CANCEL]);
    expect(navigate(state, `${FB}/reels/`, { here: FB_222 }).effects).toEqual([CANCEL]);
  });

  it('lets a move to an ordinary page through', () => {
    expect(navigate(undoing(), `${FB}/friends/`, { here: FB_222 }).effects).toEqual([]);
  });

  it('forgets an undo past its deadline and decides the next move on its own', () => {
    const later = NOW + UNDO_SETTLE_MS;
    const out = navigate(undoing(), FB_333, { here: FB_222, now: later });
    expect(out.state.undo).toEqual({ from: FB_222, until: later + UNDO_SETTLE_MS });
    expect(out.effects[0]).toEqual(saveLog('undos', [later]));
  });
});

describe('navigate from a post a Reel opened on through Instagram’s router', () => {
  function popUp(blockers: Blockers = ALL_ON): GuardState {
    const state = loaded('instagram', IG_SEARCH, blockers);
    return step(state, { type: 'opened', ...at(POST_E), code: 'EEEEE5' }).state;
  }

  it('undoes a move to the next post, as in a Reels viewer', () => {
    const out = navigate(popUp(), POST_F, { here: POST_E });
    expect(out.state.popUp).toBe('EEEEE5');
    expect(out.state.undo).toEqual({ from: POST_E, until: NOW + UNDO_SETTLE_MS });
    expect(out.effects[1]).toMatchObject({
      type: 'later',
      input: { type: 'pushed', pushed: POST_F, from: POST_E, site: 'instagram', fallback: { action: 'redirect', target: POST_E_TARGET } },
    });
  });

  it('lets a move to the next post by replace commit, then loads the first post over it, in place when the site can', () => {
    expect(navigate(popUp(), POST_F, { here: POST_E, type: 'replace' }).effects).toEqual([
      saveLog('redirects', [NOW]),
      load(POST_E_TARGET, 'replace', true),
    ]);
  });

  it('keeps no post on a site that gives no post rule: the next post goes through', () => {
    const state = step(loaded('instagram', IG_SEARCH, ALL_ON, null), { type: 'opened', ...at(POST_E), code: 'EEEEE5' }).state;
    const out = navigate(state, POST_F, { here: POST_E });
    expect(out.effects).toEqual([]);
    expect(out.state.popUp).toBeNull();
  });

  it('keeps the post when the router commits it after opening it, so the next post is still undone', () => {
    // The router answered at once but moves on its own time: its navigation starts from the page under the pop-up.
    const opening = navigate(popUp(), POST_E, { here: IG_SEARCH });
    expect(opening.effects).toEqual([]);
    expect(opening.state.popUp).toBe('EEEEE5');
    const onPost = settle(opening.state, POST_E).state;
    const next = navigate(onPost, POST_F, { here: POST_E });
    expect(next.state.undo).toEqual({ from: POST_E, until: NOW + UNDO_SETTLE_MS });
  });

  it('lets the same post through and keeps it', () => {
    const out = navigate(popUp(), `${POST_E}?img_index=2`, { here: POST_E });
    expect(out.effects).toEqual([]);
    expect(out.state.popUp).toBe('EEEEE5');
  });

  it('forgets the post when the page leaves it, or when a move starts from another page', () => {
    expect(navigate(popUp(), `${IG}/someuser/`, { here: POST_E }).state.popUp).toBeNull();
    // Closing goes Back, also onto another post's page the Reel was tapped on: a traverse is never the next post.
    const closed = navigate(popUp(), POST_F, { here: POST_E, type: 'traverse' });
    expect(closed.effects).toEqual([]);
    expect(closed.state.popUp).toBeNull();
    expect(navigate(popUp(), 'not an address', { here: POST_E }).state.popUp).toBeNull();
    const elsewhere = navigate(popUp(), POST_F, { here: IG_SEARCH });
    expect(elsewhere.state.popUp).toBeNull();
    expect(elsewhere.effects).toEqual([]);
  });

  it('keeps the post but lets the move through while the Reels blocker is off', () => {
    const out = navigate(popUp({ ...ALL_ON, instagramReels: false }), POST_F, { here: POST_E });
    expect(out.effects).toEqual([]);
    expect(out.state.popUp).toBe('EEEEE5');
  });
});

describe('pushed: the task after an undo’s push', () => {
  const check: PushCheck = {
    type: 'pushed',
    pushed: FB_222,
    from: FB_111,
    site: 'facebook',
    fallback: { action: 'redirect', target: FB_LOCK, redirects: [NOW] },
  };

  it('goes back once the push committed, counted once, and gives the Back the settle window to land', () => {
    const out = step(undoing(), { ...check, ...at(FB_222, {}, NOW + 5) });
    expect(out.state.undo).toEqual({ from: FB_111, until: NOW + 5 + UNDO_SETTLE_MS });
    expect(out.effects).toEqual([count('facebook'), BACK, settleIn(UNDO_SETTLE_MS)]);
  });

  it('loads the fallback when the push never committed', () => {
    const out = step(undoing(), { ...check, ...at(FB_111) });
    expect(out.state.undo).toBeNull();
    expect(out.effects).toEqual([saveLog('redirects', [NOW]), load(FB_LOCK, 'replace')]);
  });

  it('counts a refused fallback in place', () => {
    const out = step(undoing(), { ...check, fallback: { action: 'cancel', site: 'facebook' }, ...at(FB_111) });
    expect(out.effects).toEqual([count('facebook')]);
  });
});

describe('settle: a committed URL, an undo’s deadline, a re-check', () => {
  /** A Facebook viewer whose undo's Back is on its way to reel 111. */
  function goingBack(): GuardState {
    return step(undoing(), { type: 'pushed', pushed: FB_222, from: FB_111, site: 'facebook', fallback: { action: 'cancel', site: 'facebook' }, ...at(FB_222) }).state;
  }

  it('does nothing, and reads no logs, on the URL it last settled on', () => {
    const logs = vi.fn(() => ({ redirects: [], undos: [] }));
    const state = loaded('facebook', FB_111);
    expect(step(state, { type: 'settle', here: FB_111, now: NOW, logs })).toEqual({ state, effects: [] });
    expect(logs).not.toHaveBeenCalled();
  });

  it('follows the URL: the input lock on a viewer and off elsewhere, the post page with the Reels toggle', () => {
    const out = settle(loaded('facebook', FB_111), `${FB}/friends/`);
    expect(out.effects).toEqual([sync(false)]);
    expect(out.state.href).toBe(`${FB}/friends/`);
    expect(settle(loaded('instagram', IG_HOME, { ...ALL_ON, instagramReels: false }), POST_E).effects).toEqual([sync(false, false)]);
    expect(settle(loaded('youtube', YT_HOME), `${YT_HOME}feed/subscriptions`).effects).toEqual([sync(false)]);
  });

  it('locks a viewer entered in-app on the default toggles before the stored settings arrive, and moves nothing', () => {
    const { state } = start('facebook', `${FB}/`, false);
    expect(settle(state, FB_111)).toEqual({ state: { ...state, synced: FB_111 }, effects: [sync(true)] });
  });

  it('turns the input lock off on the way back from a viewer before the settings arrive', () => {
    const { state } = start('youtube', YT_HOME, false);
    const onShort = settle(state, `${YT_HOME}shorts/abcdefghijk`);
    expect(onShort.effects).toEqual([sync(true)]);
    expect(settle(onShort.state, YT_HOME).effects).toEqual([sync(false)]);
  });

  it('follows the page on screen when a refused viewer move goes back to the first video', () => {
    const reelA = `${IG}/reel/AAAAAA/`;
    const refused = settle(loaded('instagram', reelA), `${IG}/reels/BBBBBB/`, { redirects: FULL, undos: FULL });
    expect(refused.state.href).toBe(reelA);
    expect(refused.effects).toContainEqual(sync(true));
    // Back on the single Reel: its caption and comments scroll again.
    expect(settle(refused.state, reelA, { redirects: FULL, undos: FULL }).effects).toContainEqual(sync(false));
  });

  it('waits for the settings, then settles from the URL it started on', () => {
    const { state } = start('facebook', FB_111, false);
    const early = settle(state, FB_222);
    expect(early).toEqual({ state: { ...state, synced: FB_222 }, effects: [sync(true)] });
    const out = step(early.state, { type: 'settings', ...at(FB_222), stored: { blockers: ALL_ON }, initial: true });
    expect(out.effects).toEqual([{ type: 'hider', on: true }, sync(true), saveLog('redirects', [NOW]), load(FB_LOCK, 'replace')]);
  });

  it('waits for an undo’s Back to land, then settles on the page it left', () => {
    const state = goingBack();
    const waiting = settle(state, FB_222, {}, NOW + 10);
    expect(waiting).toEqual({ state, effects: [] });
    const landed = settle(state, FB_111, {}, NOW + 10);
    expect(landed.state.undo).toBeNull();
    expect(landed.state.lastNav).toEqual(state.lastNav);
    expect(landed.effects).toEqual([sync(true)]);
  });

  it('forgets an undo whose Back landed before the settings did', () => {
    const early = navigate(start('facebook', FB_111, false).state, FB_222).state;
    expect(early.undo).not.toBeNull();
    const out = settle(early, FB_111);
    expect(out.state.undo).toBeNull();
    expect(out.effects).toEqual([sync(true)]);
  });

  it('sends the viewer back by a load when the undo’s Back has not landed by its deadline', () => {
    const deadline = NOW + UNDO_SETTLE_MS;
    const out = settle(goingBack(), FB_222, {}, deadline);
    expect(out.state.undo).toBeNull();
    expect(out.state.lastNav).toBeNull();
    expect(out.effects).toEqual([sync(true), saveLog('redirects', [deadline]), load(FB_LOCK, 'replace')]);
  });

  it('undoes a viewer move that committed as a push the guard could not stop', () => {
    const pushed = navigate(loaded('facebook', FB_111), FB_222, { cancelable: false }).state;
    const out = settle(pushed, FB_222);
    expect(out.state.href).toBe(FB_111);
    expect(out.state.undo).toEqual({ from: FB_111, until: NOW + UNDO_SETTLE_MS });
    expect(out.effects).toEqual([sync(true), saveLog('undos', [NOW]), count('facebook'), BACK, settleIn(UNDO_SETTLE_MS)]);
  });

  it('loads the first video again for a committed move it cannot undo', () => {
    const traversed = navigate(loaded('facebook', FB_111), FB_222, { cancelable: false, type: 'traverse' }).state;
    const out = settle(traversed, FB_222);
    expect(out.state.href).toBe(FB_222);
    expect(out.effects).toEqual([sync(true), saveLog('redirects', [NOW]), load(FB_LOCK, 'replace')]);
  });

  it('keeps the first video as the anchor when both guards refuse, uncounted, and checks again once a load is admitted', () => {
    const traversed = navigate(loaded('facebook', FB_111), FB_222, { cancelable: false, type: 'traverse' }).state;
    const logs = { redirects: [NOW - 1000, NOW - 500], undos: FULL };
    const refused = settle(traversed, FB_222, logs);
    expect(refused.state.href).toBe(FB_111);
    expect(refused.effects).toEqual([sync(true), settleIn(4000)]);
    const retried = settle(refused.state, FB_222, logs, NOW + 4000);
    expect(retried.effects).toEqual([sync(true), saveLog('redirects', [NOW - 500, NOW + 4000]), load(FB_LOCK, 'replace')]);
  });

  it('sets one re-check for a refused move however often the moved page commits, and a new one once it has run', () => {
    const traversed = navigate(loaded('facebook', FB_111), FB_222, { cancelable: false, type: 'traverse' }).state;
    const logs = { redirects: [NOW - 1000, NOW - 500], undos: FULL };
    const refused = settle(traversed, FB_222, logs);
    expect(refused.effects).toEqual([sync(true), settleIn(4000)]);
    const again = settle(refused.state, FB_222, logs, NOW + 100);
    expect(again.effects).toEqual([sync(true)]);
    // The re-check runs and is refused again (the log moved on): it sets the next one.
    const later = { redirects: [NOW + 3000, NOW + 3500], undos: FULL };
    const rerun = settle(again.state, FB_222, later, NOW + 4000);
    expect(rerun.effects).toEqual([sync(true), settleIn(4000)]);
  });

  it('sets a re-check when one that came due ran while the viewer was back on its first video', () => {
    const traversed = navigate(loaded('facebook', FB_111), FB_222, { cancelable: false, type: 'traverse' }).state;
    const logs = { redirects: [NOW - 1000, NOW - 500], undos: FULL };
    const refused = settle(traversed, FB_222, logs).state;
    const due = settle(refused, FB_111, logs, NOW + 4000).state;
    const fresh = { redirects: [NOW + 5000, NOW + 5500], undos: FULL };
    expect(settle(due, FB_222, fresh, NOW + 6000).effects).toEqual([sync(true), settleIn(4000)]);
  });

  it('redirects a blocked page that committed anyway, unless the loop guard refuses', () => {
    const state = loaded('youtube', YT_HOME);
    expect(settle(state, SHORT).effects).toEqual([sync(true), saveLog('redirects', [NOW]), load(WATCH_TARGET, 'replace')]);
    expect(settle(state, SHORT, { redirects: FULL }).effects).toEqual([sync(true)]);
  });
});

describe('opened: a post opened through Instagram’s router', () => {
  it('remembers the post and makes the post page follow it once the settings are known', () => {
    const out = step(loaded('instagram', IG_SEARCH), { type: 'opened', ...at(POST_E), code: 'EEEEE5' });
    expect(out.state.popUp).toBe('EEEEE5');
    expect(out.effects).toEqual([sync(false)]);
  });

  it('remembers it without following before the settings load', () => {
    const out = step(start('instagram', IG_SEARCH, false).state, { type: 'opened', ...at(POST_E), code: 'EEEEE5' });
    expect(out.state.popUp).toBe('EEEEE5');
    expect(out.effects).toEqual([]);
  });
});

describe('Facebook with its reel rule: a reel move is put back in this document, never by a reload', () => {
  const onReel = (): GuardState => loaded('facebook', FB_111, ALL_ON, facebookReelCode);

  it('lets a move to the next reel by replace commit, then swaps the first reel back', () => {
    const out = navigate(onReel(), FB_222, { type: 'replace', logs: { redirects: [] } });
    expect(out.effects).toEqual([saveLog('redirects', [NOW]), load(FB_LOCK, 'replace', true)]);
    expect(out.state.swap).toBe(FB_222);
  });

  it('lets a move both guards refuse commit, and puts the first reel back once a load is admitted: a cancel would leave the next reel drawn', () => {
    const logs = { redirects: [NOW - 1000, NOW - 500], undos: FULL };
    const moved = navigate(onReel(), FB_222, { type: 'replace', logs });
    expect(moved.effects).toEqual([]);
    const refused = settle(moved.state, FB_222, logs);
    expect(refused.state.href).toBe(FB_111);
    expect(refused.effects).toEqual([sync(true), settleIn(4000)]);
    const retried = settle(refused.state, FB_222, logs, NOW + 4000);
    expect(retried.effects).toEqual([sync(true), saveLog('redirects', [NOW - 500, NOW + 4000]), load(FB_LOCK, 'replace', true)]);
    expect(retried.state.swap).toBe(FB_222);
  });

  it('still undoes a move by push with Back', () => {
    const out = navigate(onReel(), FB_222, { logs: { undos: [] } });
    expect(out.effects.some((effect) => effect.type === 'later')).toBe(true);
    expect(out.effects).not.toContainEqual(CANCEL);
  });

  it('does not take its own way back to the first reel for a new move: the anchor stays on the first reel', () => {
    const swapped = navigate(onReel(), FB_222, { type: 'replace', logs: { redirects: [] } }).state;
    const moved = settle(swapped, FB_222, { redirects: [NOW] });
    expect(moved.state.href).toBe(FB_111);
    const back = settle(moved.state, FB_111, { redirects: [NOW] });
    expect(back.effects.some((effect) => effect.type === 'load')).toBe(false);
    expect(back.state.swap).toBeNull();
  });

  it('keeps the first reel as the anchor when a move that was not stopped is put back on settle, so the way back is no new move', () => {
    // A non-cancelable replace: nothing stopped it, and the settle after its commit sends the viewer back.
    const moved = navigate(onReel(), FB_222, { type: 'replace', cancelable: false }).state;
    const settled = settle(moved, FB_222);
    // In a task of its own: this commit may still be inside Facebook's own call.
    expect(settled.effects).toContainEqual(load(FB_LOCK, 'replace', true));
    expect(settled.state.href).toBe(FB_111);
    const back = navigate(settled.state, `${FB_111}/`, { here: FB_222, type: 'replace', logs: { redirects: [NOW] } });
    expect(back.effects).toEqual([]);
    expect(settle(back.state, `${FB_111}/`, { redirects: [NOW] }).effects.some((effect) => effect.type === 'load')).toBe(false);
  });

  it.each([
    ['the viewer\'s own Previous Card putting the first reel back', FB_111, true],
    ['the load of the first reel, when that button is not there', FB_LOCK, false],
  ])('lets %s through, judged from the first reel rather than the moved one on screen', (_, destination, sameDocument) => {
    const swapped = navigate(onReel(), FB_222, { type: 'replace', logs: { redirects: [] } }).state;
    const committed = settle(swapped, FB_222, { redirects: [NOW] }).state;
    const out = navigate(committed, destination, { here: FB_222, type: 'replace', sameDocument, logs: { redirects: [NOW] } });
    expect(out.effects).toEqual([]);
  });
});
