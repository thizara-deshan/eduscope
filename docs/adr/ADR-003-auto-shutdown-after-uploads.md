# ADR-003 — Auto-shutdown after uploads: dropped (documented default)

- **Status:** Deferred / Dropped (documented default; PM may revisit in Phase 4)
- **Date:** 2026-08-12
- **Deciders:** PM (facilities/energy policy owner). Architect records the default.
- **Documents:** D-14 (Auto-shutdown after uploads) — `docs/discovery/open-decisions.md` §2
- **Revisit by:** **Phase 4** (small queue-drained hook + config flag; no UI/contract impact)

## Context

Legacy contained a **disabled stub** for "power off the device after the nightly
upload batch completes":

> *"B-29 (stub with commented-out body — no shutdown ever occurs)."* — D-14, register

The open question was whether to resurrect this behavior or drop it. It is only
meaningful if uploads batch at night — but D-13's default is **immediate**
auto-upload with no windows, which removes the nightly-batch premise. There is no
product requirement for unattended power-off.

> *"Who decides: PM (facilities/energy policy question). Latest phase without
> rework: Phase 4 — it is a small hook on the queue-drained event plus a config
> flag; no UI or contract impact."*

## Decision

**Drop automatic power-off.** No device self-shutdown on queue drain. The only
shutdown path is **manual power-off** (B-50), which carries the new
refuse-while-recording rule. The behavior is cheap to add later (one hook on the
queue-drained event + a config flag) should the PM want it, so it is deferred
rather than permanently closed.

## Consequences

### Positive
- Removes a fragile, previously-dead code path from scope; nothing to build now.
- No coupling to upload-timing policy (D-13) or the power-off flow beyond the
  manual path that already exists.

### Negative / trade-offs
- If facilities later wants energy savings via auto-power-off, it must be added in
  Phase 4 — but the cost is genuinely small and isolated (no UI, no contract).

### Ripple — artifacts this touches (LIST ONLY; do not apply here)
- [ ] **None required now.** If resurrected in Phase 4: a queue-drained hook on the
      upload-pipeline (matrix §3) plus the shared refuse-while-recording rule with
      the manual power-off path (B-50, §2g). Couples to D-13 (only meaningful if
      uploads batch).

### Contract impact
**None.** No `contracts/` element and no Prompt-12 drift item.
