# ADR-013 — Programme: migration strategy, scope, and method

- **Status:** Accepted
- **Date:** 2026-08-12 (recorded); decisions taken at project inception
- **Deciders:** Architect + client (per client requirement on sequencing)
- **Documents:** A-01, A-03, A-04 — `revamp-guide/reference/open-decisions.md` §Decided; `docs/discovery/open-decisions.md` §4

## Context

Three programme-level decisions frame the whole revamp and were carried in the
seed register as decided:

- **A-01 — Migration strategy:** *"Layered rewrite (Option C) with frontend-first
  sequencing per client requirement."*
- **A-03 — Scope:** *"Full rewrite of all legacy features + new AI/quiz features;
  room controls UI mock-only (D-10)."*
- **A-04 — Guide format:** *"Markdown phase docs + ordered prompt library in
  `/revamp-guide`."*

They are recorded together because they answer one question — *how the project is
run* — rather than any single technical detail.

## Decision

- **Layered rewrite, frontend-first** (Option C): rebuild the system in layers, UI
  before hardware/pipeline finalization, made safe by the contract-first + swappable
  data-layer guardrails (see `revamp-guide/00-overview.md`).
- **Full-feature scope** plus the new AI question and student-quiz capabilities;
  room-controls UI ships mock-only ([ADR-004](ADR-004-room-controls-hardware-deferral.md)).
- **Phase-doc + ordered-prompt** working method; one prompt = one fresh chat, state
  on disk, approval gates between phases.

## Consequences

### Positive
- Frontend-first satisfies the client constraint while the adapter contains the risk
  of not-yet-final hardware/upload decisions.
- Explicit scope prevents silent feature loss vs. legacy (parity matrix tracks it).

### Negative / trade-offs
- Some contract guesses made before hardware will be wrong; reconciled at the
  Prompt-12 drift review (accepted cost of the sequencing).

### Ripple (LIST ONLY)
- [ ] None outstanding — these are governance decisions already embodied in the
      phase docs and the prompt library. The scope decision's room-controls mock-only
      clause is tracked by ADR-004.

### Contract impact
**None.**
