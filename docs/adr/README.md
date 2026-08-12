# Architectural Decision Records — Index

One-page overview of every ADR. Each file is one decision (or a coherent cluster);
this page is the browsable table of contents. Source of truth for *open* decisions
and their owners is [../discovery/open-decisions.md](../discovery/open-decisions.md);
this index covers what has been **decided or deferred**.

**Statuses:** `Accepted` — decided, in force · `Deferred` — proceeding on a documented
default, expected to change on its own schedule.

**Convention:** ADRs are immutable once accepted; a reversal is a *new* ADR that
supersedes the old one (the old file stays as history). Ripple checklists inside each
ADR are **listed, not applied** — contract-affecting items route through Prompt 12.

---

## Closed decisions (D-xx)

| ADR | Decision | Outcome | Status |
|-----|----------|---------|--------|
| [001](ADR-001-on-device-database.md) | D-03 On-device database | SQLite + Drizzle, explicit migrations | Accepted |
| [002](ADR-002-upload-api-spec-deferral.md) | D-02b Upload API spec | Placeholder contract; real spec pending institute | Deferred → Phase 4 |
| [003](ADR-003-auto-shutdown-after-uploads.md) | D-14 Auto-shutdown after uploads | Dropped; manual power-off only | Deferred (PM may revisit Phase 4) |
| [004](ADR-004-room-controls-hardware-deferral.md) | D-10 Room-controls hardware | UI placeholder; no lights/AC/projector-power backend | Deferred → post-launch |
| [005](ADR-005-physical-room-hardware-retirement.md) | D-12 Record button + camera switch | Retire both; panel-only control | Accepted |
| [006](ADR-006-upload-timing-policy.md) | D-13 Upload timing | Immediate auto-upload; no windows; manual re-enqueue | Accepted |
| [007](ADR-007-disk-pressure-retention.md) | D-15 Disk-pressure retention | Uploaded-oldest-first; never delete un-uploaded; refuse-start when full | Accepted |
| [008](ADR-008-wifi-provisioning-dropped.md) | D-16 Wi-Fi provisioning | Dropped; wired-only appliance | Accepted |
| [009](ADR-009-device-time-ownership.md) | D-17 Device time | Deploy owns NTP/timezone; UI read-only | Accepted |
| [010](ADR-010-streaming-platform-list.md) | D-19 Streaming platforms | YouTube + Facebook + generic Custom RTMP | Accepted |
| [011](ADR-011-provisioning-powers-home.md) | D-20 Provisioning powers | Deploy-layer config store; identity read-only; HDD ops in UI | Accepted |
| [012](ADR-012-quiz-roster-provenance.md) | D-21 Quiz roster provenance | Self-registration; leaderboard keys on student ID | Accepted |

## Baseline decisions (A-xx, back-documented 2026-08-12)

| ADR | Covers | Decision | Status |
|-----|--------|----------|--------|
| [013](ADR-013-programme-strategy-scope-method.md) | A-01, A-03, A-04 | Layered frontend-first rewrite; full scope; phase-doc + prompt method | Accepted |
| [014](ADR-014-hardware-av-io-topology.md) | A-06, A-08, A-11, A-18 | Radxa ROCK 5 ITX+; pc+cam1+cam2+single mic; 3 display outputs; USB HDMI capture | Accepted |
| [015](ADR-015-pipeline-architecture-runtime.md) | A-05, A-13 | shm pub/sub + generated consumers; Python/FastAPI pipeline-manager | Accepted |
| [016](ADR-016-recording-session-model.md) | A-07, A-12 | One-tap start, generated title; pause = split segments joined by system | Accepted |
| [017](ADR-017-output-channels-layout-model.md) | A-09 | Local/Meeting/Streaming; per-channel preset sets (Meeting camera-only) | Accepted |
| [018](ADR-018-live-streaming-path.md) | A-10 | RTMP via nginx + stunnel4 RTMPS; preflight | Accepted |
| [019](ADR-019-live-meeting-integration.md) | A-15 | HDMI→USB dongle as USB webcam; platform Share Screen; no SDK/bot | Accepted |
| [020](ADR-020-ai-serving-question-cadence.md) | A-02, A-14 | Self-hosted LLM/Vosk/Tesseract on device; MCQ, 10/15/20/30-min countdown | Accepted |
| [021](ADR-021-quiz-platform-projector-flow.md) | A-16, A-22 | Separate Next.js quiz app; send-to-projector overlay; leaderboard never on projector | Accepted |
| [022](ADR-022-panel-thumbnail-transport-webrtc.md) | A-17 | WebRTC full-motion previews (real transport = Wave 8, CG-2) | Accepted |
| [023](ADR-023-recording-storage-retention-upload.md) | A-19, A-20 | Pluggable upload adapter + resumable queue; admin-only delete; 14-day auto-delete | Accepted |
| [024](ADR-024-user-management-role-model.md) | A-21 | Lecturer/admin roles; bulk Excel import; no device migration | Accepted |

---

## Contract-affecting ADRs (feed the Prompt-12 drift review)

These carry ripple that touches `contracts/`; reconcile at the drift review, not before:

- **[022](ADR-022-panel-thumbnail-transport-webrtc.md)** — **CG-2** (real WebRTC transport) hard-blocks Wave 8.
- **[007](ADR-007-disk-pressure-retention.md)** — likely new `Problem['code']` (disk-critical) for refuse-start.
- **[010](ADR-010-streaming-platform-list.md)** — platform enum + Custom RTMP fields.
- **[011](ADR-011-provisioning-powers-home.md)** — read-only device-identity endpoint.
- **[016](ADR-016-recording-session-model.md)** — split-segment pause bookkeeping (A-12).
- **[023](ADR-023-recording-storage-retention-upload.md)** / **[002](ADR-002-upload-api-spec-deferral.md)** — upload payload, once the institute spec lands.
- **[021](ADR-021-quiz-platform-projector-flow.md)** — device↔quiz-server sync (CG-22…CG-25 already scoped in screen-inventory §10).

## Not yet an ADR

- **D-18** (scheduled recordings) — retire default, held by the PRD/domain model; not on the PM ratification sheet. Becomes an ADR only if the PM resurrects scheduling.
