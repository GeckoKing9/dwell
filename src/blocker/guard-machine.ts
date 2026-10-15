/**
 * The in-page guard as a state machine (KTD4, KTD4b): what the guard knows, and what it does with each thing
 * it hears, as pure transitions `(state, input) -> { state, effects }`. No Chrome APIs, no DOM, no clock: the
 * adapter (`content/guard.ts`) hands in the page's navigations, its URL commits, the stored settings and
 * the timers the machine asked for, each with the URL on screen, the time and a reader for the two logs, and
 * carries out the effects. The decisions are `decide.ts`, `viewer.ts` and `patterns.ts`; this only orders them.
 *
 * Cancelling alone does not stop a single-page app: its router has usually drawn the new route already. So
 * every block ends in a page load or an undo, and a bare cancel is the last resort.
 *
 * - navigate: a cancelable move to a blocked page is cancelled and a page loaded instead on the next task.
 *   A same-document push that must be taken back (a viewer's next video, a rewrite to the page already open,
 *   the next post in the pop-up a Reel opened in) is let through and checked on the next task (`pushed`):
 *   Back when it committed, else the load. While an undo is in flight, any other move to another video or to
 *   a blocked page is cancelled.
 * - settle (a commit, an undo's deadline, a re-check): a viewer that moved anyway goes back to its first
 *   video, a blocked page on screen goes to its target, and the input lock and Instagram's post page follow.
 * - settings: the first read or a change; a stripped `#dwell=<site>` landing is counted once, after the first.
 * - opened: a post the site's router opened for the guard (Instagram).
 *
 * A site whose router opens a post in this document (Instagram) gives the machine its post rule at start
 * (`PostCode`); with none, the swap and the pop-up's one-post lock never apply, and the site's bundle carries
 * no post paths.
 */
import {
  admitRedirect,
  admitsAt,
  decide,
  decideLock,
  markerCounts,
  type Decision,
  type Fallback,
  type GuardContext,
  type NavigationInfo,
  type NavigationKind,
} from './decide.ts';
import { classify } from './patterns.ts';
import { VIEWER_TOGGLE, decideViewerMove, lockTarget, viewerLocked, type ViewerMove } from './viewer.ts';
import { repairBlockers } from '../shared/settings.ts';
import { DEFAULT_SETTINGS, type BlockedSite, type Settings } from '../store/schema.ts';
import { isPlainObject } from '../store/validate.ts';

type Blockers = Settings['blockers'];
type Lock = Extract<ViewerMove, { action: 'lock' }>;

/** How long an undo's Back has to land before the move it took back is treated like any other. */
export const UNDO_SETTLE_MS = 1000;

/** The two logs (epoch ms), each kept per tab by the adapter: redirects for the loop guard, undos for the undo guard. */
export interface Logs {
  redirects: readonly number[];
  undos: readonly number[];
}

/** Which post an address shows on its own page, or null: the post rule of a site whose router opens posts in this document. */
export type PostCode = (url: string) => string | null;

export interface GuardState {
  readonly site: BlockedSite;
  /** The site's post rule, or null on a site that has none. */
  readonly postCode: PostCode | null;
  readonly blockers: Blockers;
  /** The stored settings are known. Before that, navigations meet the default toggles and nothing settles. */
  readonly loaded: boolean;
  /** A `#dwell=<site>` landing was stripped at start; it is counted once the settings load. */
  readonly marker: boolean;
  /** The URL last settled on: a viewer move is measured from here, and a refused one keeps the first video here. */
  readonly href: string;
  /** The latest navigation reported, so a settle can tell a same-document push from anything else. */
  readonly lastNav: { url: string; nav: NavigationInfo } | null;
  /** An undo in flight: the page its Back returns to, and until when the guard waits for it. */
  readonly undo: { from: string; until: number } | null;
  /** The post a Reel opened on through the site's router: a move from it to another post is undone. */
  readonly popUp: string | null;
  /** A move let through to be replaced by its post in this document: its own commit is not loaded a second time. */
  readonly swap: string | null;
  /** When the re-check a refused viewer move asked for runs: one timer at a time. */
  readonly recheckAt: number | null;
}

/** What every input carries: the URL on screen, the time, and the logs, read only when a decision needs them. */
export interface Moment {
  here: string;
  now: number;
  logs: () => Logs;
}

/** An undo's push, checked on the next task: Back when it committed, else its fallback. */
export interface PushCheck {
  type: 'pushed';
  pushed: string;
  from: string;
  site: BlockedSite;
  fallback: Fallback;
}

/** What a timer brings back: a push to check, or a settle (an undo's deadline, a refused move's re-check). */
export type Later = PushCheck | { type: 'settle' };

type Navigate = Moment & { type: 'navigate'; destination: string; navigationType: NavigationKind; sameDocument: boolean; cancelable: boolean };
type SettingsInput = Moment & { type: 'settings'; stored: unknown; initial: boolean };

export type Input = Navigate | SettingsInput | (Moment & { type: 'opened'; code: string | null }) | (Moment & Later);

/**
 * `cancel`: prevent the navigation being reported. `count`: report one block (`landing`: the stripped
 * marker, reported as is; otherwise at most once a second). `load`: go to an allowlisted target, on the next
 * task when `deferred`, opened in this document when the site can (`replace`: in place of the entry on
 * screen). `back`: one step back in history. `later`: bring `input` back after `after` ms.
 * `saveLog`: store a log. `hider`: the site's hider attribute. `sync`: the input lock and the post page.
 */
export type Effect =
  | { type: 'cancel' }
  | { type: 'count'; site: BlockedSite; landing: boolean }
  | { type: 'load'; target: string; mode: 'assign' | 'replace'; deferred: boolean }
  | { type: 'back' }
  | { type: 'later'; after: number; input: Later }
  | { type: 'saveLog'; log: keyof Logs; times: number[] }
  | { type: 'hider'; on: boolean }
  | { type: 'sync'; lock: boolean; posts: boolean };

export interface Step {
  state: GuardState;
  effects: Effect[];
}

const CANCEL: Effect = { type: 'cancel' };
const SETTLE: Later = { type: 'settle' };

function none(state: GuardState): Step {
  return { state, effects: [] };
}

function count(site: BlockedSite, landing = false): Effect {
  return { type: 'count', site, landing };
}

/** The site's hider stylesheet follows its one-video toggle. */
function hider(state: GuardState): Effect {
  return { type: 'hider', on: state.blockers[VIEWER_TOGGLE[state.site]] };
}

/** The input lock is on exactly while `here` is a viewer whose toggle is on; Instagram's post page follows the Reels toggle. */
function sync(state: GuardState, here: string): Effect {
  return { type: 'sync', lock: viewerLocked(here, state.blockers), posts: state.blockers.instagramReels };
}

/** The guard at document_start, on `here`: the default toggles until the stored settings arrive. */
export function start(site: BlockedSite, here: string, marker: boolean, postCode: PostCode | null = null): Step {
  const state: GuardState = {
    site,
    postCode,
    blockers: { ...DEFAULT_SETTINGS.blockers },
    loaded: false,
    marker,
    href: here,
    lastNav: null,
    undo: null,
    popUp: null,
    swap: null,
    recheckAt: null,
  };
  return { state, effects: [hider(state), sync(state, here)] };
}

export function step(state: GuardState, input: Input): Step {
  switch (input.type) {
    case 'navigate':
      return navigate(state, input);
    case 'settle':
      return state.undo === null && input.here === state.href ? none(state) : settle(state, input);
    case 'settings':
      return settings(state, input);
    case 'pushed':
      return pushed(state, input);
    case 'opened': {
      const next = { ...state, popUp: input.code };
      return { state: next, effects: next.loaded ? [sync(next, input.here)] : [] };
    }
  }
}

function context(input: Moment, nav: NavigationInfo | null, from = input.here): GuardContext {
  return { from, nav, now: input.now, ...input.logs() };
}

function navigate(prior: GuardState, input: Navigate): Step {
  const nav: NavigationInfo = { type: input.navigationType, sameDocument: input.sameDocument };
  let state: GuardState = { ...prior, lastNav: { url: input.destination, nav } };
  if (!input.cancelable) return none(state);
  if (state.undo !== null && input.now >= state.undo.until) state = { ...state, undo: null };
  if (state.undo !== null) return { state, effects: holds(state, state.undo.from, input) ? [CANCEL] : [] };
  const popUp = popUpMove(state, input);
  state = { ...state, popUp: popUp.anchor };
  // The next post in the pop-up a Reel opened in is undone, as the next video in a viewer is.
  const move = popUp.move ?? decideViewerMove(input.here, input.destination, state.blockers);
  if (move.action === 'lock') return apply(state, decideLock(move, context(input, nav)), 'replace', input);
  const hit = classify(input.destination, state.blockers);
  // Most navigations block nothing: the logs are read only for one that does.
  return hit === null ? none(state) : apply(state, decide(hit, context(input, nav)), 'assign', input);
}

/** While an undo is in flight its own Back goes through; any other move to another video or to a blocked page is cancelled. */
function holds(state: GuardState, from: string, input: Navigate): boolean {
  if (input.navigationType === 'traverse') return false;
  const move = decideViewerMove(from, input.destination, state.blockers);
  return move.action === 'lock' || classify(input.destination, state.blockers) !== null;
}

/**
 * A move from the post a Reel's pop-up shows to another post, as a lock on the first one. A move to that
 * post keeps it (the router may commit the post after it answered, from the page under the pop-up); leaving
 * the pop-up (closing it, opening a profile) forgets it; with the Reels blocker off it is kept but not locked.
 */
function popUpMove(state: GuardState, input: Navigate): { anchor: string | null; move: Lock | null } {
  if (state.popUp === null || state.postCode === null) return { anchor: null, move: null };
  const from = state.postCode(input.here);
  const to = state.postCode(input.destination);
  if (to === state.popUp) return { anchor: state.popUp, move: null };
  if (from !== state.popUp || to === null) return { anchor: null, move: null };
  if (!state.blockers[VIEWER_TOGGLE[state.site]]) return { anchor: from, move: null };
  const target = lockTarget(state.site, from);
  return { anchor: from, move: target === null ? null : { action: 'lock', site: state.site, target } };
}

/** Carries out a decision on a cancelable navigation: undo it after it commits, or cancel it and count or load. */
function apply(state: GuardState, decision: Decision, mode: 'assign' | 'replace', input: Navigate): Step {
  switch (decision.action) {
    case 'allow':
      return none(state);
    case 'cancel':
      return { state, effects: [CANCEL, count(decision.site)] };
    case 'redirect':
      if (swaps(state, decision.target, input)) {
        // Not cancelled: a cancelled move stays in the site's router as this entry's route, and Back would
        // bring it back. It commits, then the post replaces it, through the router when it can.
        return {
          state: { ...state, swap: input.destination },
          effects: [saveLog('redirects', decision.redirects), { type: 'load', target: decision.target, mode: 'replace', deferred: true }],
        };
      }
      // The target page is the destination (R15); its marker is what gets counted on landing.
      return {
        state,
        effects: [CANCEL, saveLog('redirects', decision.redirects), { type: 'load', target: decision.target, mode, deferred: true }],
      };
    case 'undo': {
      const check: PushCheck = { type: 'pushed', pushed: input.destination, from: input.here, site: decision.site, fallback: decision.fallback };
      return {
        state: { ...state, undo: { from: input.here, until: input.now + UNDO_SETTLE_MS } },
        effects: [saveLog('undos', decision.undos), { type: 'later', after: 0, input: check }],
      };
    }
  }
}

/** On a site with a post rule, an in-app push or replace bound for one post is swapped for it rather than cancelled. */
function swaps(state: GuardState, target: string, input: Navigate): boolean {
  return (
    state.postCode !== null &&
    input.sameDocument &&
    (input.navigationType === 'push' || input.navigationType === 'replace') &&
    state.postCode(target) !== null
  );
}

function saveLog(log: keyof Logs, times: number[]): Effect {
  return { type: 'saveLog', log, times };
}

/** The next task after an undo's push: Back when it committed; when something stopped it, the page may have drawn its route anyway, so the fallback. */
function pushed(state: GuardState, input: Moment & PushCheck): Step {
  if (input.here === input.pushed) return goBack(state, input.from, input.site, input.now);
  return loadPath({ ...state, undo: null }, input.fallback);
}

/** Takes back a push that committed: Back makes the site's own router draw `from` again. Counted once. */
function goBack(state: GuardState, from: string, site: BlockedSite, now: number): Step {
  return {
    state: { ...state, undo: { from, until: now + UNDO_SETTLE_MS } },
    effects: [count(site), { type: 'back' }, { type: 'later', after: UNDO_SETTLE_MS, input: SETTLE }],
  };
}

/** The load path of a decision: a redirect goes to its target, a cancel that already happened is counted. */
function loadPath(state: GuardState, fallback: Fallback): Step {
  if (fallback.action === 'cancel') return { state, effects: [count(fallback.site)] };
  return { state, effects: [saveLog('redirects', fallback.redirects), load(fallback.target)] };
}

function load(target: string): Effect {
  return { type: 'load', target, mode: 'replace', deferred: false };
}

function settings(prior: GuardState, input: SettingsInput): Step {
  // The first read arriving after a change is older than it.
  if (input.initial && prior.loaded) return none(prior);
  const blockers = repairBlockers(isPlainObject(input.stored) ? input.stored.blockers : undefined);
  const landing = prior.marker && markerCounts(prior.site, blockers);
  const state: GuardState = { ...prior, blockers, loaded: true, marker: false };
  const settled = settle(state, input);
  return { state: settled.state, effects: [...(landing ? [count(prior.site, true)] : []), hider(state), ...settled.effects] };
}

/**
 * Every URL change the navigate handler did not stop: a viewer that moved to another video goes back to the
 * first one, anything else blocked goes to its target, then the page follows the URL. While an undo is in
 * flight it waits for the Back to land, for at most UNDO_SETTLE_MS; a Back that never lands leaves the move
 * to the load path. The page follows before anything loads, so a load that opens the post in this document
 * (Instagram's router) is followed last.
 */
function settle(prior: GuardState, input: Moment): Step {
  // A re-check whose time has come is no longer pending, whichever settle this is.
  let state: GuardState = prior.recheckAt !== null && input.now >= prior.recheckAt ? { ...prior, recheckAt: null } : prior;
  // Settled before the settings check, so an undo started before they load cannot hold every move after it.
  if (state.undo !== null) {
    const landed = input.here === state.undo.from;
    if (!landed && input.now < state.undo.until) return none(state);
    state = { ...state, undo: null, lastNav: landed ? state.lastNav : null };
  }
  // Before the settings arrive nothing moves, but the input lock follows the URL on the default toggles, as the
  // hiders do: a viewer entered in that window is locked from its first key, not from the settings' arrival.
  if (!state.loaded) return { state, effects: [sync(state, input.here)] };
  const from = state.href;
  if (state.swap !== null) {
    // The move being swapped commits first: the router's replace is already on its way.
    if (input.here === state.swap) return { state: { ...state, href: input.here }, effects: [sync(state, input.here)] };
    state = { ...state, swap: null };
  }
  state = { ...state, href: input.here };
  const move = decideViewerMove(from, input.here, state.blockers);
  const out = move.action === 'lock' ? settleMove(state, move, from, input) : enforce(state, input);
  return { state: out.state, effects: [sync(state, input.here), ...out.effects] };
}

/**
 * A viewer that moved to another video without being stopped: undone when the move was a same-document
 * push, else sent back to the first video's page. Refused by both guards, the first video stays the
 * anchor, and the guard looks again once the loop guard admits a load: one re-check at a time, so a later
 * commit on the moved page sets none unless it would run sooner.
 */
function settleMove(state: GuardState, move: Lock, from: string, input: Moment): Step {
  const nav = state.lastNav !== null && state.lastNav.url === input.here ? state.lastNav.nav : null;
  const ctx = context(input, nav, from);
  const decision = decideLock(move, ctx);
  if (decision.action === 'undo') {
    const back = goBack({ ...state, href: from }, from, decision.site, input.now);
    return { state: back.state, effects: [saveLog('undos', decision.undos), ...back.effects] };
  }
  if (decision.action === 'redirect') return loadPath(state, decision);
  const retryAt = admitsAt(ctx);
  const anchored = { ...state, href: from };
  if (retryAt <= input.now || (state.recheckAt !== null && state.recheckAt <= retryAt)) return none(anchored);
  return { state: { ...anchored, recheckAt: retryAt }, effects: [{ type: 'later', after: retryAt - input.now, input: SETTLE }] };
}

/** A blocked page on screen goes to its target, when the loop guard admits it. */
function enforce(state: GuardState, input: Moment): Step {
  const hit = classify(input.here, state.blockers);
  if (hit === null) return none(state);
  const redirects = admitRedirect({ now: input.now, redirects: input.logs().redirects });
  return redirects === null ? none(state) : loadPath(state, { action: 'redirect', target: hit.target, redirects });
}
