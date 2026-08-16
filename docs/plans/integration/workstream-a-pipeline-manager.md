# Workstream A — Pipeline Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the localhost-only RK3588 pipeline-manager that generates and supervises independent GStreamer publishers and consumers, confirms health, stops only the requested process with EOS, exposes authenticated status/SSE and WebRTC preview signaling, applies real mic/LED controls, and recovers the presentation capture card.

**Architecture:** A FastAPI parent owns typed requests, process-group supervision, state, restart budgets, the encode ledger, and one sequenced SSE stream. Device-lifetime publishers feed fixed shm sockets; independently supervised record/live/meeting/projector/snapshot/WebRTC workers attach to those sockets. Platform-specific GStreamer tokens live only behind `PlatformProfile`; the manager spawns argv arrays with `shell=False`, and the WebRTC worker remains crash-isolated as a child process even though it uses GStreamer's Python bindings for SDP/ICE control.

**Tech Stack:** Python 3.11+ · FastAPI · Pydantic 2 / pydantic-settings · Uvicorn · PyGObject/GStreamer 1.x on RK3588 · pytest/pytest-asyncio · httpx/ASGITransport · PyYAML · POSIX process groups · Bash bench runners · `ffprobe`, `gst-inspect-1.0`, `v4l2-ctl`, `amixer`, `wmctrl`.

## Global Constraints

### BINDING RULES — imported verbatim from the master plan

1. **Contract tests from day one.** The first runnable slice in every service loads or validates against v1.0.0. A route/event is not done until its success and declared Problem/event shapes pass contract tests. Contract changes require a separately approved amendment; implementation may not “fix” the contract locally.
2. **No `sudo` from application code.** Node, Python, browser, and worker code may not invoke `sudo`, a shell, or arbitrary privileged commands. Privileged work crosses `/run/eduscope/helper.sock` and is limited to this fixed verb allowlist: `net.apply`, `volume.mount`, `volume.unmount`, `volume.format`, `usbhub.cycle`, `led.set`, `system.poweroff`, `firmware.check`, `firmware.apply`, `firmware.rollback`, `relay.reload`, `smart.read`. Arguments are schema-validated; the helper uses `execve`/argv and `SO_PEERCRED`; there is no generic-exec verb.
3. **Inventory KEEP behaviors are non-negotiable.** A workstream cannot close while any KEEP item assigned to it lacks the concrete verification identified in the inventory-coverage ledger below. Implementation may change; the observable capability must survive.
4. **The mock adapter stays.** `packages/api-client/src/mock` remains the demo/UI-development environment and contract-regression harness. Every real-adapter or backend contract change must keep mock responses/events and contract-honesty tests green.
5. **Single writers and async commands stay binding.** Only the owning state machine writes its state. A `202 CommandAccepted` is acceptance, not completion; the resolving event must arrive by its contract deadline.
6. **No direct frontend networking.** All panel and quiz REST/WS/WebRTC signaling goes through `packages/api-client`; no component calls `fetch`, `WebSocket`, or a media-signaling endpoint directly.
7. **No task may depend on an open decision.** Encountering one stops that workstream. Update this master plan and ask for review; do not choose an option in code.
8. **Master-plan scope is fixed at workstream planning time.** A JIT workstream plan may expand a task but may not add/drop contract ownership or KEEP coverage. If reality conflicts, update this master plan and flag the gate.

### Workstream A gate acknowledgement required before execution

JIT reconciliation found two related A-03 drifts and corrected the master plan in the same planning run:

- v1's actual channel matrix is Local `{fifty-fifty, side-by-side, cam-1, cam-2, separate-files}`, Meeting `{cams-fifty-fifty, cam-1, cam-2}`, and Streaming `{fifty-fifty, side-by-side, cam-1, cam-2, pc-only}`; the pre-v1 “PC-inclusive Local/Streaming” shorthand is stale.
- `packages/api-client/src/mock/seed/sources.ts` currently carries composite tile sizes that violate the even 16:9 invariant and the proven `scripts/bash/_layout.sh` oracle. A-03 therefore moves layout reference data to one language-neutral shared catalog, makes the mock consume it, and generates the Python package resource from it.

The gate must acknowledge this correction before Task A-01 executes. It changes no public contract shape, master task, contract owner, or KEEP assignment.

### Fixed service rules

- Bind only `127.0.0.1`; the production command is `uvicorn pipeline_manager.app:create_app --factory --host 127.0.0.1 --port 8091`.
- The only client is core-api. Every internal route except `GET /healthz` requires `Authorization: Bearer <shared token>`.
- Canonical v1 roles are `presentation`, `lecturer-cam`, `students-cam`, `mic-lecturer`, `mic-room`. Only the first four are bindable in v1; `mic-room` remains unbound and has no publisher.
- Publisher aliases remain internal: `usb→presentation`, `rtsp→lecturer-cam`, `rtsp2→students-cam`, `audio→mic-lecturer`; shm sockets remain `/tmp/usb.sock`, `/tmp/rtsp.sock`, `/tmp/rtsp2.sock`, `/tmp/audio.sock`.
- Every GStreamer subprocess receives `-e -m`, starts in its own process group, captures stdout/stderr, and is launched from an argv list with `shell=False`. No global `killall`, shell interpolation, or `pkill` from the normal managed-child path.
- Stop deadlines are 5 s for pause and 8 s for stop. Unexpected restart backoff is 1 s, 3 s, 8 s, with at most 3 attempts in 120 s.
- `T-START-CONFIRM=5 s`, `T-SOURCE-DEBOUNCE=3 s`, `T-SOURCE-DEGRADE=2 s`, `T-SOURCE-OFFLINE=10 s`, `T-HEALTH-STALE=6 s`, `T-CAPTURE-PROBE=30 s`, and `T-CAPTURE-RECOVER=25 s`.
- The encode ledger admits two guaranteed video encodes plus one provisional thumbnail encode. Record/live guarantees must not be displaced by a thumbnail request.
- A dead source never ends a lecture: record builders include an in-pipeline placeholder route; a dead record consumer opens a new segment through the core-api state machine rather than silently continuing the old segment.
- The service never derives identity or metadata from output filenames. `outputPath` and separate output paths are supplied by core-api and treated as opaque absolute paths beneath the configured recordings root.
- There is no room-mic implementation, physical record-button input, upload/retention logic, relay configuration mutation, frontend code, or systemd unit in Workstream A. Workstream F owns target package installation and service units.

### Repository and command conventions

All Python commands run from `services/pipeline-manager` with an activated Python 3.11+ environment unless a command explicitly starts with `pnpm`. Install once after A-01:

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[dev]'
```

On Windows planning/dev hosts use `.venv\Scripts\Activate.ps1`; target-board and bench procedures are Bash/Linux. Contract regression means:

```bash
python -m pytest -q
pnpm --filter @eduscope/shared test
pnpm --filter @eduscope/api-client test
```

Expected: all three commands exit 0; pytest prints no failures, and both package test suites remain green. Each task below runs its focused tests before this regression and makes exactly one commit.

---

## File and responsibility map

| Area | Files | Responsibility |
|---|---|---|
| Service shell | `pyproject.toml`, `pipeline_manager/app.py`, `config.py`, `models.py` | package metadata, settings, application lifetime, shared internal types |
| Shared catalog | `packages/shared/src/constants/layout-presets.json`, generated `resources/layout-presets.v1.json` | one reference-data source for v1 layouts; mock and Python consume the same data |
| Builder | `pipelines/platforms/*`, `preflight.py`, `layouts.py`, `profiles.py`, `builder.py`, one module per consumer | typed source→compose→sink argv generation; no spawn/state logic |
| Supervisor | `supervisor/process.py`, `health.py`, `ledger.py`, `stop.py`, `recovery.py` | child ownership, confirmation, budgets, EOS stop, adoption |
| Runtime adapters | `publishers/*`, `consumers/*`, `audio/*`, `hardware/*` | class-specific lifecycle policy and device I/O; no FastAPI concerns |
| Internal API | `api/auth.py`, `routes.py`, `events.py` | bearer enforcement, 202 command surface, truth snapshots, sequenced SSE |
| Evidence | `scripts/bench/*.sh`, `tests/bench/README.md`, `tests/bench/evidence/*.md` | repeatable target-board gates and captured results |

---

### Task A-01: Service skeleton and internal schemas

**Files:**
- Create: `services/pipeline-manager/pyproject.toml`
- Create: `services/pipeline-manager/src/pipeline_manager/__init__.py`
- Create: `services/pipeline-manager/src/pipeline_manager/config.py`
- Create: `services/pipeline-manager/src/pipeline_manager/models.py`
- Create: `services/pipeline-manager/src/pipeline_manager/app.py`
- Create: `services/pipeline-manager/tests/conftest.py`
- Create: `services/pipeline-manager/tests/test_contract_models.py`
- Create: `services/pipeline-manager/tests/test_app.py`

**Interfaces:**
- Consumes: v1 enums from `contracts/openapi.yaml`; repository Python floor 3.11 from `revamp-guide/01-setup.md`.
- Produces: `Settings`, canonical enums, request/status/event models, `create_app(settings: Settings | None = None) -> FastAPI`, and an unauthenticated `GET /healthz` returning `{"status":"ok","service":"pipeline-manager"}`.

- [ ] **Step 1: Add package configuration**

Create `pyproject.toml` exactly as follows. PyGObject is intentionally not a pip dependency: Workstream F installs the board's matching `python3-gi`/GStreamer packages, while unit tests never import GI at module import time.

```toml
[build-system]
requires = ["hatchling>=1.27,<2"]
build-backend = "hatchling.build"

[project]
name = "eduscope-pipeline-manager"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.116,<1",
  "pydantic>=2.10,<3",
  "pydantic-settings>=2.7,<3",
  "PyYAML>=6.0,<7",
  "uvicorn[standard]>=0.34,<1",
]

[project.optional-dependencies]
dev = [
  "httpx>=0.28,<1",
  "pytest>=8.3,<9",
  "pytest-asyncio>=0.25,<1",
]

[tool.hatch.build.targets.wheel]
packages = ["src/pipeline_manager"]

[tool.pytest.ini_options]
addopts = "-ra --strict-markers --strict-config"
asyncio_mode = "auto"
testpaths = ["tests"]
markers = ["board: requires the RK3588 target board"]
```

- [ ] **Step 2: Write failing schema and bind tests**

`test_contract_models.py` must parse `../../../contracts/openapi.yaml`, assert `info.version == "1.0.0"`, compare `SourceRoleId` and `LayoutPresetId` enums to the Python enums, reject `mic-room` as a publisher binding, reject relative/output paths outside `recordings_root`, and verify `ratioA/ratioB` are both present or both absent and each positive. `test_app.py` must call `create_app(Settings(...))` through `httpx.ASGITransport`, assert `/healthz` is 200, and assert `Settings(bind_host="0.0.0.0")` raises `ValidationError`.

```python
def test_v1_source_and_preset_vocabularies_match_contract(contract: dict) -> None:
    schemas = contract["components"]["schemas"]
    assert contract["info"]["version"] == "1.0.0"
    assert set(schemas["SourceRoleId"]["enum"]) == {item.value for item in SourceRole}
    assert set(schemas["LayoutPresetId"]["enum"]) == {item.value for item in LayoutPresetId}

def test_service_cannot_bind_publicly() -> None:
    with pytest.raises(ValidationError, match="127.0.0.1"):
        Settings(bind_host="0.0.0.0", shared_bearer_token="x" * 32)
```

- [ ] **Step 3: Run the tests to verify the slice is red**

Run: `python -m pytest tests/test_contract_models.py tests/test_app.py -q`

Expected: collection fails with `ModuleNotFoundError: No module named 'pipeline_manager'` or imports fail for the not-yet-defined models.

- [ ] **Step 4: Implement the minimal typed shell**

Use string enums for `SourceRole`, `PublisherId`, `Channel`, `LayoutPresetId`, `PublisherState`, `ConsumerState`, `ConsumerKind`, `CaptureCardState`, and `LedMode`. Define strict Pydantic models (`ConfigDict(extra="forbid")`) for ratios, starts/stops, status, Problem, accepted commands, and internal events. The mechanical settings object is:

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="EDUSCOPE_PM_", extra="ignore")
    bind_host: str = "127.0.0.1"
    port: int = Field(default=8091, ge=1, le=65535)
    platform_id: Literal["rk3588"] = "rk3588"
    shared_bearer_token: str = Field(min_length=32)
    recordings_root: Path = Path("/media/eduscope/recordings")
    helper_socket: Path = Path("/run/eduscope/helper.sock")
    event_replay_size: int = Field(default=512, ge=32, le=4096)

    @field_validator("bind_host")
    @classmethod
    def localhost_only(cls, value: str) -> str:
        if value != "127.0.0.1":
            raise ValueError("pipeline-manager must bind to 127.0.0.1")
        return value
```

Use `Path.resolve(strict=False).is_relative_to(settings.recordings_root.resolve())` before accepting record/snapshot output paths. Do not create directories in a validator. `create_app` stores settings at `app.state.settings`, returns the fixed health payload, and does not start publishers yet.

- [ ] **Step 5: Prove models, contract vocabulary, and localhost health**

Run: `python -m pytest tests/test_contract_models.py tests/test_app.py -q`

Expected: `2` test files pass, including v1.0.0 vocabulary parity and the public-bind refusal.

Run on the target/dev host:

```bash
EDUSCOPE_PM_SHARED_BEARER_TOKEN=0123456789abcdef0123456789abcdef \
  uvicorn pipeline_manager.app:create_app --factory --host 127.0.0.1 --port 8091 &
curl --fail --silent http://127.0.0.1:8091/healthz
```

Expected: `{"status":"ok","service":"pipeline-manager"}` and exit 0. `curl http://<device-lan-ip>:8091/healthz` must fail to connect.

- [ ] **Step 6: Run regression and commit**

```bash
python -m pytest -q
pnpm --filter @eduscope/shared test
pnpm --filter @eduscope/api-client test
git add services/pipeline-manager
git commit -m "feat(pipeline-manager): add typed localhost service shell"
```

Expected: all tests exit 0; commit contains only A-01 files.

---

### Task A-02: RK3588 platform plug and preflight

**Files:**
- Create: `services/pipeline-manager/src/pipeline_manager/pipelines/__init__.py`
- Create: `services/pipeline-manager/src/pipeline_manager/pipelines/platforms/__init__.py`
- Create: `services/pipeline-manager/src/pipeline_manager/pipelines/platforms/base.py`
- Create: `services/pipeline-manager/src/pipeline_manager/pipelines/platforms/rk3588.py`
- Create: `services/pipeline-manager/src/pipeline_manager/pipelines/preflight.py`
- Create: `services/pipeline-manager/tests/pipelines/test_rk3588.py`
- Create: `services/pipeline-manager/tests/pipelines/test_preflight.py`

**Interfaces:**
- Consumes: A-01 enums/settings; `scripts/bash/check_live.sh` as the proven element oracle.
- Produces: `PlatformProfile` protocol, `RK3588Profile`, `PreflightRunner.run(profile, *, include_webrtc: bool) -> PreflightReport`, and error code `platform_element_missing`.

- [ ] **Step 1: Write failing platform/preflight tests**

Tests must assert role methods return token lists, never shell strings; required elements include `shmsrc`, `shmsink`, `mpph264enc`, `mppvideodec`, `videoconvert`, `videoscale`, `compositor`, `voaacenc`, `aacparse`, `mpegtsmux`, `flvmux`, `xvimagesink`, `alsasink`, `rtmpsink`, and `webrtcbin`; argv is exactly `['gst-inspect-1.0', element]`; a runner return code 1 produces a report containing every missing element and no spawn occurs downstream.

```python
async def test_missing_element_is_named() -> None:
    run = AsyncMock(side_effect=[completed(0), completed(1, stderr="No such element")])
    report = await PreflightRunner(run=run).inspect(["mpph264enc", "webrtcbin"])
    assert report.ok is False
    assert report.problems[0].code == "platform_element_missing"
    assert report.problems[0].meta == {"element": "webrtcbin"}
```

- [ ] **Step 2: Run red tests**

Run: `python -m pytest tests/pipelines/test_rk3588.py tests/pipelines/test_preflight.py -q`

Expected: FAIL because `PlatformProfile` and `PreflightRunner` do not exist.

- [ ] **Step 3: Implement the plug and argv-only preflight**

`base.py` defines immutable `Pad`, `EncodeProfileLike`, and the exact `PlatformProfile` protocol from `pipeline-manager.md` §2.3. `rk3588.py` is the only production module allowed to name RK3588 elements. `preflight.py` injects an async exec-file adapter equivalent to:

```python
proc = await asyncio.create_subprocess_exec(
    "gst-inspect-1.0", element,
    stdout=asyncio.subprocess.PIPE,
    stderr=asyncio.subprocess.PIPE,
)
stdout, stderr = await proc.communicate()
```

It does not use `create_subprocess_shell`, `shell=True`, `sudo`, relay mutation, or a test push. Relay-state and target activation belong to B/F; A verifies only local pipeline dependencies.

- [ ] **Step 4: Run unit and contract regression**

Run: `python -m pytest tests/pipelines/test_rk3588.py tests/pipelines/test_preflight.py -q`

Expected: all platform and missing-element cases pass.

On RK3588 run:

```bash
python -m pipeline_manager.pipelines.preflight --platform rk3588 --include-webrtc
```

Expected: exit 0 and one `present` row for every required element. Temporarily set `GST_PLUGIN_PATH` to an empty fixture directory and pass `--element definitely_missing`; expected exit 2 with `platform_element_missing` naming that element.

- [ ] **Step 5: Commit**

```bash
python -m pytest -q
git add services/pipeline-manager/src/pipeline_manager/pipelines services/pipeline-manager/tests/pipelines
git commit -m "feat(pipeline-manager): add RK3588 platform preflight"
```

---

### Task A-03: Preset geometry and encode profiles

**Files:**
- Create: `packages/shared/src/constants/layout-presets.json`
- Modify: `packages/shared/src/index.ts` — export the JSON catalog as a typed constant
- Modify: `packages/api-client/src/mock/seed/sources.ts` — consume the shared catalog instead of declaring seven rows
- Create: `services/pipeline-manager/scripts/sync_layout_catalog.py`
- Create: `services/pipeline-manager/src/pipeline_manager/resources/__init__.py`
- Create: `services/pipeline-manager/src/pipeline_manager/resources/layout-presets.v1.json`
- Create: `services/pipeline-manager/src/pipeline_manager/pipelines/layouts.py`
- Create: `services/pipeline-manager/src/pipeline_manager/pipelines/profiles.py`
- Create: `services/pipeline-manager/tests/fixtures/layouts/geometry.json`
- Create: `services/pipeline-manager/tests/pipelines/test_layouts.py`
- Create: `services/pipeline-manager/tests/pipelines/test_profiles.py`
- Modify: `services/pipeline-manager/tests/test_contract_models.py` — add catalog/mock parity assertions
- Modify: `services/pipeline-manager/pyproject.toml` — include JSON package data

**Interfaces:**
- Consumes: A-01 enums; v1 allowed-channel matrix; `_layout.sh::ratio_layout`; B-56 ranges `videoBitrateKbps 2000..8000`, fps used by pipeline, GOP 30/60.
- Produces: immutable `Tile`, `OutputSpec`, `LayoutPreset`, `EncodeProfile`; `get_layout(preset_id, channel, ratio_a, ratio_b)`; `get_profile(kind, overrides)`; one shared source catalog and a generated Python resource.

- [ ] **Step 1: Create failing catalog and geometry tests**

The table-driven test must enumerate all 21 channel×preset pairs and assert the exact 13 allowed pairs from the gate correction. Geometry tests call `ratio_geometry(50, 50)` and `ratio_geometry(70, 30)` and assert even x/y/w/h, `w:h == 16:9` after integer-even rounding, canvas bounds, and no overlap. Profile tests reject bitrate 1999/8001, fps 0, and unsupported codec/container; they prove bitrate and fps appear in rendered profile data (KEEP B-56).

```python
ALLOWED = {
    Channel.LOCAL: {"fifty-fifty", "side-by-side", "cam-1", "cam-2", "separate-files"},
    Channel.MEETING: {"cams-fifty-fifty", "cam-1", "cam-2"},
    Channel.STREAMING: {"fifty-fifty", "side-by-side", "cam-1", "cam-2", "pc-only"},
}

@pytest.mark.parametrize("channel,preset", itertools.product(Channel, LayoutPresetId))
def test_exact_v1_channel_matrix(channel: Channel, preset: LayoutPresetId) -> None:
    if preset.value in ALLOWED[channel]:
        assert get_layout(preset, channel, 50, 50).id is preset
    else:
        with pytest.raises(PresetChannelMismatch):
            get_layout(preset, channel, 50, 50)
```

- [ ] **Step 2: Run red tests**

Run: `python -m pytest tests/pipelines/test_layouts.py tests/pipelines/test_profiles.py tests/test_contract_models.py -q`

Expected: FAIL because the shared catalog, loader, profiles, and generated resource do not exist.

- [ ] **Step 3: Add the canonical JSON catalog and deterministic sync wrapper**

The catalog contains all `LayoutPreset` fields from the v1 schema. Composite default geometry must use `_layout.sh` arithmetic: 50/50 rows are `(0,270,960,540)` and `(960,270,960,540)`; `side-by-side` defaults to 2:1 rows `(0,180,1280,720)` and `(1280,360,640,360)`. Single tiles are 1920×1080. `separate-files` carries two full-frame outputs and produces no composite.

The sync wrapper is complete and mechanical:

```python
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "packages/shared/src/constants/layout-presets.json"
TARGET = ROOT / "services/pipeline-manager/src/pipeline_manager/resources/layout-presets.v1.json"

def main() -> None:
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SOURCE, TARGET)

if __name__ == "__main__":
    main()
```

Add `packages = ["src/pipeline_manager"]` plus:

```toml
[tool.hatch.build]
include = ["src/pipeline_manager/**/*.py", "src/pipeline_manager/resources/*.json"]
```

The TypeScript mock imports the JSON, validates every row through `zLayoutPreset.parse`, and exports no second literal catalog. The Python loader reads the package resource with `importlib.resources.files` and converts rows to frozen dataclasses. The freshness test compares the source and generated JSON after canonical `json.loads`, then scans `sources.ts` to prove the old literal `const layoutPresets: LayoutPreset[] = [` is gone.

- [ ] **Step 4: Implement ratios and profiles**

Port `_layout.sh` arithmetic exactly, including even rounding; do not call the shell script at runtime. `get_layout` checks the catalog's `allowedChannels`, substitutes ratio geometry only for `parametric` two-tile rows, and raises typed `InvalidRatio`/`PresetChannelMismatch`. Profiles are data records: record composite 4 Mbps/GOP30/mpegts, record USB separate 6 Mbps/GOP30/mpegts, live 4 Mbps/GOP60/flv, passthrough/no encode/mpegts, thumbnail provisional low profile. Overrides accept only the v1 B-56 range and preserve per-channel bitrate/fps.

- [ ] **Step 5: Regenerate, run Python and mock/shared tests**

```bash
python scripts/sync_layout_catalog.py
python -m pytest tests/pipelines/test_layouts.py tests/pipelines/test_profiles.py tests/test_contract_models.py -q
pnpm --filter @eduscope/shared test
pnpm --filter @eduscope/api-client test
```

Expected: all 21 applicability cases pass; geometry golden is exact; generated resource is fresh; shared and mock suites stay green. KEEP B-56/B-60 are now executable.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/constants/layout-presets.json packages/shared/src/index.ts packages/api-client/src/mock/seed/sources.ts services/pipeline-manager
git commit -m "feat(pipeline-manager): align v1 layouts and encode profiles"
```

---

### Task A-04: Record pipeline builder

**Files:**
- Create: `services/pipeline-manager/src/pipeline_manager/pipelines/builder.py`
- Create: `services/pipeline-manager/src/pipeline_manager/pipelines/record.py`
- Create: `services/pipeline-manager/tests/fixtures/pipelines/record/*.json`
- Create: `services/pipeline-manager/tests/pipelines/test_builder.py`
- Create: `services/pipeline-manager/tests/pipelines/test_record.py`

**Interfaces:**
- Consumes: `PlatformProfile`, `LayoutPreset`, `EncodeProfile`, publisher socket/caps mapping, opaque output paths.
- Produces: `PipelineSpec(argv: tuple[str, ...], required_roles, encode_slots, outputs, placement=None)` and `build_record(request, platform) -> PipelineSpec`.

- [ ] **Step 1: Write failing builder/golden tests**

Cover `fifty-fifty`, `side-by-side`, `cam-1`, `cam-2`, `pc-only` refusal on Local, and `separate-files`. Assertions must prove: argv begins `gst-launch-1.0 -e -m`; composite uses one encoder/one mux; single H.264 camera uses no decoder/encoder; raw presentation is re-encoded; separate-files uses one child, two muxes, one USB encode, one camera passthrough; every output path is an individual argv token; camera-only builds when `presentation` is absent; unsupported source/profile/container combinations raise before any spawn.

Golden fixtures are JSON token arrays, not shell strings. Populate the initial fixtures by tokenizing the proven `rec_usb_cam1_5050.sh`, `rec_cam1.sh`, `rec_cam2.sh`, and `rec_usb_cam1_separate.sh`; normalize only output paths and timestamp-derived names.

- [ ] **Step 2: Run red tests**

Run: `python -m pytest tests/pipelines/test_builder.py tests/pipelines/test_record.py -q`

Expected: FAIL for missing `PipelineBuilder`/`build_record`.

- [ ] **Step 3: Implement source→compose→sink assembly**

`PipelineBuilder` exposes only token operations (`add(*tokens)`, `branch(tokens)`, `build()`) and rejects tokens containing NUL/newline. It never joins tokens for spawning. `record.py` performs these exact branches:

```python
def build_record(req: RecordStart, platform: PlatformProfile) -> PipelineSpec:
    layout = get_layout(req.preset, Channel.LOCAL, req.ratio_a, req.ratio_b)
    if layout.kind == "multi-file":
        return _build_separate(req, layout, platform)
    if layout.passthrough_eligible and _is_h264_single(layout, req.bindings):
        return _build_camera_passthrough(req, layout, platform)
    return _build_composite_or_raw(req, layout, platform)
```

Every decoded/composite path has `queue max-size-buffers=6 leaky=downstream`, `videorate drop-only=true`, 30 fps normalization, geometry from A-03, mic AAC 128 kbps, and `mpegtsmux alignment=7`. The source-loss branch adds a selector/fallback placeholder per required video role without changing process identity.

- [ ] **Step 4: Prove exact argv and early refusal**

Run: `python -m pytest tests/pipelines/test_builder.py tests/pipelines/test_record.py -q`

Expected: all golden token arrays match; negative cases show `preset_channel_mismatch`, `invalid_preset`, or `unsupported_pipeline` before the injected spawn mock is called.

- [ ] **Step 5: Regression and commit**

```bash
python -m pytest -q
git add services/pipeline-manager/src/pipeline_manager/pipelines services/pipeline-manager/tests
git commit -m "feat(pipeline-manager): generate typed record pipelines"
```

---

### Task A-05: Live and meeting builders

**Files:**
- Create: `services/pipeline-manager/src/pipeline_manager/pipelines/live.py`
- Create: `services/pipeline-manager/src/pipeline_manager/pipelines/meeting.py`
- Create: `services/pipeline-manager/tests/fixtures/pipelines/live/*.json`
- Create: `services/pipeline-manager/tests/fixtures/pipelines/meeting/*.json`
- Create: `services/pipeline-manager/tests/pipelines/test_live.py`
- Create: `services/pipeline-manager/tests/pipelines/test_meeting.py`

**Interfaces:**
- Consumes: A-02 platform, A-03 exact channel matrix/profiles, A-04 `PipelineSpec`/builder.
- Produces: `build_live(request, platform) -> PipelineSpec` and `build_meeting(request, platform) -> PipelineSpec`.

- [ ] **Step 1: Write failing live/meeting tests**

Live tests cover every Streaming preset, exact `rtmp://127.0.0.1:1935/live/<key> live=1` token, GOP60, AAC into `flvmux streamable=true`, and one encode slot. Reject stream keys outside `[A-Za-z0-9_-]{1,32}` and Meeting-only presets. Meeting tests cover `cams-fifty-fifty`, `cam-1`, `cam-2`, no video encoder, HDMI #2 `xvimagesink`, and a separate mic branch to the configured HDMI ALSA device. Assert meeting rejects `presentation` presets and works without the USB publisher.

- [ ] **Step 2: Run red tests**

Run: `python -m pytest tests/pipelines/test_live.py tests/pipelines/test_meeting.py -q`

Expected: FAIL because both builders are absent.

- [ ] **Step 3: Implement minimal builders**

Reuse A-04's normalized source/compose helpers; do not duplicate element chains. `build_live` selects `live-composite`, emits exactly one encoder branch and no relay configuration commands. `build_meeting` emits display video plus `audioconvert ! audioresample ! alsasink device=<configured HDMI #2> sync=false`; its `PipelineSpec.placement` is an immutable `DisplayPlacement(output=HDMI_2, x=1920, y=0, width=1920, height=1080, fullscreen=True)` applied after PLAYING.

Stream-before-record ordering is not implemented here: B activates push targets before calling this builder. The manager assumes a ready local RTMP endpoint and does not mutate nginx.

- [ ] **Step 4: Run focused tests and target parity bench**

Run: `python -m pytest tests/pipelines/test_live.py tests/pipelines/test_meeting.py -q`

Expected: all channel applicability, key validation, audio branch, encode count, and fixture cases pass.

On the board render argv with `python -m pipeline_manager.pipelines.live --preset fifty-fifty --ratio-a 50 --ratio-b 50 --stream-key bench` and compare the JSON token list to `scripts/bash/live_usb_cam1_5050.sh`; render Meeting and compare its source/compose/display roles to `prev_cam1_cam2_5050.sh`. Expected: only `-m`, configured addresses, and the required HDMI-audio branch differ from the legacy oracle.

- [ ] **Step 5: Commit**

```bash
python -m pytest -q
git add services/pipeline-manager/src/pipeline_manager/pipelines services/pipeline-manager/tests
git commit -m "feat(pipeline-manager): generate live and meeting pipelines"
```

---

### Task A-06: Projector, snapshot, and thumbnail builders

**Files:**
- Create: `services/pipeline-manager/src/pipeline_manager/pipelines/projector.py`
- Create: `services/pipeline-manager/src/pipeline_manager/pipelines/snapshot.py`
- Create: `services/pipeline-manager/src/pipeline_manager/pipelines/thumbnails.py`
- Create: `services/pipeline-manager/tests/fixtures/projector/question.json`
- Create: `services/pipeline-manager/tests/pipelines/test_projector.py`
- Create: `services/pipeline-manager/tests/pipelines/test_snapshot.py`
- Create: `services/pipeline-manager/tests/pipelines/test_thumbnails.py`

**Interfaces:**
- Consumes: A-02 `webrtcbin` capability, A-04 builder, publisher role/socket map.
- Produces: projector controller argv/control message, atomic snapshot argv/spec, and crash-isolated thumbnail worker command protocol: stdin JSON `offer|ice|close`, stdout JSON `answer|ice|error|playing`.

- [ ] **Step 1: Write failing aux-builder tests**

Projector tests assert passthrough and question modes share the same child id/pgid, question data is sent as a validated control message (not interpolated into argv), no leaderboard/answer/participant fields are accepted, and HDMI #1 placement is selected. Snapshot tests assert `intervalSec>=1`, a temporary sibling path `<output>.tmp`, fsync/`os.replace` publication, and no partial final PNG. Thumbnail tests assert one worker per negotiation, role allowlist excludes `mic-room`, frame limits are 480×270/15 fps initially, encode reservation is `thumbnail`, and every control line validates before reaching the worker.

- [ ] **Step 2: Run red tests**

Run: `python -m pytest tests/pipelines/test_projector.py tests/pipelines/test_snapshot.py tests/pipelines/test_thumbnails.py -q`

Expected: FAIL for missing builders/protocol models.

- [ ] **Step 3: Implement projector and atomic snapshot**

Projector uses a single long-running worker with an input-selector: `set_mode(ProjectorMode.PASSTHROUGH|QUESTION, payload)` writes a length-delimited JSON control message to that worker. Define `QuestionOverlay` with only `question_text`, ordered `options`, and `join_qr_png_path`; `extra="forbid"` makes leaderboard/PII structurally impossible. Snapshot writes PNG to the temporary path; a small watcher confirms nonzero size, calls `os.replace(temp, final)`, and emits updated metadata.

- [ ] **Step 4: Implement the thumbnail worker boundary**

`thumbnails.py` has no GI import at module import time. Its worker entry point imports `gi`, requires Gst 1.0, builds the selected shm source→optional camera decode→scale/rate→hardware encoder→RTP→`webrtcbin` graph, and exchanges compact JSON lines. The FastAPI parent still supervises a subprocess and never hosts an in-process media pipeline. Use these strict message models:

```python
class ThumbnailOffer(ControlMessage):
    type: Literal["offer"]
    negotiation_id: str
    role_id: SourceRole
    sdp: str = Field(min_length=1, max_length=131_072)

class ThumbnailIce(ControlMessage):
    type: Literal["ice"]
    negotiation_id: str
    candidate: str = Field(max_length=8_192)
    sdp_mid: str | None = Field(default=None, max_length=128)
    sdp_mline_index: int | None = Field(default=None, ge=0, le=64)
```

The worker emits no panel contract envelope directly; A-11/A-14 map its typed messages through core-api's internal bridge.

- [ ] **Step 5: Run tests and manual mode/atomicity checks**

Run: `python -m pytest tests/pipelines/test_projector.py tests/pipelines/test_snapshot.py tests/pipelines/test_thumbnails.py -q`

Expected: all mode, privacy, path, rate, and worker-protocol tests pass. Projector mode test asserts spawn count remains one; snapshot test never observes a partial final file.

- [ ] **Step 6: Commit**

```bash
python -m pytest -q
git add services/pipeline-manager/src/pipeline_manager/pipelines services/pipeline-manager/tests
git commit -m "feat(pipeline-manager): build projector snapshot and previews"
```

---

### Task A-07: Process supervisor and health confirmation

**Files:**
- Create: `services/pipeline-manager/src/pipeline_manager/supervisor/__init__.py`
- Create: `services/pipeline-manager/src/pipeline_manager/supervisor/process.py`
- Create: `services/pipeline-manager/src/pipeline_manager/supervisor/health.py`
- Create: `services/pipeline-manager/src/pipeline_manager/supervisor/ledger.py`
- Create: `services/pipeline-manager/tests/supervisor/fake_child.py`
- Create: `services/pipeline-manager/tests/supervisor/test_process.py`
- Create: `services/pipeline-manager/tests/supervisor/test_health.py`
- Create: `services/pipeline-manager/tests/supervisor/test_ledger.py`

**Interfaces:**
- Consumes: any `PipelineSpec` from A-04..A-06.
- Produces: `ProcessSupervisor.start(spec, identity) -> ManagedProcess`, parsed bus observations, `HealthConfirmer`, and reservation-based `EncodeLedger`.

- [ ] **Step 1: Write failing supervisor tests**

The fake child accepts modes `playing`, `grow:<path>`, `error`, `qos`, and `hang`. Tests inspect the injected `Popen` arguments and fail if `shell` is not exactly `False`, `start_new_session` is not true, or argv is a string. Assert non-file consumers confirm only after PLAYING, record confirms only after PLAYING plus growth across two samples, timeout emits `confirm_timeout`, ERROR emits `element_error`, and reservations roll back when spawn/confirm fails. Ledger tests prove capacity 3, two guaranteed record/live slots cannot be displaced by thumbnail, and a fourth start returns `encoder_budget_exceeded` without spawning.

- [ ] **Step 2: Run red tests**

Run: `python -m pytest tests/supervisor/test_process.py tests/supervisor/test_health.py tests/supervisor/test_ledger.py -q`

Expected: FAIL for missing supervisor modules.

- [ ] **Step 3: Implement argv-only process ownership and bus parsing**

Use `subprocess.Popen(list(spec.argv), shell=False, start_new_session=True, stdin=PIPE when controlled, stdout=PIPE, stderr=PIPE, text=True, bufsize=1)`. Capture `pgid=os.getpgid(pid)` and store by stable identity. Two daemon reader threads/tasks feed one asyncio queue; parse only normalized observations (`PLAYING`, `EOS`, `ERROR`, `QOS`) while preserving the final 100 raw lines for diagnostics.

`HealthConfirmer` accepts injected clock/stat functions. For record, sample size twice at 250 ms minimum separation; for other classes, PLAYING is enough. A child is never exposed as `running` before confirmation.

- [ ] **Step 4: Implement atomic encode reservations**

`EncodeLedger.reserve(owner, slots, priority)` returns a context-managed reservation. Starts reserve before spawn, commit after spawn, and release on every terminal path. Capacity is 3, but `thumbnail` may use only the provisional third slot; it cannot consume either guaranteed record/live slot.

- [ ] **Step 5: Prove supervisor invariants**

Run: `python -m pytest tests/supervisor/test_process.py tests/supervisor/test_health.py tests/supervisor/test_ledger.py -q`

Expected: fake child becomes running only after required observations; `shell=True`, string argv, over-budget, and incomplete confirmation cases are rejected; reservation counts return to zero after failure.

- [ ] **Step 6: Commit**

```bash
python -m pytest -q
git add services/pipeline-manager/src/pipeline_manager/supervisor services/pipeline-manager/tests/supervisor
git commit -m "feat(pipeline-manager): supervise and confirm media processes"
```

---

### Task A-08: Targeted EOS stop and orphan adoption

**Files:**
- Create: `services/pipeline-manager/src/pipeline_manager/supervisor/stop.py`
- Create: `services/pipeline-manager/src/pipeline_manager/supervisor/recovery.py`
- Create: `services/pipeline-manager/tests/supervisor/test_stop.py`
- Create: `services/pipeline-manager/tests/supervisor/test_recovery.py`
- Create: `services/pipeline-manager/tests/supervisor/test_no_global_kill.py`

**Interfaces:**
- Consumes: A-07 `ManagedProcess` registry/observations.
- Produces: `stop_process(identity, deadline) -> StopResult(clean_eos, truncated, exit_code)` and `recover_orphans(expected) -> list[AdoptedProcess]`.

- [ ] **Step 1: Write failing stop/recovery tests**

Use two real fake-child process groups. Stop one and assert the other remains alive. Clean child must receive group SIGINT, print EOS, and return `truncated=False`; hanging child must receive SIGINT, then group SIGKILL after an injected deadline and return `truncated=True`, code `eos_timeout`. Recovery tests use an injected `/proc` scanner and ownership sidecar metadata to adopt only exact executable + opaque consumer id + output path matches; ambiguous or foreign processes are reported and not signaled. Static test scans `src/` and rejects `killall`, `pkill`, `shell=True`, `create_subprocess_shell`, and `sudo`.

- [ ] **Step 2: Run red tests**

Run: `python -m pytest tests/supervisor/test_stop.py tests/supervisor/test_recovery.py tests/supervisor/test_no_global_kill.py -q`

Expected: FAIL for missing targeted stop/recovery.

- [ ] **Step 3: Implement targeted EOS and timeout escalation**

The mechanical signal sequence is:

```python
os.killpg(process.pgid, signal.SIGINT)
try:
    await asyncio.wait_for(process.eos_seen.wait(), timeout=deadline.seconds)
    await asyncio.to_thread(process.popen.wait, deadline.remaining())
    return StopResult(clean_eos=True, truncated=False, exit_code=process.popen.returncode)
except TimeoutError:
    os.killpg(process.pgid, signal.SIGKILL)
    await asyncio.to_thread(process.popen.wait)
    return StopResult(clean_eos=False, truncated=True, exit_code=process.popen.returncode,
                      error_code="eos_timeout")
```

Use 5 s for pause, 8 s for stop. Release only that process's ledger reservation after exit.

- [ ] **Step 4: Implement conservative orphan adoption**

At spawn write an atomic JSON sidecar under configured runtime dir with manager marker, identity, pid, pgid, argv hash, kind, output path, and started time. Recovery reads sidecars, checks `/proc/<pid>/stat` start time and argv hash to prevent PID reuse, then attaches a non-owning process handle and resumes file-growth/liveness sampling. Missing/mismatched sidecars are logged as foreign; no broad pattern signal is allowed.

- [ ] **Step 5: Prove EOS finalization and independent survival**

Run: `python -m pytest tests/supervisor/test_stop.py tests/supervisor/test_recovery.py tests/supervisor/test_no_global_kill.py -q`

Expected: all pass; the sibling process survives; timeout is marked truncated; exact orphan adopts.

On the board start record and preview from generated argv, stop only record, then run `ffprobe -v error -show_entries format=duration <segment.ts>`. Expected: numeric positive duration, preview process still alive. Restart the manager while record grows; expected: `/status` later reports the same pid/pgid with `adopted=true`.

- [ ] **Step 6: Commit**

```bash
python -m pytest -q
git add services/pipeline-manager/src/pipeline_manager/supervisor services/pipeline-manager/tests/supervisor
git commit -m "feat(pipeline-manager): stop and recover exact process groups"
```

---

### Task A-09: Publisher supervision

**Files:**
- Create: `services/pipeline-manager/src/pipeline_manager/publishers/__init__.py`
- Create: `services/pipeline-manager/src/pipeline_manager/publishers/base.py`
- Create: `services/pipeline-manager/src/pipeline_manager/publishers/usb.py`
- Create: `services/pipeline-manager/src/pipeline_manager/publishers/rtsp.py`
- Create: `services/pipeline-manager/src/pipeline_manager/publishers/audio.py`
- Create: `services/pipeline-manager/tests/publishers/test_builders.py`
- Create: `services/pipeline-manager/tests/publishers/test_supervision.py`
- Create: `services/pipeline-manager/tests/fixtures/events/publisher.json`

**Interfaces:**
- Consumes: A-02 platform, A-07 supervisor/health, A-08 exact recovery.
- Produces: four boot-managed `PublisherController`s, source-health snapshots, and internal `evt.pm.publisher.running|degraded|exited|failed` payloads.

- [ ] **Step 1: Write failing publisher tests**

Assert exact sockets/rings: USB 64,000,000 bytes raw NV12 1080p60; RTSP/RTSP2 20,000,000 bytes H.264 byte-stream with TCP and 100 ms latency; audio 4,000,000 bytes S16LE 48 kHz stereo. Every shmsink has `wait-for-connection=false`; cameras are not decoded. Supervision tests use a fake clock to prove delays 1/3/8 seconds, max 3 attempts/120 s, exhaustion→offline, binding/manual retry resets the budget, and telemetry older than 6 s→unknown rather than last healthy.

- [ ] **Step 2: Run red tests**

Run: `python -m pytest tests/publishers -q`

Expected: FAIL because publisher controllers/builders do not exist.

- [ ] **Step 3: Implement publisher specs and lifecycle**

`PublisherController` owns one fixed `PublisherId`, current binding, process identity `publisher:<id>`, restart budget, and health reducer. It starts at app lifetime only after a valid binding and A-02 preflight. A publisher death never sends signals to consumers. RTSP credentials arrive separately from address and are inserted only as GStreamer property tokens; status/errors redact credentials.

Map internal publisher ids to canonical v1 roles once in `base.py`:

```python
PUBLISHER_ROLES = {
    PublisherId.USB: SourceRole.PRESENTATION,
    PublisherId.RTSP: SourceRole.LECTURER_CAM,
    PublisherId.RTSP2: SourceRole.STUDENTS_CAM,
    PublisherId.AUDIO: SourceRole.MIC_LECTURER,
}
```

- [ ] **Step 4: Validate internal event fixtures and restart isolation**

Fixtures contain `publisherId`, canonical `roleId`, state, fps/rms, lastError, occurredAt, and monotonically increasing sequence. Tests kill each fake publisher, assert only its pid changes, and assert registered fake consumers are untouched.

Run: `python -m pytest tests/publishers -q`

Expected: all socket, no-decode, event, retry, staleness, and isolation tests pass.

- [ ] **Step 5: Board smoke and commit**

On RK3588 start all configured publishers, list `/tmp/{usb,rtsp,rtsp2,audio}.sock`, kill each publisher in turn, and observe a new pid within the 1/3/8 policy while consumers remain. Expected: four warm publishers and `unknown` after a 6 s telemetry gap.

```bash
python -m pytest -q
git add services/pipeline-manager/src/pipeline_manager/publishers services/pipeline-manager/tests/publishers services/pipeline-manager/tests/fixtures/events
git commit -m "feat(pipeline-manager): supervise warm source publishers"
```

---

### Task A-10: Record consumer lifecycle

**Files:**
- Create: `services/pipeline-manager/src/pipeline_manager/consumers/__init__.py`
- Create: `services/pipeline-manager/src/pipeline_manager/consumers/base.py`
- Create: `services/pipeline-manager/src/pipeline_manager/consumers/record.py`
- Create: `services/pipeline-manager/tests/consumers/test_record.py`
- Create: `services/pipeline-manager/tests/fixtures/events/record-consumer.json`

**Interfaces:**
- Consumes: A-04 record builder, A-07 confirmation/ledger, A-08 EOS/recovery, A-09 publisher readiness.
- Produces: `RecordConsumer.start`, `.pause`, `.stop`, unexpected-exit restart request, status snapshot, and record lifecycle events.

- [ ] **Step 1: Write failing lifecycle tests**

Test start refuses if a required publisher is not running or PC is recovering; only confirms after PLAYING+growth; pause uses 5 s EOS and releases the old consumer; resume requires a new explicit output path and never reopens the old segment; stop uses 8 s EOS; unexpected exit marks current output truncated and emits an event for core-api to provide the next segment path; three failed restarts in 120 s exhaust. Assert no method changes `LectureSession`/recording domain state.

- [ ] **Step 2: Run red tests**

Run: `python -m pytest tests/consumers/test_record.py -q`

Expected: FAIL for missing `RecordConsumer`.

- [ ] **Step 3: Implement the record state reducer**

Keep runtime states `starting|running|degraded|stopping|exited|failed` only. `start` creates `record:<opaque command/session id>`, obtains a ledger reservation, builds, spawns, confirms, then emits `evt.pm.consumer.running` with pgid/output bytes. Pause/stop call A-08 and emit `evt.pm.consumer.eos` or `evt.pm.consumer.eos_timeout`. Unexpected death emits `evt.pm.consumer.exited{reason:"unexpected", truncated:true}` and a restart-needed event; it does not invent a new output path.

- [ ] **Step 4: Run tests and bench pause/resume locally with fake children**

Run: `python -m pytest tests/consumers/test_record.py -q`

Expected: all readiness, confirmation, EOS deadlines, new-path, restart-budget, and no-domain-write tests pass.

- [ ] **Step 5: Commit**

```bash
python -m pytest -q
git add services/pipeline-manager/src/pipeline_manager/consumers services/pipeline-manager/tests/consumers services/pipeline-manager/tests/fixtures/events
git commit -m "feat(pipeline-manager): manage record consumer lifecycle"
```

---

### Task A-11: Channel, display, and auxiliary consumer lifecycles

**Files:**
- Create: `services/pipeline-manager/src/pipeline_manager/consumers/live.py`
- Create: `services/pipeline-manager/src/pipeline_manager/consumers/meeting.py`
- Create: `services/pipeline-manager/src/pipeline_manager/consumers/projector.py`
- Create: `services/pipeline-manager/src/pipeline_manager/consumers/snapshot.py`
- Create: `services/pipeline-manager/src/pipeline_manager/consumers/thumbnails.py`
- Create: `services/pipeline-manager/tests/consumers/test_channels.py`
- Create: `services/pipeline-manager/tests/consumers/test_projector.py`
- Create: `services/pipeline-manager/tests/consumers/test_aux.py`
- Create: `services/pipeline-manager/tests/consumers/test_thumbnail_signaling.py`
- Create: `services/pipeline-manager/tests/fixtures/events/thumbnail-signaling.json`

**Interfaces:**
- Consumes: A-05/A-06 builders and A-07/A-08 supervision.
- Produces: independent lifecycle controllers; thumbnail `offer/ice/close` methods and internal answer/ICE/error events that B maps to v1 preview envelopes.

- [ ] **Step 1: Write failing independent-lifecycle tests**

Start record plus every fake consumer, kill live/meeting/snapshot/thumbnails one at a time, and assert record pid/state never changes. Channel classes restart 1/3/8 then fail; display restarts while laptop/question precondition holds and otherwise goes idle; snapshot restarts only while AI subscription exists; closing the last thumbnail negotiation stops its worker and releases its provisional slot. Projector mode switch must not spawn a second child.

Signaling fixtures validate these mappings against `contracts/events.md` §3: offer accepted only for an online, bound video role; answer and ICE preserve `negotiationId`; second offer closes first; source loss emits terminal `source-offline`; close is idempotent; no more than one negotiation per core-api connection.

- [ ] **Step 2: Run red tests**

Run: `python -m pytest tests/consumers/test_channels.py tests/consumers/test_projector.py tests/consumers/test_aux.py tests/consumers/test_thumbnail_signaling.py -q`

Expected: FAIL because controllers are missing.

- [ ] **Step 3: Implement class-specific policies**

Factor only process mechanics into `ConsumerController`; keep preconditions/restart decisions in each class. Live and meeting use `RestartClass.CHANNEL`; projector uses `DISPLAY`; snapshot uses `AUX`; each thumbnail negotiation owns one `CHANNEL` worker but only the provisional encode reservation. `ThumbnailController` validates the public-envelope-equivalent model, translates it to A-06 worker messages, and emits typed internal events without opening a frontend socket.

- [ ] **Step 4: Prove preview contract mapping and isolation**

Run:

```bash
python -m pytest tests/consumers -q
pnpm --filter @eduscope/shared test
pnpm --filter @eduscope/api-client test
```

Expected: every consumer class passes its own restart/exhaustion policy; preview fixture fields match v1; record remains running through all channel/aux failures; mock contract tests stay green.

- [ ] **Step 5: Commit**

```bash
git add services/pipeline-manager/src/pipeline_manager/consumers services/pipeline-manager/tests/consumers services/pipeline-manager/tests/fixtures/events
git commit -m "feat(pipeline-manager): isolate output consumer lifecycles"
```

---

### Task A-12: Real mic control and telemetry

**Files:**
- Create: `services/pipeline-manager/src/pipeline_manager/audio/__init__.py`
- Create: `services/pipeline-manager/src/pipeline_manager/audio/control.py`
- Create: `services/pipeline-manager/src/pipeline_manager/audio/levels.py`
- Modify: `services/pipeline-manager/src/pipeline_manager/models.py` — add audio requests/results
- Create: `services/pipeline-manager/tests/audio/test_control.py`
- Create: `services/pipeline-manager/tests/audio/test_levels.py`
- Create: `services/pipeline-manager/tests/fixtures/events/audio-control.json`
- Create: `services/pipeline-manager/tests/fixtures/events/audio-levels.json`

**Interfaces:**
- Consumes: configured lecturer-mic ALSA card/control names; publisher audio samples/level tap.
- Produces: `apply_audio_control(role, gain, muted) -> AudioControlResult` and subscription-counted `AudioLevelSampler` capped at 10 Hz.

- [ ] **Step 1: Write failing audio tests**

Use an injected `exec_file(argv)` fake. Assert only `mic-lecturer` is accepted; gain 0..100 maps through configured mixer min/max; argv uses `amixer --card <card> sset <control> <value>` with no shell; applied state comes from a follow-up `sget`, not request echo; mismatch/failure returns `appliedState="failed"` and `lastError`; mute and gain affect the same control path. Level tests assert normalized RMS 0..1, ≤10 events/s under fake time, zero samples/emits with zero subscribers, start on 0→1, stop on 1→0.

- [ ] **Step 2: Run red tests**

Run: `python -m pytest tests/audio -q`

Expected: FAIL for missing audio modules.

- [ ] **Step 3: Implement argv-only mixer apply/readback**

Resolve device/control names from `Settings`, validate against `^[A-Za-z0-9 _.-]{1,64}$`, call fixed `amixer` argv, parse the explicit percent/switch tokens, and return actual readback. Never accept an arbitrary binary or extra args. Redact device identifiers from public error messages but retain them in structured journald context.

- [ ] **Step 4: Implement subscriber-gated RMS**

Use one sampler task with monotonic 100 ms minimum period. It reads the publisher's existing meter tap; it does not open a second ALSA capture device. A reference-counted async context controls the task. Emit internal payload `{roleId:"mic-lecturer", rms}` only while count > 0.

- [ ] **Step 5: Validate v1 bridge payloads and board loopback**

Run: `python -m pytest tests/audio -q`

Expected: all actual-readback, failure, rate, normalization, and suppression cases pass; fixtures match `audio.control` and `audio.levels` fields in v1.

On ALSA loopback, apply 25%, 75%, mute, unmute; capture a fixed tone and measure RMS. Expected: readback matches, 75% RMS exceeds 25%, mute approaches zero, and after the last subscriber closes no RMS work appears for at least 2 s.

- [ ] **Step 6: Commit**

```bash
python -m pytest -q
git add services/pipeline-manager/src/pipeline_manager/audio services/pipeline-manager/src/pipeline_manager/models.py services/pipeline-manager/tests/audio services/pipeline-manager/tests/fixtures/events/audio-*.json
git commit -m "feat(pipeline-manager): apply and meter lecturer mic"
```

---

### Task A-13: LED, capture-card watchdog, and helper client

**Files:**
- Create: `services/pipeline-manager/src/pipeline_manager/hardware/__init__.py`
- Create: `services/pipeline-manager/src/pipeline_manager/hardware/helper_client.py`
- Create: `services/pipeline-manager/src/pipeline_manager/hardware/led.py`
- Create: `services/pipeline-manager/src/pipeline_manager/hardware/watchdog.py`
- Create: `services/pipeline-manager/tests/hardware/fake_helper.py`
- Create: `services/pipeline-manager/tests/hardware/test_helper_client.py`
- Create: `services/pipeline-manager/tests/hardware/test_led.py`
- Create: `services/pipeline-manager/tests/hardware/test_watchdog.py`

**Interfaces:**
- Consumes: `/run/eduscope/helper.sock`, exact verbs `led.set` and `usbhub.cycle`, configured stable capture identifier/hub location+port.
- Produces: schema-validated helper request/response client, LED derived control, watchdog `present|absent|recovering|failed` events.

- [ ] **Step 1: Write failing helper/LED/watchdog tests**

Fake Unix socket records one JSON line. Assert helper client can send only a local enum subset (`led.set`, `usbhub.cycle`), rejects unknown verb/extra args/oversize response, sets connection and response timeouts, and propagates request id. LED maps recording→blink and pending/paused/stopped/crashed→off; absent LED is logged no-op. Watchdog proves 30 s cadence, exactly two consecutive misses before absent, maximum two cycles per rolling hour, recovering reports presentation offline, success within 25 s→present, timeout/budget→failed, and camera-only record controller is never stopped.

- [ ] **Step 2: Run red tests**

Run: `python -m pytest tests/hardware -q`

Expected: FAIL for missing hardware modules.

- [ ] **Step 3: Implement complete helper wrapper**

Use `asyncio.open_unix_connection(str(settings.helper_socket))`; write one JSON object plus newline; cap response with `reader.readline()` and reject >16 KiB; `asyncio.timeout(2)` wraps connect/request. The request model is a discriminated union:

```python
class LedSetArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["on", "off", "blink"]

class UsbHubCycleArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    location: str = Field(pattern=r"^[0-9-]{1,32}$")
    port: int = Field(ge=1, le=32)
```

No generic `request(verb: str, args: dict)` is public; expose typed `set_led` and `cycle_usb_hub` methods only.

- [ ] **Step 4: Implement LED and watchdog reducers**

LED accepts derived state from core-api; it does not own recording state. Watchdog probes `v4l2-ctl --list-devices` via argv-only injected runner and matches the configured stable identifier. Track consecutive misses and deque of cycle timestamps; while absent/recovering, update the publisher/source health projection but do not touch camera publishers or consumers.

- [ ] **Step 5: Run tests and stub-helper scenario**

Run: `python -m pytest tests/hardware -q`

Expected: all allowlist, schema, timeout, LED mapping, two-miss, budget, recovery, and continuity tests pass. With fake helper, unknown verbs and shell metacharacters are rejected before socket write; allowed requests contain only the fixed verb and validated fields.

- [ ] **Step 6: Commit**

```bash
python -m pytest -q
git add services/pipeline-manager/src/pipeline_manager/hardware services/pipeline-manager/tests/hardware
git commit -m "feat(pipeline-manager): add LED and capture watchdog controls"
```

---

### Task A-14: FastAPI routes, status, auth, and SSE

**Files:**
- Create: `services/pipeline-manager/src/pipeline_manager/api/__init__.py`
- Create: `services/pipeline-manager/src/pipeline_manager/api/auth.py`
- Create: `services/pipeline-manager/src/pipeline_manager/api/events.py`
- Create: `services/pipeline-manager/src/pipeline_manager/api/routes.py`
- Modify: `services/pipeline-manager/src/pipeline_manager/app.py` — construct controllers, lifetime tasks, and router
- Create: `services/pipeline-manager/tests/api/test_auth.py`
- Create: `services/pipeline-manager/tests/api/test_routes.py`
- Create: `services/pipeline-manager/tests/api/test_status.py`
- Create: `services/pipeline-manager/tests/api/test_events.py`
- Create: `services/pipeline-manager/tests/api/test_errors.py`

**Interfaces:**
- Consumes: A-08..A-13 controllers and their event/status models.
- Produces: the full internal route surface from `pipeline-manager.md` §3.2 plus audio and thumbnail signaling routes, exact error taxonomy, sequenced replayable SSE, and one truth snapshot.

- [ ] **Step 1: Write failing route/auth/error/SSE tests**

Parameterize every route. `/healthz` is public; all others return 401 without/with wrong bearer and accept a constant-time-equal token. Start/stop commands return 202 accepted, never final state. Test errors and statuses: `invalid_preset` 400, `invalid_ratio` 400, `preset_channel_mismatch` 400, `publisher_not_running` 409, `encoder_budget_exceeded` 409, `platform_element_missing` 422, `consumer_not_found` 404, `capture_card_absent` 503. `/status` includes platform, ledger, four publishers, consumers, device, and monotonic `sequence`.

SSE tests open one connection, publish sequences 1..3, reconnect with `Last-Event-ID: 1`, receive 2..3 exactly once, and when replay is too old receive `evt.pm.resync-required` then use `/status`. Slow subscriber queue overflow closes only that subscriber. Events use `id: <sequence>`, `event: <kind>`, `data: <compact JSON>`.

- [ ] **Step 2: Run red tests**

Run: `python -m pytest tests/api -q`

Expected: FAIL for missing API modules/routes.

- [ ] **Step 3: Implement authentication, problems, and event broker**

Bearer parsing rejects multiple/empty schemes and uses `secrets.compare_digest`. Convert typed domain errors through one exception handler to:

```json
{"code":"publisher_not_running","title":"Required publisher is not running","status":409,"meta":{"publisherId":"usb"}}
```

`EventBroker` holds a bounded deque of immutable events and one bounded queue per subscriber. Sequence increments under one asyncio lock. No event is emitted before the state snapshot mutation it describes.

- [ ] **Step 4: Implement exact route surface**

Routes are:

```text
POST /publishers/{id}/start|stop
POST /consumers/record
POST /consumers/live
POST /consumers/meeting
POST /consumers/projector
POST /consumers/snapshot/start|stop
POST /consumers/thumbnails/start|stop
POST /consumers/thumbnails/offer
POST /consumers/thumbnails/{negotiationId}/ice
DELETE /consumers/thumbnails/{negotiationId}
POST /consumers/{consumerId}/stop
PUT  /audio/controls/mic-lecturer
POST /audio/levels/subscriptions
DELETE /audio/levels/subscriptions/{subscriptionId}
POST /device/led
GET  /sources
GET  /status
GET  /events
GET  /healthz
```

The three signaling routes are internal only and map to A-11; they do not change v1's panel-facing `/api/v1/ws/preview` contract. FastAPI lifetime order is: construct state→recover exact orphans→start valid publishers/watchdog→serve; shutdown stops auxiliary/channel/display children, leaves an actively adopted record untouched for core-api recovery policy, and flushes sidecars.

- [ ] **Step 5: Prove all routes, reconnect, and contract regression**

Run:

```bash
python -m pytest tests/api -q
python -m pytest -q
pnpm --filter @eduscope/shared test
pnpm --filter @eduscope/api-client test
```

Expected: all routes/auth/errors/status/SSE reconnect tests pass; no duplicate event after replay; v1/mock remain green.

Manual localhost check:

```bash
TOKEN=0123456789abcdef0123456789abcdef
curl -fsS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8091/status
curl -N -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8091/events
```

Expected: status JSON has sequence and runtime truth; SSE prints confirmed publisher/consumer transitions. Missing token returns 401. LAN address remains unreachable.

- [ ] **Step 6: Commit**

```bash
git add services/pipeline-manager/src/pipeline_manager/api services/pipeline-manager/src/pipeline_manager/app.py services/pipeline-manager/tests/api
git commit -m "feat(pipeline-manager): expose authenticated status and events"
```

---

### Task A-15: Publisher and record EOS bench gate

This is the first of the two final Workstream A verification tasks from the master plan. Do not begin it without an RK3588 target, valid source bindings, mounted recordings disk, running helper double/real helper, and A-14 green.

**Files:**
- Create: `services/pipeline-manager/scripts/bench/publishers.sh`
- Create: `services/pipeline-manager/scripts/bench/record-eos.sh`
- Create: `services/pipeline-manager/tests/bench/test_publishers_script.py`
- Create: `services/pipeline-manager/tests/bench/test_record_eos_script.py`
- Create: `services/pipeline-manager/tests/bench/README.md`
- Create: `services/pipeline-manager/tests/bench/evidence/a15-template.md`

**Interfaces:**
- Consumes: A-14 API at localhost, target sources, recordings mount, `curl`, `jq`, `ffprobe`, `stat`, `kill`.
- Produces: deterministic exit codes and a filled A-15 evidence record proving warm attach, camera-only recording, targeted EOS, pause/resume A/V sync, and source-loss placeholder continuity.

- [ ] **Step 1: Write failing wrapper/parser tests**

Tests run each Bash script with fake `curl`, `jq`, `ffprobe`, `stat`, `kill`, and `sleep` binaries first on PATH. Assert required flags are enforced; token never appears in process output; a publisher pid that does not change fails; sibling pid change fails; non-positive duration fails; unchanged file size during source loss fails; and successful fixture prints only `PASS A15-*` lines then exits 0.

Run: `python -m pytest tests/bench/test_publishers_script.py tests/bench/test_record_eos_script.py -q`

Expected: FAIL because scripts are absent.

- [ ] **Step 2: Implement `publishers.sh` as a strict wrapper**

The script must begin with `set -euo pipefail`, accept `--base-url`, read the bearer only from `EDUSCOPE_PM_TOKEN`, require `curl jq kill`, and use a private temp directory cleaned by `trap`. Its executable procedure is:

```bash
#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:8091}"
: "${EDUSCOPE_PM_TOKEN:?set EDUSCOPE_PM_TOKEN}"
AUTH=( -H "Authorization: Bearer ${EDUSCOPE_PM_TOKEN}" )

status() { curl -fsS "${AUTH[@]}" "${BASE_URL}/status"; }
for id in usb rtsp rtsp2 audio; do
  curl -fsS -X POST "${AUTH[@]}" "${BASE_URL}/publishers/${id}/start" >/dev/null
done

deadline=$((SECONDS + 15))
until status | jq -e '[.publishers.usb,.publishers.rtsp,.publishers.rtsp2,.publishers.audio]
  | all(.state == "online" or .state == "degraded")' >/dev/null; do
  (( SECONDS < deadline )) || { echo "FAIL A15-PUB warm publishers"; exit 1; }
  sleep 1
done

for sock in /tmp/usb.sock /tmp/rtsp.sock /tmp/rtsp2.sock /tmp/audio.sock; do
  test -S "$sock" || { echo "FAIL A15-PUB missing $sock"; exit 1; }
done

for id in usb rtsp rtsp2 audio; do
  before="$(status)"
  old_pid="$(jq -r --arg id "$id" '.publishers[$id].pid' <<<"$before")"
  sibling="$(jq -c --arg id "$id" '.consumers | map(select(.state == "running") | .pgid) | sort' <<<"$before")"
  kill -TERM "$old_pid"
  deadline=$((SECONDS + 15))
  while :; do
    after="$(status)"
    new_pid="$(jq -r --arg id "$id" '.publishers[$id].pid' <<<"$after")"
    new_state="$(jq -r --arg id "$id" '.publishers[$id].state' <<<"$after")"
    test "$new_pid" != "$old_pid" && { test "$new_state" = online || test "$new_state" = degraded; } && break
    (( SECONDS < deadline )) || { echo "FAIL A15-PUB restart $id"; exit 1; }
    sleep 1
  done
  test "$(jq -c '.consumers | map(select(.state == "running") | .pgid) | sort' <<<"$after")" = "$sibling" \
    || { echo "FAIL A15-PUB consumer changed after $id"; exit 1; }
done
echo "PASS A15-PUB warm publishers, sockets, isolated restarts"
```

The implementation may add argument parsing and diagnostics but may not weaken any check or print the token.

- [ ] **Step 3: Implement `record-eos.sh` with five explicit phases**

Require `--output-dir` beneath the mounted recordings root. Implement helpers `post_json`, `wait_consumer_state`, `wait_growth`, `stop_eos`, and `probe_positive_duration`. Execute:

1. **Warm attach:** record `fifty-fifty` to `a15-warm.ts`; require first file growth ≤5 s and unchanged publisher pids.
2. **Camera-only:** record `cam-1` to `a15-camera-only.ts` while USB is stopped; require growth and positive `ffprobe` duration after EOS.
3. **Targeted EOS:** start `live` and `meeting`, stop record by consumer id, require `evt.pm.consumer.eos`, positive duration, and identical live/meeting pgids.
4. **Pause/resume A/V sync:** record 10 s to `a15-before-pause.ts`, EOS-pause at 5 s deadline, wait 3 s, start a new record consumer with `a15-after-resume.ts`, record 10 s, EOS-stop. Run:

```bash
ffprobe -v error -select_streams v:0 -show_entries stream=start_time,duration \
  -of json "$before" >before-video.json
ffprobe -v error -select_streams a:0 -show_entries stream=start_time,duration \
  -of json "$before" >before-audio.json
ffprobe -v error -select_streams v:0 -show_entries stream=start_time,duration \
  -of json "$after" >after-video.json
ffprobe -v error -select_streams a:0 -show_entries stream=start_time,duration \
  -of json "$after" >after-audio.json
```

Compute `abs(video.start_time-audio.start_time)` for each file with `jq`; fail above 0.100 s. Both files must be independently playable and the resumed output path must differ.

5. **Source loss:** record `fifty-fifty`, capture size, terminate RTSP publisher, wait 12 s, require file grows, record consumer pgid is unchanged, status shows lecturer source offline/recovering then restored, EOS-stop, and `ffprobe` succeeds. Save one frame during loss and compare its OCR/manual inspection against the literal `SOURCE UNAVAILABLE` placeholder.

Print exactly these success summaries: `PASS A15-REC warm-attach`, `PASS A15-REC camera-only`, `PASS A15-REC targeted-eos`, `PASS A15-REC pause-resume-sync`, `PASS A15-REC source-loss-placeholder`.

- [ ] **Step 4: Document prerequisites and evidence record**

`tests/bench/README.md` gives exact board setup:

```bash
cd /opt/eduscope/services/pipeline-manager
. .venv/bin/activate
export EDUSCOPE_PM_TOKEN='<provisioned shared token>'
python -m pipeline_manager.pipelines.preflight --platform rk3588 --include-webrtc
bash scripts/bench/publishers.sh http://127.0.0.1:8091
bash scripts/bench/record-eos.sh --base-url http://127.0.0.1:8091 \
  --output-dir /media/eduscope/recordings/bench/a15
```

The evidence template has immutable fields: date, commit SHA, device serial, OS/kernel, GStreamer version, source bindings with secrets redacted, recordings mount/UUID, every command/exit code, publisher pid before/after table, every segment path/size/duration, before/after A/V offsets, placeholder frame path, journal excerpt, PASS/FAIL per phase, pipeline engineer sign-off. No blank PASS is allowed: unrun rows remain `NOT RUN — gate failed`.

- [ ] **Step 5: Run wrapper tests**

Run: `python -m pytest tests/bench/test_publishers_script.py tests/bench/test_record_eos_script.py -q`

Expected: fake success paths print all six PASS markers; every injected failure exits nonzero with the matching phase.

- [ ] **Step 6: Execute on target and fill evidence**

Run the README commands, copy `a15-template.md` to `a15-<YYYYMMDD>-<device>.md`, and record actual output. Expected: all A15 markers pass, every produced file is playable, A/V offset ≤100 ms, only the selected record consumer stops, and source loss preserves record pgid/file growth with placeholder.

If any check fails, do not edit expected thresholds or mark the task complete; attach logs and leave the evidence result failed.

- [ ] **Step 7: Regression and commit**

```bash
python -m pytest -q
git add services/pipeline-manager/scripts/bench/publishers.sh \
  services/pipeline-manager/scripts/bench/record-eos.sh \
  services/pipeline-manager/tests/bench
git commit -m "test(pipeline-manager): gate publishers and record EOS"
```

Expected: commit includes the scripts, parser tests, README, template, and the filled target evidence file.

---

### Task A-16: Output and resource bench gate

This is the final Workstream A task and the second final verification task from the master plan. Nothing follows it except plan self-review. It runs only after A-15 passes on the same target commit.

**Files:**
- Create: `services/pipeline-manager/scripts/bench/outputs.sh`
- Create: `services/pipeline-manager/scripts/bench/resource-ledger.sh`
- Create: `services/pipeline-manager/scripts/bench/webrtc.sh`
- Create: `services/pipeline-manager/tests/bench/test_outputs_script.py`
- Create: `services/pipeline-manager/tests/bench/test_resource_ledger_script.py`
- Create: `services/pipeline-manager/tests/bench/test_webrtc_script.py`
- Create: `services/pipeline-manager/tests/bench/evidence/a16-template.md`

**Interfaces:**
- Consumes: A-14 API, A-15 proven publishers/recording, HDMI #1/#2, local RTMP relay, GStreamer WebRTC loopback probe, `/proc/stat`, `/proc/<pid>/stat`, `ffprobe`, `jq`, `awk`.
- Produces: executable proof that the full output mix sustains 30 fps, preview starts <1 s, HDMI #2 mic is usable, projector latency is recorded, and aggregate CPU headroom is at least 30%, while enforcing the encode ledger and KEEP B-56/B-59/B-60.

- [ ] **Step 1: Write failing parser/threshold tests**

Fixture tests must cover boundary values: 29.99 fps fails/30.00 passes; 1000 ms preview fails because requirement is `<1 s`; 30.00% idle passes/29.99 fails; encode ledger over-capacity fails; missing HDMI audio evidence fails; absent projector measurement fails; process exit/restart during steady-state fails. Feed two synthetic `/proc/stat` samples to prove idle percentage math and wrap-safe deltas.

Run: `python -m pytest tests/bench/test_outputs_script.py tests/bench/test_resource_ledger_script.py tests/bench/test_webrtc_script.py -q`

Expected: FAIL because scripts/parsers are absent.

- [ ] **Step 2: Implement `outputs.sh` full-mix procedure**

With strict mode and token handling identical to A-15, the script:

1. Captures baseline publisher pids and ledger.
2. Starts composite Local record (`fifty-fifty`, B-56 override 4000 kbps/30 fps), Live (`fifty-fifty`, 4000 kbps/30 fps, bench stream key), Meeting (`cams-fifty-fifty`), Projector passthrough, Snapshot at 1 fps, and one presentation thumbnail negotiation.
3. Waits for every consumer to confirm; records start-confirm latency and process ids.
4. Samples `/status` once/second for 300 s, writing JSONL. Fail immediately on unexpected pid change, state outside running/degraded, record bytes not growing, or ledger use beyond declared capacity.
5. EOS-stops record/live/meeting and stops aux consumers; `ffprobe` verifies the record. Parse the record's `avg_frame_rate` and `nb_read_frames`; sustained effective fps must be ≥30.00. Live relay is probed with `ffprobe rtmp://127.0.0.1:1935/live/bench`; its video rate must be ≥30.00.

The script prints `PASS A16-OUT full-mix-300s` only after every check. It writes raw status JSONL and probe JSON under the evidence directory supplied by `--evidence-dir`.

- [ ] **Step 3: Implement `resource-ledger.sh` using `/proc`, not an optional package**

Sample the first `cpu ` line in `/proc/stat` before and after each one-second interval. Compute:

```text
idle_delta = (idle + iowait)_2 - (idle + iowait)_1
total_delta = sum(all fields)_2 - sum(all fields)_1
idle_percent = 100 * idle_delta / total_delta
```

Collect 300 samples while `outputs.sh` is steady. Record min, p05, median, and mean idle; the gate criterion is mean aggregate idle/headroom ≥30.00%, and no 30-second rolling mean below 20%. Also snapshot process RSS and per-process CPU from `/proc/<pid>/stat`, ledger `capacity/inUse/reservedBy`, and SoC temperature from `/sys/class/thermal/thermal_zone*/temp`. Attempting a second thumbnail while three slots are reserved must return 409 `encoder_budget_exceeded` without disturbing record/live/first thumbnail. Print `PASS A16-RES cpu-headroom=<value> ledger-enforced` only after both conditions.

- [ ] **Step 4: Implement `webrtc.sh` first-frame probe**

Call the A-06 loopback probe, which creates an offer, sends it through A-14, applies answer/ICE, and timestamps the first decoded video frame with `time.monotonic_ns()`. Run 20 negotiations each for `presentation`, `lecturer-cam`, and `students-cam`, closing every negotiation before the next. Require every result `<1000 ms`, report p50/p95/max, verify the thumbnail worker pid disappears after close, and prove record pid/file growth remain unchanged throughout. Print `PASS A16-WEBRTC max-first-frame-ms=<n>` only when all 60 pass.

Exact invocation:

```bash
python -m pipeline_manager.pipelines.thumbnails --loopback-probe \
  --base-url http://127.0.0.1:8091 --role "$role" --iterations 20 --json
```

The token is provided through `EDUSCOPE_PM_TOKEN`, never a CLI argument.

- [ ] **Step 5: Execute HDMI #2 mic and projector latency procedures**

These are physical-path facts and must be measured, not inferred from a green process:

1. Start Meeting with `cams-fifty-fifty` and apply mic unmuted/75%.
2. On the laptop receiving the HDMI→USB dongle run `arecord -l`; expected: the dongle exposes a capture device. Record 15 s with `arecord -D hw:<card>,<device> -f S16_LE -r 48000 -c 2 hdmi2-mic.wav` while speaking a fixed count. Run `ffprobe -v error -show_streams hdmi2-mic.wav`; expected 48 kHz stereo and audible/non-silent count. Join a local Zoom/Meet test, select that same device, and record the platform's input-meter screenshot. This is KEEP B-59 evidence.
3. Display a 240 fps phone-camera view containing both laptop slide source and projector surface. Trigger a black→white slide edge ten times. For each trial count frames between source and projector transition; compute `frames/240*1000` ms and record p50/p95/max. No pass threshold is invented; the master requires latency be recorded. Attach the video and measurements.
4. Switch projector to question then back to passthrough through A-14. Expected: same projector consumer pgid, no leaderboard/PII, return to slides. Capture both frames.

Any missing receiver audio device, silent recording, or projector mode restart fails A-16. A high measured projector latency is recorded and flagged for the gate rather than hidden by a made-up threshold.

- [ ] **Step 6: Create the evidence template**

`a16-template.md` requires: A-15 evidence link, commit/device identity, 300 s status JSONL path/hash, record/live fps, every consumer pid before/after, 60 WebRTC latency rows plus p50/p95/max, `/proc/stat` sample file/hash and idle statistics, ledger refusal response, HDMI audio device/`ffprobe` output/waveform/screenshot, ten projector trials and video hash, question/passthrough captures, temperature min/max, all raw commands/exit codes, KEEP B-56/B-59/B-60 verdicts, and pipeline engineer sign-off. Unrun fields read `NOT RUN — gate failed`.

- [ ] **Step 7: Run parser tests**

Run: `python -m pytest tests/bench/test_outputs_script.py tests/bench/test_resource_ledger_script.py tests/bench/test_webrtc_script.py -q`

Expected: all thresholds and negative fixtures pass; 29.99 fps, 1000 ms, and 29.99% headroom fixtures fail for the intended reason.

- [ ] **Step 8: Run the complete target gate**

```bash
cd /opt/eduscope/services/pipeline-manager
. .venv/bin/activate
export EDUSCOPE_PM_TOKEN='<provisioned shared token>'
EVIDENCE="tests/bench/evidence/a16-$(date +%Y%m%d)-$(hostname)"
mkdir -p "$EVIDENCE"
bash scripts/bench/outputs.sh --base-url http://127.0.0.1:8091 \
  --output-dir /media/eduscope/recordings/bench/a16 --evidence-dir "$EVIDENCE" &
outputs_pid=$!
bash scripts/bench/resource-ledger.sh --base-url http://127.0.0.1:8091 \
  --duration-sec 300 --evidence-dir "$EVIDENCE"
wait "$outputs_pid"
bash scripts/bench/webrtc.sh --base-url http://127.0.0.1:8091 \
  --evidence-dir "$EVIDENCE"
```

Then execute Step 5, copy/fill the evidence template, and run `sha256sum "$EVIDENCE"/*`. Expected automated markers: `PASS A16-OUT`, `PASS A16-RES cpu-headroom>=30.00`, and `PASS A16-WEBRTC max-first-frame-ms<1000`; manual HDMI/projector rows are complete and passing/recorded.

- [ ] **Step 9: Run final Workstream A regression**

```bash
python -m pytest -q
pnpm --filter @eduscope/shared test
pnpm --filter @eduscope/api-client test
rg -n "sudo|killall|shell=True|create_subprocess_shell|subprocess\.run\([^\n]*shell" \
  src tests --glob '*.py'
```

Expected: all tests exit 0. `rg` returns no application-code matches; any intentional negative-test literal is confined to `tests/` and asserted as rejected. Review A-15/A-16 evidence: every required row is actual, not expected or blank.

- [ ] **Step 10: Commit the final verification task**

```bash
git add services/pipeline-manager/scripts/bench/outputs.sh \
  services/pipeline-manager/scripts/bench/resource-ledger.sh \
  services/pipeline-manager/scripts/bench/webrtc.sh \
  services/pipeline-manager/tests/bench
git commit -m "test(pipeline-manager): gate outputs and RK3588 resources"
```

Expected: one A-16 commit containing wrappers, parser tests, template, and filled evidence. Stop Workstream A after this commit; Workstream B may begin only after the gate acknowledges the A-03 correction and accepts both hardware evidence records.

---

## Self-Review

### Master-scope coverage

| Master task | Expanded here | Contract/KEEP ownership preserved |
|---|---|---|
| A-01 | typed FastAPI shell, v1 vocabulary, localhost health | internal only; v1 loaded day one |
| A-02 | RK3588 plug and missing-element preflight | internal only |
| A-03 | exact corrected v1 matrix, shared catalog, profiles | KEEP B-56/B-60; no public shape change |
| A-04 | record composite/passthrough/separate/camera-only | internal only |
| A-05 | live/meeting, HDMI audio, RTMP ordering seam | KEEP B-59 verified finally in A-16 |
| A-06 | projector/snapshot/WebRTC builders | v1 preview mapping only, no public ownership |
| A-07 | argv-only process supervisor/confirmation/ledger | internal only |
| A-08 | targeted EOS, truncation, exact adoption | internal only |
| A-09 | four warm publishers and health staleness | internal projection only |
| A-10 | record lifecycle and restart seams | internal projection only |
| A-11 | independent output lifecycles/preview signaling | preview fixtures; no panel route ownership |
| A-12 | real mic control/readback and ≤10 Hz telemetry | internal bridge fixtures only |
| A-13 | helper client, LED, capture watchdog | KEEP B-05/B-39 |
| A-14 | authenticated internal API/status/SSE | internal only |
| A-15 | publisher/record EOS board gate | final master verification task 1 |
| A-16 | output/resource/WebRTC/HDMI/projector board gate | final master verification task 2; KEEP B-56/B-59/B-60 |

No master task was added, removed, combined, or reassigned. A-15 and A-16 are the final tasks. Institute upload, retention, room controls, physical record button, relay configuration, frontend networking, core-api state writes, privileged-helper implementation, systemd units, and target package installation remain outside Workstream A.

### Placeholder and mechanical-content review

- The placeholder scan is clean; every implementation and error-path step names its concrete behavior.
- Mechanical package configuration, settings, helper protocol, catalog sync, signal sequence, publisher wrapper, thresholds, and target commands are written explicitly.
- Hardware values that must come from the device are arguments/evidence fields, not guessed constants. An unrun evidence row fails the gate.
- Every task has focused red/green tests, full regression, expected output, and exactly one commit.

### Type/interface consistency

- A-01 canonical enums flow unchanged through layouts, builders, publishers, consumers, events, and routes.
- A-04's `PipelineSpec` is the sole spawn input to A-07; later tasks do not introduce shell strings.
- A-07's `ManagedProcess`/ledger feed A-08 stop/recovery and every runtime controller.
- A-09/A-10/A-11/A-12/A-13 emit typed internal events through A-14's one sequenced broker; core-api remains the public-event/state writer.
- Thumbnail offer/answer/ICE/close fields preserve the v1 `negotiationId` envelope, while the internal routes remain outside the public contract.
- A-15 and A-16 invoke only routes/models defined by A-14 and thresholds copied from the master/design.

### Gate note

The master plan was updated in this planning commit rather than silently carrying stale A-03 assumptions. Execution is blocked until the Workstream A gate acknowledges the corrected v1 channel matrix and the single shared even-16:9 layout catalog approach.
