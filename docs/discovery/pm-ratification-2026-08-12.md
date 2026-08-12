# PM Ratification Sheet — Open Decision Defaults

**Date:** 2026-08-12  **Prepared by:** Architect  **For sign-off by:** Product Manager
**Purpose:** The Phase-2 frontend was built on the *defaults* below (the mock already
simulates each one). This sheet asks you to **confirm** each default or **override** it,
so the decisions can be closed and ADRs written before Phase-3 backend design (Prompt 10/11)
begins. Confirming a default is a sign-off, not new design — nothing changes if you confirm.

**How to use:** tick one box per row. Any *override* reopens design work; the rework cost
is noted so the trade-off is explicit. Return signed; each decision then gets an ADR.

---

| # | Decision | Default being ratified (what the system does) | If you override instead | Confirm / Override |
|---|----------|-----------------------------------------------|-------------------------|--------------------|
| **D-12** | Physical record button + 4-way camera switch | **Retire both.** Recording is controlled only from the touch panel. | Keeping them adds a GPIO event path + a hardware-initiated stop/switch to the recording state machine (pipeline-manager scope). | ☐ Confirm  ☐ Override |
| **D-13** | Upload timing policy | **Immediate auto-upload** on recording finish (resumable, retries). No upload windows, no toggle. Operator can manually re-enqueue a file. | Adding bandwidth-protection *windows* retrofits the queue service **and** the Admin UI. | ☐ Confirm  ☐ Override |
| **D-15** | Disk-pressure retention (before the 14-day auto-delete) | At a pressure threshold, delete **already-uploaded** recordings oldest-first even if <14 days; **never** auto-delete a never-uploaded recording; when critically full with nothing eligible, **refuse new recording starts** with a dashboard warning. | Removing the refuse-start rule later touches contract + UI (expensive); loosening "never delete un-uploaded" is cheap. | ☐ Confirm  ☐ Override |
| **D-16** | Wi-Fi provisioning | **Wired-only appliance.** No SSID UI, no wireless stack. | Adding a Wi-Fi card is UI + deploy-layer rework (NetworkSettings already shipped without it). | ☐ Confirm  ☐ Override |
| **D-17** | Device time / NTP / timezone | **Deploy layer owns it** (NTP + timezone set at provisioning). Admin UI shows current time/sync status **read-only** — no user-editable clock. | A user-editable clock page is new Admin UI + risks breaking title/retention/log timestamps. | ☐ Confirm  ☐ Override |
| **D-19** | Streaming platform list (launch) | **YouTube + Facebook + Custom RTMP.** | Additional named platforms each need preflight + config handling. | ☐ Confirm  ☐ Override |
| **D-20** | Home of provisioning powers (ex dev-admin) | **Deploy-layer config**, no UI page. | A provisioning Admin page is new UI + a privileged surface to secure. | ☐ Confirm  ☐ Override |
| **D-21** | Class-roster provenance for quiz / leaderboard | **Quiz-app self-registration** (student enters name + ID; leaderboard shows name + ID, panel-only, never on projector). | An institute roster feed depends on the upload/SSO API [D-02b] and reshapes quiz-service identity. | ☐ Confirm  ☐ Override |

---

### Override details (only if any box above is "Override")

| # | What you want instead | Reason |
|---|------------------------|--------|
|   |                        |        |
|   |                        |        |

---

### Not on this sheet (for your awareness — no action needed now)

- **D-03** (on-device database → SQLite) — architect-owned; being closed separately.
- **D-14** (auto-shutdown after uploads → drop) — trivial Phase-4 hook; can decide at integration.
- **D-02b** (institute upload API spec) — **blocked on the institute**; stays on the placeholder contract until the spec lands (Phase 4).
- **D-10** (room-controls hardware: projector/lights/AC) — deliberately deferred to post-launch; UI stays a placeholder.
- **SQO-1** (student-ID validation) — already resolved 2026-08-11.

---

**Deadline to confirm:** before Phase-3 backend design (Prompt 10) starts — D-12, D-13, D-15,
D-20, D-21 feed the pipeline-manager and service designs; D-16, D-17, D-19 are already live in
shipped Phase-2 screens.

**PM signature:** ______________________   **Date:** ____________
