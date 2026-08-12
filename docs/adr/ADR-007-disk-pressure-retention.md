# ADR-007 — Disk-pressure retention behavior

- **Status:** Accepted
- **Date:** 2026-08-12
- **Deciders:** PM (PM ratification 2026-08-12)
- **Closes:** D-15 (Disk-pressure retention behavior) — `docs/discovery/open-decisions.md` §2, §11

## Context

A-20 fixes auto-delete at 14 days, but the open question was what happens when the
disk fills *before* 14 days:

> *"what happens when the disk fills *before* 14 days (legacy: hardcoded 80 %
> threshold, delete >7-day-old files **including never-uploaded ones**)? Delete
> early (which files first?), block new recordings, or both?"* — D-15, register

The legacy cleanup cron ignored upload status (B-20) and its Home warning was tied
to the 80 % threshold with misleading copy (B-53). The decision defines a retention
job, a lecturer-facing warning, and a recording-start precondition:

> *"Latest phase without rework: Phase 3 — the refused-start rule is a state-machine
> transition and the warning is a Phase-2 dashboard element … reversing 'never
> delete un-uploaded' later changes the retention job only (cheap), while removing
> the refused-start state later touches contract + UI."*

## Decision

At a configured pressure threshold:
1. **Delete already-uploaded recordings oldest-first**, even if younger than 14 days.
2. **Never auto-delete a never-uploaded recording** — data safety invariant.
3. When **critically full with nothing eligible to delete**, **refuse new recording
   starts** with a clear dashboard warning.

The mock simulates both the warning and the refused-start state.

## Consequences

### Positive
- Never silently loses un-uploaded work — the strongest data-safety property, and
  the direct fix for B-20's status-blind cleanup.
- The refused-start state and honest warning copy fix B-53's misleading threshold UI.
- "Never delete un-uploaded" is cheap to loosen later; the safe default is chosen now.

### Negative / trade-offs
- A device full of un-uploaded recordings (e.g. upload endpoint down for a long
  time) will **refuse new recordings** rather than overwrite. This is intended, but
  operationally means upload-path outages can block recording — mitigated by the
  dashboard warning surfacing early, and by immediate-upload (D-13) keeping dwell low.

### Ripple — artifacts this touches (LIST ONLY; do not apply here)
- [ ] **Retention job design** in core-api (Prompt 11): threshold config,
      uploaded-oldest-first eviction, never-touch-un-uploaded rule — matrix §3
      "Storage cleanup cron" row.
- [ ] **Recording-start precondition** (`docs/design/state-machines.md`): a start can
      be refused for disk space — a new transition/guard.
- [ ] **Dashboard storage warning** (Phase 2, §5.1 item 7): copy must state the real
      policy (B-53's lesson); verify the mock's warning + refused-start scenarios.
- [ ] **`LocalStoragePage`** capacity semantics reflect the threshold model.

### Contract impact
**Possible — reconcile at Prompt 12.** The refused-start state may need a
`Problem['code']` (e.g. disk-critical) so the panel can render it; flag this at the
drift review. No change applied now.
