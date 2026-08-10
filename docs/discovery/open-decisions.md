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

---

## 5. Decided during wireframe approval — S-01 / S-02 (2026-08-04)

Nine questions surfaced while designing **S-01 Login** (§9 **W-13**) and
**S-02 Forced password reset** (§9 **W-1**) — the three that shape the
wireframes, plus six that were slated to land here as `D-22`…`D-27`. All nine
were **answered in session and none remains open**, so none becomes a `D-xx`
register entry. They are recorded below as eight decisions (Sign out and the
`/auth/logout` exemption resolved together). This register is the single index of
decisions taken; the full rationale, wireframes and consequences live in
[S-01-design.md](../design/screens/S-01-design.md) and
[S-02-design.md](../design/screens/S-02-design.md).

Four of the six imply a **contract change**. Those are listed again in §5.2
because they block Wave 1 and are not yet in `contracts/openapi.yaml`.

### 5.1 Outcomes

| Id | Question | Outcome | Contract change? |
|----|----------|---------|------------------|
| **S01-D-1** | The prototype's role picker is removed (role comes from `getMe`, LP-1) — what fills the hole in the card? | **Nothing.** The card shrinks. Only `login` and `refreshToken` carry `security: []`, so S-01 has no readable data at all before a successful POST — `getProvisioning` (hall name), `/health` and `getMe` are all bearer-gated. A device-identity block would need a new kiosk runtime-config surface, and B-46's disposition explicitly rejects baking device values into the frontend. The reclaimed ~90 px becomes a permanently-reserved message slot | no |
| **S02-D-1** | Password policy — the contract enforces `minLength: 8` only; B-42 enforced ≥8 + digit + upper + lower | **Legacy parity**: ≥8 + digit + uppercase + lowercase. No security regression against the system being replaced, and no retraining. The server rule and the client's `password-policy.ts` must be byte-identical or the live checklist promises acceptance it cannot deliver | **yes — §5.2 #3** |
| **S02-D-2** | `ChangePasswordRequest` requires `currentPassword` even on the forced path — does the user re-type the password they entered at S-01 seconds earlier? | **Yes — three fields on both paths.** Replaying the captured password would hold plaintext in JS memory across a route transition on a shared kiosk *and* would still need the three-field form as a fallback for a reload or restored token, so it builds both forms to save one field | no |
| **S01-D-3** | `Problem.code` has no disabled-account code, but S-01 specifies a distinct message — and a distinct message is account enumeration | **Add `auth.account-disabled` and show the message.** Enumeration is a weak threat when the attacker must already be standing at a kiosk in a lecture hall on the campus LAN, and INT-1 named account flows a V1 must-have precisely because *"my password stopped working"* was a real support burden | **yes — §5.2 #2** |
| **S01-D-5** | `auth.session-revoked` cannot distinguish expiry from logout-elsewhere from an **R-21** takeover, but S-01's `session expired` state must show *why* | **`Problem.meta.reason`** = `expired \| logout \| takeover \| admin`. `Problem` already carries a free-form `meta`, so this is additive and leaves the closed `code` enum alone — and it is the only option that carries R-21's takeover through to the screen, which W-2 (S-06) needs anyway | **yes — §5.2 #1** |
| **S02-D-3** | `/auth/logout` is not exempt from `403 auth.password-reset-required`, so a user parked on S-02 cannot end their session | **Exempt it.** Revoking your own session is not a surface the reset lock protects — the lock exists to stop a half-provisioned account *reaching* the dashboard, and logging out is the opposite of that. Without the exemption, an abandoned kiosk carries a live `AuthSession` until expiry | **yes — §5.2 #4** |
| **S02-D-4** | Password-visibility reveal — where, given it may only be an explicit ≥44 px button? | **S-02's *New password* field only.** It is the one field where a typo is unrecoverable and the confirm field can say *that* you mistyped but never *what* you typed. Every other placement adds bystander exposure in a lecture hall for no ergonomic gain | no |
| **S02-D-8** | S-02's `voluntary` path is specified as "reached from the header menu", but S-03 enumerates only a logout control — there is no menu | **S-03's header user name becomes a `▾` menu** with two ≥56 px rows: *Change password* → `/login/reset` carrying `state.from`, and *Sign out*. Smallest change that satisfies LP-2's second half; the header already hosts logout and already shows the user | no |

### 5.2 Contract changes these decisions imply (v0.2)

All four are **additive** and all four **block Wave 1**. They also belong in
[screen-inventory §10](../design/screen-inventory.md#10-contract-gaps) as CG
rows; the design docs name them but deliberately do not edit §10.

| # | File | Change | From |
|---|------|--------|------|
| 1 | `contracts/openapi.yaml` — `Problem.code` | Add `auth.account-disabled` | S01-D-3 |
| 2 | `contracts/openapi.yaml` — `Problem` | Add `meta.reason`: `expired \| logout \| takeover \| admin`, set on `auth.session-revoked`. **No change to the closed `code` enum** | S01-D-5 |
| 3 | `contracts/openapi.yaml` — `ChangePasswordRequest.newPassword` | Enforce ≥8 **+ digit + uppercase + lowercase** server-side; today the schema carries `minLength: 8` and nothing else | S02-D-1 |
| 4 | `contracts/openapi.yaml` — §Auth prose (lines 33-35) | Add `/auth/logout` to the `mustResetPassword` exemption list, alongside `/auth/change-password` and `/auth/me` | S02-D-3 |

### 5.3 Also closed by these wireframes

The two new semantic colours flagged in
[screen-inventory §8.2](../design/screen-inventory.md#82-color--ink-scope-semantics-brand)
as *"needing approval with the wireframes"* — `--danger`/`--danger-soft` and
`--info`/`--info-soft` — are consumed by both screens (S-01's `rejected` and
`backend unreachable`, S-02's `mismatch` and forced-reason block). They already
sit in `apps/panel/src/styles/tokens.css:44-48` marked pending. **Approving these
two designs closes that item.**

---

## 6. Decided during wireframe approval — S-06 / S-12 (2026-08-05)

The successor of §5, for Wave 2's first two wireframe rows: **S-06 Recorder lock
& takeover** (§9 **W-2**) and **S-12 Power-off confirm** (§9 **W-3**). Ten
questions surfaced while designing them. **All ten were answered in session and
none remains open, so none becomes a `D-xx` register entry** — §1 and §2 are
unchanged by this run. This register is the single index of decisions taken; the
full rationale, wireframes and consequences live in
[S-06-design.md](../design/screens/S-06-design.md) and
[S-12-design.md](../design/screens/S-12-design.md).

Four of the ten imply a **contract change**, listed again in §6.2 because they
block Wave 2's plan run and are not yet in `contracts/`.

**One outcome carries a recorded fallback rather than an assumption.** §6.1
`S06-D-5` proposes a server guard the contract owner may reject; if it is
rejected, S-06 shows the mic controls **live** and says so. It does not
fake-disable them, and it does not proceed as though the guard existed.

### 6.1 Outcomes

| Id | Question | Outcome | Contract change? |
|----|----------|---------|------------------|
| **S12-D-1** | **CG-6** — add `POST /device/restart`, or confirm power-off-only? The row argues that a kiosk power-cycled only by walking to the rack is an operational cost | **Confirmed: power-off only, no restart in v0.x.** PRD LP-13 and B-50 are both power-off only, so restart is scope, not parity. The operational argument does not survive the wireframe: the person tapping the control is standing at the panel, *in the room, next to the device*, so restart saves no walk they were not already taking. A restart route is also served by the very process a restart exists to fix, making it unavailable in its own motivating fault — the same principle G-5 applies to placebo controls. Deferring is free: it would be additive and would reuse R-22's refusal and this dialog verbatim | **no** — CG-6 closes as a *confirm* |
| **S06-D-2** | screen-inventory's `locked (admin)` offers **Take over and Stop** side by side, which is why its touch note has to patch "8 px is not enough here" — keep both? | **Take over only; Stop is removed.** *Deviates from the approved inventory row.* It leaves the screen with the one dangerous button that touch note already assumes, dissolving the adjacency problem rather than patching it. R-21 writes an `AuditLogEntry(action=takeover)` where R-11 writes only a `log.entry`, so routing every third-party stop through takeover means **nobody ends another person's lecture without their name on it**. Stop afterwards is then the ordinary owner-equivalent one-tap transport, leaving **S-07's "do not add a confirm dialog to Stop" intact**. Cost: one extra tap, which the confirm was going to be anyway | no |
| **DGR-D-1/2** | S-06's Take over and S-12's Power off are the first two destructive confirms, and S-24 / S-30 will inherit whatever they establish — one vocabulary, or per-screen treatments? | **One, settled once.** Two tiers: `danger-quiet` (`--danger-soft` fill, `--danger` label, 1 px `--danger` border) for the **entry** control on any surface, and `danger-solid` (`--danger` fill, `#fff`) for the **confirming** button inside the shared dialog and nowhere else. The rule is *destructive intent is quiet on a surface and solid only in a confirm* — no filled red button in this product acts on first tap, and the shape a lecturer learns on one screen transfers to screens they have never seen. Footer separation is `--sp-10`, which the token sheet already names "danger separation" | no |
| **DGR-D-3** | How is a destructive confirm dismissed on a kiosk that has **no Escape key**, given `OverlayHost` offers a `dismissible` flag? | **`dismissible: false`; the only exits are Cancel, the destructive action, or the outcome.** Nothing is lost on the kiosk — Cancel is already the touch exit — and it stops a stray palm on the scrim or a bench keyboard's Escape from dismissing a dialog whose command is in flight. Focus is trapped and **opens on Cancel, never on the destructive button**. `OverlayHost` is used as it stands; no second overlay mechanism was proposed | no |
| **S06-D-5** | `PUT /audio/controls/{roleId}` has no owner guard, so a non-owner at the panel can mute the lecturer's microphone mid-lecture via S-09 or S-11's master mute. Disable it client-side? | **No — guard it server-side first.** Client-only enforcement is precisely **B-15**, the defect S-06 exists to correct ("the legacy UI enforced it, which is to say it didn't"). Filed as a contract change: `G-AUTH-OWNER` while a session is non-terminal, `403 not-authorized`. **Fallback if rejected: S-06 shows the controls live**, not fake-disabled | **yes — §6.2 #2** |
| **S06-D-6a** | Does taking over transfer **ownership** of the lecture? | **No — authority only.** R-21's *To* column is `unchanged`: it sets `takeoverBy`/`takeoverAt` and audits, and does **not** rewrite `ownerUserId`, so the recording stays the prior owner's for the rest of its life. The whole copy deck is written against the one likely misreading — that a button called *Take over* claims the lecture, or interrupts it. The mock is bound by the same rule: a mock that rewrote the owner would teach the UI a lie the server will not tell | no |
| **S06-D-6b** | R-21 ends the prior owner's authority *"`revokedReason=takeover` **if** their kiosk session is replaced"* — which branch does the UI design for? | **Both, and the condition itself is left to the server.** Whether an `AuthSession` is replaced is a server rule and a UI wireframe is the wrong place to settle it; designing one branch would leave the other unhandled whichever way it lands. The in-panel branch is S-06's displaced-owner notice, the sign-in branch is S-01's `session expired` with `reason: takeover` — **one R-21 event, one vocabulary**, with the shared first sentence held in a single constant so it cannot drift | no |
| **S12-D-2** | `powerOffDevice` returns `202 + resolveBySec`, but events.md §10 is a closed catalog with **no event that resolves a power-off** — how does the panel know it worked? | **The transport closing *is* the resolution, and the contract must say so.** Read literally today, U-4 renders a failure ten seconds after every *successful* shutdown. `resolveBySec` is redefined for this one operation as the **not-halted** threshold: if the socket is still alive when it elapses, the panel says so and offers **one** explicit *Try again* — never an automatic retry, and never a closable dialog, because a shutdown cannot be un-sent. This is the direct inversion of B-50, which answered "Successfull" on both branches | **yes — §6.2 #3** |
| **S12-D-3** | R-22 emits `system.alert{poweroff.refused}` *and* the caller gets a `409` — does the requester see both? | **The requester reads the 409 only; the shell banner is suppressed while the overlay is open.** U-5 puts a refusal next to the control that was pressed, and two carriers for one fact on one screen is how a user learns to ignore banners. The banner row stays for the second panel and the alert list — which is also why the emitter has to be licensed in the catalog | **yes — §6.2 #4** |
| **S12-D-4** | Is power-off blocked client-side while recording, or only refused server-side? | **Both, and neither substitutes for the other.** The entry control is disabled with its reason **inline above it** (never a tooltip — §0.4) so a lecturer does not open a shutdown dialog over a live lecture; the dialog still implements `refused (recording)` because the server is the authority and the client's belief can be one event stale. One string serves both, so the race does not read as a second, unrelated problem | no |

### 6.2 Contract changes these decisions imply (v0.3)

All four are **additive** and all four **block Wave 2's plan run**. They also
belong in [screen-inventory §10](../design/screen-inventory.md#10-contract-gaps)
as rows CG-14…CG-17; the design docs name them but deliberately do not edit §10.

| # | File | Change | From |
|---|------|--------|------|
| 1 | `contracts/openapi.yaml` — `RecordingStateSnapshot` + `RecordingStatePayload` | Add `takeoverAt: Instant \| null` and `takeoverByDisplayName: string \| null`, populated by R-21. `takeoverBy` is a bare ULID and `listUsers` is admin-only, so the displaced lecturer cannot resolve it | S06-D-6a/b |
| 2 | `contracts/openapi.yaml` — `updateAudioControl` | Guard with `G-AUTH-OWNER` while a session is non-terminal; declare `403 not-authorized`. The operation declares only `202`/`422` today | S06-D-5 |
| 3 | `contracts/openapi.yaml` — `powerOffDevice` description | State that the command has **no resolving event** and that resolution is the transport closing; `resolveBySec` becomes the *not-halted* threshold | S12-D-2 |
| 4 | `contracts/events.md` — §2.10 `system.alert` emitter list | Add **R-22**, which state-machines already has emitting `poweroff.refused` and which §2 S-03's banner host already renders. §10 there is the closed catalog, so today the emitter is unlicensed | S12-D-3 |

### 6.3 Also settled by these wireframes

- **CG-6 closes as a *confirm*, not a change** (S12-D-1), so
  [screen-inventory §10.1](../design/screen-inventory.md#101-when-the-contract-actually-changes)'s
  `v0.3` bump now carries CG-14…CG-17 instead.
- **The product-wide destructive-action vocabulary** (DGR-D-1…DGR-D-4) is
  settled for **S-24 and S-30 as well**, which may not define their own. It
  introduces **no new token**: `--danger`/`--danger-soft` were approved with W-1
  and W-13 (§5.3) and already ship, and the dialog scrim is a `color-mix` over
  `--ink` rather than a new colour.

---

## 7. Decided during wireframe approval — S-05 / S-11 (2026-08-05)

The successor of §6, for Wave 2's remaining two wireframe rows: **S-05
Dashboard — the `ai disabled` layout** (§9 **W-14**) and **S-11 Room Controls —
the `[D-10]` placeholder pattern** (§9 **W-15**). Twenty decisions were taken
across the two runs. **All twenty were settled in session and none remains open,
so none becomes a `D-xx` register entry** — §1 and §2 are unchanged by this run.

The **fifteen that shape the wireframes** are tabled in §7.1. The remaining five
(`S11-D-6`…`S11-D-10`) are consequences of `S11-D-1`…`S11-D-5` rather than
independent questions and live in
[S-11-placeholders-design.md §11](../design/screens/S-11-placeholders-design.md#11-decisions-taken-here);
the two of them that reach beyond their own screen are called out under the
table. This register is the single index of decisions taken; the full rationale,
wireframes and consequences live in
[S-05-ai-disabled-design.md](../design/screens/S-05-ai-disabled-design.md) and
[S-11-placeholders-design.md](../design/screens/S-11-placeholders-design.md).

**This gate is the first to imply no contract change at all** (§7.2). It also
carries the first deliberate **deviation from a PRD requirement's wording**
(§7.1 `S11-D-1` vs LP-14), recorded rather than smuggled.

> **Why this is not an edge-case run.** INT-10 makes `aiQuizEnabled = false` the
> **go-live default** for recording-first rooms. The `ai disabled` layout is not
> a fallback — it is the layout most rooms will run for most of their first year,
> and it is designed as a first-class layout on that basis.

### 7.1 Outcomes

| Id | Question | Outcome | Contract change? |
|----|----------|---------|------------------|
| **S05-D-1** | screen-inventory suggests a *"source/output confidence view"* for the empty main column, offered as a starting point to accept or reject. Accept it? | **Accepted and reframed.** The inventory named the ingredients; what it did not settle is the shape. A four-block telemetry panel handed to a non-technical lecturer (G-2) is noise. The card is a **verdict plus its evidence** — one sentence readable from the lectern, with sources, outputs and disk beneath it — *calm when healthy, loud and specific when not* | no |
| **S05-D-2** | W-14's brief names only the main column, but S-16/S-17 can never fill with the flag off either. What is the scope? | **The whole layout.** With `aiQuizEnabled = false` machine 2a never leaves `unavailable`, so no `QuestionSet`, publication or quiz session ever exists — the insights card is not *empty*, it is **unfillable**. `.us-insightswrap` is **not rendered** (an empty state promising questions a room cannot send is one step from the placebo class G-5 forbids); S-08 absorbs the space and its accordion **defaults to open**. S-05's mutual-exclusion rule survives **verbatim** — it simply has no second participant | no |
| **S05-D-3** | The card summarises four machines into one sentence. What stops that sentence being a **B-12 silent success**? | **The verdict is never greener than its worst input, and `unknown` outranks `online`.** A strict worst-case fold with `checking` ranked *above* `assured`, so a stale projection can never keep the last good sentence. This is INV-DH-2 applied to prose rather than to tiles, and it is implemented as one pure, table-tested function so it cannot be locally overridden | no |
| **S05-D-4** | The tiles could be live WebRTC previews like S-09's | **Status surfaces, not video; full motion stays in S-10.** Three decodes here *plus* S-09's expanded bar is six concurrent previews on a board simultaneously recording, streaming and driving HDMI-out #2 (A-06 / PF-5/6). Tap-to-preview is also the interaction S-09 already teaches | no |
| **S05-D-5** | The card occupies the AI studio's slot. Does it inherit the `.us-assistant` ink scope? | **No — the card is light.** The dark scope *means* "the AI/insights family" (§8.3); spending the product's one piece of visual vocabulary on an unrelated card would dilute it. A room without the AI stack showing **no ink surface below the header** is the honest visual consequence of the flag, not a hole to patch | no |
| **S05-D-6** | Disk headroom rendered as "≈ 4 h 20 m left"? | **Bytes only, plus a sentence generated from `RetentionPolicy`.** No achieved-bitrate figure is reachable by the panel, and INV-RP-1 exists because B-53 shipped a hardcoded threshold contradicting the real policy. A fabricated estimate on the one card whose job is to be trustworthy is that defect at a higher stake. Recorded as **CG-18**, closed on arrival in CG-9's style | **no** — CG-18 closes as an *omission* |
| **S05-D-7** | Does the live panel say anywhere that AI questions are off in this room? | **No — silence on `/`; the fact lives in S-36.** S-13 already rules the card is hidden rather than greyed, and a sentence explaining the absence re-introduces the surface by other means. In a never-enabled room it advertises a feature the room cannot have. **S-36** already renders `DeviceProvisioning.featureFlags` read-only — the fact belongs where someone asking *why* would look, beside the people who can change it | no |
| **S05-D-8** | `sourcesOpen` and `controlsOpen` are **independent** in the prototype and `.us-main` merely clips. Introduce a mutual-exclusion rule for the two bottom bars? | **No — design the card at the floor instead.** Both bars open leaves **388 px**; the card is specified there and grows to 602. Inventing a rule would change two approved screens (S-09, S-11) to save one card that can simply fit, and it would make `.us-main`'s `overflow: hidden` load-bearing rather than a backstop | no |
| **S05-D-9** | How does the card shrink from 602 px to 388 px? | **Condensation, never omission.** Fixed collapse order — disk detail, then tiles to S-09's proven 152 × 86 floor, then the verdict to one line. **`SAVING TO` never condenses.** Every fact present at 602 px is present at 388 px; only typography and chrome change. Otherwise opening a bottom bar becomes a way to *lose information*, and a lecturer would have to remember which bar hides which fact | no |
| **S05-D-10** | Two layouts of S-05 — one screen or two? | **One screen that chooses.** A single `useAiEnabled()` picks the main-column child and whether `.us-insightswrap` mounts; chrome, transport, meeting card and both bottom bars are shared. Two screens would drift, and INT-10 means **both** layouts are long-lived — the flag-off one more so | no |
| **S11-D-1** | The five `[D-10]` rows must read as not-connected from across a room, while the master mic in the same bar is real. Mark the rows, or restructure? | **Restructure: real controls and `[D-10]` rows never share a region.** Groups become `MICROPHONE` / `POWER` / `NOT CONNECTED`. At three metres only **silhouette** resolves — 14 px captions, 12 px labels, 1 px dashed borders and colour all fail that test — so the distinction must be structural. The prototype's `Audio` group mixes a live mic with a dead speaker control, the arrangement that most reliably teaches that a row's neighbours prove nothing. **Deviates from PRD LP-14's "Projector / Audio / Environment groups"** while preserving its actual content ("inert except master mic mute") exactly; precedent for a gate deviating from an approved row is `S06-D-2` | no |
| **S11-D-2** | Is deleting the control enough? | **No — the state string goes too.** `RoomControlsPanel.tsx` renders "Projector · On", "Lights · On", "A/C · 22 °C" from five `useState` seeds: **claims about hardware nothing is talking to**. G-5 is usually read as being about controls, but a readout asserting a projector is On is the same lie with no button attached — and the one a lecturer would actually act on. A `[D-10]` row keeps an icon and a name and nothing else | no |
| **S11-D-3** | What does *"unmistakable from across a room, without hover and without a tooltip"* actually require? | **Silhouette is the carrier; text and colour are secondary.** Stated explicitly because the alternative is a pattern that *claims* to work at distance while depending on 14 px captions. It is also what eliminated the "keep the controls, disable and label them" option before accessibility was even considered, and it is the criterion any future variant must pass. Corollary: **no new placeholder colour or tint** — that would make the pattern colour-dependent, defeated by greyscale and colour-blind reading alike | no |
| **S11-D-4** | The brief says the answer is reused wherever `[D-10]` hardware appears. Where does it live? | **`NotConnectedRegion` is the product-wide `[D-10]` pattern**, four rules (RC-D-1…RC-D-4), inherited and not restated — the same arrangement by which S-24 and S-30 inherit DGR-D-1…DGR-D-4. The component takes **no data source and no client**, only a static `{icon,name}[]`: a component with no way to receive a value cannot be given one in a later run, which makes G-5's Phase-5 audit structural rather than a code review. When `[D-10]` lands, a row *moves out* of the region and nothing is redesigned | no |
| **S11-D-5** | The notice wording — "not connected **yet**"? | **State a fact, not a roadmap: "These are not wired to this device."** `[D-10]` is genuinely open, owned by **PM with a hardware engineer**, deferred post-launch, with "UI stays placeholder" as the *default if unresolved* — which is not a commitment to build it. A panel promising hardware nobody has committed to is the same defect class as a panel claiming a projector is On. **One notice per region, never per row**: five identical sentences train a lecturer to stop reading them | no |

**Two consequences worth their own line:**

- **`S11-D-9` — the redesigned bar is 168 px expanded, down from the prototype's
  226 px.** Five rows that are honestly inert need no `--tap-min` floor, because
  nothing on them is a target. The 58 px returned is exactly what makes S-05's
  vertical floor **388 px rather than 330 px**. *Honesty is the cheaper layout* —
  the pattern pays for itself.
- **`S11-D-8` — the mic switch renders the applied state in `pending` and
  `apply failed`, never the requested one** (INV-AC-1, B-55). An optimistic flip
  that reverts teaches that the switch is a suggestion; on a **mute** it means a
  lecturer believing they are off-mic while the hall can hear them.

### 7.2 Contract changes these decisions imply

**None.** This gate is the first in the project to require no amendment, and the
reason is recorded rather than left as luck: both screens **surface projections
that already exist**, or deliberately ask for nothing.

| Need | Already in `contracts/` v0.2.0 |
|---|---|
| `G-AI-ENABLED` client-side | `getProvisioning` → `featureFlags.aiQuizEnabled`, `llmEndpoint` — **no `x-required-role`**, so a lecturer can read it |
| Source health, channel state, disk + policy | `getSourcesStatus`, `listChannels`, `listLayoutPresets`, `getStorageOverview` + `RetentionPolicy`, and their WS mirrors |
| The master mute | `listAudioControls` / `updateAudioControl`; its missing owner guard is **already CG-15** from the W-2 gate, inherited and not re-raised |
| The five `[D-10]` rows | **Nothing, and nothing is asked for.** No endpoint exists, none is invented, and no "capability" flag is added — it would have exactly one possible value for the whole of v0 |

The only §10 row this gate adds is **CG-18**, which **closes on arrival** as a
deliberate omission (S05-D-6) in CG-9's style. `v0.3` still carries
CG-14…CG-17 and nothing more.

### 7.3 `[D-10]` stays open — and the design absorbs its landing

`D-10` in §1/§2 is **unchanged**: still open, still PM with a hardware engineer,
still post-launch (Phase 5+), still defaulting to a UI placeholder. Nothing in
this run rules on it, and `S11-D-5` exists precisely so the UI does not
pre-announce an outcome the owner has not chosen.

What this run adds is that `[D-10]`'s eventual landing is now **cheap in the
frontend**: a row moves out of `NotConnectedRegion` into a real group and gains a
control bound to a real operation. The pattern is built to be dismantled one row
at a time, and a region that empties completely is simply not rendered. No
redesign, no second gate.

### 7.4 Also settled by these wireframes

- **The `[D-10]` placeholder pattern is product-wide** (`S11-D-4`). Any future
  surface rendering this hardware inherits `NotConnectedRegion` and may not
  define its own treatment — recorded in
  [screen-inventory §9](../design/screen-inventory.md#9-screens-needing-wireframe-approval)
  alongside the destructive-action vocabulary.
- **No new design token** is introduced by either screen. Both are built entirely
  from [§8](../design/screen-inventory.md#8-design-token-sheet); `--danger` /
  `--danger-soft` were already approved at the W-1/W-13 gate (§5.3).
- **[S-12 §2.1](../design/screens/S-12-design.md#21-the-entry-row-s-11-expanded)'s
  illustrative sketch is superseded but deliberately not edited.** It renders
  per-row *"not connected yet"* text and annotates it *"(W-15 owns this mark)"* —
  non-binding by its own words. An approved design is a record of what was
  decided at its gate; S-12's own decisions are untouched.
- **Wave 2's four wireframe rows are now all closed** (W-2, W-3, W-14, W-15). No
  wireframe blocks Wave 2's plan run; what remains is applying CG-14…CG-17 to
  `contracts/`.

---

## 8. Decided at the S-20 wireframe gate (2026-08-08)

The **W-4** gate (Quiz join / QR card; **SI-D-4** "Quiz QR placement") is settled
in [S-20-design.md](../design/screens/S-20-design.md) (status: ✅ **approved
2026-08-08**). This section records the outcome, the two sub-questions the design
surfaced but does **not** own, and the one contract change it required. The
follow-through is done: W-4 marked ✅ in
[screen-inventory §9](../design/screen-inventory.md#9-screens-needing-wireframe-approval),
CG-19 registered in [§10](../design/screen-inventory.md#10-contract-gaps) and
`applied v0.4.0` to `contracts/events.md` §2.15.

### 8.1 Outcome — SI-D-4 settled

| Id | Question | Ruling | Reversal cost |
|----|----------|-----------------|---------------|
| **SI-D-4** | Where does the panel-side quiz join surface live in a full 430 px column? | **A state-carrying chip in the S-13 AI Studio header, opening a 680 px join modal** (QR ≥ 240 px + join code + join URL + joined count). The chip costs zero steady-state vertical pixels; the QR needs 240 px, which only a modal affords; and Z-01's `aiEnabledAtStart` guard means the host card is always present exactly when a quiz session exists — so the chip is never orphaned (S-20 §1 C-1) | Medium — it is the screen's shape |

S-20-D-1…D-8 (S-20-design §11) are taken as part of this ruling — notably **no
Retry button** (the panel owns no session-mint operation; recovery is Z-04's
automatic probe), **client-side QR encoding** (no image endpoint), and
**stale-marking the joined count** rather than showing it as live.

### 8.2 Contract change this design requires — CG-19 (additive, `v0.4`)

| Gap | Fix | Why it blocks S-20's live path |
|-----|-----|--------------------------------|
| **CG-19** — WS `quiz.session` payload ([events.md §2.15](../../contracts/events.md)) omits `syncState`, which `QuizSessionProjection` (REST) already carries and **requires** | Add `syncState` to `QuizSessionPayload`, mirroring the REST schema. Additive; one field; already modelled and named; the emitter already holds the value | Machine 4d staleness is emitted on `quiz.publication` / `quiz.responses` (the **Insights** panel's concern), not on the joined count. Without `syncState` on `quiz.session`, a device whose `sync.participants` stream has gone quiet keeps broadcasting the last `joinedCount` **as current** — the exact "display stale as live" failure QZ-7 / INV-AP-2 forbid. If rejected, S-20's stale state degrades to a `getQuizSession` poll on the `T-QUIZ-SYNC-STALE` cadence (strictly worse; recorded in S-20-design §9 CG-19) |

Registered in [screen-inventory §10](../design/screen-inventory.md#10-contract-gaps)
as CG-19 and **applied v0.4.0** to `contracts/events.md` §2.15 (2026-08-08),
before Wave 4's plan run.

### 8.3 Open sub-questions this gate surfaced — NOT decided here

The design is coherent under a sensible default for each, stated so nothing is
smuggled in as an assumption. Both belong to owners other than the W-4 gate.

| ID | Question | Who decides | Default the S-20 design assumes | Why it is open |
|----|----------|-------------|----------------------------------|----------------|
| **QO-1** | **Pre-publication join affordance.** Before the first Send to Projector, the projector shows slides passthrough with **no QR** (PRD J-2; S-42 switches to the QR only when a question is published). In that window the panel modal (S-20) is the *only* join surface — a lecturer must actively open it and turn the panel to the room. Is that acceptable, or should S-42 render a persistent small join QR/code during slides passthrough so students can join *before* the first question? | PM + owner of **S-42 / W-12** | The panel modal is the pre-publication join path; S-42 adds the QR only at publication. S-20 records the dependency and does not assume S-42's behaviour | It changes S-20's role from "fallback" to "the primary early join surface", but the fix (if any) lives in S-42, not S-20. Settle at the **W-12** gate |
| **QO-2** | **Alert prominence for `quiz.unavailable`.** On 4a `failed`, the S-20 chip turns to a warning and S-14's Send is disabled-with-reason, and `system.alert{quiz.unavailable}` also fires. Beyond the chip + S-14, does the shell (S-03) surface it as a transient toast, a persistent banner until recovery, or nothing? | PM + owner of **S-03** alert model | The chip + S-14's disabled Send are the primary carriers; the shell alert is a **non-blocking notice, not a persistent banner** (the chip already persists the state) | Couples to how S-03 renders `system.alert` generally, which is not fully settled. Confirm against the S-03 alert model before Wave 4 |

Neither is design-blocking for S-20 itself: the chip/modal render correctly under
the assumed defaults, and both questions concern *other* surfaces' behaviour.

### 8.4 Also settled by this wireframe

- **W-4 is closed**, leaving W-5…W-12 as the remaining open wireframe rows.
- **No new design token** is introduced. The `failed` / `stale` treatments assume
  the `--warn` / `--warn-soft` semantic pair already in
  [§8.2](../design/screen-inventory.md); if that pair is not yet defined, S-20
  falls back to `--info` rather than minting a colour (flagged in S-20-design §7).
- **S-20 is read-only and net-new** — the behavioral inventory holds no `B-*`
  quiz / QR / join item, so there is nothing legacy to preserve; the binding
  constraints are the contract, Machine 4a, and the kiosk vertical budget.

---

## 9. Decided at the S-21…S-24 / S-35 wireframe gate (2026-08-09)

The **W-5…W-9** gate — the recordings library (S-21), detail & player (S-22), USB
export (S-23), delete confirm (S-24) and upload queue (S-35): the **File
Management rebuild**, parity §5.1 items 1 + 2, the largest undesigned area in the
product — is settled across five design docs
([S-21](../design/screens/S-21-design.md), [S-22](../design/screens/S-22-design.md),
[S-23](../design/screens/S-23-design.md), [S-24](../design/screens/S-24-design.md),
[S-35](../design/screens/S-35-design.md); status: ✅ **approved 2026-08-09**). This
section records the four "smallest-fix" contract rulings the gate took, the
library-entry-point decision (SI-D-3), the sub-questions the designs surfaced but
do **not** own, and the one screen that required no contract change. Follow-through
is done: W-5…W-9 marked ✅ in
[screen-inventory §9](../design/screen-inventory.md#9-screens-needing-wireframe-approval);
CG-3/CG-5/CG-7 marked `answered` and CG-20/CG-21 registered in
[§10](../design/screen-inventory.md#10-contract-gaps); all five ride the **v0.5**
bump ([§10.1](../design/screen-inventory.md#101-when-the-contract-actually-changes))
before Wave 5's plan run.

### 9.1 Outcomes — the four contract-gap rulings

Each was a real fork with a reversal cost, decided at the gate rather than assumed.

| Id | Question | Ruling | Reversal cost |
|----|----------|--------|---------------|
| **CG-5** | How much filtering should `listRecordings` gain? | **A scoped subset: `?q=` (title) + `?ownerUserId=` (admin) only — *not* `?from=`/`?to=`.** Lecturers are already server-scoped to their own recordings (INV-RC-5); the pressure is an admin over every lecturer × 14 days, which title + owner clear. The 14-day window makes date filtering earn less than its mock/test cost. Chips, not a menu; server-side, never a client filter over a cursor-paged list. See [S-21-design.md §9](../design/screens/S-21-design.md#9-contract-changes-this-design-requires) | Low — additive; `from`/`to` remain a later additive if a need appears |
| **CG-3** | How does a session declare it wants scoped `usb.volumes` / `export.job` events, when clients send no WS messages (events §1)? | **The implicit-TTL form: calling the flow's REST entry marks the session subscribed for a TTL** — `GET /exports/targets` → `usb.volumes`; `createExport`/`getExport` → `export.job`; `GET /logs` → `log.entry` (S-34 reuses it). No new endpoint, no client→server WS message. Preferred over an explicit `POST /subscriptions`, which would invent an operation and a lifecycle to manage. See [S-23-design.md §8](../design/screens/S-23-design.md#8-contract-changes-this-design-requires) | Low — a semantic; reversible to an explicit subscribe if the TTL proves awkward |
| **CG-21** | How does S-23 handle a target that lacks space at copy time (a drive that filled between listing and the POST)? | **Add `export.insufficient-space` to the `Problem.code` closed enum.** The client still pre-checks `freeBytes` vs Σ selected bytes in the picker; the server code is the authoritative backstop for the listing→copy race, so U-5 can render a named, fixable reason instead of a generic `validation.invalid`. See [S-23-design.md §8](../design/screens/S-23-design.md#8-contract-changes-this-design-requires) | Low — additive enum value |
| **CG-20** | What shape should the upload offline/failure signal take on `UploadJob`? | **Add `failureClass ∈ {connectivity, server, permanent} \| null`**, mirroring the §4.4 classification the emitter already computes (it decides whether `attempt` increments). This makes S-35's `offline` row-state (`"Waiting for the network · No attempts used"`) reachable and honest from minute one — instead of rendering "failed 8 times" for a device that is merely offline, the exact §4.4 lie the state exists to prevent. Parsing `lastError` text for the class is forbidden (INV-RF-1). Preferred over a bare `waitingForNetwork` boolean, which would collapse server vs permanent. See [S-35-design.md §9](../design/screens/S-35-design.md#9-contract-changes-this-design-requires) | Low — additive field |

### 9.2 SI-D-3 settled — the library entry point

| Id | Question | Ruling | Reversal cost |
|----|----------|--------|---------------|
| **SI-D-3** | Where does the recordings library open from, given the prototype has no library and thus no door? | **A header entry visible to both roles, plus a link from the post-stop "Saved" toast.** Both roles need the library; the moment a lecturer most wants it is right after stopping a lecture (J-1). See [S-21-design.md §11 LIB-D-6](../design/screens/S-21-design.md#11-decisions-taken-here). Settled in [screen-inventory §13](../design/screen-inventory.md#13-open-questions--decisions-taken-here) | Low |

### 9.3 Contract changes these designs require — the v0.5 bump

| CG | Change | Kind | Owner doc |
|----|--------|------|-----------|
| **CG-5** | `listRecordings` gains `?q=` + `?ownerUserId=` | additive | [S-21 §9](../design/screens/S-21-design.md#9-contract-changes-this-design-requires) |
| **CG-7** | `POST /recordings/{recordingId}/retry-merge` binds RA-07 (admin, 202-async) | additive | [S-22 §9](../design/screens/S-22-design.md#9-contract-changes-this-design-requires) |
| **CG-3** | Implicit-TTL scoped subscription semantic on `GET /exports/targets` / `createExport` / `getExport` / `GET /logs` | additive/semantic | [S-23 §8](../design/screens/S-23-design.md#8-contract-changes-this-design-requires) |
| **CG-21** | `export.insufficient-space` added to `Problem.code` | additive | [S-23 §8](../design/screens/S-23-design.md#8-contract-changes-this-design-requires) |
| **CG-20** | `failureClass` added to `UploadJob` + `UploadJobPayload` | additive | [S-35 §9](../design/screens/S-35-design.md#9-contract-changes-this-design-requires) |

All five are **additive**; none is breaking. They land in `contracts/` (openapi +
events + zod + mock adapter) as **v0.5** before Wave 5's plan run, per
[screen-inventory §10.1](../design/screen-inventory.md#101-when-the-contract-actually-changes).

### 9.4 Open sub-questions these designs surfaced — NOT decided here

The designs are coherent under a sensible default for each, stated so nothing is
smuggled in as an assumption. Each belongs to an owner other than the W-5…W-9 gate.

| ID | Question | Who decides | Default the design assumes | Why it is open |
|----|----------|-------------|----------------------------|----------------|
| **LQO-1** | **Export ETA precision.** S-23 computes the copy ETA client-side from the byte-rate over recent `export.job` steps (a pure function of progress + time; no server field, [S-23 EXP-D-3](../design/screens/S-23-design.md#10-decisions-taken-here)). Is a client-smoothed "about {eta} left" acceptable, or should the device compute an `estimatedRemainingMs`? | PM + core-api owner | Client-computed "about {eta}", honest about its imprecision; no server field (parallels CG-18's bytes-only ruling) | Only matters if operations finds the client estimate too jittery over a variable USB rate; the fix (if any) is an additive server field, not an S-23 change |
| **LQO-2** | **Export `error` granularity.** `ExportJob.error` is a free-text string (events §2.20, linear lifecycle); S-23 keys "drive removed" vs generic "failed" on `state=failed` + the failure shape, not a coded enum. Should `error` become a closed enum for deterministic per-cause copy? | PM + core-api owner | Free-text `error`, surfaced verbatim; state-driven copy for the known "drive removed" case | Matters only if deterministic per-cause export copy is wanted; an additive enum, flagged rather than minted (S-23 §8.1) |
| **LQO-3** | **Merge-retry attempt ceiling.** S-22's admin Retry (CG-7 / RA-07) resets the attempt counter; is there a cap on how many times an admin may retry a failed merge before it is declared permanently unmergeable? | PM + core-api owner | Unbounded manual retry (the admin is in the loop each time); no automatic permanent-failure state beyond `merge failed` | Matters only if a pathological recording could be retried forever; RA-07 as specified resets the counter with no ceiling, which is acceptable for a human-driven action |

None is design-blocking: the five screens render correctly under the assumed
defaults, and each question concerns a *later* refinement or another surface's
behaviour.

### 9.5 Also settled by these wireframes

- **W-5…W-9 are closed**, leaving W-10, W-11 and W-12 as the remaining open
  wireframe rows.
- **S-24 required zero contract change** — it is a `DangerConfirm` instance
  inheriting the S-06 §3 destructive vocabulary and needs no new endpoint, event or
  token. The wave's clean "a design run can add nothing" case, in the W-14/W-15
  style. (It does record one thing: the destructive fill is `--danger`, following the
  settled S-06 §3.1 vocabulary, not the inventory line's older `--record` — no token
  added; [S-24 §8.1](../design/screens/S-24-design.md#8-contract-changes-this-design-requires).)
- **No new design token** is introduced by any of the five. Badges reuse the existing
  `--success`/`--warning`/`--danger`/`--accent`/`--text-muted` palette; the danger
  vocabulary is inherited from S-06 §3.
- **The upload/merge badge vocabulary is defined once** (S-21 §3) and **shared
  verbatim** with S-35 through a single `use-recording-badge` derivation — a recording
  reads the same in the library and the upload console, by construction. S-35 adds
  only the offline/failed split (CG-20) its admin console needs.
- **Legacy preserved, not ported:** these screens are the principled successors to
  the File-Manager behaviours the inventory KEEP-but-CHANGEs — B-31 (library view +
  badges, ownership moved server-side), B-32 (USB export, real progress not
  free-space polling), B-33 (audited delete, real columns not a status string), B-34
  (merge automatic, no user convert flow), B-35 (requeue, not a hardcoded manual
  endpoint), B-37 (playback, authenticated), B-38 (hotplug, session-scoped not
  broadcast, user picks the drive). None of the legacy bugs is reproduced.

### 9.6 Open sub-question the S-36 wireframe surfaced (W-10) — NOT decided here

The S-36 design is coherent under the stated default; the item is recorded so nothing is
smuggled in as an assumption. It belongs to an owner other than the W-10 gate.

| ID | Question | Who decides | Default the design assumes | Why it is open |
|----|----------|-------------|----------------------------|----------------|
| **DIO-1** | **Expected-vs-actual storage cross-check.** Should S-36 fetch `GET /storage` (S-30's) to compare the provisioned `expectedStorageVolumeUuid` against the actually-mounted volume and flag a **wrong drive** at install, or only **display** the expected uuid for a manual check? | PM + core-api / S-30 owner | **Display-only** in v0 — S-36 fetches `/provisioning` + `/health` + `/alerts` only; the uuid is shown copyable. See [S-36-design.md §9.2 / §14](../design/screens/S-36-design.md#9-contract-changes-this-design-requires) | A uuid mismatch is a real install failure worth flagging, but pulling `/storage` widens S-36's data surface beyond its three reads; the cross-check is additive and changes **no** wireframe if adopted later, so it is a refinement, not design-blocking |

**S-36 required no contract change and no new token** — the clean "a design run can add
nothing" case in the S-24 style (§9.5): `getProvisioning` / `getDeviceHealth` / `listAlerts`
/ `acknowledgeAlert` + `device.health` / `system.alert` serve the whole read view as v0.5
stands, and the `--danger` critical vocabulary is inherited from S-06 §3.

**W-10 is closed**, leaving **W-11** (S-37…S-41 student quiz app) and **W-12** (S-42
projector overlay) as the remaining open wireframe rows.
