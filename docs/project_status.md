# Dwell: project status

Last session: 2026-10-15. The MVP is on `main`. One-video mode (ADR-4) and X as a fourth site were built on `feature/one-video-mode` at the owner's request after a first look at v0.1.0. v0.1.0 has not been tagged; what remains is the owner's checklist below, one real day, and the tag.

## State

- Tracking: pure engine with an oracle-checked simulation suite; service worker with one serialised queue, live reseed after gaps, heartbeat and prune alarms, sender authorisation.
- Storage: day records, 90-day prune, export, hardened import, delete with 10 s undo, optional 24-hour event log that replays exactly (ADR-1).
- One-video mode (ADR-4): a tapped Reel, Short or X video opens on a page that plays only that video (Instagram `/p/`, YouTube watch page, the tweet page on X); Facebook's own viewer is locked to the reel it opened on (URL lock plus a wheel, key and touch lock). Feeds with no id go home; search, posts and profile Reels grids load. One DNR rule set per site (ADR-2), counts from the content script only (ADR-3), hider stylesheets.
- Sites: Instagram, YouTube, Facebook, and X (`https://x.com/*`, added 2026-10-15). Settings from before X read the missing switch as on.
- UI: popup and dashboard (week, day, settings, privacy) from the design pass, light and dark.
- Release: `npm run zip` writes a deterministic zip and a per-file SHA-256 list; `.github/workflows/release.yml` publishes them on a `v*` tag. Screenshots in `docs/screenshots/` come from `npm run screenshots` (they predate the X switch).
- Defaults shipped: media override on; idle 60 s; one-video mode on for all four sites; Explore blocking off; Monday weeks; visits counted; event log off; English UI; unpacked install.

## Gates

Last run 2026-10-15 on `feature/one-video-mode` at `f2e36f5`.

| Gate | Command | Last result |
|---|---|---|
| Typecheck | `npm run typecheck` | 0 errors |
| Lint | `npm run lint` | 0 problems |
| Unit and simulation | `npm test` | 1243 passed, 1 skipped (the real-day replay, no real export present). Coverage: statements 98.03%, branches 95.92%, functions 97.26%, lines 98.37% |
| Time zones | `npm run test:tz` | 1243 of 1243 under each of UTC, America/Toronto, Asia/Kolkata, Australia/Lord_Howe |
| Privacy bundle | `npm run check:privacy` | passed: 19 files scanned, manifest matches the declared list |
| Build | `npm run build` | built |
| Real browser | `npm run test:e2e` | 54 passed, headless Chromium with the extension loaded, site hosts served by fixtures |
| Live sites, logged out | scratch probe, 2026-10-15 | Instagram `/reels/<code>/`, `/reel/<code>/`, `/<user>/reel/<code>/` land on `/p/<code>/` with one video, and wheel plus arrow keys leave the URL alone; `/reels/` goes home; a profile Reels grid loads; YouTube `/shorts/<id>` lands on the watch page and stays. Facebook and X need a login and were not checked live |
| Dependencies | `npm audit --audit-level=high` | 0 vulnerabilities |
| Release | `npm run zip` | built |
| Code review | `/code-review high` on `main...HEAD` | 10 findings: 8 fixed in `f2e36f5`; the Facebook lock target stays on `www.facebook.com` (desktop Chrome opens reels there), and the late-attach listener order is documented, with the URL lock as backstop |
| Security check | `!/security-check` | clean; `eslint-plugin-security` not installed, so that scan was not run |

## Manual checklist (owner)

What only the operating system and the live, logged-in sites can show. Tick each box with the date and what you saw. Reload the extension and any open Instagram, YouTube, Facebook and X tabs first: content scripts do not reach tabs opened before an install or reload.

- [ ] Blur the window 10 s: no site gains more than 1 s
- [ ] Lock the screen with a video playing: counting stops
- [ ] Close the lid 10 min: at most 60 s attributed
- [ ] Focus an incognito window: nothing recorded
- [ ] Instagram: tap a Reel in the feed, on a profile and from search; each opens alone on its post page and scrolling does not reach another Reel. The Reels tab goes home
- [ ] YouTube: tap a Short (search, a channel); it opens on the watch page with no Shorts scroller. Shorts shelves are hidden on home
- [ ] Facebook: open a reel; scrolling, arrow keys and the next button do not move to another reel (if one shows, the tab returns to the first). Comments still scroll
- [ ] X: open a video in a tweet; it plays on the tweet page and X's full-screen video feed never starts

## Next

1. Owner runs the checks above in Chrome with `C:\Users\CRdup\dwell-dist` loaded unpacked and ticks them here. Facebook and X are the two that were never seen live.
2. Owner uses Dwell for one real day with the event log on, exports it into `tests/fixtures/real/` and runs `npm test`: the popup should match recollection and the replay should pass (Definition of Done).
3. Tag `v0.1.0` on `main` and push the tag; the release workflow builds, tests and attaches the zip and hash list.

<!-- session-end:auto -->
**Last session (2026-10-15, coding):** Dwell MVP built in units U1-U11, 21 review findings fixed, merged to main with CI green; handoff/ folder created; dist copied to C:\Users\CRdup\dwell-dist.
**Next:** Run manual checklist on real Chrome, then tag v0.1.0.
<!-- /session-end:auto -->
