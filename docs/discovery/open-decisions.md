# Open Decision Register — Discovery Update

> Phase-0 discovery artifact. Successor of
> [revamp-guide/reference/open-decisions.md](../../revamp-guide/reference/open-decisions.md)
> (the seed register): every seed entry is carried over, with **Blocks** updated to
> name the concrete discovery artifacts each decision now gates —
> [behavioral-inventory.md](behavioral-inventory.md) items (B-xx) and
> [feature-parity-matrix.md](feature-parity-matrix.md) rows — plus NEW open
> decisions (D-12…D-21) that discovery surfaced.
>
> **No decision is closed in this update.** Every open entry carries a
> **Default if unresolved by Phase 3** — the assumption the project proceeds on
> (and the Phase-2 frontend mock simulates) until the owner rules otherwise.
> Closing a decision still requires the owner named under **Who decides** and an
> ADR (prompt 15).

---

## 1. Open decisions — summary

| ID | Decision | Origin | Who decides | Latest phase w/o rework | Default if unresolved |
|----|----------|--------|-------------|-------------------------|------------------------|
| D-02b | Upload API specification | Seed | Institute (spec owner) + PM | Phase 4 | Build against placeholder contract |
| D-03 | On-device database | Seed | Tech lead / architect | Phase 3 | SQLite + Drizzle |
| D-10 | Room-controls hardware | Seed | PM + hardware engineer | Post-launch (Phase 5+) | UI stays placeholder |
| D-12 | Physical room hardware (record button, camera switch) | Discovery | PM + hardware engineer | Phase 3 | Retire both |
| D-13 | Upload timing policy (immediate vs windowed) | Discovery | PM + institute IT | Phase 3 | Immediate auto-upload, no windows |
| D-14 | Auto-shutdown after uploads | Discovery | PM | Phase 4 | Drop |
| D-15 | Disk-pressure retention behavior | Discovery | PM | Phase 3 | Uploaded-oldest-first early delete; block start when critical |
| D-16 | Wi-Fi provisioning | Discovery | PM | Phase 2 | Drop — wired only |
| D-17 | Time/NTP/timezone ownership | Discovery | PM + institute IT staff | Phase 2 (UI) / Phase 3 (deploy) | Deploy layer owns; UI read-only |
| D-18 | Scheduled recordings | Discovery | PM | Phase 1 | Retire — not in scope |
| D-19 | Streaming platform list | Discovery | PM | Phase 2 | YouTube + Facebook + Custom RTMP |
| D-20 | Home of provisioning powers (ex dev-admin) | Discovery | PM + tech lead | Phase 3 | Deploy-layer config, no UI page |
| D-21 | Class-roster provenance (quiz/leaderboard) | Discovery | PM + institute | Phase 3 | Quiz-app self-registration |

---

## 2. Open decisions — detail

### Carried over from the seed register

#### D-02b — Upload API specification *(architecture decided: A-19)*
- **Question:** exact request/response contract of the new institute upload API (metadata fields, auth, resumability, error semantics).
- **Options on the table:** new institute API — spec to be provided by the institute.
- **Blocks (concrete):**
  - Real upload adapter implementation (Phase 4) — matrix §3 "Scheduled upload pipeline" row; §5.2 item 8 (resumable job queue + pluggable adapter).
  - Title/metadata mapping — B-02 (filename-token metadata must become a DB→API mapping), B-24 (add→upload→complete + delete-on-failure protocol), B-25 (one-lecture-per-recording invariant incl. the `~2~cmb` duplicate-lecture gap), B-26 (institution-profile switch), B-28 (dead-letter state naming/surfacing).
  - Institute roster sync source — B-21, B-40 (institute login), matrix §3 "Institute user sync cron" row, §5.1 item 11.
  - Upload-queue status view design (Phase-2 gap) — matrix §5.1 item 2 (metadata columns only; layout can proceed).
  - Module-id question — matrix §2f `sdmodules` RETIRE row's veto (does the new API require module ids? then a server-side mapping is needed).
  - Roster feed for D-21 (leaderboard drill-down), if the institute API turns out to expose enrollment.
- **Default if unresolved by Phase 3:** proceed on the placeholder contract: payload = generated title (A-07), hall code, start/end timestamps, duration, segment/stream manifest, resumable multipart upload with add→upload→complete lifecycle and a dead-letter state. Mock adapter simulates success, mid-upload failure, and dead-letter.
- **Who decides:** the institute (spec owner); PM negotiates and accepts.
- **Latest phase without rework:** **Phase 4** — the adapter pattern (A-19) was chosen precisely so only the adapter changes; landing later than Phase-4 integration start means the real adapter slips the end-to-end gate.

#### D-03 — On-device database
- **Question:** storage engine for core-api.
- **Options on the table:** (a) SQLite + Drizzle (recommended for appliance); (b) MySQL (`mysql2`); (c) Postgres.
- **Blocks (concrete):**
  - core-api data layer design — matrix §3 "MySQL implicit schema + raw-SQL data layer" row; §5.2 item 9.
  - Explicit migrations replacing the implicit schema — B-62 (record_status, video_queue, settings, hdd_id, users/instituteusers/admins, indicators).
  - Parameterized-query rewrite — B-63.
  - Persisted recording-session state — B-03, B-07, B-08 (state that must survive restart).
  - Upload job queue schema — B-09, B-24, B-25 (replaces `video_queue` status-string conventions).
- **Default if unresolved by Phase 3:** SQLite + Drizzle. PM confirmed no fielded-device migration is needed, which removed the main argument for MySQL.
- **Who decides:** tech lead / architect.
- **Latest phase without rework:** **Phase 3** (Backend Architecture) — the data-layer design and migration set are Phase-3 deliverables; the Phase-2 frontend never sees the engine.

#### D-10 — Room controls hardware (projector power / lights / AC)
- **Question:** control pipelines for room devices.
- **Options on the table:** hardware engineer reports control pipelines "still in progress".
- **Blocks (concrete):** nothing in this release (PM confirmed) — matrix §4 "Room Controls" row ships `room/RoomControlsPanel` as placeholder (master mic mute is the only live control, owned by the real-mic-control row). Mildly related: §5.1 item 6 suggests Room Controls as the home for the power-off button — that placement does **not** depend on D-10.
- **Default if unresolved by Phase 3:** UI placeholder only; no backend for lights/AC/projector power.
- **Who decides:** PM with hardware engineer.
- **Latest phase without rework:** **post-launch (Phase 5+)** — deliberately deferred.

### New — surfaced by discovery

#### D-12 — Physical room hardware: record button + 4-way camera switch
- **Question:** are the GPIO record button (B-13) and the 4-way camera-switch button (B-62 `indicators` writer) live hardware in deployed rooms that the rewrite must support, or dead half-wired features to retire?
- **Origin:** inventory "Needs human confirmation" item 8; both are half-wired today (button flips a DB flag nothing reads; switch writes rows with no reader).
- **Blocks (concrete):** matrix §3 "Physical record button" and "4-way camera-switch button" RETIRE rows (each carries this exact veto); pipeline-manager design scope (prompt 10) — if kept, GPIO events become pipeline-manager inputs and the recording state machine gains a hardware-initiated stop/switch transition (B-05's LED handling is the pattern); record-LED itself is **not** part of this decision (kept per B-05).
- **Default if unresolved by Phase 3:** retire both; recording is controlled from the touch panel only. (Frontend mock has no button/switch affordance to simulate.)
- **Who decides:** PM (is it product?) with hardware engineer (is it wired on the new Radxa build?).
- **Latest phase without rework:** **Phase 3** — pipeline-manager design must include the GPIO event path if kept; resurrecting it in Phase 4 reopens the state machine and the design doc.

#### D-13 — Upload timing policy: immediate vs windowed
- **Question:** A-19 says recordings auto-upload, killing the legacy instant/scheduled toggle — but does the institute need upload *windows* (bandwidth protection during teaching hours), and is per-file manual re-enqueue an operator action?
- **Origin:** B-22 (windowed uploads with positional settings rows), B-30 (fake "instant" mode — silent no-op, do not carry), matrix §1a `fus` row and §5.1 item 2; §2c `fmupload` RETIRE row's veto (manual re-upload as re-enqueue).
- **Blocks (concrete):** upload job queue service design (matrix §5.2 item 8); Admin UI — whether an upload-schedule card exists at all (Phase-2 upload-queue status view, §5.1 item 2); B-22's window semantics (wrap-around-midnight, backup window) — carried or dropped.
- **Default if unresolved by Phase 3:** immediate upload on recording finish, resumable with retries; no windows, no toggle. Upload-queue view includes a manual re-enqueue action per file (replaces B-35's hardcoded endpoint). Mock adapter simulates uploads starting right after stop.
- **Who decides:** PM with institute IT (they own the network-load concern).
- **Latest phase without rework:** **Phase 3** — the queue service design either has a scheduler or it doesn't; adding windows in Phase 4 also retrofits the Admin UI.

#### D-14 — Auto-shutdown after uploads
- **Question:** resurrect "power off the device after the nightly upload batch completes" (a disabled stub in legacy) or drop it?
- **Origin:** B-29 (stub with commented-out body — no shutdown ever occurs); inventory item 8.
- **Blocks (concrete):** matrix §3 upload-pipeline row (queue-drained hook); B-50/power-off row (§2g) — the refuse-while-recording rule and shutdown path would be shared; couples to D-13 (only meaningful if uploads batch at night).
- **Default if unresolved by Phase 3:** drop. No automatic power-off; manual power-off (B-50, with the new refuse-while-recording rule) is the only shutdown path.
- **Who decides:** PM (facilities/energy policy question).
- **Latest phase without rework:** **Phase 4** — it is a small hook on the queue-drained event plus a config flag; no UI or contract impact.

#### D-15 — Disk-pressure retention behavior
- **Question:** A-20 fixes auto-delete at 14 days — but what happens when the disk fills *before* 14 days (legacy: hardcoded 80 % threshold, delete >7-day-old files **including never-uploaded ones**)? Delete early (which files first?), block new recordings, or both?
- **Origin:** B-20 (cleanup cron ignores upload status; inert `duf`/`fdd` settings), B-53 (Home warning tied to the 80 % threshold), matrix §3 "Storage cleanup cron" row and §5.1 item 7.
- **Blocks (concrete):** retention job design in core-api (matrix §3 cleanup row); lecturer-facing storage warning design (§5.1 item 7 — the warning text must state the real policy, B-53's lesson); recording-start precondition in the state machine (can a start be refused for disk space?); `LocalStoragePage` capacity semantics.
- **Default if unresolved by Phase 3:** at a configured pressure threshold, delete already-uploaded recordings oldest-first even if younger than 14 days; **never** auto-delete a never-uploaded recording; when critically full with nothing eligible, refuse new recording starts with a clear dashboard warning. Mock simulates the warning and the refused-start state.
- **Who decides:** PM.
- **Latest phase without rework:** **Phase 3** — the refused-start rule is a state-machine transition and the warning is a Phase-2 dashboard element; the default keeps both buildable now, but reversing "never delete un-uploaded" later changes the retention job only (cheap), while removing the refused-start state later touches contract + UI.

#### D-16 — Wi-Fi provisioning
- **Question:** does the appliance need Wi-Fi/SSID configuration, or is it wired-only?
- **Origin:** B-54 (SSID CRUD endpoints with fully commented-out UI; **no** wireless command anywhere in the codebase — the architecture map's "SSID via nmcli" claim is a MAP GAP); inventory item 8.
- **Blocks (concrete):** matrix §1a device/network settings row (SSID rows RETIRE-unless-roadmap); `admin/pages/NetworkSettings.tsx` scope (LAN + vLAN + camera IPs today); deploy-layer netplan work (§5.2 item 10).
- **Default if unresolved by Phase 3:** drop — wired-only appliance; no SSID UI, no wireless stack.
- **Who decides:** PM.
- **Latest phase without rework:** **Phase 2** — NetworkSettings is built in Phase 2; adding a Wi-Fi card later is UI + deploy-layer rework.
 
#### D-17 — Time / NTP / timezone ownership
- **Question:** who owns device time — an Admin UI page, or the deploy layer (preconfigured NTP/timezone) with at most a read-only display? Legacy's pickers were placebo, but correct time is load-bearing: generated titles (A-07), 14-day retention (A-20), upload windows (D-13), log timestamps (SystemLogs).
- **Origin:** B-55 (sys.jsx time pickers only `console.log`); matrix §1a System-page RETIRE row and §5.1 item 8.
- **Blocks (concrete):** Admin UI page list (does a System/Time page exist? — Phase 2); deploy-layer provisioning spec (chrony/NTP + timezone, `Asia/Colombo` assumption in B-22); SystemLogs timestamp trustworthiness (§4 System Logs row).
- **Default if unresolved by Phase 3:** deploy layer owns it — NTP + timezone configured at provisioning; Admin UI shows current time/sync status read-only (a line on an existing page, not a page of its own). No user-editable clock.
- **Who decides:** PM with institute IT staff (who would administer it).
- **Latest phase without rework:** **Phase 2** for the UI question (page exists or not); **Phase 3** for the deploy-layer mechanism.

#### D-18 — Scheduled recordings
- **Question:** legacy stored "Schedule Settings" nothing ever consumed (placebo). Is unattended, timetable-driven recording a roadmap feature, or retired?
- **Origin:** B-55 (`ss` settings CRUD, no consumer); matrix §1a Schedule-settings RETIRE row's veto ("then it becomes NEW design work").
- **Blocks (concrete):** if resurrected, this is the widest-blast open item: the domain model and recording state machine (prompt 04/05) gain an unattended-start actor, A-07's one-tap model gains a scheduler, and the mutual-exclusion rules (B-15) need a machine-initiated variant. If retired: nothing — the RETIRE row stands.
- **Default if unresolved by Phase 3:** retire. Recording starts only from a human tap on the panel.
- **Who decides:** PM.
- **Latest phase without rework:** **Phase 1** — it must be in the PRD/domain model/state machines to land cheaply; after the contract freezes, it is a contract-version bump and new screens. (Given the default, silence is safe; a *yes* after Phase 1 is the expensive path.)

#### D-19 — Streaming platform list
- **Question:** reconcile three platform lists: legacy flags (Facebook/YouTube/Twitter/LinkedIn, B-59), A-10's launch set (YouTube + Facebook, "others later"), and the prototype's picker (Twitch + Custom RTMP among them).
- **Origin:** matrix §1 Live-Stream-setup row ("reconcile the platform list"); B-58 (FB URLs need the stunnel4 RTMPS bridge — platform choice has infrastructure weight), B-59.
- **Blocks (concrete):** `admin/pages/StreamingConfig.tsx` platform picker contents (Phase 2); streaming relay design (which platforms need RTMPS bridging — §2a stream-control row); saved-config schema in core-api.
- **Default if unresolved by Phase 3:** YouTube + Facebook as first-class options (per A-10), plus one generic **Custom RTMP** entry (URL + key) that covers Twitch/LinkedIn/anything else without per-platform code. No Twitter/LinkedIn tiles.
- **Who decides:** PM.
- **Latest phase without rework:** **Phase 2** — it's the picker's contents; adding a generic Custom RTMP now makes later platform additions config, not rework.

#### D-20 — Home of provisioning powers (ex dev-admin)
- **Question:** the role model collapses user/admin/dev-admin → lecturer/admin (A-21). Where do dev-admin's provisioning powers go — upload-domain/institute profile (B-47), storage identity + HDD registration (B-51), SD-card path, hall code (A-07)? Into the Admin UI, or into a deploy-layer config store with no UI?
- **Origin:** matrix §1 settings-shell row ("decide explicitly whether dev-admin's provisioning powers fold into admin or into the deploy layer"), §1a Dev-options row, §5.1 item 9.
- **Blocks (concrete):** Admin UI page list (Phase 2 — is there a Provisioning page?); core-api config-store design (typed config replacing `.env` sed-ing, B-47/B-48; boot-frozen `isSliit` B-26 must not recur); deploy-layer provisioning flow (§5.1 item 9); hall-code source for A-07 titles; role-permission matrix (B-43 successor).
- **Default if unresolved by Phase 3:** deploy layer owns provisioning — institute profile, hall code, and storage identity live in a config store written at install time (documented flow, not a UI); the Admin UI shows device identity read-only. HDD swap/format (B-51/B-52 successor) stays an Admin-UI operation since IT staff do it in the field (A-21).
- **Who decides:** PM with tech lead (who owns the deploy layer).
- **Latest phase without rework:** **Phase 3** — the config store and deploy layer are Phase-3 designs; moving provisioning *into* the UI later adds screens but doesn't break the store, while the reverse (UI first, then ripping it out) is rework.

#### D-21 — Class-roster provenance for quiz identity & leaderboard
- **Question:** the leaderboard and per-student drill-down (A-16) need student names + IDs. Where does the roster come from — the institute API (D-02b), quiz-app self-registration at first join, or manual import?
- **Origin:** matrix §4 Insights-panel row ("mock `CLASS_ROSTER` today — roster provenance is undecided, likely D-02b-adjacent"); A-16 (basic login now, SSO later; leaderboard = name + ID, panel-only).
- **Blocks (concrete):** Quiz App account/data model (§5.2 item 2 — basic login now must be designed against *some* identity source); `LeaderboardPanel`/`StudentDetailDialog`/`NamesDialog` data contract; device↔quiz-server sync payload (does the device ever hold roster data?); couples to D-02b (if the institute API exposes enrollment) and to the SSO-later path.
- **Default if unresolved by Phase 3:** quiz-app self-registration — students enter name + student ID on first join (validated format, no email verification); leaderboard keys on student ID; roster import/SSO is a later upgrade that maps onto the same IDs. Panel mock continues simulating a roster.
- **Who decides:** PM with the institute (data-protection and SSO roadmap).
- **Latest phase without rework:** **Phase 3** — the Quiz App's identity model is a Phase-3 service design; self-registration now upgrades cleanly to SSO, but starting SSO-first later would rework onboarding.

---

## 3. Small open fact-checks (not design-blocking, not decisions)

Carried from the seed register: dongle model, mic ALSA name, camera models,
record-LED presence on the new board, passthrough latency, hall-code/title format
(SLIIT-001 vs LAC001 — flagged ⚠ in A-07), quiz-app hosting details — tracked in
[hardware-topology.md](../../revamp-guide/reference/hardware-topology.md) §5.

Added by the behavioral inventory ("Needs human confirmation", items 1–7, 9–10 —
facts to obtain, not choices to make):

1. Out-of-repo configs: nginx site + rtmp conf (B-37/B-51/B-58/B-61), udev/ALSA rules (B-01), systemd units + sudoers (B-05/B-06/B-13), stunnel4 config (B-58).
2. LMS `external_service.php` response shapes + whether `full_login_list` passwords are md5 digests (B-21/B-40) — matters only for historical understanding once D-02b lands.
3. Production DB seed rows and whether any `indicators` reader exists outside this repo (B-62) — feeds D-12.
4. Production `.env` values per site (B-47).
5. `uhubctl -l 2-1 -p 2` hub topology — universal or per-unit (B-39).
6. Whether paused dual recordings ever produced duplicate LMS entries in production (`~2~cmb` gap, B-25) — informs the D-02b contract.
7. Whether ESS settings values feed anything outside this repo (B-55 / matrix ESS RETIRE veto).

---

## 4. Decided (carried over unchanged — ADRs via prompt 15 when adopted)

Discovery cross-refs added; outcomes are verbatim from the seed register.

| ID | Decision | Outcome | Discovery cross-refs |
|----|----------|---------|----------------------|
| A-01 | Migration strategy | Layered rewrite (Option C) with frontend-first sequencing per client requirement | Matrix dispositions throughout |
| A-02 | AI serving | Self-hosted LLM on LAN (llama.cpp `/completion`); Vosk STT + Tesseract OCR on device; no cloud. STT pinned to the four A76 cores. RK3588 NPU optional later. | Matrix §4 AI row, §5.2 item 1 |
| A-03 | Scope | Full rewrite of all legacy features + new AI/quiz features; room controls UI mock-only (D-10) | Matrix §1–§4 |
| A-04 | Guide format | Markdown phase docs + ordered prompt library in `/revamp-guide` | — |
| A-05 | Pipeline architecture | shm publisher/consumer decoupling + generated consumer pipelines (proven by `/scripts/bash` + `eduscope_web.py`) | Replaces B-01's 124-branch matrix, B-06's global kill, B-18's kill-and-restart switching |
| A-06 | Hardware | Radxa ROCK 5 ITX+ (RK3588, 24 GB, `mpph264enc`/`mppvideodec`); X11 confirmed; OS on SD card, recordings on a separate disk; board confirmed to handle record + stream + meeting output simultaneously | Encoder-settings validation (matrix §1a ES row); replaces Jetson elements in B-01 |
| A-07 | Session metadata | No lecturer input at start. Hall name hardcoded per device (provisional "SLIIT-001" — final naming later); title generated as `[Hall] – [Date] [Time]` (⚠ confirm hall code + exact pattern, P-1). Module dropped. One-tap start. | Retires B-16 field requirements, B-02 filename-as-metadata, §2f dropdown feeds; hall-code source is D-20 |
| A-08 | Source set *(amended 2026-07-22)* | `pc` + `cam1` + `cam2` + one lecturer mic only — room mic removed. Camera-only recording must work. shm sockets unchanged. | Replaces B-01 source permutations, B-57 enumeration; mic control matrix §4 |
| A-09 | Output channel & layout model *(amended)* | Three channels; Local Recording + Live Streaming use PC-inclusive presets; Live Meeting uses camera-only presets. | Replaces B-60 quick presets; `LayoutPresetId` in `types.ts` |
| A-10 | Live streaming path | RTMP via local nginx (+ stunnel4 for RTMPS). Launch platforms: YouTube + Facebook (others later). Preflight per `check_live.sh`. | B-58/B-59 successors; platform list detail is D-19 |
| A-11 | Display outputs *(reworded)* | HDMI-out #1 = projector (passthrough + quiz overlay); HDMI-out #2 = camera composite + mic audio → dongle → laptop; USB-C→HDMI = touch panel kiosk. | Matrix §4 projector-consumer + meeting-path rows |
| A-12 | Pause semantics | Consumer stop/restart; separate file segments joined by the system — PM-confirmed. | Retires B-09/B-10 groupid bookkeeping, B-34 user-triggered merge (and its ship-unmerged race) |
| A-13 | pipeline-manager language | Python/FastAPI, evolved from `eduscope_web.py` | — |
| A-14 | AI question format & cadence | MCQ only; 10/15/20/30-min countdown (default 20); generate-now resets; batches of 3–5; one "now showing" | Matrix §4 AI row |
| A-15 | Live Meeting integration (closed D-05b) | HDMI-out #2 composite → HDMI→USB dongle as standard webcam + mic; platform Share Screen for slides. No SDK/bot/WebRTC meeting integration. | Matrix §1 LMC row + §4 hardware-path row |
| A-16 | Student quiz platform (closed D-06) | Separate Next.js app on campus web server, public domain, QR join; basic login now, SSO later; leaderboard panel-only, never on projector. | Matrix §4 quiz rows; roster provenance is D-21 |
| A-17 | Panel thumbnail transport (closed D-07b) | WebRTC full-motion previews in the panel UI. | Replaces B-17/B-18 JPEG-over-socket (and B-19 leaked intervals) |
| A-18 | PC capture input (closed D-11) | Stay with the USB HDMI capture dongle. | B-39 watchdog successor still needed |
| A-19 | Upload architecture (closed half of D-02) | Auto-upload to new institute API; pluggable adapter + resumable job queue against placeholder contract (D-02b). | Retires B-30 fake instant mode, B-35 manual endpoint; timing detail is D-13 |
| A-20 | Recordings library rules | Lecturers + admins play; only admins delete; auto-delete after 14 days. | Governs matrix §1 FM row, §2c rows, §3 cleanup row; disk-pressure detail is D-15 |
| A-21 | User management | Bulk Excel import required; admin section for IT staff; no migration from old devices. | Matrix §1a UM row (B-44 validation is the baseline contract); role collapse feeds D-20 |
| A-22 | Projector question flow | Send-to-projector = overlay/switch from slides passthrough to question + join QR; simultaneously live on the quiz app. Leaderboard never on projector. | Matrix §4 projector rows |
