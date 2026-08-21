# Pipeline-Manager Remediation Plan

Shared context for a batched fix of the Workstream-A review findings
(A-REV-001 … A-REV-019). Read this once; every fix session references it so it
never has to re-derive the codebase.

- **Target code:** `services/pipeline-manager/` (identical on `main` and
  `sonnet5/workstream-a-pipeline-manager`; Workstream A is merged to `main`).
- **Work branch:** `fix/pm-remediation`, cut from `main` (see §6).
- **Test environment:** Arch Linux for Tiers 1–2 + GStreamer-with-test-sources;
  RK3588 board only for Tier 3 evidence (A-15/A-16).
- **Rule:** we do **not** re-architect. The code is already ports-and-adapters.
  We *write the real coordinator logic behind the existing seams* and *add a
  production factory that injects real adapters*. No-op defaults stay for
  hermetic cross-platform unit tests.

---

## 1. The core idea — three tiers + one adapter seam

Every finding is stubbed as "board-only" but actually falls in one of three
tiers. Only Tier 3 truly needs the RK3588.

| Tier | What it is | Where it runs | How we test it |
|------|-----------|---------------|----------------|
| **1** | Pure logic: argv strings, path validation, request validation | Any OS (even Windows) | plain unit tests |
| **2** | Process orchestration: spawn/monitor/restart/stop, `/proc`, `killpg`, AF_UNIX | Linux kernel + **fake child** | Arch: real `subprocess.Popen` of a harmless child (`sleep`, tiny py script) |
| **3** | Real media/hardware: encoders, cameras, HDMI, ALSA, latency | RK3588 board | board evidence gates only |

**The seam already exists.** `create_app()` in `app.py` wires injectable
callables with no-op defaults:

```
create_app(settings, *, popen=None)          # app.py:163 — injectable Popen
app.state.start_publisher   = _noop_...       # app.py:200 — returns None (NO-OP)
app.state.preflight_source  = _no_preflight_  # app.py:201
app.state.proc_scanner      = _default_proc_  # app.py:198
app.state.expected_processes= _default_...    # app.py:199
app.state.flush_sidecars    = lambda: None    # app.py:202
app.state.audio_exec        = _default_audio_ # app.py:240 — returns rc=1
app.state.watchdog.probe    = _default_probe  # app.py:212 — returns rc=1
```

The gap the review found: **the seam is present but the real thing you'd inject
was never written** (`start_publisher` is a no-op regardless of `popen`), and
**there is no production factory** that injects real adapters (the Uvicorn
command has nowhere to point).

### The swap mechanism (this answers "how do I test on Arch vs board")

We keep the no-op default, and add **two** things:

1. **Real coordinator logic** (Tier-1/2) — written once, testable with fakes.
2. **A production factory** that injects real adapters (Tier-3 thin wrappers).

```python
# NEW real coordinator (Tier-2 logic; uses only injected deps, so fakeable):
async def start_publisher(controller, *, supervisor, events):
    argv    = select_publisher_builder(controller.binding).build()   # Tier-1 pure
    managed = await supervisor.start(argv, ...)      # uses injected popen
    await confirm_health(managed, ...)
    controller.mark_online(managed.pid)
    events.publish("evt.pm.publisher.running", ...)
    spawn_exit_monitor(managed, controller)          # Tier-2 restart loop

# NEW production factory (Tier-3 real adapters; what Uvicorn points at):
def create_production_app(settings):
    app = create_app(settings, popen=subprocess.Popen)   # real spawn
    app.state.start_publisher  = partial(start_publisher, supervisor=app.state.supervisor, events=app.state.events)
    app.state.preflight_source = real_preflight           # real gst-inspect
    app.state.proc_scanner     = real_proc_scanner        # real /proc read
    app.state.audio_exec       = real_amixer_exec         # real amixer subprocess
    app.state.watchdog.probe   = real_v4l2_probe          # real v4l2-ctl
    app.state.flush_sidecars   = real_flush_sidecars
    return app
```

**Four test levels, same code, different injected argv/adapter:**

| Level | Inject | Runs on | Proves |
|-------|--------|---------|--------|
| Unit | pure fake supervisor/clock | any OS | decision logic, event order, backoff timing |
| Integ-A | real `Popen` of `sleep`/py child | **Arch** | real PGID, `killpg`, `/proc` adoption, EOS→SIGKILL timing |
| Integ-B | real `gst-launch-1.0` + `videotestsrc`/`audiotestsrc` | **Arch** | pipelines parse & run, file grows, PNG valid, placeholder switch |
| Board | real cameras/HDMI/ALSA/hw-encoders | **RK3588** | latency, quality, enumeration (A-15/A-16 evidence) |

So "swap the stub" = **choose which argv/adapter you inject**. On Arch you inject
a fake child or `videotestsrc`; on the board you inject real `gst-launch` +
real device probes. The coordinator code is identical.

---

## 2. Batches (execute in order — later batches depend on earlier)

Each batch = one focused session = one commit on `fix/pm-remediation`.
Order follows the reviewer's remediation sequence (safety → core → ownership →
recovery → workers → peripherals).

### B1 — Safe output paths + request validation  (Tier 1)
- **Findings:** A-REV-002, A-REV-016.
- **Files:** `models.py` (`resolve_output_path` :167), `api/routes.py`
  (`start_record` :209, validation :85), `pipelines/snapshot.py` (:30),
  `app.py` (exception registration :32/168).
- **Do:** call `resolve_output_path` from every record/snapshot route *before*
  registry insert or spawn; make it symlink-aware (resolve root + parent, reject
  root itself, validate each `outputPaths` entry); register `UnsupportedPipeline`,
  `InvalidStreamKey`, `ValueError` in `DOMAIN_EXCEPTIONS`; add a
  `RequestValidationError` → Problem handler.
- **Tests (any OS):** relative path, `/etc/...`, `..`, duplicate targets, a
  symlink inside root pointing out, snapshot `.tmp` escape → assert **no child
  spawned** and Problem-shaped 4xx.
- **Done:** every unsafe path is rejected at the boundary; Pydantic errors return
  the Problem shape.

### B2 — Real publisher lifecycle + lifespan wiring  (Tier 2) ← the heart
- **Findings:** A-REV-001, A-REV-011.
- **Files:** `app.py` (seams :90–:205, `_run_startup` :98), `api/routes.py`
  (publisher start/stop :165, status :478), `publishers/base.py` (:176),
  `supervisor/process.py` (:64), `pipelines/builder.py` selection.
- **Do:** write `start_publisher` / `stop_publisher` coordinators (select
  USB/RTSP/audio builder from binding → `supervisor.start` → `confirm_health` →
  `controller.mark_online(pid)` → publish `evt.pm.publisher.*`); add
  `create_production_app()` that injects real adapters; make `/status` return the
  real shape core-api expects (publisher PIDs, consumer kind/output/pgid/state);
  return `202` immediately then resolve via events (async command coordinator
  with per-identity locks).
- **Tests:** Unit with fake supervisor (accepted-before-health, event order,
  idempotent stop). **Integ-A on Arch** with a fake child: bind+start all four
  publishers over HTTP → assert distinct real PIDs, health-driven state, cleanup.
- **Done:** a fake-child instance goes bind → start → running → stop over HTTP,
  with truthful `/status` and events.

### B3 — Transactional ownership: exit monitor, failed-start cleanup, bounded stop  (Tier 2)
- **Findings:** A-REV-004, A-REV-005, A-REV-006.
- **Files:** `supervisor/process.py` (:64/:81), `consumers/base.py` (:77 spawn,
  :95 stop, :111 on_unexpected_exit), `consumers/record.py` (:65),
  `supervisor/stop.py` (:41), `api/routes.py` (stop :395).
- **Do:** one waiter task per child that distinguishes requested vs unexpected
  exit, releases ownership exactly once, emits `evt.pm.consumer.exited/failed`,
  delegates restart (1/3/8 s backoff, max 3 per rolling 120 s) to a coordinator;
  on post-spawn confirm failure → targeted-kill + wait + close pipes + cancel
  readers + drop registry + release ledger; single monotonic EOS+exit deadline
  with per-controller lock and idempotent terminal stop.
- **Tests:** Unit (backoff timing with fake clock, budget exhaustion, sibling
  isolation, confirm-timeout cleanup). **Integ-A on Arch:** kill a real fake
  child → assert fresh PID, event sequence, PGID isolation; EOS-seen-never-exits
  → SIGKILL at deadline; concurrent double-stop.
- **Done:** unexpected exits are detected and handled; no leaked child/pipes/ledger
  on failed start; stop can't hang or hit a stale PGID.

### B4 — Sidecars + orphan adoption  (Tier 2)
- **Findings:** A-REV-007.
- **Files:** `supervisor/recovery.py` (`write_sidecar` :41), `app.py`
  (`_run_startup` :104, `_run_shutdown` :134, seams :198/:202).
- **Do:** make sidecar write/remove part of supervisor ownership (on every spawn);
  implement `real_proc_scanner` (`/proc/<pid>` identity match) and
  `real_expected_processes`; reconstruct adopted controllers into supervisor
  state with an explicit `adopted` flag; shutdown skips only the *actively
  adopted* record, not every `record:*`.
- **Tests:** **Integ-A on Arch:** start a record (fake child), simulate manager
  restart with child alive, adopt from real `/proc`, expose truthfully in
  `/status`, stop safely; foreign / PID-reused children stay untouched.
- **Done:** a restarted manager adopts its live recording; `flush_sidecars` is real.

### B5 — Consumer workers: source-loss placeholder, snapshot, projector, thumbnail  (Tier 2 → 3)
- **Findings:** A-REV-003, A-REV-010, A-REV-009, A-REV-008.
- **Files:** `pipelines/builder.py` (:81 source_branch), `pipelines/record.py`
  (:71), `pipelines/meeting.py` (:27/:76), `pipelines/snapshot.py` (:30/:63
  `publish_snapshot`), `pipelines/projector.py` (:45), `pipelines/thumbnails.py`
  (:113/:129 worker), `consumers/{projector,thumbnails}.py`, `api/routes.py`
  (:378).
- **Do:** add fallback source + selector branches for each required video/audio
  role, switch on debounced publisher health, keep mux TS continuous; snapshot →
  worker/`multifilesink` callback that writes one tmp PNG, fsyncs, atomically
  renames, repeats (call `publish_snapshot`); projector/thumbnail → real
  long-running GStreamer worker owning selectors/overlay + JSON control transport
  + SDP/ICE loop, supervised.
- **Tests:** Static argv/graph asserts (any OS). **Integ-B on Arch** with
  `videotestsrc`/`audiotestsrc`: disconnect a source → file keeps growing, PGID
  unchanged, placeholder frames + silent audio, clean EOS; ≥3 valid decodable
  PNGs; projector mode switch changes frame with unchanged PGID; fake-worker
  WebRTC signaling + crash cleanup.
- **Done:** these paths produce real output on Arch with test sources (board only
  validates latency/quality later).

### B6 — Peripherals + parity: audio, watchdog, fps, argv parity, bench scripts  (mixed)
- **Findings:** A-REV-012, A-REV-013, A-REV-014, A-REV-018, A-REV-015.
- **Files:** `audio/levels.py` (:12), `app.py` (audio :237, watchdog :212),
  `hardware/watchdog.py` (:57), `pipelines/profiles.py` (:113),
  `pipelines/builder.py` (:113), `pipelines/{record,live}.py`,
  `publishers/{usb,rtsp,audio}.py` (:8/:18/:8), `hardware/helper_client.py`
  (:102), `scripts/bench/*.sh`.
- **Do:** argv-only async `amixer` adapter + RMS meter tap → ≤10 Hz events, drain
  subs on shutdown; argv-only `v4l2-ctl` probe, call `confirm_recovery` right
  after a cycle, publish transitions, don't swallow errors; thread effective FPS
  into normalization/canvas caps; match publisher argv to the proven oracles
  (`io-mode=mmap`, `do-timestamp=true`, leaky bounded queues, `sync=false`,
  `config-interval=-1`) with golden tests; bounded `readuntil` + `wait_closed`
  in helper client; align bench scripts to the real `/status`/CLI and make the
  ledger/thumbnail assertions actually exercise state.
- **Tests:** golden argv comparisons (any OS); loop-level watchdog test (fake
  v4l2) for miss→recovering→present timing + budget; audio apply/readback +
  cadence with injected subprocess/meter; helper over-limit-no-newline test.
- **Done:** peripherals work with fakes; argv matches oracles; fps reaches argv;
  bench scripts fail honestly when capacity/refusal isn't exercised.

### (later, on the board) — A-15 / A-16 / B-38 evidence
Not part of this remediation. After B1–B6 land and pass on Arch, run the bench
gates on the RK3588 and fill the evidence templates. B-38 (core-api gate) stays
closed until A's hardware gate + the encoder-ingress flag close.

---

## 3. Arch Linux setup (one-time)

```bash
sudo pacman -S --needed python python-pip gstreamer gst-plugins-base \
  gst-plugins-good gst-plugins-bad gst-plugins-ugly gst-libav \
  v4l-utils alsa-utils ffmpeg jq gobject-introspection cairo pkgconf
# per-service venv:
cd services/pipeline-manager
python -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]'      # builds PyGObject + pycairo into the venv itself
```

The snapshot/projector/thumbnails workers are real PyGObject (`gi`)
processes spawned via `sys.executable` — i.e. this venv's own Python.
`PyGObject` is declared as a normal dev dependency in `pyproject.toml` and
builds from source against the system's GObject-introspection typelibs
(`gobject-introspection`/`cairo`/`pkgconf` from the pacman line above), so a
plain `python -m venv .venv && pip install -e '.[dev]'` is self-sufficient —
**no `pyvenv.cfg` editing, no `include-system-site-packages` flag, nothing to
redo when the venv is recreated.** (An earlier draft of this doc worked
around a missing PyGObject by flipping `include-system-site-packages` to
`true` and pulling in the system package instead; that flag isn't
git-tracked and resets on every `python -m venv .venv`, so it silently broke
again on each fresh checkout — the worker subprocess would die on `import
gi` before ever printing `PLAYING`, surfacing only as a confusing
`ConfirmTimeout: no PLAYING observation before T-START-CONFIRM` in the
parent. Installing PyGObject as a real pip dependency removes the footgun
entirely.)

Sanity checks (prove Tier-2/3-on-Arch works before writing fixes):

```bash
gst-launch-1.0 videotestsrc num-buffers=30 ! videoconvert ! fakesink   # GStreamer OK
python -c "import os,signal; print(os.setsid, signal.SIGKILL)"          # POSIX PGID OK
gst-inspect-1.0 x264enc >/dev/null && echo "sw encoder present"         # test-source encode
python -c "import gi; gi.require_version('Gst','1.0'); from gi.repository import Gst; Gst.init(None); print('PyGObject OK')"
```

Notes:
- Arch ≈ the production Ubuntu for Tiers 1–2 (same kernel APIs, same GStreamer).
  Package names differ; the orchestration logic is identical.
- Use **software** elements on Arch (`x264enc`, `videotestsrc`). The RK3588
  hardware elements (`mpph264enc`, real `v4l2` cams, HDMI, the ALSA card) are the
  only Tier-3-exclusive pieces.

---

## 4. Which OS to boot

| Task | Boot |
|------|------|
| Read/plan/write code, Tier-1 unit tests, git, PRs | Windows **or** Arch |
| Run the pytest suite fully (POSIX tests un-skip), any process/`/proc`/`killpg` test | **Arch** |
| Integ-A (fake child) and Integ-B (real GStreamer test sources) | **Arch** |
| Final media/latency/device validation, A-15/A-16 evidence | **RK3588 board** |

Practical rhythm: **do a whole batch's edits + Tier-1 tests on Windows if you
like, then boot Arch to run the full suite + integration tests before you commit.**
Don't commit a batch until its Arch tests pass.

---

## 5. Definition of done per batch
1. Real logic written behind the existing seam (no-op default kept).
2. Production adapter added/injected via `create_production_app` (where relevant).
3. Unit tests (fakes) green on any OS.
4. Integration tests green on **Arch**.
5. `pytest -q` clean on Arch (POSIX skips now run); no new `skipif(win32)` beyond
   the documented set.
6. One commit, conventional message, pushed; PR opened.

---

## 6. Git workflow

Workstream A is already in `main`; the reviewed code lives there. Do **not**
merge the open `sonnet5/workstream-b-core-api` branch first — it's independent.

```bash
# from a clean tree:
git checkout main
git pull                                   # if a remote is tracked
git checkout -b fix/pm-remediation
git add docs/plans/pm-remediation.md
git commit -m "docs(pm): remediation plan for A-REV findings"

# one commit per batch:
#   … make B1 edits, test on Arch …
git add -A && git commit -m "fix(pm): enforce safe output paths + Problem validation (B1)"
#   … B2 …  git commit -m "feat(pm): real publisher lifecycle + production factory (B2)"
#   … etc through B6 …
git push -u origin fix/pm-remediation
```

Then open a PR `fix/pm-remediation → main`. Options:
- **Simplest:** one branch, six commits, one PR.
- **Independent review:** stack six PRs (B1 → B2 → …), each merging into the
  previous. More overhead; only if reviewers want small PRs.

**Core-api coupling:** these fixes are pipeline-manager-only. Core-api already
implements the consumer side (`evt.pm.consumer.running/failed/eos/exited` in
`domain-bus.ts`, client in `modules/recording/pm/`). Conform pipeline-manager's
events/`/status` to the **shared contract** (source of truth), not to core-api's
current stub-shaped `pm/types.ts`. After `fix/pm-remediation` merges to `main`,
rebase `sonnet5/workstream-b-core-api` on the new `main` and fix any status-field
drift there (that's core-api's job, a separate PR).
