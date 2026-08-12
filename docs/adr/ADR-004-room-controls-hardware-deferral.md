# ADR-004 — Room-controls hardware (projector/lights/AC): deferred, UI placeholder only

- **Status:** Deferred (documented default; revisit post-launch)
- **Date:** 2026-08-12
- **Deciders:** PM + hardware engineer. Architect records the deferral.
- **Documents:** D-10 (Room-controls hardware) — `docs/discovery/open-decisions.md` §2
- **Revisit by:** **Post-launch (Phase 5+)**

## Context

Control pipelines for room devices (projector power, lights, AC) are not ready:

> *"hardware engineer reports control pipelines 'still in progress'."* — D-10, register

Critically, nothing in this release depends on them:

> *"Blocks (concrete): nothing in this release (PM confirmed) — matrix §4 'Room
> Controls' row ships `room/RoomControlsPanel` as placeholder (master mic mute is
> the only live control, owned by the real-mic-control row)."*

This is a **deliberate deferral**, recorded here so the placeholder is a conscious
choice, not an unfinished feature.

## Decision

**Ship Room Controls as a UI placeholder only; no backend for lights/AC/projector
power.** The single live control on the panel is **master mic mute** (real,
owned by the mic-control row — not part of this decision). Physical projector/
lights/AC control is deferred to post-launch, pending the hardware engineer's
control pipelines.

## Consequences

### Positive
- No dependency on in-progress hardware; the panel ships complete with a clearly
  non-functional placeholder rather than blocking on an unready subsystem.

### Negative / trade-offs
- Users see controls that do not act on hardware yet. Mitigation: the placeholder
  must read as "coming soon," not as a live control (UI copy/disabled affordance).

### Ripple — artifacts this touches (LIST ONLY; do not apply here)
- [ ] **None blocking.** When revisited post-launch: a control backend for
      projector/lights/AC and the wiring of `room/RoomControlsPanel` to it.
- [ ] **Note (independent of D-10):** §5.1 item 6 suggests Room Controls as the home
      for the power-off button; that placement does **not** depend on this decision
      and can proceed on its own.

### Contract impact
**None now.** No `contracts/` element depends on room-control hardware; a future
control API would be designed and drift-reviewed when the decision reopens.
