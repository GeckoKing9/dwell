# Dwell: project status

Last session: 2026-10-15. The MVP is on `main`. One-video mode (ADR-4) and X as a fourth site were built on `feature/one-video-mode` at the owner's request after a first look at v0.1.0. v0.1.0 has not been tagged; what remains is the owner's checklist below, one real day, and the tag.

## State

- Tracking: pure engine with an oracle-checked simulation suite; service worker with one serialised queue, live reseed after gaps, heartbeat and prune alarms, sender authorisation.
- Storage: day records, 90-day prune, export, hardened import, delete with 10 s undo, optional 24-hour event log that replays exactly (ADR-1).
- One-video mode (ADR-4 and its amendment): a single Instagram Reel opens in Instagram's own pop-up; one loaded from a link shows on its own with the "More posts" grid hidden; the Reels scroller (`/reels/`) is rewritten to the post page; YouTube Shorts open on the watch page and are hidden everywhere, search included; an X video opens on its tweet; Facebook's viewer is locked to the reel it opened on (wheel, keys and swipes swallowed; a move undone by Back, a reload only as the last resort). Blocked in-app moves never rely on cancelling alone, since a single-page app draws the new screen anyway. One DNR rule set per site (ADR-2), counts from the content script only (ADR-3), hider stylesheets.
- Sites: Instagram, YouTube, Facebook, and X (`https://x.com/*`, added 2026-10-15). Settings from before X read the missing switch as on.
- UI: popup and dashboard (week, day, settings, privacy) from the design pass, light and dark.
- Release: `npm run zip` writes a deterministic zip and a per-file SHA-256 list; `.github/workflows/release.yml` publishes them on a `v*` tag. Screenshots in `docs/screenshots/` come from `npm run screenshots` (they predate the X switch).
- Defaults shipped: media override on; idle 60 s; one-video mode on for all four sites; Explore blocking off; Monday weeks; visits counted; event log off; English UI; unpacked install.

## Gates

Last run 2026-10-15 on `feature/modal-and-undo` before its merge.

| Gate | Command | Last result |
|---|---|---|
| Typecheck | `npm run typecheck` | 0 errors |
| Lint | `npm run lint` | 0 problems |
| Unit and simulation | `npm test` | 1316 passed, 1 skipped (the real-day replay, no real export present). Coverage: statements 98.05%, branches 95.98%, lines 98.39% |
| Time zones | `npm run test:tz` | 1316 of 1316 under each of UTC, America/Toronto, Asia/Kolkata, Australia/Lord_Howe |
| Privacy bundle | `npm run check:privacy` | passed: 19 files scanned, manifest matches the declared list |
| Build | `npm run build` | built |
| Real browser | `npm run test:e2e` | 69 passed, headless Chromium with the extension loaded, site hosts served by fixtures with small routers that draw on push and on Back |
| Live sites, logged out | scratch probe, 2026-10-15 | Instagram `/p/<code>/` and `/reel/<code>/` show the post alone with "More posts" hidden; `/reels/<code>/` lands on `/p/<code>/`; YouTube `/shorts/<id>` lands on the watch page. Facebook, X and Instagram's logged-in pop-up need a login and were not checked live |
| Dependencies | `npm audit --audit-level=high` | 0 vulnerabilities |
| Code review | `/code-review high` on each branch | one-video mode: 10 findings, 8 fixed; pop-up and undo: 10 findings, 7 fixed, 3 shown not to occur (a test now guards the push-then-replace case) |
| Security check | `!/security-check` | clean; `eslint-plugin-security` not installed, so that scan was not run |

## Manual checklist (owner)

What only the operating system and the live, logged-in sites can show. Tick each box with the date and what you saw. Reload the extension and any open Instagram, YouTube, Facebook and X tabs first: content scripts do not reach tabs opened before an install or reload.

- [ ] Blur the window 10 s: no site gains more than 1 s
- [ ] Lock the screen with a video playing: counting stops
- [ ] Close the lid 10 min: at most 60 s attributed
- [ ] Focus an incognito window: nothing recorded
- [ ] Instagram: tap a Reel in search, on a profile, in the feed and in a message; each opens in Instagram's own pop-up over the page, with no page load, and scrolling does not reach another Reel. A Reel opened from a link outside Instagram shows as Dwell's look-alike pop-up. The Reels tab goes home
- [ ] YouTube: no Shorts on home, in search or beside a video; a Short opened from a link plays on the watch page with no Shorts scroller
- [ ] Facebook: open a reel; the wheel, arrow keys and swipes do not move to another reel; the on-screen next button, if it moves, comes straight back without a page reload. Comments still scroll
- [ ] X: open a video in a tweet; it plays on the tweet page and X's full-screen video feed never starts
- [ ] Toolbar: Dwell shows the hourglass, not a grey "D"

## Next

1. Owner runs the checks above in Chrome with `%LOCALAPPDATA%\Dwell\extension` loaded unpacked and ticks them here. Facebook and X are the two that were never seen live.
2. Owner uses Dwell for one real day with the event log on, exports it into `tests/fixtures/real/` and runs `npm test`: the popup should match recollection and the replay should pass (Definition of Done).
3. Tag `v0.1.0` on `main` and push the tag; the release workflow builds, tests and attaches the zip and hash list.

<!-- session-end:auto -->
**Last session (2026-10-15, coding):** Dwell MVP built in units U1-U11, 21 review findings fixed, merged to main with CI green; handoff/ folder created; dist copied to C:\Users\CRdup\dwell-dist.
**Next:** Run manual checklist on real Chrome, then tag v0.1.0.
<!-- /session-end:auto -->
