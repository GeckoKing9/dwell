# Changelog

## [Unreleased]
_Nothing yet._

## [0.1.0] — 2026-10-15
### Added
- Time per website, counted only while a Chrome window has focus, the site is in that window's active tab and you are present. A video or song playing in that tab keeps the count going when you are not touching anything; a locked screen always stops it. After sleep or a closed lid, at most one minute is added.
- Visits: a new visit starts when you come back to a site after at least a minute away.
- Popup: today so far, how that compares with a usual day at this time and with the 7-day average, the last seven days, today's top three sites, the site you are on with its time and visits, its Reels, Shorts or video switch, a pause switch and a link to the dashboard.
- Dashboard: one week at a time across the last 90 days, with the week total, the daily average and the change from the week before in plain words; any day's hours; the most used sites with share, visits, change and category; time per category; Reels, Shorts and video redirects per site.
- One video at a time: Instagram Reels, YouTube Shorts, Facebook Reels and X videos each have a switch, on by default. A Reel you tap on Instagram opens in Instagram's own pop-up over the page you were on, and a Reel opened from a link shows on its own with nothing under it; a Short opens on YouTube's watch page; an X video opens on its tweet. On Facebook the Reels viewer stays on the reel you opened: the wheel, arrow keys and swipes do not move it, and if it moves anyway Back takes it to your reel, with a reload only as the last resort. The Reels feeds themselves go to the home page, and a direct link is handled before it loads. Search, posts and a profile's Reels grid keep working. Instagram Explore can be turned off too (off by default). Reels and Shorts entries and shelves are hidden on Instagram, YouTube (search results included) and Facebook.
- Pause: nothing is recorded while paused, and every screen says so.
- Settings: idle threshold, the media setting, the five switches, subdomains to keep apart, sites to ignore, categories, export, import, delete all with 10 seconds to undo, and the event log.
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
