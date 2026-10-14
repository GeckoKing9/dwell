# Dwell: planning notes

Created 2026-10-14. The implementation plan in `docs/plans/2026-10-14-001-feat-dwell-screen-time-extension-plan.md` is the authority; this file records the why.

## Dwell: Planning Summary

**Goal:** a personal Chrome extension that shows how much active time goes to each website, the way iPhone Screen Time does for apps, and switches Reels and Shorts off per site. Built for one owner, published on GitHub as a portfolio project that a sceptic can audit.

**First milestone:** the plan's Definition of Done: all nine units verified, one real day of use that matches the owner's recollection, the privacy claim backed by named tests, repository public with no AI attribution.

**Key decisions:**
- Counting is a pure, timestamp-keyed state machine (focused window, active tab, present user), tested by property-based simulation with an oracle model. Over-counting from background media is the problem every existing tracker gets wrong.
- Everything stays local: domain plus seconds per hour, 90 days, manifest CSP forbids network, three automated checks back the claim, wording is "auditable".
- Blocking happens in the page before the navigation commits, with network rules for direct loads. Shorts become ordinary watch pages.
- Design was commissioned from an isolated fresh-eyes pass before any component code; `design/DESIGN.md` is the visual source.

**3 critical questions and answers:**
1. Does a video playing hands-off count? Yes, when it plays in the focused active tab; a setting turns it off. A 25-minute video showing as one minute is the top complaint on existing trackers.
2. Can "no network" be proved? No; it can be audited. The CSP, a bundle grep plus lint, an allowlist test for every navigation target and a recorded real-browser session together make the claim checkable.
3. Will the Reels and Shorts blocking survive site changes? URL-level blocking carries the function and is stable; the cosmetic hiders are expected to break and live in one dated file per site.

**Open risks / unknowns:**
- Whether the isolated-world Navigation API sees each site's route changes; the first task of U5 is a live prototype, with a MAIN-world fallback.
- Chrome idle is system-wide, so hands-off reading past the threshold stops counting; the threshold setting is the mitigation.
- The owner's confirmation of the defaults (name, media override, idle 60 s, Shorts rewrite, Monday weeks, visits, event log) was "do it exactly as that, changes after".

---

## Technical Decisions

**Stack chosen:** TypeScript, Vite with the CRXJS plugin, Preact (only runtime dependency), hand-drawn inline SVG charts, Vitest, fast-check, Playwright, ESLint with privacy rules.
**Why this stack:** a Chrome MV3 extension needs a multi-entry build (worker, content scripts, popup, dashboard) that CRXJS handles; Preact keeps the dashboard maintainable at 4 KB and keeps the bundle auditable; fast-check is the right tool for a time-attribution engine; no chart library keeps dependencies at one.
**What was ruled out:** React (bundle size for an auditable extension), a chart library (dependency surface), the full Public Suffix List (250 KB; a 60-entry subset plus user overrides instead), `webNavigation` permission (the in-page guard needs no new permission), counting redirects through the network layer (unpacked-only API).
**Council output:** fresh-context contrarian review plus coherence, feasibility and security document reviews; 33 findings folded into the plan.

## Definition of Done — MVP

See the plan's Definition of Done and Verification Contract. In short: typecheck, unit and simulation suites (oracle equality, 2,000+ sequences, 80%+ coverage, 90%+ on the engine), privacy bundle check, time-zone matrix, real-browser specs, dependency audit, impeccable detect, `!/security-check` and `!/code-review` all green; one real day replayed through the engine with identical totals; docs current; repository public.

## Milestones

- **MVP:** no deadline. Units U1 to U9 of the plan.
- **V1:** blocker schedules; French translation and a manual language override; unlisted Chrome Web Store listing; week image export.
- **Parked:** Firefox or Safari builds; cross-device sync; time limits or lockouts; notifications or weekly reports; per-URL tracking; encryption at rest; hiding Reels inside the Instagram home feed.
