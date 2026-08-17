# Workstream A — Pipeline Manager: Execution Summary

> Companion to [`workstream-a-pipeline-manager.md`](./workstream-a-pipeline-manager.md).
> Branch: `sonnet5/workstream-a-pipeline-manager` (forked from `main` at `685ac23`).
> Executed with the `executing-plans` skill, task by task, one commit per task, tests green before each commit.

## Status at a glance

| | |
|---|---|
| Tasks planned | 16 (A-01 – A-16) |
| Tasks fully closed | 14 (A-01 – A-14) |
| Tasks code-complete, gate open | 2 (A-15, A-16 — see [Hardware gate](#hardware-gate-not-closed)) |
| Commits | 17 (16 task commits + 1 mid-flight correction) |
| Python tests | 429 passed, 5 skipped (all POSIX-only, verified-on-target) |
| TypeScript tests | 296 passed (`@eduscope/api-client`) + 29 passed (`@eduscope/shared`) |
| Forbidden-pattern scan (`sudo`, `killall`, `pkill`, `shell=True`, `create_subprocess_shell`) | Clean — zero matches in `src/` |

## What got built

A localhost-only FastAPI service (`services/pipeline-manager`) that supervises GStreamer publishers/consumers for the RK3588 capture box, replacing the legacy 161-string `gst-launch` matrix with a typed builder.

| Task | Delivered |
|---|---|
| A-01 | Typed service shell — `Settings`, canonical enums, `create_app()`, public `/healthz`, localhost-bind enforcement |
| A-02 | `PlatformProfile` protocol + `RK3588Profile` (the only module allowed to name RK3588 GStreamer elements) + argv-only `PreflightRunner` |
| A-03 | One shared even-16:9 layout catalog (`packages/shared/src/constants/layout-presets.json`) consumed by both the mock and a generated Python resource; `layouts.py`/`profiles.py` |
| A-04 | `PipelineBuilder` (token-only, `shell=False`) + `build_record` — composite/passthrough/separate-files branches, golden-tested against tokenized legacy `.sh` oracles |
| A-05 | `build_live` / `build_meeting`, reusing A-04's source/compose helpers, also golden-tested against oracles |
| A-06 | Projector (mode switch via control message, never a restart), atomic snapshot (temp-file + `os.replace`), and the thumbnail worker's typed offer/ice/close protocol (no `gi` import at module load) |
| A-07 | `ProcessSupervisor` (argv-only spawn, bus-message parsing), `HealthConfirmer` (PLAYING+growth), `EncodeLedger` (2 guaranteed + 1 provisional slot) |
| A-08 | Targeted EOS stop with SIGKILL escalation, sidecar-based conservative orphan adoption (never a broad-pattern kill) |
| A-09 | Four `PublisherController`s — 1s/3s/8s restart backoff, 6s telemetry staleness → `unknown` |
| A-10 | `RecordConsumer` lifecycle — readiness refusal, confirm, pause/stop, unexpected-exit restart budget, never writes `LectureSession` state |
| A-11 | `LiveConsumer`/`MeetingConsumer`/`ProjectorConsumer`/`SnapshotConsumer`/`ThumbnailController` — isolated restart classes, verified via real sibling-process isolation |
| A-12 | `apply_audio_control` (argv-only `amixer`, readback-not-echo) + `AudioLevelSampler` (≤10 Hz, reference-counted) |
| A-13 | `HelperClient` (schema-validated, fixed-verb allowlist), `LedController` (pure function of recording state), `CaptureCardWatchdog` (2-miss/2-cycle-per-hour policy) |
| A-14 | Full internal route surface, bearer auth (`secrets.compare_digest`), exact Problem-shaped error taxonomy, sequenced/replayable SSE with per-subscriber overflow isolation |
| A-15 | `publishers.sh` / `record-eos.sh` + fake-binary parser tests — **scripts done, board run not executed** |
| A-16 | `outputs.sh` / `resource-ledger.sh` / `webrtc.sh` + fake-binary parser tests — **scripts done, board run not executed** |

## Notable mid-flight discoveries

1. **`separate-files` audio routing bug in shipped seed data** (found during A-04). The proven oracle (`rec_usb_cam1_separate.sh`) embeds audio in the USB/presentation file; the already-shipped mock catalog had `includeAudio` on the *camera* file instead. Fixed in a dedicated commit (`1b0cc02`) after explicit user confirmation to follow the oracle, with the dependent contract test updated to match.
2. **Cross-platform dev-host accommodations.** This branch was authored on Windows (no POSIX process groups, no `os.killpg`/`os.getpgid`, no `AF_UNIX` socket support in this Python build, no `jq` installed). Every production code path stays POSIX-correct for the RK3588 target; five tests are explicitly `skipif(sys.platform == "win32", ...)` for behavior that is genuinely unverifiable off real POSIX (documented per-test, not silently skipped).
3. **Bench-script testability without a board.** `tests/bench/fakebin/` is a small fake `curl`/`jq`/`ffprobe`/`stat`/`kill`/`sleep` harness (env-var-overridable per tool, since MSYS bash always prepends its own `/mingw64/bin:/usr/bin` ahead of any `$PATH` override). It proves the wrapper scripts' prerequisite checks, argument parsing, threshold math, and token-never-printed discipline — not a full stateful simulation of a 300-second board run.

## Hardware gate: not closed

Per the master plan's binding rule, **A-15 and A-16 are board-only verification tasks** — they require a real RK3588 target, live camera/mic bindings, a mounted recordings disk, HDMI outputs, and a running local RTMP relay. None of that exists in this environment.

- `tests/bench/evidence/a15-template.md` and `a16-template.md` are committed **unfilled** (`NOT RUN — gate failed` in every row) rather than fabricated.
- The master plan's own instruction is explicit: *"Stop Workstream A after this [A-16] commit; Workstream B may begin only after the gate acknowledges the A-03 correction and accepts both hardware evidence records."*
- **Next step for whoever has board access:** follow `services/pipeline-manager/tests/bench/README.md` — run `publishers.sh` + `record-eos.sh` (A-15), then `outputs.sh` + `resource-ledger.sh` + `webrtc.sh` plus the manual HDMI-mic/projector-latency procedures (A-16) — and fill both evidence files for real.

## How to verify this branch yourself

```bash
cd services/pipeline-manager
python -m venv .venv && . .venv/bin/activate  # or .venv\Scripts\Activate.ps1 on Windows
python -m pip install -e '.[dev]'
python -m pytest -q

cd ../..
pnpm --filter @eduscope/shared test
pnpm --filter @eduscope/api-client test
```

All three should exit 0 (Python: 429 passed / 5 skipped; the two `pnpm` suites: 29 and 296 passed respectively).

## Post-review gap resolution (2026-08-18)

A review of the plan against the code as built surfaced eight specification gaps. They are resolved **specification-only** (plan + `pipeline-manager.md` + bench README + master-plan gate flag); no production code changed in that pass. Full index: `workstream-a-pipeline-manager.md` § Review addendum — gap resolutions.

- **Already correct in code, now documented:** the static board-device `Settings` fields (`mic_alsa_*`, `hdmi2_alsa_device`, `capture_card_*`, `led_present`) and the `GET /sources` projection — neither was a code gap; the plan just hadn't listed them.
- **Design decision taken (with review sign-off):** the camera **binding ingress** is an internal `PUT /publishers/{id}/binding` route — core-api pushes it (`cmd.admin.set_binding`, HL-09), keeping credentials off the box. Flagged to the Workstream A gate as an internal-contract addition.
- **Documented prerequisites/limits:** POSIX-only dev-host test tiers (5 `skipif(win32)`), the A-16 nginx-RTMP relay prerequisite (operator/F-owned), the encode-ledger "only record/live/thumbnail reserve slots" invariant, and the board-less "14/16 closed, gate open" terminal state.

**Still-open implementation items (board bring-up / Workstream F — tracked, not silently missing):** the `PUT /publishers/{id}/binding` route + `bind()` wiring, the FastAPI lifespan (orphan recovery + publisher/watchdog start + shutdown ordering + sidecar flush), `preflight_check` wiring, and real spawning behind the current `202` stubs on publisher-start / thumbnails / snapshot-stop. `create_app` wires state only today; these are the natural content of the A-15/A-16 board runs.
