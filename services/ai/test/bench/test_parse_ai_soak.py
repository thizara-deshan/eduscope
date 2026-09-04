"""C-10 Step 1/2: failing-first tests for the independent soak-evidence parser.

`parse_ai_soak.py` is the sole acceptance authority for C-10 -- the soak
orchestrator (`scripts/bench/ai-soak.sh` / `live-cycle.py --run-soak`) only
produces the metrics.jsonl input; it never claims PASS itself. Each test
here builds a metrics.jsonl fixture (a healthy 90-minute baseline, then one
mutation per required failure mode) and asserts only the healthy fixture
exits 0 while every mutated fixture names its exact violated metric.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from parse_ai_soak import SERVICE_NAMES, evaluate_metrics, parse_jsonl

SCRIPT = Path(__file__).resolve().parent / "parse_ai_soak.py"
SAMPLE_INTERVAL_SEC = 60
DURATION_SEC = 5400
GENERATION_ELAPSED_SEC = (300, 1500, 2700, 3900)


def _service_block(rss_kib: int, *, queue_depth: int | None = None) -> dict:
    block = {"rssKiB": rss_kib}
    if queue_depth is not None:
        block["queueDepth"] = queue_depth
    return block


def healthy_rows() -> list[dict]:
    rows: list[dict] = []
    output_bytes = 0
    for elapsed in range(0, DURATION_SEC + 1, SAMPLE_INTERVAL_SEC):
        # RSS climbs gently during the 0-10 minute warmup then holds flat --
        # keeps the post-warmup-growth check comfortably under its 64 MiB budget.
        warmup_progress = min(elapsed, 600) / 600
        output_bytes += 65536
        rows.append(
            {
                "type": "sample",
                "elapsedSec": elapsed,
                "services": {
                    "stt": _service_block(1024 * 1024 + int(warmup_progress * 4096), queue_depth=3),
                    "slide": _service_block(256 * 1024 + int(warmup_progress * 2048)),
                    "question": _service_block(64 * 1024 + int(warmup_progress * 1024)),
                    "coreApi": _service_block(128 * 1024),
                    "pipelineManager": _service_block(96 * 1024),
                },
                "recording": {"state": "recording", "outputBytes": output_bytes},
                "record": {"state": "running"},
            }
        )
    for elapsed in GENERATION_ELAPSED_SEC:
        rows.append(
            {
                "type": "generation",
                "acceptedAt": f"2026-09-03T00:{elapsed // 60:02d}:{elapsed % 60:02d}+00:00",
                "terminalAt": f"2026-09-03T00:{elapsed // 60:02d}:{(elapsed % 60) + 20:02d}+00:00",
                "latencyMs": 20000,
                "outcome": "ready",
            }
        )
    rows.append({"type": "final", "ffprobeDurationSec": 5395.0, "decodeErrors": 0})
    return rows


def write_jsonl(path: Path, rows: list[dict | str]) -> Path:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(row if isinstance(row, str) else json.dumps(row))
            handle.write("\n")
    return path


def run_parser(metrics_path: Path, tmp_path: Path) -> subprocess.CompletedProcess:
    summary_path = tmp_path / "summary.json"
    template_path = tmp_path / "template.md"
    template_path.write_text(
        "# Evidence\n\nStatus: Not run — this file becomes evidence only when rendered from a passing metrics JSONL file.\n"
    )
    report_path = tmp_path / "evidence.md"
    return subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            str(metrics_path),
            "--output",
            str(summary_path),
            "--evidence-template",
            str(template_path),
            "--evidence-output",
            str(report_path),
        ],
        capture_output=True,
        text=True,
    )


def test_healthy_run_evaluates_to_pass() -> None:
    result = evaluate_metrics(healthy_rows())
    assert result.passed, result.failures
    assert result.failures == []


def test_healthy_run_cli_exits_zero_and_writes_evidence(tmp_path: Path) -> None:
    metrics_path = write_jsonl(tmp_path / "metrics.jsonl", healthy_rows())
    completed = run_parser(metrics_path, tmp_path)
    assert completed.returncode == 0, completed.stderr
    summary = json.loads((tmp_path / "summary.json").read_text())
    assert summary["passed"] is True
    assert summary["failures"] == []
    evidence = (tmp_path / "evidence.md").read_text()
    assert "PASS" in evidence


def test_short_run_fails_duration() -> None:
    rows = [row for row in healthy_rows() if not (row["type"] == "sample" and row["elapsedSec"] > 5340)]
    result = evaluate_metrics(rows)
    assert not result.passed
    assert any("5400" in failure or "duration" in failure for failure in result.failures)


def test_ring_depth_601_fails() -> None:
    rows = healthy_rows()
    rows[10]["services"]["stt"]["queueDepth"] = 601
    result = evaluate_metrics(rows)
    assert not result.passed
    assert any("queueDepth" in failure and "601" in failure for failure in result.failures)


def test_stt_rss_above_5gib_fails() -> None:
    rows = healthy_rows()
    rows[10]["services"]["stt"]["rssKiB"] = 5 * 1024 * 1024 + 1
    result = evaluate_metrics(rows)
    assert not result.passed
    assert any("stt" in failure and "rss" in failure.lower() for failure in result.failures)


def test_slide_rss_above_1gib_fails() -> None:
    rows = healthy_rows()
    rows[10]["services"]["slide"]["rssKiB"] = 1024 * 1024 + 1
    result = evaluate_metrics(rows)
    assert not result.passed
    assert any("slide" in failure and "rss" in failure.lower() for failure in result.failures)


def test_question_rss_above_256mib_fails() -> None:
    rows = healthy_rows()
    rows[10]["services"]["question"]["rssKiB"] = 256 * 1024 + 1
    result = evaluate_metrics(rows)
    assert not result.passed
    assert any("question" in failure and "rss" in failure.lower() for failure in result.failures)


def test_post_warmup_rss_growth_over_64mib_fails() -> None:
    rows = healthy_rows()
    last_sample = [row for row in rows if row["type"] == "sample"][-1]
    last_sample["services"]["stt"]["rssKiB"] += 65536 + 1
    result = evaluate_metrics(rows)
    assert not result.passed
    assert any("growth" in failure.lower() or "65536" in failure for failure in result.failures)


def test_record_state_not_recording_fails() -> None:
    rows = healthy_rows()
    rows[20]["recording"]["state"] = "paused"
    result = evaluate_metrics(rows)
    assert not result.passed
    assert any("recording" in failure.lower() and "state" in failure.lower() for failure in result.failures)


def test_record_output_not_growing_fails() -> None:
    rows = healthy_rows()
    samples = [row for row in rows if row["type"] == "sample"]
    samples[20]["recording"]["outputBytes"] = samples[19]["recording"]["outputBytes"]
    result = evaluate_metrics(rows)
    assert not result.passed
    assert any("grow" in failure.lower() for failure in result.failures)


def test_record_consumer_degraded_and_decode_errors_fails() -> None:
    rows = healthy_rows()
    rows[20]["record"]["state"] = "degraded"
    for row in rows:
        if row["type"] == "final":
            row["decodeErrors"] = 2
    result = evaluate_metrics(rows)
    assert not result.passed
    assert any("degraded" in failure.lower() for failure in result.failures)
    assert any("decode" in failure.lower() for failure in result.failures)


def test_question_latency_45001ms_fails() -> None:
    rows = healthy_rows()
    for row in rows:
        if row["type"] == "generation":
            row["latencyMs"] = 45001
            break
    result = evaluate_metrics(rows)
    assert not result.passed
    assert any("45001" in failure or "latency" in failure.lower() for failure in result.failures)


def test_missing_service_sample_fails() -> None:
    rows = healthy_rows()
    del rows[10]["services"]["question"]
    result = evaluate_metrics(rows)
    assert not result.passed
    assert any("question" in failure for failure in result.failures)


def test_malformed_row_fails(tmp_path: Path) -> None:
    rows: list[dict | str] = list(healthy_rows())
    rows.insert(5, "{not valid json")
    metrics_path = write_jsonl(tmp_path / "metrics.jsonl", rows)
    parsed_rows, malformed = parse_jsonl(metrics_path)
    assert malformed
    result = evaluate_metrics(parsed_rows, malformed_lines=malformed)
    assert not result.passed
    assert any("malformed" in failure.lower() for failure in result.failures)


def test_fewer_than_four_generation_samples_fails() -> None:
    rows = healthy_rows()
    for index, row in enumerate(rows):
        if row["type"] == "generation":
            del rows[index]
            break
    result = evaluate_metrics(rows)
    assert not result.passed
    assert any("generation" in failure.lower() for failure in result.failures)


def test_missing_final_row_fails() -> None:
    rows = [row for row in healthy_rows() if row["type"] != "final"]
    result = evaluate_metrics(rows)
    assert not result.passed
    assert any("final" in failure.lower() or "ffprobe" in failure.lower() for failure in result.failures)


@pytest.mark.parametrize("service_name", SERVICE_NAMES)
def test_all_service_names_covered_by_missing_data_check(service_name: str) -> None:
    rows = healthy_rows()
    del rows[10]["services"][service_name]
    result = evaluate_metrics(rows)
    assert not result.passed
    assert any(service_name in failure for failure in result.failures)
