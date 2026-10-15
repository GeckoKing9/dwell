# Dwell

**Current milestone:** MVP — units U1 to U9 of `docs/plans/2026-10-14-001-feat-dwell-screen-time-extension-plan.md` verified, one real day of use matches the owner's recollection, privacy claim backed by named tests, repository public.

The plan is the authority for what to build and why; `design/DESIGN.md` is the authority for how it looks. The shared rules of the parent folder apply.

---

## Architecture Overview

Chrome Manifest V3 extension, no server — a service worker turns Chrome events into per-site time through a pure engine; popup and dashboard read local day keys.

```
dwell/
├── manifest.json                 # permissions (literal list), CSP default-src 'none', four DNR rulesets, incognito not_allowed
├── src/
│   ├── background/               # service worker: serialised event queue, startup seeding, alarms, message authorisation
│   ├── tracker/                  # PURE engine: reduce(state, event) -> attributions; hour buckets; eTLD+1 grouping
│   ├── store/                    # day keys in storage.local, hot state in storage.session, prune, export, hardened import
│   ├── blocker/                  # pure URL classifier, allowlisted redirect targets, rulesets/*.json
│   ├── content/                  # guard.ts (Navigation API cancel), media.ts (video playing), <site>.css hiders
│   ├── stats/                    # pure aggregation: weeks, deltas, categories, formatting
│   ├── popup/                    # Preact popup (360 x 560)
│   ├── dashboard/                # Preact dashboard page: Week, Day, MostUsed, Categories, Blocked, Settings, Privacy
│   └── shared/                   # messages, settings schema, i18n, theme.css, fonts/
├── _locales/en/messages.json     # every UI string
├── tests/                        # vitest unit + fast-check simulation; e2e/ Playwright specs; fixtures/
├── scripts/                      # simulate.ts (seed 90 days), zip.ts
├── design/                       # DESIGN.md, prototype.html, screens/, canvas/ (design canvas sources)
├── .env.example                  # documents that there are no secrets
└── docs/                         # plan, spec, architecture (ADRs), changelog, status, planning notes
```

**Data flow:** Chrome event → worker queue → pure engine → `d:<day>` in storage.local → aggregate → popup / dashboard; toggles and settings → worker → DNR rulesets + settings key.

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Extension | Chrome MV3, TypeScript strict | worker + content scripts + two pages |
| Build | Vite + CRXJS | `build.modulePreload.polyfill = false` (the polyfill contains `fetch(`) |
| UI | Preact + inline SVG | only runtime dependency; no chart library |
| Storage | chrome.storage.local / session | 90-day prune by date string |
| Blocking | content script + declarativeNetRequest | counts come from the content script, never DNR |
| Tests | Vitest, fast-check, Playwright, ESLint | oracle-equality simulation is the core proof |
| Deployment | unpacked now; unlisted Web Store later | per-file hash list in releases |

**MVP Note:** no backend, no database, no auth, no external API, no secrets.

---

## Design Style Guide

**Visual style** (full system in `design/DESIGN.md`; implement it, do not reinterpret it):
- Calm, precise, Screen-Time-level clarity without being an Apple clone.
- Cool grey-green neutrals; one teal accent used only for today, the busiest or selected item, and switches that are on. Teal is split into a bar colour and a text colour; one hex never serves both.
- Hanken Grotesk for text and figures, IBM Plex Mono for domain names. Fonts are bundled in `src/shared/fonts/`, never loaded from Google Fonts at runtime.
- The single motif: a column of time dots behind every bar, each dot a real unit (30 min popup, 15 min week, 5 min hour). The same dots fill the empty part of bars and count redirects.
- Dark mode is its own palette with tonal elevation plus a 1px top highlight; recessed wells get only a darker shade.
- No streaks, no guilt copy, no red over-limit states, no confetti, no notifications.

**Tech:**
- Tokens from `design/DESIGN.md` verbatim in `src/shared/theme.css`; `prefers-color-scheme` plus `data-theme` override.
- Charts are inline SVG drawn to scale; every value also printed as text.
- `font-variant-numeric: tabular-nums` wherever digits line up.

**Component patterns:**
- One component per file, under 150 lines; text via `textContent`, never `innerHTML`.
- Every control has a stable `id`; visible focus state; `prefers-reduced-motion` respected.

---

## Product & UX Guidelines

**Core UX principles:**
- Count the way a person would count: focused window, active tab, present user.
- Information, never judgement: deltas are facts in plain words.
- One tap, no confirmation dialogs; the only "are you sure" is the 10 s undo after delete-all.
- Pause is honest: every surface shows the paused state.

**Copy tone:** plain, calm, short. English first, every string in `_locales`, strings tolerate 30% longer French.

**UI zones:** popup top to bottom: today, 7-day chart, top sites, this site + blocker, footer. Dashboard: header, week navigator + headline, chart + categories, most used + blocked; day view swaps in the hourly chart.

---

## Constraints & Policies

**Privacy and security — MUST follow:**
- Store only the registrable domain, seconds per hour, visits, redirect counts and settings. Never a URL, path, query, title or page content, anywhere, including the optional event log.
- Permissions stay exactly `tabs`, `idle`, `storage`, `alarms`, `declarativeNetRequest`; host permissions and content-script matches are the literal `https://` list for www, m and bare hosts of the three sites, top frame only. A new permission is a stop condition, not a decision.
- Manifest CSP `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'`. No `externally_connectable`. `incognito: not_allowed`.
- No `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource`, `WebTransport`, `RTCPeerConnection`, `new Image`, `import()`, `window.open`, `eval`, `new Function`, computed access on `globalThis`/`self`/`window`, or `createElement` of script, link or iframe anywhere in `src/`. `npm run check:privacy` enforces it.
- Every `tabs.update`, `tabs.create`, `windows.create`, `location.replace` and DNR redirect target comes from the one allowlist in `src/blocker/targets.ts`.
- The worker authorises every message by sender: content scripts may send only `blocked` and `media`; settings, pause, import, delete and undo only from extension pages. Payloads are validated for shape.
- Import is hardened: size and count caps, date-window check, hostname regex, `__proto__`/`constructor`/`prototype` rejected, integer ranges, `Object.create(null)`, single-commit write.
- The privacy wording is "auditable", never "provable"; the README, the privacy panel and the manifest must agree (a test checks it).

**Code quality:**
- TypeScript strict; no `any` without a comment saying why.
- The engine, the classifier and the aggregation stay pure and never touch the Chrome global. Chrome APIs live only in `src/background/`, `src/content/` and the UI entry files, plus two injectable seams: `src/shared/i18n.ts` (`chrome.i18n.getMessage`) and `src/store/adapter.ts` (the `chrome.storage` wrapper). Everything else reaches Chrome through those seams or injected dependencies.
- Test-first for engine, classifier and aggregation; watch the test fail first.
- `npm run typecheck && npm run lint && npm test && npm run check:privacy` before every commit.

**Dependencies:**
- Preact is the only runtime dependency. Adding another one is a plan change, recorded as an ADR in `docs/architecture.md`.
- `npm ci --ignore-scripts` in CI; lockfile committed; GitHub Actions pinned to commit SHAs.

**Attribution:**
- No AI or vendor attribution in commits, PR bodies, comments or file content. This repository is the owner's portfolio.

---

## Repository Etiquette

**Branching:**
- Feature work on `feature/<unit-or-feature>`; never commit directly to `main` except `/session-end` session commits.
- Branch names carry no issue numbers.

**Git workflow for changes:**
1. `git checkout -b feature/u2-engine`
2. Commit each logical unit with `type(scope): why`
3. Run the checklist below
4. `git push -u origin feature/u2-engine`, open a PR, merge, delete the branch

**Before pushing — checklist:**
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run check:privacy`
- [ ] `npm run build` loads unpacked without warnings
- [ ] No `.env`, `dist/` or secrets staged
- [ ] `!/security-check` and `!/code-review` on any diff over 50 lines or anything touching messaging, import, manifest or permissions

**Commits:** `feat(engine): …`, `fix(blocker): …`, `test(engine): …`, `chore: …`, `docs: …`. Never force-push `main`.

---

## Testing

**Approach:** automated first, real browser second, one manual checklist for what the OS owns.

**Automated:**
- Engine: property-based simulations with an oracle model (second-by-second reference), upper-bound invariants, duplicated/reordered/dropped events, midnight and DST splits, restart equivalence, 2,000+ sequences, under four time zones.
- Classifier: table tests for every URL variant, loop guard, per-site toggles.
- Aggregation: week boundaries, deltas, formatting, simulator determinism.
- Store: prune, export/import round trip, hardened import rejections, undo window.
- Privacy: bundle grep, lint, manifest literal comparison, fetch-refused e2e, recorded network traffic.
- E2E (headed Chromium with the extension loaded): tab switching totals, worker restart, pause, media message, Shorts rewrite, in-page Reel cancel, toggle off lets a hard load through.

**Manual checklist (record in `docs/project_status.md`):**
- [ ] Blur the window 10 s: no site gains more than 1 s
- [ ] Lock the screen with a video playing: counting stops
- [ ] Close the lid 10 min: at most 60 s attributed
- [ ] Focus an incognito window: nothing recorded
- [ ] Live Instagram, YouTube, Facebook: Reel tap cancelled, Shorts rewritten, hiders applied

---

## Commands

```bash
npm run dev            # Vite + CRXJS dev build with reload; load dist/ unpacked
npm run build          # production build to dist/
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint with the privacy rules
npm test               # Vitest unit + simulation suites with coverage
npm run test:tz        # the same suite under UTC, America/Toronto, Asia/Kolkata, Australia/Lord_Howe
npm run test:e2e       # Playwright specs in headed Chromium with the extension loaded
npm run check:privacy  # bundle grep + manifest comparison + target allowlist
npm run simulate       # seed a dev profile with 90 days of plausible data
npm run zip            # release zip plus per-file hash list
npm ci --ignore-scripts
```

---

## Documentation

Update these files after every significant feature:
- [docs/changelog.md](docs/changelog.md) — what changed and when
- [docs/project_status.md](docs/project_status.md) — milestones, manual checklist results, what's next
- [docs/architecture.md](docs/architecture.md) — structure, messages, ADRs


**Links:**
- [Plan](docs/plans/2026-10-14-001-feat-dwell-screen-time-extension-plan.md) — requirements, decisions, units, verification contract
- [Project Spec](docs/project_spec.md) — product view
- [Architecture](docs/architecture.md) — system design, messages, ADRs
- [Design system](design/DESIGN.md) — tokens, contrast table, motif, copy rules
- [Changelog](docs/changelog.md)
- [Project Status](docs/project_status.md)
- [Planning Notes](docs/planning_notes.md)

