# Contributing

Dwell is a personal tool kept small on purpose. Issues and pull requests are welcome when they keep it that way.

## Before you open a pull request

```bash
npm ci --ignore-scripts
npm run typecheck && npm run lint && npm test && npm run check:privacy
npm run test:e2e
```

All five must pass. Changes to the engine, the URL classifier or the aggregation start with a failing test.

## What will not be merged

- A new permission, host pattern, `<all_urls>`, `externally_connectable` or a relaxed content security policy.
- Any network API, analytics, remote font or remote script, in `src/` or in the built bundle.
- A new runtime dependency (Preact is the only one).
- Storing a URL, path, query, page title or page content anywhere, including the event log.
- Streaks, warnings, red over-limit states or notifications.

## Notes

- Every UI string lives in `_locales/en/messages.json`.
- Redirect targets come only from `src/blocker/targets.ts`.
- The privacy wording is "auditable", never "provable"; the README, the privacy panel and the manifest must agree.
- Commits follow `type(scope): why`, for example `fix(blocker): ...`.
