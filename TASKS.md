# Dwell build checklist (working file; folded into docs/project_status.md at the end)

Finish line: the plan's Definition of Done and Verification Contract, all green.
Branch: feature/mvp (one branch per milestone). No AI attribution anywhere.

- [x] U1 scaffold, manifest, privacy floor, CI
- [x] U2 pure engine + simulation suite (test-first, oracle)
- [x] U3 storage layer, hardened import, undo
- [x] U4 service worker wiring, startup, heartbeat, e2e tracking
- [x] U5 blocker: classifier, guard prototype on live sites, DNR rulesets, hiders, toggles
- [x] U6 aggregation, formatting, categories, simulator
- [x] U7 popup
- [x] U8 dashboard
- [x] U10 event log replay round-trip
- [ ] U9 README, release workflow, docs
- [ ] Gates: typecheck, lint, test, test:tz, check:privacy, build, test:e2e, npm audit, impeccable, !/security-check, !/code-review
- [ ] Manual checklist recorded in docs/project_status.md
- [ ] Merge feature/mvp into main, delete branch, push
- [x] U11 theme setting, real-day replay test, recorded-traffic spec
