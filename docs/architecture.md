# Architecture — Dwell

Last updated: 2026-10-14
Status: MVP, implementation starting

---

## System overview
Dwell is a Chrome Manifest V3 extension with no server. A service worker turns Chrome's tab, window, idle and alarm events into per-site time attributions through a pure engine, stores them per local day, and serves a popup and a dashboard page that compute everything they show from those keys. Content scripts on three sites report media state, cancel navigations to Reels and Shorts, and hide their entry points.

## Architecture diagram
```
Chrome events (tabs, windows, idle, alarms)
        │
        ▼
service worker ── serialised queue ── pure engine (src/tracker) ──► storage.local  d:<day>
        ▲                                                   └──► storage.session  hot state
        │ blocked{site}, media{playing}            (settings, pause, import, delete, undo)
content scripts on instagram.com / youtube.com / facebook.com         ▲
  guard.ts (Navigation API cancel, DNR landing fragment)              │
  media.ts (video playing boolean)                      popup ◄── aggregate (src/stats) ──► dashboard
  <site>.css (hide Reels/Shorts entry points)
declarativeNetRequest: four static rulesets for direct loads
```

---

## Components

### Tracking engine
- **What it does:** reduces timestamped events into attributions; the counting rule lives here and nowhere else.
- **Location:** `src/tracker/`
- **Depends on:** nothing (pure).
- **Key files:** `engine.ts`, `buckets.ts` (local-time hour splitting), `grouping.ts` + `suffixes.ts` (eTLD+1 subset, overrides, http(s) allowlist).

### Service worker
- **What it does:** wires Chrome events to the engine through one promise queue, seeds state from the live browser on start or after a gap, keeps the heartbeat and prune alarms, authorises every message by sender, reconciles DNR rulesets with settings.
- **Location:** `src/background/`
- **Depends on:** tracker, store, blocker.

### Store
- **What it does:** day keys, hot state, settings, prune, export, hardened import, delete with in-memory undo.
- **Location:** `src/store/`

### Blocker
- **What it does:** pure URL classifier, redirect targets (allowlisted), four DNR rulesets.
- **Location:** `src/blocker/`, `src/content/guard.ts`, `src/content/*.css`

### UI
- **What it does:** popup and dashboard in Preact, tokens from `design/DESIGN.md`, inline SVG charts.
- **Location:** `src/popup/`, `src/dashboard/`, `src/shared/`, `src/stats/`

---

## Messages (content script, popup, dashboard → worker)

| Type | Allowed sender | Payload |
|---|---|---|
| `blocked` | content script on one of the three sites | `{ site }` |
| `media` | content script on one of the three sites | `{ playing: boolean }` |
| `settings` | extension pages only | validated settings patch |
| `pause` | extension pages only | `{ paused: boolean }` |
| `import` | extension pages only | export JSON text |
| `deleteAll` / `undoDelete` | extension pages only | none |

Any other sender or shape is rejected. No `externally_connectable`.

---

## Data model

See `docs/project_spec.md`. One key per local day; hours sparse; 90-day prune by date string comparison.

- `log:YYYY-MM-DDTHH` (optional event log, off by default; UTC hour keys, last 24 h, at most 3,600 entries an hour): `{ at, kind, site?, win?, tab?, a? }` with `kind` from `LOG_KINDS`, integer window and tab ids, `a` the audible flag. Never in the data export; the separate event-log export is `dwell-event-log` version 2: the entries plus the day records they cover (ADR-1).

---

## Architecture decision records

The plan's Key Technical Decisions (KTD1 to KTD12) are the ADRs for this project. New decisions during implementation are appended here as `ADR-<n>: <title>` with context, options, decision and consequences.

### ADR-1: Replayable event log

- **Context:** KTD10 logged `{ at, kind, site }`, which loses window and tab identity, the audible flag, a seed's idle state and every browser restart, so a recorded day could not replay with identical totals (Definition of Done).
- **Options:** keep site-only entries and accept an approximate replay; log an engine-state snapshot per job (large, and holds more than the log needs); carry Chrome's integer ids and the audible flag in a closed kind list.
- **Decision:** the third. Entries are `{ at, kind, site?, win?, tab?, a? }`; `LOG_KINDS` is closed (16 event kinds plus `start`, written when the worker rebuilt a lost hot state). The guard in `src/store/log.ts` rejects any other field, `://`, `/`, `?`, a non-hostname site, a negative or non-integer id. `src/tracker/replayLog.ts` inverts `src/background/log.ts` and resets at `start`. The export is version 2 and adds the day records it covers.
- **Consequences:** a property test proves `replayLog(encode(events))` equals `replay(events)` on 1,500 generated sequences. Version 1 files still read and replay approximately: one window holding one tab, `close` dropped, every seed active. Known limits: a replay is exact from a `start` entry on (a ring that began mid-session starts from an empty state); a host the day records cannot hold (`localhost`) logs as untracked; a mid-ring change of the media override is not logged; a clock set backwards replays in time order.
