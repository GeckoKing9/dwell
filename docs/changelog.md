# Changelog

## [Unreleased]
_Nothing yet._

## [0.1.0] — 2026-10-15
### Added
- Time per website, counted only while a Chrome window has focus, the site is in that window's active tab and you are present. A video or song playing in that tab keeps the count going when you are not touching anything; a locked screen always stops it. After sleep or a closed lid, at most one minute is added.
- Visits: a new visit starts when you come back to a site after at least a minute away.
- Popup: today so far, how that compares with a usual day at this time and with the 7-day average, the last seven days, today's top three sites, the site you are on with its time and visits, its Reels or Shorts switch, a pause switch and a link to the dashboard.
- Dashboard: one week at a time across the last 90 days, with the week total, the daily average and the change from the week before in plain words; any day's hours; the most used sites with share, visits, change and category; time per category; Reels and Shorts redirects per site.
- Reels and Shorts off: Instagram Reels, YouTube Shorts and Facebook Reels each have a switch, on by default. A Reel tap is cancelled before the page changes, a Shorts link opens as the normal video page, and a direct link is redirected before it loads. Instagram Explore can be turned off too (off by default). Reels and Shorts links and shelves are hidden on the three sites.
- Pause: nothing is recorded while paused, and every screen says so.
- Settings: idle threshold, the media setting, the four blockers, subdomains to keep apart, sites to ignore, categories, export, import, delete all with 10 seconds to undo, and the event log.
- Light and dark themes that follow the system, with a setting to force either.
- Privacy page: what is stored, where, and why each permission is needed, matching the manifest.
- Event log (off by default): the last 24 hours of tracking events, exportable on its own, so a day that looks wrong can be replayed through the test suite.
- Release zip with one SHA-256 per file, so an installed copy can be checked file by file.

### Privacy
- Stores only domains, seconds per hour, visits, redirect counts and settings, for 90 days, in this Chrome profile. Never addresses, titles, searches or page content.
- No network requests of its own: the extension pages and worker run under `default-src 'none'`, and the bundle, the lint rules and the browser tests check it. The README explains why the claim is auditable rather than provable.

## [2026-10-14] — Planning and design
### Added
- Implementation plan with nine units, reviewed by a fresh-context contrarian pass and three document reviews.
- Design system, interactive prototype on simulated data, six artboards and the design canvas sources.
