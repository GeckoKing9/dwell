# Dwell design system

Dwell shows how long each website holds your attention, the way Screen Time does for apps, and lets you switch off Reels and Shorts. One owner, one Chrome profile, nothing leaves the browser. The interface should read like a precise instrument kept by a careful person: quiet neutrals, one accent, real units everywhere.

Source of truth: `prototype.html`. Every hex below is parsed out of that file by `tools/contrast.py`, and `tools/build_screens.py` regenerates `screens/` from it, so the document, the prototype and the artboards cannot drift.

## 1. Colour tokens

Neutrals lean slightly toward the accent's teal so the greys feel chosen, not defaulted. The accent ("lume teal") is reserved for three meanings only: **today**, **the selected or busiest item**, **a switch that is on**. It never marks good or bad.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--page` | `#EDF0F0` | `#0E1314` | Page plane behind panels |
| `--surface` | `#FBFCFC` | `#161D1E` | Panels, popup body (elevation 1) |
| `--surface-2` | `#E3E8E8` | `#1E2728` | Recessed wells, nav pill, switch-off context (elevation 0 / inset) |
| `--surface-3` | `#FFFFFF` | `#273133` | Tooltips, switch knob (elevation 2) |
| `--ink` | `#131D1F` | `#E4ECEB` | Primary text, numbers |
| `--ink-2` | `#465355` | `#AAB7B5` | Secondary text, units, labels |
| `--ink-3` | `#5B6869` | `#8D9B99` | Muted captions, axis labels, placeholders |
| `--accent` | `#0E877D` | `#35B8A9` | **Graphics only**: today bar, peak hour, switch on, LED |
| `--accent-text` | `#0A6B63` | `#56CDBF` | **Text only**: "Today" label, quiet buttons |
| `--accent-wash` | teal 12% | teal 15% | Letter-mark circles, quiet-button hover |
| `--bar` | `#78878A` | `#6C7B7A` | Every non-highlighted data mark, switch off |
| `--bar-hover` | `#5A696B` | `#8E9D9C` | Hovered bar |
| `--dot` / `--dot-faint` | `#B9C3C3` / `#D7DEDE` | `#3A4647` / `#263031` | Time-dot motif (decorative) |
| `--rule` | `#D6DDDD` | `#263031` | Row dividers inside panels |
| `--inverse-bg` / `--inverse-fg` | ink / surface | `#E4ECEB` / `#0E1314` | Paused band, paused status pill, destructive confirm |
| `--top-light` | none | white 7% | Dark-mode 1px top highlight on raised surfaces |

Status colours do not exist. There is no red, amber or green state anywhere: nothing in this product is a warning.

## 2. Contrast (computed, not eyeballed)

`python3 tools/contrast.py prototype.html` reads both palettes from the shipped CSS, checks that the two dark blocks are identical, and computes WCAG 2.x ratios for every text/surface pair that occurs in the UI, plus alpha-blended surfaces (letter-mark wash, paused-band button). Text needs 4.5:1, graphics 3:1. All pairs pass.

**Light**

| fg \ bg | page | surface | surface-2 | surface-3 | other |
|---|---|---|---|---|---|
| ink (text) | 14.98 | 16.70 | 13.88 | 17.17 | accent-wash/surface 14.38 |
| ink-2 (text) | 6.97 | 7.77 | 6.46 | 7.99 |  |
| ink-3 (text) | 5.05 | 5.63 | 4.68 | 5.79 |  |
| accent-text (text) | 5.56 | 6.20 | 5.15 | 6.37 | accent-wash/surface 5.34 |
| inverse-fg (text) |  |  |  |  | inverse-bg 16.70, inverse-btn/inverse-bg 10.20 |
| stage-ink (text) |  |  |  |  | stage 7.00 |
| bar (gfx) |  | 3.63 | 3.01 | 3.73 |  |
| bar-hover (gfx) |  | 5.57 |  |  |  |
| accent (gfx) | 3.83 | 4.27 | 3.55 |  |  |

**Dark**

| fg \ bg | page | surface | surface-2 | surface-3 | other |
|---|---|---|---|---|---|
| ink (text) | 15.60 | 14.24 | 12.72 | 11.12 | accent-wash/surface 11.03 |
| ink-2 (text) | 9.05 | 8.26 | 7.38 | 6.45 |  |
| ink-3 (text) | 6.49 | 5.93 | 5.29 | 4.63 |  |
| accent-text (text) | 9.70 | 8.86 | 7.91 | 6.92 | accent-wash/surface 6.86 |
| inverse-fg (text) |  |  |  |  | inverse-bg 15.60, inverse-btn/inverse-bg 12.17 |
| stage-ink (text) |  |  |  |  | stage 9.54 |
| bar (gfx) |  | 3.87 | 3.45 | 3.02 |  |
| bar-hover (gfx) |  | 6.07 |  |  |  |
| accent (gfx) | 7.65 | 6.98 | 6.24 |  |  |

Worst pairs: light text `ink-3` on `surface-2` 4.68; light graphics `bar` on `surface-2` 3.01; dark text `ink-3` on `surface-3` 4.63; dark graphics `bar` on `surface-3` 3.02. The time-dots sit at 1.75:1 in both modes on purpose: they are a ruler, not data, and every value they help read is also printed as text (axis labels, totals, tooltips).

Accent split: one teal cannot be both a 3:1 bar fill and a 4.5:1 label on these surfaces, so `--accent` fills marks and `--accent-text` sets type. Never swap them.

## 3. Type

- **Hanken Grotesk** (300 to 700) for everything, including the hero figures. A soft, slightly humanist grotesk: calm at 56px, legible at 11px, full French diacritics.
- **IBM Plex Mono** (400, 500) for domains only. Domains are identifiers; mono makes `docs.google.com` and `mail.google.com` scan as data, and is the one place the owner's technical fluency shows.
- Duration units are typeset smaller than their digits (`2`h `13`m, unit at 0.56em in `--ink-2`). The number carries the weight, the unit stays legible. Durations are joined with no-break spaces so "3h 32m" never splits across lines.
- Tabular figures in columns (most-used, categories, axis); proportional figures for standalone hero numbers.

| Step | Size | Use |
|---|---|---|
| 11 | 0.6875rem | Chart labels, chips, eyebrow labels |
| 12 | 0.75rem | Captions, asides, tooltips |
| 13 | 0.8125rem | Dense rows (domains, settings descriptions) |
| 14 | 0.875rem | Body |
| 16 | 1rem | Panel titles, privacy prose |
| 20 | 1.25rem | Week range, day title |
| 28 | 1.75rem | Secondary stat, page titles |
| 40 | 2.5rem | Popup hero (weight 400) |
| 56 | 3.5rem | Dashboard hero (weight 350) |

Measure: privacy prose is capped at 31.5rem, which renders 61 to 72 characters per full line in EN and FR (measured in the browser, see report).

## 4. Spacing and radius

Spacing scale: 4, 8, 12, 16, 24, 32, 48. Siblings use `gap`, never margins. Side gutter is `max(16px, safe-area)`.

Radius follows nesting, outer = inner + padding, so corners stay concentric:

| Radius | Where |
|---|---|
| 4px | Data ends (bar caps), code chips |
| 6px | Controls: buttons, inputs, segmented items |
| 8px | Wells inside panels, the popup frame, tooltips |
| 14px | Dashboard panels (8 + 6 inset) |
| pill | Switches, category chips, status pill |

## 5. The motif: time-dots

One ornament, and it carries meaning. Every chart column sits in a channel of dots where **each dot is a real unit of time**, stated in the chart's caption:

- Popup 7-day chart: 1 dot = 30 minutes; every hour dot is larger.
- Dashboard week chart: 1 dot = 15 minutes; hour dots larger, labelled 2h / 4h / 6h.
- Day view: 1 dot = 5 minutes; an hour column holds 12 dots, so the scale is fixed at 60 minutes and can never lie.

The same dots reappear as the unfilled track behind every proportional bar (top sites, most used, categories), as one dot per Reels/Shorts redirect in the Blocked panel, and in the wordmark glyph (two dots over a short bar). Days without data keep their dots and lose the bar, so "nothing recorded" looks like an empty ruler, not like zero. Future days and hours show fainter dots.

## 6. Elevation

- **Light:** panels are `--surface` on `--page` with a 1px 10% ink edge and a 1px shadow. Tooltips and the popup add a soft drop shadow.
- **Dark:** a separate mechanic. Elevation is tonal (page `#0E1314` < surface `#161D1E` < surface-2 `#1E2728` < surface-3 `#273133`) plus a **1px top highlight** (`inset 0 1px 0 rgba(255,255,255,.07)`) on raised things only: panels, popup, tooltips, buttons, selected segments. Recessed wells (the "This site" card) get the tonal step and **no** highlight. The palette is chosen per mode, not inverted: the dark accent is lighter and the bars greyer.

## 7. Charts

- **Form.** Daily and hourly totals are single-series magnitude: columns, one neutral hue, with emphasis (not categories) for the one bar that matters: today in the week charts, the busiest hour in the day view. Categories are horizontal bars sorted by time, never a pie.
- **Marks.** Bars at most 24px wide (18px in the popup, 16px hourly), 4px rounded data end, square at the baseline. No borders around marks. No gridlines; the dot channel is the scale.
- **Reference.** The week chart draws the daily average (full days only) as a 1px solid `--ink-3` line labelled "avg 3h 32m", with a surface-coloured halo behind the label.
- **Labels.** Day name and its total sit under each column, so no value depends on hover. Today is labelled "Today" in `--accent-text`.
- **Hover and focus.** Each column's hit area is its whole band (bigger than the mark). The bar lightens and a tooltip shows the value first, the date second, then the top three sites. Same on keyboard focus. Week columns open the day view on click, Enter or Space. Tooltips are built with `textContent` only.
- **Empty.** No data: dots only, label "No data". Older than 90 days: faint dots, "Not kept". Future: faint dots, no label.

## 8. Copy rules

Follows `ethical-habit-design`: this is a private tool serving its owner, so it reports and never coaches.

- Deltas are plain information with the comparison base named: "Daily average is 19% higher than the week before (3h 32m)." Within 3% it says "about the same". No arrows in red or green, no "great job", no "you failed".
- Partial periods are compared fairly: the current week's per-site changes compare Mon to today with the same days last week, and the panel says so. Averages use full days only.
- The one acknowledgement line is specific and factual: "Quietest day: Monday 2h 47m. Busiest: Tuesday 5h 36m."
- Gaps are explained, never blamed: "No data for Sat, Sep 26, Sun, Sep 27. Chrome was closed or tracking was paused; averages use the 5 recorded days."
- No streaks, goals, limits, scores, confetti or urgency. Nothing turns a number red.
- Popup comparison is like-for-like: "Usually 1h 55m by this time of day" (mean of the last 7 days up to the current minute), then the 7-day average.
- Controls say what happens: "Open dashboard", "Resume", "Export JSON", "Delete all data" / "Keep data".
- Every string lives in the EN/FR table; French runs 25 to 40% longer and every layout has been checked with it.

## 9. States

| Surface | State | Treatment |
|---|---|---|
| Popup | Normal | Hero, comparison, 7-day chart, top 3, this site, footer |
| Popup | First run | "Nothing recorded yet" + how counting works; empty dot channels; "Your top sites appear after a few minutes" |
| Popup | Paused | Inverse band at top with pause glyph and Resume; hero goes to `--ink-2` and reads "Recorded today before pausing"; today's bar turns neutral; "This site" says "Not recording while paused"; footer turns to surface-2 with the switch on and labelled "Paused". Blockers keep working. |
| Popup | Not trackable | "New tab. Browser pages such as new tabs and settings aren't recorded." No blocker row. |
| Popup | No blocker | Same card without the blocker row. Nothing is advertised. |
| Dashboard | Gap in week | Days show "No data"; the gap note explains and averages exclude them |
| Dashboard | Paused | Status pill turns inverse: "Tracking paused" |
| Dashboard | All data deleted | Every view falls back to its empty copy; Reseed on the stage restores the sample |

## 10. Component inventory

Stat (hero / secondary) with typeset units · week navigator (prev/next, range via `Intl.DateTimeFormat.formatRange`, "This week / Last week / N weeks ago", disabled past week 12) · week chart · hourly chart · popup 7-day chart · tooltip · site row (letter mark, mono domain, time, dot track) · most-used row (rank, mark, domain + track, category chip, time, share, change, visits; collapses to one meta line under 620px via container query) · category row · blocked panel (count + one dot per redirect) · this-site well with blocker row · switch (`role="switch"`) · segmented radio group · chip and removable chip · domain input with inline validation · in-page confirmation (no `confirm()`) · paused band · status pill · settings row · permission list.

## 11. Data and simulation

Designed against the real model only: `seconds` per (day, hour, domain), `visits` per (day, domain), `blocked` per (day, site in instagram/youtube/facebook), plus settings. The prototype generates 90 days with a seeded `mulberry32` PRNG (seed 20261014, "Reseed" on the stage): per-site Gaussian hour profiles (work daytime, social and video evenings, streaming late), weekend multipliers, day totals clamped to 2h to 7h, two near-empty days (Aug 22, Sep 9) and a two-day gap (Sep 26 to 27). Today is Wed Oct 14 2026, 4:40 pm, so later hours are empty. Weeks start Monday.
