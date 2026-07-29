# PRD — Eduscope UMS Rewrite ("Unistream")

> Phase-1 artifact (revamp-guide prompt 03). Every requirement below is traceable to
> discovery evidence — parity-matrix rows ([feature-parity-matrix.md](discovery/feature-parity-matrix.md)),
> behaviors ([behavioral-inventory.md](discovery/behavioral-inventory.md), B-xx),
> decided architecture (A-xx) and open-decision defaults ([open-decisions.md](discovery/open-decisions.md), D-xx) —
> or to a PM interview answer (INT-xx, table below). Nothing here is invented.
> Where an open decision forces ambiguity, the register's **default** is stated and
> tagged `[D-xx]`; closing the decision may change that requirement.

---

## 0. PM interview record (2026-07-29)

| ID | Question | Answer |
|----|----------|--------|
| INT-1 | Which undesigned legacy surfaces (matrix §5.1) are V1 must-haves? | **All four groups**: recordings library + USB export; upload-queue status view; account flows (forced reset, edit/delete users); device ops (takeover UX, power-off, storage warning) |
| INT-2 | Leaderboard scoring formula (docs contradicted: 1 pt vs ×10) | **10 points per correct answer**; response time displayed as insight only, never affects score |
| INT-3 | Answer changes / question close | **One locked attempt**; a question closes when the next is sent to the projector (or the session stops) |
| INT-4 | Student-side visibility & identity | Student sees **own result + own rank only**; registration requires **real name + valid-format student ID** |
| INT-5 | Stop → file-safe budget | **≤ 10 s** to a finalized, playable file; pause-segment merge/remux continues async |
| INT-6 | Crash data-loss tolerance | **≤ 5 seconds** of recorded material lost on power cut / crash |
| INT-7 | Post-crash behavior | **Auto-resume if recent** (session live within the last few minutes → new segment starts automatically with a recovery banner); older sessions are finalized and preserved |
| INT-8 | Panel latency budgets | Touch feedback **< 100 ms** · Start-tap → recording **< 3 s** · source preview appears **< 1 s** |
| INT-9 | Rollout model | **Pilot rooms first, then staged room-by-room fleet swap**; legacy rooms untouched meanwhile |
| INT-10 | V1 go-live gate | **Recording-first go-live**; AI studio + quiz enabled per room via feature flag once the LAN LLM server and campus quiz app are provisioned |
| INT-11 | AI countdown default (prototype said 15, A-14 said 20) | **20 minutes — A-14 wins**; prototype mock to be corrected |
| INT-12 | Fleet size / calendar | **Pilot-scale, 1–5 rooms, no hard external date**; timeline is gated by phase-gate quality, not calendar |

---

## 1. Overview

Eduscope UMS is a lecture-capture appliance installed in university lecture halls:
an embedded device that records the presenter PC and two room cameras, streams
live, feeds recordings to the institute's LMS, and is operated from an in-room
touch panel. The legacy system (Jetson-based `LC` backend + `lc-frontend` SPA) is
being **fully rewritten** (A-01, A-03) on new hardware (Radxa ROCK 5 ITX+ / RK3588,
A-06) with a new layered architecture: **Lecturer Panel** (touch UI, 13″ 1280×800),
**Admin UI** (Advanced section of the panel), **core-api**, **pipeline-manager**
(Python/FastAPI, A-13), **AI services**, a separate **Quiz App**, and a **deploy
layer**.

The rewrite has two mandates:

1. **Behavior parity with the legacy system** where the capability is real —
   every legacy behavior was inventoried (B-01…B-64) and dispositioned in the
   parity matrix; REBUILD/REDESIGN rows are the parity contract. Legacy *defects
   and placebo controls are explicitly not ported* (e.g. fake gain sliders B-55,
   fire-and-forget pipeline launches B-12, unauthenticated reset endpoint B-42).
2. **A new headline capability**: AI-generated in-lecture quiz questions —
   on-device STT/OCR + LAN LLM (A-02) generating MCQs the lecturer reviews and
   sends to the projector, answered live by students on their phones via a
   separate campus-hosted Quiz App (A-16), with a lecturer-only leaderboard.

The product is frontend-first by client requirement: the panel UI is built against
a versioned contract and a mock adapter before backend integration (revamp-guide
overview).

## 2. Goals & measurable objectives

| # | Goal | Measurable objective |
|---|------|----------------------|
| G-1 | Lectures are never silently lost | ≥ 99.5 % of started sessions end as a complete playable file; any failure is surfaced on the panel within 5 s (kills B-12's silent-success class). Crash loses ≤ 5 s of material (INT-6) |
| G-2 | Recording feels instant and safe to a non-technical lecturer | One-tap start (A-07); Start→recording < 3 s, touch feedback < 100 ms (INT-8); Stop→playable file ≤ 10 s p95 (INT-5) |
| G-3 | Recordings reach the LMS without human help | ≥ 99 % of finished recordings uploaded without operator intervention within 24 h (A-19; immediate-upload default [D-13]); every failure visible in the upload-queue view with a working re-enqueue (INT-1) |
| G-4 | AI questions are used, not demoed | In AI-enabled pilot rooms: ≥ 50 % of sessions send at least one question to the projector; median student response rate per sent question ≥ 60 % of joined students |
| G-5 | Zero placebo controls | Every control in the shipped UI verifiably affects the system (B-55/B-56 lesson); verified in Phase-5 parity check |
| G-6 | Admin surface is self-sufficient for IT staff | Provisioning, disk swap, user import, and diagnostics doable by institute IT from the Admin UI + documented deploy-layer flow with no vendor SSH (A-21, [D-20]) |
| G-7 | Security holes of the legacy system are closed | No unauthenticated endpoint mutates state or serves recordings (B-42, B-37, B-12); parameterized queries only (B-63); secrets never in plain settings rows (§2e matrix row) |

## 3. Scope

### 3.1 V1 — IN

- Lecturer Panel: one-tap recording with pause/resume, three output channels
  (local / meeting / streaming) with per-channel layout presets, fixed source trio
  + WebRTC previews, single-mic real audio control, recordings library + USB
  export, AI question studio + insights, storage warning, power-off, takeover UX.
- Admin UI (Advanced): Network (LAN + vLAN + camera IPs), Encoder, Local Storage
  (incl. disk health, mount/format), Firmware update, User Management (incl.
  Excel import, edit/delete, forced reset), System Logs, Streaming Configuration,
  Upload-queue status view. (INT-1: all V1.)
- Quiz App: QR join, self-registration (name + student ID [D-21]), one-shot
  answering, own-result + own-rank view; projector question/QR overlay.
- Platform: shm pub/sub pipeline architecture (A-05), process supervision,
  persisted crash-safe sessions, automatic merge + auto-upload with resumable
  queue (A-19), 14-day retention (A-20) with disk-pressure policy [D-15],
  institute roster sync [D-02b], streaming relay (YouTube + Facebook + Custom
  RTMP [D-19]), AI stack (A-02), projector + meeting HDMI outputs (A-11, A-15),
  structured logging, SQLite + Drizzle [D-03], signed firmware updates with
  rollback, deploy-layer provisioning [D-20].
- Per-room feature flag separating **recording go-live** from **AI/quiz
  enablement** (INT-10).

### 3.2 V1 — explicitly OUT

Room controls are **placeholder-only**: the Room Controls panel ships with mock
Projector / Audio / Environment groups and **no backend** for lights, AC, or
projector power — the master mic mute is the only live control [D-10].

Everything else cut, with its disposition source:

| Cut item | Why / source |
|---|---|
| Separate admin login screen & `root`→dev-admin magic username | RETIRE, matrix §1 admin-login row (B-41); single login + role on account |
| Main menu page (and its kill-all-GStreamer side effect) | RETIRE, matrix §1 menu row (B-14); single-view UX, explicit pipeline lifecycle |
| Free source/layout permutations & quick-preset tiles | Replaced by semantic trio + per-channel presets (A-08/A-09; B-01, B-60) |
| Module/topic/hall metadata entry & LMS dropdown feeds | A-07 one-tap start; matrix §2f RETIRE (B-16, B-26) |
| Eduscope Stream settings, Schedule settings, UAC/UVC stub, System-page placebo (time pickers, license panel) | RETIRE, matrix §1a rows (B-55); time is deploy-layer [D-17]; scheduled recordings retired [D-18] |
| Wi-Fi / SSID provisioning | Wired-only [D-16] (B-54 dead UI) |
| Physical record button & 4-way camera switch | Retire both [D-12] (B-13, B-62) |
| Instant/scheduled upload toggle + upload windows | Immediate auto-upload [D-13] (B-22, B-30 fake toggle) |
| Manual per-file upload endpoint & OneDrive path | RETIRE, matrix §2c (B-35, B-36); replaced by queue re-enqueue |
| User-triggered convert/merge flow | Automatic server-side post-stop (A-12; B-34 race) |
| Auto-shutdown after uploads | Drop [D-14] (B-29 dead stub) |
| Dev-admin role & Dev-options UI page | Role collapse to lecturer/admin (A-21); provisioning to deploy layer [D-20] (B-47) |
| Twitter/LinkedIn/Twitch platform tiles | YouTube + Facebook + Custom RTMP only [D-19] (Twitch reachable via Custom RTMP) |
| Room ceiling mic | Removed from hardware (A-08 amended) |
| Dark mode / theme toggle | Fixed light PM palette (legacy-vs-prototype C-6) |
| Meeting SDK / bot / WebRTC-meeting integration | HDMI→dongle webcam path only (A-15, C-7) |
| Quiz SSO & roster import | Later upgrade path; self-registration in V1 (A-16, [D-21]) |
| Data migration from fielded legacy devices | None needed (A-21, D-03 note) |

## 4. Personas

- **Lecturer** — older, non-technical academic (the prototype's explicit design
  target). Walks in, taps Start, teaches, taps Stop. Uses pause, glances at the
  timer/red frame for confidence, optionally runs the AI question flow. Never
  configures anything beyond their capture/streaming layout. Touch targets
  ≥ 44 px, zero jargon.
- **Admin (institute IT staff)** — owns the Advanced section (A-21): user
  accounts and bulk imports, network/encoder/streaming config, disk swap/format,
  firmware updates, log triage, upload-queue recovery, deleting recordings.
- **Student** — in the hall or attending online (A-16). Scans the projector QR on
  their phone, registers once with name + student ID, answers MCQs with one tap,
  sees their own result and rank (INT-3/4).
- **Device operator (installer / field technician)** — provisions a new unit via
  the deploy-layer flow [D-20]: institute profile, hall code, storage identity,
  network; racks the hardware (cameras, dongles, HDMI runs per A-11/A-15);
  performs the pilot-to-fleet swap (INT-9).

## 5. Functional requirements

Each requirement cites its parity-matrix row / B-numbers, or is marked **NEW**
(matrix §4). "Panel" = Lecturer Panel.

### 5.1 Lecturer Panel

- **LP-1 Unified login.** One login screen for both roles with real credential
  auth against local **and** institute user sources; role is an account
  attribute. *(Matrix §1 login row; §2a auth row; B-40)*
- **LP-2 Forced first-login reset & change-password.** New/imported users must
  set a compliant password before reaching the dashboard; the reset flow is
  authenticated end-to-end. *(§5.1 item 3; B-42; INT-1)*
- **LP-3 One-tap start.** No session-time inputs: hall is device-provisioned,
  title auto-generated `[Hall] – [Date] [Time]` (A-07; hall-code source [D-20];
  exact format is open fact-check P-1). *(Matrix §1 home row)*
- **LP-4 Recording status & feedback.** State machine
  `idle | starting | recording | paused | stopping | error` surfaced as the red
  4 px frame + notch, amber PAUSED, and TimerCard ticking only while recording.
  Errors are always surfaced — a start that fails must never show as recording.
  *(Matrix §2a recording-control row; B-12 lesson; legacy-vs-prototype §2.1)*
- **LP-5 Pause/resume.** Pause splits files; the system merges segments into one
  lecture automatically after stop — never user-triggered, never uploaded
  unmerged. *(A-12; B-09/B-10 invariant; B-34 race fix)*
- **LP-6 Single-recorder lock & takeover.** Mutual exclusion is server-enforced.
  A second user sees a locked "recording in progress" state with the owner's
  session; only the owner or an admin can stop/take over. *(B-15; §5.1 item 5;
  INT-1)*
- **LP-7 Output channels.** Three channels — `local` (always-on), `meeting`,
  `streaming` — each independently toggled and each with its own preset
  vocabulary: local `fifty-fifty | side-by-side | cam-1 | cam-2 | separate-files`,
  meeting `cams-fifty-fifty | cam-1 | cam-2` (camera-only), streaming
  `fifty-fifty | side-by-side | cam-1 | cam-2 | pc-only`. Channel ON/OFF maps to
  starting/stopping a pipeline consumer while publishers keep running. *(A-09
  amended; prototype `CHANNEL_LAYOUTS`; matrix §1 capture/LMC rows)*
- **LP-8 Sources panel.** Fixed semantic trio `pc / cam1 / cam2` with per-tile
  presence/health; tapping a tile opens a full-motion WebRTC preview lightbox
  appearing < 1 s (INT-8). *(A-08, A-17; matrix §2b rows; B-18 successor)*
- **LP-9 Real microphone control.** Single lecturer mic: live level meter, −/+
  gain steppers, mute, plus the Room Controls master mute — all verifiably
  affecting captured audio (no placebo, B-55 lesson). **NEW** *(matrix §4
  real-mic row; A-08 amended)*
- **LP-10 Recordings library.** In-panel list of this device's recordings with
  upload-status badges, playback and download, multi-select copy-to-USB with
  real transfer progress, and admin-only delete with recorded actor. Ownership
  filtering (lecturers see their own; admins all) enforced **server-side**.
  Playback URLs are authenticated. *(Matrix §1 FM row + §2c rows; B-31, B-32,
  B-33, B-37; A-20; INT-1)*
- **LP-11 USB awareness.** USB drive insert/remove detected and shown (capacity,
  target pick) in the library's export flow, scoped to the requesting session.
  *(Matrix §3 USB-hotplug row; B-38; INT-1)*
- **LP-12 Storage warning.** Dashboard warning when disk pressure approaches the
  policy threshold, stating the *actual* retention behavior [D-15 default:
  uploaded-oldest-first early delete; never auto-delete un-uploaded; refuse
  start when critical]. *(B-53; §5.1 item 7; A-20; INT-1)*
- **LP-13 Power off.** A power-off control (Room Controls area) that confirms,
  then halts — and is **refused server-side while recording**. *(Matrix §2g
  power-off row; B-50; §5.1 item 6; INT-1)*
- **LP-14 Room Controls placeholder.** Projector/Audio/Environment groups render
  as designed but are inert except master mic mute [D-10]. *(Matrix §4 Room
  Controls row)*
- **LP-15 Live Meeting channel.** Inline accordion on the meeting ChannelCard
  with the camera-only presets; output is HDMI-out #2 composite + embedded mic
  audio → capture dongle → laptop USB webcam. **NEW (hardware path)** *(A-15;
  matrix §1 LMC row + §4 meeting row)*
- **LP-16 AI question studio ("Eduscope AI central").** Countdown-driven MCQ
  generation at 10/15/20/30 min, **default 20** (A-14; INT-11); `generateNow()`
  generates immediately *and* resets the countdown; batches of 3–5 MCQs reviewed
  in a modal with inline edit, regenerate, discard; lecturer-written questions
  (Add Question dialog) survive batches and session resets; **Send to
  Projector** with exactly one "now showing". Fresh recording resets AI state.
  **NEW** *(matrix §4 AI row; A-14; prototype QuestionContext spec)*
- **LP-17 Insights panel.** Right-column tabs: Previous Questions (sent
  questions with correct answer + clickable response/correct/incorrect name
  lists) and Leaderboard (rank, `{correct}/{answered}`, score = correct × 10
  (INT-2), avg response time; row opens per-student drill-down). Panel-only —
  never projected (A-16). **NEW** *(matrix §4 insights row)*
- **LP-18 AI-degraded mode.** In rooms where the AI/quiz flag is off (INT-10) or
  the LAN LLM / quiz server is unreachable, the AI studio is hidden or shows an
  unavailable state; recording is never affected. *(INT-10; A-02 dependency)*

### 5.2 Admin UI (Advanced section)

- **AD-1 Role-scoped Advanced.** Advanced button visible to all; lecturers reach
  only Local Capture Layout + Streaming Configuration; admins reach the full
  System Administration sidebar. *(Matrix §1 settings-shell row; A-21; prototype
  AdminPage)*
- **AD-2 Network settings.** Static LAN config, **vLAN config (NEW)**, and CAM 1
  / CAM 2 IP addresses. Applying an IP change never rebuilds the frontend —
  runtime config only. *(Matrix §1a dis row + §4 vLAN row; B-46 lesson)*
- **AD-3 Encoder settings.** Bitrate (2000–8000 kbps) and any codec/container
  option **validated against real RK3588 `mpph264enc` capability** before it
  appears — unsupported values are absent, not inert. *(Matrix §1a es row; B-56;
  A-06)*
- **AD-4 Local storage.** Capacity/free stats, **disk-health via SMART (NEW)**,
  mount-new-drive and format as a single safe danger-zone operation (replacing
  the legacy two-step + nginx surgery). *(Matrix §1a lss row; B-51, B-52)*
- **AD-5 Firmware update.** Current version + check/apply of **signed release
  artifacts with rollback**; a failed update leaves the device functional.
  *(Matrix §1a fu row; B-49)*
- **AD-6 User management.** Single directory, two roles (lecturer/admin): add,
  **edit, delete, pagination** (INT-1), and Excel bulk import honoring the B-44
  validation contract (reject null cells and in-file duplicates); passwords
  hashed server-side; imported users hit forced reset (LP-2). *(Matrix §1a um
  row; B-44; A-21)*
- **AD-7 System logs.** Queryable log view — filter by level (INFO/WARN/ERROR)
  and category (Auth/System/Hardware/Session), free-text search, CSV export.
  **NEW** *(matrix §4 SystemLogs row)*
- **AD-8 Streaming configuration.** Channel on/off, layout preset, platform
  picker (**YouTube, Facebook, Custom RTMP** [D-19]), server URL + stream key
  with secret-grade storage, saved configs. *(Matrix §1 LS row + §2e row; B-59)*
- **AD-9 Upload-queue view.** Per-file state (waiting / uploading / done /
  failed / dead-letter), retry history, and a **manual re-enqueue** action
  [D-13]. Metadata columns finalize when the upload spec lands [D-02b]. *(§5.1
  item 2; B-22–B-28 successors; INT-1)*
- **AD-10 Device identity, read-only.** Provisioned values (institute profile,
  hall code, storage identity) and current time/NTP sync status are displayed
  read-only; editing happens in the deploy layer [D-20] [D-17]. *(Matrix §1a dev
  row; §5.1 items 8–9)*

### 5.3 Quiz App (student-facing)

- **QZ-1 Campus-hosted app.** Separate Next.js app on a campus web server with a
  public domain; reachable by in-room *and* online students. **NEW** *(A-16;
  matrix §4 quiz row)*
- **QZ-2 QR join.** The projector overlay's QR takes a student straight to the
  active session. **NEW** *(A-22)*
- **QZ-3 Identity.** First join = self-registration with **real name +
  valid-format student ID** [D-21]; basic login now, SSO as a later upgrade on
  the same IDs (A-16). Leaderboard keys on student ID. *(INT-4)*
- **QZ-4 Answering rules.** One locked attempt per question — the first tap is
  final. A question closes when the lecturer sends the next one or the session
  ends; late answers are rejected with a clear "question closed" state.
  *(INT-3)*
- **QZ-5 Scoring.** 10 points per correct answer; per-answer response time is
  recorded for lecturer insight but never affects score. *(INT-2)*
- **QZ-6 Student result view.** After a question closes the student sees their
  own correctness, running score, and **own rank only** — never the full class
  list. *(INT-4; A-16 leaderboard is panel-only)*
- **QZ-7 Live response sync.** Answers stream to the device across network zones
  in near-real-time to feed LP-17; sync failure degrades the panel visibly
  without affecting recording. **NEW** *(A-16; matrix §4 insights row; LP-18)*

### 5.4 Platform (core-api · pipeline-manager · AI services · deploy layer)

- **PF-1 Pipeline architecture.** Always-running shm publishers per source,
  generated consumer pipelines per channel; starting/stopping one consumer never
  disturbs another (kills B-01's string matrix, B-06's global `killall`, B-18's
  kill-and-restart). Unsupported combinations are rejected explicitly. *(A-05;
  matrix §2a/§2b rows)*
- **PF-2 Process supervision.** Every pipeline is supervised with PID/health
  tracking; failures propagate to the session state machine and the UI within
  5 s. *(Matrix §2a row; B-12 DROP)*
- **PF-3 Persisted sessions.** Recording session state (identity, start time,
  segments, channels) survives service restart; duration is computed from
  persisted state, never in-memory-only. *(B-03, B-07, B-08)*
- **PF-4 Crash-safe capture.** Recording containers are continuously flushed so
  a power cut loses ≤ 5 s (INT-6). Stop performs graceful EOS and yields a
  finalized playable file in ≤ 10 s (INT-5); merge/remux runs async after
  (A-12). On boot after a crash: if the persisted session was live within the
  recovery window, recording **auto-resumes** as a new segment with a panel
  banner; otherwise the session is finalized and preserved (INT-7). *(B-06 EOS
  lesson; B-07 successor)*
- **PF-5 Automatic post-stop processing.** Segment merge and mp4 conversion run
  as supervised async jobs immediately after stop — no user trigger, no
  event-loop blocking, no unmerged upload race. *(A-12; matrix §3 conversion
  row; B-23, B-34)*
- **PF-6 Auto-upload.** Immediate upload on completion [D-13] via a resumable
  job queue and pluggable adapter against the placeholder institute contract
  [D-02b]. Invariants: every finished file enters the queue exactly once (B-09);
  one lecture per recording regardless of segments/streams (B-25, incl. the
  `~2~cmb` gap fixed); failed uploads are cleaned remotely and genuinely retried
  (B-27 intent, bug dropped); missing files land in a surfaced dead-letter state
  (B-28). *(A-19; matrix §3 upload row)*
- **PF-7 Retention.** DB-driven 14-day auto-delete (A-20); under disk pressure,
  delete already-uploaded oldest-first, never auto-delete a never-uploaded
  recording, and refuse new starts when critically full with a clear warning
  [D-15]. Tolerant of foreign files (B-20 crash fixed). *(Matrix §3 cleanup row)*
- **PF-8 Institute roster sync.** Periodic roster pull from the new institute
  API [D-02b] feeding institute-user login (LP-1); no hardcoded keys, no
  disabled TLS, no md5. *(Matrix §3 sync row; B-21, B-40)*
- **PF-9 Streaming relay.** Controllable RTMP relay (no nginx.conf surgery /
  full restarts), RTMPS bridging for Facebook, and stream-targets-active-before-
  pipeline-connect ordering preserved. *(A-10; B-16, B-58)*
- **PF-10 AI services.** Self-hosted llama.cpp LLM on LAN; Vosk STT pinned to
  the A76 cores and Tesseract OCR on device; generation orchestration feeding
  LP-16. No cloud dependency. **NEW** *(A-02; matrix §5.2 item 1)*
- **PF-11 Projector consumer.** HDMI-out #1 slides passthrough with
  question + join-QR overlay switching; leaderboard never rendered to it. **NEW**
  *(A-11, A-22, A-16)*
- **PF-12 Meeting output.** HDMI-out #2 camera composite with embedded mic
  audio driving the HDMI→USB dongle. **NEW** *(A-15; matrix §4 meeting row)*
- **PF-13 Capture-hardware watchdog.** Supervised health check for the USB
  capture card with recovery (hub power-cycle) during uptime, not only at boot;
  events logged under Hardware. *(Matrix §3 EZ-Cap row; B-39; A-18)*
- **PF-14 Record LED.** Room-facing GPIO recording indicator: blinking while
  recording, off otherwise, correct across pause/crash paths (LED presence on
  the new board is an open fact-check). *(Matrix §3 LED row; B-05)*
- **PF-15 Structured logging.** Every service emits categorized
  (Auth/System/Hardware/Session), leveled, human-readable events into the
  queryable store behind AD-7. **NEW** *(matrix §4 SystemLogs row)*
- **PF-16 Data layer.** SQLite + Drizzle [D-03] with explicit migrations,
  parameterized queries everywhere, enums over status strings, fresh-install
  self-seeding. *(Matrix §3 MySQL row; B-45, B-62, B-63)*
- **PF-17 Security baseline.** No unauthenticated state-changing or
  media-serving endpoint (B-42, B-37 closed); same-origin CORS (B-64); kiosk
  session tokens short-lived (replacing B-40's 7-day JWTs) and no password
  hashes on request contexts; stream keys and API credentials in secret-grade
  storage; role-permission matrix tested per endpoint (B-43 successor for
  lecturer/admin).
- **PF-18 Serving & config.** Single-origin serving with **runtime**
  configuration — changing the device IP or updating firmware never rebuilds the
  SPA. *(Matrix §3 nginx row; B-46, B-61)*
- **PF-19 Time.** NTP + timezone owned by the deploy layer at provisioning
  [D-17]; correct time is load-bearing for titles (A-07), retention (A-20), and
  logs.
- **PF-20 Feature flags.** Per-room enablement of the AI/quiz stack independent
  of recording go-live (INT-10).

## 6. Non-functional requirements

**Embedded-board budgets (RK3588, 24 GB — A-06)**
- Touch feedback < 100 ms; Start→recording < 3 s; WebRTC preview visible < 1 s
  (INT-8) — all while the board simultaneously records, streams, and drives the
  meeting output (A-06 confirms simultaneous capability).
- STT pinned to the four A76 cores (A-02); encode via `mpph264enc` hardware
  encoder; panel UI must stay within budgets during merge/upload jobs (PF-5/6).

**Reliability**
- ≥ 99.5 % session completion (G-1); ≤ 5 s crash loss (INT-6); Stop→playable
  ≤ 10 s p95 (INT-5); auto-resume per INT-7.
- Recording never depends on WAN availability; streaming/upload/AI degrade
  independently and visibly (LP-18, QZ-7).
- No unbounded timers or per-connection leaks (B-04, B-19 class); soak-tested.
- Watchdog-recoverable capture hardware (PF-13).

**Security baseline**
- PF-17 in full; additionally: forced first-login reset (LP-2), audited deletes
  with real actor columns (B-33 successor), Excel import validation (AD-6),
  authenticated recording playback (LP-10).

**Offline / degraded behavior**
- WAN down: recording, pause, stop, library, USB export all work; uploads queue
  and resume (PF-6); streaming shows a clear failure, doesn't block recording
  (B-16 ordering only applies when streaming is on).
- LAN LLM or quiz server down: AI studio unavailable state (LP-18); everything
  else unaffected.
- Disk critical: refuse start with clear messaging [D-15].

## 7. User journeys

**J-1 Record a lecture (happy).** Lecturer logs in (LP-1) → dashboard IdleHero →
taps Start → red frame + timer within 3 s (LP-4, INT-8) → pauses for a break,
resumes (LP-5) → taps Stop → "Saved" within 10 s (INT-5) → merge + upload run in
the background (PF-5/6) → recording appears in the library with an "uploading →
done" badge (LP-10, AD-9).
**Failure path.** CAM 1 is unplugged at start: the start transitions to `error`
within 5 s with a plain-language message and the source tile shows unhealthy
(LP-4, LP-8, PF-2) — the session is *not* marked recording (B-12 lesson). If the
disk is critically full, Start is refused with the storage warning [D-15]
(LP-12).

**J-2 Generate & publish questions (happy).** Recording is live; the 20-min
countdown fires (or lecturer taps Generate Now, which also resets the countdown,
LP-16) → "A new set is ready" → lecturer reviews 3–5 MCQs in the modal, edits
one, discards one → Send to Projector → projector switches from slides
passthrough to the question + join QR (PF-11); the question is simultaneously
live in the Quiz App (A-22). Responses stream into the Insights panel (LP-17,
QZ-7).
**Failure path.** The LAN LLM server is unreachable: generation fails visibly in
the studio with a retry option; countdown pauses; recording and all other panel
functions are untouched (LP-18). If the quiz server sync drops, sent questions
stay on the projector but the panel marks responses as stale (QZ-7).

**J-3 Student answers (happy).** Student scans the QR (QZ-2) → first-time
registration with name + student ID (QZ-3) → question appears → taps an answer;
first tap locks (QZ-4) → when the lecturer sends the next question, the previous
closes and the student sees own correctness, +10 points if correct, and own rank
(QZ-5/6).
**Failure path.** Student answers after close: rejected with "question closed"
(QZ-4). Student loses connectivity mid-question: on reconnect they see the
current open question if any; a missed question simply counts as unanswered
(accuracy = correct/answered per LP-17).

**J-4 Recording crash recovery (happy-recovery).** Power blips mid-lecture;
device reboots; persisted session (PF-3) shows recording was live 2 minutes ago
→ recording auto-resumes as a new segment, panel shows a "recording resumed
after recovery" banner (INT-7); at most ~5 s of material around the cut is lost
(INT-6); at Stop, all segments merge into one lecture and upload once (PF-4/5/6).
**Failure path.** Power returns hours later (outside the recovery window): the
session is finalized and preserved as a completed recording, visible in the
library; no auto-resume occurs; a Session-category log records the recovery
(INT-7, PF-15).

**J-5 Admin provisioning (happy).** Operator installs the unit and runs the
deploy-layer provisioning flow — institute profile, hall code, storage identity,
NTP/timezone [D-20][D-17] → admin opens Advanced: formats/mounts the recording
disk in one guarded step (AD-4), sets LAN/vLAN + camera IPs (AD-2), configures
streaming credentials (AD-8), bulk-imports the lecturer roster from Excel
(AD-6) → a lecturer logs in, hits forced reset (LP-2), records a test session
end-to-end.
**Failure path.** The Excel file has a null cell and a duplicate username: the
import is rejected with row-level reasons and nothing partial is written (AD-6,
B-44 contract). Formatting is attempted on the wrong target or fails midway: the
danger-zone confirm names the device, and a failed format leaves the previous
mount intact with a Hardware-category error (AD-4, PF-15).

## 8. Success metrics

Measured over the pilot (1–5 rooms, INT-12) and reviewed at the pilot exit gate
(INT-9):

1. **Session completion ≥ 99.5 %** of started recordings end as complete playable
   files (G-1); **zero** silent failures (every failed session has a surfaced
   error + log entry).
2. **Stop→playable p95 ≤ 10 s**; **Start→recording p95 ≤ 3 s**; touch feedback
   < 100 ms on the panel (INT-5/8).
3. **Upload autonomy ≥ 99 %** of recordings reach the LMS within 24 h with no
   operator action (G-3); dead-letter items < 1 % and all visible in AD-9.
4. **Crash robustness:** any induced power-cut test loses ≤ 5 s and recovers per
   INT-7; recovery drill passes on every pilot unit.
5. **AI engagement (AI-enabled rooms):** ≥ 50 % of sessions send ≥ 1 question;
   ≥ 60 % median response rate among joined students (G-4).
6. **Quiz integrity:** 100 % of answers are single-attempt-locked; student view
   never exposes another student's identity (INT-3/4).
7. **Admin self-sufficiency:** pilot provisioning (J-5) completed by institute IT
   without vendor SSH; zero placebo controls found in the Phase-5 parity audit
   (G-5/6).
8. **Security:** authorization test matrix (PF-17) passes for every endpoint ×
   role; no unauthenticated mutation or media route exists.

## 9. Phased timeline

Matches the revamp-guide phase map; quality-gated, no hard calendar (INT-12).
Phases 0–2 run now; Phase 3's entry conditions are met except the D-02b spec,
which the adapter pattern contains.

| Phase | Name | PRD-relevant deliverables | Gate |
|-------|------|---------------------------|------|
| 0 | Discover & Extract | Behavioral inventory, parity matrix, decision register *(done — this PRD's evidence base)* | Inventory confirmed |
| 1 | Define & Contract | **This PRD**, domain model, API contract v0 + WS events, state machines (LP-4, PF-4, QZ-4 lifecycles), screen inventory incl. the INT-1 surfaces | PM approves contract |
| 2 | Frontend Build | Design system + all Panel/Admin screens on the mock adapter, including the INT-1 gap screens (library, upload queue, account flows, takeover, storage warning, power-off) and scripted failure scenarios from §7 | Full demo on mock incl. failure states |
| 3 | Backend Architecture | Pipeline-manager design (A-05/A-13), service designs (upload queue PF-6, retention PF-7, logging PF-15), data layer [D-03], contract v1 + drift review; close remaining D-xx per register owners | Designs approved; open decisions closed or defaulted |
| 4 | Backend Build & Integration | core-api, pipeline-manager, AI services, Quiz App, real adapters; screen-by-screen integration; on-device NFR verification (§6 budgets) | End-to-end recording on target hardware |
| 5 | Evolve | Parity verification vs Phase 0 (incl. G-5 placebo audit), performance tuning, ADRs; **pilot deployment (1–5 rooms) → pilot exit review → staged fleet swap** (INT-9); per-room AI/quiz flag rollout (INT-10) | Legacy behaviors verified or consciously retired; pilot metrics (§8) met |

## 10. Open questions

Tracked in the [decision register](discovery/open-decisions.md) — IDs only, with
the PRD sections they gate; defaults are already baked into the requirements
above and tagged inline.

- **[D-02b]** → PF-6, PF-8, AD-9 metadata columns, LP-3 title mapping. Latest
  safe landing: Phase 4.
- **[D-03]** → PF-16. Phase 3.
- **[D-10]** → LP-14 stays placeholder. Post-launch.
- **[D-12]** → none if default (retire) stands; else PF-1 state machine gains a
  hardware event. Phase 3.
- **[D-13]** → PF-6 timing, AD-9 (schedule card existence). Phase 3.
- **[D-14]** → PF-6 queue-drained hook. Phase 4.
- **[D-15]** → LP-12 warning text, PF-7, refused-start transition in LP-4.
  Phase 3.
- **[D-16]** → AD-2 scope. Phase 2.
- **[D-17]** → AD-10 read-only time line, PF-19. Phase 2 (UI) / 3 (deploy).
- **[D-18]** → if reopened, LP-3/LP-4/LP-6 gain an unattended actor — the one
  widest-blast item; default (retire) assumed throughout. Phase 1.
- **[D-19]** → AD-8 picker contents. Phase 2.
- **[D-20]** → AD-10, J-5 provisioning flow, LP-3 hall-code source. Phase 3.
- **[D-21]** → QZ-3 identity model, LP-17 roster source. Phase 3.
- Open **fact-checks** (not decisions): hall-code/title format (P-1, LP-3),
  record-LED presence (PF-14), dongle model + passthrough latency (PF-12), mic
  ALSA name (LP-9), quiz-app hosting details (QZ-1), hub topology (PF-13) — see
  register §3 and hardware-topology.md §5.

---

*STOP — Phase-1 gate: PRD awaiting PM review. On approval, proceed to the domain
model (prompt 04) and state machines (prompt 05); amendments to A-14's prototype
drift (INT-11: countdown default 20) should also be applied to
`prototype/src/context/QuestionContext.tsx`.*
