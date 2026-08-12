# ADR-021 — Student quiz platform & projector question flow

- **Status:** Accepted
- **Date:** 2026-08-12 (recorded); A-16 closed D-06
- **Deciders:** PM + institute + architect
- **Documents:** A-16 *(closed D-06)*, A-22 — `docs/discovery/open-decisions.md` §4

## Context

Two decisions define how quiz questions reach students and how answers come back.
They are recorded together because A-22 is the delivery mechanism for A-16.

- **A-16 — Student quiz platform:** *"Separate Next.js app on campus web server,
  public domain, QR join; basic login now, SSO later; leaderboard panel-only, never
  on projector."*
- **A-22 — Projector question flow:** *"Send-to-projector = overlay/switch from
  slides passthrough to question + join QR; simultaneously live on the quiz app.
  Leaderboard never on projector."*

Roster provenance for identity is D-21 → [ADR-012](ADR-012-quiz-roster-provenance.md).

## Decision

- **Quiz app** is a **separate Next.js app** hosted on a campus web server under a
  public domain (students may be on their own SIM data), joined by scanning the
  projector QR. **Basic login now, university SSO later.** Online/remote students
  answer too. **Leaderboard = student name + ID, shown in the panel UI only — never
  on the projector.**
- **Send-to-projector:** the projector consumer overlays/switches from slides
  passthrough to the **question + join QR**; simultaneously the question goes live on
  the quiz app for phones (in-room and online). **One "now showing"** (A-14).
- **Device ↔ quiz-server sync** must work across network zones.

## Consequences

### Positive
- Hosting off-device on the campus web server means remote students reach it without
  touching the appliance; the device only syncs question/answer state.
- Structural privacy: the projector never shows the leaderboard or any student
  identity; only own summaries reach a student (S-40/S-41).

### Negative / trade-offs
- Cross-zone device↔quiz-server sync is a real distributed-systems surface (the named
  likely-drift item) — reconnect/resync semantics must be robust (U-2/U-3, CG-22).
- Two deploy targets (device + campus web server) instead of one.

### Ripple (LIST ONLY)
- [ ] **Quiz service design** (Prompt 11 → `docs/design/quiz-service.md`): Next.js app,
      basic-login identity ([ADR-012](ADR-012-quiz-roster-provenance.md)), device↔server
      sync payload across zones.
- [ ] **Projector consumer** (Prompt 10): slides passthrough ↔ question+QR overlay;
      one now-showing; leaderboard never rendered.
- [ ] **Contract**: participant-authenticated student WS + atomic reconnect snapshot
      (CG-22…CG-25, already answered in screen-inventory §10) applied at Wave 7 / v0.6.

### Contract impact
**Substantial but already scoped.** The Wave-7 contract gaps (CG-1, CG-22…CG-25) carry
this; reconcile any device↔quiz-server sync drift at Prompt 12.
