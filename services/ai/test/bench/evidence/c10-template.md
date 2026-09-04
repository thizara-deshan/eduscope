# Workstream C-10 AI Resource/Soak Evidence

Status: Not run — this file becomes evidence only when rendered from a passing metrics JSONL file.

## Identity

- UTC start/end
- Git commit
- Board/kernel
- Service/model/prompt versions

## Duration and sampling

- Elapsed seconds
- Sample count and largest gap

## Bounded resources

- STT queue peak and dropped-block count
- STT/slide/question peak RSS
- Post-warmup RSS growth

## Capture isolation

- Recording state/output growth
- Final ffprobe duration
- Decode errors and pipeline degradation count

## Question round trips

- Acceptance and terminal timestamps
- Per-run latency and 45,000 ms threshold

## Gate result

- Parser result and failed assertions, if any
- Paths and SHA-256 hashes for metadata, metrics, and summary
