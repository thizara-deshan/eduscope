# ADR-002 — Institute upload API: architecture accepted, spec deferred (placeholder contract)

- **Status:** Deferred (architecture Accepted via A-19; concrete spec pending institute)
- **Date:** 2026-08-12
- **Deciders:** Institute (spec owner); PM negotiates and accepts. Architect records the deferral.
- **Documents:** D-02b (Upload API specification) — `docs/discovery/open-decisions.md` §2
- **Revisit by:** **Phase 4** (real upload adapter implementation)

## Context

The upload *architecture* is already decided (A-19): recordings auto-upload to a
new institute API via a **pluggable adapter with a resumable job queue**, built
against a placeholder contract so only the adapter changes when the real spec
lands. What remains open is **D-02b — the concrete request/response contract**:

> *"exact request/response contract of the new institute upload API (metadata
> fields, auth, resumability, error semantics)."* — D-02b, register

This cannot be closed now because the input does not exist:

> *"Who decides: the institute (spec owner); PM negotiates and accepts. Latest
> phase without rework: Phase 4 — the adapter pattern (A-19) was chosen precisely
> so only the adapter changes."*

This ADR records the **deferral and the default the project proceeds on**, so the
gap is deliberate and documented rather than silently open.

## Decision

**Proceed on the placeholder upload contract; defer the real spec to Phase 4.**

The placeholder payload = generated title (A-07), hall code, start/end timestamps,
duration, and a segment/stream manifest, delivered via a **resumable multipart
upload** with an `add → upload → complete` lifecycle and a **dead-letter** state.
The Phase-2 mock adapter simulates success, mid-upload failure, and dead-letter.
The real institute spec is absorbed **only in the Phase-4 adapter**, and any
contract delta is routed through the Prompt-12 drift review, not decided here.

## Consequences

### Positive
- Phase-2 frontend and Phase-3 backend design proceed unblocked; the blast radius
  of the unknown spec is contained to one adapter (A-19's whole purpose).
- Failure semantics (mid-upload failure, dead-letter) are already exercised in the
  mock, so the UI for them exists before the real API does.

### Negative / trade-offs
- **The placeholder will be wrong in detail.** Metadata mapping, auth, and error
  semantics may differ; the Prompt-12 drift review must reconcile them.
- **Schedule dependency on a third party.** If the spec lands after Phase-4
  integration starts, the real adapter slips the end-to-end gate — flagged, not
  owned by us.

### Ripple — artifacts this touches (LIST ONLY; do not apply here)

Resolved only when the institute spec lands; then routed through Prompt 12.

- [ ] **Real upload adapter** (Phase 4) — matrix §3 "Scheduled upload pipeline";
      §5.2 item 8 (resumable job queue + pluggable adapter).
- [ ] **Title/metadata mapping** — B-02, B-24 (add→upload→complete + delete-on-failure),
      B-25 (one-lecture-per-recording incl. `~2~cmb` gap), B-26 (institution-profile
      switch), B-28 (dead-letter naming/surfacing).
- [ ] **Institute roster sync source** — B-21, B-40, matrix §3 "Institute user sync
      cron", §5.1 item 11. Feeds D-21 leaderboard drill-down *if* the API exposes enrollment.
- [ ] **Module-id question** — matrix §2f `sdmodules` veto (server-side mapping needed
      only if the new API requires module ids).
- [ ] **Upload-queue status view** — §5.1 item 2 (metadata columns; layout already proceeds).

### Contract impact
**Deferred to Prompt 12.** The placeholder upload elements in `contracts/` carry the
`[D-02b]` tag; each is confirmed or amended at the drift review when the spec arrives.
No change now.
