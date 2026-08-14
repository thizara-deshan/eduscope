# Contract Drift Report — v0 (0.6.0) → v1 (1.0.0)

> **Author:** Contract steward (Prompt 12 reconciliation)
> **Date:** 2026-08-14
> **Inputs:** `contracts/` (openapi.yaml 0.6.0, quiz-app.yaml 0.6.0, events.md 0.6.0);
> every doc in `docs/design/` and `docs/adr/`; the mock adapter in
> `packages/api-client`.
> **Status:** ⛔ **HELD AT THE STOP GATE.** This report is the sign-off artifact.
> **No `contracts/` file, zod schema, `events.md` changelog, or mock file has been
> changed yet.** The 1.0.0 tag and its lockstep edits (§4) apply _only after both the
> frontend owner and the backend owner sign §6._

---

## 0. Executive summary

The 0.6.0 contract was written waves ahead of the backend, with every
shape whose form depended on an open decision marked `x-decision: [D-xx]`. The PM
ratified the **defaults** on 2026-08-12 ([pm-ratification-2026-08-12.md](../discovery/pm-ratification-2026-08-12.md),
[open-decisions §11](../discovery/open-decisions.md#11-decided-at-pm-ratification), ADRs
005–012), and the backend service designs (core-api, ai-services, quiz-service,
pipeline-manager, domain-model) were then written _against those ratified
defaults_.

The headline finding:

> **Every `x-decision` placeholder in the contract survived ratification unchanged.
> Not one decided decision amends an existing shape.** The contract anticipated the
> defaults, and the defaults were confirmed. §1 is therefore a wall of
> _"confirmed as-is."_

The real drift is elsewhere and is small:

1. **One decision does not resolve** — **D-02b** (institute upload payload) stays
   deferred to Phase 4 (ADR-002). Its _internal_ lifecycle is decided; its
   _external_ wire payload is still TBD. It keeps its `[D-02b]` tag into 1.0.0.
2. **One open sub-decision must close to unblock the backend build** — the
   **quiz-sync auth scheme** (DM-P5 / C-7 / F-3 / Q-6). Recommendation below;
   no wire-shape change either way.
3. **The backend designs flagged 20 contract "temptations"** (core-api F-1…F-8,
   quiz-service Q-1…Q-7, domain-model DM-P1…P5) explicitly _for this review_.
   Walked in §2. **Two are additive-and-recommended** (Q-4 version header;
   optionally F-8 named merge code). The rest are _leave-closed_, _confirm_, or
   _defer-to-owner_ (retention rulings DM-P1/P2/Q-3; encoder scope DM-P4).
4. **Two mock↔design transport gaps**, both known and by-design, not contract
   reshapes: the WebRTC preview transport (CG-2 / ADR-022, Wave 8) and the
   **device↔quiz-server sync stream, which the mock does not implement at all**
   (it is backend↔backend; the panel mock fabricates the downstream effects).

**Net effect on the wire:** 1.0.0 is a **ratification bump**, not a breaking
reshape. The only _shape_ change recommended for application is one additive,
header-only field (Q-4). Everything else is confirmation, prose clarification, or
a deferral that stays deferred. Breaking changes to consumers: **none** beyond what
0.x already shipped.

**Legend for severity:** **breaking** = a conforming 0.6.0 producer/consumer can
fail under 1.0.0 · **additive** = new optional surface, no existing caller breaks ·
**behavioral** = prose/semantics only, no schema diff · **confirm** = the decision
matched the placeholder; nothing changes · **defer** = not decided here; owner named.

---

## 1. Walk of every `x-decision` / `[D-xx]` tag

Every tag in `contracts/openapi.yaml` and `contracts/events.md`. Outcome sourced
from the ratification sheet + ADR index. "Element" cites the contract line the tag
sits on.

### 1.1 openapi.yaml

| Decision  | Contract element(s)                                                                                          | Ratified outcome (source)                                                                                                                                                  | Resolution                                    | Old → New                                                                                                                                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-10**  | `updateAudioControl` guard, `/audio/controls/{roleId}` (L511)                                                | Room-controls hardware deferred post-launch; **UI stays placeholder**, no lights/AC/projector-power backend ([ADR-004](../adr/ADR-004-room-controls-hardware-deferral.md)) | **confirm**                                   | unchanged. The _audio_ master-mute this op carries is real (LP-14); the deferred hardware never had a contract shape to change. Tag **retained** (still genuinely deferred).                                                                                                                       |
| **D-13**  | `requeueUploadJob` `/uploads/{jobId}/requeue` (L769)                                                         | Immediate auto-upload; no windows/toggle; **manual per-file re-enqueue** ([ADR-006](../adr/ADR-006-upload-timing-policy.md))                                               | **confirm**                                   | unchanged. Requeue-only (dead-letter → queued) is exactly ADR-006. No `holding` state, no window schema (F-6). Tag **cleared**.                                                                                                                                                                    |
| **D-15**  | `startRecording` `storage.critical` refusal (L212); `getStorageOverview` (L869); `RetentionPolicy` (L2593)   | Refuse-start when critically full; never auto-delete un-uploaded; uploaded-oldest-first ([ADR-007](../adr/ADR-007-disk-pressure-retention.md))                             | **confirm**                                   | unchanged. `Problem.code` **already** carries `storage.critical` (L1812); `RetentionPolicy` **already** carries `refuseStartWhenCritical`, `neverDeleteUnuploaded`, `earlyDeleteOrder` (L2594). The ADR-README guess of a _new_ `disk-critical` code is moot — it already exists. Tag **cleared**. |
| **D-16**  | `listNetworkConfigs` (L928); `NetworkConfig` (L2634)                                                         | Wired-only; no SSID UI, no wireless stack ([ADR-008](../adr/ADR-008-wifi-provisioning-dropped.md))                                                                         | **confirm**                                   | unchanged. Schema has **no** Wi-Fi fields (INV-NC-1) — matches "no wireless stack" exactly. Tag **cleared**.                                                                                                                                                                                       |
| **D-19**  | `listStreamTargets`/`createStreamTarget` (L1005/1023); `StreamTarget`/`Create`/`Update` (L2725/2745/2757)    | YouTube + Facebook + generic **Custom RTMP** ([ADR-010](../adr/ADR-010-streaming-platform-list.md))                                                                        | **confirm**                                   | unchanged. `platform enum: [youtube, facebook, custom-rtmp]` is ADR-010 **verbatim**. Tag **cleared**.                                                                                                                                                                                             |
| **D-20**  | `getProvisioning` (L782); `DeviceProvisioning` (L2506)                                                       | Deploy-layer config store owns provisioning; Admin UI **read-only**; HDD ops stay in UI ([ADR-011](../adr/ADR-011-provisioning-powers-home.md))                            | **confirm**                                   | unchanged. `core-api never writes this entity` (INV-DP-1); read-only GET only. Tag **cleared**.                                                                                                                                                                                                    |
| **D-02b** | `listUploadJobs`/`getUploadJob` (L726/753); `UploadJob`/`UploadFilePart`/`UploadJobDetail` (L2402/2424/2440) | **Still deferred to Phase 4** — placeholder contract until the institute spec lands ([ADR-002](../adr/ADR-002-upload-api-spec-deferral.md))                                | **defer (unresolved)**                        | unchanged, **tag RETAINED**. Internal lifecycle (add→upload→complete, dead-letter, requeue, `failureClass`) is decided (ADR-023). The _external_ payload to the institute endpoint is unknown. See §2/DR-13.                                                                                       |
| **D-21**  | `listPublicationResponses` (L1443); `AnswerProjection` (L3002)                                               | Quiz-app self-registration; leaderboard keys on student ID; import/SSO later maps onto the same IDs ([ADR-012](../adr/ADR-012-quiz-roster-provenance.md))                  | **confirm**                                   | unchanged. Device holds a minimal PII projection (name + studentIdNumber, DM-14) — matches self-registration. Tag **cleared**.                                                                                                                                                                     |
| **DM-P5** | quiz-sync ops (L1570/1595/1611/1638); `QuizSync*` message schemas (L3043/3052/3065/3088)                     | Sync contract **specified** in `contracts/` (events.md §4 + openapi quiz-sync tag). **Auth scheme sub-decision still open** (static vs signed)                             | **confirm (shape)** + **1 open sub-decision** | shape unchanged. The sync surface exists and is complete. The `deviceAuth` **scheme** is the residue — see DR-03.                                                                                                                                                                                  |

### 1.2 events.md `[D-xx]`

| Tag       | Element                                                    | Resolution             | Note                                                                |
| --------- | ---------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------- |
| `[D-15]`  | §2.8 `storage.status.policy` (full `RetentionPolicy`)      | **confirm**            | Mirrors the REST `RetentionPolicy`; ADR-007 confirmed. Tag cleared. |
| `[D-02b]` | §2.18 `upload.job`, §2.19 `upload.part`                    | **defer (unresolved)** | Payload placeholder; tag retained (mirrors §1.1 D-02b).             |
| `[D-21]`  | §4 device↔quiz-server sync contract                        | **confirm (shape)**    | ADR-012 confirmed. Tag cleared.                                     |
| **DM-P5** | §4 auth ("static token vs signed … open item under DM-P5") | **open sub-decision**  | See DR-03.                                                          |

**§1 tally:** 11 tagged decisions · **8 confirm-as-is** (tags cleared) · **1 stays
deferred** (D-02b, tag retained) · **1 confirmed-shape with an open auth sub-decision**
(DM-P5) · **0 amend an existing shape.**

---

## 2. Contract changes proposed by the design docs + mock↔design mismatches

Two streams merged and de-duplicated: (a) the "contract-change temptations —
flagged, NOT applied (prompt 12 input)" tables the backend designs wrote _for this
review_ (core-api §15 F-1…F-8, quiz-service §10 Q-1…Q-7, domain-model §14 DM-P1…P5),
and (b) behavioral mismatches between the mock adapter and the backend designs
across the axes the brief named (frequency, latency, error taxonomy, pagination,
reconnect, upload payload, device↔quiz sync). Each carries a **DR-xx** id used again
in §3.

### 2.1 From the design docs

| DR        | Source                                            | Item                                                                                                 | Severity                                                                    | Disposition (recommendation)                                                                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **DR-01** | core-api F-1                                      | `LogEntry.service` has one value `ai` for **three** AI services (stt / slide / question)             | **additive _or_ breaking** — depends on option                              | **Options — recommend A.** (A) Keep `ai`, attribute the sub-service in `LogEntry.context.subservice` (no enum growth, no exhaustive-switch break). (B) Widen enum to `stt`/`slide`/`question` (breaking to any exhaustive `service` switch). A is cheaper and F-1's own lean.                                      |
| **DR-02** | core-api F-2                                      | No `GET /audit` endpoint                                                                             | **behavioral**                                                              | **Leave closed for v1.** C-3's rule (every audited action also writes a Session-category `LogEntry`) stands. Revisit an audit browser post-1.0.                                                                                                                                                                    |
| **DR-03** | core-api F-3 / quiz-service Q-6 / **DM-P5** / C-7 | Quiz-sync auth scheme: static bearer vs signed                                                       | **behavioral** (no wire-shape change; `deviceAuth` bearer already modelled) | **Recommend: per-device static bearer (hashed at rest) for v1; HMAC-signed requests as the SSO-era upgrade.** Close C-7. Names the scheme in the `deviceAuth` security-scheme description. **This is the one open item that must close before the backend sync client is built.**                                  |
| **DR-04** | core-api F-4                                      | No device-side `GET /device/v1/quiz-sessions/{id}` re-read                                           | **—**                                                                       | **Leave closed.** Watermark replay (`sync.hello`) + Z-04 mint-retry cover recovery; not needed for correctness.                                                                                                                                                                                                    |
| **DR-05** | core-api F-5 / C-8                                | WS auth transport: `?token=` vs subprotocol                                                          | **behavioral**                                                              | **Recommend closing on the `Sec-WebSocket-Protocol` subprotocol.** Both are representable without a bump; naming one removes the ambiguity. Phase-3 hardening pick.                                                                                                                                                |
| **DR-06** | core-api F-6                                      | Upload **windows** asked for by the brief                                                            | **—**                                                                       | **No change.** Resolved against by ADR-006 (D-13). If PM reopens D-13, it returns as a contract-visible `holding` state — not now.                                                                                                                                                                                 |
| **DR-07** | core-api F-7                                      | Legacy **import** path asked for by the brief                                                        | **—**                                                                       | **No change.** Resolved against by ADR-001/ADR-024. A reopening is a deploy-layer tool, not a contract surface.                                                                                                                                                                                                    |
| **DR-08** | core-api F-8                                      | `Problem.code` has no `merge.failed`-style code for RA-04 refusals (uses `conflict` + `meta.reason`) | **additive** (optional)                                                     | **Options — recommend A.** (A) Keep `conflict` + `meta.reason` (v0 stance; no enum growth). (B) Add a named `recording.merge-not-failed` code (clearer client copy, exhaustive-switch touch). Low value; A unless the frontend owner wants the named copy.                                                         |
| **DR-09** | quiz-service Q-2                                  | Session auto-close after 6 h device silence                                                          | **behavioral** (reuses existing value)                                      | **Confirm.** Reuse `closeReason=session-ended`; no new enum value. PM to bless the 6 h default. No schema diff.                                                                                                                                                                                                    |
| **DR-10** | quiz-service Q-4                                  | Contract-version header `x-eduscope-contract: 0.6` on device→quiz-sync calls                         | **additive**                                                                | **Recommend APPLY.** Header-only; absent from the contract today (verified — no occurrence in openapi.yaml). Lets a version mismatch log loudly across the two independently-deployed zones (ADR-021). Add to the four `quiz-sync` operations as an optional request header, value becomes `1.0` at tag.           |
| **DR-11** | quiz-service Q-5                                  | `sync.hello` carries no participant watermark                                                        | **—**                                                                       | **Leave closed.** Participants replay as idempotent counts; a per-participant projection (roster/D-02b era) would revisit.                                                                                                                                                                                         |
| **DR-12** | quiz-service Q-7                                  | `RegisterParticipantResponse` lacks a canonical `fullName` echo                                      | **—**                                                                       | **Leave closed.** Cosmetic; a rejoin does not need the stored-name echo in v1.                                                                                                                                                                                                                                     |
| **DR-13** | domain-model DM-P1 / DM-P2 / quiz-service Q-3     | Retention of **transcripts/slide captures** (device) and **answers/PII** (device + quiz server)      | **defer**                                                                   | **Not decided here — PM + institute (data protection), Phase 3.** Recommended defaults exist (delete with parent recording; purge PII on recording delete; 180-day server purge) but this is a policy ruling, not a steward call. Contract stays silent on quiz-zone retention in v1; **flagged to owner.**        |
| **DR-14** | domain-model DM-P4                                | `EncodingProfile` per-device vs per-channel                                                          | **additive** (if adopted)                                                   | **Options — recommend A, owner = tech lead.** (A) Device default + optional per-channel override, modelled as a `scope` field (additive; streaming vs local can differ). (B) Device-global only (today's `EncodingProfileUpdate`). Present as an option; **not applied** — DM-P4 has an owner and is not ratified. |
| **DR-15** | domain-model DM-P5 (contract)                     | The sync contract itself                                                                             | **confirm**                                                                 | Already specified (events.md §4 + quiz-sync tag). Only the auth residue (DR-03) remains.                                                                                                                                                                                                                           |

### 2.2 Mock adapter ↔ backend design (behavioral)

The mock is held to the contract by a _contract-honesty gate_ (every mocked response
is validated against the generated/hand-authored zod schemas), so mock↔**contract**
drift is near zero. These are mock↔**backend-design** behavioral notes.

| DR        | Axis                | Mock behavior                                                                                                                                                                                                                  | Backend design                                                                                                                              | Severity                            | Disposition                                                                                                                                                                                                                                                                                                                        |
| --------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DR-16** | Event frequency     | `audio.levels` ≤10 Hz + suppressed with no subscriber (`telemetry.ts`); `storage.status`/`device.health` 60 s; `ai.countdown` 15 s                                                                                             | events.md §6 budget: identical                                                                                                              | **—**                               | **Aligned.** No drift. Mock timers read from the shared `TIMERS`/`WS_RECONNECT_BACKOFF_MS` constants — a single source with the contract.                                                                                                                                                                                          |
| **DR-17** | Command latency     | Fixed cosmetic delays: pause/resume 250 ms, stop 200 ms, takeover 300 ms, channel 150 ms, AI 100 ms (`commands.ts`)                                                                                                            | Real latencies vary; contract ceiling `T-CMD-RESOLVE` = 10 s                                                                                | **behavioral (illustrative)**       | **No contract drift.** Mock delays are illustrative and well inside the 10 s ceiling. Document in the mock that these are not contractual SLAs; no v1 change.                                                                                                                                                                      |
| **DR-18** | Error taxonomy      | Refusals drawn from the closed `Problem.code` enum, parsed with `zProblem`                                                                                                                                                     | Same closed enum                                                                                                                            | **—**                               | **Aligned** (modulo DR-01/DR-08, already listed).                                                                                                                                                                                                                                                                                  |
| **DR-19** | Pagination          | `listRecordings` cursor-paged, server-side `q`/`ownerUserId` filter (CG-5); no client filtering                                                                                                                                | core-api §5.3 same                                                                                                                          | **—**                               | **Aligned.**                                                                                                                                                                                                                                                                                                                       |
| **DR-20** | Reconnect semantics | Backoff ladder 0.5→10 s; **full snapshot replay, never a partial patch**; `T-WS-STALE` (10 s) dims live regions; seq-gap → full resync (`connection.ts`)                                                                       | events.md §1 / §5 identical                                                                                                                 | **—**                               | **Aligned.** Faithful.                                                                                                                                                                                                                                                                                                             |
| **DR-21** | Upload payload      | Simulates the **placeholder** lifecycle (add→upload→complete, dead-letter, requeue, `failureClass`, two seeded stall classes)                                                                                                  | ADR-023 pluggable adapter + resumable queue; **institute wire payload deferred (D-02b)**                                                    | **defer**                           | Mock is placeholder-faithful. The external payload stays TBD (see §1 D-02b / DR-13-adjacent). **No v1 change**; mock already models the decided half.                                                                                                                                                                              |
| **DR-22** | Device↔quiz sync    | **Not implemented in the mock at all** — no `sync.hello`/`sync.answers`/`sync.participants`/`sync.heartbeat`. The panel mock fabricates the _downstream_ `quiz.responses` / `quiz.session` joined-count / `syncState` directly | events.md §4 defines the full backend↔backend stream                                                                                        | **behavioral (by design)**          | **Correct by design** — §4 is core-api↔quiz-service, with no panel/frontend surface, so the panel mock has nothing to stand in for. **Consequence:** §4's correctness has **zero mock coverage and rests entirely on the two backends** at integration; and its auth (DR-03) must close first. Flag prominently; no schema change. |
| **DR-23** | Preview transport   | JPEG frames smuggled over `ice` messages as a documented **mock-only** convention (`preview.ts:15-27`)                                                                                                                         | events.md §3 + [ADR-022](../adr/ADR-022-panel-thumbnail-transport-webrtc.md): real WebRTC media over the negotiated peer (**CG-2**, Wave 8) | **behavioral (mock lags, tracked)** | Envelope (`offer`/`answer`/`ice`/`close`/`error`) is already correct in §3; only the **transport implementation** lags, tracked as CG-2 for Wave 8. **Not a contract shape change.**                                                                                                                                               |

---

## 3. Drift items — severity, amendment, frontend change, backend obligation

Only the items that carry an _action_ are expanded (the confirms and leave-closeds
are complete in §1/§2). "Apply?" states whether the item edits `contracts/` at the
1.0.0 tag.

### DR-03 · Quiz-sync auth scheme (DM-P5 / C-7 / F-3 / Q-6) — **behavioral · APPLY (prose)**

- **Amendment:** In `openapi.yaml`, the `deviceAuth` security scheme description
  states: _v1 = per-device static bearer, minted at provisioning, stored hashed at
  rest; HMAC-signed requests are the SSO-era upgrade (D-02b/roster era)._ Add the
  same one-line resolution to events.md §4's auth note and retire the "open item
  under DM-P5" phrasing. Close C-7.
- **Frontend:** none. The panel never speaks the sync protocol; the mock fabricates
  downstream effects (DR-22). No `apps/` change.
- **Backend:** `services/core-api` sync client and `services/quiz-service` device
  endpoint must agree on static bearer; credential minted by the deploy layer at
  provisioning (D-20). This is the gate on building the sync client.

### DR-10 · `x-eduscope-contract` version header (quiz-service Q-4) — **additive · APPLY**

- **Amendment:** Add an optional request header `x-eduscope-contract` (value `1.0`)
  to the four `quiz-sync` operations in `openapi.yaml`. Document that quiz-service
  logs loudly on mismatch (does not hard-reject in v1).
- **Frontend:** none.
- **Backend:** core-api sends the header on every device→quiz-sync call;
  quiz-service reads it into its per-session log/metric line for cross-zone
  correlation (quiz-service §9).

### DR-01 · `LogEntry.service` for three AI services (core-api F-1) — **additive (rec.) · APPLY option A**

- **Amendment (recommended A):** No enum change. Confirm in prose that AI
  sub-service attribution rides `LogEntry.context.subservice` (`stt`/`slide`/`question`).
  (Option B — widen the enum — is **breaking** and not recommended.)
- **Frontend:** none for A. (B would force a new `case` in any exhaustive `service`
  switch in `apps/panel` SystemLogs — an argument against B.)
- **Backend:** ai-services (all three) and core-api set `context.subservice` when
  logging; ai-services §note already assumes `service="ai"` + subservice in context.

### DR-08 · Named merge-refusal code (core-api F-8) — **additive (optional) · DEFER to frontend owner**

- **Amendment (only if chosen B):** add `recording.merge-not-failed` to `Problem.code`.
- **Frontend:** if added, S-22's merge-failed copy can name the refusal precisely
  (`apps/panel` retry-merge handler) and the exhaustive `checkedProblem` switch
  gains a `case`. If not, `conflict` + `meta.reason` renders today.
- **Backend:** core-api RA-07 returns the chosen code on a non-`failed` recording.
- **Recommendation:** keep `conflict` (A) unless the frontend owner wants the copy.

### DR-05 · WS auth transport (core-api F-5 / C-8) — **behavioral · APPLY (prose)**

- **Amendment:** events.md §1 names the `Sec-WebSocket-Protocol` subprotocol as the
  v1 transport (drop the `?token=` alternative from the prose, or mark it non-v1).
- **Frontend:** the real WS client (`packages/api-client/src/real/`, Phase-4) uses
  the subprotocol; the mock has no socket auth to change.
- **Backend:** core-api WS upgrade validates the subprotocol token.

### DR-14 · `EncodingProfile` scope (domain-model DM-P4) — **additive (if adopted) · DEFER to tech lead**

- **Options:** (A, rec.) device default + optional per-channel `scope` override on
  `EncodingProfile`/`EncodingProfileUpdate`; (B) device-global only (status quo).
- **Frontend:** if A, AD-3 encoder page gains a per-channel override affordance.
- **Backend:** if A, pipeline-manager honors a per-channel bitrate; core-api stores
  `scope`. **Not applied** — DM-P4 is owned by the tech lead and unratified.

### DR-13 · Retention rulings (DM-P1 / DM-P2 / Q-3) — **defer · DO NOT APPLY**

- **Not a steward decision.** PM + institute (data protection), Phase 3. Contract
  stays silent on quiz-zone/transcript retention in v1. Recommended defaults are
  recorded in the design docs; flagged to the owner. No `contracts/` edit.

### DR-22 · Device↔quiz sync has no mock/frontend surface — **flag · DO NOT APPLY (test obligation)**

- **No amendment.** Add a note to events.md §4 (and the mock README) that §4 is
  intentionally unmocked (backend↔backend) and its only validation is backend
  integration testing, gated on DR-03.
- **Backend:** core-api + quiz-service own an integration test of the full
  `sync.hello → replay → answers/participants/heartbeat → stale/fail` loop.

### DR-23 · WebRTC preview transport (CG-2 / ADR-022) — **flag · DO NOT APPLY (Wave 8)**

- **No amendment** — §3 envelope is already correct. Tracked as CG-2 for Wave 8; the
  mock's JPEG-over-`ice` placeholder is documented as mock-only.
- **Frontend + backend:** Wave 8 wires real WebRTC media (`pipeline-manager`
  thumbnails consumer ↔ panel lightbox). Out of scope for the 1.0.0 tag.

---

## 4. Amendments to apply **on sign-off** (not yet applied)

At the moment the STOP gate clears (§6), apply the following **in one run**, so the
mock never lags the contract. This is the complete, exhaustive change set — **every
diff below traces to a §3 row; there are no silent changes.**

**Contract shape / prose (`contracts/`):**

1. **Version bump** `openapi.yaml` + `quiz-app.yaml` + `events.md`: `0.6.0 → 1.0.0`.
2. **Clear the resolved `x-decision` tags** (D-10*, D-13, D-15, D-16, D-19, D-20,
   D-21) — the decisions are closed; keep a one-line "confirmed by ADR-0xx at 1.0.0"
   note where the tag sat. **Retain `[D-02b]`** on the upload schemas/events (still
   deferred) and the `DM-P5` note reduced to "auth = static bearer (DR-03)."
   (*D-10 stays a genuine deferral — retain but annotate.\*)
3. **DR-10:** add optional `x-eduscope-contract` header to the 4 `quiz-sync` ops.
4. **DR-03:** rewrite the `deviceAuth` scheme description + events.md §4 auth note.
5. **DR-05:** events.md §1 names the subprotocol transport.
6. **DR-01 (A):** prose confirming `context.subservice` attribution (no enum diff).
7. **DR-22:** events.md §4 note that the sync stream is intentionally unmocked.
8. **DR-08 / DR-14:** apply _only if_ the respective owner picks the additive option
   in §6; otherwise omit.

**Generated + hand-authored zod (`packages/shared`):** 9. Re-run codegen against both amended OpenAPI files. The only _shape_ delta is the
DR-10 header (and DR-08/DR-14 iff chosen) — so `types.gen.ts`/`zod.gen.ts` are
near-identical; the bump is mostly metadata. Hand-authored `events.ts` gains the
DR-03/DR-05/DR-22 prose only (no schema change).

**events.md changelog:** add the `1.0.0` row summarizing DR-03, DR-05, DR-10, DR-01,
DR-22, and the tag clearances, linking this report.

**Mock adapter (`packages/api-client`) — same run:** 10. Assert the `x-eduscope-contract` header is sent on the (mock) quiz-sync path if
one is added; update the `contract-honesty` gate's version assertion to `1.0.0`;
bump any hardcoded `0.6` contract-version strings. The mock's behavior is already
correct for every confirmed decision (DR-16…DR-21), so this is metadata + the one
header, not a behavioral rewrite. 11. Update count/version assertions in
`packages/api-client/test/gate-contract-coverage.test.ts` and
`packages/shared/test/constants.test.ts` if the operation/field count moves
(DR-10 header does not add an operation; DR-08/DR-14 iff chosen would).

**Verification to run after applying:** `pnpm --filter @eduscope/shared codegen`
then `pnpm typecheck` (4 projects) + `pnpm test`, confirming the contract-honesty
gate validates against the regenerated 1.0.0 schemas.

---

## 5. Ambiguous items requiring an owner's decision (not decided here)

Per the steward's rule — _present options with a recommendation, never decide_ — these
do **not** get applied without the named owner's pick:

| Item                          | Owner                         | Recommended                     | Alternative                                   |
| ----------------------------- | ----------------------------- | ------------------------------- | --------------------------------------------- |
| **DR-01** service attribution | backend + frontend            | A: `ai` + `context.subservice`  | B: widen enum (breaking)                      |
| **DR-03** sync auth scheme    | tech lead (+ PM)              | static per-device bearer        | HMAC-signed                                   |
| **DR-05** WS auth transport   | tech lead (Phase-3 hardening) | subprotocol                     | `?token=`                                     |
| **DR-08** named merge code    | frontend owner                | keep `conflict` + `meta.reason` | add `recording.merge-not-failed`              |
| **DR-13** retention rulings   | PM + institute                | design-doc defaults             | (policy call) — **hard-blocks nothing in v1** |
| **DR-14** encoder scope       | tech lead                     | per-channel `scope` override    | device-global                                 |

---

## 6. Sign-off — STOP gate

> **v1 (1.0.0) is not tagged, and none of §4 is applied, until both signatures are
> present.** Both owners are reviewing the same artifact: this report.

**Frontend owner** — confirm the frontend obligations in §3 (DR-01/A carries no
frontend change; DR-08 and DR-14 are yours to pick in §5; the WebRTC/CG-2 and
sync/DR-22 rows impose no `apps/` change for 1.0.0):

- [x] Signed: Thisara Deshan Date: 2026-08-14 Picks (DR-08 / DR-14): use recommended options

**Backend owner** — confirm the backend obligations in §3 (DR-03 auth scheme is the
gate on the sync client; DR-10 header; DR-01/A `context.subservice`; DR-22 integration
test ownership):

- [x] Signed: Thisara Deshan Date: 2026-08-14 DR-03 scheme confirmed: confirmed

Once both boxes are ticked, the steward applies §4 in one run and tags 1.0.0.
