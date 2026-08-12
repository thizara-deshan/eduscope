# ADR-001 — On-device database: SQLite + Drizzle

- **Status:** Accepted
- **Date:** 2026-08-12
- **Deciders:** Tech lead / architect (owner per D-03)
- **Closes:** D-03 (On-device database) — `docs/discovery/open-decisions.md` §2

## Context

The core-api service needs a storage engine for the on-device appliance (Radxa
ROCK 5 ITX+, A-06 / ADR-003). The decision was tracked open as **D-03** with
three options on the table:

> *"(a) SQLite + Drizzle (recommended for appliance); (b) MySQL (`mysql2`);
> (c) Postgres."* — D-03, open-decisions register

The legacy system used MySQL with an implicit schema and raw SQL. The main
argument for carrying MySQL forward was migration of fielded devices — but the
PM confirmed **no fielded-device migration is needed** (no account or recording
migration from old devices, per A-21), which removed that argument. What remains
is a single-node, single-writer appliance workload where an embedded engine is
the simplest correct choice.

Owner and timing per the register:

> *"Who decides: tech lead / architect. Latest phase without rework: Phase 3 —
> the data-layer design and migration set are Phase-3 deliverables; the Phase-2
> frontend never sees the engine."*

This decision is being closed at the start of Phase 3, ahead of the
pipeline-manager and backend-service designs (Prompts 10–11) that consume it.

## Decision

**Adopt SQLite as the on-device database, accessed via Drizzle ORM** with an
explicit, versioned migration set. This replaces the legacy implicit MySQL schema
and its raw-SQL data layer.

## Consequences

### Positive
- **Zero operational surface** on the appliance — no separate DB server to
  install, supervise, secure, or back up; the database is a file on the device.
- **Matches the workload** — single-node, single-writer, embedded; SQLite is the
  canonical fit and removes the MySQL server from the resource budget on the board.
- **Explicit schema + migrations** (Drizzle) replace the legacy implicit schema,
  giving reviewable, versioned DDL and typed queries — this directly enables the
  parameterized-query rewrite (B-63) that closes the legacy raw-SQL risk.
- **Type-safe data layer** aligns with the TypeScript core-api stack.

### Negative / trade-offs
- **Single-writer concurrency.** Concurrent writers serialize; the core-api must
  funnel writes through one connection/WAL and treat long transactions carefully.
  Acceptable for a single-appliance workload; noted for the data-layer design.
- **No network DB access.** Nothing may reach the DB except the local core-api
  process — a constraint, and also a security benefit.
- **Scaling ceiling.** If a future product direction needs multi-node or a shared
  central database, this must be revisited. No such requirement exists today.

### Ripple — artifacts this touches (LIST ONLY; do not apply here)

These are Phase-3 design deliverables that do not exist yet; they must be authored
*on top of* this decision, not retro-edited. Contract-affecting items (none here —
the frontend never sees the engine) would route through Prompt 12; none apply.

- [ ] **core-api data-layer design** (Prompt 11 → `docs/design/core-api.md`):
      specify SQLite+Drizzle, WAL mode, and the single-writer transaction rule.
      Replaces matrix §3 "MySQL implicit schema + raw-SQL data layer" row; §5.2 item 9.
- [ ] **Explicit migration set** (Prompt 11): tables replacing the legacy implicit
      schema — `record_status`, `video_queue`, `settings`, `hdd_id`,
      `users`/`instituteusers`/`admins`, `indicators` (B-62).
- [ ] **Parameterized-query rewrite** (Prompt 11): all data access via Drizzle;
      no interpolated SQL (B-63, and the security baseline in
      `target-architecture.md` §3.8).
- [ ] **Persisted recording-session state** (Prompt 11): state that must survive
      restart — B-03, B-07, B-08 — schema'd in SQLite.
- [ ] **Upload job-queue schema** (Prompt 11): replaces `video_queue` status-string
      conventions — B-09, B-24, B-25. Coordinate with the upload adapter (A-19 /
      D-02b placeholder).

### Contract impact
**None.** The storage engine is entirely behind core-api; the Phase-2 frontend and
the `contracts/` layer never reference it. No `contracts/` change and no Prompt-12
drift item results from this decision.
