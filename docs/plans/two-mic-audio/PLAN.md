# Two-Microphone Audio + Working VU Meters — Implementation Plan

> **For the executing agent (Claude Code):** Implement this plan task-by-task, in
> order. Stop at every **CHECKPOINT** and wait for human review before continuing.
> Steps use checkbox (`- [ ]`) syntax — tick them as you go. Do **not** batch phases
> together. This plan touches three subsystems; each phase is a natural review gate.

**Goal:** Make the Eduscope **production React panel** (`apps/panel`) show **two
microphones** — "Lecturer Mic" and "Room Mic" — each with a **live VU meter** and
its own level control, fed through the monorepo pipeline (pipeline-manager →
core-api → panel), and fix the currently-flat lecturer VU meter along the way.

**Architecture (the one decision that governs everything below):**
Keep the **single mixed audio shm socket** (`/tmp/audio.sock`, `S16LE 48000 2ch`)
that STT, recording, live and meeting all consume — so **no downstream consumer
changes**. The audio publisher captures **both** mics, mixes them into that one
socket, and emits **two per-source `level` meters** so the panel can show one bar
per mic. This is exactly the topology in `reference/pub_audio.py` (the hardware
engineer's proven script) — use it as the reference GStreamer element graph and
for its robust dual-format RMS parser.

**Tech stack:** pipeline-manager = Python 3 / FastAPI / GStreamer 1.0 (PyGObject),
pytest. core-api = TypeScript / Node / Drizzle, vitest. panel = React + zustand,
vitest. Shared contracts = `@eduscope/shared` (zod schemas + generated types).

---

## Global Constraints

- **Socket contract is frozen:** the audio publisher MUST publish the mix to
  `PUBLISHER_SOCKETS[PublisherId.AUDIO]` (`/tmp/audio.sock`) as
  `audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved`. Every
  consumer (STT `EDUSCOPE_STT_AUDIO_SOCKET`, record, live, meeting) reads this and
  MUST keep working unchanged. Verify this invariant after every audio change.
- **Two roles only:** `mic-lecturer` and `mic-room`. Both already exist in
  `SourceRole` (pipeline-manager `models.py`) and `SourceRoleId`
  (`packages/shared/.../types.gen.ts:67`). Do **not** invent new role ids.
- **Invariants being deliberately lifted** (update their governing comments, do not
  just bypass them): `INV-SR-2` / `A-08` (mic-room unbound, no publisher),
  `LP-9` / `LP-14` (mic-lecturer only mutable in V1), `INV-AC-1` (single audio
  control). Cite the invariant id in each commit that touches it.
- **Golden tests will change on purpose:** `A-REV-018` (pub_audio argv oracle) and
  the `A-REV-012` metering design both assume one mic. Update the fixtures/oracle
  with the change, in the same commit, never by deleting the test.
- **argv-only spawns** stay argv-only (`asyncio.create_subprocess_exec`, never a
  shell string) — match the existing style in `audio/control.py` and
  `audio/levels.py`.
- **Do not touch the legacy Flask panel** (`scripts/python/eduscope_web.py`,
  `scripts/bash/pub_audio.sh`). It is a separate system. `reference/*.py` here are
  copies for reading only.

---

## Phase 0 — Fix the currently-flat lecturer VU meter (ship independently)

The full data path already exists: `panel-hub.ts#subscribeAudio` opens the PM
subscription when the first panel connects → PM `AudioLevelSampler` emits
`AudioLevelSample(role_id, rms)` → core-api relays `audio.levels` → `ws-store.ts`
calls `telemetry-store.setLevel(roleId, rms)` → `LevelMeter` paints. A flat meter
therefore means **no RMS is being produced**, not a missing feature. Fix this
before adding a second mic, so you have one working meter to pattern-match against.

### Task 0.1: Diagnose the dead meter on real hardware

**Files:** none (diagnosis only). Run on the device (or a box with the audio
publisher running and `/tmp/audio.sock` present).

- [x] **Step 1:** Confirm the publisher + socket are alive:
  `pgrep -af gst` and `ls -l /tmp/audio.sock`. If the socket is missing, the audio
  publisher isn't running — start it and re-check before touching code.
- [x] **Step 2:** Confirm `panel-hub.ts#subscribeAudio` actually POSTs to PM. Read
  `services/core-api/src/modules/ws/panel-hub.ts:187` (`#subscribeAudio`) and verify
  it issues `POST /audio/levels/subscriptions` to pipeline-manager (not a stub). If
  it is a stub / no-op, that is the bug — fix it to call the PM client and jump to
  Task 0.3.
- [x] **Step 3:** Reproduce the raw meter output the parser must handle. Run the tap
  argv by hand and capture one `level` line verbatim:
  `gst-launch-1.0 -m shmsrc socket-path=/tmp/audio.sock is-live=true do-timestamp=true ! audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved ! level interval=100000000 ! fakesink sync=false`
  Copy an actual `level, ... rms=(...)` line into the commit message for Task 0.2.
- [x] **Step 4:** Decide the cause: (a) socket/publisher down, (b) subscription not
  opened, or (c) `rms=` serialised in a form the current regex misses. (c) is the
  most common silent failure — the current regex only matches `rms=(float){ ... }`.

### Task 0.2: Make the RMS parser robust to both GStreamer serialisations

**Files:**
- Modify: `services/pipeline-manager/src/pipeline_manager/audio/levels.py`
  (the `_LEVEL_RMS_PATTERN` regex + its use in `GstLevelMeterTap._read_loop`)
- Test: `services/pipeline-manager/tests/audio/test_levels.py` (existing file if
  present; else create it under the package's test dir — match the layout of the
  other `tests/audio` tests)

The reference `reference/pub_audio.py` (`_regex_floats`, `_NUM`) parses **both**
forms the `level` element emits — `rms=(double){ -18.5, -19.2 }` (GstValueList) and
`rms=< (double)-18.5, (double)-19.2 >` (GstValueArray) — plus an optional type
prefix. The monorepo currently handles only the first with a `float` prefix.

- [x] **Step 1: Write the failing test** — feed both serialisations to the parser:

```python
# tests/audio/test_levels.py
import pytest
from pipeline_manager.audio.levels import _parse_latest_rms  # new helper (Step 3)

@pytest.mark.parametrize("line,expected_db", [
    (b"level, rms=(float){ -20.0, -21.0 };", -20.0),          # already worked
    (b"level, rms=(double){ -12.5, -13.0 };", -12.5),         # double, list form
    (b"level, rms=< (double)-6.0, (double)-6.5 >;", -6.0),    # array form
    (b"level, peak=(float){ -1.0 };", None),                  # no rms -> None
])
def test_parse_latest_rms_handles_both_forms(line, expected_db):
    assert _parse_latest_rms(line) == expected_db
```

- [x] **Step 2: Run it, confirm it fails**
  Run: `cd services/pipeline-manager && python -m pytest tests/audio/test_levels.py -k parse_latest_rms -v`
  Expected: FAIL (`_parse_latest_rms` not defined).

- [x] **Step 3: Implement** — extract a parser that accepts both forms and wire it
  into `_read_loop`. Replace the single-form regex:

```python
# levels.py — replace `_LEVEL_RMS_PATTERN` block with this
import re

_NUM = r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|-?inf"
# rms=(double){ -18.5, -19.2 }  OR  rms=< (double)-18.5, ... >  OR  rms=(float)-18.5
_RMS_LIST = re.compile(rb"rms=(?:\([^)]*\))?\s*[{<]([^}>]*)[}>]")
_RMS_SCALAR = re.compile(rb"rms=(?:\([^)]*\))?\s*(" + _NUM.encode() + rb")")

def _parse_latest_rms(line: bytes) -> float | None:
    """First-channel RMS in dBFS from a `gst-launch -m` level line, or None.
    Handles GstValueList `{ }`, GstValueArray `< >`, and scalar forms."""
    m = _RMS_LIST.search(line)
    if m:
        nums = re.findall(_NUM.encode(), m.group(1))
        return float(nums[0]) if nums else None
    m2 = _RMS_SCALAR.search(line)
    return float(m2.group(1)) if m2 else None
```

  Then in `GstLevelMeterTap._read_loop`, replace the `_LEVEL_RMS_PATTERN.search`
  block with:

```python
            db = _parse_latest_rms(line)
            if db is not None:
                self._latest_rms = _rms_db_to_linear(db)
```

- [x] **Step 4: Run tests, confirm pass**
  Run: `cd services/pipeline-manager && python -m pytest tests/audio/test_levels.py -v`
  Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add services/pipeline-manager/src/pipeline_manager/audio/levels.py services/pipeline-manager/tests/audio/test_levels.py
git commit -m "fix(audio): parse both GstValueList and GstValueArray rms forms (A-REV-012)"
```

### Task 0.3: Verify the lecturer meter moves on hardware

- [x] **Step 1:** Deploy/run pipeline-manager + core-api + panel on the device with
  the audio publisher live. Open the panel, speak into the lecturer mic.
- [x] **Step 2:** Confirm the lecturer bar moves. If it does, Phase 0 is done. If it
  still doesn't, return to Task 0.1 — the cause is socket/subscription, not parsing.

> **CHECKPOINT 0 — do not proceed to Phase 1 until the single lecturer meter is
> confirmed live on hardware.** A second mic on top of a broken meter path only
> doubles the debugging surface.

---

## Phase 1 — pipeline-manager: two-mic mixing publisher + per-mic meters + mic-room control

### Task 1.1: Two-mic mixing audio publisher (one socket, two named level taps)

**Files:**
- Modify: `services/pipeline-manager/src/pipeline_manager/publishers/audio.py`
- Test: `services/pipeline-manager/tests/publishers/test_builders.py`
  (the `A-REV-018` golden test) + its fixture
  `services/pipeline-manager/tests/fixtures/pipelines/publishers/pub_audio.json`

**Interfaces:**
- Produces: `build_audio_publisher(lecturer_device: str, room_device: str) -> PipelineSpec`
  — argv mixes both mics to `PUBLISHER_SOCKETS[PublisherId.AUDIO]` and contains two
  `level` elements named `lvl_mic_lecturer` and `lvl_mic_room` (post-fader).

Model the element graph on `reference/pub_audio.py:build_pipeline` — two
`alsasrc … provide-clock=false ! audioconvert ! audioresample ! <caps> ! volume ! level name=lvl_… ! queue max-size-time=200000000 ! mix.`
feeding `audiomixer name=mix latency=200000000 ! … ! shmsink socket-path=<socket>`.
Keep it a single argv the supervisor can spawn.

- [x] **Step 1: Read** the current `build_audio_publisher` and the `PipelineBuilder`
  API (`pipelines/builder.py`) so the new argv uses the same builder calls.
- [x] **Step 2: Regenerate the golden fixture** — the argv is changing on purpose
  (A-REV-018). Update `pub_audio.json` to the new two-mic argv, and update the test's
  docstring to cite this plan. Write the new expected argv into the test first (TDD):
  assert the built argv contains `mix.` twice, `audiomixer`, `level name=lvl_mic_lecturer`,
  `level name=lvl_mic_room`, and the exact socket + caps.
- [x] **Step 3: Run it, confirm it fails**
  Run: `cd services/pipeline-manager && python -m pytest tests/publishers/test_builders.py -k audio -v`
- [x] **Step 4: Implement** the two-source mixing argv in `build_audio_publisher`
  (both device args, both `volume`+named `level`, one `audiomixer`, one `shmsink`).
  Preserve `do-timestamp=true`, `provide-clock=false`, `latency=200000000`, and the
  `queue max-size-time=200000000` backpressure (they fix the dual-USB clock drift —
  see the block comment in `reference/pub_audio.py:build_pipeline`).
- [x] **Step 5: Run tests, confirm pass.** Also run the whole publishers suite to
  catch fixture consumers: `python -m pytest tests/publishers -v`.
- [x] **Step 6: Commit** — `feat(audio): mix lecturer+room mics into one shm socket with per-mic level taps (A-REV-018)`.

### Task 1.2: Two role-keyed level samplers reading the two named meters

**Files:**
- Modify: `services/pipeline-manager/src/pipeline_manager/audio/levels.py`
  (`GstLevelMeterTap` → parse per-element-name RMS; expose `read_rms(role)`), and
  `services/pipeline-manager/src/pipeline_manager/app.py:389`
  (`create_production_app`: build one meter feeding two samplers, one per role)
- Test: `services/pipeline-manager/tests/audio/test_levels.py`

**Interfaces:**
- Produces: the meter parses lines tagged by source element name (a `-m` level line
  includes the posting element, e.g. `/GstPipeline/GstLevel:lvl_mic_room`). Expose
  `read_rms(role: SourceRole) -> float` returning the latest linear RMS for that
  role. `app.state.audio_sampler` becomes a mapping `{SourceRole: AudioLevelSampler}`
  (one sampler per role), each constructed with `role=<role>` and
  `read_rms=lambda r=role: meter.read_rms(r)`.

- [x] **Step 1: Write failing tests** — (a) the meter maps `lvl_mic_lecturer` /
  `lvl_mic_room` lines to per-role RMS; (b) `AudioLevelSampler(role=MIC_ROOM)` emits
  `AudioLevelSample(role_id=MIC_ROOM, ...)`. Reuse the fake-clock/fake-sleep style
  already in the existing sampler tests.
- [x] **Step 2: Run, confirm fail.**
- [x] **Step 3: Implement** — extend `_parse_latest_rms` usage to also capture the
  element name (regex on `GstLevel:(\w+)`), store `self._latest_rms: dict[str,float]`,
  and map element-name → role. Update `create_production_app` to create both samplers
  and store them in a dict; update the subscription refcount to start/stop the right
  sampler(s).
- [x] **Step 4: Run, confirm pass** (`pytest tests/audio -v`).
- [x] **Step 5: Commit** — `feat(audio): per-role level samplers for lecturer+room (A-REV-012)`.

### Task 1.3: Accept mic-room in the audio control + route

**Files:**
- Modify: `services/pipeline-manager/src/pipeline_manager/audio/control.py`
  (lift the `role is not SourceRole.MIC_LECTURER` rejection to accept `MIC_ROOM`)
- Modify: `services/pipeline-manager/src/pipeline_manager/api/routes.py:479`
  (add `PUT /audio/controls/mic-room`, or parameterise the role in the path)
- Modify: `services/pipeline-manager/src/pipeline_manager/models.py:143`
  (`AudioControlRequest` docstring — LP-9 no longer "lecturer only")
- Test: `services/pipeline-manager/tests/audio/test_control.py` and the api route test

**Decision (sub-choice):** the lecturer path uses hardware `amixer` gain. For the
room mic, either (A) another `amixer` card/control, or (B) the software `volume`
element already in the Task 1.1 graph (like `reference/pub_audio.py`'s faders).
Recommend **A** for consistency with the existing control model; use **B** only if
the room mic has no ALSA mixer control. Record which you chose in the commit.

- [x] **Step 1: Write failing tests** — `apply_audio_control(role=MIC_ROOM, …)`
  returns `applied_state="applied"` for a valid card/control; the route
  `PUT /audio/controls/mic-room` returns 200. Keep the existing lecturer tests green.
- [x] **Step 2: Run, confirm fail.**
- [x] **Step 3: Implement** — accept both roles; map each role to its configured
  `card`/`control` (add room-mic card/control to `config.py` / Settings; read the
  current lecturer config there and mirror it). Update the route.
- [x] **Step 4: Run, confirm pass** (`pytest tests/audio tests/api -v`).
- [x] **Step 5: Commit** — `feat(audio): allow mic-room gain/mute control (LP-9/INV-AC-1 lifted)`.

> **CHECKPOINT 1 — review pipeline-manager.** Confirm: full pipeline-manager suite
> green (`python -m pytest`), the single mixed socket still carries valid audio, and
> STT/record still read it. Do not start core-api until this is green.

---

## Phase 2 — core-api: un-gate mic-room end to end

The `audio.levels` transport is already generic (`domain-bus.ts:29` keyed by
`roleId`, `panel-hub.ts` relays whatever PM emits) — so once PM emits mic-room
samples, they flow to the panel automatically. Phase 2 is about the **control**
path and the **source inventory**, which are gated to lecturer-only today.

### Task 2.1: Seed mic-room as a real, bound source

**Files:**
- Modify: `services/core-api/src/db/seeds.ts:22` (mic-room `provisionable`) and
  `:38-43` (add a `SourceBinding` for mic-room, e.g. `{ roleId: 'mic-room', kind: 'alsa', address: 'hw:8,0' }` — use the real device string from `/proc/asound/cards`)
- Modify: `services/core-api/src/db/device-bootstrap.ts:14` (add `'mic-room': input`
  to the inputs schema) and `:49` (add `'mic-room': 'audio'` to the publishers map)
- Modify: `services/core-api/src/modules/settings/bindings.ts:19,160-165`
  (add `'mic-room': 'audio'` to the publisher map; stop rejecting mic-room in
  `updateSourceBinding` — INV-SR-2/A-08 lifted)
- Test: the vitest suites next to each file (`*.test.ts`) — bindings, device-bootstrap, seeds/gate

- [x] **Step 1: Read** each file's current test to see the fixture shape, then write
  failing tests: mic-room is provisionable, has a binding, maps to the `audio`
  publisher, and `updateSourceBinding('mic-room', …)` succeeds.
- [x] **Step 2: Run, confirm fail** (`pnpm --filter @eduscope/core-api test`).
- [x] **Step 3: Implement** the seed/schema/bootstrap/binding edits. If a Drizzle
  migration is needed for the source-role/binding rows, add one under
  `services/core-api/migrations/` following the numbered pattern.
- [x] **Step 4: Run, confirm pass.**
- [x] **Step 5: Commit** — `feat(sources): bind and provision mic-room (INV-SR-2/A-08 lifted)`.

### Task 2.2: Allow mic-room audio control through core-api

**Files:**
- Modify: `services/core-api/src/modules/settings/audio-routes.ts:15-16`
  (`MUTABLE_ROLE_ID` → a set `{ 'mic-lecturer', 'mic-room' }`; LP-9/LP-14 lifted)
- Modify: `services/core-api/src/modules/recording/pm/client.ts:178`
  (parameterise the role in the PM call instead of the hardcoded
  `/audio/controls/mic-lecturer`) and `pm/types.ts:52` docstring
- Test: `audio-routes.test.ts`, `pm/client.test.ts`

- [x] **Step 1: Write failing tests** — an audio-control request for `mic-room`
  reaches PM at `/audio/controls/mic-room` and returns the readback result; a
  request for an unknown role is still rejected.
- [x] **Step 2: Run, confirm fail.**
- [x] **Step 3: Implement** — accept both roles, route by role id.
- [x] **Step 4: Run, confirm pass.**
- [x] **Step 5: Commit** — `feat(audio): route mic-room controls to pipeline-manager (LP-9/LP-14 lifted)`.

> **CHECKPOINT 2 — review core-api.** Confirm `pnpm --filter @eduscope/core-api test`
> and `pnpm --filter @eduscope/shared test` green, and the OpenAPI/contract checks
> pass (`updateAudioControl` summary in `contracts/openapi.yaml` now covers both
> roles — update it if the contract test flags it).

---

## Phase 3 — panel: render the second mic + its meter

`LevelMeter` is already keyed by `roleId`, and `telemetry-store.setLevel` already
stores any role — so the meter for mic-room lights up as soon as core-api relays
its samples. The work is making `MicRow` role-generic and rendering a second row.

### Task 3.1: Parameterise MicRow by role

**Files:**
- Modify: `apps/panel/src/screens/sources/mic-row.tsx` (accept a `roleId` +
  `displayName` prop instead of the hardcoded `const ROLE_ID = 'mic-lecturer'` and
  the literal "Lecturer Mic")
- Modify: `apps/panel/src/screens/sources/level-meter.tsx:38` (the hardcoded
  `aria-label="Lecturer microphone level"` → derive from the role/name prop)
- Test: `apps/panel/src/screens/sources/mic-row.test.tsx`,
  `level-meter.test.tsx`

**Interfaces:**
- Produces: `MicRow({ roleId, displayName }: { roleId: SourceRoleId; displayName: string })`.

- [x] **Step 1: Write failing tests** — render `<MicRow roleId="mic-room"
  displayName="Room Mic" />`, assert the name, the `LevelMeter` bound to `mic-room`,
  and that `useAudioControl('mic-room')` is used. Keep the lecturer test by passing
  the lecturer props.
- [x] **Step 2: Run, confirm fail** (`pnpm --filter @eduscope/panel test -- mic-row`).
- [x] **Step 3: Implement** — replace the module-level `ROLE_ID`/literals with the
  props; thread `roleId`/name into `useAudioControl`, `LevelMeter`, labels and
  aria-labels. Confirm `use-audio-control.ts` is role-generic (it takes a `roleId`
  arg already) — if it hardcodes lecturer anywhere, fix it here.
- [x] **Step 4: Run, confirm pass.**
- [x] **Step 5: Commit** — `refactor(panel): make MicRow role-generic`.

### Task 3.2: Render the Room Mic row in the sources bar

**Files:**
- Modify: `apps/panel/src/screens/sources/sources-bar.tsx:90` (render a second
  `MicRow` for `mic-room` below the lecturer one)
- Test: `apps/panel/src/screens/sources/sources-bar.test.tsx` (if present)

- [x] **Step 1: Write/adjust failing test** — the sources bar shows both a
  "Lecturer Mic" and a "Room Mic" row.
- [x] **Step 2: Run, confirm fail.**
- [x] **Step 3: Implement:**

```tsx
<MicRow roleId="mic-lecturer" displayName="Lecturer Mic" />
<MicRow roleId="mic-room" displayName="Room Mic" />
```

- [x] **Step 4: Run, confirm pass.**
- [x] **Step 5: Commit** — `feat(panel): show Room Mic row with its own VU meter`.

> **CHECKPOINT 3 — review panel.** `pnpm --filter @eduscope/panel test` green.

---

## Phase 4 — Green verification (repo + hardware)

### Task 4.1: Full monorepo test pass

- [x] `python -m pytest` in `services/pipeline-manager` — green.
- [x] `pnpm -w test` (or the workstream-F command you normally run) — green,
  including shared contract/OpenAPI checks.
- [x] Lint/typecheck as the repo defines (`pnpm -w lint`, `tsc`).

### Task 4.2: Hardware verification

- [x] Deploy the built stack to the device (your normal workstream-F deploy path).
- [x] Confirm `/proc/asound/cards` shows both mics; set the real device strings in
  the PM audio config / bindings if they differ from the seeded defaults.
- [ ] In the panel: both rows visible; speak into each mic → its bar moves and only
  its bar; gain/mute works per mic; STT + a test recording still have audio.

### Task 4.3 (optional): Independent bench sanity with the reference scripts

`reference/pub_audio.py` + `reference/eduscope_web.py` are the hardware engineer's
legacy-panel scripts. They are a **fast, isolated way to prove the two-mic hardware
itself works** before trusting the full stack — a two-mic VU meter at `:8080`.

- [ ] Run them **only while the monorepo pipeline-manager/STT are stopped** — both
  systems use the same `/tmp/audio.sock`; running both at once makes the monorepo
  read the mixed socket while its control still targets one card. Never concurrent.
- [ ] See the separate device bring-up prompt for the safe backup/dry-run/rollback
  procedure for those scripts.

---

## Self-review notes (for the executor)

- Every "flat meter" symptom during Phases 1–3 → re-run Task 0.1 diagnosis first;
  the parser/socket is almost always the cause, not the React layer.
- The single mixed socket is the safety anchor: if STT or recording loses audio
  after an audio-publisher change, the mix/caps/socket-path drifted from the Global
  Constraints — diff the built argv against `reference/pub_audio.py`.
- Role ids are strings shared across three languages; grep all three packages for a
  new literal before introducing it (you should not need any beyond `mic-room`).

## How to run this plan

On the machine with the repo checkout, launch Claude Code and say:

> Read `PLAN.md` in this folder and implement it phase by phase. Stop at every
> CHECKPOINT for my review. Start with Phase 0. `reference/pub_audio.py` and
> `reference/eduscope_web.py` are read-only references — do not modify or deploy them.
