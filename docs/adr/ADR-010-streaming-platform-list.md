# ADR-010 — Streaming platform list: YouTube + Facebook + generic Custom RTMP

- **Status:** Accepted
- **Date:** 2026-08-12
- **Deciders:** PM (PM ratification 2026-08-12)
- **Closes:** D-19 (Streaming platform list) — `docs/discovery/open-decisions.md` §2, §11

## Context

Three platform lists needed reconciling:

> *"legacy flags (Facebook/YouTube/Twitter/LinkedIn, B-59), A-10's launch set
> (YouTube + Facebook, 'others later'), and the prototype's picker (Twitch + Custom
> RTMP among them)."* — D-19, register

Platform choice has infrastructure weight: Facebook URLs need the stunnel4 RTMPS
bridge (B-58). The decision sets the `StreamingConfig` picker contents and the
relay design:

> *"Latest phase without rework: Phase 2 — it's the picker's contents; adding a
> generic Custom RTMP now makes later platform additions config, not rework."*

## Decision

**YouTube + Facebook as first-class options** (per A-10), plus **one generic Custom
RTMP entry** (URL + key) that covers Twitch / LinkedIn / anything else without
per-platform code. **No Twitter/LinkedIn tiles.**

## Consequences

### Positive
- Covers every other platform through Custom RTMP without bespoke integrations —
  future additions become configuration, not code.
- Keeps the RTMPS bridging surface (stunnel4, B-58) scoped to the two named
  first-class platforms plus a documented custom path.

### Negative / trade-offs
- Custom RTMP shifts correctness (URL/key/RTMPS choice) onto the operator; preflight
  (`check_live.sh` successor) should validate the custom endpoint before going live.

### Ripple — artifacts this touches (LIST ONLY; do not apply here)
- [ ] **`admin/pages/StreamingConfig.tsx`** picker contents (Phase 2): YouTube,
      Facebook, Custom RTMP.
- [ ] **Streaming relay design** (Prompt 11): which platforms need RTMPS bridging —
      §2a stream-control row; Custom RTMP must allow RTMP or RTMPS.
- [ ] **Saved-config schema** in core-api: platform enum + custom URL/key fields.

### Contract impact
**Possible — reconcile at Prompt 12.** If the streaming config is contract-visible,
the platform enum (`youtube | facebook | custom_rtmp`) and custom fields are
confirmed at the drift review. No change applied now.
