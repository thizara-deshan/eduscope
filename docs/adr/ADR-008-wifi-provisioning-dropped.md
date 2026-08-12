# ADR-008 — Wi-Fi provisioning: dropped (wired-only appliance)

- **Status:** Accepted
- **Date:** 2026-08-12
- **Deciders:** PM (PM ratification 2026-08-12)
- **Closes:** D-16 (Wi-Fi provisioning) — `docs/discovery/open-decisions.md` §2, §11

## Context

The open question was whether the appliance needs Wi-Fi/SSID configuration:

> *"does the appliance need Wi-Fi/SSID configuration, or is it wired-only?"* — D-16, register

The legacy code had SSID CRUD endpoints with a fully commented-out UI, and **no
wireless command exists anywhere in the codebase** — the architecture map's "SSID
via nmcli" claim is a documented MAP GAP (B-54). NetworkSettings is a Phase-2
screen, so the decision affects what ships now:

> *"Latest phase without rework: Phase 2 — NetworkSettings is built in Phase 2;
> adding a Wi-Fi card later is UI + deploy-layer rework."*

## Decision

**Drop — wired-only appliance.** No SSID UI, no wireless stack. `NetworkSettings`
scope stays LAN + vLAN + camera IPs.

## Consequences

### Positive
- No wireless stack to configure, secure, or support on a fixed-install appliance.
- `NetworkSettings` stays focused on the wired topology it actually drives.

### Negative / trade-offs
- A future portable/temporary-install scenario needing Wi-Fi would require a new
  admin card plus deploy-layer (netplan) work. No such scenario is in scope.

### Ripple — artifacts this touches (LIST ONLY; do not apply here)
- [ ] **Matrix §1a** device/network settings row: SSID rows confirmed RETIRE (not
      roadmap).
- [ ] **`admin/pages/NetworkSettings.tsx`**: scope note — LAN + vLAN + camera IPs;
      no Wi-Fi card (already built this way; verify).
- [ ] **Deploy-layer netplan** (§5.2 item 10): wired-only, no wireless provisioning.

### Contract impact
**None.** No `contracts/` element models SSID/wireless config. No Prompt-12 item.
