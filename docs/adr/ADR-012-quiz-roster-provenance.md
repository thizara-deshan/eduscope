# ADR-012 — Class-roster provenance for quiz identity & leaderboard: self-registration

- **Status:** Accepted
- **Date:** 2026-08-12
- **Deciders:** PM + institute (PM ratification 2026-08-12)
- **Closes:** D-21 (Class-roster provenance for quiz identity & leaderboard) — `docs/discovery/open-decisions.md` §2, §11

## Context

The leaderboard and per-student drill-down (A-16) need student names + IDs, and
their source was open:

> *"Where does the roster come from — the institute API (D-02b), quiz-app
> self-registration at first join, or manual import?"* — D-21, register

The Quiz App's basic-login-now / SSO-later model (A-16) must be designed against
*some* identity source. This is a Phase-3 quiz-service design decision:

> *"Latest phase without rework: Phase 3 — the Quiz App's identity model is a
> Phase-3 service design; self-registration now upgrades cleanly to SSO, but
> starting SSO-first later would rework onboarding."*

A related prerequisite, **SQO-1**, already resolved (2026-08-11): student-ID format
`^[A-Z]{2}[0-9]{7,8}$`, text input, max length 10 — applied with CG-1 in v0.6.0.

## Decision

**Quiz-app self-registration.** Students enter **name + student ID on first join**
(validated per SQO-1, no email verification). The **leaderboard keys on student ID**.
Roster import / university SSO is a **later upgrade that maps onto the same IDs**.
The panel mock continues simulating a roster. This couples to D-02b only if the
institute API later exposes enrollment.

## Consequences

### Positive
- Unblocks the Quiz App identity model without depending on the still-open institute
  API (D-02b) — students on their own SIM data can join and be identified.
- Student-ID keying means a later SSO/import upgrade maps cleanly onto existing rows;
  no onboarding rework (the cheap direction).
- Privacy stays structural (A-16): leaderboard is name + ID, panel-only, never on the
  projector.

### Negative / trade-offs
- **Self-asserted identity** — a student could mistype or spoof an ID. Acceptable for
  a classroom leaderboard (not an assessment of record); SQO-1 format validation
  reduces typos; SSO later hardens it.

### Ripple — artifacts this touches (LIST ONLY; do not apply here)
- [ ] **Quiz App account/data model** (Prompt 11, §5.2 item 2): self-registration
      identity keyed on student ID; upgrade path to SSO/import.
- [ ] **`LeaderboardPanel` / `StudentDetailDialog` / `NamesDialog`** data contract:
      keyed on student ID.
- [ ] **Device↔quiz-server sync payload**: confirm whether the device ever holds
      roster data (default: no — quiz server owns identity).
- [ ] Couples to D-02b/ADR-002 *only if* the institute API later exposes enrollment.

### Contract impact
**Already partly applied; reconcile remainder at Prompt 12.** SQO-1 landed via CG-1
in v0.6.0 (self-registration validation). Any leaderboard/detail contract shapes are
confirmed at the drift review. No new change applied now.
