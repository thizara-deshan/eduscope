# ADR-020 — On-device AI serving & question generation cadence

- **Status:** Accepted
- **Date:** 2026-08-12 (recorded)
- **Deciders:** Architect + pipeline engineer (AI infra) + PM (question format)
- **Documents:** A-02, A-14 — `docs/discovery/open-decisions.md` §4

## Context

Two decisions define the AI subsystem — the infrastructure and the product behavior:

- **A-02 — AI serving:** *"Self-hosted LLM on LAN (llama.cpp `/completion`); Vosk STT
  + Tesseract OCR on device; no cloud. STT pinned to the four A76 cores. RK3588 NPU
  optional later."*
- **A-14 — AI question format & cadence:** *"MCQ only; 10/15/20/30-min countdown
  (default 20); generate-now resets; batches of 3–5; one 'now showing'."*

## Decision

- **All AI runs on-device / on-LAN, no cloud:** a self-hosted LLM via llama.cpp
  `/completion`, **Vosk** STT (pinned to the four A76 cores), and **Tesseract** OCR.
  RK3588 NPU acceleration is a later optional optimization.
- **Questions are MCQ only**, generated on a **10/15/20/30-minute countdown**
  (default 20); **generate-now resets** the countdown; questions come in **batches of
  3–5**; **one "now showing"** at a time.

## Consequences

### Positive
- No student/lecture content leaves the campus network — a privacy and dependency win.
- Fixed MCQ format + one-now-showing keeps the projector/quiz flow (ADR-021) simple.

### Negative / trade-offs
- On-device inference competes for RK3588 resources with recording/streaming; the
  Vosk RAM + STT core pinning must be bench-validated against the encode-session
  budget (ADR-014) — a Phase-3 gate item.
- LLM quality is bounded by what runs on the board; question quality is a tuning task.

### Ripple (LIST ONLY)
- [ ] **AI services design** (Prompt 11 → `docs/design/ai-services.md`): llama.cpp
      plug, Vosk STT (A76 pinning), Tesseract OCR; resource budget vs. ADR-014.
- [ ] **Countdown/generation** state (10/15/20/30, default 20; generate-now reset;
      batch 3–5; one now-showing) — panel UI built in Wave 4; verify against contract.
- [ ] **llm-timeout** failure path already exercised in the mock; the real service
      must surface the same.

### Contract impact
**Possible — reconcile at Prompt 12.** Question/generation event shapes and the
llm-timeout `Problem['code']` confirmed at the drift review.
