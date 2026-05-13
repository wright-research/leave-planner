# DepletionSked

A personal web app that replaces the **Depletion Schedule** spreadsheet used to track work-provided transit funds (FSA) and leave balances (annual + sick). Ported from a Google Sheet → XLSX → web app so the model can be edited from any device and lives outside a spreadsheet.

The original spreadsheet (`Depletion Schedule.xlsx`) is kept in the repo root as the reference implementation. Any behavior not documented here should be checked against it.

## What the app does

Three things, in one view:

1. **Transit trip runway.** Tracks how many commute trips remain on the MARTA card(s) and projects up to three future depletion dates, assuming hypothetical max reloads at each.
2. **FSA fund runway.** Projects the transit FSA balance forward through those hypothetical reloads so the user can see whether the FSA will bottom out or pile up over a 12-month horizon.
3. **Leave projections.** Current and 1-year-out balances for Annual Leave (AL) and Sick Leave (SL), accounting for biweekly accruals and planned time off.

The app is a planning tool, not an automation tool. It never reloads the card itself — the user reloads online whenever they choose and then logs it here.

### Why D2 and D3 matter (the November use case)

Each November the user can adjust their FSA election for the following year. The three-depletion-date projection exists specifically for that decision: looking ~12 months ahead, does the FSA balance grow unsustainably (election too high), or would it run dry mid-year (election too low)? D2 and D3 are computed assuming a **hypothetical max reload** (up to $345, partial if FSA is short) at each prior depletion — not a prediction the user will reload then, just a "what if nothing changes" baseline.

## Domain model

### Transit: three pools

The card stack is three separate balances. The app tracks all three.

| Pool | Starts at | Trip cost | Cap | Refillable? |
|---|---|---|---|---|
| **New-card pass trips** | 20 | $3.50 | 70 trips (7 booklets × 10) | Yes, via FSA reload |
| **New-card cash value** | $0 | $4.00 | $100 | Yes, via FSA reload |
| **Old-card cash value** | $96 | $4.00 | — | No — drains and disappears |

**Consumption order on a commute day (2 trips each):**
1. New-card pass trips first (cheapest).
2. Old-card cash next (retire the legacy card).
3. New-card cash last.

**Card hard caps** are physical MARTA limits, not policy. A fully loaded new card = 7 booklets ($245) + $100 cash = $345 FSA spend. This is where the spreadsheet's `MaxReloadCost = 345` comes from.

### Commute schedule

- Default commute days: **Monday, Tuesday, Wednesday.** Each commute day consumes 2 trips (round trip).
- Per-day overrides: a day can be flipped off (holiday, PTO, remote, conference, sick) or flipped on (unusual in-office day).
- The spreadsheet encodes overrides by hardcoding `"Yes"`/`"No"` directly on top of the commute formula. The app should model this as an explicit override field distinct from the default rule so the two are distinguishable.

### FSA contributions

Two inflows, applied to `fund_balance` via the calendar:

- **Paycheck contribution** (default $16.25): deposits on the **first and second paycheck Fridays of each calendar month**. If a month contains a third paycheck Friday (happens ~2×/year), that one is skipped. Always 2 per month, never 3.
- **ARC contribution** (default $40): deposits on the **1st of each calendar month**.

### Reloads (manual)

Reloads are **not simulated by the app**. The user decides when to reload online, then updates inputs to reflect the new card state. The app computes:

- **Projected depletion date:** the date the current pool (passes + all cash) runs to zero if the user does nothing. Planning signal only.
- **Projected FSA balance on that date:** so the user knows how much they can spend when they do reload.

Optional ergonomic affordance: a **"Log a reload"** form that takes *(booklets added, cash added, FSA spent)* and updates `pass_balance`, `cash_balance`, and `fund_balance` atomically, plus appends to a reload history table. Sugar over manual input edits.

### Leave

- **Accruals are biweekly, always:** 4.5 hrs AL and 3.0 hrs SL per pay period end, every other Sunday. Pay periods always end on biweekly Sundays regardless of holidays; anchored to 2026-01-11. Unlike FSA, leave accrual is independent of the paycheck-Friday schedule.
- **Caps (agency hard limits):**
  - **AL: 360 hours.** Projection is shown unclipped so the user can see how far over they'd go; UI flags the projected number gold at ≥90% of cap and red if it would exceed.
  - **SL: 525 hours.** Projections clip at 525 — that reflects real policy. If a projected balance would exceed 525 in the next 12 months, the excess is lost. UI flags gold at ≥90% and red when any hours would be lost.
- **PTO entry:** per-day hours (typically 7.5 for a full day or 3.75 for a half day), recorded against AL or SL. UI should support date-range entry that fans out to the underlying daily records.

## State: inputs vs. constants

There are two kinds of "inputs." Only the first is user-editable at runtime.

### User-editable (stored in Supabase, shown in UI)

The authoritative "as of now" state. The user updates these when real-world numbers change.

| Field | Value on 2026-04-22 | Notes |
|---|---|---|
| `pass_balance` | 20 | pass trips remaining on new card |
| `cash_balance` | 96 | total stored cash (all cards) |
| `fund_balance` | 221.79 | FSA |
| `annual_balance` | 115.25 | AL hours |
| `sick_balance` | 119.75 | SL hours |

### Constants (in `constants.js`, edited in code when policy changes)

Everything else lives behind the scenes. Changing any of these is a code edit + redeploy, which is fine because they shift rarely (e.g., AL accrual rate jumps to 5.5 in ~2 years).

| Constant | Value |
|---|---|
| `TRIP_COSTS.pass` | 3.50 |
| `TRIP_COSTS.cash` | 4.00 |
| `BOOKLET_COST` | 35 |
| `CARD_CAPS.booklets` | 7 |
| `CARD_CAPS.cashValue` | 100 |
| `MAX_RELOAD_COST` | 345 (derived) |
| `FSA.paycheckContribution` | 16.25 |
| `FSA.arcContribution` | 40 |
| `LEAVE.annualAccrual` | 4.5 |
| `LEAVE.sickAccrual` | 3.0 |
| `LEAVE.annualCap` | 360 |
| `LEAVE.sickCap` | 525 |
| `PAYCHECK_ANCHOR` | 2026-01-02 |
| `LEAVE_ACCRUAL_ANCHOR` | 2026-01-11 |

Terminology note: the spreadsheet spells it "Accrural." The app uses "Accrual."

## Calendar

One record per day (roughly 2 years forward-rolling, generated on demand). Per-day fields:

- `date`, `weekday` (derived)
- `is_commute` — resolved from default rule (Mon/Tue/Wed) + optional override
- `notes` — freeform string (holidays, trip names, sick reasons)
- `annual_used`, `sick_used` — hours, nullable
- derived: trips needed (2 if commute, else 0), FSA deposit for that day, leave accrued for that day

### Historical data

Past entries are preserved (useful for looking back at leave burn). UI default is **forward-only**, with a "Show historic data" toggle. Past entries remain **editable** — you can backfill a forgotten sick day or cancel a past trip entry.

**Important distinction:** editing past calendar entries is **record-keeping only**. It does **not** retroactively change the `sick_balance`, `annual_balance`, `pass_balance`, `cash_balance`, or `fund_balance` fields — those are authoritative "as of now" values (HR/the card/the FSA already reflect reality). Only **future** calendar entries flow into projections. If the user corrects a balance because the real-world number changed, that's a separate edit to the balance field itself.

## Projections (computed)

- **Depletion date D1** = the first future date on which the current pool (passes + cash) hits 0, walked day-by-day with pass-first consumption.
- **D2** = depletion date after a **hypothetical max reload** at D1. Reload spends `min(FSA_at_D1, 345)` via the partial-reload algorithm (see `computeReload` in `lib/projections.js`): booklets first (up to 7), remainder to cash (up to $100).
- **D3** = same, at D2. Beyond D3 isn't needed — the November FSA-election planning window is ~12 months.
- **FSA balance at each D** = carried through the hypothetical reloads.
- **AL in 1 year** = `annual_balance + sum(accruals next 365d) − sum(planned AL use next 365d)`. Shown unclipped; cap (`LEAVE.annualCap = 360`) drives only the warn/danger color.
- **SL in 1 year** = same, clipped at `LEAVE.sickCap = 525`. Excess is lost per ARC's use-it-or-lose-it policy.
- **Week equivalents** for leave: `hours / LEAVE.hoursPerWeek` (37.5).

## Stack

- **Frontend:** vanilla JS + ES modules, single `index.html` + `app.js` + `style.css` + `lib/`. No build step. Supabase client imported from `esm.sh` CDN.
- **Storage:** Supabase (Postgres + Auth). Normalized schema — `balances` (singleton per user), `calendar_entries` (sparse overrides), `reload_log` (append-only). Row-level security keyed on `auth.uid()`. See `supabase/schema.sql`.
- **Auth:** Supabase email magic link. Single user account.
- **Deploy:** GitHub Pages, static files. `git push` is the entire pipeline.
- **Config:** `config.example.js` → copy to `config.js` (gitignored) with Supabase URL + anon key.

## File layout

```
DepletionSked/
├── CLAUDE.md
├── Depletion Schedule.xlsx     # reference, delete after history backfill
├── index.html                  # UI shell
├── app.js                      # entry, auth, event wiring, render dispatch
├── style.css
├── constants.js                # rates, caps, trip costs, accrual rates — edited in code
├── config.example.js           # Supabase credentials template
├── config.js                   # real credentials (gitignored)
├── lib/
│   ├── supabase.js             # client init, auth helpers
│   ├── store.js                # pub/sub state, load/mutate
│   └── projections.js          # pure math: depletion walk, reload algo, leave projections
└── supabase/
    └── schema.sql              # run once in Supabase SQL editor
```

## UI approach

Three stacked zones:

1. **Top — Projections card.** D1/D2/D3 depletion dates with FSA balance at each, AL and SL hours today + 1 year out, weeks-equivalent. The reason the user opens the app.
2. **Middle — Balances + Log a reload.** Inline-editable `pass_balance`, `cash_balance`, `fund_balance`, `annual_balance`, `sick_balance`. A **Log a reload** button opens a dialog that takes *(booklets added, cash added, FSA spent)*, applies them atomically to the three transit/FSA balances, and appends a row to `reload_log`.
3. **Bottom — Agenda-style calendar.** One row per day matching filters (default: forward-only, commute days only, weekdays). Inline-editable commute toggle, PTO hours, notes. Date-range PTO entry via the PTO dialog fans out into per-day `calendar_entries` rows.

Not a month-grid calendar. Agenda list matches the data model and is faster to edit.

## Open questions / TBD

- **Calendar generation horizon** — projections need ~18 months forward to compute D3 reliably. Generated on the fly, not stored; only `calendar_entries` overrides are persisted.
- **Holiday list** — federal/ARC holidays are currently free-form notes with manual commute overrides. Could become a built-in list later.
- **Historic data backfill** — the XLSX has Jan–Apr 2026 PTO/notes history. Worth importing into `calendar_entries` once the app is working, then the XLSX can go.
- **Cash pool detail** — internally the app treats cash as a single pool. The stranded $96 on the old card is functionally indistinguishable from new-card cash for projection math. If a reload accidentally pushes total cash over $100 + stranded amount, that's a real-world impossibility the user wouldn't do anyway, so no enforcement needed.

## Source of truth

**CLAUDE.md is authoritative.** Rules have diverged from the XLSX (differential trip costs, 2-per-month FSA cap, SL cap enforcement, D2/D3 as hypothetical-reload projections, manual reloads). The spreadsheet remains in the repo only until its historical PTO/notes log is backfilled into the app.
