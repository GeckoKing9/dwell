# Project Spec — Dwell

Created: 2026-10-14 via /new-code-project. The implementation plan in `docs/plans/` carries the requirement IDs (R1 to R31) and the units; this spec is the product view.

---

# Part 1: Product Requirements

## What this is
A Chrome extension that records how many minutes each website is in front of its one owner while they are present, shows today in a popup and the week in a dashboard, and turns Instagram Reels, YouTube Shorts and Facebook Reels off per site with one tap, without any byte leaving the browser.

## Who it's for
**Specific user:** the owner, a technically fluent person in Quebec who spends work and leisure in Chrome and wants to know where the hours go without handing browsing data to anyone.
**Their problem today:** existing trackers count wall-clock time while a tab is open, so a music tab or a forgotten window inflates everything, or they require an account and a server. Reels and Shorts blockers are separate extensions, often closed source, and break silently.
**Why this solves it better:** one small auditable tool that counts the way a person would count ("was I actually on it?"), reads like Screen Time, and makes the short-video feeds one tap harder.

## What it does — MVP scope

- [ ] Counts a second for one site at a time, where the owner's attention is: a page scrolled without focus (the four script sites), else the focused window's active tab, else a video with sound on screen; only while present (input, or media playing; never while locked). ADR-6.
- [ ] Keeps 90 rolling days of domain, seconds per hour, visits per day, and redirect counts, locally.
- [ ] Popup: today's total against the usual amount by this time, a 7-day chart, top 3 sites, this site's time and visits, the blocker toggle for this site, pause.
- [ ] Dashboard: week navigation over the retained weeks, week total, daily average, change against the previous week in plain words, 7-day chart, hourly day view, most used with deltas and visits, categories, blocked counts, settings, privacy.
- [ ] Blockers for Instagram Reels, YouTube Shorts (rewritten to the normal watch page), Facebook Reels, and optionally Instagram Explore.
- [ ] Export, import (hardened), delete all with a 10 s undo, ignore list, grouping overrides, category editor.
- [ ] Light and dark themes; English UI with every string in message files.

**MVP Note:** no server, no account, no sync, no notifications. French ships after MVP as a message file.

## What it does NOT do

- Firefox or Safari: out of scope because the owner uses Chrome and MV3 APIs differ.
- Sync between devices: out of scope because any sync is a network path and the privacy claim is the product.
- Time limits or lockouts: deferred because the owner asked for information, not enforcement; the blockers are the one enforcement feature.
- Notifications or weekly reports: deferred; the ethical design rule is no nagging by default.
- Per-URL or per-video tracking: out of scope; only the domain is stored.
- Encryption at rest: out of scope because anyone with the OS account already has Chrome history.
- Hiding Reels inside the Instagram home feed: deferred because it needs selectors that break monthly.

## User experience walkthrough

**UI zones, popup (top to bottom):**
1. Today so far: big number, the usual amount by this time of day, 7-day average.
2. Last 7 days chart, each dot 30 minutes, today in teal.
3. Top sites today, three rows with letter marks and bars.
4. This site: domain, time, visits, and the blocker switch when the site has one.
5. Footer: Open dashboard, Pause tracking.

**UI zones, dashboard:**
1. Header: wordmark, Activity / Settings / Privacy, recording or paused pill.
2. Week navigator and headline: total, daily average over full days, delta sentence, quietest and busiest day.
3. Active time per day chart (each dot 15 minutes) beside Categories.
4. Most used list beside Blocked.
5. Day view replaces 2 to 4 with the hourly chart (each dot 5 minutes) and that day's sites.

**Happy path:**
1. Owner loads the extension unpacked and browses; the popup fills within minutes.
2. On instagram.com the popup shows "Reels off" on; tapping a Reel keeps them on the feed and the Blocked count grows.
3. At the end of the week the dashboard says "Daily average is 12% lower than the week before" in neutral words.
4. End: the owner recognises their own day without explanation.

**Error states:**
- Chrome page or new tab: popup says browser pages are not recorded.
- Paused: dark band in the popup, paused pill in the dashboard; nothing recorded until resume.
- Import of a bad file: rejected whole with the specific reason; nothing changes.
- No data for the previous week: "No data for the week before to compare with."

**Copy tone:** calm, plain, informational. No streaks, no guilt, no urgency. Deltas are facts.

---

# Part 2: Engineering Requirements

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Extension | Chrome Manifest V3, TypeScript | service worker, content scripts, popup, dashboard page |
| Build | Vite + CRXJS | multi-entry; modulepreload polyfill off (it contains `fetch(`) |
| UI | Preact, inline SVG | only runtime dependency; tokens from `design/DESIGN.md` |
| Storage | `chrome.storage.local` and `chrome.storage.session` | one key per local day; hot state in session |
| Blocking | content script (Navigation API) + `declarativeNetRequest` | four static rulesets, per-site toggles |
| Tests | Vitest, fast-check, Playwright, ESLint | oracle-equality simulation; real Chromium specs |
| Deployment | unpacked; unlisted Chrome Web Store later | release workflow publishes per-file hashes |

**MVP Note:** no backend, no database, no auth, no external API.

## Technical Architecture

### Data Flow (MVP)

```
1. Chrome fires a tab, window, idle or alarm event, or a content script sends media/attention/blocked
2. The service worker pushes it onto one serialised queue
3. The event is reduced by the pure engine: close the open interval, split at hour boundaries, apply the gap cap, decide visits
4. Attributions are written to d:<YYYY-MM-DD> in storage.local; hot state to storage.session
5. Popup and dashboard read day keys and aggregate (weeks, deltas, categories) in pure functions
6. Settings, pause and blocker toggles go back to the worker, which reconciles DNR rulesets
```

### Project Structure

See the Output Structure section of the plan; `docs/architecture.md` mirrors it with one line per file.

## API Design

No HTTP API. Internal message types between content scripts, popup, dashboard and the worker are listed in `docs/architecture.md` with their sender authorisation rules.

## Data Model

```
d:2026-10-14 {
  sites:   { "youtube.com": { h: { "21": 1340, "22": 610 }, v: 3 } }   # seconds per hour, visits
  blocked: { instagram: 4, youtube: 1, facebook: 0 }
}
settings { idle, media, paused, blockers, overrides, ignore, cats, log }
log:<ts> { at, kind, site }   # optional 24 h event log, site id only
```

## Environment Variables

None. The extension has no secrets and no external service. `.env.example` documents this.

## Milestones

### MVP — no deadline
**Definition of done:** the plan's Definition of Done and Verification Contract.
**Features in scope:** units U1 to U9.

### V1
Blocker schedules, French, manual language override, unlisted Web Store listing, week image export.

### Later / maybe
Firefox build, hiding feed Reels, time budgets.
