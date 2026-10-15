# Architecture — Dwell

Last updated: 2026-10-14
Status: MVP built (U1 to U10); release packaging in place, owner checklist pending

---

## System overview
Dwell is a Chrome Manifest V3 extension with no server. A service worker turns Chrome's tab, window, idle and alarm events into per-site time attributions through a pure engine, stores them per local day, and serves a popup and a dashboard page that compute everything they show from those keys. Content scripts on three sites report media state, cancel navigations to Reels and Shorts, count the blocks, and hide their entry points. Static `declarativeNetRequest` rulesets redirect direct loads.

## Architecture diagram
```
Chrome events (tabs, windows, idle, alarms)
        │
        ▼
service worker ── serialised queue ── pure engine (src/tracker) ──► storage.local  d:<day>, settings, log:<hour>
        ▲                                                   └──► storage.session  hot state
        │ blocked{site}, media{playing}            settings, pause, import, deleteAll, undoDelete
content scripts on instagram.com / youtube.com / facebook.com         ▲
  guard.ts (Navigation API cancel, fallbacks, #dwell landing count)   │
  media.ts (video/audio playing boolean)                popup ◄── aggregate (src/stats) ──► dashboard
  <site>.css (hide Reels/Shorts entry points)
declarativeNetRequest: four static rulesets for direct loads, enabled to match the blocker toggles
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
- **What it does:** a pure URL classifier, the one allowlist of redirect targets, four static DNR rulesets, the in-page guard and the hider stylesheets.
- **Location:** `src/blocker/` (`patterns.ts`, `targets.ts`, `rulesets/*.json`), `src/content/guard.ts`, `src/content/*.css`
- **Depends on:** nothing at runtime except `chrome.runtime` and `chrome.storage` in the guard.

### Content scripts
- **What they do:** `guard.ts` cancels or replaces blocked navigations and reports `blocked`; `media.ts` reports whether a `video` or `audio` element in the page is playing; `runtime.ts` is their only channel to the worker. Isolated world, `document_start`, top frame, the eight host patterns only.
- **Location:** `src/content/`

### UI
- **What it does:** the popup (360 x 560) and the hash-routed dashboard (week, day, settings, privacy) in Preact, tokens from `design/DESIGN.md`, inline SVG charts; pure aggregation, week ranges, categories and formatting in `src/stats/`.
- **Location:** `src/popup/`, `src/dashboard/`, `src/shared/` (messages, settings validation, i18n, theme, fonts, shared components), `src/stats/`

### Checks and release
- **What they do:** `scripts/check-privacy.ts` greps `dist/` for network and dynamic-code tokens and compares the built manifest with `scripts/manifest-rules.ts`; `scripts/simulate.ts` writes 90 simulated days as an importable export; `scripts/screenshots.ts` captures `docs/screenshots/` from the built extension; `scripts/zip.ts` writes a deterministic store-only zip of `dist/` plus a per-file SHA-256 list; `.github/workflows/ci.yml` runs the gates on every push, `.github/workflows/release.yml` publishes a GitHub release on a `v*` tag.
- **Location:** `scripts/`, `.github/workflows/`

---

## Messages (content script, popup, dashboard → worker)

Every message is parsed by `parseMessage` (`src/shared/messages.ts`): a plain object with exactly the documented keys and types, copied before use. It is then authorised by `authorize` (`src/background/authorize.ts`).

| Type | Allowed sender | Payload |
|---|---|---|
| `blocked` | content script, only for the site its tab is on | `{ site: 'instagram' \| 'youtube' \| 'facebook' }` |
| `media` | content script | `{ playing: boolean }` |
| `settings` | extension pages only | `{ patch }`: any non-empty subset of `PATCH_KEYS`, each value checked by its parser in `PATCH_FIELDS`; an unknown key or a bad value rejects the whole message |
| `pause` | extension pages only | `{ paused: boolean }` |
| `import` | extension pages only | `{ text }`, at most 10 MB of characters, then the hardened import parser (2 MB) |
| `deleteAll` | extension pages only | none |
| `undoDelete` | extension pages only | none |

Sender rules, in order:
1. `sender.id` must be this extension's id; there is no `externally_connectable`, so web pages and other extensions cannot reach the worker.
2. A sender with a `frameId` other than 0 is refused: top frames only.
3. A sender URL under `chrome-extension://<id>/` is an extension page.
4. Otherwise the sender needs a tab whose URL is `https:` on one of the eight hosts (www, m and bare hosts of the three sites); that host decides the sender's site.
5. A content script may send only `blocked` and `media`; an extension page only the five page types.
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
- **Consequences:** `tests/e2e/blocker.spec.ts` asks Chrome itself: `declarativeNetRequest.isRegexSupported` must accept every rule in all four rulesets, and `testMatchOutcome` on a table of URLs must match exactly the rulesets the pure classifier blocks. `tests/rulesets.test.ts` keeps the shape, target allowlist and loop-guard checks. A new host means a new rule.

### ADR-3: Blocks are counted by the content script, never by DNR

- **Context:** R17 counts Reels and Shorts redirects per site per day. A DNR redirect happens inside Chrome's network stack and the extension is not told about it.
- **Options:** `declarativeNetRequest.onRuleMatchedDebug` (works only for unpacked extensions and needs `declarativeNetRequestFeedback`); `getMatchedRules` (rate-limited, and needs `declarativeNetRequestFeedback` or `activeTab`, a permission beyond the declared list, which is a stop condition); count in the guard content script.
- **Decision:** the guard counts. An in-page block is cancelled and reported where it happens, with nothing added to any URL. A DNR hard-load redirect lands on a target carrying the fragment marker `#dwell=<site>`, used only for hard loads: the guard counts it once per navigation, treats it as a hint, and strips it with `history.replaceState` before the page's own scripts run. Fragments are never sent to servers or in a Referer, and no target carries a query parameter named `dwell`. The worker accepts `blocked` only for the sender's own site.
- **Consequences:** counting behaves the same unpacked and from the store, with no extra permission. The marker is always stripped, but counted only after the settings load and only while one of that site's blockers is on, so a hand-made link carrying it counts as one redirect for that site only while its blocker is on; the counts are information, not enforcement. The rules redirect `main_frame` only. The guard runs in the top frame alone (`all_frames: false`), so a redirected frame could be neither counted nor stripped and would show the site's home page inside someone else's page: a Reel or Short embedded in a third-party page is left alone. `tests/e2e/tracking.spec.ts` and `tests/e2e/blocker.spec.ts` cover the count-once, reload, strip-before-script and blocker-off cases; `tests/rulesets.test.ts` requires `main_frame` alone in every rule.

### ADR-4: One-video mode replaces blocking for Reels, Shorts and X videos

- **Context:** after using v0.1.0 the owner asked for something different from blocking: open the one Reel or Short you tapped (from search, a profile, a message) and be unable to scroll on to the next one. The same was asked for X. The scroll feed is the habit; a single video is not.
- **Options:** (a) keep cancelling every Reel; (b) lock the site's own viewer everywhere by swallowing the wheel, arrow keys and touch moves; (c) rewrite each video to a page of the site that plays only that video, and lock the viewer only where no such page exists.
- **Decision:** (c). YouTube `/shorts/<id>` goes to `/watch?v=<id>`, Instagram `/reel(s)/<code>` to `/p/<code>/`, X `/…/status/<id>/video/<n>` to the tweet page; checked live with no login on 2026-10-15 for YouTube and Instagram (one `<video>`, and scrolling and arrow keys leave the URL alone). Facebook has no verified single-video page, so `/reel/<id>` keeps its own viewer, locked to the first reel (`src/blocker/viewer.ts`, `src/content/viewer-lock.ts`): a move to another reel is cancelled and the tab goes back to the first one, reloading it, because a viewer can draw the next reel before it changes the URL. The same lock covers any viewer a tab reaches when the loop guard refuses a rewrite. Feeds with no id still go home; a profile's Reels grid loads, like search.
- **Consequences:** (b) alone would also stop the comments panel from scrolling and would break with every redesign; the lock lets a wheel through only when a non-snapping panel under the pointer can still scroll that way. X and logged-in Facebook could not be checked here and are on the owner's manual list. Counting is unchanged: a rewrite or a lock counts once, on landing, by the marker (ADR-3). The Instagram rule's code has no upper length because Chrome's RE2 refuses any bounded repeat of that class in a DNR rule (`memoryLimitExceeded`).
- **Amendment (2026-10-15):** three changes after the owner used the build. (1) A tapped Instagram Reel should look like Instagram's own post pop-up (video left, comments right, over the page you were on), not a full load of `/p/<code>/` with "More posts from" under it. So `/reel/<code>` (also under a profile) is no longer rewritten: the classifier leaves it alone and the Instagram Reels ruleset gains an `allow` rule for it at priority 1, which beats that ruleset's feed redirect at equal priority. Explore moves to priority 2 and the `/reels/<code>` rewrite to 3, so the five rulesets together keep the classifier's order (`tests/rulesets.test.ts` checks them combined). Only the Reels scroller `/reels/<code>` is still rewritten. On a full single-post page the guard marks every element after the post, when at least three links to other posts follow it, and hides them; only the page the document was loaded on counts, and a pop-up holding the post (a dialog with a video, an article or a link to the post) leaves the page behind it alone. It reads link addresses and structure, never text. (2) Cancelling alone does not stop a single-page app: a cancelled `pushState` keeps the old URL while the app's router has already drawn the new route. So an in-app move to a feed now loads the home page (a bare cancel only when the loop guard refuses), and a viewer move, or a rewrite whose target is the page already open, that arrives as a same-document push is undone: the push commits and `history.back()` on the next task lets the site's router draw the previous page, with no reload, at most 2 undos per tab in 5 s under their own sessionStorage log. A replace, a traverse, a cross-document move or a refused undo keeps the cancel-and-reload path. Back stays in the same document and loads nothing, so it needs no allowlist target. (3) The input lock never treats a scroller holding a video at least half its height as a comments panel, because Facebook's viewer may scroll without scroll-snap (a GIF in a comment does not count); and its key listener is attached once at document_start, ahead of the page's own. A single Instagram Reel is not input-locked, so its own page and the pop-up scroll; only a move to another Reel is undone.
- **Amendment 2 (2026-10-15):** Instagram opens a Reel tapped in search in its Reels feed, which Dwell sends to the post's own page, and the owner wanted the pop-up there too. Instagram's real pop-up can only be opened by Instagram's own router (Comet) and the post page refuses framing (`X-Frame-Options: DENY`), so `src/content/instagram-pop-up.ts` draws the same thing around the page Instagram already drew: on a video post loaded on its own page, the card is fixed in the middle at the window's height less 24 px and the video's own shape plus a 405 px comments column (`popUpBox`, never wider than the window less 64 px a side so the close button stays clear), its ancestors stop forming stacking contexts, everything beside them is dimmed to 35 % and unclickable, and the bare page takes its own background dimmed the same. Close (button, Escape outside a text field, a click on the dimmed page) goes back when the post was opened from Instagram and the tab can go back (`navigation.canGoBack`), else lifts the pop-up until the post is left. Instagram's own dialogs and menus are never dimmed; a window too narrow for the video beside the comments shows the page as Instagram drew it. Checked live, logged out, at 1600x960 in both themes: video 513 px wide at 9:16, comments 405 px, a click inside stays, a click outside goes back.
