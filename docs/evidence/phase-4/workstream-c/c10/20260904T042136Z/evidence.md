# Workstream C-10 AI Resource/Soak Evidence

Status: PASS

## Identity

- UTC start: 2026-09-04T04:21:37.483580+00:00
- Git commit: 38b66b68348588752878beb71d91af566be12b7d
- Board: Radxa ROCK 5 ITX
- Kernel: 6.1.0-1025-rockchip

## Duration and sampling

- Elapsed seconds: 5400
- Sample count: 91; largest gap: 60s

## Bounded resources

- STT queue depth peak: 5
- Peak RSS (KiB): {'stt': 5215312, 'slide': 115464, 'question': 58504, 'coreApi': 55220, 'pipelineManager': 52416}
- Post-warmup RSS growth (KiB): {'stt': 31548.0, 'slide': 11988.0, 'question': 260.0, 'coreApi': 0.0, 'pipelineManager': 104.0}

## Capture isolation

- Recording output bytes: 65800 -> 659316000
- Final ffprobe duration: 5615.907122s (>= 5390s required)
- Decode errors: 0

## Question round trips

- 2026-09-04T04:26:44.290626+00:00 -> 2026-09-04T04:26:59.331543+00:00: 15040ms (ready)
- 2026-09-04T04:47:26.709153+00:00 -> 2026-09-04T04:47:26.723181+00:00: 14ms (ready)
- 2026-09-04T05:07:56.164130+00:00 -> 2026-09-04T05:07:56.181991+00:00: 17ms (ready)
- 2026-09-04T05:28:38.594466+00:00 -> 2026-09-04T05:28:38.621748+00:00: 27ms (ready)
- threshold: 45,000 ms

## Gate result

- Parser result: PASS; failed assertions: none
- metadata: /opt/eduscope/docs/evidence/phase-4/workstream-c/c10/20260904T042136Z/metadata.json (sha256 7467f6ecafae4ec3998cdd22e0e7cb13ed55ce73534b6a34fe9e4b085acee6a3)
- metrics: /opt/eduscope/docs/evidence/phase-4/workstream-c/c10/20260904T042136Z/metrics.jsonl (sha256 db63b0cce9e441d3feea6d23a98774419367b8727dee690e9251f9c868ab95be)
- summary: /opt/eduscope/docs/evidence/phase-4/workstream-c/c10/20260904T042136Z/summary.json (sha256 388b21b89ebbd491e137965d287a08deab5c944b06c82253571dda03908b6dae)
