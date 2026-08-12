# ADR-019 — Live meeting integration: HDMI→USB dongle as USB webcam

- **Status:** Accepted
- **Date:** 2026-08-12 (recorded); PM-accepted, closed D-05b
- **Deciders:** PM + hardware engineer + architect
- **Documents:** A-15 *(closed D-05b)* — `docs/discovery/open-decisions.md` §4

## Context

> **A-15 — Live Meeting integration:** *"HDMI-out #2 composite → HDMI→USB dongle as
> standard webcam + mic; platform Share Screen for slides. No SDK/bot/WebRTC meeting
> integration."* — register

This closed D-05b. The alternative (SDK/bot/WebRTC meeting integration) was rejected
in favor of presenting the composite to the laptop as a generic USB device.

## Decision

The device renders the **camera-only composite + mic audio to HDMI-out #2**; an
**HDMI→USB capture dongle** presents it to the laptop as a **standard USB webcam +
mic**. The lecturer selects it in Zoom/Teams and uses the platform's own **Share
Screen** for slides. **No SDK, bot, or WebRTC meeting integration.** One dongle per room.

## Consequences

### Positive
- Works with any conferencing platform with zero per-platform code — the device is
  just a webcam to the laptop.
- Slides go through the platform's native Share Screen, so no slide-relay complexity
  on the meeting path.

### Negative / trade-offs
- Requires one HDMI→USB dongle per room (hardware cost/logistics).
- The meeting composite is camera-only by design (A-09 Meeting presets); slides are
  not in the camera composite — intentional, but a lecturer expecting slides in the
  webcam feed must use Share Screen.

### Ripple (LIST ONLY)
- [ ] **Pipeline-manager** (Prompt 10): the HDMI-out #2 meeting consumer (camera
      composite + embedded mic audio).
- [ ] **Panel UI**: Meeting channel presents camera-only presets (A-09); no PC feed.
- [ ] Dongle model + topology fact-checks (`hardware-topology.md` §5).

### Contract impact
**None.** Meeting integration is a hardware/OS path; no `contracts/` element models
the conferencing platform. Meeting channel state is covered by the output-channel model.
