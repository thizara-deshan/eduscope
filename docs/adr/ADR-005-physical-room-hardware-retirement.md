# ADR-005 — Physical room hardware (record button + 4-way camera switch): retired

- **Status:** Accepted
- **Date:** 2026-08-12
- **Deciders:** PM + hardware engineer (PM ratification 2026-08-12)
- **Closes:** D-12 (Physical room hardware: record button + 4-way camera switch) — `docs/discovery/open-decisions.md` §2, §11

## Context

Two pieces of physical room hardware exist half-wired in the legacy system and the
question was whether the rewrite must support them or retire them:

> *"are the GPIO record button (B-13) and the 4-way camera-switch button (B-62
> `indicators` writer) live hardware in deployed rooms that the rewrite must
> support, or dead half-wired features to retire?"* — D-12, register

Both are inert today: the button flips a DB flag nothing reads, and the switch
writes rows with no reader. The decision matters *now* because it defines
pipeline-manager scope:

> *"Latest phase without rework: Phase 3 — pipeline-manager design must include the
> GPIO event path if kept; resurrecting it in Phase 4 reopens the state machine and
> the design doc."*

The PM (product) and hardware engineer (is it wired on the new Radxa build?)
ratified the default.

## Decision

**Retire both.** Recording is controlled from the touch panel only. The
pipeline-manager (Prompt 10) gains **no GPIO event input**, and the recording state
machine gains **no hardware-initiated stop/switch transition**. The record-LED is
**not** part of this decision and remains kept (B-05).

## Consequences

### Positive
- Pipeline-manager and recording state machine stay simpler — panel is the single
  control surface; no GPIO actor to model, test, or debounce.
- Removes two dead, half-wired code paths from scope.

### Negative / trade-offs
- If a deployed room genuinely relies on the physical button/switch, that surfaces
  in Phase 4 — reopening the state machine and the pipeline-manager design (the
  expensive path the timing note warns about). Mitigation: confirmed with the
  hardware engineer against the new Radxa build before ratifying.

### Ripple — artifacts this touches (LIST ONLY; do not apply here)
- [ ] **Matrix §3** "Physical record button" and "4-way camera-switch button" RETIRE
      rows — each carries this exact veto; now released to RETIRE.
- [ ] **Pipeline-manager design** (Prompt 10 → `docs/design/pipeline-manager.md`):
      state explicitly that there is no GPIO input path.
- [ ] **Recording state machine** (`docs/design/state-machines.md`): no
      hardware-initiated transition; panel-only actor.
- [ ] Fact-check #3 (production `indicators` reader outside this repo, B-62) can be
      closed as "no external reader" once confirmed.

### Contract impact
**None.** No panel/quiz contract element models a physical button or switch. No
`contracts/` change and no Prompt-12 drift item.
