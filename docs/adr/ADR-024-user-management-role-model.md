# ADR-024 — User management & role model

- **Status:** Accepted
- **Date:** 2026-08-12 (recorded)
- **Deciders:** PM + architect
- **Documents:** A-21 — `docs/discovery/open-decisions.md` §4

## Context

> **A-21 — User management:** *"Bulk Excel import required; admin section for IT staff;
> no migration from old devices."* — register

The legacy user/admin/dev-admin roles collapse to **lecturer/admin** (dev-admin's
provisioning powers move to the deploy layer, D-20 → [ADR-011](ADR-011-provisioning-powers-home.md)).

## Decision

- **Roles:** lecturer + admin only (no dev-admin).
- **Bulk Excel import** of users is required; the Admin section is designed primarily
  for **IT staff**, not lecturers.
- **No account/recording migration** from old devices.

## Consequences

### Positive
- Two-role model is simpler to reason about and secure; provisioning powers live in
  the deploy layer (ADR-011), not in a privileged UI role.
- Excel import matches how IT staff actually onboard cohorts.

### Negative / trade-offs
- No migration means existing devices' users/recordings are not carried — accepted
  (PM confirmed); fresh provisioning per device.
- Excel import needs robust validation (B-44 baseline) to avoid bad-row imports.

### Ripple (LIST ONLY)
- [ ] **core-api auth / user model** (Prompt 11): lecturer/admin roles; permission
      matrix (B-43 successor); Excel import with validation (B-44).
- [ ] **Admin UI** User Management: bulk import flow (built in Wave 6; verify).
- [ ] Provisioning powers are **not** here — they live in the deploy-layer config
      store (ADR-011).

### Contract impact
**Possible — reconcile at Prompt 12.** User/role shapes and the import result contract
confirmed at the drift review.
