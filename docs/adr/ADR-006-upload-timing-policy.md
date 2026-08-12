# ADR-006 — Upload timing policy: immediate auto-upload, no windows

- **Status:** Accepted
- **Date:** 2026-08-12
- **Deciders:** PM + institute IT (PM ratification 2026-08-12)
- **Closes:** D-13 (Upload timing policy: immediate vs windowed) — `docs/discovery/open-decisions.md` §2, §11

## Context

A-19 established that recordings auto-upload, retiring the legacy instant/scheduled
toggle. The open question was whether the institute needs upload *windows* for
bandwidth protection and whether manual re-enqueue is an operator action:

> *"does the institute need upload *windows* (bandwidth protection during teaching
> hours), and is per-file manual re-enqueue an operator action?"* — D-13, register

Legacy carried windowed uploads with positional settings rows (B-22) and a fake
"instant" mode that was a silent no-op (B-30, not carried). The decision shapes the
queue service and whether an upload-schedule card exists in the Admin UI at all:

> *"Latest phase without rework: Phase 3 — the queue service design either has a
> scheduler or it doesn't; adding windows in Phase 4 also retrofits the Admin UI."*

The PM (with institute IT, who own the network-load concern) ratified the default.

## Decision

**Immediate auto-upload on recording finish**, resumable with retries. **No upload
windows, no toggle.** The upload-queue view includes a **per-file manual re-enqueue**
action (replacing B-35's hardcoded endpoint). The mock adapter simulates uploads
starting right after stop.

## Consequences

### Positive
- Queue service design is simpler — a drain-as-you-go worker, no scheduler, no
  wrap-around-midnight window semantics (B-22 dropped).
- No upload-schedule card needed in the Admin UI; one less privileged surface.
- Recordings reach the institute as soon as possible, minimizing on-device dwell
  (aligns with the 14-day retention, A-20, and disk-pressure policy, D-15/ADR-007).

### Negative / trade-offs
- **No teaching-hours bandwidth protection.** If the institute network suffers under
  daytime uploads, adding windows later retrofits both the queue service and the
  Admin UI (the timing note's expensive path). Institute IT accepted this at
  ratification.

### Ripple — artifacts this touches (LIST ONLY; do not apply here)
- [ ] **Upload job-queue service design** (Prompt 11): drain-on-finish worker,
      resumable + retries, no scheduler — matrix §5.2 item 8.
- [ ] **Upload-queue status view** (Phase-2 gap, §5.1 item 2): include the per-file
      manual re-enqueue action.
- [ ] **Drop** B-22 window semantics and the `fmupload` schedule vocabulary; keep
      manual re-upload as re-enqueue (§2c veto released).
- [ ] Couples to D-14/ADR-003 (auto-shutdown) — now moot, since there is no nightly
      batch to shut down after.

### Contract impact
**Deferred to Prompt 12 if any.** Upload lifecycle elements carry the `[D-02b]` tag
already; this decision adds no new contract shape (re-enqueue is a queue action,
reconciled at the drift review alongside the real upload spec).
