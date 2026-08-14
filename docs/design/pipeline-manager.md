# Pipeline Manager — Service Design (Phase-3, prompt 10)

> Phase-3 design artifact. Formalizes the media-pipeline service that replaces the
> legacy 161 hardcoded `gst-launch` strings (`revamp-guide/reference/pipeline-audit.md`)
> with a supervised, typed pipeline builder.
>
> **Inputs this document builds on** — the audit + proven consolidation strategy
> ([pipeline-audit.md §4](../../revamp-guide/reference/pipeline-audit.md)); the proven
> `scripts/bash` set (shm publishers, `_layout.sh` ratio geometry, passthrough +
> composite recorders, display previews, live chain, `check_live.sh` preflight); the
> proto-supervisor [`scripts/python/eduscope_web.py`](../../scripts/python/eduscope_web.py);
> the confirmed hardware ([ADR-014](../adr/ADR-014-hardware-av-io-topology.md),
> A-06 Radxa ROCK 5 ITX+ / RK3588; [hardware-topology.md](../../revamp-guide/reference/hardware-topology.md));
> the pipeline runtime decision ([ADR-015](../adr/ADR-015-pipeline-architecture-runtime.md),
> A-05/A-13); the [RECORDING & HEALTH state machines](state-machines.md) whose side
> effects this service implements; and the [behavioral inventory](../discovery/behavioral-inventory.md)
> (B-xx). Traceability ids (A-xx / B-xx / R-xx / HL-xx / CH-xx / T-xx / INV-xx / PF-xx /
> INT-xx) point at those sources.
>
> **Two hard rules govern this document (§0.3):**
> 1. **No `gst-launch` string, element chain, or pipeline fragment appears outside
>    the builder design (§2).** Everything else — process model, API, budget,
>    failures, migration — speaks in terms of *consumer classes* and *element roles*,
>    never literal pipelines.
> 2. **Every behavioral-inventory item touching capture / LED / watchdog maps to a
>    section** (coverage table in §0.4).
>
> **This document ends at a STOP gate (§7): review by the architect (user) AND the
> pipeline engineer before any code.**

---

## 0. Scope, boundaries, conventions

### 0.1 What this service owns — and what it does not

`pipeline-manager` is a headless, localhost-only **Python + FastAPI** service
([ADR-015](../adr/ADR-015-pipeline-architecture-runtime.md), A-13) that evolves
`eduscope_web.py`. It is the **truth** for media-process runtime and the **projection
source** for source/capture-card health. It owns exactly:

| Owns | Does **not** own |
|---|---|
| Spawning/stopping GStreamer **publishers** (one per physical input → shm socket) | Recording *state* (`LectureSession.state`) — core-api is the single writer (SM-R-1) |
| Spawning/stopping **consumers** (record / live / meeting / projector / thumbnails / snapshot) | Session identity, titles, filenames, manifests (A-07; core-api hands the manager an opaque output path) |
| **PID ownership** (process groups), health confirmation, restart policy, EOS-aware stop | The upload queue, retention, merge (1b/3a machines — core-api) |
| The **pipeline builder** + **platform plug** (element selection for RK3588) | Storage-pressure decisions (5b — core-api owns the probe; the manager only reports bytes-written growth) |
| **Source/capture-card health telemetry** → `evt.pm.*` events | The AI tools (STT / OCR / question-service) — a **separate** `ai/` service (they leave `eduscope_web.py` here, §6) |
| The **record-LED** GPIO and the **capture-card watchdog** (device-facing hardware) | nginx-rtmp / stunnel4 relay config (streaming-relay design, prompt 11) |

The manager is the **L2 truth** in `target-architecture.md`; core-api projects its
telemetry into `PhysicalInput.presenceState` and the panel (SM-R-1, HL machine).

### 0.2 Source vocabulary (fixed — A-08 amended)

Four physical inputs, four shm sockets, unchanged from the proven scripts
([ADR-014](../adr/ADR-014-hardware-av-io-topology.md)):

| Role | Publisher id | shm socket | Wire format on the socket |
|---|---|---|---|
| `pc` (laptop HDMI via USB dongle, A-18) | `usb` | `/tmp/usb.sock` | raw NV12 1080p60 |
| `cam1` (lecturer IP cam, RTSP) | `rtsp` | `/tmp/rtsp.sock` | **H.264 byte-stream, not decoded** |
| `cam2` (student IP cam, RTSP) | `rtsp2` | `/tmp/rtsp2.sock` | H.264 byte-stream, not decoded |
| `mic-lecture` (single lecturer mic; room mic removed) | `audio` | `/tmp/audio.sock` | S16LE 48 kHz stereo |

The socket carrying cameras as **compressed** byte-stream is load-bearing for the
whole budget (§4): a publisher captures each camera **once** and never decodes;
decode happens only inside consumers that need pixels.

### 0.3 The no-`gst` rule (rule 1)

Pipeline text is a **build artifact**, not architecture. It exists only in §2 (the
builder and its three rendered examples). Sections 1, 3, 4, 5, 6 refer to:

- **consumer classes**: `record`, `live`, `meeting`, `projector`, `thumbnails`,
  `snapshot`;
- **element roles**: *source*, *decoder*, *convert/scale*, *compositor*, *encoder*,
  *audio-encoder*, *mux*, *display-sink*, *rtmp-sink*, *file-sink*.

If a section below needs to name a codec, it names the **role** (“the platform
encoder”), not the element. This is the structural guarantee that the 161-string
matrix (B-01) cannot regrow.

### 0.4 Behavioral-inventory coverage (rule 2)

Every capture / LED / watchdog behavior in the inventory maps to a section here:

| B-id | Legacy behavior | Disposition | Mapped to |
|---|---|---|---|
| B-01 | Record-start 4-level pipeline-string matrix | CHANGE → builder | §2.1–2.5 |
| B-02 | Filename-as-metadata | CHANGE → manager writes where told, parses nothing | §1.2, §3.2 (`outputPath`) |
| B-05 | Record LED (GPIO, two `pkill`s + second script) | KEEP intent | §1.4 (LED), §3.2 `POST /device/led` |
| B-06 | Stop = `sudo killall -SIGINT gst-launch-1.0` | CHANGE → targeted process-group SIGINT | §1.3 (targeted stop) |
| B-11 | Empty `audOnlyPipe` shell no-op on stop | DROP | §6 (dropped) |
| B-12 | Fire-and-forget exec, dead `isError` flag | DROP → confirmed health | §1.3 (health), §3.4 (confirm events) |
| B-13 | Physical record button (GPIO), half-wired | Retired [D-12] | §1.4 (GPIO), §6 |
| B-14 | Menu render → global `killall` of all gst | CHANGE → per-consumer stop | §1.3 |
| B-16 | Stream-before-record ordering (push active first) | KEEP ordering | §3.5 (live/CH-02), streaming-relay (prompt 11) |
| B-17 | Record previews as polled JPEGs over socket | CHANGE → WebRTC thumbnails | §1.2 (`thumbnails`) |
| B-18 | Setup previews + global-kill source switching | CHANGE → display consumers, no global kill | §1.2 (`meeting`/`projector`), §2 |
| B-19 | Leaked per-connection `setInterval`s | DROP → lifecycle-managed | §1.3, §6 |
| B-39 | EZ-Cap **boot** watchdog (one-shot string match) | KEEP intent → supervised | §1.4 (watchdog), §5 |
| B-56 | Encoder settings actually honored: bitrate + fps | KEEP as knobs | §2.2 (profiles) |
| B-57 | Device enumeration (`v4l2-ctl --list-devices`) | CHANGE → source discovery | §1.1, §3.2 `GET /sources` |
| B-58/59 | Streaming = nginx conf surgery + restart | CHANGE → relay (prompt 11) | §3.2 (`live`), §5 |
| B-60 | Hardcoded quick-presets | KEEP → presets-as-data | §2.1 |

---

## 1. Process model

### 1.1 Publishers — one per physical input, device-lifetime

Each publisher is a supervised GStreamer child that captures **one** input exactly
once and writes it to its shm socket with `wait-for-connection=false` so consumers
attach/detach freely (A-05, pipeline-audit §4.1). Publishers are **device-lifetime,
not session-lifetime** (SM-Q-9, §6.1 of the machines): they start at boot and stay up
so idle previews, health tiles, and fast resume all work.

| Publisher | Captures | shm ring | Notes |
|---|---|---|---|
| `usb` | `pc` (V4L2 HDMI dongle) | 64 MB | raw NV12 1080p60; highest bandwidth |
| `rtsp` | `cam1` (RTSP/TCP, `latency=100`) | 20 MB | depayload + parse only, **no decode** |
| `rtsp2` | `cam2` (RTSP/TCP) | 20 MB | same |
| `audio` | `mic-lecture` (ALSA) | 4 MB | S16LE 48 kHz stereo |

- **Discovery (B-57 successor):** on boot and on binding change, the manager probes
  V4L2 for the capture dongle and validates the mic ALSA device; camera addresses
  come from core-api provisioning (`cmd.admin.set_binding`, HL-09), never hardcoded.
  Camera IPs are edited in exactly one place (INV-PI-2, B-46 dupes die).
- **Supervision:** a dead publisher is auto-restarted **3× with `T-CONSUMER-RESTART`
  backoff (1 s / 3 s / 8 s, max 3 / 120 s)**, then held `offline` with an alert until
  an input change or manual retry (§6.1 of the machines). Restart of a publisher does
  **not** disturb attached consumers — that is the entire point of shm decoupling.
- **Health signal → `evt.pm.publisher.*`:** process-group liveness **plus** a
  frames-flowing measure (fps tap, §1.3). fps < 50 % of expected, RTSP reconnecting,
  or “restarted < 10 s ago” projects to `degraded` (HL-04); no frames for
  `T-SOURCE-OFFLINE` (10 s) projects to `offline` (HL-06). The manager never reports
  the last-healthy value once telemetry is stale (`T-HEALTH-STALE` 6 s → `unknown`,
  HL-08, INV-DH-2 — the structural fix for B-12).

### 1.2 Consumers — attach/detach against warm publishers

A consumer is a supervised child that subscribes to one or more shm sockets and
produces one output. Six classes, each with a distinct lifecycle owner:

| Class | Output | Encodes? | Lifecycle owner | Restart class |
|---|---|---|---|---|
| `record` | segment file(s) on the recordings disk | composite → yes; single camera → **passthrough (no encode)** | RECORDING machine 1a (session) | `record` (§1.3) |
| `live` | RTMP to local nginx (`rtmp://127.0.0.1:1935/live/<key>`) | yes | Channel machine 1c (`streaming`) | `channel` |
| `meeting` | HDMI-out #2 → dongle → laptop; camera composite **with mic audio embedded** (A-15, PF-12) | no (display) | Channel machine 1c (`meeting`) | `channel` |
| `projector` | HDMI-out #1; laptop-slides passthrough, switches to question + join-QR overlay (A-22, Q-31) | no (display) | laptop-presence + publication 2d | `display` |
| `thumbnails` | WebRTC full-motion previews to the panel (A-17, replaces B-17/B-18 JPEG polling) | yes (per source) | panel subscription | `channel` |
| `snapshot` | periodic PNG for OCR/AI (`snap_slides` successor) | no (PNG on CPU) | AI-session | `aux` |

**Output paths are given, never derived (B-02, SEG-7).** core-api owns identity
(A-07) and hands `record` an explicit `outputPath`; the manager writes there and
parses no filename for meaning. A `separate-files` preset writes one file per
`LayoutPreset.outputs` entry **from one child** (proven by `rec_usb_cam1_separate`),
which is how a “Separate” recording becomes one supervised process instead of the
legacy fan-out (SEG-3, B-09).

**Projector idle behavior (pipeline-audit §4.6):** the `projector` consumer runs
whenever a laptop is present (passthrough) and shows a blank/branding card when none
is (A-08 camera-only operation). Switching to the question overlay is a mode change
(§3.2 `POST /consumers/projector {mode}`), not a restart.

### 1.3 The supervisor

The supervisor formalizes the four proven `eduscope_web.py` patterns (pipeline-audit
§4.5) and adds the three things Phase-3 needs: **captured** stderr/bus parsing,
**confirmed** health, and **per-class** restart.

**Spawn & PID ownership (carried verbatim from `eduscope_web.py`).**
Each child is launched with `os.setsid` so it owns a **process group**; the manager
holds the `Popen` handle and pgid keyed by `consumerId`. Children are launched from an
**argv list, never a shell string** (`shell=False`) — this deletes the entire
injection surface (B-63) and the “empty string exec” vestige (B-11). No `sudo` is
ever issued from service code (target-architecture §3.7): the only privileged verbs
(USB-hub power-cycle, LED GPIO) go through a fixed-allowlist root helper (§1.4).

**stderr / bus parsing (the B-12 fix).**
`eduscope_web.py` sent child `stdout`/`stderr` to `DEVNULL` — the single biggest
supervision gap (a green dot meant “process exists”, not “pipeline healthy”). The
manager instead spawns each child with **bus messages on stdout** (`-m`) and
**captured stderr**, and parses line-oriented:

| Parsed token | Meaning | Emitted |
|---|---|---|
| pipeline reached `PLAYING` | negotiated & rolling | contributes to `G-CONSUMER-CONFIRMED` |
| `Got EOS` after a stop signal | clean finalization | `evt.pm.consumer.eos` |
| `ERROR` (element, resource, stream) | fatal | `evt.pm.consumer.failed{code}` (+ last-error map) |
| repeated `QoS`/dropped-buffer | degradation | fps/degrade telemetry |

**Health confirmation — bus messages *or* file growth (PF-2, G-CONSUMER-CONFIRMED).**
A consumer is `running` only when the pipeline reached `PLAYING` **and**, for
`record`, the target file **grew across two samples** (or the bus reached PLAYING for
non-file classes). This is exactly the guard the RECORDING machine waits on at R-05
and the reason a failed start can never read as `recording` (B-12). Publisher health
uses process-group liveness + an fps tap (frames flowing at ≥ threshold for
`T-SOURCE-DEBOUNCE` 3 s → `online`).

**Restart policy per process class:**

| Class | On unexpected exit | Exhaustion | Machine tie-in |
|---|---|---|---|
| `publisher` | restart 3× (1/3/8 s) | hold `offline` + alert | §6.1, HL-06/07 |
| `record` | restart 3× / 120 s; **each restart opens a new segment** | give up → finalize what exists | R-16 → R-17, R-18, SEG-1 |
| `channel` (live/meeting/thumbnails) | restart 3× with backoff; **record untouched** (INV-CC-2) | → `failed`, alert | CH-09, CH-06 |
| `display`/`aux` (projector/snapshot) | restart while its precondition holds | idle card / stop | — |

Every restart is a first-class, **state-machine-visible** event — a dead `record`
pipeline produces a new segment via R-16, not a silently-resurrected one; the seam is
why segments are first-class (SEG-1).

**Targeted stop with EOS-wait timeout (B-06 / B-14 death).**
Stop is never `killall`. It is, per consumer:

1. send **SIGINT to that consumer’s process group** (children run `-e`, so SIGINT ⇒
   EOS ⇒ the mpegts/flv tail is finalized);
2. **wait for `Got EOS`** on the bus up to the class deadline —
   `T-STOP-EOS` (8 s) on stop, `T-PAUSE-EOS` (5 s) on pause;
3. on timeout, **escalate SIGKILL to the group**; the segment is marked `truncated`
   (still playable, PF-4).

This is `eduscope_web.py::stop()` made per-class and EOS-confirmed. It maps directly
to R-11→R-12/R-13 (stop), R-08→R-09 (pause), and CH-07→CH-08 (channel off).

**Orphan adoption (carried verbatim — BR-1).**
On manager restart, children started by a previous instance are found by
`pgrep -f <pattern>` and either **adopted** (re-attach supervision by process group,
core-api restarted alone) or stopped with `pkill -INT -f` so `-e` still finalizes the
file. This is the proven `is_running`/`stop` fallback and the mechanism behind BR-1
“adopt → recording, no data loss”.

### 1.4 Device-facing hardware: record LED, GPIO button, capture-card watchdog

These are the inventory’s **LED / watchdog** items; the manager owns them because it
is the device-resident service.

**Record LED (B-05 → PF-14, §1.5 of the machines).**
The LED is a **pure function of `recording.state`**, not a machine. core-api (the
single writer of recording state) computes it and calls the manager’s `POST /device/led`
(§3.2) with `blink` (state `recording`) or `off` (everything else). This replaces the
legacy two-`pkill`-plus-second-script drive (B-05) with one derived call that is
automatically correct across pause and crash paths. GPIO presence is fact-check H-4;
if the LED is absent the endpoint is a logged no-op.

**Physical record button (B-13).** Retired ([D-12]). No GPIO input path exists; if
product resurrects it, it becomes a `cmd.recording.stop(actorKind=hardware)` trigger
in core-api (R-11), not manager logic.

**Capture-card watchdog (B-39 → machine 5c, HL-20..23).**
The legacy one-shot boot check (`v4l2-ctl` string match → 20 s wait → `uhubctl` port
cycle) becomes a **supervised, in-uptime watchdog**:

- probe the capture dongle every `T-CAPTURE-PROBE` (30 s);
- **2 consecutive misses → `absent`** (HL-20); the `pc` role goes `offline`;
- **power-cycle the hub port via the allowlisted root helper** (no `sudo` from app
  code) if fewer than 2 cycles this hour → `recovering` (HL-21);
- re-enumerates ≤ `T-CAPTURE-RECOVER` (25 s) → `present` (HL-22), else `failed`
  (HL-23) needing a human — and **recording with the remaining cameras keeps working**
  (A-08 camera-only).

The watchdog emits `device.health{captureCardState}` to core-api. Crucially, while
`recovering` the `pc` role is reported **offline**, not degraded (there is no signal
during a power cycle).

---

## 2. Pipeline builder

This is the **only** section containing pipeline text (rule 1). The builder turns a
typed request into a child **argv list** in three composable stages
(*source → compose → sink*), selecting every platform element through the **platform
plug** (§2.3). It is the code-generation answer to the audit’s core insight: the 161
strings are a cartesian product of ~4 sources × ~4 layouts × 3 destinations, and the
differences are mechanical substitutions (pipeline-audit §3).

### 2.1 Typed layout table (presets → compositor geometry)

Layouts are **data** (pipeline-audit §4.2). Two-tile geometry comes from the proven
`_layout.sh::ratio_layout A B` — even-dimension, 16:9 tiles centered on a 1920×1080
canvas. Presets are **per-channel** (A-09 / [ADR-017](../adr/ADR-017-output-channels-layout-model.md)):
Local Recording + Live Streaming use the PC-inclusive set; Live Meeting uses the
camera-only set. Enforcing the per-channel set is a builder guard (a PC preset
requested on the `meeting` channel is rejected, §3.4).

```python
@dataclass(frozen=True)
class Tile:
    role: SourceRole            # pc | cam1 | cam2
    geom: Literal["split_a", "split_b", "full", "pip"]

@dataclass(frozen=True)
class LayoutPreset:
    id: str
    channels: frozenset[Channel]        # {local, streaming} or {meeting}
    tiles: tuple[Tile, ...]
    passthrough_eligible: bool          # true iff single H.264 camera tile
```

| presetId | Channels | Tiles | Split (default) | Compose | Encode path |
|---|---|---|---|---|---|
| `pc-solo` | local, streaming | `pc:full` | — | none | re-encode (raw source) |
| `cam1-solo` | local, streaming, meeting | `cam1:full` | — | none | **passthrough** (record) / re-encode (live) |
| `cam2-solo` | local, streaming, meeting | `cam2:full` | — | none | passthrough / re-encode |
| `pc-cam1-split` | local, streaming | `pc:split_a`, `cam1:split_b` | `ratio_layout A B` (50/50) | compositor | encode |
| `pc-cam1-pip` | local, streaming | `pc:full`, `cam1:pip` | PiP inset | compositor | encode |
| `cam1-cam2-split` | meeting | `cam1:split_a`, `cam2:split_b` | `ratio_layout A B` (50/50) | compositor | display (no encode) |
| `cam1-large-cam2-small` | meeting | `cam1:full`, `cam2:pip` | PiP inset | compositor | display |

`ratio_layout` output for the common `50/50` split (the value the builder substitutes
into compositor pad properties): `W0=960 H0=540 X0=0 Y0=270  W1=960 H1=540 X1=960 Y1=270`.

> The exact preset **id vocabulary** is the contract item LP-7, reconciled at the
> prompt-12 drift review (ADR-017). This table is the shape; the strings may be
> renamed there without touching the builder.

### 2.2 Encoding profiles (data, not code — B-56)

Profiles are typed records substituted into the *encoder* / *audio-encoder* / *mux* /
*sink* roles. Values are the engineer’s proven script values.

```python
@dataclass(frozen=True)
class EncodeProfile:
    id: str
    video_bitrate_bps: int
    rc_mode: str                 # "cbr"
    gop: int
    h264_profile: str            # "high"
    audio_bitrate_bps: int       # 128000
    container: Literal["mpegts", "flv", "none"]
```

| profileId | video bps | gop | container | Used by | Source script |
|---|---|---|---|---|---|
| `record-composite` | 4 000 000 | 30 | mpegts (`alignment=7`) | `record` composite | `rec_*_5050.sh` |
| `record-usb-reencode` | 6 000 000 | 30 | mpegts | `record` separate USB stream | `rec_usb_cam1_separate.sh` |
| `live-composite` | 4 000 000 | **60** (2 s keyframe) | flv (`streamable=true`) | `live` | `live_*.sh` |
| `passthrough` | — (no encode) | — | mpegts | single-camera `record` | `rec_cam1.sh` |
| `thumbnail` | *bench* (low) | *bench* | WebRTC | `thumbnails` | new (A-17) |

Only `bitrate`, per-stream `framerate`, and the ratio are user/knob-facing (B-56); the
dead legacy knobs (`resolution` mapped-but-unused, `profile`/`fformat` hardcoded) are
**not** carried as controls.

### 2.3 The platform plug (second platform = an add, not a rewrite)

**One module** exports the platform-specific elements behind a stable interface. The
builder never names an element directly — it asks the plug for a *role*. Porting to a
second board means writing one new module that satisfies `PlatformProfile`; the
builder, presets, profiles, API, and supervisor are untouched.

```python
class PlatformProfile(Protocol):
    id: str                                            # "rk3588"

    # element fragments (lists of gst tokens) keyed by role
    def shm_video_caps(self, role: SourceRole) -> str: ...
    def audio_caps(self) -> str: ...
    def decoder(self) -> list[str]: ...                # H.264 -> raw
    def convert(self) -> list[str]: ...
    def scale(self) -> list[str]: ...
    def compositor(self, name: str, pads: list[Pad]) -> list[str]: ...
    def encoder(self, p: EncodeProfile) -> list[str]: ...
    def audio_encoder(self, p: EncodeProfile) -> list[str]: ...
    def mux(self, kind: str, name: str) -> list[str]: ...
    def display_sink(self, output: DisplayOut) -> list[str]: ...
    def rtmp_sink(self, url: str) -> list[str]: ...
    def file_sink(self, path: str) -> list[str]: ...
    def display_place(self, output: DisplayOut) -> PlacementFn: ...   # post-spawn (wmctrl)
    def required_elements(self) -> list[str]: ...      # for preflight (check_live successor)
```

**RK3588 implementation** (verified by `check_live.sh` element checks, pipeline-audit
§4.3). This table is the *whole* platform-specific surface:

| Role | RK3588 element(s) | A hypothetical Jetson plug would use |
|---|---|---|
| H.264 decode | `mppvideodec` | `nvv4l2decoder` |
| H.264 encode | `mpph264enc bps=… rc-mode=cbr gop=… profile=high` | `nvv4l2h264enc` |
| convert / scale | `videoconvert` / `videoscale` (CPU) | `nvvidconv` (NVMM) |
| compose | `compositor` (CPU) | `nvcompositor` |
| display out | `xvimagesink` + `wmctrl` placement (X11, `DISPLAY=:0`) | `nvoverlaysink` |
| audio encode | `voaacenc bitrate=128000 ! aacparse` | same |
| record mux | `mpegtsmux alignment=7` | same |
| live mux | `flvmux streamable=true` | same |
| rtmp sink | `rtmpsink location="… live=1"` | same |

> The CPU `compositor`/`videoconvert` are the RK3588 hot spots (no NVMM/RGA path used
> yet); the plug can later swap them for RGA-offloaded variants **inside the module**
> without a builder change (target-architecture §5). That optionality is exactly what
> the plug boundary buys.

**Preflight (check_live.sh successor).** Before a `live`/`meeting` consumer flips on,
the builder runs `required_elements()` through `gst-inspect`, checks relay/TLS-bridge
state and the push directive, and does a short test push (CH-01/CH-02, A-10). A
missing element fails **before** the lecturer is live (CH-03), not mid-stream.

### 2.4 Builder assembly rules

- **Source stage** — for each tile: `shmsrc` on the role’s socket with the plug’s caps.
  Camera tiles that need pixels insert `h264parse ! decoder`; a **passthrough** record
  tile (single H.264 camera) skips decode entirely and goes straight to the mux
  (near-zero CPU, **no encode session consumed** — the §4 efficiency win).
- **Normalize** — `videorate drop-only=true` to the target 30 fps, `convert`+`scale`
  to the tile geometry, each fronted by a `queue … leaky=downstream` (proven backlog
  policy).
- **Compose stage** — the plug’s `compositor` with pad `xpos/ypos/width/height` from
  the layout table; single-tile presets skip the compositor.
- **Sink stage** — `record` → encoder + `mpegtsmux` + file-sink (one mux **per output
  file**, e.g. separate-files uses two); `live` → encoder + `flvmux` + rtmp-sink;
  `meeting`/`projector` → display-sink (audio branch routed to the HDMI port’s ALSA
  device so mic audio is embedded, A-15); `snapshot` → 1 fps PNG.
- **Audio** — one shm audio branch, `audioconvert ! audioresample ! audio-encoder`
  into the same mux (record/live) or the HDMI ALSA sink (meeting).
- **Source-loss fallback (R-SRC-1, default in-pipeline).** Each compositor input pad is
  fronted by a fallback switch that feeds a low-fps “SOURCE UNAVAILABLE” placeholder
  when the role is `offline`, so a dropped source never tears down the `record`
  consumer (the lecture keeps growing; §5). The in-pipeline route keeps **one**
  segment; the alternative (restart with the role dropped) produces an extra segment
  via R-16 — a state-machine-visible choice and a Phase-3 bench item (§6.2 note of the
  machines).

### 2.5 Three fully-rendered examples (as the builder emits them for RK3588)

These are the argv the supervisor would spawn (`-e` for EOS-on-SIGINT, `-m` for bus
parsing added by the supervisor). They are faithful renderings of the proven scripts.

**(a) `record`, preset `pc-cam1-split` @ 50/50, profile `record-composite`** — laptop
left, lecturer camera right, mic embedded, to one `.ts` segment. (Compositor geometry
is the `ratio_layout 50 50` output from §2.1.)

```
gst-launch-1.0 -e -m \
  shmsrc socket-path=/tmp/usb.sock is-live=true do-timestamp=true ! \
    video/x-raw,format=NV12,width=1920,height=1080,framerate=60/1 ! \
    queue max-size-buffers=6 leaky=downstream ! \
    videorate drop-only=true ! video/x-raw,framerate=30/1 ! \
    videoscale ! video/x-raw,width=960,height=540 ! queue ! comp.sink_0 \
  shmsrc socket-path=/tmp/rtsp.sock is-live=true do-timestamp=true ! \
    video/x-h264,stream-format=byte-stream,alignment=au,width=1920,height=1080,framerate=30/1 ! \
    h264parse ! mppvideodec ! videoconvert ! \
    queue max-size-buffers=6 leaky=downstream ! \
    videorate drop-only=true ! video/x-raw,framerate=30/1 ! \
    videoscale ! video/x-raw,width=960,height=540 ! queue ! comp.sink_1 \
  compositor name=comp background=black \
    sink_0::xpos=0   sink_0::ypos=270 \
    sink_1::xpos=960 sink_1::ypos=270 ! \
    video/x-raw,width=1920,height=1080,framerate=30/1 ! \
    queue ! mpph264enc bps=4000000 rc-mode=cbr gop=30 profile=high ! \
    h264parse config-interval=1 ! queue ! mux. \
  shmsrc socket-path=/tmp/audio.sock is-live=true do-timestamp=true ! \
    audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved ! \
    queue ! audioconvert ! audioresample ! voaacenc bitrate=128000 ! aacparse ! queue ! mux. \
  mpegtsmux name=mux alignment=7 ! filesink location=<outputPath given by core-api>
```

**(b) `meeting`/preview, preset `cam1-cam2-split` @ 50/50** — camera-only composite to
HDMI-out #2 with the lecturer mic embedded on that port’s ALSA device (A-15). No
encoder is consumed (display path). The supervisor performs window placement
(`wmctrl` fullscreen on the target head) **after** spawn — placement is not part of
the pipeline text.

```
gst-launch-1.0 -e -m \
  shmsrc socket-path=/tmp/rtsp.sock is-live=true do-timestamp=true ! \
    video/x-h264,stream-format=byte-stream,alignment=au,width=1920,height=1080,framerate=30/1 ! \
    h264parse ! mppvideodec ! videoconvert ! \
    queue max-size-buffers=6 leaky=downstream ! \
    videorate drop-only=true ! video/x-raw,framerate=30/1 ! \
    videoscale ! video/x-raw,width=960,height=540 ! queue ! comp.sink_0 \
  shmsrc socket-path=/tmp/rtsp2.sock is-live=true do-timestamp=true ! \
    video/x-h264,stream-format=byte-stream,alignment=au,width=1920,height=1080,framerate=30/1 ! \
    h264parse ! mppvideodec ! videoconvert ! \
    queue max-size-buffers=6 leaky=downstream ! \
    videorate drop-only=true ! video/x-raw,framerate=30/1 ! \
    videoscale ! video/x-raw,width=960,height=540 ! queue ! comp.sink_1 \
  compositor name=comp background=black \
    sink_0::xpos=0   sink_0::ypos=270 \
    sink_1::xpos=960 sink_1::ypos=270 ! \
    video/x-raw,width=1920,height=1080,framerate=30/1 ! \
    queue ! xvimagesink sync=false \
  shmsrc socket-path=/tmp/audio.sock is-live=true do-timestamp=true ! \
    audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved ! \
    queue ! audioconvert ! audioresample ! alsasink device=hw:<hdmi-out-2> sync=false
```

*(A plain confidence preview would swap `alsasink device=hw:<hdmi-out-2>` for
`autoaudiosink`; the meeting consumer embeds to the HDMI ALSA device so the dongle
presents webcam + mic to the laptop as one device — pipeline-audit §4.6.)*

**(c) `live`, preset `pc-cam1-split` @ 50/50, profile `live-composite`** — same
composite, encoded at `gop=60`, muxed to FLV, pushed to the local nginx relay.

```
gst-launch-1.0 -e -m \
  shmsrc socket-path=/tmp/usb.sock is-live=true do-timestamp=true ! \
    video/x-raw,format=NV12,width=1920,height=1080,framerate=60/1 ! \
    queue max-size-buffers=6 leaky=downstream ! \
    videorate drop-only=true ! video/x-raw,framerate=30/1 ! \
    videoscale ! video/x-raw,width=960,height=540 ! queue ! comp.sink_0 \
  shmsrc socket-path=/tmp/rtsp.sock is-live=true do-timestamp=true ! \
    video/x-h264,stream-format=byte-stream,alignment=au,width=1920,height=1080,framerate=30/1 ! \
    h264parse ! mppvideodec ! videoconvert ! \
    queue max-size-buffers=6 leaky=downstream ! \
    videorate drop-only=true ! video/x-raw,framerate=30/1 ! \
    videoscale ! video/x-raw,width=960,height=540 ! queue ! comp.sink_1 \
  compositor name=comp background=black \
    sink_0::xpos=0   sink_0::ypos=270 \
    sink_1::xpos=960 sink_1::ypos=270 ! \
    video/x-raw,width=1920,height=1080,framerate=30/1 ! \
    queue ! mpph264enc bps=4000000 rc-mode=cbr gop=60 profile=high ! \
    h264parse config-interval=1 ! queue max-size-buffers=200 ! mux. \
  shmsrc socket-path=/tmp/audio.sock is-live=true do-timestamp=true ! \
    audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved ! \
    queue ! audioconvert ! audioresample ! voaacenc bitrate=128000 ! aacparse ! \
    queue max-size-buffers=200 ! mux. \
  flvmux name=mux streamable=true ! queue max-size-buffers=400 ! \
  rtmpsink location="rtmp://127.0.0.1:1935/live/<streamKey> live=1" sync=false
```

The three share the composite front-end verbatim and differ **only** in the sink
stage — file vs display vs rtmp. That is the whole thesis of the builder.

---

## 3. Internal HTTP API (localhost)

Refines `target-architecture.md` §2.2. **Bound to `127.0.0.1` only**, no external
exposure; the single client is core-api. This API is what the RECORDING and Channel
state machines drive.

### 3.1 Transport & async model

Commands are **202-accepted, then confirmed by event** — the manager cannot know a
pipeline is healthy synchronously (G-CONSUMER-CONFIRMED needs file growth or bus
PLAYING). Two channels:

- **REST** for commands/queries. A start returns `202 {consumerId, state:"starting"}`
  immediately.
- **`GET /events`** — an SSE stream (one JSON object per line) carrying the
  `evt.pm.publisher.*` and `evt.pm.consumer.*` internal events the state machines
  consume (§10 “Internal” table of the machines). core-api subscribes once; on
  reconnect it re-reads `GET /status` for a full snapshot. This is the transport for
  every `evt.pm.*` referenced in the machines.

Auth: localhost bind + a shared bearer token from the provisioning store (defense in
depth); no user identity flows here — that is core-api’s boundary.

### 3.2 Routes

**Publishers** (device-lifetime; endpoints exist for boot bring-up, binding changes,
and manual restart):

| Method / path | Body | 202 result |
|---|---|---|
| `POST /publishers/{id}/start` | — | `{publisherId, state}` |
| `POST /publishers/{id}/stop` | — | `{publisherId, state}` |

`id ∈ {usb, rtsp, rtsp2, audio}`.

**Consumers:**

| Method / path | Body (validated by pydantic) | Notes |
|---|---|---|
| `POST /consumers/record` | `{preset, ratioA?, ratioB?, profile, outputPath, separate?:bool}` | session-lifetime; `outputPath` given by core-api (B-02) |
| `POST /consumers/live` | `{preset, ratioA?, ratioB?, streamKey, profile}` | preflight first (CH-01/02); PC-inclusive presets only |
| `POST /consumers/meeting` | `{preset, ratioA?, ratioB?}` | HDMI-out #2, embeds mic; **camera-only presets only** |
| `POST /consumers/projector` | `{mode:"passthrough"\|"question", questionPayload?}` | HDMI-out #1; `mode` switch is not a restart (A-22) |
| `POST /consumers/thumbnails/start` | `{sources?:[role]}` | WebRTC previews (A-17) |
| `POST /consumers/thumbnails/stop` | — | |
| `POST /consumers/snapshot/start` | `{intervalSec, outputPath}` | AI slides (`snap_slides` successor) |
| `POST /consumers/snapshot/stop` | — | |
| `POST /consumers/{consumerId}/stop` | `{mode:"eos"\|"kill", timeoutMs?}` | default `eos`; EOS-wait then SIGKILL (§1.3) |

**Device / query:**

| Method / path | Body | Result |
|---|---|---|
| `POST /device/led` | `{mode:"blink"\|"off"}` | LED derived from `recording.state` (B-05, §1.4) |
| `GET /status` | — | full runtime snapshot (§3.3) |
| `GET /sources` | — | per-role health/fps (projects to 5a; B-57) |
| `GET /events` | — | SSE `evt.pm.*` stream (§3.1) |
| `GET /healthz` | — | liveness of the manager process itself |

### 3.3 Status shape (`GET /status`)

```jsonc
{
  "platform": "rk3588",
  "encodeLedger": { "capacity": 3, "inUse": 2, "reservedBy": ["record:ULID", "live:ULID"] },
  "publishers": {
    "usb":   { "state": "online",  "fps": 60, "sinceMs": 1837421, "lastError": null },
    "rtsp":  { "state": "degraded","fps": 12, "sinceMs":  92004,  "lastError": "rtsp reconnecting" },
    "rtsp2": { "state": "offline", "fps": 0,  "sinceMs":   3110,  "lastError": "no route" },
    "audio": { "state": "online",  "rms": 0.21, "sinceMs": 1837410, "lastError": null }
  },
  "consumers": [
    { "id":"record:01J…", "kind":"record", "state":"running", "preset":"pc-cam1-split",
      "ratioA":50, "ratioB":50, "profile":"record-composite", "pgid":40231,
      "outputPath":"/media/rec/…/seg-001.ts", "bytesWritten":183042048,
      "lastGrowthAtMs":1837420, "restarts":0, "startedAtMs":1791020, "lastError":null }
  ],
  "device": { "captureCardState":"present", "led":"blink" }
}
```

`state ∈ {starting, running, degraded, stopping, exited, failed}`. Publisher
`state` uses the 5a vocabulary (`online|degraded|offline|unknown`). `unknown` is
returned whenever telemetry is older than `T-HEALTH-STALE` — never the last-healthy
value (INV-DH-2, B-12).

### 3.4 Error taxonomy

**Synchronous rejections** (Class A — refuse, create nothing; §0.4 of the machines):

| HTTP | code | Meaning | Machine tie-in |
|---|---|---|---|
| 400 | `invalid_preset` | unknown preset | R-04 config.invalid |
| 400 | `invalid_ratio` | ratio not two positive ints | R-04 |
| 400 | `preset_channel_mismatch` | PC preset on `meeting`, or camera preset where a PC feed is required | R-04, INV-LP-1 |
| 409 | `publisher_not_running` | a required publisher is down (G-PUBLISHERS-READY) | R-04 / R-01 pre-check, PF-2 |
| 409 | `encoder_budget_exceeded` | no free encode session (§4) | surfaced as config/resource refusal |
| 422 | `platform_element_missing` | preflight `gst-inspect` failed | CH-03 preflight-failed |
| 404 | `consumer_not_found` | stop/query on an unknown id | — |
| 503 | `capture_card_absent` | `pc` requested while card `absent`/`recovering` | HL-20/21 |

**Asynchronous failures** (Class B — the consumer was created, then failed; emitted on
`GET /events` as `evt.pm.consumer.failed{consumerId, code}`):

| code | Meaning | Machine tie-in |
|---|---|---|
| `spawn_failed` | `Popen` raised | R-06 (no segments) / R-07 (segments exist) |
| `confirm_timeout` | no PLAYING/file-growth within `T-START-CONFIRM` (5 s) | R-06 / R-07 |
| `source_unavailable` | bound source vanished between pre-check and spawn | R-06 / R-07, R-SRC-1 |
| `eos_timeout` | `Got EOS` not seen within the stop/pause deadline | R-13 / R-09 (SIGKILL, `truncated`) |
| `exited_unexpected` | process group died with no stop request | R-16 (record) / CH-09 (channel) |
| `element_error` | fatal bus ERROR mid-run | R-16 / CH-09 |

The split is the machines’ Class A vs Class B (§0.4): a refusal never creates a
phantom `error` session; a launch failure is a real `error` **only if nothing was
captured** (SM-R-4).

### 3.5 Command → machine map (what core-api calls, when)

| RECORDING / Channel transition | Manager call(s) | Confirmed by |
|---|---|---|
| R-01 start | ensure publishers → `POST /consumers/record` (+ enabled channels) → `POST /device/led`(pending) | `evt.pm.consumer.running(record)` → R-05 |
| R-05 confirmed | `POST /device/led {blink}` | — |
| R-08 pause | `POST /consumers/{record}/stop {mode:eos, timeoutMs:5000}` | `evt.pm.consumer.eos` → segment finalized (R-08); timeout → R-09 |
| R-10 resume | `POST /consumers/record` (**new segment path**) | `evt.pm.consumer.running` → R-05 (startReason resume) |
| R-11 stop | `POST /consumers/{record}/stop {mode:eos, timeoutMs:8000}` + stop meeting/streaming consumers | `evt.pm.consumer.eos` → R-12; timeout → R-13 |
| R-16 pipeline lost | (manager auto-restarts per policy, emits events) | `evt.pm.consumer.exited` → R-16; `evt.pm.consumer.running` → R-17 |
| CH-01/02 streaming on | preflight → `POST /consumers/live` | `evt.pm.consumer.running` → CH-05 |
| CH-04 meeting on | `POST /consumers/meeting` | CH-05 |
| Q-31 send to projector | `POST /consumers/projector {mode:question, questionPayload}` | ack → projector switched |

Stream-before-record ordering (B-16, CH-02): the streaming-relay push targets are made
active **before** the `live` consumer connects — that ordering is load-bearing and
lives in the relay design (prompt 11); the manager’s `live` start assumes it.

---

## 4. Resource budget (RK3588, 24 GB)

The scarce resource on this board is **encode/decode sessions and CPU compose**, not
RAM or shm. The engineer has **proven the headline case** (pipeline-audit §5); the
open items are worst-case saturation and the two new consumers (thumbnails, embedded
audio).

### 4.1 Encode-session ledger (what may run concurrently)

The manager keeps a live **encode ledger** and refuses a consumer that would exceed
capacity (`409 encoder_budget_exceeded`, §3.4). One `mpph264enc` session per encoding
video output:

| Consumer | Encode sessions | Decode sessions | Notes |
|---|---|---|---|
| `record` composite | **1** | 1 per camera tile | 4 Mbps |
| `record` passthrough (`cam1/2-solo`) | **0** | **0** | remux only — the free path (pipeline-audit §4.3) |
| `record` separate (USB+cam) | **1** (USB re-encode) | 0 (cam passthrough) | one child, two muxes |
| `live` composite | **1** | 1 per camera tile | 4 Mbps, gop=60 |
| `live` single camera | **1** | 1 | decodes then re-encodes (RTMP needs a clean GOP) |
| `meeting` | **0** (display) | 2 (cam1+cam2) | no encoder consumed |
| `projector` | **0** (display) | 0–1 | passthrough of raw USB |
| `thumbnails` | **N** (per previewed source) | per source | **the unmeasured risk** (A-17) |
| `snapshot` | **0** (PNG on CPU) | 0 | 1 fps, negligible |

**Proven worst case (engineer, ✅):** composite `record` + composite `live` +
`meeting` output — i.e. **2 concurrent 1080p30 encodes** plus camera decodes for the
displays — runs on the board simultaneously (pipeline-audit §5, ADR-014). The
ledger’s default `capacity` is therefore set to **2 guaranteed video encode sessions**
with a **provisional 3rd reserved for `thumbnails`**, pending the bench below.

**Decode multiplier — a budget subtlety to measure.** Because each consumer reads the
**compressed** camera byte-stream from shm and decodes its *own* copy, a single camera
composited into `record` **and** `live` **and** `meeting` is decoded **3×**
concurrently. RK3588’s VDPU (8K-class decode) should absorb this comfortably, but the
multiplier is explicit here so the bench measures it rather than assuming it.

### 4.2 shm sizing (proven values)

| Socket | Ring | Rationale |
|---|---|---|
| `/tmp/usb.sock` | 64 MB | raw NV12 1080p ≈ 3.1 MB/frame → ~20 frames (~0.33 s @60) headroom |
| `/tmp/rtsp.sock` | 20 MB | compressed byte-stream ring (several GOPs) |
| `/tmp/rtsp2.sock` | 20 MB | same |
| `/tmp/audio.sock` | 4 MB | S16LE 48 kHz stereo ≈ 192 KB/s → ~20 s |

Total ≈ **108 MB of 24 GB** — negligible. shm throughput at 1080p60 NV12 is **✅
proven** by the working script set (pipeline-audit §5); RAM is not a constraint even
with the large Vosk model resident.

### 4.3 CPU headroom & placement

- **Cores:** 4× A76 @ 2.4 GHz + 4× A55 @ 1.8 GHz (hardware-specs). The hot spots are
  the CPU `compositor` + `videoconvert` (no NVMM equivalent; RGA offload optional
  later, target-architecture §5).
- **Policy (carried from `eduscope_web.py`):** keep composite fps at **30**; use
  `leaky=downstream` queues everywhere (proven). Pin compose-heavy consumers to the
  A76 cluster; keep A55 headroom for the kiosk browser and the manager itself. The
  AI STT (Vosk) stays pinned to **A76 cores 4–7 via `taskset -c 4-7`** (proven
  placement) — but it lives in the `ai/` service now, not here (§6); the pinning
  *policy* carries.
- **Target:** leave ≥ ~30 % aggregate CPU headroom in the proven worst case so a
  fourth transient (thumbnails burst, snapshot, a source-loss placeholder switch)
  cannot starve the record/compose cores. Exact figure is a bench output, not an
  assertion.

### 4.4 Bench TODOs (explicit — measure before Phase-4 sign-off)

| # | Item | Owner | Status |
|---|---|---|---|
| B-T1 | Encode ledger worst case: composite `record` + composite `live` **+ `thumbnails`** — VEPU saturation & sustained 30 fps | pipeline engineer | new (extends pipeline-audit §5) |
| B-T2 | Decode multiplier: same camera decoded by 3 consumers — VDPU headroom | pipeline engineer | new |
| B-T3 | CPU cost of 2–3 concurrent CPU composites @30 fps — % of A76, confirm the headroom target | pipeline engineer | new |
| B-T4 | Laptop→projector **passthrough latency** (topology H-5) | hardware engineer | open |
| B-T5 | **HDMI audio embedding** on HDMI-out #2 → dongle → laptop: Zoom sees a usable mic; measure A/V offset | hardware engineer | open |
| B-T6 | Pause/resume A/V sync across consumer restart (`do-timestamp` boundary; A-12) | pipeline engineer | open |
| B-T7 | WebRTC `thumbnails` encode cost + preview < 1 s (INT-8, CG-2/Wave 8) | pipeline engineer | open |
| B-T8 | In-pipeline source-loss placeholder: switch latency & fps (R-SRC-1) | pipeline engineer | new |
| ✅ | shm throughput 1080p60; SIGINT→EOS finalization; X11 placement; simultaneous record+live+meeting | pipeline engineer | **proven** |

---

## 5. Failure matrix

Each failure is detected by the manager, emitted as an `evt.pm.*`/`device.health`
event, and consumed by a specific RECORDING (1a) or HEALTH (5) transition. **A dead
source or a dead pipeline never ends a lecture** (G-1, R-SRC-1).

| Failure | Manager detection | Emits | RECORDING (1a) | HEALTH (5) | Consumer behavior |
|---|---|---|---|---|---|
| **Camera unplugged mid-recording** (RTSP drops) | fps→0 / RTSP reconnecting; `T-SOURCE-OFFLINE` 10 s | `sources.status{degraded→offline}`, `system.alert{source.offline}` | **continues** (R-SRC-1): placeholder pad, timeline unbroken | HL-04 → HL-06 | in-pipeline fallback placeholder to the compositor pad; publisher auto-restarts 3× |
| **`mic-lecture` lost** | audio fps→0 | `sources.status{offline}`, `system.alert{source.offline, severity:critical}` | continues, **silent track** | HL-06 | audio branch feeds silence; ranked *critical* so it can’t be missed (R-SRC-1 table) |
| **Capture card (PC dongle) unplugged** | watchdog: 2 misses (`T-CAPTURE-PROBE`) | `device.health{captureCard:absent→recovering}`, `system.alert{capture-card.*}` | continues (placeholder if `pc` in preset); **camera-only still records** (A-08) | HL-20 → HL-21 (uhubctl via root helper) → HL-22/HL-23 | power-cycle the hub port; `pc` role `offline` while recovering |
| **Publisher crash** | process group dead; bus ERROR on stderr | `evt.pm.publisher.exited`, `sources.status{offline}` | continues (R-SRC-1 while restarting) | HL-06 → HL-07 on recovery | auto-restart 3× / backoff, then hold `offline` + alert |
| **Consumer crash — `record`** | pgid died with no stop request | `evt.pm.consumer.exited(record, unexpected)`, `system.alert{recording.pipeline-lost}` | **R-16** → new segment (old `truncated`) → **R-17** back to recording; **R-18** if attempts exhausted → stopping | — | restart 3× / 120 s; each restart = a new segment (SEG-1); ≤ 5 s lost at the seam (INT-6) |
| **Consumer crash — `live`/`meeting`/`thumbnails`** | pgid died | `evt.pm.consumer.exited(channel)`, `system.alert{channel.restarting}` | **unaffected** (INV-CC-2) | — | **CH-09** auto-restart 3×; the record consumer is never touched (B-06/B-14 death) |
| **EOS timeout on stop** | SIGINT sent, no `Got EOS` within `T-STOP-EOS` (8 s) | `evt.pm.consumer.eos_timeout`, `system.alert{recording.stop-timeout}` | **R-13**: SIGKILL group → finalizing; segment `truncated`, still probed | — | escalate SIGKILL; ts tail playable (PF-4) |
| **EOS timeout on pause** | no `Got EOS` within `T-PAUSE-EOS` (5 s) | `evt.pm.consumer.eos_timeout`, `system.alert{recording.truncated}` | **R-09**: SIGKILL → paused; segment `truncated` | — | as above |
| **Start never confirms** | no PLAYING/file-growth within `T-START-CONFIRM` (5 s) | `evt.pm.consumer.failed{confirm_timeout}` | **R-06** → error (no segments) / **R-07** → stopping (segments exist) | — | manager kills the partial child; failed start can never read as recording (B-12) |
| **Disk full** | core-api storage probe floor breach; manager reports `bytesWritten` stall as corroboration | `evt.storage.floor-breached` (core-api owns the probe) | **R-19** graceful auto-stop; **R-02** refuses new starts | HL-14 critical | on core-api’s stop command the manager EOS-stops the `record` consumer (lecture survives) |
| **Platform element missing** | preflight `gst-inspect` (check_live successor) | `422 platform_element_missing` (sync) / `evt.pm.consumer.failed{element_missing}` | **R-04** (Class A refuse) / **CH-03** (streaming preflight failed) | — | never spawns a doomed pipeline |

Ownership note on disk-full: storage pressure is **machine 5b, owned by core-api**
(the single writer, INV-LS-6). The manager contributes only `bytesWritten` growth
telemetry; it does not decide retention or refuse starts on its own — it executes the
EOS-stop core-api commands at R-19.

---

## 6. Migration plan — `eduscope_web.py` → FastAPI `pipeline-manager`

A-13: Python throughout, evolving the proto-supervisor rather than rewriting it. The
strategy is a **strangler**: stand up the FastAPI shell and supervision first (keeping
proven behavior byte-for-byte), then replace the `.sh` fan-out with the typed builder,
then add health/events/ledger.

### 6.1 Carries over **verbatim** (proven — do not reinvent)

| From `eduscope_web.py` | Kept as | Why |
|---|---|---|
| Process-group spawn (`preexec_fn=os.setsid`) + `killpg(SIGINT)` → `wait(timeout)` → `killpg(SIGKILL)` | the supervisor stop path (§1.3) | the proven EOS-safe stop (B-06 fix) |
| `pgrep -f` liveness + `pkill -INT -f` for orphans on restart | orphan **adoption** (§1.3, BR-1) | survives a manager restart without killing recordings |
| Service registry: `name → (builder, cwd, needs_display, pattern)` | typed registry keyed by `consumerId` | same shape, now typed |
| Runtime settings applied at spawn (`stream_key`, `ratio_a`, `ratio_b`) | typed request payloads (§3.2) | same knobs, validated |
| Per-service last-error map in `/status` | structured `lastError` per publisher/consumer (§3.3) | operator visibility |
| `wait-for-connection=false` shm decoupling; `-e` EOS-on-SIGINT; `leaky=downstream` queues | emitted by the builder (§2) | the core proven mechanics |
| CPU pinning (`taskset -c 4-7`) | a **policy** (§4.3) | keep Vosk off the pipeline cores |

### 6.2 Replaced by typed pipeline building

| Legacy mechanism | Replaced with | Kills |
|---|---|---|
| 27 `.sh` scripts + `_plain/_ratio/_live_key/_live_ratio_key` command builders | **PipelineBuilder + PlatformProfile** (§2); children spawned from an **argv list**, `shell=False` | the 161-string matrix (B-01) and the injection surface (B-63) |
| `SERVICES` dict of 27 named scripts | ~6 parametric consumer classes × presets × ratio (§1.2) | script sprawl — the audit’s core consolidation |
| Flask + `render_template_string` HTML panel | headless FastAPI; the panel is the React app on core-api | UI concerns leave this service |
| `stdout/stderr → DEVNULL` | **captured** stdout(`-m` bus)/stderr parsing → `evt.pm.*` | **B-12** (process-exists ≠ healthy) — the biggest gap |
| “dot on = process exists” status | **confirmed** health (file growth / bus PLAYING, G-CONSUMER-CONFIRMED) + SSE events | B-12, the dead `isError` flag |
| `sends_keys` stdin (`s`/`e` to STT tools) | **dropped** — STT/OCR/slide tools move to the `ai/` service | keeps pipeline-manager media-only |
| Poll-only `/status` | `/status` (truth) **+** `GET /events` SSE push | B-19 leaked intervals; enables event-driven core-api |
| `HOME` script-dir autodetect, hardcoded venv paths | typed config (platform id, socket paths, output dirs, root-helper path) | brittle path discovery |

### 6.3 Staging

1. **Lift-and-shift shell (week 1).** FastAPI wraps the *existing* `.sh` set behind the
   §3 routes; supervision (setsid, targeted SIGINT+EOS, pgrep adoption, `/status`,
   `/events`) goes live against proven pipelines. No builder yet — de-risks the API and
   supervisor independently.
2. **Introduce the builder (weeks 2–3).** Replace `.sh` invocation with the
   PipelineBuilder emitting argv for the RK3588 plug; validate each rendered pipeline
   against its source script (golden-diff the argv). The `.sh` files remain as the
   test oracle, then retire.
3. **Confirmed health, ledger, fallback (weeks 3–4).** Add file-growth/bus
   confirmation, the encode ledger + `409 encoder_budget_exceeded`, and the
   in-pipeline source-loss placeholder (R-SRC-1); wire the capture-card watchdog and
   `POST /device/led`. Land the bench items (§4.4) on hardware.

Retired here and not carried at all: the empty-string exec (B-11), the physical record
button socket half (B-13, [D-12]), the global `killall`/menu-kill (B-06/B-14), and the
JPEG-polling previews (B-17/B-18, replaced by `thumbnails`/`meeting`/`projector`).

---

## 7. Open questions & STOP gate

**Design defaults this document takes (cheap to change now):**

1. **Health via `gst-launch -m` bus parsing + file-growth**, keeping the proven
   subprocess model — rather than building pipelines in-process with `python-gi`. The
   subprocess model isolates a pipeline crash from the manager and is what the engineer
   has already proven; in-process `gi` would give a first-class bus at the cost of
   crash-coupling. **Confirm with the pipeline engineer.**
2. **Source-loss fallback is in-pipeline** (one segment) by default vs restart-with-role-dropped
   (extra segment via R-16) — state-machine-visible; bench item B-T8.
3. **Encode ledger capacity = 2 guaranteed + 1 provisional for thumbnails**, pending
   B-T1/B-T2. If thumbnails prove too heavy, they fall back to a lower-rate transport
   or fewer simultaneous previews (does not touch the record/live guarantee).
4. **`evt.pm.*` transport = SSE `GET /events`.** Alternatives (a callback webhook to
   core-api, or a unix-domain socket) are equivalent; SSE is the simplest one-client
   localhost fit. Contract-confirmed with core-api at prompt 12.

**Depends on unresolved fact-checks:** H-2 (mic ALSA device name — the `audio`
publisher and the meeting embed), H-4 (record-LED GPIO present or not — §1.4), H-5
(passthrough latency — B-T4), and the HDMI-out #2 ALSA device index (example (b)).
None are design-blocking; all are flagged in `hardware-topology.md §5`.

**Contract touch-points for the prompt-12 drift review:** the per-channel `LayoutPresetId`
vocabulary (LP-7), source-status granularity (`pc/cam1/cam2/mic`), and the WebRTC
thumbnails signaling contract (CG-2, Wave 8). This internal API is otherwise
device-internal and does not alter the frontend↔core-api contract (ADR-015).

> **STOP — Phase-3 gate.** This pipeline-manager design awaits review by **the
> architect (user) AND the pipeline engineer** before any implementation. Reviewers
> should focus on: the supervisor health/restart model (§1.3) and the LED/watchdog
> ownership (§1.4); the platform-plug boundary and the three rendered pipelines (§2.3,
> §2.5); the internal API async model + error taxonomy (§3.1, §3.4); the encode/decode
> ledger and bench TODOs (§4.1, §4.4); and the four design defaults above (§7). On
> approval, the streaming-relay design (prompt 11) and the core-api↔pipeline-manager
> contract reconciliation (prompt 12) follow.
