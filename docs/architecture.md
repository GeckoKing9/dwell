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

---

## Architecture decision records

The plan's Key Technical Decisions (KTD1 to KTD12) are the ADRs for this project. New decisions during implementation are appended here as `ADR-<n>: <title>` with context, options, decision and consequences.
