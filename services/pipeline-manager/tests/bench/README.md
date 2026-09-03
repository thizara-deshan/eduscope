# Workstream A bench gates (A-15, A-16)

These gates run only on the real RK3588 target with real GStreamer, real
source bindings, a mounted recordings disk, and the root helper (real or a
double) running. They are **not** exercised by `pytest -q` in this
repository — the parser/wrapper tests under this directory validate the
scripts' own mechanics (prerequisite checks, argument parsing, output
markers) against a faked service, never a real board.

## Prerequisites (A-15 and A-16)

- RK3588 target board, booted, with `services/pipeline-manager` installed
  and its Python environment ready.
- `curl`, `jq`, `ffprobe`, `stat`, `kill`, `awk` on `PATH`.
- Camera/mic source bindings provisioned (pushed by core-api via
  `PUT /publishers/{id}/binding`, or a bench double) and recordings disk mounted.
- **Local nginx-RTMP relay running (A-16 only).** Neither Workstream A (which
  never mutates nginx) nor the still-gated Workstream B stands this up — the
  bench operator / Workstream F must start it before A-16 (see the relay design,
  prompt 11). A-16's `ffprobe rtmp://127.0.0.1:1935/live/bench` check fails fast
  if it is absent.
- The root helper listening on `/run/eduscope/helper.sock` (real or a
  provisioned double honoring the fixed verb allowlist).
- `EDUSCOPE_PM_TOKEN` exported with the provisioned shared bearer token —
  never pass it as a command-line argument.

## A-15 — publishers and record EOS

```bash
cd /opt/eduscope/services/pipeline-manager
. .venv/bin/activate
export EDUSCOPE_PM_TOKEN='<provisioned shared token>'
python -m pipeline_manager.pipelines.preflight --platform rk3588 --include-webrtc
bash scripts/bench/publishers.sh http://127.0.0.1:8091
bash scripts/bench/record-eos.sh --base-url http://127.0.0.1:8091 \
  --output-dir /media/eduscope/recordings/bench/a15
```

Expected markers: `PASS A15-PUB warm publishers, sockets, isolated
restarts`, `PASS A15-REC warm-attach`, `PASS A15-REC camera-only`, `PASS
A15-REC targeted-eos`, `PASS A15-REC pause-resume-sync`, `PASS A15-REC
source-loss-placeholder`.

Copy `evidence/a15-template.md` to `evidence/a15-<YYYYMMDD>-<device>.md` and
fill it in from the actual run. No blank `PASS` rows: a row that did not run
stays `NOT RUN — gate failed`.

## A-16 — outputs and RK3588 resources

Runs only after A-15 passes on the same target commit, and requires the local
nginx-RTMP relay named above. Run `scripts/bench/outputs.sh`,
`scripts/bench/resource-ledger.sh`, verify the authenticated 1 Hz JPEG previews,
then run the manual HDMI-#2-mic and projector-latency procedures (plan A-16
Step 5). `webrtc.sh` is retained as a diagnostic only after the 2026-09-03
RK3588 JPEG-preview decision; it is not the production preview gate.
`evidence/a16-template.md` mirrors the same fill-in-from-the-actual-run
discipline.

The measured full-mix CPU result remains below the original 30% engineering
target. Proceeding is an explicitly documented capacity exception, not a PASS.
The supported interim classroom workload is record + meeting; do not infer that
the artificial all-output mix is qualified.

Approved target disposition (2026-09-03): the measured full-mix mean idle is
9.5778%. Record it as `APPROVED EXCEPTION — CPU HEADROOM`, retain the ≥30.00%
criterion, and never emit `PASS A16-RES` for that run. The supported interim
profile is record + meeting + the zero-encode-slot one-second JPEG previews.

The HDMI #2 receiver-microphone check and projector latency/mode measurements
are explicitly `DEFERRED — NOT PASS`. The receiver/projector measurement setup
is unavailable. Leave the corresponding evidence fields unrun; device presence,
pipeline health, or use of a separate screen does not prove either physical
result. A-16 therefore remains conditionally accepted/open for these physical
items rather than an unconditional gate PASS.

## Running the wrapper/parser tests (any host, no board needed)

```bash
cd services/pipeline-manager
. .venv/bin/activate  # or .venv\Scripts\Activate.ps1 on Windows
python -m pytest tests/bench -q
```

These substitute a small fake `curl`/`jq`/`ffprobe`/`stat`/`kill`/`sleep`
harness (`tests/bench/fakebin/`, wired in via `tests/bench/conftest.py`'s
`CURL=`/`JQ=`/... env-var overrides — the scripts default to the real tool
name when unset) so the scripts' prerequisite checks, argument parsing, and
output markers can be verified without any real service or hardware.

## Windows / non-board dev host

Beyond this bench directory, five unit tests are `skipif(sys.platform ==
"win32")` for genuinely POSIX-only behavior — targeted-EOS process-group
signals (`killpg`/`getpgid`), AF_UNIX socket files, and AF_UNIX asyncio in the
helper client. On Windows, `python -m pytest -q` is green at *N passed / 5
skipped*, not zero skips; those behaviors are verified for real only by the
A-15/A-16 board gates. Production code stays POSIX-correct for the RK3588
target.
