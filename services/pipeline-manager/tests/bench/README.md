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
- Camera/mic source bindings provisioned; recordings disk mounted; local
  nginx-RTMP relay running (A-16 only).
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

Runs only after A-15 passes on the same target commit. See
`scripts/bench/outputs.sh`, `scripts/bench/resource-ledger.sh`, and
`scripts/bench/webrtc.sh` (A-16) for the exact invocation once that task is
implemented; `evidence/a16-template.md` mirrors the same fill-in-from-the-
actual-run discipline.

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
