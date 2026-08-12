# ADR-011 — Home of provisioning powers (ex dev-admin): deploy-layer config store

- **Status:** Accepted
- **Date:** 2026-08-12
- **Deciders:** PM + tech lead (PM ratification 2026-08-12)
- **Closes:** D-20 (Home of provisioning powers) — `docs/discovery/open-decisions.md` §2, §11

## Context

The role model collapses user/admin/dev-admin → lecturer/admin (A-21), leaving the
question of where dev-admin's provisioning powers land:

> *"Where do dev-admin's provisioning powers go — upload-domain/institute profile
> (B-47), storage identity + HDD registration (B-51), SD-card path, hall code
> (A-07)? Into the Admin UI, or into a deploy-layer config store with no UI?"*
> — D-20, register

This drives the core-api config-store design and the Admin UI page list:

> *"Latest phase without rework: Phase 3 — the config store and deploy layer are
> Phase-3 designs; moving provisioning *into* the UI later adds screens but doesn't
> break the store, while the reverse (UI first, then ripping it out) is rework."*

## Decision

**The deploy layer owns provisioning.** Institute profile, hall code, and storage
identity live in a **config store written at install time** (a documented flow, not
a UI); the Admin UI shows **device identity read-only**. **HDD swap/format**
(B-51/B-52 successor) stays an **Admin-UI operation**, since IT staff perform it in
the field (A-21).

## Consequences

### Positive
- Typed config store replaces `.env` sed-ing (B-47/B-48) and prevents boot-frozen
  flags like `isSliit` (B-26) from recurring.
- No privileged provisioning page to secure in the Admin UI; identity is read-only.
- Provisioning could later move *into* the UI without breaking the store (the cheap
  direction), while avoiding the expensive UI-first-then-remove path.

### Negative / trade-offs
- Field re-provisioning (e.g. changing hall code) requires the documented deploy-layer
  flow, not a UI action. Accepted: provisioning is an install-time IT task, and HDD
  swap/format — the one genuinely field-frequent op — stays in the UI.

### Ripple — artifacts this touches (LIST ONLY; do not apply here)
- [ ] **core-api config-store design** (Prompt 11): typed store, install-time write,
      boot-safe reads — replaces `.env` (B-47/B-48), no `isSliit`-style freeze (B-26).
- [ ] **Deploy-layer provisioning flow** (§5.1 item 9): documented install procedure.
- [ ] **A-07 hall-code source**: comes from this config store.
- [ ] **Role-permission matrix** (B-43 successor): lecturer/admin only; no dev-admin;
      HDD ops are an admin capability.
- [ ] **Admin UI**: device-identity read-only panel; HDD swap/format action retained.

### Contract impact
**Possible — reconcile at Prompt 12.** A read-only device-identity endpoint (hall
code, institute profile, storage id) may be contract-visible; confirm at the drift
review. No change applied now.
