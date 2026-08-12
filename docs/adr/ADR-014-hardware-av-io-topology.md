# ADR-014 — Target hardware & AV I/O topology

- **Status:** Accepted
- **Date:** 2026-08-12 (recorded); confirmed by the 2026-07-22 hardware/PM questionnaires
- **Deciders:** Hardware engineer + PM + architect
- **Documents:** A-06, A-08 *(amended 2026-07-22)*, A-11 *(reworded)*, A-18 *(closed D-11)* — `docs/discovery/open-decisions.md` §4

## Context

Four decisions define the physical appliance and how audio/video enters and leaves
it. They are recorded together because they describe one coherent I/O topology
(full map in `revamp-guide/reference/hardware-topology.md`).

- **A-06 — Hardware:** *"Radxa ROCK 5 ITX+ (RK3588, 24 GB, `mpph264enc`/
  `mppvideodec`); X11 confirmed; OS on SD card, recordings on a separate disk;
  board confirmed to handle record + stream + meeting output simultaneously."*
- **A-08 — Source set:** *"`pc` + `cam1` + `cam2` + one lecturer mic only — room mic
  removed. Camera-only recording must work. shm sockets unchanged."*
- **A-11 — Display outputs:** *"HDMI-out #1 = projector (passthrough + quiz overlay);
  HDMI-out #2 = camera composite + mic audio → dongle → laptop; USB-C→HDMI = touch
  panel kiosk."*
- **A-18 — PC capture input:** *"Stay with the USB HDMI capture dongle."*

## Decision

Adopt the **Radxa ROCK 5 ITX+** as the appliance, with:
- **Inputs:** `pc` (laptop HDMI via USB capture dongle, A-18), `cam1` + `cam2` (IP
  cameras, RTSP), and **one lecturer mic** — no room mic. Camera-only recording
  (no laptop) must work. shm sockets unchanged (`/tmp/usb.sock`, `/tmp/rtsp.sock`,
  `/tmp/rtsp2.sock`, `/tmp/audio.sock`).
- **Outputs:** HDMI-out #1 → projector (slides passthrough + quiz overlay);
  HDMI-out #2 → camera composite + embedded mic audio → HDMI→USB dongle → laptop;
  USB-C→HDMI → 13″ touch panel running the kiosk UI.
- **Storage:** OS on SD card, recordings on a separate disk.

## Consequences

### Positive
- Single board proven to record + stream + drive the meeting output simultaneously —
  the resource budget (encode sessions, Vosk RAM, shm throughput) is bench-validated
  by the pipeline engineer on this exact board.
- RK3588 hardware codecs (`mpph264enc`/`mppvideodec`) replace the legacy Jetson
  elements in the pipeline strings.

### Negative / trade-offs
- Fixed hardware ceiling; a heavier future workload (more encode sessions) revisits
  A-06. No such requirement today.
- Single mic and single PC-capture dongle are single points of failure per room;
  the EZ-Cap watchdog (B-39 successor) remains needed for the dongle.

### Ripple (LIST ONLY)
- [ ] **Pipeline-manager design** (Prompt 10): generate consumer pipelines against
      these exact sockets, codecs, and outputs; encode-session budget on RK3588.
- [ ] **Encoder-settings validation** (matrix §1a ES row) uses `mpph264enc`.
- [ ] **PC-capture watchdog** (B-39 successor) for the USB HDMI dongle.
- [ ] Fact-checks in `hardware-topology.md` §5 (dongle model, mic ALSA name, camera
      models, passthrough latency) still to confirm — not design-blocking.

### Contract impact
**Possible — reconcile at Prompt 12.** Source-status granularity (per-source
online/offline for `pc`/`cam1`/`cam2`/mic) may need contract confirmation; flag at
the drift review. No change applied now.
