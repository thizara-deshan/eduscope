# ADR-016 — Recording session model: metadata, one-tap start, pause semantics

- **Status:** Accepted
- **Date:** 2026-08-12 (recorded); A-12 PM-confirmed
- **Deciders:** PM + architect
- **Documents:** A-07, A-12 — `docs/discovery/open-decisions.md` §4

## Context

Two decisions define how a recording session begins and behaves:

- **A-07 — Session metadata:** *"No lecturer input at start. Hall name hardcoded per
  device … title generated as `[Hall] – [Date] [Time]` … Module dropped. One-tap
  start."* (⚠ hall code + exact pattern is fact-check P-1.)
- **A-12 — Pause semantics:** *"Consumer stop/restart; separate file segments joined
  by the system — PM-confirmed."*

Together they replace the legacy metadata form (B-16), filename-as-metadata (B-02),
and the groupid/merge bookkeeping (B-09/B-10/B-34, including its ship-unmerged race).

## Decision

- **One-tap start, no metadata form.** Title is generated `[Hall] – [Date] [Time]`;
  hall code comes from the deploy-layer config store ([ADR-011](ADR-011-provisioning-powers-home.md)).
  Module is dropped.
- **Pause = consumer stop/restart**, producing separate file segments that **the
  system joins** into one recording — no user-triggered merge.

## Consequences

### Positive
- Fastest possible start (product goal); nothing to fill in.
- System-owned segment joining removes the legacy ship-unmerged race (B-34) and the
  groupid bookkeeping.

### Negative / trade-offs
- Generated titles depend on correct device time ([ADR-009](ADR-009-device-time-ownership.md))
  and a correct hall code (P-1 fact-check) — both load-bearing.
- Segment-join must be crash-safe: a crash mid-session must still reconcile segments
  (crash-recovery is a "keep" inventory item).

### Ripple (LIST ONLY)
- [ ] **Recording state machine** (`docs/design/state-machines.md`): pause →
      stop-consumer/restart-consumer → segment list; system join on stop.
- [ ] **core-api**: persisted session state across restart (B-03/B-07/B-08); segment
      manifest feeds the upload payload ([ADR-023](ADR-023-recording-storage-retention-upload.md)).
- [ ] **P-1 fact-check:** confirm hall code + exact title pattern (SLIIT-001 vs LAC001).

### Contract impact
**Possible — reconcile at Prompt 12.** Split-segment pause bookkeeping (A-12) is a
named likely-drift item; confirm the recording/session shape at the drift review.
