# Behavioral Inventory — Eduscope UMS Legacy (LC / lc-frontend)

> Phase-1 discovery artifact. One entry per observable behavior, verified against code.
> Paths are relative to `legacy-Codebase/`. Line numbers refer to the current snapshot.
>
> **Relationship to `revamp-guide/reference/legacy-architecture-map.md`:** every section-7
> rule was verified (results noted inline as *[Map rule N]*). Discrepancies with the map and
> behaviors the map missed are marked **[MAP GAP]**. Section-8 defects were all confirmed;
> additional defects found here are dispositioned DROP with reasons.

---

## A. Recording lifecycle

### B-01 Record start — pipeline selection matrix
- **What happens:** POST `/api/admin/start` builds a filename, then walks a 4-level nested if/else over `csOptions.rec_method` (Separate | 50-50 | Side | Single) × `lmcOptions.layout(+rec_method)` × `lsOptions.layout(+rec_method)` × source combos (`hdmisource` / `sdisource` / `rtsp` / `rtsp2` / anything-else = external USB cam) and executes exactly one `gst-launch-1.0` command string. ~60 pipelines are inlined in the controller; 64 more (all-RTSP combos) are parameterized functions in `pipelines/pipelines.js`. Many matrix branches are empty (commented out) — for those combos `stringval` stays `undefined`, `shellExec(undefined)` fails silently, and the UI still gets HTTP 200 with `record_status` set to recording (see B-12).
- **Where:** [LC/controllers/admin_ctrl.js:138](../../legacy-Codebase/LC/controllers/admin_ctrl.js:138) (ShellStart), matrix at [admin_ctrl.js:399-1034](../../legacy-Codebase/LC/controllers/admin_ctrl.js:399), execution at [admin_ctrl.js:1038](../../legacy-Codebase/LC/controllers/admin_ctrl.js:1038); [LC/pipelines/pipelines.js:3-295](../../legacy-Codebase/LC/pipelines/pipelines.js) (64 exports, `stval_*`).
- **Trigger:** user presses Record on [home.jsx:490-622](../../legacy-Codebase/lc-frontend/src/pages/main/home.jsx:490).
- **Depends on:** udev aliases `/dev/presentation`, `/dev/presenter`, `/dev/exCAM`; ALSA `hw:externAud,0`, `hw:channel1,0`, `hw:0,3`; NVIDIA Jetson GStreamer elements (`nvvidconv`, `nvv4l2h264enc`, `nvcompositor`, `nvoverlaysink`); `hdd_id` DB row; RTSP camera URLs from `settings` (submenu `dis`).
- **Disposition:** CHANGE — the *capability* (choose one composite pipeline from capture/LMC/LS layout + source selections) must survive; the string matrix should be replaced by a pipeline builder. Empty branches are unsupported combos and must be rejected explicitly instead of silently no-oping.
- **Verification idea:** table-driven test enumerating every (rec_method, lmc, ls, sources) combo the old matrix supports; assert new system produces a pipeline with the same sources, sinks (file(s), RTMP, HDMI monitor, preview JPEGs) per combo, and returns an error for unsupported combos.

### B-02 File-naming contract *[Map rule 1 — confirmed, plus `~cmb` variant the map missed]*
- **What happens:** `filename = module~topic~lecture_hall~userid~YYYY~MM~DD~h~mm~ss~a` with `:` replaced by `-`. Suffixes: single file `.ts`; Separate mode `~1.ts` (presentation+mixed audio) and `~2.ts` (presenter, video-only); pause-combined files add `~cmb` (`...~1~cmb.ts`) — **[MAP GAP]** the `~cmb` suffix is a fourth filename shape the map doesn't list, and it is parsed in the file manager and upload paths. The name is parsed positionally in at least 5 places (tokens 0-3 = metadata, 4-10 = timestamp).
- **Where:** built at [admin_ctrl.js:171-177](../../legacy-Codebase/LC/controllers/admin_ctrl.js:171) and rebuilt on stop at [admin_ctrl.js:1101-1102](../../legacy-Codebase/LC/controllers/admin_ctrl.js:1101); parsed in cleanup cron [LC/index.js:396-397](../../legacy-Codebase/LC/index.js:396), upload metadata [index.js:662-665](../../legacy-Codebase/LC/index.js:662), manual upload [LC/controllers/fm_ctrl.js:206](../../legacy-Codebase/LC/controllers/fm_ctrl.js:206), frontend sort/display [fm.jsx:530-577](../../legacy-Codebase/lc-frontend/src/pages/main/fm.jsx:530), ownership filter [fm.jsx:537](../../legacy-Codebase/lc-frontend/src/pages/main/fm.jsx:537); `~cmb` generated at [fm_ctrl.js:593-624](../../legacy-Codebase/LC/controllers/fm_ctrl.js:593).
- **Trigger:** every record start/stop.
- **Depends on:** module/topic free-text not containing `~` (nothing sanitizes it — a `~` in the topic breaks every parser downstream).
- **Disposition:** CHANGE per decision register — A-07 drops module/topic input, so the name survives only as far as the D-02b upload contract requires; new system should carry metadata in the DB, not the filename.
- **Verification idea:** golden tests: given recording metadata, generated artifacts must map back to identical upload metadata; regression fixture with legacy-named files must still be recognized by any migration/cleanup tooling.

### B-03 `record_status` single-row upsert on start/stop
- **What happens:** on successful pipeline launch, row `record=1` is upserted with `status=true, userid, module, lecture_hall, topic, duration(maxdu), time(updated_at), pauseval`. On stop, same upsert with `status=false` (note: `time` is *not* updated on stop). All values interpolated raw into SQL.
- **Where:** [admin_ctrl.js:1044-1051](../../legacy-Codebase/LC/controllers/admin_ctrl.js:1044) (start), [admin_ctrl.js:1119-1126](../../legacy-Codebase/LC/controllers/admin_ctrl.js:1119) (stop); model [LC/models/recstatus.js](../../legacy-Codebase/LC/models/recstatus.js).
- **Trigger:** record start/stop.
- **Depends on:** MySQL `lc.record_status` table with unique key on `record`.
- **Disposition:** KEEP (concept: persisted global recording state that survives server restart) / CHANGE implementation (parameterized queries, proper state machine).
- **Verification idea:** start recording, kill backend, restart — new system must still report "recording in progress" with correct metadata.

### B-04 Unbounded 500 s polling interval started per record start
- **What happens:** every successful `ShellStart` registers a `setInterval` that queries `settings` (submenu `lss`) every 500 000 ms; the result is only logged, and the interval is never cleared — they accumulate per recording.
- **Where:** [admin_ctrl.js:1056-1065](../../legacy-Codebase/LC/controllers/admin_ctrl.js:1056).
- **Trigger:** record start.
- **Depends on:** nothing consumes the query result.
- **Disposition:** DROP — dead polling loop / leak (map section 8 lists it).
- **Verification idea:** none needed; assert new system has no equivalent.

### B-05 Record LED (GPIO) *[Map rule 10 — confirmed]*
- **What happens:** after pipeline launch, `python /root/src/UMS4/LC/bashfiles/recblink.py` blinks GPIO board pin 23 at 1 Hz forever. On stop: `pkill -f recblink.py`, then run `clear.py` (drives pin 23 LOW once), then `pkill -f clear.py`.
- **Where:** start [admin_ctrl.js:1041-1043](../../legacy-Codebase/LC/controllers/admin_ctrl.js:1041); stop chain [admin_ctrl.js:1143-1148](../../legacy-Codebase/LC/controllers/admin_ctrl.js:1143); scripts [LC/bashfiles/recblink.py](../../legacy-Codebase/LC/bashfiles/recblink.py), [LC/bashfiles/clear.py](../../legacy-Codebase/LC/bashfiles/clear.py).
- **Trigger:** record start/stop.
- **Depends on:** RPi.GPIO on Jetson, absolute path `/root/src/UMS4/LC/bashfiles/`, passwordless sudo for pkill.
- **Disposition:** KEEP — physical recording indicator is a room-facing behavior.
- **Verification idea:** hardware test procedure: LED blinks while recording, off after stop (including stop-via-pause and crash paths).

### B-06 Stop = `sudo killall -SIGINT gst-launch-1.0` (kills everything)
- **What happens:** stopping a recording sends SIGINT to *every* gst-launch process on the device (recording, previews, anything). Also used by `changeSnaps` (B-18) and `bashfiles/stop.sh`. SIGINT + `-e` flag makes GStreamer finalize the mpegts files.
- **Where:** [admin_ctrl.js:1104,1116](../../legacy-Codebase/LC/controllers/admin_ctrl.js:1104); [capture_setup_ctrl.js:272](../../legacy-Codebase/LC/controllers/capture_setup_ctrl.js:272); [LC/bashfiles/stop.sh](../../legacy-Codebase/LC/bashfiles/stop.sh).
- **Trigger:** stop/pause button; preview source change; menu navigation (B-14).
- **Depends on:** passwordless sudo; single-tenant assumption (only one pipeline family runs at a time).
- **Disposition:** CHANGE — graceful EOS-on-stop must survive (files must be finalized, not truncated); process targeting must become per-pipeline (map section 8).
- **Verification idea:** stop a recording while a preview pipeline runs; recording file must be playable/complete and preview must be unaffected in the new system.

### B-07 Crash recovery of start time on stop *[Map rule 4 — confirmed]*
- **What happens:** `ShellStop` rebuilds the filename using in-memory `updated_at` if present, else re-reads `record_status.time` from DB — so a recording started before a server restart still queues under its original filename.
- **Where:** [admin_ctrl.js:1077-1102](../../legacy-Codebase/LC/controllers/admin_ctrl.js:1077) (`query_promise_rectime` + fallback at 1101).
- **Trigger:** record stop after backend restart.
- **Depends on:** B-03 having persisted `time` at start.
- **Disposition:** KEEP (recoverable recording session state) / CHANGE (persist whole session, not just time — see B-08 for what's lost today).
- **Verification idea:** start recording → restart backend service → stop; queued row must reference the original file and it must upload.

### B-08 Duration computed from in-memory start moment — NaN after restart **[MAP GAP]**
- **What happens:** stop computes `duration = moment().diff(updated_at_now, 'minutes')`; `updated_at_now` is module state, so after a restart the queue row gets `duration=NaN` even though the filename is recovered (B-07). Duration feeds the file-manager conversion time estimate (B-34).
- **Where:** [admin_ctrl.js:1107](../../legacy-Codebase/LC/controllers/admin_ctrl.js:1107), consumed at [fm.jsx:159-168](../../legacy-Codebase/lc-frontend/src/pages/main/fm.jsx:159), [fm_ctrl.js:607-613](../../legacy-Codebase/LC/controllers/fm_ctrl.js:607).
- **Trigger:** stop after restart.
- **Disposition:** DROP defect / CHANGE — duration must come from persisted start time or from probing the file.
- **Verification idea:** same test as B-07, additionally assert stored duration is correct.

### B-09 Queue insertion on stop — dual vs single, per-stream group ids *[Map rule 2 — confirmed with nuance]*
- **What happens:** on every stop (including pause-stops), if `rec_method == "Separate"` two `video_queue` rows are inserted: `<name>~1.ts` with `groupid` and `<name>~2.ts` with a *different* `groupid2`; otherwise one row `<name>.ts` with `groupid`. All rows get `status='waiting'`, `duration`, `pauseval`. Group ids are regenerated only when `pauseval === 0` (B-10). **[MAP GAP]** the map implies one groupid; in fact the two streams of a Separate recording have independent group ids (so pause-concat combines segments per stream, B-34).
- **Where:** [admin_ctrl.js:1110-1140](../../legacy-Codebase/LC/controllers/admin_ctrl.js:1110).
- **Trigger:** record stop / pause.
- **Depends on:** `video_queue` schema (filename, status, duration, groupid, pauseval, converted, videoid).
- **Disposition:** CHANGE per decision register (A-12 replaces groupid mechanics with clean split-file pause); the observable outcome — every finished file eventually enters the upload queue exactly once — must survive.
- **Verification idea:** record with N pauses in Separate mode; assert queue ends with the correct set of rows/segments and the upload produces one lecture (per D-02b contract).

### B-10 Pause semantics *[Map rule 3 — confirmed; distributed across UI and 3 endpoints]*
- **What happens:** Pause = full stop + later restart. Frontend keeps `isPaused` counter: pressing Pause increments it and calls `/stop` with the current `pauseval`; pressing Resume calls `/start` with `pauseval` so the same-session segments share group ids (B-09). Pressing Stop while paused calls `/uppausestatus` (reset `record_status.pauseval=0`) and, if final `pauseval===0`, `/upgroupid` — which writes a fresh random groupid **and `pauseval=0` onto only the last `video_queue` row** (`ORDER BY id DESC LIMIT 1`) so the next recording can't merge into the previous group. `record_status.pauseval` is also how a reloaded UI knows a paused session exists (B-15).
- **Where:** UI state machine [home.jsx:559-617](../../legacy-Codebase/lc-frontend/src/pages/main/home.jsx:559); endpoints [admin_ctrl.js:68-91](../../legacy-Codebase/LC/controllers/admin_ctrl.js:68) (`updatePauseStatus`, `updateGroupID`); [models/videoQueue.js:233-253](../../legacy-Codebase/LC/models/videoQueue.js:233) (`updateVidQGroupId`).
- **Trigger:** Pause/Resume/Stop buttons.
- **Depends on:** client driving the state transitions correctly (server has no pause state machine); consecutive queue-row IDs.
- **Disposition:** CHANGE — A-12: keep "pause produces multiple files merged into one lecture", drop client-driven groupid bookkeeping. Note quirk to *not* reproduce: `updateVidQGroupId` touching only the last row leaves the `~1.ts` twin of a dual recording with the stale groupid.
- **Verification idea:** scripted pause/resume/stop sequences (incl. dual-stream) asserting final queue state; UI reload mid-pause must still allow resume.

### B-11 Empty `audOnlyPipe` executed on stop *[Map §8 — confirmed]*
- **What happens:** stop chain ends by executing the empty string as a shell command (no-op) before responding.
- **Where:** [admin_ctrl.js:1094,1151](../../legacy-Codebase/LC/controllers/admin_ctrl.js:1094).
- **Disposition:** DROP — vestigial.
- **Verification idea:** none.

### B-12 Fire-and-forget execution + inverted/dead error flag
- **What happens:** `codeexec` in admin_ctrl sets `isError=false`, calls `shellExec` without awaiting, and always invokes the callback with `true` unless the *synchronous* call threw. So start/stop report success regardless of pipeline outcome, and `record_status` is set to recording even when nothing runs. `GET /api/admin/isError` (unauthenticated) returns 200 only `if (isError)` — but nothing ever sets `isError=true`, so it always 409s. The frontend's `checkErr` exists but is never called.
- **Where:** [admin_ctrl.js:25-39,93-104](../../legacy-Codebase/LC/controllers/admin_ctrl.js:25); route without auth [adminRoutes.js:48](../../legacy-Codebase/LC/routes/adminRoutes.js:48); dead frontend caller [home.jsx:624-640](../../legacy-Codebase/lc-frontend/src/pages/main/home.jsx:624).
- **Trigger:** any record start/stop.
- **Disposition:** DROP — replace with real process supervision (map §8: no PID retained, `codeexec` reports success without awaiting).
- **Verification idea:** new system: start with an unplugged source must surface an error to the UI and must not mark the session as recording.

### B-13 Physical record button (GPIO) — half-wired **[MAP GAP]**
- **What happens:** `recpress.py` (run via `bashfiles/hi.sh`, launcher not in repo) waits on GPIO pin 15 falling edge and sets `record_status.status=0` directly in MySQL (hardcoded root credentials). The frontend has a matching flow (`recbtnpressfunc`) that listens for socket event `getbtnstatus` and shows a 10-second "stop recording?" countdown — but **no backend code ever emits `getbtnstatus` or handles `reqbtnstatus`**, and nothing polls `record_status.status` for the button-induced change. As shipped, the button flips a DB flag with no visible consumer.
- **Where:** [LC/bashfiles/recpress.py](../../legacy-Codebase/LC/bashfiles/recpress.py), [LC/bashfiles/hi.sh](../../legacy-Codebase/LC/bashfiles/hi.sh); orphan frontend handler [home.jsx:350-388](../../legacy-Codebase/lc-frontend/src/pages/main/home.jsx:350) (`recbtnpressfunc` is only called from its own cancel branch — dead entry point).
- **Trigger:** physical button press.
- **Depends on:** whatever service starts `hi.sh` (not in repo — see Needs human confirmation).
- **Disposition:** CHANGE if the hardware button is a real product feature (needs product confirmation); as code it is dead/incomplete — DROP the socket half unless the button is kept.
- **Verification idea:** if kept: press button during recording → recording stops gracefully within N seconds and UI reflects it.

### B-14 Navigating to Main Menu kills all GStreamer processes **[MAP GAP]**
- **What happens:** `menu.jsx` calls `RecordStatus.stopRec()` with no body on every render. Backend `ShellStop` guards DB writes behind `Object.keys(req.body).length != 0`, but the `killall gst-launch-1.0` still runs — this is how setup-preview pipelines get cleaned up when the user leaves a preview page, and it would also kill an active recording started by someone else if a user lands on /menu (UI tries to prevent this by disabling the Menu button during recording, [home.jsx:879](../../legacy-Codebase/lc-frontend/src/pages/main/home.jsx:879)).
- **Where:** [menu.jsx:34-49](../../legacy-Codebase/lc-frontend/src/pages/main/menu.jsx:34); guard at [admin_ctrl.js:1118](../../legacy-Codebase/LC/controllers/admin_ctrl.js:1118).
- **Trigger:** any navigation to `/menu`.
- **Disposition:** CHANGE — the *need* (tear down preview pipelines when leaving setup pages) survives; the mechanism (blind global kill from a page render) must not.
- **Verification idea:** open capture-setup preview, navigate away, assert preview process exits; do the same while a recording runs and assert the recording is untouched.

### B-15 Recording-in-progress detection & session takeover rules
- **What happens:** on Home load, `GET /chkstatus` returns the `record_status` row. If `status` true (or false with `pauseval>0` = paused), the UI locks module/topic/hall inputs, restores them from the row, restores the pause counter, warns "Another Recording in Progress!", and only enables the Stop/Pause controls if the viewer is an admin or the same `userid` that started it.
- **Where:** [home.jsx:319-348](../../legacy-Codebase/lc-frontend/src/pages/main/home.jsx:319) and gating at [home.jsx:494,941,954](../../legacy-Codebase/lc-frontend/src/pages/main/home.jsx:941); backend [admin_ctrl.js:42-51](../../legacy-Codebase/LC/controllers/admin_ctrl.js:42).
- **Trigger:** page load / login while device is recording or paused.
- **Depends on:** B-03/B-10 state.
- **Disposition:** KEEP — single-recorder mutual exclusion with admin override is core kiosk behavior (enforce server-side in rewrite; today it is UI-only).
- **Verification idea:** user A records; user B logs in — B sees locked state and cannot stop; admin can.

### B-16 Record start requires module+topic+duration; start-with-stream sequencing
- **What happens:** UI refuses to start unless `module && topic && maxdu` are set ("Fill All Fields"). If the Stream toggle is on, it first starts the live stream (nginx rewrite, B-61), waits 5 s, then starts recording; on stop it stops the stream after the recording stops.
- **Where:** [home.jsx:494-540,595-609](../../legacy-Codebase/lc-frontend/src/pages/main/home.jsx:494).
- **Trigger:** Record button with Stream switch on/off.
- **Disposition:** CHANGE — field requirements change with A-07; stream-before-record ordering (nginx must be reloaded before the pipeline pushes to `rtmp://localhost/live`) is load-bearing and must survive in some form.
- **Verification idea:** start record+stream; assert RTMP push targets are active before the pipeline connects; stop ends both.

---

## B. Previews

### B-17 Recording previews over Socket.IO (p1.jpg/p2.jpg)
- **What happens:** recording pipelines write 1 fps JPEG snapshots to `./p1.jpg` (+ `./p2.jpg` in Separate mode) via `multifilesink`. When the UI emits `startrec`, the server starts a 3 s interval that reads both files and emits base64 `image1`/`image2` events; the UI shows them as live preview. Emitting `startrec:false` stops emission (but not the interval — B-19).
- **Where:** [LC/index.js:192-222](../../legacy-Codebase/LC/index.js:192); pipeline sinks e.g. [admin_ctrl.js:183](../../legacy-Codebase/LC/controllers/admin_ctrl.js:183) (`multifilesink location=p1.jpg`); consumer [home.jsx:105-153](../../legacy-Codebase/lc-frontend/src/pages/main/home.jsx:105).
- **Trigger:** record start (socket event from UI).
- **Depends on:** CWD of the node process (relative paths `./p1.jpg`); pipeline including the preview branch.
- **Disposition:** CHANGE — live confidence-monitor preview must survive; file-polling-to-base64 transport should be replaced (e.g., MJPEG/WebRTC/HLS).
- **Verification idea:** during recording, preview updates at ≥1 frame/3 s for each recorded stream; no update after stop.

### B-18 Setup previews (presentation.jpg/presenter.jpg) + source switching
- **What happens:** Capture Setup / LMC / LS pages POST `/api/caps/cscreatesnaps` (or `cschangesnaps`) with two selected sources; backend picks one of ~19 two-source snapshot pipelines writing `presentation.jpg`/`presenter.jpg` at 1-2 fps. `changeSnaps` first runs the global `killall -SIGINT gst-launch-1.0`, waits 4.5 s, then starts the new snapshot pipeline. UI emits `startpriv` and the server pushes both JPEGs every 800 ms as `presentation`/`presenter` events.
- **Where:** [capture_setup_ctrl.js:125-295](../../legacy-Codebase/LC/controllers/capture_setup_ctrl.js:125); socket serving [index.js:224-254](../../legacy-Codebase/LC/index.js:224); consumers [captureSetup.jsx:201,274,351](../../legacy-Codebase/lc-frontend/src/pages/main/captureSetup.jsx:201), [lmc.jsx:376-450](../../legacy-Codebase/lc-frontend/src/pages/main/lmc.jsx:376), [ls.jsx:249-326](../../legacy-Codebase/lc-frontend/src/pages/main/ls.jsx:249).
- **Trigger:** opening/altering source selection on setup pages.
- **Depends on:** same devices/udev names as B-01; the 4.5 s kill-to-restart gap.
- **Disposition:** CHANGE — WYSIWYG source preview before recording must survive; global-kill switching must not.
- **Verification idea:** switch sources repeatedly on setup page; preview follows selection; a concurrent recording (new system) must be unaffected.

### B-19 Per-connection `setInterval`s never cleared *[Map §8 — confirmed]*
- **What happens:** each socket connection that ever emits `startrec`/`startpriv` registers a new interval (3000 ms / 800 ms) that is never cleared, and each `usbdetection` may register a 5 s storage poll guarded only by a global `usbrunning` flag. Long uptimes accumulate timers and duplicate emits.
- **Where:** [index.js:197,229,279](../../legacy-Codebase/LC/index.js:197).
- **Disposition:** DROP — lifecycle-manage subscriptions in rewrite.
- **Verification idea:** soak test: connect/disconnect 100 clients; timer count stays bounded.

---

## C. Cron jobs & upload pipeline

### B-20 Storage cleanup cron *[Map rule 5 — confirmed with caveats]*
- **What happens:** every minute (`0 * * * * *`): read HDD usage via `df /media/{hdduuid}`; if usage > 80 %, list `/media/{uuid}/record`, parse each file's recording date **from its filename** (B-02), select files older than 7 days, set their `video_queue` rows to `deleted(sys)` (by `.ts` name), then `rm` the `.mp4`s from `record/` and the `.ts` twins from `record-ts/`. Deletion ignores upload status — never-uploaded files are deleted too. Caveats found: (a) any non-.mp4/.ts file in `record/` makes `getFileList` return `undefined` entries and the filter throws, aborting cleanup every minute; (b) `duf`/`fdd` settings shown in the UI ("delete uploaded files", "file deletion delay") are **not consulted** — thresholds 80 %/7 days are hardcoded. **[MAP GAP]** (b).
- **Where:** [index.js:382-437](../../legacy-Codebase/LC/index.js:382); shared lister [fm_ctrl.js:117-140](../../legacy-Codebase/LC/controllers/fm_ctrl.js:117); inert settings UI [lss.jsx:157-176](../../legacy-Codebase/lc-frontend/src/pages/settings/lss.jsx:157).
- **Trigger:** cron, every minute.
- **Depends on:** `hdd_id` row; filename contract; `df`, `rm` via shell.
- **Disposition:** CHANGE — retention policy survives but must be configurable, tolerate foreign files, and prefer deleting already-uploaded files first (decision register owns exact policy).
- **Verification idea:** fill disk past threshold with fixture files of known ages incl. a stray `.txt`; assert correct set deleted, queue rows marked, no crash.

### B-21 Institute user sync cron (hourly)
- **What happens:** at minute 0 of every hour, if `UPLOAD_DOMAIN != 'false'`, GET `full_login_list` from the LMS (hardcoded API key, TLS verification disabled) and upsert every user into `instituteusers` — password stored as `bcrypt(md5-hash-received-from-LMS)`; `name` is set to the username.
- **Where:** [index.js:440-460](../../legacy-Codebase/LC/index.js:440); [models/institute-users.js:32-42](../../legacy-Codebase/LC/models/institute-users.js:32).
- **Trigger:** cron hourly.
- **Depends on:** LMS `external_service.php` returning `{user:[{id,username,password}]}` where `password` is already an md5 digest (implied by B-40 login compare).
- **Disposition:** CHANGE — roster sync survives; hardcoded key, disabled TLS, and md5 handling must not.
- **Verification idea:** mock LMS; sync; institute user can log in with their LMS password (B-40 flow) after sync.

### B-22 Scheduled upload windows *[Map rule 6 — confirmed with details]*
- **What happens:** every minute (tz `Asia/Colombo`), if `UPLOAD == 'scheduled'`: read `fus` settings **by array position** (`data[1]`=su enable, `data[2]`=ut window, `data[3]`=ut2 backup window — an implicit ordering contract on the settings rows). Windows are stored as `"unixStart,unixEnd"`; only hours:minutes are compared, with wrap-around-midnight handling. Inside a window with `su=='1'` and no upload in flight: retry failed files (B-27) then process waiting files (B-23/24/25).
- **Where:** [index.js:467-509,515-637](../../legacy-Codebase/LC/index.js:467); window math [index.js:495-509](../../legacy-Codebase/LC/index.js:495); UI [fus.jsx:156-176](../../legacy-Codebase/lc-frontend/src/pages/settings/fus.jsx:156).
- **Trigger:** cron every minute.
- **Depends on:** `settings` submenu `fus` row order; `UPLOAD` env var; device clock/timezone.
- **Disposition:** CHANGE — windowed upload survives; positional row access and env-var mode switch should be redesigned.
- **Verification idea:** set window to now±5 min, queue a file, assert upload begins; outside window nothing happens; window spanning midnight works.

### B-23 `.ts` → `.mp4` conversion before upload
- **What happens:** for each waiting file with `converted=0`: `ffmpeg -i record-ts/<f>.ts -c copy -y record/<f>.mp4`, set `converted=1`; if the file is `~1.ts`, also convert its `~2.ts` twin. Conversion uses `execSync` misused with a callback (callback never runs; conversion is synchronous and blocks the event loop for the duration).
- **Where:** [index.js:593-616](../../legacy-Codebase/LC/index.js:593); `codeexecConvert` [index.js:121-140](../../legacy-Codebase/LC/index.js:121).
- **Trigger:** upload cron pass.
- **Depends on:** ffmpeg; both `record/` and `record-ts/` directories.
- **Disposition:** KEEP the dual-artifact convention (raw `.ts` in `record-ts/`, playable `.mp4` in `record/`) unless decision register says otherwise; CHANGE to async conversion.
- **Verification idea:** queue a `.ts`; after cron pass the `.mp4` exists, plays, and `converted=1`.

### B-24 Upload protocol and failure branches
- **What happens:** per file: (1) `add_video` GET → `video_id` (metadata from filename tokens: uid, module, topic, + `lecture_hall` if SLIIT else `video_type=1&organization_id=34`); videoid saved on the queue row; (2) multipart POST `video_file_upload` streaming the `.mp4` (10 000-byte highWaterMark); if the mp4 is missing → status `nofile` and skip; if the POST throws → server-side `delete_video`/`delete_lecture` then status `failed`; (3) on upload success → `video_upload_complete`, status `done`; on upload-result != success → delete remote video, status `failed`. All requests use hardcoded key `bkgu6786GHBj68h` and `rejectUnauthorized:false`.
- **Where:** [index.js:649-851](../../legacy-Codebase/LC/index.js:649) (`uploadVids`, `getVideoID`, `fileupload`, `completeupload`).
- **Trigger:** upload cron inside window.
- **Depends on:** LMS `external_service.php` API; queue schema; filename metadata.
- **Disposition:** CHANGE — the add→upload→complete + delete-on-failure contract is D-02b's domain and must survive; secrets/TLS handling must not.
- **Verification idea:** contract tests against a mock LMS covering: success, mid-upload network failure, missing mp4, complete-call failure; assert final queue status and remote-delete calls match legacy.

### B-25 Dual-stream upload as one lecture *[Map rule 2 — confirmed + two gaps]*
- **What happens:** queue scans skip rows whose filename ends `2.ts` (`substr(-4) != "2.ts"`); when uploading a `~1.ts` row, the `~2` mp4 is uploaded under the same `video_id`, and on success the `~2` row is marked done by updating **id+1** (assumes twin rows have consecutive ids, guaranteed only by B-09's single INSERT). **[MAP GAP 1]** combined pause files `...~2~cmb.ts` do *not* end in `2.ts`, so they are not skipped — a paused dual recording's presenter stream is queued for upload as its own lecture. **[MAP GAP 2]** the failed-retry scan has the same skip rule, but the id+1 convention is unchecked there.
- **Where:** skip filters [index.js:479,552,573](../../legacy-Codebase/LC/index.js:479); dual logic [index.js:659-733](../../legacy-Codebase/LC/index.js:659); id+1 at [index.js:706-718](../../legacy-Codebase/LC/index.js:706).
- **Trigger:** upload cron.
- **Disposition:** CHANGE — one-lecture-per-recording invariant survives via explicit relations, not filename suffix + adjacent ids; decide explicitly what happens to `~2~cmb` files (legacy behavior is arguably a bug).
- **Verification idea:** upload a dual recording (plain and paused/combined); LMS mock receives exactly one video id with two file parts; both queue rows end `done`.

### B-26 SLIIT vs generic LMS switch *[Map rule 7 — confirmed + boot-time nuance]*
- **What happens:** `isSliit = UPLOAD_DOMAIN.split('.')[1] == 'sliit'`, evaluated **once at module load** — changing the domain via Dev settings (B-47) doesn't retarget verbs until restart. SLIIT: `delete_lecture`, `lecture_hall` metadata, no `organization_id`; generic: `delete_video`, `video_type=1&organization_id=34`. `sd_ctrl` picks the API key per domain for module lists but always uses the SLIIT key for lecture halls. Frontend computes its own `isSliit`/`isEduStream` from the `domain` pseudo-setting to decide dropdowns vs free-text (modules/halls fetched from LMS).
- **Where:** [index.js:513,558,721,753,778,807,825](../../legacy-Codebase/LC/index.js:513); [sd_ctrl.js:11,35](../../legacy-Codebase/LC/controllers/sd_ctrl.js:11); frontend [home.jsx:405-408,890-913](../../legacy-Codebase/lc-frontend/src/pages/main/home.jsx:405). If `UPLOAD_DOMAIN` is unset entirely the `.split` at index.js:513 throws at boot (with the string `'false'` it is safe).
- **Trigger:** boot (flag), every upload/delete call, Home page load.
- **Disposition:** CHANGE — institution-profile switch survives as explicit configuration; string-sniffing the domain does not.
- **Verification idea:** run upload suite under both profiles asserting verb/metadata differences match this table.

### B-27 Failed-upload retry pass — with a dead re-queue **[MAP GAP]**
- **What happens:** at window start, for each `failed` row (skipping `2.ts`): call remote `delete_video`/`delete_lecture` with `uid=1`; on `'success'` the code intends to set the row back to `waiting` — but calls `videoQueue.updateById(id, ...)` with an **undefined `id`** variable (should be `file.id`), so the UPDATE hits `WHERE id = undefined` and fails silently; failed rows therefore stay `failed` forever, though the remote copy *is* deleted each window.
- **Where:** [index.js:552-569](../../legacy-Codebase/LC/index.js:552) (bug at 561).
- **Trigger:** upload cron inside window.
- **Disposition:** DROP the bug, KEEP the intent (failed uploads are cleaned remotely and retried) — the map's rule 6 describes the *intent*, not the actual (broken) behavior; the rewrite spec should state the intent explicitly.
- **Verification idea:** force a failure, next window: remote deleted once, row returns to waiting, second attempt succeeds.

### B-28 `nofile` status
- **What happens:** if the expected `.mp4` doesn't exist at upload time the row is marked `nofile` and never retried (it is excluded from both `waiting` and `failed` scans).
- **Where:** [index.js:803-820](../../legacy-Codebase/LC/index.js:803).
- **Disposition:** KEEP concept (dead-letter state) / CHANGE naming + surfacing to operators.
- **Verification idea:** delete an mp4 then run cron; row ends `nofile` and is skipped subsequently.

### B-29 Auto-shutdown after uploads — disabled stub
- **What happens:** when no waiting files remain, nothing processing, and at least one upload happened this boot (`foo` flag), the cron schedules `shutdownDevice()` after 10 s — whose body is commented out. No shutdown actually occurs.
- **Where:** [index.js:463-489,639-641](../../legacy-Codebase/LC/index.js:463).
- **Disposition:** DROP unless product wants "power off after nightly upload" back (needs human confirmation).
- **Verification idea:** n/a (dead), or power-management test if resurrected.

### B-30 "Instant upload" mode is stored but unimplemented **[MAP GAP]**
- **What happens:** the FUS page offers Instant vs Scheduled upload; `ApplyFus` writes `UPLOAD=instant` to env + `.env` — but the only consumer checks `UPLOAD == 'scheduled'`; nothing anywhere implements instant upload. Selecting Instant silently disables uploads entirely.
- **Where:** [settings_ctrl.js:415-436](../../legacy-Codebase/LC/controllers/settings_ctrl.js:415); sole consumer [index.js:471](../../legacy-Codebase/LC/index.js:471); UI [fus.jsx:148-155](../../legacy-Codebase/lc-frontend/src/pages/settings/fus.jsx:148).
- **Disposition:** DROP the fake toggle or CHANGE to a real implementation — product decision; do not carry the silent-disable behavior forward.
- **Verification idea:** if implemented: stop a recording with instant mode on → upload begins within a minute, outside any window.

---

## D. File manager

### B-31 File listing with upload status and per-user visibility
- **What happens:** `GET /api/fm/fmload` lists `/media/{uuid}/record` (`.mp4`/`.ts` only), attaching size and the `video_queue.status` looked up by the `.ts` name. The frontend sorts by the date parsed from the filename, and **non-admin users only see files whose filename token 3 equals their userid** (enforced client-side only). Dual/`~cmb` twins are visually grouped; checkboxes only on the `~2` (or single) file, with the `~1` twin auto-included in size, copy and delete.
- **Where:** [fm_ctrl.js:103-140,463-502](../../legacy-Codebase/LC/controllers/fm_ctrl.js:103); [fm.jsx:529-625](../../legacy-Codebase/lc-frontend/src/pages/main/fm.jsx:529) (filter at 537, twin pairing 549-570).
- **Trigger:** opening File Management.
- **Depends on:** filename contract; queue table.
- **Disposition:** KEEP (per-user library view, status badges, dual-file grouping) / CHANGE — ownership filtering must move server-side.
- **Verification idea:** seed files for two users; each sees only their own; admin sees all; statuses match queue.

### B-32 Copy to USB via rsync
- **What happens:** `POST /fmcopy` expands the selection with `~1` twins, finds the first non-HDD non-SD USB drive, `mkdir -p <usb>/eduscope-ums`, then `rsync -avzuP` from `record/` including only the selected names. On completion the server emits socket `copysuccess`; the frontend treats an HTTP timeout as normal and waits for that event, showing progress by polling USB free space (B-38) against the expected copy size.
- **Where:** [fm_ctrl.js:269-385](../../legacy-Codebase/LC/controllers/fm_ctrl.js:269); frontend [fm.jsx:268-339](../../legacy-Codebase/lc-frontend/src/pages/main/fm.jsx:268), progress calc [fm.jsx:200-223](../../legacy-Codebase/lc-frontend/src/pages/main/fm.jsx:200).
- **Trigger:** Copy to USB button.
- **Depends on:** rsync binary; drivelist; SDCARD env filter; USB auto-mount by the OS.
- **Disposition:** KEEP — offline export to USB is a core lecturer workflow; CHANGE progress reporting to real rsync progress.
- **Verification idea:** insert USB, copy a dual recording; both files appear under `eduscope-ums/`; UI reaches 100 %.

### B-33 Delete recordings (admin-only)
- **What happens:** `POST /fmdelete2` (role admin/dev-admin) expands twins, marks queue rows `deleted(<userid>)` (vs `deleted(sys)` from cleanup — the status string encodes who deleted), then `rm`s the `.mp4`s and `.ts`s. Frontend treats a 504 as success (long deletes).
- **Where:** [fm_ctrl.js:388-443](../../legacy-Codebase/LC/controllers/fm_ctrl.js:388); route [fmRoutes.js:29](../../legacy-Codebase/LC/routes/fmRoutes.js:29); UI [fm.jsx:341-417,518](../../legacy-Codebase/lc-frontend/src/pages/main/fm.jsx:341).
- **Disposition:** KEEP (audited delete with actor recorded) / CHANGE encoding (proper audit column, not status-string smuggling).
- **Verification idea:** delete as admin; files gone from both dirs; queue rows record actor; non-admin gets 401.

### B-34 Pause-segment combining (`~cmb`) on File Manager open **[MAP GAP — the map's rule 3 stops at groupid; this is the consumer]**
- **What happens:** opening File Management checks for non-converted `.ts` rows (`converted=0`, ordered by pauseval); if any, the UI offers "Start File Conversion" with an ETA of `sum(duration)×1.12`. Conversion groups rows by `groupid`; groups with >1 file are ffmpeg-concatenated into `<first>~cmb.ts`, a **new queue row** is inserted for the combined file (status waiting, summed duration, same groupid), the combined file is converted to mp4, and all involved rows get `converted=1`. Single-file groups are converted directly. This is the only place pause segments become one artifact.
- **Where:** [fm_ctrl.js:504-671](../../legacy-Codebase/LC/controllers/fm_ctrl.js:504); UI prompt [fm.jsx:153-198](../../legacy-Codebase/lc-frontend/src/pages/main/fm.jsx:153); routes `fmgetnctslist`/`fmstartconvert` [fmRoutes.js:33-34](../../legacy-Codebase/LC/routes/fmRoutes.js:33).
- **Trigger:** user opens File Management and confirms (i.e., merging is user-initiated, not automatic — if nobody opens FM, the scheduled upload uploads the *unmerged* segments; segment rows are `waiting` from birth).
- **Depends on:** ffmpeg concat protocol; groupid semantics (B-09/B-10).
- **Disposition:** CHANGE per A-12 — merging must become automatic/server-side; note the legacy race (upload window may ship unmerged segments before anyone opens FM) as a bug not to reproduce.
- **Verification idea:** record with pauses, don't open FM, run upload — new system must upload exactly one merged lecture regardless of UI visits.

### B-35 Manual per-file upload endpoint — hardcoded target, orphaned UI
- **What happens:** `POST /fmupload` uploads a named mp4 to a **hardcoded** `s2.eduscopestream.com` with a different hardcoded key, `uid=136`, `module=5` (ignores the file's real metadata except topic). The corresponding UI button is commented out; the route is still live and JWT-only.
- **Where:** [fm_ctrl.js:144-265](../../legacy-Codebase/LC/controllers/fm_ctrl.js:144); dead UI [fm.jsx:230-266,611-612](../../legacy-Codebase/lc-frontend/src/pages/main/fm.jsx:230).
- **Disposition:** DROP — superseded by scheduled upload; hardcoded remote credentials in a live route.
- **Verification idea:** assert no equivalent route exists in rewrite.

### B-36 OneDrive upload — broken dead code
- **What happens:** `uploadVideoOneDrive` exists with hardcoded client id/secret, but references undefined variables (`isDual`, `refresh_token`, `onedrive_file`, `formData`) and would throw immediately. Not routed. The map (section 6) says file manager "uploads to LMS or OneDrive on demand" — **[MAP GAP]** the OneDrive path was never functional and is unrouted.
- **Where:** [fm_ctrl.js:731-836](../../legacy-Codebase/LC/controllers/fm_ctrl.js:731); no route in [fmRoutes.js](../../legacy-Codebase/LC/routes/fmRoutes.js).
- **Disposition:** DROP.

### B-37 Playback/download of recordings via nginx `/record/`
- **What happens:** the UI plays and downloads mp4s from `http://{IP}:3000/record/<file>` — served by nginx from a `location /record/` whose `root` is rewritten to the HDD mount whenever a new HDD id is generated (B-51). No auth on these URLs.
- **Where:** [fm.jsx:614,658](../../legacy-Codebase/lc-frontend/src/pages/main/fm.jsx:614); nginx rewrite [settings_ctrl.js:1018-1038](../../legacy-Codebase/LC/controllers/settings_ctrl.js:1018).
- **Depends on:** `/etc/nginx/sites-available/ums4fe` (not in repo).
- **Disposition:** CHANGE — in-browser playback/download survives; unauthenticated static exposure of all recordings should not.
- **Verification idea:** playback works for an authorized user; direct URL without session is rejected in rewrite.

---

## E. USB & hardware supervision

### B-38 USB drive hotplug detection + capacity broadcasting
- **What happens:** when a client emits `usbdetection`, the server starts usb-detection monitoring: on insert, `drivelist` finds USB drives that are neither `/dev/sda` (the record HDD) nor the SD-card device path from `SDCARD` env; the first match's mountpoint/name are tracked and a 5 s interval `df`s it and broadcasts `storagedata` (`io.emit` — all clients). On removal, a removal diff runs (comparing mountpoints against **device paths** — a latent mismatch) and emits `' 0 0 0'/No USB Device Found`.
- **Where:** [index.js:257-375](../../legacy-Codebase/LC/index.js:257); consumers [fm.jsx:122-144](../../legacy-Codebase/lc-frontend/src/pages/main/fm.jsx:122).
- **Trigger:** File Management page open + physical USB events.
- **Depends on:** OS auto-mounting USB drives; `SDCARD` env; `usb-detection` native module.
- **Disposition:** CHANGE — hotplug awareness + free-space display survive; global-broadcast, first-drive-only, and the mountpoint/device diff bug do not.
- **Verification idea:** insert/remove USB while FM open; capacity appears/disappears correctly; two drives → user can pick.

### B-39 EZ-Cap boot watchdog *[Map rule 8 — confirmed with details]*
- **What happens:** once, at server listen: run `v4l2-ctl --list-devices`, split on newline/`(`/tab, filter; if the literal string `"Eduscope UMS "` (note trailing space) is absent, wait 20 s then `sudo uhubctl -l 2-1 -p 2 -a cycle -d 5 -R` to power-cycle the USB hub port. One-shot — no re-check afterwards, no recovery during uptime.
- **Where:** [index.js:157-189](../../legacy-Codebase/LC/index.js:157).
- **Trigger:** backend boot.
- **Depends on:** uhubctl, hub topology `2-1` port 2, capture card advertising the exact name.
- **Disposition:** KEEP intent (capture-hardware self-heal at boot) / CHANGE to a supervised health check rather than a one-shot string match.
- **Verification idea:** boot with capture card unresponsive (or simulated) → hub power-cycled and device re-enumerates; boot with healthy card → no cycle.

---

## F. Auth & users

### B-40 User login — local vs institute (`@sliit.lk`)
- **What happens:** `POST /api/admin/login` (unauthenticated): if username ends `@sliit.lk`, look up `instituteusers` and compare `bcrypt(md5(password))`; otherwise `users` with plain bcrypt. Success returns JWT (`user_id`, role `user`, username, name; 7-day expiry) plus `flogin` (institute users are always treated as `flogin=1`).
- **Where:** [login_ctrl.js:16-132](../../legacy-Codebase/LC/controllers/login_ctrl.js:16); [middleware/passport.js:15-45](../../legacy-Codebase/LC/middleware/passport.js:15) (same table split at token verification; note: for role `user` the **full DB row including password hash** becomes `req.user`).
- **Trigger:** login form.
- **Depends on:** B-21 sync for institute users; `APP_SECRET` env (`qwertyuiop` in the checked-in `.env`).
- **Disposition:** CHANGE — dual user source survives; md5 layer, 7-day tokens on a shared kiosk, and hash-in-req.user must be redesigned.
- **Verification idea:** login matrix: local ok/bad-pass, institute ok/bad-pass, expired token; new system rejects each correctly.

### B-41 Admin login — username `root` becomes `dev-admin`
- **What happens:** `POST /admin-login` checks the `admins` table; the JWT role is `dev-admin` iff username is exactly `root`, else `admin`. Wrong password → 403, unknown user → 400 (login page maps these to distinct messages).
- **Where:** [login_ctrl.js:136-186](../../legacy-Codebase/LC/controllers/login_ctrl.js:136); [loginAdmin.jsx](../../legacy-Codebase/lc-frontend/src/pages/main/loginAdmin.jsx).
- **Disposition:** CHANGE — three-tier roles survive; magic username must become a real role column.
- **Verification idea:** role-based access tests for the routes in B-43.

### B-42 First-login forced password reset (`flogin`) — via an unauthenticated endpoint **[MAP GAP]**
- **What happens:** if login succeeds with `flogin` falsy, the UI withholds the token, forces a new password (regex: ≥8 chars, digit, lower, upper), and calls `POST /api/admin/resetpass` — which is `settingsController.umUpUser` mounted **without any auth middleware**: anyone who knows a userid can overwrite any local user's name/username/password/flogin.
- **Where:** route [adminRoutes.js:41](../../legacy-Codebase/LC/routes/adminRoutes.js:41); UI flow [login.jsx:95-141](../../legacy-Codebase/lc-frontend/src/pages/main/login.jsx:95); handler [settings_ctrl.js:1252-1304](../../legacy-Codebase/LC/controllers/settings_ctrl.js:1252); token withholding [controllers/login.js:44](../../legacy-Codebase/lc-frontend/src/controllers/login.js:44).
- **Disposition:** CHANGE — forced first-login reset survives; the open endpoint absolutely does not.
- **Verification idea:** new user must reset before reaching Home; reset endpoint requires proof of identity.

### B-43 Role enforcement matrix
- **What happens:** roles `user`/`admin`/`dev-admin`. Backend: settings routes require admin+ (`dev` routes dev-admin only; `poweroff`, `esget`, `disget`, `lssgetstorage` any authenticated user); `fmdelete2` admin+; record/stream/caps/lmc/ls/sd routes any authenticated user. Frontend mirrors this in the route table (confsettings admin+, `/confsettings/dev` dev-admin) and hides menu items; the Configuration Settings tile hidden for `user`, dev menu item only for dev-admin.
- **Where:** [routes/settingsRoutes.js:23-84](../../legacy-Codebase/LC/routes/settingsRoutes.js:23), [routes/adminRoutes.js:46-56](../../legacy-Codebase/LC/routes/adminRoutes.js:46), [routes/fmRoutes.js:26-34](../../legacy-Codebase/LC/routes/fmRoutes.js:26), [routes/captureSetupRoutes.js:26-30](../../legacy-Codebase/LC/routes/captureSetupRoutes.js:26); frontend [routes/index.js:14-38](../../legacy-Codebase/lc-frontend/src/routes/index.js:14), [routes/route.js](../../legacy-Codebase/lc-frontend/src/routes/route.js), [menu.jsx:146](../../legacy-Codebase/lc-frontend/src/pages/main/menu.jsx:146), [settings/index.jsx:131](../../legacy-Codebase/lc-frontend/src/pages/settings/index.jsx:131).
- **Disposition:** KEEP the three-tier model and this permission map as the baseline spec (tighten the "any user" holes deliberately).
- **Verification idea:** authorization test matrix — every endpoint × every role.

### B-44 User & admin management (CRUD, Excel bulk import)
- **What happens:** admin+ can create/update/list(paginated via `LIMIT a,b` from POST body)/count/delete local users and admins; passwords bcrypt-hashed server-side. Excel import: multer saves to `/root/src/uploads/` (excel mimetypes only), `read-excel-file` parses rows `[name, username, password]`, rejects null cells or in-file duplicate usernames, hashes passwords, bulk INSERT.
- **Where:** [settings_ctrl.js:1140-1638](../../legacy-Codebase/LC/controllers/settings_ctrl.js:1140); [middleware/upload.js](../../legacy-Codebase/LC/middleware/upload.js); UI [um.jsx](../../legacy-Codebase/lc-frontend/src/pages/settings/um.jsx).
- **Disposition:** KEEP (bulk onboarding via spreadsheet is an operator workflow) / CHANGE upload dir + validation.
- **Verification idea:** import fixture xlsx (valid, null-cell, duplicate) → same accept/reject outcomes; imported user can log in (with forced reset, B-42).

---

## G. Settings & device management

### B-45 Settings storage pattern — key/value rows per submenu
- **What happens:** all settings live in one `settings` table as `(userid, submenu, title, s_value)` rows; each submenu (es, ess, dis, fus, ss, dev, lss, sys) has a model whose `updateById` updates one title's value and `getAll` returns all rows for `userid+submenu`. Apply endpoints iterate `Object.entries(req.body)` calling updateById per key — so **only pre-existing rows can be updated; unknown keys silently no-op**, and responses resolve after the last array element regardless of individual failures. Capture setup / lmc / ls use identically-shaped separate tables. GetEs/GetFus/GetDev append a synthetic `domain` row from `UPLOAD_DOMAIN` env.
- **Where:** e.g. [models/lssSettings.js](../../legacy-Codebase/LC/models/lssSettings.js), [models/captureSetup.js](../../legacy-Codebase/LC/models/captureSetup.js); apply pattern [settings_ctrl.js:105-149](../../legacy-Codebase/LC/controllers/settings_ctrl.js:105) (repeated ~10×); domain append [settings_ctrl.js:160,491,706](../../legacy-Codebase/LC/controllers/settings_ctrl.js:160).
- **Depends on:** rows being pre-seeded in the DB (implicit schema contract — there is no seeding code in the repo).
- **Disposition:** CHANGE — typed settings with defaults; the *set* of setting keys (see per-page entries) is the contract to carry.
- **Verification idea:** settings round-trip tests per submenu; fresh-install must self-seed.

### B-46 Network settings — read live, apply, rebuild frontend **[MAP GAP — GetDis writes to DB]**
- **What happens:** `GET /disget/1` shells out (`ip addr`, `ip route`, `networkctl status`) and **writes the live values back into the settings rows** before returning them (device network truth flows OS→DB on every read). `PATCH /disapply/1` with `ipassign=='manual'` and a changed IP: writes netplan-style config via `set-ip-address`, restarts networking, then after 5 s **seds the new IP into `lc-frontend/.env`, rebuilds the React app with npm, and replaces `/var/www/ums4fe/build`** (the SPA hardcodes the backend IP at build time — B-64). RTSP camera URLs (`rtsplink`, `rtsplink2`) are stored in the same submenu and consumed at record time. UI promises "new IP available in 5 minutes" (build time on the Jetson).
- **Where:** [settings_ctrl.js:227-411](../../legacy-Codebase/LC/controllers/settings_ctrl.js:227) (apply 227-325, live-read 327-411); UI [dis.jsx:103-148,130](../../legacy-Codebase/lc-frontend/src/pages/settings/dis.jsx:103).
- **Trigger:** admin applies network settings.
- **Depends on:** systemd-networkd/netplan, npm toolchain on device, `/var/www/ums4fe`, absolute source paths `/root/src/UMS4/`.
- **Disposition:** CHANGE — static-IP configuration survives; rebuilding the frontend to change the API address must be eliminated (runtime config).
- **Verification idea:** change IP; device reachable at new IP; UI reconnects without a rebuild.

### B-47 Dev options — SD card path + upload domain rewrite env and `.env`
- **What happens:** dev-admin `PATCH /devapply/1` sets `process.env.SDCARD = sdpath` and `process.env.UPLOAD_DOMAIN = domain` **and** seds both into `LC/.env` for persistence. SDCARD feeds the USB filters (B-38, B-32) and HDD-id selection (B-51: compare against `/dev/sdb` instead of `/dev/sda` when SDCARD set). Domain feeds all LMS calls — but not `isSliit`, which is frozen at boot (B-26). `GET /devgetpaths` lists USB drives (name, devicePath, size) to help pick the SD path.
- **Where:** [settings_ctrl.js:618-743](../../legacy-Codebase/LC/controllers/settings_ctrl.js:618); UI [dev.jsx](../../legacy-Codebase/lc-frontend/src/pages/settings/dev.jsx).
- **Disposition:** CHANGE — device provisioning config survives in a config store; env-file sed does not.
- **Verification idea:** set domain, restart, uploads target new domain; SD path excluded from USB copy targets.

### B-48 Upload mode toggle writes `UPLOAD` env + `.env`
- **What happens:** FUS apply maps iu/su switches to `UPLOAD=instant|scheduled|false` in process env and `.env` (see B-30 for the instant gap). Upload windows themselves are settings rows (B-22).
- **Where:** [settings_ctrl.js:415-480](../../legacy-Codebase/LC/controllers/settings_ctrl.js:415).
- **Disposition:** CHANGE (see B-30, B-22).

### B-49 Firmware update = git reset to origin/main + rebuild + service restart
- **What happens:** `GET /fuupdate` (admin+): `simple-git` on the repo parent adds a hardcoded git identity, fetches `origin main`; if updates exist → responds "Updates Available", then `git reset --hard origin/main`, `sudo npm install` (backend), sed current IP into frontend `.env`, rebuild frontend, replace `/var/www/ums4fe/build`, `sudo service ums4server restart`. UI shows a fixed 10-minute countdown. No rollback; commented notes mention `git reset --hard HEAD^` as the manual revert.
- **Where:** [settings_ctrl.js:499-551](../../legacy-Codebase/LC/controllers/settings_ctrl.js:499); UI [fu.jsx:25-58](../../legacy-Codebase/lc-frontend/src/pages/settings/fu.jsx:25).
- **Depends on:** device has git remote credentials for the repo; `ums4server` systemd service (not in repo); internet.
- **Disposition:** CHANGE — OTA update survives as a proper release mechanism (signed artifacts, rollback); git-pull-in-place does not.
- **Verification idea:** staged update on a test device: version bump applied, service healthy after; failed update leaves device functional.

### B-50 Power off
- **What happens:** `GET /settings/poweroff` (any authenticated user) runs `sudo shutdown -h now`; always answers "Successfull" (both branches). UI confirms first (Menu page power button; Home's is commented out) and even treats request failure as success (the box is already halting).
- **Where:** [settings_ctrl.js:82-102](../../legacy-Codebase/LC/controllers/settings_ctrl.js:82); [menu.jsx:74-97,177-186](../../legacy-Codebase/lc-frontend/src/pages/main/menu.jsx:74).
- **Disposition:** KEEP — kiosk power-off from UI; CHANGE to block while recording (today nothing prevents shutdown mid-recording server-side).
- **Verification idea:** power off from UI halts device; attempt during recording is refused (new rule).

### B-51 HDD identity: `hdd_id` row + nginx root rewrite + server restart
- **What happens:** `GET /newhddid` (admin+): find the USB drive at `/dev/sda` (or `/dev/sdb` if SDCARD configured), store `(id=1, name, mountPath)` in `hdd_id`; then rewrite `/etc/nginx/sites-available/ums4fe` — `location` #4's `root` becomes the mount path (serves `/record/`, B-37) — restart nginx and restart `ums4server` itself. Everything storage-related resolves the HDD as `/media/{last-segment-of-hdd_id.value}`: recording sinks, conversion, upload, cleanup, storage gauge, file manager (5 separate copies of the same `query_promise`). **Implicit contract:** `hdd_id` has exactly one row, id=1, and the mount path's last path segment is the UUID used under `/media/`.
- **Where:** [settings_ctrl.js:968-1058](../../legacy-Codebase/LC/controllers/settings_ctrl.js:968); resolvers [index.js:143-154](../../legacy-Codebase/LC/index.js:143), [admin_ctrl.js:106-120](../../legacy-Codebase/LC/controllers/admin_ctrl.js:106), [fm_ctrl.js:22-33](../../legacy-Codebase/LC/controllers/fm_ctrl.js:22), [settings_ctrl.js:807-818](../../legacy-Codebase/LC/controllers/settings_ctrl.js:807). Note admin_ctrl resolves it **once at module load** (top-level await) — a new HDD id requires the service restart this endpoint performs.
- **Trigger:** operator after HDD swap/format.
- **Disposition:** CHANGE — storage-location registration survives as config; the restart-to-reload and nginx-conf surgery should be replaced.
- **Verification idea:** swap to a new formatted disk, register it, record + play back without manual service intervention beyond the documented flow.

### B-52 Format HDD
- **What happens:** `GET /formathdd` (admin+): one shell line — find source device of the current mount, force-unmount, `mkfs.ntfs -f`, read new UUID via blkid, `mkdir /media/$uuid`, mount, create `record/` and `record-ts/`, append an fstab entry. (NTFS on Linux; every format appends another fstab line.)
- **Where:** [settings_ctrl.js:1062-1136](../../legacy-Codebase/LC/controllers/settings_ctrl.js:1062); UI two-step guidance ("format, then Set New Hard Disk ID") [lss.jsx:97-124](../../legacy-Codebase/lc-frontend/src/pages/settings/lss.jsx:97).
- **Disposition:** CHANGE — disk reset workflow survives; filesystem choice, fstab accumulation, and the manual two-step (format → new id) should be one safe operation.
- **Verification idea:** format+register on test hardware; device records immediately after; fstab has exactly one entry for the disk.

### B-53 Storage gauge
- **What happens:** `GET /lssgetstorage` (any user) returns raw `df --output=size,avail,pcent` for the HDD; Home and LSS pages parse it, show percent used, and Home warns at >70 % that files auto-delete at 80 % (matching B-20's hardcoded threshold).
- **Where:** [settings_ctrl.js:821-845](../../legacy-Codebase/LC/controllers/settings_ctrl.js:821); [home.jsx:240-251,1050-1053](../../legacy-Codebase/lc-frontend/src/pages/main/home.jsx:240); [lss.jsx:41-50](../../legacy-Codebase/lc-frontend/src/pages/settings/lss.jsx:41).
- **Disposition:** KEEP (capacity visibility + warning tied to the retention policy).
- **Verification idea:** thresholds in UI match the actual cleanup policy config.

### B-54 SSID list (DB-only)
- **What happens:** `POST /ssidnew` inserts an SSID row (via `disSettings.create`); `GET /ssidget` lists them. The Wi-Fi UI that used them is fully commented out; **no nmcli or any wireless command exists in the codebase** — **[MAP GAP]** the map's section 6 claims "SSID via nmcli"; that is not in this code.
- **Where:** [settings_ctrl.js:911-964](../../legacy-Codebase/LC/controllers/settings_ctrl.js:911); dead UI [dis.jsx:236-266](../../legacy-Codebase/lc-frontend/src/pages/settings/dis.jsx:236).
- **Disposition:** DROP unless Wi-Fi provisioning is a real roadmap item.

### B-55 Inert settings pages (stored but no effect) **[MAP GAP — map §6 overstates]**
- **What happens:** several documented "device management" behaviors do not exist in code:
  - **Display settings (`xrandr`)** — no xrandr anywhere; nothing OS-level under any settings page touches displays.
  - **Volume (`loudness`/amixer)** — `loudness` is only a package.json dependency; never imported. Audio gain sliders (Capture Setup) store `audio1_gain`/`audio2_gain` and ShellStart reads them into exported vars `ampval_mic`/`ampval_hdmi` — which nothing consumes; pipelines have no volume elements. **Gain sliders are placebo.**
  - **NTP/time** — Sys page timezone/date/time pickers only `console.log`; only `dl` (device location) is saved. License panel ("Genuine", "265 Days") is hardcoded JSX.
  - **Schedule Settings (`ss`)** and **Eduscope Stream Settings (`ess`)** and **UAC/UVC (`us.jsx`)** — plain settings CRUD (or, for `us`, a stub not even routed); no consumer of `ss`/`ess` values exists in the backend.
- **Where:** [sys.jsx:29-31,107-129](../../legacy-Codebase/lc-frontend/src/pages/settings/sys.jsx:29); gains [admin_ctrl.js:127-128,166-167](../../legacy-Codebase/LC/controllers/admin_ctrl.js:166), [captureSetup.jsx:1053-1056](../../legacy-Codebase/lc-frontend/src/pages/main/captureSetup.jsx:1053); [ss.jsx](../../legacy-Codebase/lc-frontend/src/pages/settings/ss.jsx), [ess.jsx](../../legacy-Codebase/lc-frontend/src/pages/settings/ess.jsx), [us.jsx](../../legacy-Codebase/lc-frontend/src/pages/settings/us.jsx).
- **Disposition:** DROP the placebo UIs, or CHANGE into real features (audio gain especially — users believe it works). Product call.
- **Verification idea:** if audio gain becomes real: recorded loudness varies with slider; else assert control removed.

### B-56 Encoder settings actually honored: bitrate + per-stream framerates only
- **What happens:** of the `es` settings, `bitrate`, `frpresentation`, `frpresenter` are substituted into pipelines. `resolution` is read and mapped to width/height vars that are **never used** (pipelines hardcode 1920×1080); `vcs`/`profile`/`fformat` are disabled in UI and hardcoded in pipelines (h264, profile=4, mpegts).
- **Where:** [admin_ctrl.js:152-163](../../legacy-Codebase/LC/controllers/admin_ctrl.js:152); UI [es.jsx:96-153](../../legacy-Codebase/lc-frontend/src/pages/settings/es.jsx:96).
- **Disposition:** KEEP bitrate/framerate as user-facing encoder knobs; DROP or implement the dead ones explicitly.
- **Verification idea:** change bitrate/framerate; probe output file matches.

### B-57 Device enumeration endpoints
- **What happens:** `GET /caps/getdevices/:type` runs `v4l2-ctl --list-devices` and returns cleaned device names (same parser as the watchdog; note `req.params.types = 'video'` is an assignment, so the branch is always taken). `lmc_ctrl.GetDevices`/`ls_ctrl.GetDevices` use node-webcam to capture a test picture (not obviously routed/used by current UI — capture-setup audio dropdown uses browser `enumerateDevices` device ids instead, which ShellStart compares against two **hardcoded** 64-hex device-id strings to pick presentation vs presenter audio, then never uses the result).
- **Where:** [capture_setup_ctrl.js:64-96](../../legacy-Codebase/LC/controllers/capture_setup_ctrl.js:64); [admin_ctrl.js:179-180](../../legacy-Codebase/LC/controllers/admin_ctrl.js:179); [lmc_ctrl.js:66-156](../../legacy-Codebase/LC/controllers/lmc_ctrl.js:66), [ls_ctrl.js:66-156](../../legacy-Codebase/LC/controllers/ls_ctrl.js:66); [captureSetup.jsx:1034-1036](../../legacy-Codebase/lc-frontend/src/pages/main/captureSetup.jsx:1034).
- **Disposition:** CHANGE — device discovery survives; hardcoded browser-device-id matching and node-webcam stubs DROP.

---

## H. Live streaming

### B-58 Stream start/stop = rewrite nginx RTMP conf + restart services *[Map rule 11 — confirmed + one nuance]*
- **What happens:** `POST /startstream` receives an array of RTMP URLs, rewrites `/etc/nginx/nginx.conf`'s `rtmp { server { application live } }` block: removes the application, re-adds `live on; record off;`, adds one `push <url>` per target — any URL starting with `"FB"` is rewritten to `rtmp://127.0.0.1:1936/rtmp/<url>` (stunnel4 bridges to Facebook's rtmps). Then `systemctl restart nginx` and `systemctl restart stunnel4.service`. `GET /stopstream` rewrites the block with no pushes and restarts **nginx only** (stunnel left running — nuance the map omits). The recording pipeline always pushes to `rtmp://localhost/live`, so streaming is purely a matter of which push targets nginx relays to.
- **Where:** [admin_ctrl.js:1182-1276](../../legacy-Codebase/LC/controllers/admin_ctrl.js:1182); FB rewrite at 1203.
- **Trigger:** stream toggle on Home (B-16) or LS page.
- **Depends on:** nginx-rtmp module, `/etc/nginx/nginx.conf` structure, stunnel4 config (not in repo), passwordless sudo.
- **Disposition:** CHANGE — multi-platform restreaming survives; conf-file surgery + full nginx restarts (which also briefly interrupt `/record/` serving and the SPA) should move to a controllable relay.
- **Verification idea:** enable YT+FB targets; verify push URLs land (FB via stunnel); stop; conf back to no-push; recording unaffected throughout.

### B-59 Stream platform configuration (fb/yt/twt/lkd)
- **What happens:** LS settings store per-platform enable flags and RTMP URLs (`fb`,`fb_rtmp`,`yt`,`yt_rtmp`,`twt`,`twt_rtmp`,`lkd`,`lkd_rtmp`, plus layout/source fields shared with the pipeline matrix). Home assembles `rtmpVal` from every enabled platform at page load.
- **Where:** [home.jsx:281-300](../../legacy-Codebase/lc-frontend/src/pages/main/home.jsx:281); [ls.jsx:356-359,1066-1078](../../legacy-Codebase/lc-frontend/src/pages/main/ls.jsx:1066); model [models/ls.js](../../legacy-Codebase/LC/models/ls.js).
- **Disposition:** KEEP.
- **Verification idea:** enable/disable platforms; started stream pushes exactly the enabled set.

### B-60 Quick-preset system on Home
- **What happens:** Home offers preset tiles (Capture: 50-50 / SBS / Single / Separate; LMC and LS: 50-50 / SBS / SingleC1 / SingleC2). Apply writes fixed source/layout combos (hardcoded to `hdmisource`/`rtsp`/`rtsp2`) into the capture-setup, LS, then LMC tables sequentially, then reloads settings. While paused, switching capture preset away from Separate Files is blocked (pause must resume into the same file layout).
- **Where:** [home.jsx:685-854,974-1028](../../legacy-Codebase/lc-frontend/src/pages/main/home.jsx:685); disabled logic at 976-985.
- **Disposition:** KEEP (one-tap room presets are the primary UX) / CHANGE the hardcoded source assumptions to room profiles.
- **Verification idea:** apply each preset; subsequent record start selects the intended pipeline family; preset switching blocked mid-pause.

---

## I. Cross-cutting contracts

### B-61 Serving topology: SPA + API + sockets + recordings all behind nginx on :3000 **[MAP GAP]**
- **What happens:** the frontend builds `http://{REACT_APP_SERVER_IP}:3000/api/...` for REST, `:3000` for Socket.IO, and `:3000/record/...` for media — but the backend listens on **5000** (`APP_PORT`). An nginx site (`/etc/nginx/sites-available/ums4fe`, not in repo) must terminate :3000, serve the SPA build from `/var/www/ums4fe/build`, proxy `/api` and websockets to :5000, and serve `/record/` from the HDD (B-51). The backend IP is baked into the SPA at build time (hence rebuilds in B-46/B-49).
- **Where:** [lc-frontend/src/controllers/Config.js:8-9](../../legacy-Codebase/lc-frontend/src/controllers/Config.js:8); socket URLs [home.jsx:221](../../legacy-Codebase/lc-frontend/src/pages/main/home.jsx:221), [fm.jsx:117](../../legacy-Codebase/lc-frontend/src/pages/main/fm.jsx:117); backend port [index.js:73](../../legacy-Codebase/LC/index.js:73), [.env](../../legacy-Codebase/LC/.env).
- **Disposition:** CHANGE — single-origin serving survives; build-time IP baking does not.
- **Verification idea:** deploy on a fresh device; UI, sockets, and playback all work relative to whatever host the browser used.

### B-62 Implicit MySQL schema contract
- **What happens:** no migrations/DDL exist in the repo. Tables referenced by code: `record_status` (single row, unique `record`), `video_queue` (id auto-inc — consecutive-id assumption B-25; status enum-by-convention: waiting/uploading/done/failed/nofile/`deleted(sys)`/`deleted(<uid>)`; converted flag; groupid; pauseval; videoid; duration), `settings` (userid+submenu+title+s_value, pre-seeded rows required), `capture_setup`-like tables for cs/lmc/ls, `hdd_id` (id=1), `users` (flogin column), `instituteusers` (unique username), `admins`, and — used only by GPIO scripts — `indicators` (**[MAP GAP]** `switchsql.py` INSERTs `(name,value)` rows like `('cambtn','H')` for a 4-way camera-switch button; no reader exists in this repo). `models/ledstatus.js` references `led_status`/`lmc` but is imported nowhere (dead). Root DB password is hardcoded in [config/index.js:17](../../legacy-Codebase/LC/config/index.js:17) and duplicated in the Python scripts (one of them with a *different* password — `ums8fhd` vs `Ums8fhd!`).
- **Where:** [LC/models/*](../../legacy-Codebase/LC/models), [bashfiles/switchsql.py:56-116](../../legacy-Codebase/LC/bashfiles/switchsql.py:56), [bashfiles/recpress.py:24-38](../../legacy-Codebase/LC/bashfiles/recpress.py:24).
- **Disposition:** CHANGE — schema becomes explicit migrations; status-string conventions become enums/columns; `indicators` consumer must be located or the table dropped.
- **Verification idea:** fresh-install migration produces every table the code touches; data migration script validated against a production DB dump.

### B-63 SQL injection surface *[Map §4 note — confirmed everywhere]*
- **What happens:** nearly all queries interpolate request data directly (`record_status` upserts with module/topic strings, `video_queue` filenames, `users.findByUsername`, settings updates, `LIMIT ${limit[0]},${limit[1]}` from the request body, etc.). Since module/topic are free text from the kiosk UI, a quote in a topic breaks recording bookkeeping even non-maliciously.
- **Where:** representative: [admin_ctrl.js:1044,1129](../../legacy-Codebase/LC/controllers/admin_ctrl.js:1044); [models/users.js:14,59,76](../../legacy-Codebase/LC/models/users.js:14); [models/videoQueue.js:47,106,131](../../legacy-Codebase/LC/models/videoQueue.js:47).
- **Disposition:** DROP — parameterized queries everywhere in rewrite.
- **Verification idea:** record with topic `O'Brien; DROP TABLE--` → everything works.

### B-64 CORS / body limits / busboy
- **What happens:** API is fully open CORS (`*`), 30 MB JSON body limit, connect-busboy mounted globally with 2 MiB buffer (only multer is actually used for uploads).
- **Where:** [index.js:42-55](../../legacy-Codebase/LC/index.js:42).
- **Disposition:** CHANGE — lock to same-origin; busboy DROP.

---

## Needs human confirmation

Things the code depends on that are not in the repository, plus product questions raised above:

1. **nginx site config** `/etc/nginx/sites-available/ums4fe` and main `/etc/nginx/nginx.conf` (rtmp block) — exact proxy map :3000→:5000, `/record/` location index (code assumes `location[4]`, [settings_ctrl.js:1018](../../legacy-Codebase/LC/controllers/settings_ctrl.js:1018)), websocket proxying. B-37, B-51, B-58, B-61 all hinge on it.
2. **udev rules / ALSA config** creating `/dev/presentation`, `/dev/presenter`, `/dev/exCAM`, `hw:externAud`, `hw:channel1` (map rule 9) — not in repo; needed to reproduce pipeline behavior on new hardware.
3. **systemd units**: `ums4server` (backend), whatever launches `hi.sh`/`recpress.py` and possibly `switchsql.py`/`recblink` at boot; sudoers entries granting passwordless `killall`, `uhubctl`, `systemctl`, `shutdown`, `mkfs`.
4. **stunnel4 configuration** for Facebook rtmps bridging (B-58).
5. **LMS `external_service.php` contract** — response shapes for `add_video`, `video_file_upload`, `video_upload_complete`, `delete_video`/`delete_lecture`, `full_login_list`, `full_module_list`, `full_lecture_hall_list`; whether `full_login_list` passwords are md5 digests (B-21/B-40 assume so); validity of the two hardcoded API keys.
6. **Database dump / seed** — the `settings` rows (and their order, which B-22 depends on), `capture_setup`/`lmc`/`ls` seed rows, `admins` root account, and whether an `indicators` reader exists elsewhere (B-62).
7. **Production `.env` values** — real `UPLOAD_DOMAIN`, `UPLOAD`, `SDCARD` per site (repo copy has uploads disabled).
8. **Product decisions**: is the physical record button (B-13) and 4-way camera switch (`switchsql.py`, B-62) live hardware in deployed rooms? Should "instant upload" (B-30), auto-shutdown-after-upload (B-29), Wi-Fi provisioning (B-54), and the placebo audio-gain/display/time settings (B-55) be implemented or dropped?
9. **EZ-Cap hub topology** — is `uhubctl -l 2-1 -p 2` correct on all deployed units, or per-unit (B-39)?
10. **`~2~cmb.ts` upload behavior** (B-25 gap) — confirm with operators whether paused dual recordings ever produced duplicate LMS entries in production; affects the D-02b contract.
