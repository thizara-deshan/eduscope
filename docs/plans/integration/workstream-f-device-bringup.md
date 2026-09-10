# Workstream F — Device Bring-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproducibly provision the approved RK3588 image, bind the frozen room hardware to the already-built A–E services, harden and order the device processes, boot the real panel in an X11 kiosk, and collect every final on-device witness required by Workstream F.

**Architecture:** A root-only, idempotent installer validates a per-device manifest before mutation, installs immutable release artifacts, renders deploy-owned configuration, and enables narrowly privileged systemd units. Application processes remain unprivileged and loopback-only; the only privileged runtime boundary is a socket-activated Python helper using the canonical `{verb,args,requestId} → {ok,detail}` protocol, `SO_PEERCRED`, strict verb schemas, fixed argv, and per-verb limits. Nginx supplies the panel's single origin and local RTMP relay, while GDM owns one X11 login for the kiosk account and stable udev/ALSA/display identities come only from the frozen manifest.

**Tech Stack:** Ubuntu 24.04/aarch64 target baseline (verified, then frozen by F-01), systemd 255, Python 3.12/stdlib helper, Node.js >=22.13, pnpm 9.12.3, TypeScript 5.6, Fastify 5, FastAPI/Uvicorn, SQLite/Drizzle, GStreamer 1.x with RK3588 MPP elements, Nginx + nginx-rtmp, stunnel4, ALSA, udev, X11/GDM, Chromium, Bash, Bats, ShellCheck, `ffprobe`, and the v1.0.0 contracts.

**Spec:** `docs/plans/integration-plan.md` § “Workstream F — device bring-up”; `docs/design/pipeline-manager.md`; `docs/design/core-api.md`; `docs/design/ai-services.md`; `docs/design/quiz-service.md`; `docs/design/domain-model.md`; `docs/design/state-machines.md`; `contracts/openapi.yaml`; `contracts/quiz-app.yaml`; `contracts/events.md`

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

### Workstream F fixed scope and execution gate

- Workstream F is exactly F-01 through F-14 in master order. No task owns a v1 operation or event.
- F-09 through F-14 are the final tasks. Together they execute, without simulation substitution, the master plan's eleven “Expanded on-device verification procedures” in the same order.
- KEEP ownership remains exactly: F-10 → B-03/B-05/B-07/B-10/B-15/B-23; F-11 → B-27/B-28; F-13 → B-39/B-50/B-53/B-56/B-59/B-60.
- D-02b remains open. F-11 proves the local TLS placeholder adapter only and labels its evidence `placeholder only / D-02b still open`.
- Room lights, AC, projector power, physical record buttons, scheduled recording, and auto-shutdown remain outside scope.
- Production adapter config is exactly `{ "default": "real", "overrides": {} }`; the mock gate runs independently and remains green.
- Shared media root is exactly `/media/eduscope` for core-api, pipeline-manager, and slide-service. A/C's code defaults differ today, so F-03's rendered environment must override them.
- Shared GStreamer sockets remain the already-executed A/C paths `/tmp/{usb,rtsp,rtsp2,audio}.sock`. Consequently `PrivateTmp=false` is mandatory for pipeline-manager and STT; changing socket paths belongs to A/C, not F.
- The current helper wire mismatch, first-seed hardware/user gap, relay candidate gap, expected mount omission, X11 session omission, and production build omission are corrected inside their existing F tasks exactly as recorded in the master-plan F gate flag dated 2026-09-08.
- **Signed-updater gate reclassified (approved 2026-09-10):** F-02a is the host-side helper/client implementation. F-03 through F-08 depend on F-02a and may proceed while firmware calls remain injected-runner-only and labelled `not firmware acceptance`. F-02b is a later physical-device gate beside F-09/F-12; it requires the release-owner interface, trust root, A/B layout, boot-success marker, and automatic rollback, and it must pass before production F-09. The inspected target has one root filesystem and no updater, so F-02b remains open. Fixtures never close it.
- **Demo/staging install exception (approved 2026-09-10):** F-08 may install on the current single-rootfs Radxa with `--profile demo-staging --acknowledge-open-firmware-acceptance`. This profile skips only updater/A-B preflight, does not create or simulate slots, disables `firmware.apply` and `firmware.rollback` at the helper boundary, and shows `placeholder / firmware acceptance still open` in both panel UI and install output. It produces demo smoke evidence only—never F-02b, F-09, or final Workstream F PASS evidence.
- **Demo/staging hardware exception (approved 2026-09-10):** F-04 may render with `--profile demo-staging` while final display/passthrough observations and the dedicated recordings volume remain unavailable. It reports `display/passthrough acceptance open` and/or `recordings volume acceptance open`, and permits `/media/eduscope` on the current SD-card root filesystem. Production still rejects every unresolved F-04 field. Demo rendering and a current-boot recording smoke test never satisfy F-04's cold-boot/replug acceptance witness.
- **Demo/staging kiosk exception (approved 2026-09-10):** F-07 may run with `--profile demo-staging` while the final three-display topology is unavailable. It requires the currently connected `HDMI-1` and `DP-2` outputs, treats `HDMI-1` as the temporary 1280×800 primary panel, maps the frozen touch device only to that output, places `DP-2` at its preferred mode immediately to the right, and reports `multi-display acceptance open`. Production remains fail-safe and requires exactly one match for each of the three frozen EDID hashes before changing layout. The demo two-display smoke never satisfies F-07's deterministic three-display or two-cold-boot acceptance witness.
- **STOP before F-12 execution:** D-10/D-11 require an actual campus PostgreSQL 16 host, DNS name, valid TLS certificate, and firewall route. Local Testcontainers do not replace the physical-phone/campus staging witness.

### Management demo readiness

- **Earliest honest recording demo: after F-08's demo/staging Step 7 passes.** At that point the panel is served at `http://127.0.0.1/`, helper/non-firmware operations and local A/B/C services are installed and ordered, the physical capture/audio path can record and finalize a two-minute clip, and `ffprobe` verifies the result. The persistent banner and install report state that firmware and recordings-volume acceptance remain open.
- Device bring-up does not install campus D on localhost. For a quiz preview before F-12, the demo report must name either the mock quiz domains or a separately launched local D integration stack; neither is the real campus/30-phone acceptance.
- **Production device demo: after F-09.** This adds F-02b, a freshly flashed A/B-capable image, the dedicated recordings volume, two successful boots, real adapters, and clean-install evidence.
- **Full product acceptance: after F-14.** F-10–F-14 add long-recording/recovery, upload/AI, campus quiz, hardware fault/power, and resource-headroom evidence.

### Repository and test conventions

- Run Node/pnpm commands from the repository root. Run pipeline-manager tests from `services/pipeline-manager` with `.venv/bin/python -m pytest`. New deploy/helper tests use Python stdlib `unittest`, Bats, and ShellCheck so they run before application installation.
- Every automated task starts with a failing focused test, proves the intended failure, implements the minimum change, reruns its focused suite plus the v1 regression named below, and ends in exactly one commit.
- Physical evidence is never fabricated. A template's result is `NOT RUN`; a dated evidence directory is committed only after the command completed and its parser printed the stated `PASS` line.
- Secrets never appear in Git, command arguments, process listings, evidence, rendered `/run/eduscope/config.json`, or journal output. Secret-bearing inputs use protected files or stdin.
- Template tokens use `@NAME@`. Renderers must reject any token left in an installed file. Installed runtime configuration must contain neither `@NAME@` nor `<TBC>`.
- Before every commit run `git diff --check` and `git status --short`; stage only the task's files and preserve unrelated changes.
- The common contract regression is:

  ```bash
  pnpm --filter @eduscope/shared test
  pnpm --filter @eduscope/core-api test:contract
  pnpm --filter @eduscope/api-client test
  ```

  Expected: all three commands exit 0; v1 remains `1.0.0`, the mock stays green, and no contract file changes.

## File and Responsibility Map

| Area | Files | Responsibility |
|---|---|---|
| Frozen facts | `deploy/provisioning/device-manifest*`, `scripts/bringup/{inventory,validate-manifest}.*` | Record supported image, board, USB/ALSA/display/touch/storage/network/LED and P-1/P-3 facts; reject ambiguity before rendering. |
| Privilege boundary | `services/privileged-helper/**`, A helper client/tests, `deploy/provisioning/updater-interface.schema.json` | Canonical framing, peer credentials, schemas, rate limits, audit, and fixed argv. |
| Identity/config | `deploy/{sysusers,tmpfiles,runtime,provisioning}/**`, B config/seeds/bootstrap | Least-privilege accounts/paths; secret-safe runtime files; first-seed hardware and forced-reset admin. |
| Hardware names | `deploy/{udev,alsa}/**`, renderer/tests | Stable capture/touch/storage matching and named ALSA PCMs with no numeric-card dependency. |
| Service graph | `deploy/systemd/**`, verifier/tests | Expected recordings mount, socket helper, runtime render, A/B/C, kiosk, and relay ordering/hardening. |
| Single origin/relay | `deploy/{nginx,stunnel}/**`, B relay candidate writer, helper relay handler | Static panel, REST/WS/Range proxy, local RTMP ingest, secret-bearing candidate promotion, graceful reload. |
| Kiosk | `deploy/kiosk/**` | GDM X11 ownership, EDID placement, touch mapping, managed policy, and Chromium launcher. |
| Installation | `deploy/install.sh`, `deploy/lib/**`, production build configs, `deploy/README.md`, `deploy/tests/**` | Preflight, snapshot, build/install, validate, enable, smoke, idempotency, and rollback. |
| Final evidence | `scripts/bringup/**`, `docs/evidence/phase-4/workstream-f/**` | Parseable, dated F-09…F-14 device/campus procedures and completeness gate. |

---

### Task F-01: Freeze target hardware manifest

**Files:**
- Create: `deploy/provisioning/device-manifest.schema.json`
- Create: `deploy/provisioning/device-manifest.example.json`
- Create: `scripts/bringup/inventory.sh`
- Create: `scripts/bringup/validate-manifest.py`
- Create: `deploy/tests/test_device_manifest.py`
- Create outside Git: `/etc/eduscope-private/device-manifest.json`

**Interfaces:**
- Produces: schema-version `1` manifest; `validate-manifest.py MANIFEST [--deployable]` printing `PASS device manifest`; raw inventory directory with one file per command plus `sha256sums.txt`.
- Consumes: the physical target and attached room hardware; H-1…H-5, P-1, and P-3 facts; no guessed identifier.

- [ ] **Step 1: Write schema and duplicate/sentinel tests**

  `test_device_manifest.py` loads the example and asserts the schema requires these exact sections and values:

  ```text
  schemaVersion=1
  image={name|null,sourceUrl|null,sha256|null,osId,osVersion,architecture,kernelRelease}
  board={model,serial,memoryBytes}
  capture={vid,pid,serial|null,usbPortPath,videoByPath,v4lIndex,hubLocation,hubPort}
  audio={micCardId,micPcmDevice,micControl,hdmi2CardId|null,hdmi2PcmDevice|null,format,rateHz,channels}
  displays=[{role:projector|meeting|panel,edidSha256|null,observedConnector|null,mode|null,width|null,height|null,refreshHz|null}]
  touch={vid,pid,serial|null,name}
  hdmiPassthrough={inputConnector|null,outputConnector|null,observedPath|null,latencyMs|null}
  storage={recordingsUuid|null,filesystem,minBytes|null}
  network={wiredInterface}
  led={present:false,reason} | {present:true,sysfsName,activeValue}
  integrations={hallCode,titlePattern,timezone,ntpServers,quizPublicOrigin|null,llmEndpoint|null}
  chromium={forceHardwareAcceleration:false}
  ```

  Image provenance (`image.name`, `image.sourceUrl`, and `image.sha256`) may be
  `null` through F-08 when the original approved image artifact is unavailable.
  F-09 is the named hard gate for resolving all three values: its clean-device
  production installer and acceptance procedure must reject a manifest with any
  unresolved image-provenance value before flashing or production installation.
  F-08's acknowledged `demo-staging` profile may install onto the already-running
  target with unresolved provenance, but must report that deferral and cannot
  produce F-09 evidence.

  When final room displays and their HDMI-audio mapping, passthrough wiring, or the dedicated recordings
  volume are not yet installed, their observed fields above may be `null` in
  F-01. F-04 is the named hard gate for resolving them: its renderer and
  physical replug verification must reject any unresolved display, HDMI-audio,
  passthrough, or recordings-volume value. The current root filesystem UUID
  must not be substituted for the intended recordings volume.

  Assert display roles are exactly `{projector,meeting,panel}`, EDID hashes are unique, `micCardId`/`hdmi2CardId` are nonnumeric ALSA IDs, UUID/VID/PID/hash formats are strict, `filesystem` is `ext4`, audio is `S16LE/48000/2`, panel is `1280×800`, and `--deployable` rejects empty strings, sentinel words, example domains, unresolved required hosts, duplicate identities, and a capture symlink not under `/dev/v4l/by-path/`.

- [ ] **Step 2: Run the tests and verify red**

  Run: `python3 -m unittest deploy.tests.test_device_manifest -v`

  Expected: FAIL because the schema, validator, and example do not exist.

- [ ] **Step 3: Implement the manifest schema, example, validator, and inventory collector**

  Use JSON Schema draft 2020-12 with `additionalProperties:false` at every object. `validate-manifest.py` must use `jsonschema.Draft202012Validator`, perform the cross-field checks above, recursively reject `TBC|TBD|TODO|CHANGEME|example.com` under `--deployable`, and print every error as `path: message` before exiting 1.

  `inventory.sh` is read-only and has this exact command surface:

  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  umask 077
  [[ ${1:-} == --output && -n ${2:-} ]] || { echo 'usage: inventory.sh --output DIR' >&2; exit 64; }
  evidence_dir=$2
  mkdir -p "$evidence_dir"
  run() { local name=$1; shift; { printf '$'; printf ' %q' "$@"; printf '\n'; "$@"; } >"$evidence_dir/$name.txt" 2>&1 || true; }
  run os-release sh -c 'cat /etc/os-release; uname -a; uname -m'
  run board sh -c 'tr -d "\\0" </proc/device-tree/model; printf "\\n"; cat /proc/meminfo'
  run block lsblk --json --bytes --output NAME,PATH,TYPE,SIZE,FSTYPE,LABEL,UUID,PARTUUID,MOUNTPOINTS,MODEL,SERIAL,TRAN
  run usb lsusb -v
  run video v4l2-ctl --list-devices
  run audio-capture arecord -l
  run audio-playback aplay -l
  run alsa-ids sh -c 'for p in /proc/asound/card*/id; do printf "%s " "$p"; cat "$p"; done'
  run displays xrandr --props
  run display-edids sh -c 'for p in /sys/class/drm/card*-*/edid; do test -s "$p" && sha256sum "$p"; done'
  run input udevadm info --export-db
  run gpio sh -c 'command -v gpioinfo >/dev/null && { gpiodetect; gpioinfo; }; find /sys/class/leds -maxdepth 2 -type f -print 2>/dev/null'
  run network networkctl list --no-legend
  run versions sh -c 'node --version; pnpm --version; python3 --version; systemd --version | head -1; gst-inspect-1.0 --version | head -1; nginx -v; stunnel4 -version 2>&1 | head -1; chromium --version || chromium-browser --version'
  (cd "$evidence_dir" && sha256sum ./*.txt >sha256sums.txt)
  printf 'PASS inventory captured: %s\n' "$evidence_dir"
  ```

  Copy facts into the private manifest with these mappings: H-1 capture tuple/path/hub, H-2 canonical room-mic ALSA IDs/control, H-3 three display EDIDs/connectors/modes plus touch tuple, H-4 LED present/config or explicit absent reason, H-5 observed HDMI passthrough topology in `hdmiPassthrough`, P-1 hall/title/timezone, P-3 campus origin and LLM endpoint. Embedded capture-card audio is not the room mic and is not stored in `audio.mic*`. Record the exact supported-image name, source URL, and SHA-256 when known; otherwise set all three to `null`. F-09 must resolve all three and reject unresolved image provenance before flashing or production installation; the current installed version string alone is insufficient. F-08 demo/staging may use the already-running image only under its explicit non-acceptance profile. Fields explicitly deferred above remain `null` until F-04; do not substitute the root filesystem for the production recordings volume.

- [ ] **Step 4: Validate both the example and the private deployable manifest**

  Run:

  ```bash
  python3 scripts/bringup/validate-manifest.py deploy/provisioning/device-manifest.example.json
  python3 scripts/bringup/validate-manifest.py /etc/eduscope-private/device-manifest.json --deployable
  ```

  Expected:

  ```text
  PASS device manifest
  PASS device manifest
  ```

  If the second command cannot print PASS, stop the dependent task named by the missing field. Do not place the private manifest or its raw serials in Git.

- [ ] **Step 5: Run contract regression and commit**

  Run the common contract regression, then:

  ```bash
  git diff --check
  git add deploy/provisioning/device-manifest.schema.json deploy/provisioning/device-manifest.example.json deploy/tests/test_device_manifest.py scripts/bringup/inventory.sh scripts/bringup/validate-manifest.py
  git commit -m "chore(deploy): freeze device manifest format"
  ```

---

### Task F-02: Implement the privileged helper and canonicalize its clients

F-02a is the host-side implementation and regression phase in Steps 1–7. The later F-02b gate appears between F-08 and F-09. The specified F-02 commit closes F-02a and opens F-03 through F-08. It does not close firmware acceptance or open production F-09.

**Files:**
- Create: `deploy/provisioning/updater-interface.schema.json`
- Create: `services/privileged-helper/pyproject.toml`
- Create: `services/privileged-helper/src/eduscope_privileged_helper/{__init__,peer,verbs,server}.py`
- Create: `services/privileged-helper/tests/{test_peer,test_protocol,test_verbs,test_rate_limits}.py`
- Modify: `services/pipeline-manager/src/pipeline_manager/hardware/helper_client.py`
- Modify: `services/pipeline-manager/tests/hardware/{fake_helper,test_helper_client}.py`
- Test: `services/core-api/test/storage/volumes.test.ts`
- Test: `services/core-api/test/device/power.test.ts`
- Test: `services/core-api/test/settings/network.test.ts`
- Test: `services/core-api/test/firmware/firmware.test.ts`

**Interfaces:**
- Consumes: systemd listener fd 3; `/etc/eduscope/helper.json`; canonical request `{verb,args,requestId}`. F-02a fixes the updater executable path without requiring it to exist; F-02b later consumes the reviewed executable.
- Produces: one newline-delimited response `{ok:true,detail:string}` or `{ok:false,detail:string}`; `peer_credentials(socket)->PeerCredentials(pid,uid,gid)`; `VerbRegistry.dispatch(request,peer)`; JSON audit per request.

- [ ] **Step 1: Write failing peer, framing, verb, and rate-limit tests**

  Cover: `SO_PEERCRED` unpacking with `struct.Struct('3i')`; UID allowlist for `eduscope-core` and `eduscope-pipeline`; exactly one UTF-8 JSON line capped at 64 KiB; canonical `requestId` only (reject A's old `id`); duplicate/extra/missing fields; all twelve verbs; wrong types; traversal; control characters; devnodes outside `/dev`; unknown interface/UUID/hub/LED; wrong UID; response redaction; runner timeout; no shell; exact argv; per-verb rolling-window exhaustion; audit containing request id/uid/verb/result/duration but no stream key, bearer, password, or full network payload.

- [ ] **Step 2: Run focused suites and verify red**

  Run:

  ```bash
  python3 -m unittest discover -s services/privileged-helper/tests -v
  cd services/pipeline-manager && .venv/bin/python -m pytest tests/hardware/test_helper_client.py tests/hardware/test_led.py tests/hardware/test_watchdog.py -q
  ```

  Expected: helper import tests fail and A's canonical framing assertions fail.

- [ ] **Step 3: Implement peer checking and socket-activated framing**

  In F-02a, encode only the minimum interface fields already fixed by this plan in `updater-interface.schema.json` and validate representative test data. In F-02b, reconcile that schema with the acknowledged release-owner document and add the test that the real `describe` output validates against it; F does not choose or extend updater fields.

  `pyproject.toml` is complete:

  ```toml
  [build-system]
  requires = ["setuptools>=75,<76"]
  build-backend = "setuptools.build_meta"

  [project]
  name = "eduscope-privileged-helper"
  version = "0.1.0"
  requires-python = ">=3.11"
  dependencies = []

  [project.scripts]
  eduscope-privileged-helper = "eduscope_privileged_helper.server:main"

  [tool.setuptools.packages.find]
  where = ["src"]
  ```

  `peer.py` must use the kernel credential, never a client field:

  ```python
  import socket, struct
  from dataclasses import dataclass

  _UCRED = struct.Struct("3i")

  @dataclass(frozen=True)
  class PeerCredentials:
      pid: int
      uid: int
      gid: int

  def peer_credentials(conn: socket.socket) -> PeerCredentials:
      raw = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, _UCRED.size)
      return PeerCredentials(*_UCRED.unpack(raw))
  ```

  `server.py` adopts fd 3 only when `LISTEN_PID == os.getpid()` and `LISTEN_FDS == 1`, accepts one request per connection, applies a 5-second read timeout and 64-KiB limit, rejects non-allowlisted UIDs before JSON dispatch, writes one response line, and logs one redacted JSON audit to stdout. Directly binding `/run/eduscope/helper.sock` is allowed only behind an injected test listener; production refuses to unlink or replace the systemd-owned socket.

- [ ] **Step 4: Implement the closed verb registry with fixed argv**

  Define strict dataclass validators and the following only; the runner receives `tuple[str,...]`, uses `subprocess.run(..., shell=False, check=False, capture_output=True, text=True, timeout=VERB_TIMEOUT[verb])`, and accepts no executable from input:

  | Verb | Strict args | Fixed operation |
  |---|---|---|
  | `net.apply` | current manifest interface + complete wired config | atomically write `/etc/systemd/network/80-eduscope-<iface>.network`; run `networkctl reload`, then `networkctl reconfigure <iface>` |
  | `volume.mount` | safe UUID | resolve `/dev/disk/by-uuid/<uuid>`; `systemd-mount --no-block --collect <resolved> /media/eduscope/<uuid>` |
  | `volume.unmount` | safe UUID | `systemd-umount /media/eduscope/<uuid>` |
  | `volume.format` | current non-system, unmounted `/dev/...`; `fs=ext4`; safe label | `mkfs.ext4 -F -L <label> <resolved-devnode>` |
  | `usbhub.cycle` | exact manifest location/port | `uhubctl -l <location> -p <port> -a cycle` |
  | `led.set` | `on|off|blink` | update only the manifest's LED sysfs node; absent LED returns a logged `ok` no-op |
  | `system.poweroff` | empty object | `systemctl poweroff` |
  | `firmware.check` | optional safe version | `/usr/libexec/eduscope-updater check --json [--version <v>]` |
  | `firmware.apply` | optional safe version | `/usr/libexec/eduscope-updater apply --json [--version <v>]` |
  | `firmware.rollback` | optional safe version | `/usr/libexec/eduscope-updater rollback --json [--version <v>]` |
  | `relay.reload` | 64-lowercase-hex `configDigest` | F-06's fixed `/usr/libexec/eduscope-relay-reload <digest>` |
  | `smart.read` | current `/dev/...` | `smartctl -j <resolved-devnode>` |

  Re-resolve UUID/devnode/interface/mount state at dispatch time. Reject the root filesystem, its parents, mounted format targets, symlinks escaping `/dev`, labels with control/shell characters, and network fields not already allowed by B. Rate limits are: `led.set` 120/min, `relay.reload` 30/min, `net.apply` 10/min, `smart.read` 12/min, `volume.mount|unmount` 10/min, `volume.format` 1/10min, `usbhub.cycle` 2/hour, `system.poweroff` 1/min, `firmware.check` 6/hour, `firmware.apply|rollback` 1/hour. Persist timestamps atomically at `/run/eduscope/helper/rate-limits.json`.

- [ ] **Step 5: Canonicalize A's client**

  Replace A's request key `id` with `requestId`; parse only `{ok:boolean,detail:string}`; preserve 16-KiB response and 2-second connect/response timeouts; return a typed response carrying `request_id`, `ok`, and `detail`. `set_led()` and `cycle_usb_hub()` remain the only public methods. The fake helper must reject either old request/response shape so protocol drift cannot recur.

- [ ] **Step 6: Run helper, A/B regressions, and the source safety scan**

  Run:

  ```bash
  python3 -m unittest discover -s services/privileged-helper/tests -v
  cd services/pipeline-manager && .venv/bin/python -m pytest tests/hardware -q
  cd ../.. && pnpm --filter @eduscope/core-api test -- test/storage/volumes.test.ts test/device/power.test.ts test/settings/network.test.ts test/firmware/firmware.test.ts
  rg -n 'sudo|shell\s*=\s*True|shell:\s*true|generic.exec|child_process\.exec\(' services/privileged-helper services/pipeline-manager/src services/core-api/src
  ```

  Expected: all tests pass; scan has no application `sudo`, shell execution, generic verb, or string-exec call.

- [ ] **Step 7: Run contract regression and commit**

  ```bash
  git diff --check
  git add deploy/provisioning/updater-interface.schema.json services/privileged-helper services/pipeline-manager/src/pipeline_manager/hardware/helper_client.py services/pipeline-manager/tests/hardware
  git commit -m "feat(device): add audited privileged helper"
  ```

---

### Task F-03: Create accounts, paths, provisioning, secrets, and first-seed bootstrap

**Files:**
- Create: `deploy/sysusers/eduscope.conf`
- Create: `deploy/tmpfiles/eduscope.conf`
- Create: `deploy/provisioning/{provisioning.schema.json,secrets.schema.json,secrets.example.json}`
- Create: `deploy/runtime/{render.py,device-bootstrap.schema.json}`
- Create: `deploy/tests/{test_runtime_render.py,test_sysusers_tmpfiles.py}`
- Modify: `services/core-api/src/config.ts`
- Modify: `services/core-api/src/db/seeds.ts`
- Modify: `services/core-api/src/app.ts`
- Create: `services/core-api/src/db/device-bootstrap.ts`
- Create: `services/core-api/test/db/device-bootstrap.test.ts`

**Interfaces:**
- Consumes: validated private F-01 manifest and protected `secrets.json`.
- Produces: users/groups; paths; `/etc/eduscope/{device-manifest,provisioning,device-bootstrap}.json`; per-service `/run/eduscope/env/*.env`; public `/run/eduscope/config.json`; first-seed-only source/network/admin initialization.

- [ ] **Step 1: Write failing permission/render/bootstrap tests**

  Assert exact users/groups, directory owners/modes, atomic same-directory replace, symlink/path-traversal refusal, secret length >=32, secret absence from public JSON/log strings, common media root, first seed from frozen aliases, startup push of all enabled bindings to A, exactly one forced-reset admin on an empty user table, and no overwrite/recreation after an administrator changes a binding/interface/user.

- [ ] **Step 2: Run and verify red**

  Run:

  ```bash
  python3 -m unittest deploy.tests.test_runtime_render deploy.tests.test_sysusers_tmpfiles -v
  pnpm --filter @eduscope/core-api test -- test/db/device-bootstrap.test.ts test/unit/config.test.ts
  ```

  Expected: FAIL because the deploy files and bootstrap input do not exist.

- [ ] **Step 3: Add exact sysusers and tmpfiles definitions**

  `deploy/sysusers/eduscope.conf`:

  ```text
  g eduscope -
  g eduscope-media -
  u eduscope-core - "Eduscope core API" /var/lib/eduscope /usr/sbin/nologin
  u eduscope-pipeline - "Eduscope pipeline manager" /var/lib/eduscope/pipeline-manager /usr/sbin/nologin
  u eduscope-ai - "Eduscope AI services" /var/lib/eduscope/ai /usr/sbin/nologin
  u eduscope-kiosk - "Eduscope kiosk" /var/lib/eduscope/kiosk /bin/bash
  m eduscope-core eduscope
  m eduscope-pipeline eduscope
  m eduscope-core eduscope-media
  m eduscope-pipeline eduscope-media
  m eduscope-ai eduscope-media
  m eduscope-pipeline video
  m eduscope-pipeline audio
  m eduscope-pipeline render
  m eduscope-ai audio
  m eduscope-kiosk video
  m eduscope-kiosk render
  ```

  `deploy/tmpfiles/eduscope.conf`:

  ```text
  d /run/eduscope 0750 root eduscope -
  d /run/eduscope/env 0750 root eduscope -
  d /run/eduscope/helper 0700 root root -
  d /run/eduscope/pipeline-manager 0750 eduscope-pipeline eduscope -
  d /run/eduscope/relay 0710 eduscope-core eduscope -
  d /var/lib/eduscope 0750 eduscope-core eduscope-media -
  d /var/lib/eduscope/secrets 0700 eduscope-core eduscope-core -
  d /var/lib/eduscope/pipeline-manager 0750 eduscope-pipeline eduscope-media -
  d /var/lib/eduscope/ai 0750 eduscope-ai eduscope-media -
  d /var/lib/eduscope/kiosk 0700 eduscope-kiosk eduscope-kiosk -
  d /media/eduscope 2770 root eduscope-media -
  ```

- [ ] **Step 4: Implement strict render inputs and atomic outputs**

  `render.py` accepts only:

  ```text
  render.py --manifest /etc/eduscope/device-manifest.json
            --provisioning /etc/eduscope/provisioning.json
            --secrets /etc/eduscope/secrets.json
            --output-root /run/eduscope
            --profile production|demo-staging
            [--check]
  ```

  It validates both schemas, requires owner UID 0 and modes no broader than 0640, rejects symlinks, writes each file with `openat`/`O_NOFOLLOW` to a same-directory temp, `fsync`, `fchmod`, `fchown`, and `os.replace`, then fsyncs the directory. Render exactly:

  ```text
  config.json                 root:root             0644  E production config only
  env/core.env                root:eduscope-core    0640
  env/pipeline.env            root:eduscope-pipeline 0640
  env/stt.env                 root:eduscope-ai      0640
  env/slide.env               root:eduscope-ai      0640
  env/question.env            root:eduscope-ai      0640
  ```

  Production `config.json` is exactly:

  ```json
  {"apiBaseUrl":"/api/v1","quizBaseUrl":"https://quiz.campus.invalid","environment":"production","adapters":{"default":"real","overrides":{}},"deploymentProfile":"production","notices":[]}
  ```

  The shown origin is the schema-valid example output; a deployable production render substitutes the manifest's non-example HTTPS P-3 origin and refuses null when F-12 is being accepted. `demo-staging` keeps the real local A/B/C adapters, sets `deploymentProfile` to `demo-staging`, and sets `notices` to exactly `["placeholder / firmware acceptance still open"]`; it may use the mock quiz adapter or a separately launched local D endpoint but must identify that choice in the install report. Environment files set loopback ports `5000`, `8091`, `7101`, `7102`, `7103`; the common internal bearer; `/media/eduscope`; `/run/eduscope`; PM helper/capture-hub/LED/ALSA settings; Vosk model path/version; and production core JWT/secretbox keys. No secret enters `config.json` or `device-bootstrap.json`.

  Render these exact env keys (right-hand `@...@` values come from the validated manifest/secrets and are never committed):

  `env/core.env`:

  ```text
  NODE_ENV=production
  CORE_API_HOST=127.0.0.1
  CORE_API_PORT=5000
  CORE_API_DB_PATH=/var/lib/eduscope/core.db
  CORE_API_RECORDINGS_ROOT=/media/eduscope
  CORE_API_RUNTIME_DIR=/run/eduscope
  CORE_API_PROVISIONING_PATH=/etc/eduscope/provisioning.json
  CORE_API_DEVICE_BOOTSTRAP_PATH=/etc/eduscope/device-bootstrap.json
  CORE_API_BOOTSTRAP_ADMIN_PASSWORD_FILE=/etc/eduscope/bootstrap-admin.password
  CORE_API_HELPER_SOCKET=/run/eduscope/helper.sock
  CORE_API_PM_BASE_URL=http://127.0.0.1:8091
  CORE_API_INTERNAL_BEARER=@INTERNAL_BEARER@
  CORE_API_JWT_SECRET=@JWT_SECRET@
  CORE_API_SECRETBOX_KEY=@SECRETBOX_KEY@
  EDUSCOPE_CORE_LOG_MAX_ROWS=50000
  EDUSCOPE_CORE_LOG_MAX_AGE_DAYS=90
  ```

  `env/pipeline.env`:

  ```text
  EDUSCOPE_PM_BIND_HOST=127.0.0.1
  EDUSCOPE_PM_PORT=8091
  EDUSCOPE_PM_PLATFORM_ID=rk3588
  EDUSCOPE_PM_SHARED_BEARER_TOKEN=@INTERNAL_BEARER@
  EDUSCOPE_PM_RECORDINGS_ROOT=/media/eduscope
  EDUSCOPE_PM_RUNTIME_ROOT=/run/eduscope
  EDUSCOPE_PM_HELPER_SOCKET=/run/eduscope/helper.sock
  EDUSCOPE_PM_RUNTIME_DIR=/run/eduscope/pipeline-manager
  EDUSCOPE_PM_CAPTURE_CARD_STABLE_IDENTIFIER=/dev/eduscope/pc-capture
  EDUSCOPE_PM_CAPTURE_CARD_HUB_LOCATION=@CAPTURE_HUB_LOCATION@
  EDUSCOPE_PM_CAPTURE_CARD_HUB_PORT=@CAPTURE_HUB_PORT@
  EDUSCOPE_PM_LED_PRESENT=@LED_PRESENT@
  EDUSCOPE_PM_MIC_ALSA_CARD=@MIC_CARD_ID@
  EDUSCOPE_PM_MIC_ALSA_CONTROL=@MIC_CONTROL@
  EDUSCOPE_PM_HDMI2_ALSA_DEVICE=eduscope_meeting_hdmi
  ```

  `env/stt.env`:

  ```text
  EDUSCOPE_STT_BIND_HOST=127.0.0.1
  EDUSCOPE_STT_PORT=7101
  EDUSCOPE_STT_INTERNAL_BEARER=@INTERNAL_BEARER@
  EDUSCOPE_STT_AUDIO_SOCKET=/tmp/audio.sock
  EDUSCOPE_STT_MODEL_PATH=/opt/eduscope/models/vosk-model-en-us-0.22
  EDUSCOPE_STT_MODEL_VERSION=vosk-model-en-us-0.22
  ```

  `env/slide.env`:

  ```text
  EDUSCOPE_SLIDE_BIND_HOST=127.0.0.1
  EDUSCOPE_SLIDE_PORT=7102
  EDUSCOPE_SLIDE_INTERNAL_BEARER=@INTERNAL_BEARER@
  EDUSCOPE_SLIDE_RUNTIME_ROOT=/run/eduscope
  EDUSCOPE_SLIDE_RECORDINGS_ROOT=/media/eduscope
  ```

  `env/question.env`:

  ```text
  EDUSCOPE_QUESTION_BIND_HOST=127.0.0.1
  EDUSCOPE_QUESTION_PORT=7103
  EDUSCOPE_QUESTION_INTERNAL_BEARER=@INTERNAL_BEARER@
  EDUSCOPE_QUESTION_GENERATION_DEADLINE_SECONDS=40
  ```

  Render `device-bootstrap.json` with exactly:

  ```json
  {
    "version": 1,
    "wiredInterface": "enP4p65s0",
    "inputs": {
      "presentation": {"kind":"v4l2","address":"/dev/eduscope/pc-capture"},
      "lecturer-cam": {"kind":"rtsp","address":"rtsp://10.20.30.41/stream1"},
      "students-cam": {"kind":"rtsp","address":"rtsp://10.20.30.42/stream1"},
      "mic-lecturer": {"kind":"alsa","address":"eduscope_mic"}
    },
    "bootstrapAdmin": {"username":"device-admin","displayName":"Device Administrator","passwordFile":"/etc/eduscope/bootstrap-admin.password"}
  }
  ```

  Values shown are example data; the deployable renderer takes the interface and local hardware values from F-01 and the two RTSP addresses/admin identity from protected provisioning input. It never accepts credentials in `device-bootstrap.json`.

- [ ] **Step 5: Make B consume bootstrap only on first seed and push bindings at startup**

  Add `CORE_API_DEVICE_BOOTSTRAP_PATH` (default `/etc/eduscope/device-bootstrap.json`) and `CORE_API_BOOTSTRAP_ADMIN_PASSWORD_FILE` (default `/etc/eduscope/bootstrap-admin.password`). `loadDeviceBootstrap()` validates the exact shape above. Extend `seed()` so skeleton addresses and wired interface come from this object only when the natural-key row does not exist. After seed, if `users` is empty, read the password with `O_NOFOLLOW`, require root ownership/mode <=0640 and >=12 characters, hash through existing `hashPassword`, insert one local admin with `mustResetPassword:true`, then discard the plaintext. If any user exists, do not read the file.

  Add a lifecycle component that, after DB/source/secret-store creation and before the server listens, reads enabled source bindings, resolves any stored credentials, and calls `setPublisherBinding()` once per `presentation|lecturer-cam|students-cam|mic-lecturer`. A restart pushes current database values, never the original bootstrap values.

- [ ] **Step 6: Run focused, contract, and leak tests**

  Run:

  ```bash
  python3 -m unittest deploy.tests.test_runtime_render deploy.tests.test_sysusers_tmpfiles -v
  pnpm --filter @eduscope/core-api test -- test/db/device-bootstrap.test.ts test/unit/config.test.ts test/settings/sources.test.ts test/auth/auth.test.ts
  render_check_dir="$(mktemp -d)"
  python3 deploy/runtime/render.py --manifest /etc/eduscope-private/device-manifest.json --provisioning /etc/eduscope-private/provisioning.json --secrets /etc/eduscope-private/secrets.json --output-root "$render_check_dir" --profile production
  ! rg -n 'quizDeviceCredential|JWT_SECRET|SECRETBOX_KEY|INTERNAL_BEARER|bootstrap-admin' "$render_check_dir/config.json" apps/panel/dist/config.json
  rm -r -- "$render_check_dir"
  ```

  Expected: tests pass; final scan prints no secret-bearing field/value.

- [ ] **Step 7: Run contract regression and commit**

  ```bash
  git diff --check
  git add deploy/sysusers deploy/tmpfiles deploy/provisioning deploy/runtime deploy/tests services/core-api/src/config.ts services/core-api/src/db services/core-api/src/app.ts services/core-api/test/db/device-bootstrap.test.ts
  git commit -m "feat(deploy): render device identity and service secrets"
  ```

---

### Task F-04: Render stable udev and ALSA configuration

**Files:**
- Create: `deploy/udev/{99-eduscope-capture.rules,99-eduscope-storage.rules,99-eduscope-touch.rules}`
- Create: `deploy/alsa/{90-eduscope.conf,eduscope-audio.env}`
- Create: `deploy/runtime/render-hardware.py`
- Create: `deploy/tests/{test_udev_rules.py,test_alsa_config.py}`

**Interfaces:**
- Consumes: F-01 capture/touch/storage/ALSA facts.
- Produces: rendered files under `/etc/udev/rules.d`, `/etc/alsa/conf.d`, and `/run/eduscope/env/audio.env`; `/dev/eduscope/pc-capture`; named PCMs `eduscope_mic` and `eduscope_meeting_hdmi`.

- [ ] **Step 1: Write failing fixture-to-output tests**

  Test exact VID/PID/serial-or-port/index matching, one capture alias, no broad `MODE=0666`, storage notification without `RUN+=` mount/format, touch ownership limited to the selected device, ALSA named-card syntax, `S16LE/48000/2`, rejection of numeric card IDs and unresolved tokens.

- [ ] **Step 2: Run and verify red**

  Run: `python3 -m unittest deploy.tests.test_udev_rules deploy.tests.test_alsa_config -v`

  Expected: FAIL because renderer/templates are absent.

- [ ] **Step 3: Add the exact render templates**

  Capture rule shape:

  ```udev
  SUBSYSTEM=="video4linux", ATTR{index}=="@CAPTURE_V4L_INDEX@", ATTRS{idVendor}=="@CAPTURE_VID@", ATTRS{idProduct}=="@CAPTURE_PID@", @CAPTURE_STABLE_MATCH@, GROUP="video", MODE="0660", SYMLINK+="eduscope/pc-capture"
  ```

  `@CAPTURE_STABLE_MATCH@` renders to exactly one of `ATTRS{serial}=="..."` or `KERNELS=="<usbPortPath>*"`; missing both is a hard failure. Storage rules tag partitions but execute nothing:

  ```udev
  SUBSYSTEM=="block", ENV{DEVTYPE}=="partition", ENV{ID_FS_UUID}!="", ENV{ID_BUS}=="usb", ENV{EDUSCOPE_STORAGE_CANDIDATE}="1", TAG+="systemd"
  ```

  Touch rule assigns only the frozen input node:

  ```udev
  SUBSYSTEM=="input", KERNEL=="event*", ATTRS{id/vendor}=="@TOUCH_VID@", ATTRS{id/product}=="@TOUCH_PID@", @TOUCH_STABLE_MATCH@, OWNER="eduscope-kiosk", MODE="0600", ENV{ID_SEAT}="seat0", TAG+="seat"
  ```

  ALSA configuration:

  ```text
  pcm.eduscope_mic {
    type plug
    slave.pcm "hw:CARD=@MIC_CARD_ID@,DEV=@MIC_PCM_DEVICE@"
    slave.format S16_LE
    slave.rate 48000
    slave.channels 2
    hint { show on; description "Eduscope room microphone"; }
  }
  ctl.eduscope_mic { type hw; card "@MIC_CARD_ID@"; }
  pcm.eduscope_meeting_hdmi {
    type plug
    slave.pcm "hw:CARD=@HDMI2_CARD_ID@,DEV=@HDMI2_PCM_DEVICE@"
    slave.format S16_LE
    slave.rate 48000
    slave.channels 2
    hint { show on; description "Eduscope meeting HDMI"; }
  }
  ctl.eduscope_meeting_hdmi { type hw; card "@HDMI2_CARD_ID@"; }
  ```

  `eduscope-audio.env`:

  ```text
  EDUSCOPE_PM_MIC_ALSA_CARD=@MIC_CARD_ID@
  EDUSCOPE_PM_MIC_ALSA_CONTROL=@MIC_CONTROL@
  EDUSCOPE_PM_HDMI2_ALSA_DEVICE=eduscope_meeting_hdmi
  EDUSCOPE_STT_AUDIO_SOCKET=/tmp/audio.sock
  EDUSCOPE_AUDIO_FORMAT=S16LE
  EDUSCOPE_AUDIO_RATE_HZ=48000
  EDUSCOPE_AUDIO_CHANNELS=2
  ```

  `render-hardware.py` supports `--profile production|demo-staging` (default `production`), install-time `--output-root <staging-root>` for the udev/ALSA files, and runtime `--runtime-only --output-root /run/eduscope` for only `env/audio.env`; runtime mode never writes `/etc`. Demo/staging may defer only display/passthrough and recordings-volume fields and must print the applicable open-acceptance notices; capture, touch, microphone, and HDMI-audio identities remain required.

- [ ] **Step 4: Render and run syntax/fixture checks**

  Run:

  ```bash
  python3 deploy/runtime/render-hardware.py --profile production --manifest /etc/eduscope-private/device-manifest.json --output-root /tmp/eduscope-hardware-render
  udevadm verify /tmp/eduscope-hardware-render/etc/udev/rules.d/*.rules
  ALSA_CONFIG_PATH=/tmp/eduscope-hardware-render/etc/alsa/conf.d/90-eduscope.conf arecord -L | rg '^eduscope_mic$'
  ALSA_CONFIG_PATH=/tmp/eduscope-hardware-render/etc/alsa/conf.d/90-eduscope.conf aplay -L | rg '^eduscope_meeting_hdmi$'
  ```

  Expected: rule verification exits 0 and each named PCM appears exactly once.

  On the current single-rootfs demo target, substitute `--profile demo-staging`. This verifies syntax only and does not close the physical witness below.

- [ ] **Step 5: Perform the on-device stability witness**

  Across three cold boots and one replug per boot run:

  ```bash
  readlink -f /dev/eduscope/pc-capture
  arecord -D eduscope_mic -f S16_LE -r 48000 -c 2 -d 60 /tmp/eduscope-mic.wav
  aplay -D eduscope_meeting_hdmi /tmp/eduscope-mic.wav
  udevadm info --query=property --name /dev/eduscope/pc-capture
  ```

  Expected: symlink resolves to the same physical tuple each boot, WAV is 60 seconds/stereo/48 kHz, HDMI #2 is audible, and no command contains `hw:<number>`.

- [ ] **Step 6: Run contract regression and commit**

  ```bash
  git diff --check
  git add deploy/udev deploy/alsa deploy/runtime/render-hardware.py deploy/tests/test_udev_rules.py deploy/tests/test_alsa_config.py
  git commit -m "feat(device): stabilize udev and ALSA identities"
  ```

---

### Task F-05: Add ordered, hardened systemd units

**Files:**
- Create: `deploy/systemd/media-eduscope.mount.template`
- Create: `deploy/systemd/eduscope-helper.{socket,service}`
- Create: `deploy/systemd/eduscope-runtime-config.service`
- Create: `deploy/systemd/eduscope-{pipeline-manager,core-api,stt,slide,question,kiosk}.service`
- Create: `deploy/systemd/{nginx,stunnel4}.service.d/eduscope.conf`
- Create: `deploy/systemd/wait-http.py`
- Create: `deploy/tests/{test_systemd_units.py,verify-systemd.sh}`
- Create: `docs/evidence/phase-4/workstream-f/f05/README.md`

**Interfaces:**
- Consumes: F-02 helper entrypoint, F-03 runtime env, F-04 device rules, expected UUID, installed A–E artifacts.
- Produces: acyclic boot graph with intentional restart/degradation boundaries and only the required writable/device sets.

- [ ] **Step 1: Write failing unit inventory, dependency, and hardening tests**

  Parse units and assert every inventory name exists; only helper/runtime render run as root; helper socket is `0660 root:eduscope`; mount precedes runtime/A/B/C; core requires runtime and starts after A; AI starts after A but is not required by A/B/kiosk; kiosk waits for core health; `Restart=on-failure`; no unit invokes a shell or sudo; pipeline/STT have `PrivateTmp=false`; core/AI/kiosk use `ProtectSystem=strict`, `NoNewPrivileges=true`, `ProtectHome`, and explicit writable paths; the three AI limits match the master/design resource policy.

- [ ] **Step 2: Run and verify red**

  Run: `python3 -m unittest deploy.tests.test_systemd_units -v`

  Expected: FAIL because units are absent.

- [ ] **Step 3: Write the mount, helper, and runtime units completely**

  `media-eduscope.mount.template`:

  ```ini
  [Unit]
  Description=Eduscope recordings volume
  Before=eduscope-runtime-config.service eduscope-pipeline-manager.service eduscope-core-api.service

  [Mount]
  What=/dev/disk/by-uuid/@RECORDINGS_UUID@
  Where=/media/eduscope
  Type=ext4
  Options=noatime,nodev,nosuid
  TimeoutSec=30

  [Install]
  WantedBy=multi-user.target
  ```

  `eduscope-helper.socket` uses `ListenStream=/run/eduscope/helper.sock`, `SocketUser=root`, `SocketGroup=eduscope`, `SocketMode=0660`, `RemoveOnStop=true`, `DirectoryMode=0750`, and `WantedBy=sockets.target`. `eduscope-helper.service` is root, `StandardInput=socket`, `ExecStart=/opt/eduscope/current/venvs/helper/bin/eduscope-privileged-helper`, `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=strict`, `ReadWritePaths=/etc/systemd/network /media/eduscope /run/eduscope/helper /run/eduscope/relay /sys/class/leds`, `PrivateDevices=false`, `ProtectKernelModules=true`, `ProtectKernelTunables=true`, `ProtectControlGroups=true`, `RestrictAddressFamilies=AF_UNIX AF_NETLINK`, and has no ambient capability beyond what tests prove is required.

  `eduscope-runtime-config.service` is root `Type=oneshot`, `RemainAfterExit=yes`, `Requires=media-eduscope.mount`, `After=local-fs.target media-eduscope.mount`, runs `systemd-tmpfiles --create /etc/tmpfiles.d/eduscope.conf`, then `render.py` and `render-hardware.py`, then sets `/media/eduscope` to `root:eduscope-media 2770`. It writes only `/run/eduscope` and the deploy-owned rendered `/etc` files.

- [ ] **Step 4: Write A/B/C units with exact entrypoints and isolation**

  Use these `ExecStart` values:

  ```text
  pipeline: /opt/eduscope/current/venvs/pipeline/bin/uvicorn pipeline_manager.app:create_production_app --factory --host 127.0.0.1 --port 8091
  core:     /usr/bin/node /opt/eduscope/current/services/core-api/dist/src/server.js
  stt:      /opt/eduscope/current/venvs/ai/bin/eduscope-stt-service
  slide:    /opt/eduscope/current/venvs/ai/bin/eduscope-slide-service
  question: /opt/eduscope/current/venvs/ai/bin/eduscope-question-service
  ```

  Pipeline and STT use `PrivateTmp=false`; pipeline has video/audio/render access, `ReadWritePaths=/tmp /run/eduscope/pipeline-manager /media/eduscope`, and no `PrivateDevices`. Core uses `ReadWritePaths=/var/lib/eduscope /run/eduscope/relay /media/eduscope`, loopback networking, and `UMask=0007`. STT uses `CPUAffinity=4 5 6 7`, `MemoryMax=8G`, `Nice=5`; slide uses `CPUAffinity=0 1 2 3`, `MemoryMax=1G`; question uses `MemoryMax=1G`. All three AI units are `Wants`, never `Requires`, from the device target. Every service reads only its own `/run/eduscope/env/*.env` plus the shared audio env where applicable.

- [ ] **Step 5: Add bounded health waits and relay drop-ins**

  `wait-http.py URL SECONDS` performs loopback GET every 0.5 seconds, exits 0 only on 2xx, and prints `PASS health <url>`; it logs no header/body. Kiosk waits for core at `http://127.0.0.1:5000/healthz`; core starts after/wants A but does not wait for A health, so it can expose A as unavailable. Nginx/stunnel drop-ins require runtime config/network and use graceful reloads; neither is required by recording-only A/B.

  Use these complete unit bodies; the installer substitutes only the declared `@...@` tokens and rejects any remaining token. Core deliberately does not require A's health: it starts after/wants A and reports it unavailable if A is down.

  `eduscope-helper.socket`:

  ```ini
  [Unit]
  Description=Eduscope privileged helper socket

  [Socket]
  ListenStream=/run/eduscope/helper.sock
  SocketUser=root
  SocketGroup=eduscope
  SocketMode=0660
  DirectoryMode=0750
  RemoveOnStop=true

  [Install]
  WantedBy=sockets.target
  ```

  `eduscope-helper.service`:

  ```ini
  [Unit]
  Description=Eduscope privileged helper
  Requires=eduscope-helper.socket
  After=local-fs.target

  [Service]
  Type=simple
  User=root
  Group=root
  ExecStart=/opt/eduscope/current/venvs/helper/bin/eduscope-privileged-helper
  NoNewPrivileges=true
  PrivateTmp=true
  PrivateDevices=false
  ProtectSystem=strict
  ProtectHome=true
  ProtectKernelModules=true
  ProtectKernelTunables=true
  ProtectControlGroups=true
  RestrictAddressFamilies=AF_UNIX AF_NETLINK AF_INET AF_INET6
  ReadOnlyPaths=/etc/eduscope
  ReadWritePaths=/etc/systemd/network /media/eduscope /run/eduscope/helper /run/eduscope/relay /sys/class/leds
  UMask=0077
  TimeoutStopSec=10
  ```

  `eduscope-runtime-config.service`:

  ```ini
  [Unit]
  Description=Render Eduscope runtime configuration
  Requires=media-eduscope.mount
  After=local-fs.target media-eduscope.mount
  Before=eduscope-pipeline-manager.service eduscope-core-api.service eduscope-stt.service eduscope-slide.service eduscope-question.service nginx.service stunnel4.service

  [Service]
  Type=oneshot
  User=root
  Group=root
  RemainAfterExit=yes
  ExecStart=/usr/bin/systemd-tmpfiles --create /etc/tmpfiles.d/eduscope.conf
  Environment=EDUSCOPE_DEPLOYMENT_PROFILE=production
  ExecStart=/opt/eduscope/current/deploy/runtime/render.py --manifest /etc/eduscope/device-manifest.json --secrets /etc/eduscope/secrets.json --output-root /run/eduscope --profile ${EDUSCOPE_DEPLOYMENT_PROFILE}
  ExecStart=/opt/eduscope/current/deploy/runtime/render-hardware.py --manifest /etc/eduscope/device-manifest.json --runtime-only --output-root /run/eduscope --profile ${EDUSCOPE_DEPLOYMENT_PROFILE}
  NoNewPrivileges=true
  PrivateTmp=true
  ProtectSystem=strict
  ProtectHome=true
  ReadOnlyPaths=/etc/eduscope
  ReadWritePaths=/run/eduscope /media/eduscope
  UMask=0077

  [Install]
  WantedBy=multi-user.target
  ```

  `eduscope-pipeline-manager.service`:

  ```ini
  [Unit]
  Description=Eduscope pipeline manager
  Requires=media-eduscope.mount eduscope-runtime-config.service eduscope-helper.socket
  Wants=network-online.target
  After=media-eduscope.mount eduscope-runtime-config.service eduscope-helper.socket network-online.target graphical.target

  [Service]
  Type=simple
  User=eduscope-pipeline
  Group=eduscope-pipeline
  SupplementaryGroups=eduscope eduscope-media video audio render
  EnvironmentFile=/run/eduscope/env/pipeline.env
  EnvironmentFile=/run/eduscope/env/audio.env
  WorkingDirectory=/opt/eduscope/current/services/pipeline-manager
  ExecStart=/opt/eduscope/current/venvs/pipeline/bin/uvicorn pipeline_manager.app:create_production_app --factory --host 127.0.0.1 --port 8091
  Restart=on-failure
  RestartSec=2
  TimeoutStopSec=30
  KillMode=mixed
  NoNewPrivileges=true
  PrivateTmp=false
  PrivateDevices=false
  ProtectSystem=strict
  ProtectHome=true
  ProtectKernelModules=true
  ProtectKernelTunables=true
  ProtectControlGroups=true
  RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
  DevicePolicy=closed
  DeviceAllow=/dev/eduscope/pc-capture rw
  DeviceAllow=/dev/snd rw
  DeviceAllow=/dev/dri rw
  DeviceAllow=@TOUCH_DEVNODE@ r
  ReadWritePaths=/tmp /run/eduscope/pipeline-manager /media/eduscope /var/lib/eduscope/pipeline-manager
  UMask=0007

  [Install]
  WantedBy=multi-user.target
  ```

  `eduscope-core-api.service`:

  ```ini
  [Unit]
  Description=Eduscope core API
  Requires=media-eduscope.mount eduscope-runtime-config.service eduscope-helper.socket
  Wants=network-online.target eduscope-pipeline-manager.service
  After=media-eduscope.mount eduscope-runtime-config.service eduscope-helper.socket network-online.target eduscope-pipeline-manager.service

  [Service]
  Type=simple
  User=eduscope-core
  Group=eduscope-core
  SupplementaryGroups=eduscope eduscope-media
  EnvironmentFile=/run/eduscope/env/core.env
  WorkingDirectory=/opt/eduscope/current/services/core-api
  ExecStart=/usr/bin/node /opt/eduscope/current/services/core-api/dist/src/server.js
  Restart=on-failure
  RestartSec=2
  TimeoutStopSec=30
  NoNewPrivileges=true
  PrivateTmp=true
  PrivateDevices=true
  ProtectSystem=strict
  ProtectHome=true
  ProtectKernelModules=true
  ProtectKernelTunables=true
  ProtectControlGroups=true
  RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
  ReadWritePaths=/var/lib/eduscope /run/eduscope/relay /media/eduscope
  UMask=0007

  [Install]
  WantedBy=multi-user.target
  ```

  `eduscope-stt.service`:

  ```ini
  [Unit]
  Description=Eduscope speech-to-text service
  Requires=eduscope-runtime-config.service
  Wants=eduscope-pipeline-manager.service
  After=eduscope-runtime-config.service eduscope-pipeline-manager.service

  [Service]
  Type=simple
  User=eduscope-ai
  Group=eduscope-ai
  SupplementaryGroups=eduscope-media audio
  EnvironmentFile=/run/eduscope/env/stt.env
  EnvironmentFile=/run/eduscope/env/audio.env
  WorkingDirectory=/opt/eduscope/current/services/ai
  ExecStart=/opt/eduscope/current/venvs/ai/bin/eduscope-stt-service
  Restart=on-failure
  RestartSec=3
  NoNewPrivileges=true
  PrivateTmp=false
  PrivateDevices=false
  ProtectSystem=strict
  ProtectHome=true
  RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
  ReadWritePaths=/tmp /var/lib/eduscope/ai
  CPUAffinity=4 5 6 7
  MemoryMax=8G
  Nice=5

  [Install]
  WantedBy=multi-user.target
  ```

  `eduscope-slide.service`:

  ```ini
  [Unit]
  Description=Eduscope slide OCR service
  Requires=eduscope-runtime-config.service
  Wants=eduscope-pipeline-manager.service
  After=eduscope-runtime-config.service eduscope-pipeline-manager.service

  [Service]
  Type=simple
  User=eduscope-ai
  Group=eduscope-ai
  SupplementaryGroups=eduscope-media
  EnvironmentFile=/run/eduscope/env/slide.env
  WorkingDirectory=/opt/eduscope/current/services/ai
  ExecStart=/opt/eduscope/current/venvs/ai/bin/eduscope-slide-service
  Restart=on-failure
  RestartSec=3
  NoNewPrivileges=true
  PrivateTmp=true
  PrivateDevices=true
  ProtectSystem=strict
  ProtectHome=true
  RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
  ReadWritePaths=/var/lib/eduscope/ai /media/eduscope
  CPUAffinity=0 1 2 3
  MemoryMax=1G

  [Install]
  WantedBy=multi-user.target
  ```

  `eduscope-question.service`:

  ```ini
  [Unit]
  Description=Eduscope question generation service
  Requires=eduscope-runtime-config.service
  Wants=network-online.target
  After=eduscope-runtime-config.service network-online.target

  [Service]
  Type=simple
  User=eduscope-ai
  Group=eduscope-ai
  EnvironmentFile=/run/eduscope/env/question.env
  WorkingDirectory=/opt/eduscope/current/services/ai
  ExecStart=/opt/eduscope/current/venvs/ai/bin/eduscope-question-service
  Restart=on-failure
  RestartSec=3
  NoNewPrivileges=true
  PrivateTmp=true
  PrivateDevices=true
  ProtectSystem=strict
  ProtectHome=true
  RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
  ReadWritePaths=/var/lib/eduscope/ai
  MemoryMax=1G

  [Install]
  WantedBy=multi-user.target
  ```

  `eduscope-kiosk.service`:

  ```ini
  [Unit]
  Description=Eduscope Chromium kiosk
  Requires=eduscope-runtime-config.service
  Wants=network-online.target nginx.service eduscope-core-api.service
  After=display-manager.service graphical.target network-online.target nginx.service eduscope-core-api.service

  [Service]
  Type=simple
  User=eduscope-kiosk
  Group=eduscope-kiosk
  SupplementaryGroups=video render
  Environment=DISPLAY=:0
  Environment=EDUSCOPE_DEPLOYMENT_PROFILE=production
  ExecStartPre=/opt/eduscope/current/deploy/systemd/wait-http.py http://127.0.0.1:5000/healthz 60
  ExecStart=/opt/eduscope/current/deploy/kiosk/launcher.sh
  Restart=on-failure
  RestartSec=2
  NoNewPrivileges=true
  PrivateTmp=true
  PrivateDevices=false
  ProtectSystem=strict
  ProtectHome=read-only
  RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
  ReadWritePaths=/var/lib/eduscope/kiosk /run/user/@KIOSK_UID@
  DevicePolicy=closed
  DeviceAllow=/dev/dri rw

  [Install]
  WantedBy=graphical.target
  ```

  `nginx.service.d/eduscope.conf`:

  ```ini
  [Unit]
  Requires=eduscope-runtime-config.service
  Wants=eduscope-core-api.service network-online.target
  After=eduscope-runtime-config.service eduscope-core-api.service network-online.target

  [Service]
  ExecStartPre=/usr/sbin/nginx -t -q
  ExecReload=
  ExecReload=/usr/sbin/nginx -s reload
  ```

  `eduscope-stunnel.service` is a dedicated foreground service and does not
  modify or depend on the distribution's administrator-owned `stunnel4.service`.
  It is started by relay promotion only when at least one RTMPS target exists:

  ```ini
  [Service]
  Type=simple
  User=eduscope-core
  Group=eduscope
  ExecStartPre=/usr/libexec/eduscope-stunnel-validate /run/eduscope/relay/stunnel.conf
  ExecStart=/usr/bin/stunnel4 /run/eduscope/relay/stunnel.conf
  ```

  `wait-http.py` is complete:

  ```python
  #!/usr/bin/python3
  import sys
  import time
  import urllib.request

  if len(sys.argv) != 3:
      raise SystemExit("usage: wait-http.py URL SECONDS")
  url, seconds = sys.argv[1], float(sys.argv[2])
  if not url.startswith(("http://127.0.0.1:", "http://[::1]:")):
      raise SystemExit("loopback URL required")
  deadline = time.monotonic() + seconds
  while time.monotonic() < deadline:
      try:
          with urllib.request.urlopen(url, timeout=1) as response:
              if 200 <= response.status < 300:
                  print(f"PASS health {url}")
                  raise SystemExit(0)
      except Exception:
          pass
      time.sleep(0.5)
  raise SystemExit(f"health timeout: {url}")
  ```

- [ ] **Step 6: Verify unit syntax, cycles, and properties**

  `verify-systemd.sh DIR` renders the mount/UID/touch tokens into a temporary root, creates executable stubs at every exact `Exec*` path, invokes `systemd-analyze verify --root=<temp-root>`, checks the dependency graph/property matrix, and deletes only that validated temporary root.

  Run:

  ```bash
  bash deploy/tests/verify-systemd.sh deploy/systemd
  python3 -m unittest deploy.tests.test_systemd_units -v
  ```

  Expected: `PASS systemd unit graph`; `systemd-analyze verify` exits 0 with no cycle, unknown directive, or executable-path error.

- [ ] **Step 7: Defer live ordering, restart, and degradation verification until F-08**

  This live witness is executed by F-08 Step 7, after that task installs the A–E
  artifacts and rendered units at their exact target paths. F-05 closes on the
  static syntax, dependency-graph, hardening, and contract checks in Steps 6
  and 8. Do not simulate the live witness or create a dated evidence directory
  during F-05.

  With A–E artifacts installed at the exact `/opt/eduscope/current` paths and rendered units copied to `/etc/systemd/system`, run:

  ```bash
  EVIDENCE_DIR="docs/evidence/phase-4/workstream-f/f05/$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$EVIDENCE_DIR"
  sudo systemctl daemon-reload
  sudo systemctl start media-eduscope.mount eduscope-helper.socket eduscope-runtime-config.service eduscope-pipeline-manager.service eduscope-core-api.service eduscope-stt.service eduscope-slide.service eduscope-question.service nginx.service stunnel4.service eduscope-kiosk.service
  sudo bash deploy/tests/verify-systemd.sh --live
  systemd-analyze security eduscope-helper.service eduscope-pipeline-manager.service eduscope-core-api.service eduscope-stt.service eduscope-slide.service eduscope-question.service eduscope-kiosk.service > "$EVIDENCE_DIR/systemd-security.txt"
  ```

  `--live` records activation timestamps, kills each main PID separately, and applies this exact matrix: the killed unit restarts once; killing A leaves B/kiosk active and B reports A unavailable until recovery; killing B leaves A/AI active and kiosk reconnects after B returns; killing any AI service leaves A/B/kiosk active; killing kiosk leaves every backend active; helper restarts on the next socket call. It also proves the mounted source resolves to F-01's expected UUID and no other removable disk mounted automatically.

  Expected during F-08 Step 7: `PASS systemd live restart matrix`; the security report is captured without claiming an arbitrary score as a pass/fail threshold.

- [ ] **Step 8: Run contract regression and commit**

  ```bash
  git diff --check
  git add deploy/systemd deploy/tests/test_systemd_units.py deploy/tests/verify-systemd.sh docs/evidence/phase-4/workstream-f/f05
  git commit -m "feat(device): order and harden system services"
  ```

---

### Task F-06: Add the single-origin proxy and atomic RTMP/RTMPS relay

**Files:**
- Create: `deploy/nginx/{eduscope.conf,rtmp.conf.template}`
- Create: `deploy/stunnel/eduscope.conf.template`
- Create: `deploy/relay/reload.py`
- Create: `deploy/tests/{test_proxy_config.py,test_relay_reload.py,single-origin-smoke.mjs}`
- Modify: `services/core-api/src/modules/relay/config.ts`
- Modify: `services/core-api/src/app.ts`
- Modify: `services/core-api/test/settings/stream-targets.test.ts`
- Modify: `services/core-api/test/channels/runtime.test.ts`
- Modify: `services/privileged-helper/src/eduscope_privileged_helper/verbs.py`

**Interfaces:**
- Consumes: enabled streaming target order, secret-store keys, fixed candidate `/run/eduscope/relay/candidate.json`, helper `relay.reload {configDigest}`.
- Produces: public device origin `http://127.0.0.1`; local ingest `rtmp://127.0.0.1:1935/live/streaming`; same-origin REST/two WS/Range; graceful target reload.

- [ ] **Step 1: Write failing candidate, proxy, and reload tests**

  Assert candidate mode 0600/owner core, digest over exact bytes, stream keys absent from DB/log/helper request, helper rejection of missing/symlink/mismatched candidate, deterministic direct-RTMP vs stunnel routes, `nginx -t`, stunnel validation, atomic promotion, prior-active preservation on validation/reload failure, no active-record consumer signal, and same-origin HTTP/WS/Range paths.

- [ ] **Step 2: Run and verify red**

  Run:

  ```bash
  pnpm --filter @eduscope/core-api test -- test/settings/stream-targets.test.ts test/channels/runtime.test.ts
  python3 -m unittest deploy.tests.test_proxy_config deploy.tests.test_relay_reload -v
  ```

  Expected: FAIL because B writes no candidate and proxy/relay files do not exist.

- [ ] **Step 3: Make B atomically stage the complete candidate before helper reload**

  Extend `RelayConfigActivator` with `secrets: SecretStore` and `candidatePath:'/run/eduscope/relay/candidate.json'`. Resolve each enabled target key, fail activation if missing, serialize version 1 with ordered `{id,platform,ingestUrl,streamKey,requiresTlsBridge}` objects, write a same-directory 0600 temp with `O_NOFOLLOW`, fsync, rename, fsync directory, hash the exact final bytes with SHA-256, then call `relay.reload` with that digest. Update `#lastDigest` only after helper success. On deactivate, stage an empty target list. Move composition until after `SecretStore.create()` in `app.ts`.

- [ ] **Step 4: Add complete Nginx single-origin and RTMP config**

  The HTTP server listens only on `127.0.0.1:80`, serves `/opt/eduscope/current/apps/panel/dist`, uses `/run/eduscope/config.json` for exact `/config.json`, falls back to `/index.html`, disables directory listing, and sets `Cache-Control: no-store` on config/index. Proxy `/api/v1/` and `/healthz` to `127.0.0.1:5000`; preserve `Upgrade`, `Connection`, `Host`, `X-Forwarded-*`; set `proxy_buffering off` for WS; leave Range headers intact and `proxy_force_ranges on` for media.

  RTMP template:

  ```nginx
  rtmp {
    server {
      listen 127.0.0.1:1935;
      chunk_size 4096;
      application live {
        live on;
        record off;
        deny play all;
        include /run/eduscope/relay/nginx-push.conf;
      }
    }
  }
  ```

  `eduscope.conf` is complete:

  ```nginx
  map $http_upgrade $eduscope_connection_upgrade {
    default upgrade;
    ''      close;
  }

  server {
    listen 127.0.0.1:80 default_server;
    server_name _;
    root /opt/eduscope/current/apps/panel/dist;
    index index.html;
    autoindex off;

    location = /config.json {
      alias /run/eduscope/config.json;
      default_type application/json;
      add_header Cache-Control "no-store" always;
    }

    location = /healthz {
      proxy_pass http://127.0.0.1:5000/healthz;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/v1/ {
      proxy_pass http://127.0.0.1:5000;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $eduscope_connection_upgrade;
      proxy_buffering off;
      proxy_force_ranges on;
    }

    location / {
      try_files $uri $uri/ /index.html;
      add_header Cache-Control "no-store" always;
    }
  }
  ```

  `stunnel/eduscope.conf.template` is complete; F-06 replaces `@SERVICE_SECTIONS@` with zero or more validated `[target-<id>]` sections and refuses a remaining token:

  ```text
  foreground = yes
  pid =
  client = yes
  verifyChain = yes
  CAfile = /etc/ssl/certs/ca-certificates.crt
  socket = l:TCP_NODELAY=1
  socket = r:TCP_NODELAY=1

  @SERVICE_SECTIONS@
  ```

  Each generated service section is exactly:

  ```text
  [target-@SAFE_ID@]
  accept = 127.0.0.1:@LOCAL_PORT@
  connect = @REMOTE_HOST@:@REMOTE_PORT@
  checkHost = @REMOTE_HOST@
  ```

- [ ] **Step 5: Implement fixed relay promotion**

  `/usr/libexec/eduscope-relay-reload <64hex>` reads only the fixed candidate with `O_NOFOLLOW`, requires core UID/mode 0600, hashes bytes, validates JSON/version/unique ids/URL schemes/key characters, renders same-directory temp files, and allocates stunnel ports `19400..19431` by target order. Direct `rtmp://` targets render `push <ingestUrl>/<escapedKey>;`. RTMPS targets render an Nginx push to the local stunnel port plus `client=yes`, `accept=127.0.0.1:<port>`, `connect=<host>:<port>`, `verifyChain=yes`, `checkHost=<host>`, and system CA paths. Reject URL credentials/fragments/query secrets.

  Validate Nginx with `nginx -t`. When RTMPS sections exist, validate the
  temporary stunnel configuration with `eduscope-stunnel-validate`, which runs
  stunnel briefly against loopback ephemeral accept ports because Ubuntu's
  stunnel 5.72 has no `-test` option. Promote atomically, restart the dedicated
  `eduscope-stunnel.service` when RTMPS sections exist (otherwise stop it), then
  reload `nginx.service`. On any failure, restore the prior files and service
  state; print only `ok` or a redacted error. No target URL containing a stream
  key enters stdout/journal.

- [ ] **Step 6: Run syntax, real-adapter, and record-isolation checks**

  Run:

  ```bash
  pnpm --filter @eduscope/core-api test -- test/settings/stream-targets.test.ts test/channels/runtime.test.ts
  python3 -m unittest deploy.tests.test_proxy_config deploy.tests.test_relay_reload -v
  node deploy/tests/single-origin-smoke.mjs
  ```

  `single-origin-smoke.mjs` is self-contained: it starts a temporary loopback
  Core HTTP/WS/Range fixture on an ephemeral port, renders
  `deploy/nginx/eduscope.conf` into a temporary Nginx prefix with another
  ephemeral loopback port plus temporary panel/config files, runs `nginx -t`
  against that complete temporary configuration, starts that Nginx without
  installing or replacing host configuration, performs the REST, both
  WS, and Range probes through the temporary single origin, and always stops
  both child processes and removes the temporary prefix. It must fail if any
  probe reaches the fixture without passing through Nginx. `--origin URL`
  remains available only for the later installed-device smoke in F-08.

  Expected: `PASS relay candidate`, `PASS single-origin REST WS RANGE`, and the temporary `nginx -t` successful; the PM fixture ledger shows zero record stop/restart calls during reload.

- [ ] **Step 7: Run contract regression and commit**

  ```bash
  git diff --check
  git add deploy/nginx deploy/stunnel deploy/relay deploy/tests services/core-api/src/modules/relay/config.ts services/core-api/src/app.ts services/core-api/test/settings/stream-targets.test.ts services/core-api/test/channels/runtime.test.ts services/privileged-helper/src/eduscope_privileged_helper/verbs.py
  git commit -m "feat(device): add single-origin streaming relay"
  ```

---

### Task F-07: Own the X11 kiosk session and deterministic display placement

**Files:**
- Create: `deploy/kiosk/{gdm-custom.conf,eduscope.desktop,session.sh,launcher.sh,xrandr-layout.sh,chromium-flags.conf}`
- Create: `deploy/kiosk/dconf/{profile/user,db/local.d/00-eduscope,db/local.d/locks/eduscope}`
- Create: `deploy/kiosk/policies/managed/eduscope.json`
- Create: `deploy/tests/{test_kiosk_policy.py,test_xrandr_layout.py,fixtures/xrandr-three-displays.txt}`
- Modify: `deploy/systemd/eduscope-kiosk.service`

**Interfaces:**
- Consumes: three F-01 EDID hashes, touch device name, real panel at `http://127.0.0.1/`, GDM X11 session for `eduscope-kiosk`.
- Produces: projector=#1, meeting=#2, panel=#3 at 1280×800; touch mapped only to panel; managed, prompt-free Chromium.

- [ ] **Step 1: Write failing layout/session/policy tests**

  Cover reordered connectors with stable EDIDs, duplicate/missing/extra active EDIDs, safe failure without changing layout, exact modes/positions, touch name match, GDM X11/autologin ownership, required policy keys, prohibited unsafe flags, and launcher cleanup/restart.

- [ ] **Step 2: Run and verify red**

  Run: `python3 -m unittest deploy.tests.test_kiosk_policy deploy.tests.test_xrandr_layout -v`

  Expected: FAIL because kiosk files are absent.

- [ ] **Step 3: Add deploy-owned GDM X11 session configuration**

  `gdm-custom.conf`:

  ```ini
  [daemon]
  WaylandEnable=false
  AutomaticLoginEnable=true
  AutomaticLogin=eduscope-kiosk
  DefaultSession=eduscope.desktop

  [security]
  DisallowTCP=true
  ```

  Installer backs up and replaces only `/etc/gdm3/custom.conf`, disables screen blank/lock for the kiosk account through a root-owned dconf profile, and installs the following locked-account session. `eduscope-kiosk` has no password/authentication credential and no sudo rule; `/bin/bash` exists solely because GDM refuses a `nologin` session owner.

  `eduscope.desktop`:

  ```ini
  [Desktop Entry]
  Name=Eduscope
  Comment=Eduscope managed X11 session
  Exec=/opt/eduscope/current/deploy/kiosk/session.sh
  TryExec=/opt/eduscope/current/deploy/kiosk/session.sh
  Type=Application
  DesktopNames=Eduscope
  ```

  `session.sh`:

  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  /usr/bin/xset s off
  /usr/bin/xset -dpms
  exec /usr/bin/dbus-run-session -- /usr/bin/sleep infinity
  ```

  `dconf/profile/user`:

  ```text
  user-db:user
  system-db:local
  ```

  `dconf/db/local.d/00-eduscope`:

  ```text
  [org/gnome/desktop/session]
  idle-delay=uint32 0

  [org/gnome/desktop/screensaver]
  lock-enabled=false
  lock-delay=uint32 0
  ```

  `dconf/db/local.d/locks/eduscope`:

  ```text
  /org/gnome/desktop/session/idle-delay
  /org/gnome/desktop/screensaver/lock-enabled
  /org/gnome/desktop/screensaver/lock-delay
  ```

  Installer copies these relative paths to `/etc/dconf`, runs `dconf update`, and installs `eduscope.desktop` at `/usr/share/xsessions/eduscope.desktop`.

- [ ] **Step 4: Implement fail-safe EDID placement and touch mapping**

  `xrandr-layout.sh` accepts `--manifest PATH` and optional `--xrandr-fixture PATH`. It parses connected outputs and `/sys/class/drm/*/edid`, requires exactly one match for each frozen hash before running any mutation, then runs one argv-built `xrandr` command:

  ```text
  projector: --mode <manifest mode> --pos 0x0
  meeting:   --mode <manifest mode> --pos <projector-width>x0
  panel:     --mode 1280x800 --pos <projector+meeting-width>x0 --primary
  ```

  Disable only connected outputs not in the manifest after all three matches. Run `xinput map-to-output <exact touch name> <panel connector>`. On topology mismatch print observed connector/hash pairs, exit 78, and execute zero `xrandr --output`/`xinput` calls.

  For the approved demo/staging exception, `--profile demo-staging` requires exactly two connected outputs named `HDMI-1` and `DP-2`, configures `HDMI-1` as `1280x800` at `0x0` and primary, places `DP-2` at its preferred mode at `1280x0`, maps the exact manifest touch name to `HDMI-1`, and prints `multi-display acceptance open`. Any other active topology fails before mutation. This is demo smoke only and does not close the production witness.

- [ ] **Step 5: Add managed policy, flags, launcher, and unit**

  `policies/managed/eduscope.json` is complete:

  ```json
  {
    "PasswordManagerEnabled": false,
    "BrowserSignin": 0,
    "RestoreOnStartup": 4,
    "RestoreOnStartupURLs": ["http://127.0.0.1/"],
    "ExtensionInstallBlocklist": ["*"],
    "PrintingEnabled": false,
    "DownloadRestrictions": 3,
    "DeveloperToolsAvailability": 2,
    "DefaultPopupsSetting": 2,
    "HomepageLocation": "http://127.0.0.1/",
    "URLAllowlist": ["http://127.0.0.1/*"],
    "URLBlocklist": ["*"]
  }
  ```

  `chromium-flags.conf` is complete:

  ```text
  --kiosk
  --no-first-run
  --no-default-browser-check
  --disable-session-crashed-bubble
  --disable-component-update
  --overscroll-history-navigation=0
  --touch-events=enabled
  http://127.0.0.1/
  ```

  Do not force hardware acceleration; F-14 may record the default compositor behavior but does not silently add a flag.

  `launcher.sh` resolves the kiosk UID, tries only `/run/user/<uid>/gdm/Xauthority` then `/var/lib/eduscope/kiosk/.Xauthority`, waits at most 60 seconds for `xdpyinfo -display :0`, executes layout, reads nonblank/noncomment flags into an array, and `exec`s `/snap/bin/chromium` when present else `/usr/bin/chromium`. The unit runs as `eduscope-kiosk`, after GDM/Nginx/core health, restarts on failure, and has no device access beyond display/render and the exact touch udev ownership.

  `launcher.sh` is complete:

  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  IFS=$'\n\t'

  readonly kiosk_uid="$(id -u)"
  readonly manifest=/etc/eduscope/device-manifest.json
  readonly flags_file=/opt/eduscope/current/deploy/kiosk/chromium-flags.conf
  readonly gdm_auth="/run/user/${kiosk_uid}/gdm/Xauthority"
  readonly home_auth=/var/lib/eduscope/kiosk/.Xauthority
  export DISPLAY=:0

  if [[ -r "$gdm_auth" ]]; then
    export XAUTHORITY="$gdm_auth"
  elif [[ -r "$home_auth" ]]; then
    export XAUTHORITY="$home_auth"
  else
    printf 'Xauthority unavailable\n' >&2
    exit 78
  fi

  for ((attempt=0; attempt<120; attempt++)); do
    if /usr/bin/xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
      break
    fi
    /usr/bin/sleep 0.5
  done
  /usr/bin/xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 || {
    printf 'X11 display unavailable after 60 seconds\n' >&2
    exit 1
  }

  readonly profile="${EDUSCOPE_DEPLOYMENT_PROFILE:-production}"
  /opt/eduscope/current/deploy/kiosk/xrandr-layout.sh --manifest "$manifest" --profile "$profile"

  chromium=/usr/bin/chromium
  [[ -x /snap/bin/chromium ]] && chromium=/snap/bin/chromium
  [[ -x "$chromium" ]] || { printf 'Chromium executable unavailable\n' >&2; exit 69; }

  flags=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] || flags+=("$line")
  done <"$flags_file"
  exec "$chromium" "${flags[@]}"
  ```

- [ ] **Step 6: Run automated and cold-boot acceptance**

  Run:

  ```bash
  python3 -m unittest deploy.tests.test_kiosk_policy deploy.tests.test_xrandr_layout -v
  chromium --headless --disable-gpu --dump-dom http://127.0.0.1/ | rg '<div id="root">'
  ```

  Then, for production, cold boot twice. Expected: panel is full-screen on the 1280×800 display, projector/meeting land on their EDIDs regardless of connector enumeration, touch affects only panel, and no first-run/restore/password/download/print UI appears.

  On the current demo target, defer the live layout and Chromium checks to F-08 Step 7, because F-08 installs and activates the panel, Nginx, GDM session, and kiosk unit that those checks consume. F-08 runs the layout with `--profile demo-staging`, verifies Chromium on `HDMI-1`, and requires the script to print `multi-display acceptance open`. Record the three-display and two-cold-boot result as `NOT RUN`; the demo smoke does not close that physical acceptance.

- [ ] **Step 7: Run contract regression and commit**

  ```bash
  git diff --check
  git add deploy/kiosk deploy/systemd/eduscope-kiosk.service deploy/tests/test_kiosk_policy.py deploy/tests/test_xrandr_layout.py deploy/tests/fixtures/xrandr-three-displays.txt
  git commit -m "feat(device): boot panel in managed X11 kiosk"
  ```

---

### Task F-08: Build and install idempotently with rollback

**Files:**
- Create: `packages/shared/tsconfig.build.json`
- Create: `services/core-api/tsconfig.build.json`
- Modify: `packages/shared/package.json`
- Modify: `services/core-api/package.json`
- Create: `deploy/{install.sh,README.md,packages.ubuntu-24.04-aarch64.lock}`
- Create: `deploy/lib/{common,preflight,packages,identity,artifacts,configuration,services,verify,rollback}.sh`
- Create: `deploy/tests/{install.bats,preflight.bats,rollback.bats,test-production-build.mjs}`
- Modify: `services/privileged-helper/src/eduscope_privileged_helper/verbs.py`
- Modify: `packages/api-client/src/mixed/runtime-config.ts`
- Test: `packages/api-client/test/mixed/production-config.test.ts`
- Modify: `apps/panel/src/config/runtime-config.tsx`
- Modify: `apps/panel/src/routes/panel-shell.tsx`
- Test: `apps/panel/src/config/runtime-config.test.tsx`
- Test: `apps/panel/src/routes/panel-shell.test.tsx`

**Interfaces:**
- Consumes: `deploy/install.sh --profile production|demo-staging --manifest ABS --secrets ABS --release ABS [--acknowledge-open-firmware-acceptance] [--dry-run]`; F-01…F-07 artifacts. Production additionally consumes F-02b's reviewed updater; demo/staging explicitly does not.
- Produces: immutable `/opt/eduscope/releases/<release-id>`, atomic `/opt/eduscope/current`, venvs, panel/core/shared builds, installed config/units, rollback evidence, and either `PASS install verified profile=production` or `PASS demo smoke profile=demo-staging placeholder / firmware acceptance still open`.

- [ ] **Step 1: Write failing build, dry-run, idempotency, and rollback tests**

  `test-production-build.mjs` builds shared then core, launches compiled core with temp DB/provisioning/helper/PM fixtures, and requires `/healthz` v1. Bats tests mock `apt-get`, `install`, `systemctl`, `udevadm`, renderers, and health probes; assert preflight precedes first mutation, exact stage order 1–10, second identical run performs no package/config/unit mutation, foreign admin files are refused, a forced failure at every stage restores files/current symlink/unit enablement, and secrets never enter argv/output. Profile tests prove production refuses a missing updater/A-B layout, demo/staging requires the exact acknowledgement flag, demo/staging performs no partition/updater mutation, and helper `firmware.apply|rollback` return a redacted disabled response without invoking the runner. Panel tests require the exact open-acceptance notice on every demo/staging route and no notice in production.

- [ ] **Step 2: Run and verify red**

  Run:

  ```bash
  node deploy/tests/test-production-build.mjs
  bats deploy/tests/preflight.bats deploy/tests/install.bats deploy/tests/rollback.bats
  shellcheck deploy/install.sh deploy/lib/*.sh
  ```

  Expected: FAIL because production build scripts and installer do not exist.

- [ ] **Step 3: Add runnable production builds**

  `packages/shared/tsconfig.build.json` is complete:

  ```json
  {
    "extends": "./tsconfig.json",
    "compilerOptions": {
      "noEmit": false,
      "outDir": "dist",
      "declaration": true,
      "declarationMap": true
    },
    "include": ["src"],
    "exclude": ["test"]
  }
  ```

  Replace only `package.json`'s `exports` and add the build script; the complete replacement fragments are:

  ```json
  {
    "exports": {
      ".": {
        "types": "./src/index.ts",
        "development": "./src/index.ts",
        "default": "./dist/src/index.js"
      },
      "./schemas": {
        "types": "./src/schemas/rest.ts",
        "development": "./src/schemas/rest.ts",
        "default": "./dist/src/schemas/rest.js"
      }
    },
    "scripts": {
      "build": "tsc -p tsconfig.build.json"
    }
  }
  ```

  Preserve the package's existing `codegen`, `typecheck`, and `test` scripts alongside `build`.

  `services/core-api/tsconfig.build.json` is complete:

  ```json
  {
    "extends": "./tsconfig.json",
    "compilerOptions": {
      "noEmit": false,
      "outDir": "dist",
      "sourceMap": true
    },
    "include": ["src"],
    "exclude": ["test"]
  }
  ```

  Add exactly `"build":"tsc -p tsconfig.build.json && cp -a migrations dist/migrations"` and `"start":"node dist/src/server.js"` to core's existing scripts. The copy is required because `dist/src/db/migrate.js` resolves its immutable migration bundle at `dist/migrations`; `test-production-build.mjs` must prove the compiled process can migrate a new temporary database and serve `/healthz`. Build order is shared → core → panel. Also build quiz-service/quiz for the separate campus bundle; do not install D as a device unit.

- [ ] **Step 4: Implement the ten installer stages exactly**

  `install.sh` is root-only, `set -eEuo pipefail`, `umask 077`, uses absolute validated inputs, creates a timestamped `/var/lib/eduscope/install/rollback/<run-id>`, records the failed stage on `ERR`, and calls only these functions in order:

  ```bash
  preflight "$manifest" "$secrets" "$release"
  snapshot_owned_state
  install_packages
  install_identity_and_paths
  install_application_artifacts
  install_provisioning_and_secrets
  install_platform_configuration
  install_and_verify_units
  start_and_smoke
  mark_install_success
  ```

  The ERR trap calls `rollback_install` once. `--dry-run` executes validators and prints a deterministic action list but performs no mkdir/copy/package/systemd command.

  `deploy/install.sh` is complete; implementation detail stays in the named library functions:

  ```bash
  #!/usr/bin/env bash
  set -Eeuo pipefail
  IFS=$'\n\t'
  umask 077

  readonly deploy_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
  for library in common preflight packages identity artifacts configuration services verify rollback; do
    # shellcheck source=/dev/null
    source "$deploy_dir/lib/$library.sh"
  done

  usage() {
    printf 'usage: %s --profile production|demo-staging --manifest ABS --secrets ABS --release ABS [--acknowledge-open-firmware-acceptance] [--dry-run]\n' "$0" >&2
    exit 64
  }

  (( EUID == 0 )) || { printf 'install must run as root\n' >&2; exit 77; }
  profile= manifest= secrets= release= acknowledge_open_firmware=false dry_run=false
  while (( $# )); do
    case "$1" in
      --profile)  (( $# >= 2 )) || usage; profile=$2; shift 2 ;;
      --manifest) (( $# >= 2 )) || usage; manifest=$2; shift 2 ;;
      --secrets)  (( $# >= 2 )) || usage; secrets=$2; shift 2 ;;
      --release)  (( $# >= 2 )) || usage; release=$2; shift 2 ;;
      --acknowledge-open-firmware-acceptance) acknowledge_open_firmware=true; shift ;;
      --dry-run)  dry_run=true; shift ;;
      *) usage ;;
    esac
  done
  [[ "$profile" == production || "$profile" == demo-staging ]] || usage
  [[ -n "$manifest" && -n "$secrets" && -n "$release" ]] || usage
  if [[ "$profile" == demo-staging && "$acknowledge_open_firmware" != true ]]; then
    printf 'demo-staging requires --acknowledge-open-firmware-acceptance\n' >&2
    exit 78
  fi
  export EDUSCOPE_INSTALL_PROFILE="$profile"
  export EDUSCOPE_INSTALL_DRY_RUN="$dry_run"

  current_stage=preflight
  preflight "$manifest" "$secrets" "$release"

  on_error() {
    readonly status=$?
    trap - ERR
    rollback_install "$current_stage" "$status"
    exit "$status"
  }
  trap on_error ERR

  current_stage=snapshot
  snapshot_owned_state
  current_stage=packages
  install_packages
  current_stage=identity
  install_identity_and_paths
  current_stage=artifacts
  install_application_artifacts
  current_stage=configuration
  install_provisioning_and_secrets
  install_platform_configuration
  current_stage=services
  install_and_verify_units
  current_stage=smoke
  start_and_smoke
  current_stage=success
  mark_install_success
  trap - ERR
  ```

  Common preflight verifies Ubuntu 24.04, aarch64, kernel match, >=10 GiB system free space, manifest/schema status, expected display/device topology, time sync/network, Node >=22.13, Python >=3.11, pnpm 9.12.3, GStreamer and every `RK3588Profile.required_elements()`, artifact/model/prompt hashes, and absence of unresolved runtime tokens. Production additionally requires deployable image provenance, the expected recordings volume, and F-02b's real updater/A-B gate. Demo/staging permits only the already-running single-rootfs target and, when the dedicated recording volume is unavailable, uses `/media/eduscope` as a root-filesystem directory while clearly reporting `recordings volume acceptance open`; all A/B/C services still share that exact path. It never flashes, repartitions, calls the updater, or records acceptance evidence. Package lock contains exact `name=version` pairs resolved on the frozen image for GStreamer plugins/tools, ffmpeg, nginx/libnginx-mod-rtmp, stunnel4, Chromium/GDM/X11 tools, ALSA/v4l/udev/gpiod/smart/uhub tools, Node/pnpm prerequisites, Python venv/build, Bats, and ShellCheck.

  The installed helper config contains `firmwareMode:"enabled"` only in production after F-02b passes; demo/staging renders `firmwareMode:"disabled"`. The helper checks that field before runner dispatch and returns `{ "ok":false, "detail":"placeholder / firmware acceptance still open" }` for `firmware.apply` and `firmware.rollback`. No fake updater executable is installed. Because systemd dependency lists cannot be reset from drop-ins, demo/staging installs deploy-owned, fully rendered copies of every runtime/A/B/C unit that names `media-eduscope.mount`; those copies remove only that mount's `Requires=`/`After=` entries, retain every other dependency and ordering edge, and set `EDUSCOPE_DEPLOYMENT_PROFILE=demo-staging` on runtime configuration. Tests enumerate every canonical unit containing the mount dependency, require a matching rendered demo unit, and use systemd's resolved properties to prove none retains the mount. A production install atomically restores the canonical production units, so reboot cannot silently keep the demo graph. Runtime `config.json` carries the F-03 profile/notice fields, `packages/api-client` validates them, and `panel-shell.tsx` renders each notice as a persistent, non-dismissible status banner.

  Install release content under a new release id; build Node artifacts; create separate helper/pipeline/AI venvs with wheels and hashes; copy panel dist; migrate SQLite twice as `eduscope-core`; render files before activation; verify units/configs; atomically switch `current`; daemon-reload/reload udev; enable mount/helper/runtime/A/B/C/kiosk/nginx/stunnel in dependency order. D remains campus-only.

- [ ] **Step 5: Implement bounded smoke and rollback**

  `verify.sh` checks mount/media-root policy, permissions, loopback listeners, `/healthz`, profile-correct `/config.json`, REST and both WS upgrades through Nginx, no failed Eduscope units, no mixed local A/B/C overrides, and journal/source scans for secrets/sudo. It starts/stops a 2-minute recording through the public API, waits for resolving events, and runs `ffprobe` on TS/MP4. Production prints `PASS install verified profile=production` only after all checks. Demo/staging additionally verifies disabled firmware mutation and the visible banner, then prints only `PASS demo smoke profile=demo-staging placeholder / firmware acceptance still open`.

  Rollback stops only units first started by this run, restores each owned file from the recorded digest map, restores the previous `current` symlink and enablement set, daemon-reloads, restarts the previous known-good set, and prints `ROLLBACK COMPLETE stage=<name> evidence=<absolute-path>`. It never deletes an unknown release or administrator file.

- [ ] **Step 6: Run all automated installer/build gates**

  Run:

  ```bash
  pnpm --filter @eduscope/shared build
  pnpm --filter @eduscope/core-api build
  pnpm --filter @eduscope/panel build
  pnpm --filter @eduscope/panel test -- src/config/runtime-config.test.tsx src/routes/panel-shell.test.tsx
  node deploy/tests/test-production-build.mjs
  bats deploy/tests/preflight.bats deploy/tests/install.bats deploy/tests/rollback.bats
  shellcheck deploy/install.sh deploy/lib/*.sh scripts/bringup/*.sh
  ```

  Expected: compiled core health passes; Bats prints all PASS; ShellCheck emits no finding.

- [ ] **Step 7: Run demo/staging on the current target and production on the clean A/B target**

  On the current single-rootfs demo target:

  ```bash
  /path/to/release/deploy/install.sh --profile demo-staging --acknowledge-open-firmware-acceptance --manifest /secure/device-manifest.json --secrets /secure/secrets.json --release /path/to/release --dry-run
  /path/to/release/deploy/install.sh --profile demo-staging --acknowledge-open-firmware-acceptance --manifest /secure/device-manifest.json --secrets /secure/secrets.json --release /path/to/release
  EVIDENCE_DIR="docs/evidence/phase-4/workstream-f/f05/$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$EVIDENCE_DIR"
  sudo bash deploy/tests/verify-systemd.sh --live
  systemd-analyze security eduscope-helper.service eduscope-pipeline-manager.service eduscope-core-api.service eduscope-stt.service eduscope-slide.service eduscope-question.service eduscope-kiosk.service > "$EVIDENCE_DIR/systemd-security.txt"
  ```

  The deferred F-05 `--live` check records activation timestamps, kills each
  main PID separately, and applies the restart/degradation matrix specified in
  F-05 Step 7. Expected: `PASS systemd live restart matrix`; the security report
  is captured without an arbitrary score threshold. The panel at
  `http://127.0.0.1/` shows the persistent firmware-acceptance notice; A/B/C and
  the single origin are healthy; a two-minute recording finalizes and passes
  `ffprobe`; firmware apply/rollback invoke no runner; install output is `PASS
  demo smoke profile=demo-staging placeholder / firmware acceptance still
  open`. This is the earliest management-demo gate and is not F-09 acceptance.

  Later, after F-02b, on a disposable clean A/B image:

  ```bash
  /path/to/release/deploy/install.sh --profile production --manifest /secure/device-manifest.json --secrets /secure/secrets.json --release /path/to/release --dry-run
  /path/to/release/deploy/install.sh --profile production --manifest /secure/device-manifest.json --secrets /secure/secrets.json --release /path/to/release
  /path/to/release/deploy/install.sh --profile production --manifest /secure/device-manifest.json --secrets /secure/secrets.json --release /path/to/release
  EDUSCOPE_INSTALL_FAIL_STAGE=services /path/to/release/deploy/install.sh --profile production --manifest /secure/device-manifest.json --secrets /secure/secrets.json --release /path/to/release
  ```

  Expected: dry-run mutation ledger is empty; first install prints `PASS install verified profile=production`; second prints `NO CHANGE` for stages 2–8 then verifies; forced run exits nonzero after `ROLLBACK COMPLETE`, and prior health/config digests match.

- [ ] **Step 8: Run contract regression and commit**

  ```bash
  git diff --check
  git add packages/shared/package.json packages/shared/tsconfig.build.json services/core-api/package.json services/core-api/tsconfig.build.json deploy services/privileged-helper/src/eduscope_privileged_helper/verbs.py packages/api-client/src/mixed/runtime-config.ts packages/api-client/test/mixed/production-config.test.ts apps/panel/src/config apps/panel/src/routes
  git commit -m "feat(deploy): install reproducible device release"
  ```

---

### Gate F-02b: Accept the signed updater on an A/B-capable target

This is a later physical-device acceptance gate, not a new numbered Workstream F task. It runs after F-08 is available and immediately before production F-09. It is not run for demo/staging.

Run:

```bash
test -x /usr/libexec/eduscope-updater
/usr/libexec/eduscope-updater describe --json | python3 -m json.tool
test -f /secure/release/updater-interface-v1.json
python3 -m json.tool /secure/release/updater-interface-v1.json
lsblk -o NAME,PARTLABEL,PARTUUID,MOUNTPOINTS
```

Expected: the release-owner document and `describe` agree on `interfaceVersion:1`, `signatureAlgorithm`, `trustRootSha256`, distinct `activeSlot`/`inactiveSlot`, `bootSuccessMarker`, and commands `check/apply/rollback`; `lsblk` proves the reported slots exist. Then execute signed check/apply, bad-signature rejection, boot-success marking, and forced failed-boot automatic rollback using the release-owner procedure. Commit only real, redacted device evidence labelled `PASS F-02b signed updater acceptance`.

On the currently inspected single-rootfs target this gate fails and stays open. That does not block F-03 through F-08 or the F-08 demo/staging smoke, but it blocks production F-09 and every final acceptance task. Do not create a fake updater, release document, trust root, slot, or acceptance witness.

---

### Task F-09: Accept clean provisioning on a freshly flashed device

**Gate:** F-02b must first pass on the real A/B-capable image. A demo/staging install is not an F-09 prerequisite substitute and its evidence directory is rejected.

**Files:**
- Create: `scripts/bringup/clean-install-check.sh`
- Create: `scripts/bringup/parse-clean-install.py`
- Create: `scripts/bringup/tests/test_clean_install_evidence.py`
- Create: `docs/evidence/phase-4/workstream-f/f09/README.md`

**Interfaces:**
- Consumes: the named supported image, its published SHA-256, a clean SD/eMMC target, F-01's private manifest, protected secrets, the F-08 release, and the real E adapter gate.
- Produces: one immutable evidence directory containing image/release identity, two-boot service state, redacted runtime state, real-adapter login/dashboard proof, and a playable two-minute recording.

- [ ] **Step 1: Write the failing evidence-parser test**

  Build a temporary evidence tree and assert that the parser rejects every missing/empty artifact, a changed image hash, a failed Eduscope unit, an unresolved render sentinel, mixed adapter override, browser prompt, non-real screenshot metadata, a recording shorter than 120 seconds, a non-seekable MP4, a secret-shaped field, and a manifest whose checksums do not match. The passing fixture must contain exactly the files listed in Step 3 and report two distinct successful boot IDs.

- [ ] **Step 2: Run and verify red**

  ```bash
  python3 -m unittest scripts.bringup.tests.test_clean_install_evidence -v
  ```

  Expected: FAIL because `parse-clean-install.py` does not exist.

- [ ] **Step 3: Implement the resumable clean-install checker**

  Its interface is exact:

  ```text
  clean-install-check.sh prepare --image <image> --image-sha256 <64hex> --device <explicit-block-device> --manifest <absolute-json> --secrets <absolute-json> --release <absolute-dir> --evidence-dir <new-absolute-dir>
  clean-install-check.sh after-boot --evidence-dir <same-dir> --boot 1|2
  clean-install-check.sh finish --evidence-dir <same-dir>
  ```

  `prepare` refuses a mounted/system device, an existing evidence directory, relative/symlinked inputs, a hash mismatch, or incomplete F-01 topology. It records operator, UTC, target serial, image hash, release Git commit/artifact checksums, and physical connections; flashes only the exact resolved device after the operator types its full kernel name; mounts the flashed root and invokes the one documented F-08 installer command. It stores no secret content or private manifest content.

  Each `after-boot` captures these files without filtering away failures:

  ```text
  boot-<n>/boot-id.txt
  boot-<n>/systemctl-failed.txt
  boot-<n>/eduscope-units.txt
  boot-<n>/unit-versions.txt
  boot-<n>/migration-version.txt
  boot-<n>/runtime-config.redacted.json
  boot-<n>/display-topology.txt
  boot-<n>/journal-eduscope.txt
  ```

  Boot 1 changes the bootstrap administrator password through the real UI. Boot 2 proves the new password works and the bootstrap secret no longer authenticates. Then run `node packages/api-client/scripts/run-real-screen.mjs panel s01-login`, capture the real dashboard screenshot plus its Playwright result JSON, start/stop recording through the real panel, and save `recording.json`, the TS/MP4/manifest paths and SHA-256 values, `ffprobe.json`, and seek results at 5, 60, and 115 seconds. `finish` calls the parser, writes `manifest.sha256`, and prints only after validation:

  ```text
  PASS F-09 clean provisioning evidence=<absolute-dir>
  ```

- [ ] **Step 4: Execute the physical clean-device procedure**

  On the named RK3588 target, connect the frozen capture device, mic, recording disk, three displays, and LAN. Run:

  ```bash
  sudo scripts/bringup/clean-install-check.sh prepare --image /secure/images/eduscope-supported.img --image-sha256 "$APPROVED_IMAGE_SHA256" --device /dev/<scratch-target> --manifest /secure/device-manifest.json --secrets /secure/secrets.json --release /path/to/release --evidence-dir "$EVIDENCE_DIR"
  # Boot the flashed target.
  sudo scripts/bringup/clean-install-check.sh after-boot --evidence-dir "$EVIDENCE_DIR" --boot 1
  sudo systemctl reboot
  sudo scripts/bringup/clean-install-check.sh after-boot --evidence-dir "$EVIDENCE_DIR" --boot 2
  scripts/bringup/clean-install-check.sh finish --evidence-dir "$EVIDENCE_DIR"
  ```

  Expected: two distinct boot IDs; zero failed Eduscope units; every unit/version/migration is recorded; production config is `{ "default": "real", "overrides": {} }`; no unresolved values or browser prompts; forced password reset survives reboot; and both TS and MP4 are playable, seekable, and at least 120 seconds.

- [ ] **Step 5: Run regressions and commit**

  ```bash
  python3 -m unittest scripts.bringup.tests.test_clean_install_evidence -v
  pnpm gate:e
  git diff --check
  git add scripts/bringup/clean-install-check.sh scripts/bringup/parse-clean-install.py scripts/bringup/tests/test_clean_install_evidence.py docs/evidence/phase-4/workstream-f/f09
  git commit -m "test(device): accept clean provisioning"
  ```

  Expected: parser and E gate pass, the dated F-09 evidence says PASS, and no secret-bearing file is staged.

---

### Task F-10: Prove 90-minute recording, pause semantics, and crash recovery

**Files:**
- Create: `scripts/bringup/record-recovery-check.sh`
- Create: `scripts/bringup/parse-record-recovery.py`
- Create: `scripts/bringup/tests/test_record_recovery_evidence.py`
- Create: `docs/evidence/phase-4/workstream-f/f10/README.md`

**Interfaces:**
- Consumes: real A/B services, the public API through Nginx, a clock/video source with an audible periodic marker, and F-09's installed target.
- Produces: dated witnesses for master procedures 2 and 3 and KEEP B-03/B-05/B-07/B-10/B-15/B-23.

- [ ] **Step 1: Write the failing artifact and recovery parser tests**

  Cover a 90-minute duration within `max(2 seconds, 0.2% of requested duration)`, seek success near start/middle/end, A/V marker offset no greater than A-15's existing 100 ms limit, one recording/manifest/queue insertion, targeted recorder PID signals, `Got EOS`, no global kill, LED state, monotonically indexed pause segments, absence of paused audio, server-restored owner/lock/timer, recovery banner, playable post-crash material, and one upload job. Reject a synthetic or fixture-labelled source.

- [ ] **Step 2: Run and verify red**

  ```bash
  python3 -m unittest scripts.bringup.tests.test_record_recovery_evidence -v
  ```

  Expected: FAIL because the parser and runner do not exist.

- [ ] **Step 3: Implement the runner and evidence format**

  The exact entrypoint is:

  ```text
  record-recovery-check.sh --origin https://127.0.0.1 --token-file <0600-file> --evidence-dir <new-dir> [--resume <existing-dir>]
  ```

  The token file is read once through a non-symlink file descriptor and never copied or printed. The runner records wall-clock and monotonic timestamps, public API responses with authorization removed, relevant `recording.state`/`recording.artifact` events, PM status and pipeline PIDs, helper LED audit, narrowly scoped journals, hashes/`ffprobe` JSON for every artifact, upload queue row counts, and operator observations. Subcommands are internally checkpointed so the two-hour run can resume without reusing or relabelling an earlier recording.

- [ ] **Step 4: Run the 90-minute continuous recording procedure**

  Feed the physical capture path a visible UTC clock and a numbered tone/flash marker every ten seconds. Start recording from the real UI, keep the source tiles live for 90 minutes, then stop from the UI. Capture the recorder PID before stop and prove it alone receives SIGINT followed by `Got EOS`; a `killall`, `pkill`, or signal to an unrelated GStreamer process fails acceptance.

  Probe TS and MP4 duration/streams/packets, seek at 5 seconds, midpoint, and five seconds before end, correlate tone/flash markers, and compare the B recording, artifact, manifest, and upload-queue rows by stable recording ID. Expected: finalized seekable TS/MP4, duration in tolerance, A/V offset <=100 ms, one manifest and one queue insertion, recording LED off, and `PASS F-10 continuous recording`.

- [ ] **Step 5: Run pause/resume and three recovery cases**

  Start a new lecture; pause for 60 measured seconds, verify the LED is off while live/meeting consumers truthfully remain active, resume, and repeat twice before stop. Inspect the resulting lecture group: segment indices are strictly increasing, each segment is playable, paused windows contain no corridor audio, and the merge/separate deliverables match the selected layout.

  Use a fresh recording ID for each case:

  1. Kill only the record-consumer PID with `kill -9` while live; verify A reports failure/recovery without killing publishers or other consumers and B retains the original session identity.
  2. Restart `eduscope-core-api.service` while paused; verify persisted state restores the same lecturer/admin authority, owner, lock, elapsed timer, and pause state. Exercise same-user stop plus admin takeover once; a different lecturer is rejected.
  3. Hard reboot while live; after boot verify the recovery banner, recovered/playable captured material, released or restored lock according to the persisted terminal state, and a single upload job.

  Expected: `PASS F-10 pause and recovery`; no duplicate recording, artifact, lecture group, or upload row exists.

- [ ] **Step 6: Run focused and contract regressions**

  ```bash
  python3 -m unittest scripts.bringup.tests.test_record_recovery_evidence -v
  cd services/pipeline-manager && .venv/bin/python -m pytest tests/consumers/test_record.py tests/consumers/test_source_loss_integ.py -q
  cd ../.. && pnpm --filter @eduscope/core-api test -- test/recording test/uploads
  ```

  Expected: all focused suites pass and the evidence parser prints `PASS F-10 evidence complete`.

- [ ] **Step 7: Commit F-10**

  ```bash
  git diff --check
  git add scripts/bringup/record-recovery-check.sh scripts/bringup/parse-record-recovery.py scripts/bringup/tests/test_record_recovery_evidence.py docs/evidence/phase-4/workstream-f/f10
  git commit -m "test(device): prove recording recovery"
  ```

---

### Task F-11: Prove upload fault policy and the live AI round-trip

**Files:**
- Create: `scripts/bringup/upload-fault.sh`
- Create: `scripts/bringup/ai-roundtrip.sh`
- Create: `scripts/bringup/parse-upload-ai.py`
- Create: `scripts/bringup/fixtures/ai-known-corpus.json`
- Create: `scripts/bringup/tests/test_upload_ai_evidence.py`
- Create: `docs/evidence/phase-4/workstream-f/f11/README.md`

**Interfaces:**
- Consumes: F-10 recordings, the TLS placeholder endpoint and controllable fault proxy, real STT/slide/question services, real B↔D sync, known spoken/slides corpus, and the deployed external llama.cpp process.
- Produces: the master procedures 4 and 5 witnesses, KEEP B-27/B-28, and explicitly non-production upload evidence.

- [ ] **Step 1: Write failing fault/latency/provenance tests**

  Assert immediate upload scheduling, no attempt consumption for connectivity loss, durable part/byte offset, no duplicate remote lecture/part, server/permanent failure attempt consumption and dead-letter reason, manual requeue, 3–5 schema-valid MCQs, outer request-to-ready latency <=45 seconds, prompt/model provenance, exclusion of pause transcript, D acknowledgement before projector visibility, recording continuity during llama.cpp loss, held/degraded countdown, and probe recovery. Require the literal evidence classification `placeholder only / D-02b still open`.

- [ ] **Step 2: Run and verify red**

  ```bash
  python3 -m unittest scripts.bringup.tests.test_upload_ai_evidence -v
  ```

  Expected: FAIL because the runners/parser do not exist.

- [ ] **Step 3: Implement and run the upload fault procedure**

  Exact interface:

  ```text
  upload-fault.sh --origin <device-https-origin> --token-file <0600-file> --proxy-control <https-url> --evidence-dir <new-dir>
  ```

  Configure one TLS-enabled placeholder target through the public API. Finish a multi-part recording and prove the first upload request begins immediately, with no scheduling-window wait. Through the proxy: cut the link mid-part, hold it offline across one retry interval, restart B, then restore it. Record request `Content-Range`/offset metadata and remote object digests without recording authorization or payload bytes. Next inject retriable server failures through the configured maximum, one permanent failure, inspect the durable reason/attempt count, manually requeue, and let it complete.

  Expected: connectivity loss consumes zero attempts; restart resumes from the durable acknowledged offset instead of byte zero; all parts belong to one remote lecture and occur once; server/permanent failures consume attempts and dead-letter visibly; requeue succeeds. Output is `PASS F-11 upload placeholder`, and every evidence document begins with `placeholder only / D-02b still open`.

- [ ] **Step 4: Implement and run the AI round-trip procedure**

  Exact interface:

  ```text
  ai-roundtrip.sh --origin <device-https-origin> --token-file <0600-file> --corpus scripts/bringup/fixtures/ai-known-corpus.json --llm-unit <reviewed-unit> --evidence-dir <new-dir>
  ```

  The committed corpus contains synthetic spoken text, slide text, transition times, and expected topic tokens, but no student or staff data. Record it through the physical mic/capture inputs; pause during a uniquely marked sentence; advance the known slides. Confirm transcript chunks and slide OCR rows are persisted. Trigger Generate Now once and allow one configured scheduled interval once. For each request, capture monotonic request/ready/publish/D-ack/projector timestamps, question count/schema, prompt/model/template hashes, and source-window identifiers without preserving question answers in the public evidence.

  Use the deploy owner's reviewed llama.cpp unit/control command from provisioning; if none exists, STOP rather than guessing a process name. Stop it for one scheduled cycle, prove countdown held/degraded while recording continued, restart it, wait for the real probe to recover, and generate from the retained valid window.

  Expected: each healthy run returns 3–5 valid MCQs within B's outer 45-second budget; no paused sentence appears; D ack precedes projector/phone publication; the outage does not stop recording or lose the eligible window; output is `PASS F-11 AI roundtrip`.

- [ ] **Step 5: Run B/C/D regressions and commit**

  ```bash
  python3 -m unittest scripts.bringup.tests.test_upload_ai_evidence -v
  pnpm --filter @eduscope/core-api test -- test/uploads test/ai test/quiz
  cd services/ai && .venv/bin/python -m pytest -q
  cd ../.. && pnpm --filter @eduscope/quiz-service test -- test/integration/device-sync.test.ts
  git diff --check
  git add scripts/bringup/upload-fault.sh scripts/bringup/ai-roundtrip.sh scripts/bringup/parse-upload-ai.py scripts/bringup/tests/test_upload_ai_evidence.py scripts/bringup/fixtures/ai-known-corpus.json docs/evidence/phase-4/workstream-f/f11
  git commit -m "test(device): prove upload and AI recovery"
  ```

  Expected: all tests pass, both dated F-11 witnesses validate, and no evidence claims D-02b or institute production upload acceptance.

---

### Task F-12: Execute the real 30-phone quiz hall test

**Files:**
- Create: `scripts/bringup/quiz-hall-check.ts`
- Create: `scripts/bringup/fixtures/phone-roster.example.json`
- Create: `scripts/bringup/tests/quiz-hall-check.test.ts`
- Create: `docs/evidence/phase-4/workstream-f/f12/README.md`

**Interfaces:**
- Consumes: the real device panel, D-10/D-11 on campus PostgreSQL 16/DNS/TLS, the real B↔D sync credential, 30 physical phones spanning campus Wi-Fi/mobile data, and D's existing 200-client load runner.
- Produces: master procedure 6 evidence with pseudonymous phone IDs, publication/answer/rank reconciliation, terminal-state checks, and the preserved 200-client capacity report.

- [ ] **Step 1: Enforce the campus prerequisite STOP**

  Before creating a session, record and validate the D-10/D-11 dated evidence, PostgreSQL 16 server identity, HTTPS hostname/certificate chain, firewall reachability from the device and both phone networks, and a green `pnpm --filter @eduscope/quiz-service gate:d`. If any is missing, print `STOP F-12 campus staging prerequisite: <reason>` and produce no F-12 PASS evidence. Testcontainers/local-only D cannot satisfy this check.

- [ ] **Step 2: Write the failing result reconciler test**

  Use 30 synthetic roster IDs `P01`..`P30`. Test normal answers, duplicate taps, an offline/reconnect replay, both answer-vs-close orders, late join, no participation, stale joined count, pending→current own rank, terminal summaries, and projector privacy. Reject duplicate accepted answers, another participant's identity/result, a panel/phone rank mismatch, missing network cohort, fewer than 30 physical-device attestations, or simulated-browser evidence.

- [ ] **Step 3: Run and verify red**

  ```bash
  pnpm exec tsx --test scripts/bringup/tests/quiz-hall-check.test.ts
  ```

  Expected: FAIL because `quiz-hall-check.ts` does not exist.

- [ ] **Step 4: Implement the evidence reconciler**

  Exact interface:

  ```text
  pnpm exec tsx scripts/bringup/quiz-hall-check.ts prepare --origin <device-origin> --quiz-origin <campus-origin> --roster <private-json> --evidence-dir <new-dir>
  pnpm exec tsx scripts/bringup/quiz-hall-check.ts reconcile --evidence-dir <same-dir> --load-report <d09-json>
  ```

  The private roster maps only `P01`..`P30` to network cohort and operator station; it is never copied into evidence. `prepare` prints a timestamped operator checklist and records hashed device attestations. `reconcile` validates public B/D event and response logs, the panel state snapshots, each phone's own redacted result/rank, projector screenshots processed by the existing privacy assertion, and the unchanged D load report checksum. It emits no participant ID, name, answer text, cookie, join secret, or bearer.

- [ ] **Step 5: Run the physical quiz hall procedure**

  Display the real QR and have at least 30 physical phones resolve/register, with both mobile data and campus Wi-Fi represented. Publish at least three questions and assign the following observable cases without changing product behavior: duplicate tap; network loss before response followed by reconnect; both answer-before-close and close-before-answer races; join after the session has begun; and one registered phone that never participates.

  Verify exactly one accepted answer per participant/publication, honest joined/stale counts, atomic reconnect snapshots, each phone's own result and pending→current rank against the panel, correct participated/no-participation terminal summaries, and no leaderboard/PII on the projector. Run D's existing capacity witness:

  ```bash
  pnpm --filter @eduscope/quiz-service load:200
  pnpm exec tsx scripts/bringup/quiz-hall-check.ts reconcile --evidence-dir "$EVIDENCE_DIR" --load-report services/quiz-service/test/load/evidence/d09-gate.json
  ```

  Expected: `PASS F-12 real quiz hall phones=30 questions>=3`; the load report independently proves 200 clients and remains byte-for-byte attributable to D's runner.

- [ ] **Step 6: Run regressions and commit**

  ```bash
  pnpm exec tsx --test scripts/bringup/tests/quiz-hall-check.test.ts
  pnpm --filter @eduscope/quiz-service gate:d
  pnpm gate:e
  git diff --check
  git add scripts/bringup/quiz-hall-check.ts scripts/bringup/fixtures/phone-roster.example.json scripts/bringup/tests/quiz-hall-check.test.ts docs/evidence/phase-4/workstream-f/f12
  git commit -m "test(device): accept real quiz hall"
  ```

---

### Task F-13: Execute storage, LED/watchdog, stream/meeting/projector, and power procedures

**Files:**
- Create: `scripts/bringup/storage-hardware.sh`
- Create: `scripts/bringup/power.sh`
- Create: `scripts/bringup/parse-hardware-evidence.py`
- Create: `scripts/bringup/tests/test_hardware_evidence.py`
- Create: `docs/evidence/phase-4/workstream-f/f13/README.md`

**Interfaces:**
- Consumes: a dedicated scratch recording disk or safe loop image, the F-01 LED/watchdog/display facts, saved streaming-target fixtures, physical receiver laptop/projector/HDMI #2 audio, real A/B/kiosk/helper, and an out-of-band way to restart the target after halt.
- Produces: master procedures 7–10 and KEEP B-39/B-50/B-53/B-56/B-59/B-60 evidence.

- [ ] **Step 1: Write failing safety and threshold tests**

  Model sequential uploaded/unuploaded recordings plus a foreign file, warning/critical thresholds, wrong device/confirmation, every LED state, USB-hub attempt windows/exhaustion, enabled-target equality, bitrate/framerate probe values, independent consumer PIDs, measured projector/HDMI latency, recording-aware power refusal, helper audit identity, and source/build/journal privilege scans. Reject deletion of ineligible content, format of a system/mounted/unconfirmed target, more than two hub cycles/hour, record interruption by another consumer, disabled destination traffic, projector leaderboard/PII, poweroff while recording, `sudo`, shell/generic exec, or unaudited helper success.

- [ ] **Step 2: Run and verify red**

  ```bash
  python3 -m unittest scripts.bringup.tests.test_hardware_evidence -v
  ```

  Expected: FAIL because runner/parser files do not exist.

- [ ] **Step 3: Implement the guarded hardware runner**

  Exact entrypoint:

  ```text
  storage-hardware.sh storage --origin <device-origin> --token-file <0600-file> --scratch-device <explicit-device-or-loop> --evidence-dir <new-dir>
  storage-hardware.sh led-watchdog --origin <device-origin> --token-file <0600-file> --evidence-dir <same-dir>
  storage-hardware.sh av --origin <device-origin> --token-file <0600-file> --targets <private-json> --evidence-dir <same-dir>
  power.sh --origin <device-origin> --token-file <0600-file> --evidence-dir <same-dir> --phase refuse|halt|after-boot
  ```

  Resolve every block device immediately before use, refuse root/parent/mounted targets, and require the operator to type the full resolved device path before any format call. The script uses the public API/helper rather than app-side root commands; root-only fixture preparation is separately logged as operator setup. Store redacted API/event/journal data, process identities, `ffprobe` JSON, video/latency measurements and digests, but never stream keys or media frames containing people.

- [ ] **Step 4: Execute storage and retention (master procedure 7)**

  On only the dedicated scratch target, create known-age uploaded/unuploaded recording rows and matching files in sequential order, plus one foreign file. Size the volume/image to cross warning and critical thresholds. Run the real sweep and attempt Start at critical.

  Expected: uploaded-oldest eligible rows delete first; unuploaded content never auto-deletes; the foreign file neither deletes nor aborts the sweep; UI warning/policy text equals configured thresholds; critical pressure refuses recording start. Register/format only the explicit scratch target; mismatched confirmation and a different/system/mounted device are rejected. Output `PASS F-13 storage and retention`.

- [ ] **Step 5: Execute LED and capture-card watchdog (master procedure 8)**

  Video the physical LED and correlate timestamps for starting, recording, paused, stopping, stopped, record-consumer crash, and reboot recovery. If F-01 records no fitted LED, require the helper's audited absent-LED no-op plus UI state evidence; do not fabricate optical evidence.

  Physically disconnect or otherwise cause two genuine capture misses, verify recovery/re-enumeration after at most two `usbhub.cycle` calls in a rolling hour, then force another miss while the budget is exhausted. Expected: LED is a pure recording-state projection; watchdog alert/state/attempt count are exact; no third helper cycle occurs; PC capture stays absent at exhaustion; camera-only recording remains playable. Output `PASS F-13 LED and watchdog`.

- [ ] **Step 6: Execute streaming, meeting, and projector hardware (master procedure 9)**

  Configure saved fixture targets for YouTube, Facebook, and custom RTMP, with at least one disabled entry. For each target set and one-tap preset, probe every receiver and compare actual destination set to enabled target IDs. Use `ffprobe` to prove B-56 selected bitrate/framerate reach the real output. While recording, separately kill the live, meeting, and projector consumer PIDs and prove only that consumer restarts and the record PID/artifact remains uninterrupted.

  On the receiver laptop, select the meeting webcam+mic and verify picture plus mic. On physical displays, measure laptop-to-projector latency and HDMI #2 audio/video offset with the clock/tone marker, exercise slides→question→slides, and scan projector captures for leaderboard/PII. Change saved targets during an active stream and prove the active pipeline is not interrupted until the explicit next apply/start boundary.

  Expected: exact enabled destination set, requested profiles on the wire, independent recovery, uninterrupted recording, functioning meeting webcam+mic, measured latency/offset values, correct projector mode, and `PASS F-13 streaming meeting projector`.

- [ ] **Step 7: Execute power and privilege (master procedure 10)**

  Request power-off from the kiosk during a recording and require the declared refusal with no helper `system.poweroff`. Stop and finalize, request again while idle, capture the accepted helper audit, and use out-of-band observation to prove the board halts. After restarting, run `power.sh --phase after-boot` to close the evidence; do not require a fabricated resolving WebSocket event for actual power loss.

  Scan source, built artifacts, unit `ExecStart*`, helper audit, and F-09..F-13 journals for app-issued `sudo`, shell execution, `generic.exec`, or unallowlisted commands. Send wrong-UID, malformed protocol, unknown verb, bad UUID/devnode, metacharacter, and over-rate requests. Expected: every invalid call is rejected, only fixed argv executes, each accepted call identifies uid/pid/requestId/verb/result, and output is `PASS F-13 power and privilege`.

- [ ] **Step 8: Run regressions and commit**

  ```bash
  python3 -m unittest scripts.bringup.tests.test_hardware_evidence -v
  pnpm --filter @eduscope/core-api test -- test/storage test/device test/channels test/settings/network.test.ts
  cd services/pipeline-manager && .venv/bin/python -m pytest tests/hardware tests/consumers -q
  cd ../.. && shellcheck scripts/bringup/storage-hardware.sh scripts/bringup/power.sh
  git diff --check
  git add scripts/bringup/storage-hardware.sh scripts/bringup/power.sh scripts/bringup/parse-hardware-evidence.py scripts/bringup/tests/test_hardware_evidence.py docs/evidence/phase-4/workstream-f/f13
  git commit -m "test(device): accept hardware and privilege paths"
  ```

  Expected: all four procedure outputs and all fourteen KEEP witnesses assigned to F-13/F-10/F-11 are present and parser-valid; this task specifically closes its six assigned KEEP items.

---

### Task F-14: Measure resource headroom and close the final Workstream F evidence gate

**Files:**
- Create: `scripts/bringup/resource-soak.sh`
- Create: `scripts/bringup/parse-resource-soak.py`
- Create: `scripts/bringup/tests/test_resource_soak_evidence.py`
- Create: `docs/evidence/phase-4/README.md`
- Create: `docs/evidence/phase-4/workstream-f/f14/README.md`

**Interfaces:**
- Consumes: all F-09..F-13 dated evidence, production real adapters, the executed JPEG preview path, real A/B/C/D services, the physical target, and existing A/B/D/E gates.
- Produces: master procedure 11 measurements and one checksum-bound final report that either passes unchanged acceptance or stops with explicit A/E scope-update instructions.

- [ ] **Step 1: Write the failing metric and completeness tests**

  Feed fixed CSV/JSON samples and assert at least 30 minutes after warm-up, samples no more than five seconds apart, mean aggregate CPU idle >=30%, requested output fps sustained, no thermal-throttle event that overlaps capture degradation, no monotonically growing pipeline queue or RSS in the final ten minutes, all queue depths returning to their pre-run baseline after stop, uninterrupted/decodable recording, JPEG dimensions 480×270, refresh cadence 0.8–1.2 Hz, no stale interval longer than three seconds, and one question generation during the interval. The completeness test requires procedures 1–11 in order, F-09..F-14 commit/date/board/release identity, all assigned KEEP witnesses, contract/mock/real gates, D-02b classification, secret scan, and matching checksums.

- [ ] **Step 2: Run and verify red**

  ```bash
  python3 -m unittest scripts.bringup.tests.test_resource_soak_evidence -v
  ```

  Expected: FAIL because the soak parser and Phase-4 evidence index do not exist.

- [ ] **Step 3: Implement the resource sampler and final validator**

  Exact interface:

  ```text
  resource-soak.sh run --origin <device-origin> --token-file <0600-file> --duration 30m --interval 5s --evidence-dir <new-dir>
  resource-soak.sh verify --evidence-dir <same-dir>
  resource-soak.sh verify-all --workstream-dir docs/evidence/phase-4/workstream-f
  ```

  `run` rejects a duration below 30 minutes or interval above five seconds. It launches no fake workload: through the production UI/API start composite record, live stream, meeting, one authenticated JPEG preview, snapshot, and STT, then generate one question. Collect timestamped `mpstat -P ALL`, `pidstat -r -u`, `vmstat`, `iostat -xz`, thermal-zone and RK3588 throttle values, GStreamer QoS/fps/drop logs, PM resource ledger/status/queue depths, browser process RSS, JPEG request timestamps/status/dimensions/digests/stale transitions, public recording events, and final `ffprobe` packet/stream JSON. Redact at capture time.

  `verify` checks the Step 1 thresholds and writes `summary.json`, `summary.md`, and `manifest.sha256`. “No unbounded growth” means neither RSS nor any queue rises monotonically throughout the final ten minutes and every queue returns to its pre-run baseline after stop; this operationalizes the master criterion without inventing a new memory ceiling. A failure prints the exact metric/window and exits nonzero; it never changes the threshold or reports an exception as PASS.

  `verify-all` rejects templates, `NOT RUN`, `DEFERRED`, missing dates, mismatched commits/board IDs, checksum errors, missing procedure numbers, missing KEEP names, placeholder upload presented as production, secret-shaped data, or failed/skipped contract/mock/real gates. It prints exactly `PASS workstream-f final evidence` only when all checks pass.

- [ ] **Step 4: Run master procedure 11 on the physical target**

  ```bash
  scripts/bringup/resource-soak.sh run --origin https://127.0.0.1 --token-file /run/user/$UID/eduscope-test.token --duration 30m --interval 5s --evidence-dir "$EVIDENCE_DIR"
  scripts/bringup/resource-soak.sh verify --evidence-dir "$EVIDENCE_DIR"
  ```

  Expected: >=30% mean aggregate CPU idle, sustained configured output fps, no capture-disrupting thermal throttle, bounded queues/RSS, no record discontinuity, JPEG 480×270 at 0.8–1.2 Hz with no >3-second stale interval, and a successful question cycle. If JPEG load violates the resource ledger or any unchanged criterion fails, STOP: update A/E scope and the master F gate for review; do not lower the bar or reuse Workstream E's earlier exception silently.

- [ ] **Step 5: Run every final Phase-4 gate**

  ```bash
  cd services/pipeline-manager && .venv/bin/python -m pytest -q
  cd ../.. && pnpm --filter @eduscope/core-api gate:core-api
  cd services/ai && .venv/bin/python -m pytest -q
  cd ../.. && pnpm --filter @eduscope/quiz-service gate:d
  pnpm --filter @eduscope/api-client gate:dual
  pnpm gate:e
  pnpm test
  scripts/bringup/resource-soak.sh verify-all --workstream-dir docs/evidence/phase-4/workstream-f
  ```

  Expected, in order: A tests PASS; `PASS core-api gate`; C tests PASS; `PASS quiz-service gate`; dual mock/real gate PASS; Workstream E all-real and independent mock gates PASS; repository tests PASS; then `PASS workstream-f final evidence`. No unexpected skip or fixture-only physical witness is accepted.

- [ ] **Step 6: Audit exact fixed scope, ownership, KEEP coverage, and secrets**

  ```bash
  rg -n '^### Task F-' docs/plans/integration/workstream-f-device-bringup.md
  rg -n 'B-(03|05|07|10|15|23|27|28|39|50|53|56|59|60)' docs/evidence/phase-4/workstream-f
  rg -n 'sudo|generic\.exec|child_process\.exec\(|shell\s*=\s*True|shell:\s*true' services apps packages deploy scripts/bringup
  rg -n 'password|authorization|bearer|stream.?key|camera.*credential|participant.*(name|id)' docs/evidence/phase-4/workstream-f
  git diff --check
  ```

  Expected: exactly F-01..F-14 appear once and in order; F owns zero v1 operations/events; each of the fourteen assigned KEEP IDs has a non-template witness; the privilege scan contains no application violation; the evidence scan contains only documented redaction-policy field names, never a value; diff check is clean.

- [ ] **Step 7: Commit the final evidence gate**

  ```bash
  git add scripts/bringup/resource-soak.sh scripts/bringup/parse-resource-soak.py scripts/bringup/tests/test_resource_soak_evidence.py docs/evidence/phase-4/README.md docs/evidence/phase-4/workstream-f/f14
  git commit -m "test(device): close bring-up evidence gate"
  ```

  Expected: this is the final Workstream F commit; `git status --short` is empty after commit and the committed F-14 report says `PASS workstream-f final evidence`.

---

## Plan self-review checklist

- [ ] F-01 through F-14 appear exactly once, in master order, with no added or dropped task, v1 owner, or KEEP assignment.
- [ ] F-09..F-14 are the final plan tasks and map master procedures 1; 2–3; 4–5; 6; 7–10; 11 respectively, without substituting mocks for physical/campus evidence.
- [ ] Each task names exact files, starts with a red test, gives executable commands and expected outcomes, and ends in one commit.
- [ ] Mechanical units/configuration/wrapper contracts are complete enough to copy without an architectural choice; device-specific values come only from F-01's validated manifest.
- [ ] The 2026-09-08 master gate flag records every discovered contradiction: helper protocol/language, first-seed hardware/admin, relay candidate, mount/X11/build gaps, signed-updater STOP, JPEG-not-WebRTC F-14 load, and the corrected 86-operation/B-36 ownership audit.
- [ ] Contract counts and ownership remain unchanged by F: 86 REST operations total (83 core plus 3 quiz), 22 panel events, 5 retained preview compatibility messages, 4 device↔quiz messages, and 4 student events; F owns none.
- [ ] D-02b stays labelled `placeholder only / D-02b still open`; F-12 cannot execute without campus D-10/D-11; F-03–F-08 depend on completed F-02a; F-02b and production F-09 cannot pass without the reviewed signed updater/A-B layout.
- [ ] Demo/staging requires explicit acknowledgement, never flashes/repartitions/simulates A/B, disables firmware apply/rollback without installing a fake updater, displays the exact open-acceptance notice, and cannot produce F-02b/F-09/F-14 PASS evidence.
- [ ] Search this plan for placeholder prose and unresolved render markers; only quoted rejection criteria or manifest template tokens whose renderer is fully specified may remain.

  ```bash
  rg -n 'implement later|fill this|appropriate error|similar to Task|<TBC>|@[_A-Z]+@' docs/plans/integration/workstream-f-device-bringup.md
  ```

  Expected: no vague implementation placeholder; any match is an explicit rejection assertion or one of F-04/F-05's fully mapped render tokens.
