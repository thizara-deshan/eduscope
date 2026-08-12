# ADR-022 — Panel thumbnail transport: WebRTC

- **Status:** Accepted
- **Date:** 2026-08-12 (recorded); hardware engineer's direction, closed D-07b
- **Deciders:** Hardware engineer + architect
- **Documents:** A-17 *(closed D-07b)* — `docs/discovery/open-decisions.md` §4

## Context

> **A-17 — Panel thumbnail transport:** *"WebRTC full-motion previews in the panel
> UI."* — register

This closed D-07b and replaces the legacy JPEG-over-socket previews (B-17/B-18) and
their leaked intervals (B-19). The local kiosk connection makes WebRTC low-risk.

## Decision

Source previews in the panel UI are delivered by **WebRTC** — full-motion, not JPEG
frames. The local kiosk↔device connection is on the same box/LAN, keeping setup
simple. In Phase 2 the mock adapter simulates the previews (A-17); the real WebRTC
transport lands in **Wave 8** (S-10 real WebRTC), which is **Phase 4** and gated on
**CG-2**.

## Consequences

### Positive
- Full-motion previews replace choppy JPEG polling and remove the leaked-interval bug
  class (B-19).
- Local connection means no NAT traversal / TURN complexity for the panel path.

### Negative / trade-offs
- WebRTC signaling + encode adds load to the board's encode-session budget (ADR-014);
  must be bench-validated (INT-8: preview < 1 s on target hardware).
- The real transport is the one wave that needs hardware — it cannot be validated on
  the mock; **CG-2 hard-blocks** it until the Prompt-12 drift review.

### Ripple (LIST ONLY)
- [ ] **Pipeline-manager** (Prompt 10): WebRTC preview producers per source.
- [ ] **CG-2** (contract): the real WebRTC signaling/transport contract — closed at
      the Prompt-12 drift review; unblocks Wave 8.
- [ ] **Wave 8** (Phase 4): S-10 real WebRTC + S-42 projector, on target hardware.

### Contract impact
**Deferred — CG-2 at Prompt 12.** The panel WebRTC transport is a hard-blocking
contract gap (CG-2) resolved in Phase 3's drift review; nothing applied now.
