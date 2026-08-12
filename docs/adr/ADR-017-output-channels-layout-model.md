# ADR-017 — Output channels & layout model

- **Status:** Accepted
- **Date:** 2026-08-12 (recorded); amended per PM
- **Deciders:** PM + architect
- **Documents:** A-09 *(amended)* — `docs/discovery/open-decisions.md` §4

## Context

> **A-09 — Output channel & layout model:** *"Three channels; Local Recording + Live
> Streaming use PC-inclusive presets; Live Meeting uses camera-only presets."*
> — register

The amendment matters because the three channels do **not** share one preset
vocabulary: Meeting is camera-only (no laptop slides), while Local/Streaming include
the PC feed. This replaces the legacy quick-presets (B-60).

## Decision

Three output channels — **Local (always-on) / Meeting / Streaming** — with
**per-channel preset sets**:
- **Local Recording + Live Streaming:** PC-inclusive presets (e.g. half PC / half
  CAM1, etc.).
- **Live Meeting:** camera-only presets — 50/50 CAM1+CAM2, CAM1 large + CAM2 small,
  CAM1 solo, CAM2 solo.

## Consequences

### Positive
- Preset vocabulary matches what each channel can physically show; no PC preset
  offered on the camera-only meeting path.
- Layouts-as-data (`ratio_layout`, ADR-015) makes presets configuration, not code.

### Negative / trade-offs
- Two preset vocabularies to keep in sync between UI and pipeline-manager; the
  contract must enforce the per-channel allowed set (LP-7 preset vocabulary).

### Ripple (LIST ONLY)
- [ ] **Pipeline-manager** (Prompt 10): render each preset via `ratio_layout` per
      channel; enforce camera-only for Meeting.
- [ ] **Panel UI**: `LayoutPresetPicker` shows the channel-appropriate set only
      (built in Wave 3; verify).
- [ ] **Contract**: `LayoutPresetId` vocabulary per channel (LP-7) — confirm at Prompt 12.

### Contract impact
**Possible — reconcile at Prompt 12.** Per-channel preset enum enforcement; no change
applied now.
