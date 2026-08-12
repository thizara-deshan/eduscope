# ADR-018 — Live streaming path

- **Status:** Accepted
- **Date:** 2026-08-12 (recorded)
- **Deciders:** PM + pipeline engineer + architect
- **Documents:** A-10 — `docs/discovery/open-decisions.md` §4 (platform-list detail closed separately in [ADR-010](ADR-010-streaming-platform-list.md))

## Context

> **A-10 — Live streaming path:** *"RTMP via local nginx (+ stunnel4 for RTMPS).
> Launch platforms: YouTube + Facebook (others later). Preflight per
> `check_live.sh`."* — register

Platform choice carries infrastructure weight (Facebook needs the stunnel4 RTMPS
bridge, B-58). The *which platforms* detail is D-19 → [ADR-010](ADR-010-streaming-platform-list.md);
this ADR records the *transport path*.

## Decision

- **RTMP via a local nginx** relay, with **stunnel4** bridging RTMPS where a platform
  requires it.
- **Preflight** the stream before going live (successor to `check_live.sh`).
- Launch platforms per ADR-010 (YouTube + Facebook first-class + generic Custom RTMP).

## Consequences

### Positive
- A local relay decouples the encoder from platform endpoints; RTMPS handled by
  stunnel4 without per-platform encoder config.
- Preflight catches bad endpoints/keys before the lecturer is live.

### Negative / trade-offs
- nginx-rtmp + stunnel4 are out-of-repo configs that must be provisioned and
  version-controlled at the deploy layer (fact-check #1).

### Ripple (LIST ONLY)
- [ ] **Streaming relay design** (Prompt 11): nginx-rtmp + stunnel4; which platforms
      need RTMPS (§2a stream-control row).
- [ ] **Preflight** service (check_live.sh successor) validates endpoint/key incl.
      Custom RTMP.
- [ ] **Out-of-repo configs** (nginx site + rtmp conf, stunnel4) captured in the
      deploy layer (B-37/B-51/B-58/B-61 successors).

### Contract impact
**Possible — reconcile at Prompt 12.** Stream-control start/stop and preflight-result
shapes confirmed at the drift review.
