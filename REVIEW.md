# Review bar for Dwell

What failure looks like here: a second counted for the wrong site, or not counted when I was on the page; a number on the dashboard that another number on the same screen contradicts; anything leaving the browser; a page that blanks or drops keyboard focus.

Skip: `handoff/`, `dist/`, `coverage/`, `release/`, `docs/screenshots/`, `design/canvas/`.

Read both sides of every contract: the engine and `tests/support/oracle.ts`, the log encoder (`src/background/log.ts`) and decoder (`src/tracker/replayLog.ts`), the message parser (`src/shared/messages.ts`) and the authoriser, the hot-state writer and `src/background/state.ts`.

## Bug classes seen

- An event that silently rewrites state it does not own (attention rewriting the active tab).
- A signal that only reaches tabs the engine already knows: a fresh state must learn every window, not just the focused one.
- A rank that outlasts its evidence: a single wheel tick holding the count for the whole idle threshold.
- Two rules for the same figure on one screen (a site's change in the headline and in its Most used row).
- A copy of a window or average rule instead of reading the aggregate's own.
- A label that names the wrong owner of a figure ("Week total" over one site's time).
- An element unmounted while focused, so the keyboard falls back to the page.
- A test that passes before the fix: run it against the old code first.
