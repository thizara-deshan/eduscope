#!/usr/bin/env python3
"""C-10's independent acceptance authority for a soak-run metrics.jsonl file.

The soak orchestrator (`scripts/bench/ai-soak.sh` / `live-cycle.py
--run-soak`) only produces `metrics.jsonl`; it never claims PASS. This
module is the sole place that turns those recorded numbers into a verdict,
so `ai-soak.sh` composing incorrectly can never itself fabricate a pass.

Usage: parse_ai_soak.py INPUT_JSONL --output SUMMARY_JSON
       [--evidence-template TEMPLATE --evidence-output REPORT]
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from statistics import median

MIN_DURATION_SEC = 5400
MAX_SAMPLE_GAP_SEC = 90
MAX_STT_QUEUE_DEPTH = 600
MAX_STT_RSS_KIB = 5 * 1024 * 1024
MAX_SLIDE_RSS_KIB = 1024 * 1024
MAX_QUESTION_RSS_KIB = 256 * 1024
MAX_POST_WARMUP_GROWTH_KIB = 65536
WARMUP_WINDOW_SEC = (600, 900)
MIN_FFPROBE_DURATION_SEC = 5390
MAX_GENERATION_LATENCY_MS = 45000
MIN_GENERATION_SAMPLES = 4

SERVICE_NAMES = ("stt", "slide", "question", "coreApi", "pipelineManager")
SERVICE_RSS_LIMITS_KIB = {
    "stt": MAX_STT_RSS_KIB,
    "slide": MAX_SLIDE_RSS_KIB,
    "question": MAX_QUESTION_RSS_KIB,
}


@dataclass
class SoakResult:
    passed: bool
    failures: list[str] = field(default_factory=list)
    summary: dict = field(default_factory=dict)


def parse_jsonl(path: Path) -> tuple[list[dict], list[int]]:
    """Reads `path` line by line. Returns (parsed rows, 1-indexed malformed line numbers).

    A malformed line (invalid JSON, or valid JSON that isn't an object with a
    recognized "type") is never silently dropped from the result -- its line
    number is reported separately so `evaluate_metrics` can fail on it by name.
    """
    rows: list[dict] = []
    malformed: list[int] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            stripped = raw_line.strip()
            if not stripped:
                continue
            try:
                value = json.loads(stripped)
            except json.JSONDecodeError:
                malformed.append(line_number)
                continue
            if not isinstance(value, dict) or value.get("type") not in ("sample", "generation", "final"):
                malformed.append(line_number)
                continue
            rows.append(value)
    return rows, malformed


def evaluate_metrics(rows: list[dict], *, malformed_lines: list[int] | None = None) -> SoakResult:
    failures: list[str] = []
    for line_number in malformed_lines or []:
        failures.append(f"malformed row at line {line_number}: not a recognized JSON sample/generation/final object")

    samples = [row for row in rows if row["type"] == "sample"]
    generations = [row for row in rows if row["type"] == "generation"]
    finals = [row for row in rows if row["type"] == "final"]

    _evaluate_samples(samples, failures)
    _evaluate_generations(generations, failures)
    _evaluate_final(finals, failures)

    summary = {
        "sampleCount": len(samples),
        "generationCount": len(generations),
        "durationSec": samples[-1]["elapsedSec"] if samples else 0,
        "largestSampleGapSec": _largest_gap(samples),
        "sttQueueDepthPeak": _peak(samples, "stt", "queueDepth"),
        "peakRssKiB": {name: _peak(samples, name, "rssKiB") for name in SERVICE_NAMES},
        "postWarmupGrowthKiB": _post_warmup_growth(samples),
        "recordingOutputBytesStartEnd": _output_bytes_bounds(samples),
        "final": finals[-1] if finals else None,
        "generations": generations,
    }
    return SoakResult(passed=not failures, failures=failures, summary=summary)


def _largest_gap(samples: list[dict]) -> int:
    elapsed = [s["elapsedSec"] for s in samples]
    return max((b - a for a, b in zip(elapsed, elapsed[1:])), default=0)


def _peak(samples: list[dict], service: str, field_name: str) -> int | None:
    values = [s["services"][service][field_name] for s in samples if field_name in s.get("services", {}).get(service, {})]
    return max(values) if values else None


def _post_warmup_growth(samples: list[dict]) -> dict[str, float | None]:
    warmup_start, warmup_end = WARMUP_WINDOW_SEC
    warmup_samples = [s for s in samples if warmup_start <= s["elapsedSec"] <= warmup_end]
    final_services = samples[-1].get("services", {}) if samples else {}
    growth: dict[str, float | None] = {}
    for name in SERVICE_NAMES:
        warmup_values = [s["services"][name]["rssKiB"] for s in warmup_samples if "rssKiB" in s.get("services", {}).get(name, {})]
        final_block = final_services.get(name, {})
        if warmup_values and "rssKiB" in final_block:
            growth[name] = final_block["rssKiB"] - median(warmup_values)
        else:
            growth[name] = None
    return growth


def _output_bytes_bounds(samples: list[dict]) -> dict[str, int | None]:
    bytes_values = [s["recording"]["outputBytes"] for s in samples if s.get("recording", {}).get("outputBytes") is not None]
    return {"start": bytes_values[0] if bytes_values else None, "end": bytes_values[-1] if bytes_values else None}


def _evaluate_samples(samples: list[dict], failures: list[str]) -> None:
    if not samples:
        failures.append("no sample rows present: duration and resource bounds cannot be verified")
        return

    last_elapsed = samples[-1]["elapsedSec"]
    if last_elapsed < MIN_DURATION_SEC:
        failures.append(f"run duration {last_elapsed}s is below the required {MIN_DURATION_SEC}s (90 minutes)")

    previous_elapsed: int | None = None
    for sample in samples:
        elapsed = sample["elapsedSec"]
        if previous_elapsed is not None:
            gap = elapsed - previous_elapsed
            if gap > MAX_SAMPLE_GAP_SEC:
                failures.append(f"sample gap of {gap}s between elapsed {previous_elapsed}s and {elapsed}s exceeds {MAX_SAMPLE_GAP_SEC}s")
        previous_elapsed = elapsed

    previous_output_bytes: int | None = None
    for sample in samples:
        elapsed = sample["elapsedSec"]
        services = sample.get("services")
        if services is None:
            failures.append(f"sample at elapsed {elapsed}s missing services block")
            services = {}
        for name in SERVICE_NAMES:
            if name not in services:
                failures.append(f"sample at elapsed {elapsed}s missing {name} service data")

        stt = services.get("stt")
        if stt is not None:
            queue_depth = stt.get("queueDepth")
            if queue_depth is not None and queue_depth > MAX_STT_QUEUE_DEPTH:
                failures.append(f"stt.queueDepth {queue_depth} exceeds {MAX_STT_QUEUE_DEPTH} at elapsed {elapsed}s")

        for name, limit_kib in SERVICE_RSS_LIMITS_KIB.items():
            block = services.get(name)
            if block is None:
                continue
            rss_kib = block.get("rssKiB")
            if rss_kib is not None and rss_kib > limit_kib:
                failures.append(f"{name}.rssKiB {rss_kib} exceeds the {limit_kib} KiB limit at elapsed {elapsed}s")

        recording = sample.get("recording")
        if recording is not None:
            state = recording.get("state")
            if state != "recording":
                failures.append(f"recording state was {state!r} (expected 'recording') at elapsed {elapsed}s")
            output_bytes = recording.get("outputBytes")
            if output_bytes is not None:
                if previous_output_bytes is not None and output_bytes <= previous_output_bytes:
                    failures.append(f"recording output did not grow between samples (elapsed {elapsed}s: {output_bytes} <= {previous_output_bytes})")
                previous_output_bytes = output_bytes

        record = sample.get("record")
        if record is not None and record.get("state") in ("degraded", "failed"):
            failures.append(f"pipeline record consumer reported {record['state']} at elapsed {elapsed}s")

    _evaluate_post_warmup_growth(samples, failures)


def _evaluate_post_warmup_growth(samples: list[dict], failures: list[str]) -> None:
    warmup_start, warmup_end = WARMUP_WINDOW_SEC
    warmup_samples = [s for s in samples if warmup_start <= s["elapsedSec"] <= warmup_end]
    if not warmup_samples:
        failures.append(f"no samples between {warmup_start}s and {warmup_end}s to baseline post-warmup RSS growth")
        return

    final_services = samples[-1].get("services", {})
    for name in SERVICE_NAMES:
        warmup_values = [
            s["services"][name]["rssKiB"]
            for s in warmup_samples
            if name in s.get("services", {}) and "rssKiB" in s["services"][name]
        ]
        if not warmup_values:
            continue
        final_block = final_services.get(name)
        if final_block is None or "rssKiB" not in final_block:
            continue
        warmup_median = median(warmup_values)
        growth = final_block["rssKiB"] - warmup_median
        if growth > MAX_POST_WARMUP_GROWTH_KIB:
            failures.append(
                f"{name} RSS grew {growth:.0f} KiB past its warmup (minutes 10-15) median, "
                f"exceeding the {MAX_POST_WARMUP_GROWTH_KIB} KiB budget"
            )


def _evaluate_generations(generations: list[dict], failures: list[str]) -> None:
    if len(generations) < MIN_GENERATION_SAMPLES:
        failures.append(f"only {len(generations)} generation round-trip samples recorded, need at least {MIN_GENERATION_SAMPLES}")
    for generation in generations:
        latency_ms = generation.get("latencyMs")
        if latency_ms is not None and latency_ms > MAX_GENERATION_LATENCY_MS:
            failures.append(f"generation latency {latency_ms}ms exceeds the {MAX_GENERATION_LATENCY_MS}ms budget")


def _evaluate_final(finals: list[dict], failures: list[str]) -> None:
    if not finals:
        failures.append("no final row present: ffprobe duration and decode-error validation cannot be verified")
        return
    final = finals[-1]
    duration_sec = final.get("ffprobeDurationSec")
    if duration_sec is None or duration_sec < MIN_FFPROBE_DURATION_SEC:
        failures.append(f"final ffprobe duration {duration_sec}s is below the required {MIN_FFPROBE_DURATION_SEC}s")
    decode_errors = final.get("decodeErrors")
    if decode_errors is None or decode_errors != 0:
        failures.append(f"final decode error count is {decode_errors} (must be exactly 0)")


NOT_RUN_STATUS_LINE = "Status: Not run — this file becomes evidence only when rendered from a passing metrics JSONL file."


def _sha256(path: Path) -> str | None:
    if not path.exists():
        return None
    import hashlib

    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def render_evidence(template_text: str, result: SoakResult, *, metadata: dict | None = None, artifact_paths: dict[str, Path] | None = None) -> str:
    """Fills every section from `result.summary` (computed purely from the
    metrics.jsonl the parser was given) plus an optional sibling
    `metadata.json` (identity fields the orchestrator, not the parser,
    recorded -- parse_ai_soak.py's CLI signature per C-10 Step 3 takes no
    extra arguments for it, so this stays opportunistic, never required)."""
    status_line = "Status: PASS" if result.passed else "Status: FAIL — " + "; ".join(result.failures)
    if NOT_RUN_STATUS_LINE not in template_text:
        raise ValueError("evidence template is missing the expected 'Not run' status line")
    text = template_text.replace(NOT_RUN_STATUS_LINE, status_line)

    summary = result.summary
    metadata = metadata or {}

    identity_lines = "\n".join(
        f"- {label}: {metadata.get(key, 'unavailable (no sibling metadata.json)')}"
        for label, key in (
            ("UTC start", "startedAtUtc"),
            ("Git commit", "gitCommit"),
            ("Board", "boardModel"),
            ("Kernel", "kernel"),
        )
    )
    text = text.replace(
        "## Identity\n\n- UTC start/end\n- Git commit\n- Board/kernel\n- Service/model/prompt versions",
        f"## Identity\n\n{identity_lines}",
    )

    text = text.replace(
        "## Duration and sampling\n\n- Elapsed seconds\n- Sample count and largest gap",
        "## Duration and sampling\n\n"
        f"- Elapsed seconds: {summary.get('durationSec')}\n"
        f"- Sample count: {summary.get('sampleCount')}; largest gap: {summary.get('largestSampleGapSec')}s",
    )

    peak_rss = summary.get("peakRssKiB", {})
    growth = summary.get("postWarmupGrowthKiB", {})
    text = text.replace(
        "## Bounded resources\n\n- STT queue peak and dropped-block count\n- STT/slide/question peak RSS\n- Post-warmup RSS growth",
        "## Bounded resources\n\n"
        f"- STT queue depth peak: {summary.get('sttQueueDepthPeak')}\n"
        f"- Peak RSS (KiB): {peak_rss}\n"
        f"- Post-warmup RSS growth (KiB): {growth}",
    )

    final = summary.get("final") or {}
    output_bounds = summary.get("recordingOutputBytesStartEnd", {})
    text = text.replace(
        "## Capture isolation\n\n- Recording state/output growth\n- Final ffprobe duration\n- Decode errors and pipeline degradation count",
        "## Capture isolation\n\n"
        f"- Recording output bytes: {output_bounds.get('start')} -> {output_bounds.get('end')}\n"
        f"- Final ffprobe duration: {final.get('ffprobeDurationSec')}s (>= 5390s required)\n"
        f"- Decode errors: {final.get('decodeErrors')}",
    )

    generation_lines = "\n".join(
        f"- {g['acceptedAt']} -> {g['terminalAt']}: {g['latencyMs']}ms ({g['outcome']})"
        for g in summary.get("generations", [])
    ) or "- none recorded"
    text = text.replace(
        "## Question round trips\n\n- Acceptance and terminal timestamps\n- Per-run latency and 45,000 ms threshold",
        f"## Question round trips\n\n{generation_lines}\n- threshold: 45,000 ms",
    )

    artifact_paths = artifact_paths or {}
    artifact_lines = "\n".join(
        f"- {name}: {path} (sha256 {_sha256(path) or 'unavailable'})" for name, path in artifact_paths.items()
    ) or "- artifact paths not provided to this render"
    failures_text = "; ".join(result.failures) if result.failures else "none"
    text = text.replace(
        "## Gate result\n\n- Parser result and failed assertions, if any\n- Paths and SHA-256 hashes for metadata, metrics, and summary",
        f"## Gate result\n\n- Parser result: {'PASS' if result.passed else 'FAIL'}; failed assertions: {failures_text}\n{artifact_lines}",
    )

    return text


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_jsonl", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--evidence-template", type=Path, default=None)
    parser.add_argument("--evidence-output", type=Path, default=None)
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    rows, malformed = parse_jsonl(args.input_jsonl)
    result = evaluate_metrics(rows, malformed_lines=malformed)

    args.output.write_text(
        json.dumps({"passed": result.passed, "failures": result.failures, "summary": result.summary}, indent=2, sort_keys=True) + "\n"
    )

    if args.evidence_template is not None and args.evidence_output is not None:
        template_text = args.evidence_template.read_text()
        metadata_path = args.input_jsonl.parent / "metadata.json"
        metadata = json.loads(metadata_path.read_text()) if metadata_path.exists() else None
        artifact_paths = {"metadata": metadata_path, "metrics": args.input_jsonl, "summary": args.output}
        args.evidence_output.write_text(render_evidence(template_text, result, metadata=metadata, artifact_paths=artifact_paths))

    if not result.passed:
        for failure in result.failures:
            print(failure, file=sys.stderr)
    return 0 if result.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
