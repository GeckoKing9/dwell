# Dwell: project status

Last session: 2026-10-15. The MVP is on `main`. One-video mode (ADR-4) and X as a fourth site were built on `feature/one-video-mode` at the owner's request after a first look at v0.1.0. v0.1.0 has not been tagged; what remains is the owner's checklist below, one real day, and the tag.

## State

- Tracking: presence follows attention (ADR-6): a page scrolled without focus on the four script sites, then the focused window's active tab, then a video with sound on screen in any window; pure engine with an oracle-checked simulation suite; service worker with one serialised queue, live reseed after gaps, heartbeat and prune alarms, sender authorisation.
- Storage: day records, 90-day prune, export, hardened import, delete with 10 s undo, optional 24-hour event log that replays exactly (ADR-1).
- One-video mode (ADR-4): a Short opens on the watch page, an X video on its tweet, Instagram's Reels scroller on the post; Facebook's viewer is held to its first reel: its card buttons are hidden and a move made anyway is put back with its own Previous Card, with no reload. On Instagram a tapped Reel opens in Instagram's own pop-up, or as the post in the same page framed like it, through Instagram's router via the one page-world script; nothing reloads, a curtain covers the page while Instagram swaps it, and closing fades the card out and goes back in the same document. No app navigation is just cancelled. The guard is a pure state machine (ADR-5) with one navigation trigger and no timers; Instagram's and Facebook's pieces load only on their own site.
- Sites: Instagram, YouTube, Facebook, and X (`https://x.com/*`, added 2026-10-15). Settings from before X read the missing switch as on.
- UI: popup and dashboard (week, day, settings, privacy) from the design pass, light and dark. The dashboard follows one site across weeks and days (`?site=` in the address), lists every site of a selected hour, has This week / Today, Left/Right/T/Esc keys, and bars that move instead of jumping.
- Release: `npm run zip` writes a deterministic zip and a per-file SHA-256 list; `.github/workflows/release.yml` publishes them on a `v*` tag. Screenshots in `docs/screenshots/` come from `npm run screenshots` (they predate the X switch).
- Defaults shipped: media override on; idle 60 s; one-video mode on for all four sites; Explore blocking off; Monday weeks; visits counted; event log off; English UI; unpacked install.

## Gates

Last run 2026-10-27 on `feature/attention-and-dashboard` before its merge.

| Gate | Command | Last result |
|---|---|---|
| Typecheck | `npm run typecheck` | 0 errors |
| Lint | `npm run lint` | 0 problems |
| Unit and simulation | `npm test` | 1591 passed, 1 skipped (the real-day replay, no real export present). Coverage: statements 98.37%, branches 96.14%. The engine equals the ranked oracle on 2,000 sequences at 1 s and 500 at 100 ms |
| Time zones | `npm run test:tz` | 1591 of 1591 under each of UTC, America/Toronto, Asia/Kolkata, Australia/Lord_Howe |
| Privacy bundle | `npm run check:privacy` | passed: 22 files scanned, manifest matches the declared list (no permission change) |
| Build | `npm run build` | media.js 1.7 KB (was 0.9 KB: watched and attention), guard.js 16.4 KB, guard-instagram.js 26.0 KB, guard-facebook.js 16.7 KB |
| Real browser | `npx playwright test` | 96 passed: an attention message lands on its sender's tab and window, a muted clip reports playing then watched once unmuted, site focus by click, a focused chart column keeps keyboard focus and its tooltip across weeks |
| Dependencies | `npm audit` | 0 vulnerabilities |
| Reviews | `!/code-review` (high, staff bar) and `!/security-check`, 2026-10-27 | tracking: 8 findings, 8 fixed; dashboard: 10 findings, 10 fixed; one re-review of the fixes: 10 findings, 9 fixed, 1 declined (per-hour site lists kept in the day memo: the same size as the stored record). Security check clean |
| Live sites | not run | hover-scrolling a window without focus and a video on a second screen are OS behaviour: owner checklist below |

## Manual checklist (owner)

What only the operating system and the live, logged-in sites can show. Tick each box with the date and what you saw. Reload the extension and any open Instagram, YouTube, Facebook and X tabs first: content scripts do not reach tabs opened before an install or reload.

- [ ] Blur the window 10 s: no site gains more than 1 s
- [ ] Lock the screen with a video playing: counting stops
- [ ] Close the lid 10 min: at most 60 s attributed
- [ ] Focus an incognito window: nothing recorded
- [ ] Click another app, then scroll Instagram's home feed with the wheel without clicking Chrome for 2 minutes: the popup shows about 2 minutes plus the idle threshold for instagram.com. Move the pointer off the page: counting stops at once
- [ ] Play a YouTube video with sound, then click another app and leave the video on screen: youtube.com keeps counting. Mute it: it stops after 30 s. Minimise the window: it stops at once
- [ ] Instagram: tap a Reel in search, on a profile, in the feed and in a message; each opens in Instagram's own pop-up over the page, with no page load, and scrolling does not reach another Reel. A Reel opened from a link outside Instagram shows as Dwell's look-alike pop-up. The Reels tab goes home
- [ ] YouTube: no Shorts on home, in search or beside a video; a Short opened from a link plays on the watch page with no Shorts scroller
- [ ] Facebook: open a reel; the wheel, arrow keys and swipes do not move to another reel, and the viewer's up and down card buttons are gone; on the home feed nothing else is missing. Comments still scroll
- [ ] X: open a video in a tweet; it plays on the tweet page and X's full-screen video feed never starts
- [ ] Toolbar: Dwell shows the hourglass, not a grey "D"

## Next

1. Owner runs the checks above in Chrome with `%LOCALAPPDATA%\Dwell\extension` loaded unpacked and ticks them here. Facebook and X are the two that were never seen live.
2. Owner uses Dwell for one real day with the event log on, exports it into `tests/fixtures/real/` and runs `npm test`: the popup should match recollection and the replay should pass (Definition of Done).
3. Tag `v0.1.0` on `main` and push the tag; the release workflow builds, tests and attaches the zip and hash list.

<!-- session-end:auto -->
**Last session (2026-10-15, coding):** Reworked reel blocking (Facebook viewer Previous Card, Instagram smoother open/close), hourglass icon, ponytail method added to code-review; merged to main.
**Next:** Signed-in Facebook/Instagram checks, one real day with event log, tag v0.1.0.
<!-- /session-end:auto -->
