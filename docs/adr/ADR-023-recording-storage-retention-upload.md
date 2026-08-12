# ADR-023 — Recording storage, retention & upload architecture

- **Status:** Accepted
- **Date:** 2026-08-12 (recorded); A-19 closed half of D-02
- **Deciders:** PM + architect
- **Documents:** A-19 *(closed half of D-02)*, A-20 — `docs/discovery/open-decisions.md` §4

## Context

Two decisions govern the life of a recording after it is captured — where it lives,
who can act on it, and how it leaves the device:

- **A-20 — Recordings library rules:** *"Lecturers + admins play; only admins delete;
  auto-delete after 14 days."*
- **A-19 — Upload architecture:** *"Auto-upload to new institute API; pluggable
  adapter + resumable job queue against placeholder contract (D-02b)."*

The concrete upload *spec* stays open (D-02b → [ADR-002](ADR-002-upload-api-spec-deferral.md));
upload *timing* is D-13 → [ADR-006](ADR-006-upload-timing-policy.md); disk-pressure
retention is D-15 → [ADR-007](ADR-007-disk-pressure-retention.md). This ADR records
the storage/retention rules and the upload *architecture*.

## Decision

- **Library access:** lecturers + admins can play past recordings; **only admins
  delete**; storage **auto-deletes after 14 days** (disk-pressure exceptions per
  ADR-007).
- **Upload architecture:** recordings **auto-upload** to a new institute API via a
  **pluggable upload adapter** with a **resumable job queue** (`add → upload →
  complete`, dead-letter state), built against a placeholder contract until the spec
  lands (ADR-002). Timing is immediate (ADR-006).

## Consequences

### Positive
- Adapter + placeholder isolates the still-unknown institute spec to one component
  (the whole point of A-19); the queue lifecycle and failure states exist before the
  real API does (mock exercises success / mid-upload failure / dead-letter).
- Admin-only delete + 14-day auto-delete bounds on-device storage predictably.

### Negative / trade-offs
- The placeholder upload payload will differ from the real spec; reconciled at Prompt 12.
- 14-day retention + admin-only delete means a lecturer cannot free space themselves;
  intentional, paired with the disk-pressure policy (ADR-007).

### Ripple (LIST ONLY)
- [ ] **Upload job-queue + adapter design** (Prompt 11): resumable queue, dead-letter,
      pluggable adapter — matrix §3 upload row, §5.2 item 8. Coordinate schema with
      the DB decision ([ADR-001](ADR-001-on-device-database.md)).
- [ ] **Library service** (Prompt 11): play (lecturer+admin) / delete (admin-only) /
      14-day cleanup — matrix §1 FM row, §2c rows, §3 cleanup row.
- [ ] **Upload payload** confirmed when the institute spec lands (ADR-002 → Prompt 12).

### Contract impact
**Deferred to Prompt 12.** Placeholder upload elements carry the `[D-02b]` tag;
library play/delete shapes confirmed at the drift review.
