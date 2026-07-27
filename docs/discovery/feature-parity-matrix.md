# Feature Parity Matrix — Legacy UMS → Unistream Revamp

> Phase-1 discovery artifact. One row per legacy feature (screen, endpoint group, or
> background job) plus one row per NEW prototype feature. Enumerated from code:
> every route in `lc-frontend/src/routes/index.js`, every settings subpage imported by
> `pages/settings/index.jsx`, every router file in `LC/routes/`, and every cron/socket/GPIO
> job in `LC/index.js` + `LC/bashfiles/`. Behaviors are cited by B-number from
> [behavioral-inventory.md](behavioral-inventory.md); decisions by A/D-id from
> [open-decisions.md](../../revamp-guide/reference/open-decisions.md).
>
> **Dispositions:** REBUILD (same capability, new implementation) · REDESIGN (capability
> survives, UX/architecture changes) · NEW (no legacy equivalent) · RETIRE (dropped, with
> a reason you can veto).
>
> **New homes:** Lecturer Panel (touch UI) · Admin UI (Advanced section of the panel) ·
> Quiz App · core-api · pipeline-manager · AI services · deploy layer.

---

## 1. Legacy frontend screens (`lc-frontend/src/routes/index.js`)

| Feature | Legacy location | Prototype coverage | Disposition | New home | Notes/risks |
|---|---|---|---|---|---|
| User login + forced first-login password reset | `/login` → `pages/main/login.jsx` (B-40, B-42) | `LoginPage` — decorative username/password, role picker only | **REDESIGN** — single login screen for both roles; real credential auth returns in the rewrite | Lecturer Panel + core-api | Prototype login is a mock; **forced first-login reset and change-password have no prototype design** (Phase-2 list). B-42's unauthenticated `/resetpass` hole must not survive. |
| Admin login (separate screen) | `/admin-login` → `pages/main/loginAdmin.jsx` (B-41) | Merged into the single `LoginPage` role picker | **RETIRE** (as a screen) | Lecturer Panel | Reason: prototype deliberately has one login; admin identity becomes a role on the account, killing the `root`→`dev-admin` magic username (B-41). Admin *authentication* itself is REBUILD inside the login row above. |
| Home / recording dashboard (metadata form, record/pause/stop, stream toggle, presets, live previews, storage warning, in-progress lock) | `/home` → `pages/main/home.jsx` (B-15, B-16, B-17, B-53, B-60) | `IdleHero` one-tap start, `TimerCard`, red recframe/notch, recording status `idle\|recording\|paused` | **REDESIGN** | Lecturer Panel + core-api + pipeline-manager | A-07 removes module/topic/hall input entirely (title auto-generated). Quick-preset tiles (B-60) are replaced by per-channel layout pickers. **Gaps:** single-recorder lock/takeover UX (B-15) and the dashboard storage warning (B-53) have no prototype design; server must enforce mutual exclusion, not the UI. |
| Main menu (tile navigation; also power-off button and the kill-all-GStreamer side effect) | `/menu` → `pages/main/menu.jsx` (B-14, B-50) | None — prototype is a single dashboard, Advanced reached via Room Controls | **RETIRE** (as a screen) | — | Reason: no-router single-view UX makes a menu page meaningless. The hidden load-bearing behavior — tearing down preview pipelines on navigation (B-14) — moves to explicit pipeline lifecycle in pipeline-manager; power-off moves to its own row (§3). |
| Capture Setup (source permutations, layouts, audio gains, snapshot previews) | `/capturesetup` → `pages/main/captureSetup.jsx` (B-18, B-55 gains, B-56) | `sources/SourcesPanel` (fixed trio PC/CAM1/CAM2, tap→preview), `admin/pages/LocalCaptureLayout.tsx`, mic gain steppers | **REDESIGN** | Lecturer Panel + Admin UI + pipeline-manager | A-08 replaces free permutations with semantic sources `pc/cam1/cam2` + one lecturer mic. Local layout picking moves to the Advanced page (`separate-files` preset preserves dual-file capability, B-01/B-09). Previews go WebRTC (A-17) instead of JPEG-over-socket. Legacy gain sliders were placebo (B-55) — the prototype's must become real (see §4). |
| Live Meeting Cast setup | `/lmc` → `pages/main/lmc.jsx` (B-18 previews, pipeline matrix inputs B-01) | `ChannelCard` "Live Meeting" inline accordion with camera-only presets (`cams-fifty-fifty`, `cam-1`, `cam-2`) | **REDESIGN** | Lecturer Panel + pipeline-manager | A-15: meeting output becomes HDMI-out #2 → capture dongle → laptop webcam; A-09 gives the channel its own camera-only preset set. The dongle/HDMI path is new infrastructure (§4). |
| Live Stream setup (platform toggles, RTMP URLs, layout) | `/ls` → `pages/main/ls.jsx` (B-58, B-59) | `admin/pages/StreamingConfig.tsx` — channel on/off, preset picker, platform picker, server URL + stream key, saved configs | **REDESIGN** | Admin UI + core-api + pipeline-manager | A-10: YouTube + Facebook at launch (legacy also had Twitch/Twitter/LinkedIn flags; prototype lists Twitch + Custom RTMP — reconcile the platform list). nginx-conf surgery + full restarts (B-58) replaced by a controllable relay. |
| File Management (list w/ status badges, play/download, copy to USB, convert/merge, delete, manual upload) | `/fm` → `pages/main/fm.jsx` (B-31–B-37) | **None** — `LocalStoragePage` shows capacity only | **REBUILD** | Lecturer Panel + core-api | **Biggest design gap (Phase 2).** Rules already decided: A-20 (all can play, admin-only delete, 14-day auto-delete), A-12 (system merges pause segments — kills the user-triggered convert flow B-34). Ownership filtering must move server-side (B-31); unauthenticated `/record/` playback (B-37) must not survive. |
| Settings shell (sidebar of subpages, role-gated) | `/confsettings`, `/confsettings/ess`, `/confsettings/dev` → `pages/settings/index.jsx` (B-43) | `admin/AdminPage.tsx` — sidebar of 8 categories, role-scoped (admins: all; lecturers: Local Capture + Streaming only) | **REDESIGN** | Admin UI | Role model shifts from user/admin/dev-admin to lecturer/admin (A-21: admin section is for IT staff). Decide explicitly whether dev-admin's provisioning powers fold into admin or into the deploy layer (see `dev` row). |

### 1a. Settings subpages (all imported by `pages/settings/index.jsx`)

| Feature | Legacy location | Prototype coverage | Disposition | New home | Notes/risks |
|---|---|---|---|---|---|
| Encoder settings (bitrate, per-stream framerate; dead resolution/codec/profile/format controls) | `settings/es.jsx` + `/api/settings/esapply,esget` (B-56) | `admin/pages/EncoderSettings.tsx` — bitrate slider 2000–8000 kbps, codec select (H.264/H.265/AV1), container select (MP4/MKV/MOV) | **REDESIGN** | Admin UI + core-api + pipeline-manager | Legacy honors only bitrate + framerates; prototype drops framerate but adds codec/container choices that must be validated against RK3588 `mpph264enc` capabilities (A-06) — don't ship placebo controls again (B-55 lesson). |
| Eduscope Stream settings | `settings/ess.jsx` + `/api/settings/essapply,essget` (B-55) | None | **RETIRE** | — | Reason: pure settings CRUD with **no backend consumer of the values** (B-55) — inert in production today. Veto if the ESS values feed something outside this repo. |
| Device/network settings (IP, gateway, DNS; RTSP camera URLs; dead Wi-Fi/SSID UI; frontend rebuild on IP change) | `settings/dis.jsx` + `/api/settings/disapply,disget,ssidnew,ssidget` (B-46, B-54) | `admin/pages/NetworkSettings.tsx` — LAN config, **vLAN config (new)**, CAM 1/CAM 2 IP fields | **REDESIGN** | Admin UI + core-api + deploy layer | Static-IP config survives; rebuilding the SPA to bake in the API address (B-46/B-61) is eliminated via runtime config. Camera IPs move here from `dis` RTSP links (A-08). SSID rows: RETIRE (dead UI, no nmcli anywhere — B-54) unless Wi-Fi provisioning is on the roadmap (product confirmation item 8). |
| File upload settings (instant/scheduled toggle, upload windows) | `settings/fus.jsx` + `/api/settings/fusapply,fusget` (B-22, B-30, B-48) | None | **REDESIGN** | core-api (+ Phase-2 Admin UI) | A-19: uploads become automatic with a resumable job queue, so the window/instant toggle disappears as designed — but **operators still need an upload-queue status view** (Phase-2 list, blocked on D-02b for metadata mapping). Legacy "instant" mode was a silent no-op (B-30) — do not carry. |
| Firmware update (git-pull + rebuild + restart) | `settings/fu.jsx` + `/api/settings/fuupdate` (B-49) | `admin/pages/FirmwareUpdate.tsx` — current version, "Check for Updates" | **REDESIGN** | Admin UI + deploy layer | UI parity exists; the mechanism must become signed release artifacts with rollback, not `git reset --hard` on device (B-49). |
| Schedule settings | `settings/ss.jsx` + `/api/settings/ssapply,ssget` (B-55) | None | **RETIRE** | — | Reason: settings CRUD with no consumer anywhere in the backend (B-55). Veto if scheduled recordings are a roadmap feature — then it becomes NEW design work. |
| UAC/UVC settings stub | `settings/us.jsx` (imported but not even routed to a menu entry; B-55) | None | **RETIRE** | — | Reason: unrouted stub, no backend, no consumer. |
| System page (time/NTP/timezone pickers that only `console.log`, device location, hardcoded license panel) | `settings/sys.jsx` + `/api/settings/sysapply,sysget` (B-55) | None | **RETIRE** (placebo parts) | — | Reason: the only persisted value is `dl` (device location) with no consumer; time pickers are dead; license is hardcoded JSX. **If** real time/NTP/timezone config is wanted it is Phase-2 NEW design (listed in gap list) — an appliance does need correct time (upload windows, log timestamps, generated titles A-07). |
| Local storage settings (storage gauge, format HDD, new HDD id, inert `duf`/`fdd` retention toggles) | `settings/lss.jsx` + `/api/settings/lssapply,lssget,lssgetstorage,newhddid,formathdd` (B-20, B-51, B-52, B-53) | `admin/pages/LocalStoragePage.tsx` — capacity/free/disk-health stats, "Mount Drive" (new HDD id), format with danger-zone confirm | **REDESIGN** | Admin UI + core-api | Two-step format→register (B-52) becomes one safe operation; nginx-root surgery + self-restart (B-51) is replaced by config. Retention becomes real and fixed at 14 days (A-20) instead of inert toggles + hardcoded 80 %/7 days (B-20). Disk-health readout is new (needs SMART plumbing). |
| Dev options (SD-card path, upload domain → env/.env rewrite) | `settings/dev.jsx` + `/api/settings/devapply,devget,devgetpaths` (B-47) | None | **REDESIGN** | core-api config + deploy layer | Device provisioning (institute profile, storage device identity) survives as an explicit config store/provisioning flow — not a UI page and not `.env` sed-ing. No prototype design; decide in Phase 2 whether any of it is admin-visible. Boot-frozen `isSliit` (B-26) must not recur. |
| User management (CRUD users/admins, paginated list, Excel bulk import) | `settings/um.jsx` + `/api/settings/um*` (B-44) | `admin/pages/UserManagement.tsx` — add single user (name/username/password/role), bulk Excel import, user directory | **REDESIGN** | Admin UI + core-api | Two-role model replaces three (see §1 shell row). Prototype merges the separate users/admins tables into one directory. **Gaps:** edit/delete existing users, pagination, and password reset are not in the prototype design (Phase-2 list); Excel import validation rules (B-44) are the baseline contract. |

---

## 2. Legacy backend endpoint groups (`LC/routes/*.js`)

Every route in every router file appears below, grouped by capability.

### 2a. `adminRoutes.js` (mounted at `/api/admin`)

| Feature | Legacy location | Prototype coverage | Disposition | New home | Notes/risks |
|---|---|---|---|---|---|
| Auth endpoints: `POST /login`, `POST /admin-login`, `POST /resetpass` | `adminRoutes.js:41-43` → `login_ctrl.js`, `settings_ctrl.umUpUser` (B-40, B-41, B-42) | Login mocked (role picker) | **REBUILD** | core-api | Dual user source (local + institute) survives per B-40; md5 layer, 7-day kiosk tokens, and the **unauthenticated `resetpass`** (B-42) do not. |
| Recording control: `POST /start`, `POST /stop`, `GET /chkstatus`, `POST /uprecstatus` | `adminRoutes.js:47-52` → `admin_ctrl.js` (B-01–B-12, B-15) | `RecordingContext` state machine `idle\|recording\|paused` + start/pause/resume/stop | **REDESIGN** | core-api + pipeline-manager | The ~124-branch pipeline string matrix (B-01) becomes a pipeline builder over the A-05 shm publisher/consumer model; real process supervision replaces fire-and-forget (B-12); state machine gains `starting/stopping/error`. `chkstatus`-style recovery (B-03/B-07) survives as persisted sessions. |
| Pause bookkeeping: `POST /uppausestatus`, `POST /upgroupid` | `adminRoutes.js:53-54` (B-09, B-10) | Pause/resume is one context call; no client bookkeeping | **RETIRE** (as endpoints) | core-api | Reason: A-12 moves pause/merge logic entirely server-side — client-driven groupid/pauseval endpoints (and their last-row-only bug, B-10) have no place. The *capability* (split-file pause, system-joined) is REDESIGNED inside recording control. |
| Error flag: `GET /isError` (unauthenticated) | `adminRoutes.js:48` (B-12) | Recording status/error is part of the state model | **RETIRE** | core-api | Reason: dead code — nothing ever sets the flag; endpoint always 409s; frontend caller is never invoked (B-12). Real error surfacing replaces it. |
| Stream control: `POST /startstream`, `GET /stopstream` | `adminRoutes.js:57-58` → `admin_ctrl.js:1182-1276` (B-58) | Streaming channel toggle in `StreamingConfig`/`RecordingContext` | **REDESIGN** | core-api + pipeline-manager | Multi-platform restreaming survives (A-10: YT+FB, RTMPS via stunnel4); nginx.conf rewriting + service restarts do not. Stream-before-record ordering (B-16) must be honored by the pipeline-manager. |
| Test stub: `POST /admin-protectd` | `adminRoutes.js:30-38` | — | **RETIRE** | — | Reason: literal "Hello Admin" test route. |

### 2b. `captureSetupRoutes.js` (mounted at `/api/caps`)

| Feature | Legacy location | Prototype coverage | Disposition | New home | Notes/risks |
|---|---|---|---|---|---|
| Capture config CRUD: `PATCH /csapply/:id`, `GET /csget/:id` | `captureSetupRoutes.js:26-27` (B-45) | Local channel preset in `RecordingContext` / `LocalCaptureLayout` page | **REDESIGN** | core-api | Untyped key/value rows with silent no-ops (B-45) become typed, seeded config. Preset vocabulary = `LayoutPresetId` in `types.ts` (A-09). |
| Setup previews: `POST /cscreatesnaps`, `POST /cschangesnaps` | `captureSetupRoutes.js:28-29` (B-18) | Source tiles with tap-to-preview lightbox | **REDESIGN** | pipeline-manager | JPEG snapshot pipelines + global `killall` switching (B-18/B-06) replaced by WebRTC thumbnails (A-17) served from always-running shm publishers (A-05). |
| Device discovery: `GET /getdevices/:type` | `captureSetupRoutes.js:30` (B-57) | Implicit — fixed source trio with health shown per tile | **REDESIGN** | pipeline-manager | Becomes health/presence reporting for the fixed `pc/cam1/cam2` set rather than free enumeration; hardcoded browser device-id matching (B-57) is dropped. |

### 2c. `fmRoutes.js` (mounted at `/api/fm`)

| Feature | Legacy location | Prototype coverage | Disposition | New home | Notes/risks |
|---|---|---|---|---|---|
| Library listing: `GET /fmload`, `GET /fmgetlist` | `fmRoutes.js:26,31` (B-31) | **None** | **REBUILD** | core-api (+ Phase-2 Lecturer Panel) | Per-user visibility must be enforced server-side; status badges come from the new upload job queue. Metadata from DB, not filename parsing (B-02). |
| Copy to USB: `POST /fmcopy` | `fmRoutes.js:28` (B-32) | **None** | **REBUILD** | core-api (+ Phase-2 UI) | Core lecturer workflow (offline export). Real rsync progress instead of free-space polling. |
| Delete recordings: `POST /fmdelete2` (admin-only) | `fmRoutes.js:29` (B-33) | **None** | **REBUILD** | core-api (+ Phase-2 UI) | A-20 confirms admin-only delete; audit actor becomes a real column, not `deleted(<uid>)` status strings. |
| Convert/merge: `GET /fmgetnctslist`, `GET /fmstartconvert` | `fmRoutes.js:33-34` (B-34) | **None** (and none needed) | **RETIRE** (as user-facing endpoints) | core-api / pipeline-manager | Reason: A-12 — segment merging and mp4 conversion become automatic server-side after stop; the user-triggered FM-open flow (and its ship-unmerged-segments race, B-34) disappears. Capability survives as an internal job. |
| Manual upload: `POST /fmupload` | `fmRoutes.js:27` (B-35) | **None** | **RETIRE** | — | Reason: hardcoded remote host, API key, uid/module; UI button already commented out; superseded by auto-upload (A-19). Veto only if per-file re-upload is wanted as an operator action — then it's a re-enqueue on the job queue, not this endpoint. |

### 2d. `lmcRoutes.js` (mounted at `/api/lmc`)

| Feature | Legacy location | Prototype coverage | Disposition | New home | Notes/risks |
|---|---|---|---|---|---|
| Meeting config CRUD: `PATCH /lmcapply/:id`, `GET /lmcget/:id` | `lmcRoutes.js:25-26` (B-45) | Meeting channel state (enabled + camera-only preset) in `RecordingContext` | **REDESIGN** | core-api | Same typed-config treatment as capture setup; preset set is camera-only per A-09. Unrouted `lmcgetdevices` node-webcam stub (B-57) dies with it. |

### 2e. `lsRoutes.js` (mounted at `/api/ls`)

| Feature | Legacy location | Prototype coverage | Disposition | New home | Notes/risks |
|---|---|---|---|---|---|
| Streaming config CRUD: `PATCH /lsapply/:id`, `GET /lsget/:id` | `lsRoutes.js:25-26` (B-45, B-59) | `StreamingConfig` page (platform, URL, key, preset, on/off) | **REDESIGN** | core-api | Per-platform enable flags + RTMP URLs survive as typed config; stream keys need secret-grade storage (legacy stored them as plain settings rows). |

### 2f. `sdRoutes.js` (mounted at `/api/sd`)

| Feature | Legacy location | Prototype coverage | Disposition | New home | Notes/risks |
|---|---|---|---|---|---|
| LMS dropdown feeds: `GET /sdmodules`, `GET /sdlechalls` | `sdRoutes.js:33-34` → `sd_ctrl.js` (B-26) | None — no metadata form exists | **RETIRE** | — | Reason: A-07 drops module/hall selection at record time (hall is hardcoded per device, module dropped, title generated). Veto if the new institute API (D-02b) turns out to require module ids in the upload payload — then a server-side mapping (not a UI dropdown) is needed. |
| Test stub: `POST /admin-protectd` | `sdRoutes.js:24-31` | — | **RETIRE** | — | Duplicate test route. |

### 2g. `settingsRoutes.js` (mounted at `/api/settings`)

Settings CRUD pairs (`esapply/esget`, `essapply/essget`, `disapply/disget`, `fusapply/fusget`, `ssapply/ssget`, `devapply/devget/devgetpaths`, `lssapply/lssget`, `sysapply/sysget`, `ssidnew/ssidget`, `umcreateuser/umuploadexcel/umupdateuser/umloadeusers/umcounteusers/umremoveeusers/umcreateadmin/umupdateadmin/umloadeadmins/umremoveeadmins`, `fuupdate`, `newhddid`, `formathdd`) are dispositioned with their owning pages in §1a. The remaining endpoints:

| Feature | Legacy location | Prototype coverage | Disposition | New home | Notes/risks |
|---|---|---|---|---|---|
| Power off: `GET /poweroff` (any authenticated user) | `settingsRoutes.js:23` (B-50) | **None** | **REBUILD** | core-api (+ Phase-2 UI) | Kiosk power-off must exist somewhere (legacy had it on the Menu page, which is retired). New rule: refuse while recording. Phase-2 design decides where the button lives (Room Controls is the natural spot). |
| Storage gauge: `GET /lssgetstorage` (any user) | `settingsRoutes.js:56` (B-53) | `LocalStoragePage` stats (admin-side only) | **REDESIGN** | core-api + Admin UI | Lecturer-facing capacity warning tied to the 14-day/auto-delete policy (A-20) is a Phase-2 dashboard design item — legacy showed it on Home. |

---

## 3. Background jobs, sockets, and hardware surfaces (`LC/index.js`, `LC/bashfiles/`)

| Feature | Legacy location | Prototype coverage | Disposition | New home | Notes/risks |
|---|---|---|---|---|---|
| Storage cleanup cron (80 % / 7-day filename-parsed retention) | `index.js:382-437` (B-20) | Implied by A-20 only | **REDESIGN** | core-api | Retention becomes DB-driven, 14 days (A-20), tolerant of foreign files, preferring already-uploaded files. Legacy deletes never-uploaded files and crashes on stray files — do not carry. |
| Institute user sync cron (hourly LMS roster pull) | `index.js:440-460` (B-21) | None | **REDESIGN** | core-api | Roster sync survives conceptually but its source is the **new institute API (D-02b, spec pending)**; hardcoded key, disabled TLS, md5 password relay all die. No prototype UI (none needed beyond User Management directory). |
| Scheduled upload pipeline (windows, convert, add→upload→complete protocol, retry, `nofile`, dual-stream-as-one-lecture) | `index.js:463-851` (B-22–B-30) | None | **REDESIGN** | core-api | A-19: pluggable upload adapter + resumable job queue, auto-upload, built against a placeholder contract until D-02b lands. Invariants to keep: every finished file enters the queue exactly once (B-09); one lecture per recording regardless of segments/streams (B-25); dead-letter state for missing files (B-28). Broken retry re-queue (B-27) and `~2~cmb` duplicate-lecture gap (B-25) are bugs to fix, not port. |
| `.ts`→`.mp4` conversion + pause-segment merge | `index.js:593-616`, `fm_ctrl.js:504-671` (B-23, B-34) | None | **REDESIGN** | pipeline-manager / core-api | Becomes an automatic post-stop job (A-12); async, not event-loop-blocking `execSync`. |
| Recording preview emitter (Socket.IO base64 JPEG p1/p2) | `index.js:192-222` (B-17, B-19) | Recording dashboard shows live state; source tiles preview | **REDESIGN** | pipeline-manager | Replaced by WebRTC (A-17). Leaked per-connection intervals (B-19) must not recur. |
| Setup preview emitter (presentation/presenter JPEGs) | `index.js:224-254` (B-18) | Source tile lightbox | **REDESIGN** | pipeline-manager | Same WebRTC replacement; no global pipeline kill on switch (B-06). |
| USB hotplug detection + capacity broadcast | `index.js:257-375` (B-38) | None | **REBUILD** | core-api (+ Phase-2 UI) | Needed by the Phase-2 recordings-library copy-to-USB flow. Fix first-drive-only assumption and the mountpoint/device-path diff bug; scope events to the requesting session, plus a SystemLogs entry. |
| EZ-Cap capture-card boot watchdog (uhubctl power-cycle) | `index.js:157-189` (B-39) | Only as a Hardware log line in `SystemLogs` mock | **REDESIGN** | pipeline-manager + deploy layer | One-shot string match becomes a supervised health check with recovery during uptime; surfaced through the log taxonomy. Hub topology `2-1` port 2 is an open per-unit fact-check. |
| Record LED (GPIO blink scripts) | `admin_ctrl.js:1041`, `bashfiles/recblink.py`, `clear.py` (B-05) | None (hardware-invisible to UI) | **REBUILD** | pipeline-manager + deploy layer | Room-facing recording indicator; keep. LED presence on the new Radxa hardware is an open fact-check (`hardware-topology.md` §5). |
| Physical record button | `bashfiles/recpress.py`, `hi.sh` + orphan socket handler (B-13) | None | **RETIRE** | — | Reason: half-wired dead feature — the button flips a DB flag nothing reads; the UI countdown handler is unreachable. Veto if the button is live hardware in deployed rooms (product confirmation item 8) — then it becomes a REDESIGN into a pipeline-manager event. |
| 4-way camera-switch button (`indicators` table writer) | `bashfiles/switchsql.py` (B-62) | None | **RETIRE** | — | Reason: writes rows no code reads; no consumer found in repo. Same veto condition as the record button (product confirmation item 8). |
| nginx serving topology (SPA + `/api` proxy + `/record/` + RTMP relay on :3000) | out-of-repo conf + `Config.js`, `settings_ctrl.js:1018` (B-37, B-61) | N/A (deployment concern) | **REDESIGN** | deploy layer | Single-origin serving with runtime config (no build-time IP baking, B-46/B-61); authenticated media serving replaces open `/record/` (B-37); RTMP relay stays for A-10. |
| MySQL implicit schema + raw-SQL data layer | `LC/models/*`, `config/index.js` (B-62, B-63) | `types.ts` domain models as seed | **REDESIGN** | core-api | Explicit migrations, parameterized queries, enums over status strings. Engine choice is D-03 (default SQLite + Drizzle; no fielded-device migration needed). |

---

## 4. NEW prototype features (no legacy equivalent)

| Feature | Legacy location | Prototype coverage | Disposition | New home | Notes/risks |
|---|---|---|---|---|---|
| AI question generation (countdown 10/15/20/30 default 20, `generateNow()` resets countdown, batches of 3–5 MCQs, inline edit, lecturer-written questions surviving batches) | — | `QuestionContext`, `ai/QuestionAssistant`, `ai/QuestionsModal`, `ai/AddQuestionDialog`, `ai/CountdownToNext` (A-14) | **NEW** | AI services + core-api + Lecturer Panel | Needs the full A-02 stack that doesn't exist yet: self-hosted llama.cpp on LAN, Vosk STT (pinned to A76 cores), Tesseract OCR on device. Prototype state logic is spec, not production logic. |
| Send to Projector + projector question overlay + join QR | — | `sendToProjector`/`showing` in `QuestionContext`; A-22 flow | **NEW** | pipeline-manager + AI services + Quiz App | Requires the projector consumer (HDMI-out #1 slides passthrough + overlay switching) — new pipeline infrastructure (A-11, A-22). Leaderboard never on the projector (A-16). |
| Student quiz platform (QR join, answering from phones incl. online students, responses feeding the panel) | — | Mocked via `simulateResponses`/`responsesByQuestion`; A-16 | **NEW** | Quiz App | Separate Next.js app on a campus web server, public domain, basic login now / SSO later (A-16). Cross-network-zone device↔quiz-server sync is unbuilt; hosting details are an open fact-check. |
| Insights panel: Previous Questions + live Leaderboard (points, accuracy, avg time, per-student drill-down) | — | `ai/InsightsPanel`, `SentToProjectorPanel`, `LeaderboardPanel`, `NamesDialog`, `StudentDetailDialog` | **NEW** | Lecturer Panel + Quiz App + core-api | Derived from real response streams once the Quiz App exists; needs a class roster source (mock `CLASS_ROSTER` today — roster provenance is undecided, likely D-02b-adjacent). |
| Live Meeting channel as USB-webcam presentation (HDMI-out #2 → dongle → laptop) | (legacy LMC streamed differently — see §1 `/lmc` row for the UX lineage) | `ChannelCard` Live Meeting + camera-only presets | **NEW** (the hardware path) | pipeline-manager + deploy layer | A-15: composite + embedded mic audio rendered to HDMI-out #2; one dongle per room. Dongle model + passthrough latency are open fact-checks. |
| Room Controls (Projector / Audio / Environment groups) | — | `room/RoomControlsPanel` | **NEW** (mock-only this release) | Lecturer Panel | D-10: control hardware "in progress" — UI ships as placeholder except the working master mic mute. Do not build backend for lights/AC/projector-power yet. |
| Real microphone control (live level meters, gain steppers, per-mic + master mute) | Legacy gain sliders existed but were placebo (B-55) | `MicState` + `setAllMuted`, meters in `SourcesPanel` | **NEW** (first *working* implementation) | pipeline-manager + core-api | Needs a real audio-control path (amixer/pactl) + level telemetry that never existed. Single lecturer mic only (A-08 amended); mic ALSA name is an open fact-check. |
| System Logs & audit trail (level + category filter, search, CSV export) | Legacy had nothing user-facing (console.log only) | `admin/pages/SystemLogs.tsx`; taxonomy Auth/System/Hardware/Session × INFO/WARN/ERROR | **NEW** | core-api + Admin UI | The log taxonomy is a contract — every service (pipeline-manager, upload queue, auth, watchdogs) must emit categorized, leveled, human-readable events into a queryable store. |
| vLAN configuration | — (legacy `dis` had LAN only) | `NetworkSettings` vLAN card | **NEW** | core-api + deploy layer | Supports the A-08 separate camera address range / A-16 cross-zone reachability; needs OS-level netplan work beyond legacy's single-interface handling. |
| WebRTC panel thumbnails / full-motion source previews | Legacy JPEG-over-socket previews are the ancestor (B-17/B-18) | Source tiles + lightbox | **NEW** (transport) | pipeline-manager | A-17. Local kiosk connection keeps risk low, but a WebRTC signaling/media path on-device is net-new infrastructure. |
| Disk-health reporting | — | `LocalStoragePage` "Disk Health: Good" | **NEW** | core-api | Needs SMART polling that legacy never had. Small, but don't ship it hardcoded. |

---

## 5. Summary lists

### 5.1 Legacy features with NO prototype design → Phase-2 design work

1. **Recordings library / File Manager** — list with upload-status badges, in-panel playback/download, copy to USB (with real progress), admin delete (B-31–B-33, B-37). Rules pre-decided by A-20; biggest gap.
2. **Upload queue status view** — per-file state (waiting/uploading/done/failed/dead-letter), retries, manual re-enqueue (B-22–B-28, A-19). Blocked on D-02b for metadata specifics only.
3. **Forced first-login password reset / change-password flow** (B-42) — User Management only adds users today.
4. **User directory management beyond add** — edit, delete, pagination for large rosters (B-44).
5. **Recording-in-progress lock & takeover UX** — what user B sees when the device is already recording, and the admin override (B-15). Must be server-enforced in the rewrite.
6. **Power off / restart control** (B-50) — Menu page is retired; needs a new surface (Room Controls suggested) + refuse-while-recording rule.
7. **Lecturer-facing storage warning** on the dashboard tied to the 14-day retention (B-53/A-20).
8. **Time / NTP / timezone configuration** (B-55 placebo today) — decide whether the appliance exposes it or the deploy layer owns it; correct time matters for titles (A-07), retention, and logs.
9. **Device provisioning surface** — institute/upload-domain profile, storage identity, hall code (B-47, B-51, A-07); currently dev-admin UI, no new home designed.
10. **USB hotplug & device-recovery surfacing** (B-38, B-39) — beyond a log line: how insert/remove and capture-card recovery appear to the user mid-session.
11. **Institute (LMS) user sync + institute login UX** (B-21, B-40) — survives architecturally but its admin visibility/config has no design; source moves to the new institute API (D-02b).

### 5.2 Prototype features with NO legacy equivalent → new infrastructure required

1. **AI question generation stack** — llama.cpp LAN server, Vosk STT, Tesseract OCR, generation orchestration (A-02, A-14).
2. **Student Quiz App** — Next.js on campus web server, public domain, QR join, basic auth now/SSO later, device↔server sync across network zones (A-16); hosting details still an open fact-check.
3. **Projector consumer** — HDMI-out #1 slides passthrough + question/QR overlay switching (A-11, A-22).
4. **Live Meeting hardware path** — HDMI-out #2 camera composite with embedded mic audio → HDMI→USB dongle (A-15); dongle model + latency unverified.
5. **WebRTC preview transport** for panel thumbnails (A-17).
6. **Real audio control path** — mic gain/mute/level telemetry (A-08 amended; legacy's was placebo, B-55).
7. **Structured logging pipeline** feeding the SystemLogs taxonomy (Auth/System/Hardware/Session × level) with export.
8. **Resumable upload job queue + pluggable adapter** against the placeholder institute contract (A-19, **D-02b** — spec pending).
9. **On-device database + migrations** — engine choice **D-03** (default SQLite + Drizzle).
10. **vLAN / multi-zone networking** configuration (supports A-08 camera range and A-16 quiz reachability).
11. **Room-controls hardware integration** — projector/lights/AC (**D-10** — deferred; UI stays placeholder this release).
12. **Disk-health (SMART) telemetry** for the Local Storage page.
