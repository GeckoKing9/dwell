# Dwell: project status

Last session: 2026-10-14. Milestone MVP: built. Units U1 to U10 of the plan are done on `feature/mvp`; U9 (README, screenshots, release workflow, docs) is in this pass. What remains is the owner's checklist below, the gates before the push to `main`, and the `v0.1.0` tag.

## State

- Tracking: pure engine with an oracle-checked simulation suite; service worker with one serialised queue, live reseed after gaps, heartbeat and prune alarms, sender authorisation.
- Storage: day records, 90-day prune, export, hardened import, delete with 10 s undo, optional 24-hour event log that replays exactly (ADR-1).
- Blocking: URL classifier, in-page guard on the Navigation API, one DNR rule per host (ADR-2), counts from the content script only (ADR-3), hider stylesheets.
- UI: popup and dashboard (week, day, settings, privacy) from the design pass, light and dark.
- Release: `npm run zip` writes a deterministic zip and a per-file SHA-256 list; `.github/workflows/release.yml` publishes them on a `v*` tag. Screenshots in `docs/screenshots/` come from `npm run screenshots`.
- Defaults shipped: media override on; idle 60 s; Shorts rewritten to the watch page; Explore blocking off; Monday weeks; visits counted; event log off; English UI; unpacked install.

## Gates

Last run 2026-10-14 on `feature/mvp` at `b960fab` plus the U9 working tree, before the theme-setting unit (U11) merged; counts will move when it does.

| Gate | Command | Last result |
|---|---|---|
| Typecheck | `npm run typecheck` | 0 errors |
| Lint | `npm run lint` | 0 problems |
| Unit and simulation | `npm test` | 41 files, 876 tests passed and 1 skipped (the real-day replay, no real export present). Coverage: lines 98.38%, branches 96.3%; `src/tracker` 100% on all four. Lowest directory: `src/popup` (lines 81.6%, functions 73.8%) |
| Time zones | `npm run test:tz` | 876 of 876 under each of UTC, America/Toronto, Asia/Kolkata, Australia/Lord_Howe |
| Privacy bundle | `npm run check:privacy` | passed: 19 files scanned, manifest matches the declared list |
| Build | `npm run build` | built; `dist/` holds 31 files |
| Real browser | `npm run test:e2e` | 36 passed in 1.2 min (tracking 6, blocker 9, privacy 4, ui 17), headless Chromium with the extension loaded |
| Dependencies | `npm audit --audit-level=high` | 0 vulnerabilities |
| Release | `npm run zip` | `release/dwell-0.1.0.zip`, 31 files, 303,321 bytes, same SHA-256 on two consecutive builds; every line of the hash list verified with `sha256sum -c` against the unzipped files |
| Screenshots | `npm run screenshots` | 7 PNGs, 86 to 329 KB |
| UI craft | `npx impeccable detect` | not re-run in U9 |
| Before the push to main | `!/security-check`, `!/code-review` | pending |

Generated sequences per `npm test` run: 5,700 in the engine simulation and robustness suites, 1,800 in the event-log round trip.

## Manual checklist (owner)

What only the operating system and the live sites can show. Tick each box with the date and what you saw.

- [ ] Blur the window 10 s: no site gains more than 1 s
- [ ] Lock the screen with a video playing: counting stops
- [ ] Close the lid 10 min: at most 60 s attributed
- [ ] Focus an incognito window: nothing recorded
- [ ] Live Instagram, YouTube, Facebook: Reel tap cancelled, Shorts rewritten, hiders applied

U5 checked a guard prototype against the live sites during development; the last item is the owner's own pass on the shipped build.

## Notes

Graphify: set up when project reaches 20+ source files
  → run: graphify hook install

## Next

1. Owner runs the five checks above in Chrome with `dist/` loaded unpacked and ticks them here.
2. Owner uses Dwell for one real day with the event log on, exports it into `tests/fixtures/real/` and runs `npm test`: the popup should match recollection and the replay should pass (Definition of Done).
3. `!/security-check` and `!/code-review` on the branch diff, then merge `feature/mvp` into `main`.
4. Tag `v0.1.0` on `main` and push the tag; the release workflow builds, tests and attaches the zip and hash list.

<!-- session-end:auto -->
**Last session (2026-10-15, coding):** Dwell MVP built in units U1-U11, 21 review findings fixed, merged to main with CI green; handoff/ folder created; dist copied to C:\Users\CRdup\dwell-dist.
**Next:** Run manual checklist on real Chrome, then tag v0.1.0.
<!-- /session-end:auto -->
