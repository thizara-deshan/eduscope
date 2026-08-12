# ADR-009 — Device time / NTP / timezone ownership: deploy layer owns it

- **Status:** Accepted
- **Date:** 2026-08-12
- **Deciders:** PM + institute IT staff (PM ratification 2026-08-12)
- **Closes:** D-17 (Time / NTP / timezone ownership) — `docs/discovery/open-decisions.md` §2, §11

## Context

The open question was who owns device time — an Admin UI page or the deploy layer:

> *"who owns device time — an Admin UI page, or the deploy layer (preconfigured
> NTP/timezone) with at most a read-only display?"* — D-17, register

Legacy's time pickers were placebo (`sys.jsx` only `console.log`, B-55), but correct
time is load-bearing: it drives generated titles (A-07), 14-day retention (A-20),
upload behavior, and log timestamps. The decision affects both the Phase-2 Admin UI
page list and the Phase-3 deploy layer:

> *"Latest phase without rework: Phase 2 for the UI question (page exists or not);
> Phase 3 for the deploy-layer mechanism."*

## Decision

**The deploy layer owns device time** — NTP + timezone configured at provisioning.
The Admin UI shows **current time / sync status read-only** (a line on an existing
page, not a page of its own). **No user-editable clock.**

## Consequences

### Positive
- Correct time is guaranteed by provisioning, protecting titles, retention, and log
  trustworthiness — no operator can break it with a placebo picker (B-55's failure).
- No new Admin page; a read-only status line is cheap.

### Negative / trade-offs
- A room with no NTP reachability depends on provisioning getting timezone/offline
  clock right; there is no in-UI correction. Acceptable for a managed campus deploy;
  institute IT owns the NTP source.

### Ripple — artifacts this touches (LIST ONLY; do not apply here)
- [ ] **Deploy-layer provisioning spec** (Prompt 11): chrony/NTP + timezone
      (`Asia/Colombo` assumption, B-22) set at install.
- [ ] **Admin UI**: read-only time/sync status line on an existing page; no
      System/Time page — matrix §1a System-page RETIRE row, §5.1 item 8.
- [ ] **SystemLogs**: timestamps now trustworthy (§4 System Logs row).

### Contract impact
**None to minimal.** If the read-only status is served via an existing device-status
endpoint, confirm the field at Prompt 12; no new contract shape now.
