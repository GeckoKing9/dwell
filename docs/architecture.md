# Architecture — Dwell

Last updated: 2026-10-14
Status: MVP built (U1 to U10); release packaging in place, owner checklist pending

---

## System overview
Dwell is a Chrome Manifest V3 extension with no server. A service worker turns Chrome's tab, window, idle and alarm events into per-site time attributions through a pure engine, stores them per local day, and serves a popup and a dashboard page that compute everything they show from those keys. Content scripts on four sites (Instagram, YouTube, Facebook, X) report media state, keep Reels, Shorts and X videos to one video at a time (ADR-4) through a pure state machine (ADR-5), count the blocks, and hide the feeds' entry points. Static `declarativeNetRequest` rulesets redirect direct loads.

## Architecture diagram
```
Chrome events (tabs, windows, idle, alarms)
        │
        ▼
service worker ── serialised queue ── pure engine (src/tracker) ──► storage.local  d:<day>, settings, log:<hour>
        ▲                                                   └──► storage.session  hot state
        │ blocked{site}, media{playing}            settings, pause, import, deleteAll, undoDelete
content scripts on instagram.com / youtube.com / facebook.com / x.com   ▲
  guard-core.ts → guard-machine.ts (pure steps; undo, swap, lock)     │
  guard-instagram.ts (+ tap watcher, post page, pop-up look-alike)    │
  guard-facebook.ts (+ Facebook's reel rule: its own Previous Card)   │
  instagram-router.ts (page world: Instagram's router, nothing else)  │
  media.ts (video/audio playing boolean)                popup ◄── aggregate (src/stats) ──► dashboard
  <site>.css (hide Reels/Shorts entry points)
declarativeNetRequest: five static rulesets for direct loads, enabled to match the blocker toggles
```

---

## Components

### Tracking engine
- **What it does:** reduces timestamped events into attributions; the counting rule lives here and nowhere else.
- **Location:** `src/tracker/`
- **Depends on:** nothing (pure).
- **Key files:** `engine.ts` (`reduce`, `replay`, `currentSite`, `createInitialState`), `inputs.ts` (applies one event to the state, media hold), `buckets.ts` (splits intervals at local hour boundaries), `grouping.ts` + `suffixes.ts` (eTLD+1 from a bundled suffix subset, overrides, ignore list, http(s) only), `records.ts` (own-key maps safe from prototype names), `replayLog.ts` (event log back to engine events, ADR-1).

### Service worker
- **What it does:** registers every Chrome listener, runs each job on one promise queue, seeds state from the live browser on start or after a gap, keeps the heartbeat (1 min) and prune (daily) alarms, authorises and handles messages, keeps the DNR rulesets and the idle interval in step with settings, and appends to the event log when it is on.
- **Location:** `src/background/`
- **Key files:** `index.ts` (entry), `listeners.ts`, `queue.ts` (KTD6), `events.ts` (Chrome payloads to engine events; a URL is reduced to its site), `reseed.ts` (KTD7), `state.ts` (hot state in storage.session), `alarms.ts`, `messages.ts` (parse, authorise, handle), `authorize.ts` (sender rules), `effects.ts` + `rulesets.ts` (settings to Chrome), `log.ts` (recorder).
- **Depends on:** tracker, store, blocker, shared.

### Store
- **What it does:** day keys, hot state, settings, 90-day prune, export, hardened import, delete with a 10 s in-memory undo, the optional 24-hour event ring.
- **Location:** `src/store/`
- **Key files:** `adapter.ts` (the one storage seam, with a memory fake for tests), `days.ts`, `prune.ts`, `export.ts` (larger-value merge, one write), `import.ts` (caps and validation), `validate.ts`, `delete.ts`, `log.ts`, `schema.ts`.

### Blocker
- **What it does:** a pure URL classifier, the one allowlist of redirect targets, five static DNR rulesets, the guard's state machine and its pure rules (viewer lock, undo, input lock, post page, pop-up sizing, the router bridge's protocol), and the hider stylesheets.
- **Location:** `src/blocker/` (`patterns.ts`, `targets.ts`, `decide.ts`, `viewer.ts`, `scroll.ts`, `post.ts`, `bridge.ts`, `guard-machine.ts`, `rulesets/*.json`), `src/content/*.css`
- **Depends on:** nothing at runtime except `chrome.runtime` and `chrome.storage` in the guard.

### Content scripts
- **What they do:** `guard-core.ts` runs the guard's state machine (ADR-5) and carries out its effects; `guard.ts` starts it on YouTube and X; `guard-instagram.ts` is Instagram's entry, adding the tap watcher (`instagram-open.ts`), the post page and its pop-up look-alike (`instagram-post.ts`, `instagram-pop-up.ts`) and the curtain over the page while Instagram swaps it (`curtain.ts`); `guard-facebook.ts` is Facebook's, giving the machine Facebook's reel rule and putting a moved viewer back with the viewer's own Previous Card; `viewer-lock.ts` is the input lock, and marks `<html>` with `data-dwell-viewer` while it holds a viewer so the site's CSS can hide that viewer's own next-video buttons; `media.ts` reports whether a `video` or `audio` element in the page is playing; `runtime.ts` is their only channel to the worker. Isolated world, `document_start`, top frame, the site host patterns only. One exception, Instagram only: `instagram-router.ts` runs in the page's own world (ADR-4), with no extension API, to ask Instagram's router to open a post.
- **Location:** `src/content/`

### UI
- **What it does:** the popup (360 x 560) and the hash-routed dashboard (week, day, settings, privacy; week and day take a validated `?site=` focus, the selected hour is page state, keys map to routes through the pure `src/dashboard/keys.ts`) in Preact, tokens from `design/DESIGN.md`, inline SVG charts; pure aggregation, week ranges, categories and formatting in `src/stats/`.
- **Location:** `src/popup/`, `src/dashboard/`, `src/shared/` (messages, settings validation, i18n, theme, fonts, shared components), `src/stats/`

### Checks and release
- **What they do:** `scripts/check-privacy.ts` greps `dist/` for network and dynamic-code tokens and compares the built manifest with `scripts/manifest-rules.ts`; `scripts/simulate.ts` writes 90 simulated days as an importable export; `scripts/screenshots.ts` captures `docs/screenshots/` from the built extension; `scripts/zip.ts` writes a deterministic store-only zip of `dist/` plus a per-file SHA-256 list; `.github/workflows/ci.yml` runs the gates on every push, `.github/workflows/release.yml` publishes a GitHub release on a `v*` tag.
- **Location:** `scripts/`, `.github/workflows/`

---

## Messages (content script, popup, dashboard → worker)

Every message is parsed by `parseMessage` (`src/shared/messages.ts`): a plain object with exactly the documented keys and types, copied before use. It is then authorised by `authorize` (`src/background/authorize.ts`).

| Type | Allowed sender | Payload |
|---|---|---|
| `blocked` | content script, only for the site its tab is on | `{ site: 'instagram' \| 'youtube' \| 'facebook' \| 'x' }` |
| `media` | content script | `{ playing: boolean, watched?: boolean }`: `watched` = playing with sound on a page on screen |
| `attention` | content script | `{ present: boolean }`: the page took trusted input outside Chrome's focus, or (false) the pointer left or the page hid; the worker reads the tab and window ids and the site from `sender.tab` |
| `settings` | extension pages only | `{ patch }`: any non-empty subset of `PATCH_KEYS`, each value checked by its parser in `PATCH_FIELDS`; an unknown key or a bad value rejects the whole message |
| `pause` | extension pages only | `{ paused: boolean }` |
| `import` | extension pages only | `{ text }`, at most 10 MB of characters, then the hardened import parser (2 MB) |
| `deleteAll` | extension pages only | none |
| `undoDelete` | extension pages only | none |

Sender rules, in order:
1. `sender.id` must be this extension's id; there is no `externally_connectable`, so web pages and other extensions cannot reach the worker.
2. A sender with a `frameId` other than 0 is refused: top frames only.
3. A sender URL under `chrome-extension://<id>/` is an extension page.
4. Otherwise the sender needs a tab whose URL is `https:` on one of the nine hosts (www, m and bare hosts of Instagram, YouTube and Facebook, and x.com); that host decides the sender's site.
5. A content script may send only `blocked`, `media` and `attention`; an extension page only the five page types.
6. A content script may only report blocks for its own site: a `blocked` message whose `site` differs from the sender's site is refused.

Refusal reasons name the rule that failed and never echo the sender URL. No content-script message carries a URL or a title.

---

## Data model

See `docs/project_spec.md`. One key per local day (`d:YYYY-MM-DD` → `{ sites: { <site>: { h: { <hour>: seconds }, v: visits } }, blocked: { instagram, youtube, facebook } }`); hours sparse; 90-day prune by date string comparison. Settings under `settings`. Hot state in storage.session.

- `log:YYYY-MM-DDTHH` (optional event log, off by default; UTC hour keys, last 24 h, at most 3,600 entries an hour): `{ at, kind, site?, win?, tab?, a? }` with `kind` from `LOG_KINDS`, integer window and tab ids, `a` the audible flag. Never in the data export; the separate event-log export is `dwell-event-log` version 2: the entries, the day records they cover, and a `settings` field `{ idleThresholdSec, mediaOverride }` captured at export time (ADR-1).

---

## Architecture decision records

The plan's Key Technical Decisions (KTD1 to KTD12) are the ADRs for this project. New decisions during implementation are appended here as `ADR-<n>: <title>` with context, options, decision and consequences.

### ADR-1: Replayable event log

- **Context:** KTD10 logged `{ at, kind, site }`, which loses window and tab identity, the audible flag, a seed's idle state and every browser restart, so a recorded day could not replay with identical totals (Definition of Done).
- **Options:** keep site-only entries and accept an approximate replay; log an engine-state snapshot per job (large, and holds more than the log needs); carry Chrome's integer ids and the audible flag in a closed kind list.
- **Decision:** the third. Entries are `{ at, kind, site?, win?, tab?, a? }`; `LOG_KINDS` is closed (16 event kinds plus `start`, written when the worker rebuilt a lost hot state). The guard in `src/store/log.ts` rejects any other field, `://`, `/`, `?`, a non-hostname site, a negative or non-integer id. `src/tracker/replayLog.ts` inverts `src/background/log.ts` and resets at `start`. The export is version 2 and adds the day records it covers and a `settings` field `{ idleThresholdSec, mediaOverride }` captured at export time.
- **Consequences:** a property test proves `replayLog(encode(events))` equals `replay(events)` on 1,500 generated sequences. `tests/engine.realday.test.ts` replays every owner export placed in `tests/fixtures/real/` (gitignored, since it names real domains) with the file's `settings` applied over the defaults, and requires each site's seconds per hour within 1 s and visits equal to the file's day records; it skips cleanly when the folder is empty. Version 1 files still read and replay approximately: one window holding one tab, `close` dropped, every seed active. Known limits: a replay is exact from a `start` entry on (a ring that began mid-session starts from an empty state); a host the day records cannot hold (`localhost`) logs as untracked; a settings change during the day is not logged, so such a day replays with the settings in force at export time; a clock set backwards replays in time order.

### ADR-2: One DNR redirect rule per host

- **Context:** a hard load of a Shorts address must become the watch page for the same id, which needs a `regexSubstitution` with a capture group for the 11-character id. The first YouTube ruleset used one regex with a host alternation (www, m, bare) plus the `{11}` capture. Chrome compiles DNR regexes with RE2 under a per-rule memory limit; this rule exceeded it, and Chrome dropped it at load without an error the extension could see, so Shorts hard loads went through. The unit tests, which use JavaScript `RegExp` as an approximation, could not see RE2's memory cap.
- **Options:** keep one rule and shorten the pattern (loses the anchored host check); `urlFilter` rules (no capture, so no same-video target); dynamic rules registered at runtime (more code, same limit); one static rule per host.
- **Decision:** one static rule per host for Shorts (`www.youtube.com`, `m.youtube.com`, `youtube.com`), each anchored, `https` only, `main_frame` only (top-level loads; ADR-3 says why not frames). The Reels and Explore rules have no capture group and fit under the limit with an optional `www.` or `m.` prefix, so each stays a single rule.
- **Consequences:** `tests/e2e/blocker.spec.ts` asks Chrome itself: `declarativeNetRequest.isRegexSupported` must accept every rule in all five rulesets, and `testMatchOutcome` on a table of URLs must match exactly the rulesets the pure classifier blocks. `tests/rulesets.test.ts` keeps the shape, target allowlist and loop-guard checks. A new host means a new rule.

### ADR-3: Blocks are counted by the content script, never by DNR

- **Context:** R17 counts Reels and Shorts redirects per site per day. A DNR redirect happens inside Chrome's network stack and the extension is not told about it.
- **Options:** `declarativeNetRequest.onRuleMatchedDebug` (works only for unpacked extensions and needs `declarativeNetRequestFeedback`); `getMatchedRules` (rate-limited, and needs `declarativeNetRequestFeedback` or `activeTab`, a permission beyond the declared list, which is a stop condition); count in the guard content script.
- **Decision:** the guard counts. An in-page block is cancelled and reported where it happens, with nothing added to any URL. A DNR hard-load redirect lands on a target carrying the fragment marker `#dwell=<site>`, used only for hard loads: the guard counts it once per navigation, treats it as a hint, and strips it with `history.replaceState` before the page's own scripts run. Fragments are never sent to servers or in a Referer, and no target carries a query parameter named `dwell`. The worker accepts `blocked` only for the sender's own site.
- **Consequences:** counting behaves the same unpacked and from the store, with no extra permission. The marker is always stripped, but counted only after the settings load and only while one of that site's blockers is on, so a hand-made link carrying it counts as one redirect for that site only while its blocker is on; the counts are information, not enforcement. The rules redirect `main_frame` only. The guard runs in the top frame alone (`all_frames: false`), so a redirected frame could be neither counted nor stripped and would show the site's home page inside someone else's page: a Reel or Short embedded in a third-party page is left alone. `tests/e2e/tracking.spec.ts` and `tests/e2e/blocker.spec.ts` cover the count-once, reload, strip-before-script and blocker-off cases; `tests/rulesets.test.ts` requires `main_frame` alone in every rule.

### ADR-4: One-video mode: a tapped Reel, Short or X video plays alone, and no feed scrolls on

- **Context:** after using v0.1.0 the owner asked for something other than blocking: open the one Reel or Short you tapped (from search, a profile, a message) and be unable to scroll on to the next one; the same for X; and, once that worked, with no page load, the way Instagram opens a post. Live tests drove five revisions on 2026-10-15; this record states where they ended, and git history (`30ab885` to `b1644a2`) holds the steps.
- **Options:** (a) keep cancelling every Reel; (b) lock each site's own viewer everywhere; (c) send each video to a page of the site that plays only it, keep a locked viewer only where no such page exists, and on Instagram work through its own router.
- **Decision:** (c), in five parts.
  1. **Single-video pages.** YouTube `/shorts/<id>` goes to `/watch?v=<id>`, X `/…/status/<id>/video/<n>` to the tweet, and Instagram's Reels scroller `/reels/<code>` to `/p/<code>/`. Feeds with no id go home. A single Instagram Reel (`/reel/<code>`, which Instagram shows as a post) and a profile's Reels grid load untouched; an `allow` rule at priority 1 keeps the five rulesets in the classifier's order. DNR handles direct loads.
  2. **Viewers kept to one video** (Facebook `/reel/<id>`, and any viewer a tab reaches anyway): the input lock swallows the wheel, arrow and page keys and vertical swipes unless a panel under the pointer can take them (a scroller counts as the feed when a video fills at least half of it), and a move to another video is undone. On Facebook the viewer's Next Card and Previous Card buttons are hidden while a viewer is held (English and French labels), so nothing on screen advances it.
  3. **A single-page app's own navigation is never just cancelled.** A cancelled `pushState` keeps the URL while the app has already drawn the new route, and Instagram's router also records the cancelled route against the history entry, so Back restores it. So a move inside a viewer commits and is undone with `history.back()` (at most 2 per tab in 5 s, then a reload, then a bare cancel); a feed loads home; on Instagram a same-document move bound for a post commits and Instagram's router replaces that entry with the post (`swap`); on Facebook a reel move (Facebook moves its viewer by replacing the address, so Back cannot take it away) commits and the guard clicks the viewer's own Previous Card, which puts the first reel back in the same document: the reel opened is the viewer's first card, so one step back is always that reel. While a swap is on its way the anchor stays on the page before the move, so the swap's own way back is no new move. Only a move that loads a new document, or a Facebook page with no Previous Card in a language the guard knows (or one whose click does not move the viewer within 250 ms), is cancelled or loaded. Where moves are put back in place, a viewer move the loop guard refuses is not cancelled either, since a cancel leaves the site drawing the next video under the first one's address: it commits, and the guard's one re-check puts it back once a load is admitted, within 5 s. Facebook's router, reachable like Instagram's, was measured and rejected: it changes the address to the first reel but leaves the viewer drawing the next one.
  4. **Instagram, in the same document.** Instagram's router (Meta's Comet) is reachable only from the page's own world, so one script runs there, `src/content/instagram-router.ts`: Instagram only, alone in its manifest entry, the only script outside the isolated world (`scripts/manifest-rules.ts` allows exactly that). On the guard's `dwell:open-post` event it opens `/p/<code>/`: with `target: "content"`, Instagram's own pop-up, when the page hosts one; as an in-app page or a replacing navigation otherwise; it answers `pop-up`, `page` or `refused` on `<html>`, and `refused` falls back to the rules above. A tap on a Reel's own link asks for the pop-up before Instagram's handler runs and stops that handler only when it opened. A page script firing the event can only open an Instagram post, which it could do without Dwell.
  5. **A post shown on a page of its own** (loaded directly, or opened in place) is drawn like Instagram's pop-up: the card centred at the window's height less 24 px, at the video's own shape plus a 405 px comments column, never wider than the window less 64 px a side; everything else dimmed to 35 % and unclickable, Instagram's own dialogs and menus excepted; closed by a button, Escape outside a text field, or a click outside, which goes Back (within the document when Dwell opened it there). The "More posts" grid under a post is hidden, found by link structure, never by text.
- **Consequences:** one page-world script, held to the narrowest rule the manifest check can state. Verified live, signed out: the rewrites, the "More posts" hider, the in-place open, the swap and a close that stays in the same document (one document load end to end); on Facebook, the wheel, ArrowDown and `j` do not move the viewer even without Dwell and a reel replays at its end, its Next Card is the one control that moves it, and four forced moves in a row were each put back to the same reel, caption and address, with one document load in all (the next reel is drawn for one frame before it is put back). Not verified: signed-in Instagram's pop-up, signed-in Facebook and X's viewers (the owner's checklist). Counting: a load counts on landing by its marker (ADR-3); an in-place open or an undo counts in place. The Instagram rule's code has no upper length, because Chrome's RE2 refuses any bounded repeat of that class in a DNR rule (`memoryLimitExceeded`).

### ADR-5: The guard is a pure state machine with one navigation trigger

- **Context:** after ADR-4's revisions the guard kept its state in module variables changed from seven entry points (navigate, `popstate`, `yt-navigate-finish`, a 250 ms poll, two storage callbacks, the Instagram tap), and none of it was in unit coverage. Instagram-only code was parsed on every site.
- **Options:** (a) keep the hand-wired guard; (b) move every decision into a pure machine and keep the content script as an adapter.
- **Decision:** (b). `src/blocker/guard-machine.ts` is `step(state, input) → { state, effects }` for a navigation, a committed URL, settings, a deadline and an Instagram open; effects are data the adapter carries out (cancel, count, load, back, later, save a log, hider, sync). `src/content/guard-core.ts` is the core adapter on every site, started by the entries `guard.ts` (YouTube, X), `guard-instagram.ts`, which adds Instagram's pieces through hooks and gives the machine Instagram's post rule as data, and `guard-facebook.ts`, which gives it Facebook's reel rule the same way; with no post rule the machine never swaps a move for a post or keeps a pop-up to one post, so the other sites' bundle carries no post paths. A load passes its mode to the site: on Instagram a `replace` becomes the router's replacing navigation, so the entry it replaces is not left under the post. One `navigation.currententrychange` listener replaces the poll, `popstate` and `yt-navigate-finish`, which needs Chrome 111 (the manifest rules require `minimum_chrome_version` 111). Before the settings load nothing moves, but the input lock and the hiders follow the default toggles.
- **Consequences:** nothing runs on a schedule while nothing happens (it was 4 wake-ups a second per tab). `guard.js` on YouTube and X is 16.4 KB (was 20.7 KB) and carries no Instagram rule; `guard-instagram.js` is 26.0 KB, `guard-facebook.js` 16.7 KB. The machine has full line coverage under 60 tests. An orphaned guard (the extension reloaded) lets go at its next event rather than within 250 ms. Chrome before 111 is not supported.

### ADR-6: Presence follows attention, not only window focus

- **Context:** on Windows a window without focus still scrolls under the pointer, and a video can play on a second screen while another app has focus. KTD2 counted only the focused window's active tab, so the owner's hover-scrolled Instagram feed and a video watched beside other work counted nothing.
- **Options:** (a) keep focus-only; (b) count Chrome's audible tab in any window; (c) let the content scripts report input the page takes and playback that is on screen, and rank presence; (d) add content scripts on every site.
- **Decision:** (c). Presence at any instant is the first of: the page holding attention, for 20 s after its last trusted wheel, key, click or touch taken outside focus (two ping periods, so steady scrolling keeps it); the focused window's active tab (KTD2, unchanged); the page holding attention for the rest of the idle threshold; a window's active tab whose media plays with sound on a page that is visible or in picture-in-picture, first by window id (with the media setting, 30 s hold); requiring the active tab means a page that can no longer report stops at the next tab switch. Attention ends when the pointer leaves the page or the page hides (the script says so), when another Chrome window gets focus, when its own window shows another tab, and when the tab leaves its site or closes. Another app taking focus caps it at 20 s past its last input instead of ending it: Alt-Tab moves no pointer, and a page still being scrolled renews it with no gap while the script's throttle runs. Attention never changes which tab the engine holds as active. Locked and paused always win. An interval is split between ranks as they run out. A fresh or rebuilt state also learns every window's active tab, so a page in a window never focused is known. The content script sends attention at most every 10 s and only while its page lacks focus, so focused browsing sends nothing new. (b) was rejected because Chrome cannot say whether a window is on screen, so music left behind other windows would count; (d) because it needs access to every site, a permission change.
- **Consequences:** the engine state gains an optional `attention` slot and media a `watched` flag; three log kinds (`media-watched`, `attention-on`, `attention-off`) keep the log lossless, and older logs and hot states still read. The oracle ranks the same way and the engine equals it on the generated sequences. Known costs: after hover-scrolling, typing in another app counts the page up to the idle threshold, and typing in a focused Chrome window up to 20 s; a muted video watched without focus counts only while its page takes input; sites without a script keep focus-only counting.
