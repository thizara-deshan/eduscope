# ADR-015 — Pipeline architecture & runtime

- **Status:** Accepted
- **Date:** 2026-08-12 (recorded); proven on the target board
- **Deciders:** Pipeline engineer + architect
- **Documents:** A-05, A-13 — `docs/discovery/open-decisions.md` §4

## Context

Two decisions define how media pipelines are built and what runs them:

- **A-05 — Pipeline architecture:** *"shm publisher/consumer decoupling + generated
  consumer pipelines (proven by `/scripts/bash` + `eduscope_web.py`)."*
- **A-13 — pipeline-manager language:** *"Python/FastAPI, evolved from
  `eduscope_web.py`."*

These replace the legacy 161-string GStreamer matrix and its global-kill switching
(B-01's 124-branch matrix, B-06 global kill, B-18 kill-and-restart) — see
`revamp-guide/reference/pipeline-audit.md`.

## Decision

- **shm publisher/consumer decoupling:** each source publishes once to shared memory;
  consumers (record / preview / live / meeting / projector) are **generated
  pipelines** subscribing to those sockets — `ratio_layout` layouts-as-data,
  H.264 passthrough for single-camera recordings.
- **pipeline-manager** is a **Python/FastAPI** service evolved from
  `eduscope_web.py`, carrying its supervision patterns (process-group SIGINT, pgrep
  orphan recovery, per-service errors).

## Consequences

### Positive
- One publisher per source removes duplicate captures and the global-kill blast
  radius; consumers start/stop independently (enables A-12 pause and per-channel control).
- Generated-from-data pipelines kill the 161-string matrix — the single biggest
  maintainability win of the revamp.
- Proven supervision patterns carry forward instead of being reinvented.

### Negative / trade-offs
- shm throughput and per-service supervision must be bench-validated on RK3588 (owned
  by the pipeline engineer) — a hard Phase-3 gate item.

### Ripple (LIST ONLY)
- [ ] **Pipeline-manager design** (Prompt 10 → `docs/design/pipeline-manager.md`):
      publishers/consumers, template builder, platform plug, supervision, internal API.
- [ ] Enforce `pipeline-audit.md` §4 consolidation; the 161-string matrix must not
      reappear.
- [ ] Security baseline (`target-architecture.md` §3.8): no interpolated shell, no
      sudo from app code.

### Contract impact
**None directly.** The pipeline-manager's internal API is device-internal; any
panel-visible source/pipeline status is reconciled at Prompt 12.
