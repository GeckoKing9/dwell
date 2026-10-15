# Dwell: project status

Last session: 2026-10-15. The MVP is on `main`. One-video mode (ADR-4) and X as a fourth site were built on `feature/one-video-mode` at the owner's request after a first look at v0.1.0. v0.1.0 has not been tagged; what remains is the owner's checklist below, one real day, and the tag.

## State

- Tracking: pure engine with an oracle-checked simulation suite; service worker with one serialised queue, live reseed after gaps, heartbeat and prune alarms, sender authorisation.
- Storage: day records, 90-day prune, export, hardened import, delete with 10 s undo, optional 24-hour event log that replays exactly (ADR-1).
- One-video mode (ADR-4): a Short opens on the watch page, an X video on its tweet, Instagram's Reels scroller on the post; Facebook's viewer is held to its first reel. On Instagram a tapped Reel opens in Instagram's own pop-up, or as the post in the same page framed like it, through Instagram's router via the one page-world script; nothing reloads and closing goes back in the same document. No app navigation is just cancelled. The guard is a pure state machine (ADR-5) with one navigation trigger and no timers; Instagram's pieces load only on Instagram.
- Sites: Instagram, YouTube, Facebook, and X (`https://x.com/*`, added 2026-10-15). Settings from before X read the missing switch as on.
- UI: popup and dashboard (week, day, settings, privacy) from the design pass, light and dark.
- Release: `npm run zip` writes a deterministic zip and a per-file SHA-256 list; `.github/workflows/release.yml` publishes them on a `v*` tag. Screenshots in `docs/screenshots/` come from `npm run screenshots` (they predate the X switch).
- Defaults shipped: media override on; idle 60 s; one-video mode on for all four sites; Explore blocking off; Monday weeks; visits counted; event log off; English UI; unpacked install.

## Gates

Last run 2026-10-15 on `refactor/blocker-cleanup` before its merge.

| Gate | Command | Last result |
|---|---|---|
| Typecheck | `npm run typecheck` | 0 errors |
| Lint | `npm run lint` | 0 problems |
| Unit and simulation | `npm test` | 1431 passed, 1 skipped (the real-day replay, no real export present). Coverage: statements 98.17%, branches 96.12%, lines 98.49%; `src/content` (DOM adapters) is excluded, the guard's decisions are in `src/blocker/guard-machine.ts` at full line coverage |
| Time zones | `npm run test:tz` | 1431 of 1431 under each of UTC, America/Toronto, Asia/Kolkata, Australia/Lord_Howe |
| Privacy bundle | `npm run check:privacy` | passed: 21 files scanned, manifest matches the declared list (one page-world script, Instagram only; Chrome 111+) |
| Build | `npm run build` | guard.js 16.0 KB (YouTube, Facebook, X), guard-instagram.js 23.7 KB, instagram-router.js 1.6 KB, media.js 0.9 KB |
| Real browser | `npm run test:e2e` | 87 passed, headless Chromium with the extension loaded, site hosts served by fixtures (Instagram's with a router that remembers each entry's route, as Comet does) |
| Live sites, signed out | scratch probes, 2026-10-15 | Instagram's router moving to the Reels scroller is replaced by the post in the same document, framed as a pop-up; closing goes back to the profile and stays; one document load end to end. YouTube Shorts land on the watch page. Signed-in Instagram, Facebook and X not checked live |
| Dependencies | `npm audit --audit-level=high` | 0 vulnerabilities |
| Audit | independent staff-level audit, 2026-10-15 | 9 findings: 8 fixed on `refactor/blocker-cleanup`; one declined (a single redirect limit would leave a third move to a bare cancel) |

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
