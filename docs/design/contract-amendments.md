# Contract amendments

The change log for `contracts/`. One section per version bump, one row per
diff — **no silent changes**. A row exists only if it traces to an `answered`
row in [screen-inventory §10](screen-inventory.md#10-contract-gaps) *and* to a
decision recorded in an approved design doc; the "Resolved by" links in §10
carry the rationale and it is not restated here.

Amendments happen after a wave's design run and before its plan run
([§10.1](screen-inventory.md#101-when-the-contract-actually-changes)) — never
during a plan, and never speculatively.

---

## 0.6.0 → 1.0.0 — 2026-08-14 · Prompt-12 drift reconciliation

The Phase-3 backend designs (core-api, ai-services, quiz-service, pipeline-manager,
domain-model) were reconciled against the 0.6.0 contract after PM ratification
(2026-08-12, ADRs 005–012). Full walk, severities, frontend/backend obligations,
and the two-owner sign-off are in
[contract-drift-report.md](contract-drift-report.md). **Both the frontend owner
and the backend owner signed before this tag** (report §6).

**Headline: this is a ratification bump, not a breaking reshape.** Every ratified
`x-decision` placeholder was confirmed as-is — *no decided decision amended an
existing shape*. `info.version` `0.6.0` → `1.0.0` on `openapi.yaml`,
`quiz-app.yaml`, and `events.md`.

### Amendment rows (all applied at recommended options)

| # | DR | Decision | Severity | Change |
|---|---|---|---|---|
| **V1-1** | DR-10 | quiz-service Q-4 | **additive** | New optional `x-eduscope-contract` request header on the four `quiz-sync` ops (`#/components/parameters/contractVersion`). Logged loudly on mismatch, never hard-rejected (ADR-021). |
| **V1-2** | DR-03 | DM-P5 / C-7 / F-3 / Q-6 | **behavioral** (no wire shape) | `deviceAuth` scheme + events.md §4 name the v1 scheme: per-device **static bearer**, minted at provisioning (D-20), hashed at rest; HMAC-signed is the SSO-era upgrade. Closes C-7. |
| **V1-3** | DR-05 | core-api F-5 / C-8 | **behavioral** (no wire shape) | events.md §1 names the `Sec-WebSocket-Protocol` subprotocol as the WS-auth transport; the `?token=` form is retired. Closes C-8. |
| **V1-4** | DR-01 | core-api F-1 | **additive** (prose; option A) | `LogEntry.context.subservice` (`stt`/`slide`/`question`) carries AI attribution; the closed `service` enum is **not** widened (no exhaustive-switch break). |
| **V1-5** | DR-22 | events.md §4 | **behavioral** (note) | events.md §4 records that the device↔quiz sync stream is intentionally unmocked (backend↔backend); its only validation is a core-api + quiz-service integration test, gated on V1-2. |
| **V1-6** | §1 walk | ADRs 006–012 | **confirm** | `x-decision` tags for D-13/D-15/D-16/D-19/D-20/D-21 (openapi) and D-15/D-21 (events.md) converted to `x-decision-resolved` — shapes frozen, unchanged. |
| **V1-7** | §1 walk | ADR-002 / ADR-004 | **defer (retained)** | `[D-02b]` (upload payload, still Phase-4) and `D-10` (room-controls hardware, post-launch) keep their tags, now annotated as genuine deferrals. |
| **V1-8** | DR-14 | domain-model DM-P4 | **additive** | `EncodingProfileUpdate` gains optional `channelId` (write a per-channel override; absent/null ⇒ device-default, unchanged for existing callers); `getEncoderSettings` gains an optional `?channelId=` query; `EncodingProfile.scope`/`channelId` descriptions mark DM-P4 resolved. Applied at the frontend owner's signed "recommended options" pick (report §6). |

**Not applied — deferred to non-signatory owners** (report §5): **DR-13** (transcript/PII
retention — PM + institute, DM-P1/P2/Q-3) stays silent in the contract. **DR-08** (named
merge-refusal code): recommended option is *keep `conflict` + `meta.reason`*, so no change.
These are recorded, not silently dropped. **DR-14** was applied (V1-8) on the signed pick,
though its named owner is the tech lead — flagged here for the tech lead's post-hoc awareness.

### Generated layer + mock lockstep

- `packages/shared` codegen re-run against both amended OpenAPI files:
  `types.gen.ts` gains `ContractVersion`, the optional `x-eduscope-contract` header
  on the four quiz-sync ops, and the `LogEntry.context.subservice` prose. **`zod.gen.ts`
  is unchanged** — every change is additive/optional or prose, so no validation shape moved.
- **Mock:** no behavioral change was needed — the mock was already contract-correct
  for every *confirmed* decision (reconnect, frequency, latency, pagination, error
  taxonomy all validated in the drift report §2.2), and the DR-10 header lives on the
  device↔quiz path the panel mock does not implement (DR-22). No hardcoded
  contract-version constant exists to bump; historical `v0.2`/`v0.6` "added-at"
  citations in the mock are left intact.

### Verification

| Check | Result |
|---|---|
| `pnpm --filter @eduscope/shared codegen` | pass — core + quiz layers regenerated; additive delta only (`ContractVersion`, quiz-sync `x-eduscope-contract` header, `EncodingProfileUpdate.channelId`) |
| `pnpm typecheck` (4 projects) | pass |
| `pnpm test` | **1477 total; every contract test green** — contract-honesty (13), event-coverage, gate-contract-coverage, operation-coverage, shared rest/events/quiz coverage, student-quiz, and the mock encoder path (validates the new `EncodingProfileUpdate`). The only non-passing are the `tools/eslint-rules/gate-boundary.test.ts` GATE-3 cases, which are **nondeterministic environmental timeouts** — each spawns a full `pnpm lint` that exceeds the 20 s per-test timeout on this machine (2 timed out one run, 1 the next); unrelated to this change |

---

## 0.4.0 → 0.5.0 — 2026-08-09 · Wave 5 (Library, playback, export, upload queue) gate

Carries the **five** gaps the W-5…W-9 wireframe gate answered — **CG-5** (S-21),
**CG-7** (S-22), **CG-3** and **CG-21** (S-23), **CG-20** (S-35). Four are
additive and one (CG-3) is a prose-only semantic; none is breaking. Wave 5's plan
run is unblocked by this amendment. **S-24 (W-8) required no contract change** —
`deleteRecording`, RA-06's real audit columns and the resolving events already
exist; it is the wave's clean "a run can add nothing" case.

Sources: [S-21 §9](screens/S-21-design.md#9-contract-changes-this-design-requires),
[S-22 §9](screens/S-22-design.md#9-contract-changes-this-design-requires),
[S-23 §8](screens/S-23-design.md#8-contract-changes-this-design-requires),
[S-35 §9](screens/S-35-design.md#9-contract-changes-this-design-requires),
[open-decisions](../discovery/open-decisions.md) (D-13 upload timing underpins the
requeue/offline story CG-20 renders). Rationale lives in the §10 "Resolved by"
links and is not restated here.

`info.version` `0.4.0` → `0.5.0`.

**`contracts/events.md` WAS touched — one WS-visible change plus one §1 note.**
The WS change: §2.18 `UploadJobPayload` gains `failureClass` (CG-20), mirroring
the new openapi `UploadJob.failureClass`. The note: §1's "Scoping" section now
records the implicit scoped-subscription semantic (CG-3) — calling a flow's REST
entry marks the `AuthSession` subscribed to its scoped stream, honouring "clients
send no WS messages" with no new endpoint or client→server frame. events.md's own
version header moves `0.4.0` → `0.5.0`. **The other three gaps (CG-5, CG-7, CG-21)
are REST-only and touch `openapi.yaml` alone.**

### Amendment rows

| # | CG | Decision | Severity | Change |
|---|---|---|---|---|
| **A-10** | [CG-5](screen-inventory.md#10-contract-gaps) | LIB-D-2 | **additive** (two optional query params; no schema change) | `listRecordings` gains `?q=` (case-insensitive title substring) and `?ownerUserId=` (admin-only). No `?from=`/`?to=` |
| **A-11** | CG-7 | DTL-D-6 | **additive** (one operation binding an already-modelled command) | New `POST /recordings/{recordingId}/retry-merge` — admin, 202-async, resolves via existing `recording.artifact{merging}`; `403`/`409` refusals |
| **A-12** | CG-3 | EXP-D-4 | **behavioral** (prose only; no schema change) | Op descriptions of `listExportTargets`/`createExport`/`getExport`/`queryLogs` + events.md §1 state that calling the REST entry marks the `AuthSession` subscribed to its scoped stream for a TTL |
| **A-13** | CG-21 | EXP-D-5 | **additive** (one enum value) | `Problem.code` gains `export.insufficient-space`; `createExport` returns it (`422`) when the target lacks room |
| **A-14** | CG-20 | UQ-D-2 | **additive** (one nullable field + one enum, both on data the emitter already holds) | `UploadJob` + `UploadJobPayload` gain `failureClass` (`connectivity`/`server`/`permanent`/null); new `UploadFailureClass` enum |

---

#### A-10 · CG-5 · `listRecordings` — `q` + `ownerUserId`

*Additive.* Two optional query params; `Recording` is unchanged. Filtering is
server-side and resets the cursor (a cursor-paged list cannot be client-filtered).
`ownerUserId` is admin-only — a lecturer is already owner-scoped server-side
(INV-RC-5), so the param is ignored for them. `?from=`/`?to=` were deliberately
**not** added (the 14-day window is already small, LIB-D-2). No existing caller
breaks: both params are optional and default to today's unfiltered behaviour.

#### A-11 · CG-7 · `POST /recordings/{recordingId}/retry-merge`

*Additive.* One operation binding the already-modelled `cmd.recording.retry-merge`
(RA-07, admin, `G-ADMIN`). 202-async; RA-07 resets the merge attempt counter and
the recording returns to `merging`, resolving on the **existing**
`recording.artifact{merging}` event — no new event, no schema change. Refusals:
`403` (lecturer, U-6) and `409` (the recording is not in `failed`). This is the
only manual merge control in the product; merging is otherwise automatic (A-12,
SM-D-1). Without it the `merge failed` state (S-22 §2.4) was a reachable dead end.
Consequence for the shared/mock coverage gates: the panel operation count moves
77 → 78 (81 → 82 including the four server-side quiz-sync ops); the count
assertions in `packages/shared/test/constants.test.ts` and
`packages/api-client/test/gate-contract-coverage.test.ts` are updated to match.

#### A-12 · CG-3 · scoped-subscription semantic

*Behavioral / prose only — no schema change.* events.md §1 already scopes
`export.job`/`usb.volumes`/`log.entry` to specific sessions, but also states
clients send no WS messages, leaving no defined moment a session *becomes*
subscribed. The answer (EXP-D-4): calling the flow's REST entry marks the calling
`AuthSession` subscribed for a TTL, refreshed by continued reads —
`GET /exports/targets` → `usb.volumes`; `createExport`/`GET /exports/{id}` →
`export.job`; `GET /logs` → `log.entry`. Recorded in the four operation
descriptions **and** in events.md §1's "Scoping" section. No new endpoint, no
client→server frame; the mock's export/log streams are already session-local, so
no adapter behaviour changes. S-34's live-log tail reuses the same mechanism.

#### A-13 · CG-21 · `Problem.code` — add `export.insufficient-space`

*Additive.* One value alongside `export.invalid-target`. The client pre-checks
space per drive-card (C-6), but a drive can fill between listing and copy;
`createExport` now refuses that race with a **named**, U-5-renderable reason
(`422`) instead of a generic `validation.invalid`. Adding a value to the closed
`Problem.code` enum is a compile event, not merely a doc change (as CG-10 was):
the exhaustive `checkedProblem` switch in
`apps/panel/src/screens/dashboard/use-start-recording.ts` gains the matching
`case` so the union stays exhaustively handled. The mock `createExport` returns
the code when `target.freeBytes < Σ selected bytes`.

#### A-14 · CG-20 · `UploadJob` / `UploadJobPayload` — add `failureClass`

*Additive.* One nullable field mirrored on the REST schema and the WS payload,
plus the new `UploadFailureClass` enum (`connectivity`/`server`/`permanent`). The
value is the §4.4 classification the emitter already computes — it is what decides
whether `attempt` increments — so nothing new is calculated; it is only surfaced.
It lets S-35 render an `offline` stall (`failed` + `connectivity`, no attempts
spent) distinctly from a server failure (`failed` + `server`, "attempt N of 8"),
the exact §4.4 lie the `offline` state exists to prevent. `null` when
`state ∉ {failed, dead-letter}`; parsing `lastError` for the class stays forbidden
(INV-RF-1). Required on `UploadJob` (mirrors the "every field required, nullability
carries absence" convention the schema already follows).

### Mock adapter (kept in lockstep — the mock must never lag the contract)

- **CG-5:** mock `listRecordings` honours `q` (title `includes`) and, for admins
  only, `ownerUserId`; ownership stays the server's filter (C-1), never the
  client's.
- **CG-7:** mock `retryMergeRecording` is admin-gated, refuses `409` unless
  `mergeState = failed`, and drives the seeded `merge failed` recording (Lecture
  8) back to `merging`. The real client throws `NotImplemented` via the operation
  loop, as designed for Phase 2.
- **CG-21:** mock `createExport` refuses `export.insufficient-space` when the
  target lacks room; the seed now offers **two** USB volumes (one deliberately too
  small — `LECTURE-STICK`, 0.9 GB free) so the picker must ask the user (EXP-D-1)
  and both the per-card check and the refusal are reachable.
- **CG-20:** every seeded `UploadJob` carries `failureClass`; two new recordings +
  jobs make both new row-states reachable — an **offline** job (`failed` /
  `connectivity`, `attempt = 0`) and a **server-failed** job (`failed` / `server`,
  `attempt = 3`). Richer scenario scripting (a live `wan-loss`, `usb-pull`) stays
  Wave 5 plan-run work per each design doc's §10 "Mock & scenario work Wave 5
  inherits"; the catalog was not forked.

### Verification

| Check | Result |
|---|---|
| `packages/shared` codegen re-run from the amended contract | `types.gen.ts` + `zod.gen.ts` regenerated; `UploadFailureClass`, `UploadJob.failureClass`, `export.insufficient-space`, the `q`/`ownerUserId` params and `retryMergeRecording` all present |
| `pnpm typecheck` (4 projects) | pass (after the CG-21 exhaustive-switch `case` was added) |
| `pnpm test` | **1092 pass** — shared 24 (incl. 3 new CG-20/CG-21 assertions), api-client 257, panel 801, quiz 10; 0 fail |
| Contract-honesty gate | every mocked `listRecordings`/`listUploadJobs`/`getUploadJob`/`createExport` validates against the regenerated zod schemas, including `failureClass` |

---

## 0.3.0 → 0.4.0 — 2026-08-08 · Wave 4 (AI & quiz) gate

Carries **CG-19**, the one gap the S-20 (Quiz join / QR card) wireframe gate
answered. It is `Medium` and additive; Wave 4's plan run is unblocked by this
amendment. The W-4 gate required no other contract change — S-20 renders a
projection that already exists and issues no command.

Sources: [S-20 §9](screens/S-20-design.md#9-contract-changes-this-design-requires),
[open-decisions §8.2](../discovery/open-decisions.md#82-contract-change-this-design-requires--cg-19-additive-v04).

`info.version` `0.3.0` → `0.4.0`.

**`contracts/events.md` WAS touched — one WS-visible change.** §2.15's
`QuizSessionPayload` field list gains `syncState`, mirroring the field the REST
`QuizSessionProjection` already declares and requires. Its own version header
moves `0.3.0` → `0.4.0`. **`openapi.yaml`'s only change is the version string** —
its REST schema already carried `syncState` (the `QuizSyncState` enum on
`QuizSessionProjection`); the gap was solely that the WS payload did not mirror
it, so there is no schema diff there, only the `info.version` bump that keeps the
suite coherent.

### Amendment rows

| # | CG | Decision | Severity | Change |
|---|---|---|---|---|
| **A-9** | [CG-19](screen-inventory.md#10-contract-gaps) | S20-D-6 | **additive** (one field, mirrors an existing REST field) | `events.md` §2.15 `QuizSessionPayload` gains `syncState` (`synced`/`stale`/`failed`) |

---

#### A-9 · CG-19 · `QuizSessionPayload` — add `syncState`

*Additive.* One property, mirroring `QuizSessionProjection.syncState`
(`QuizSyncState` enum, already defined in `openapi.yaml`). The REST projection
already carries and **requires** `syncState`; this amendment brings the WS
`quiz.session` payload into line so the joined-count staleness (Machine 4d,
Z-30) is knowable **live**, not only on a REST snapshot. Without it, a device
whose `sync.participants` stream has gone quiet keeps broadcasting the last
`joinedCount` as current — the "display stale as live" failure QZ-7 / INV-AP-2
forbid, and the reason S-20's `stale` state (S-20 §2.4 / §5.1) is otherwise
unreachable over the socket.

No existing field changes meaning; no producer that validated before this
amendment now fails (the field is an addition, and core-api's Machine 4a/4d
already holds the value it emits).

---

## 0.2.0 → 0.3.0 — 2026-08-05 · Wave 2 (Recording core) gate

Carries **CG-14 … CG-17**, the four gaps the S-06 and S-12 wireframe gates
answered. All four are `Medium`/`Low` and additive; Wave 2's plan run is
unblocked by this amendment. **CG-6 is also resolved by this gate** (§10.1)
but closes as a *confirm* — no `POST /device/restart` — so it carries no row
here; there is nothing to diff.

Sources: [S-06 §9](screens/S-06-design.md#9-contract-changes-this-design-requires-v03),
[S-12 §9](screens/S-12-design.md#9-contract-changes-this-design-requires-v03),
[open-decisions §6.2](../discovery/open-decisions.md#62-contract-changes-these-decisions-imply-v03).

`info.version` `0.2.0` → `0.3.0`.

**`contracts/events.md` WAS touched — two WS-visible changes.** §2.1's
`RecordingStatePayload` field list gains the two CG-14 fields (it mirrors
`RecordingStateSnapshot` field-for-field), and §2.10's `system.alert` emitter
list gains R-22 (CG-17). Its own version header moves `0.1.0` → `0.3.0` (it
was never bumped for 0.2.0, correctly — nothing in that amendment touched a
WS event).

### Amendment rows

| # | CG | Decision | Severity | Change |
|---|---|---|---|---|
| **A-5** | [CG-14](screen-inventory.md#10-contract-gaps) | S06-D-4 (open-decisions: S06-D-6a/b) | **additive** | `RecordingStateSnapshot` + `RecordingStatePayload` gain `takeoverAt`, `takeoverByDisplayName` |
| **A-6** | CG-15 | S06-D-5 | **additive** (newly declared refusal; schemas unchanged) | `updateAudioControl` guarded with G-AUTH-OWNER while non-terminal; declares `403 not-authorized` |
| **A-7** | CG-16 | S12-D-2 | **behavioral** (prose only; no schema change) | `powerOffDevice` description states it has no resolving event — the transport closing is the resolution; `resolveBySec` becomes the *not-halted* threshold |
| **A-8** | CG-17 | S12-D-3 | **additive** (one entry in an existing list) | `events.md` §2.10 `system.alert` emitter list gains R-22 |

---

#### A-5 · CG-14 · `RecordingStateSnapshot` / `RecordingStatePayload` — `takeoverAt` + `takeoverByDisplayName`

*Additive.* Two nullable properties; no existing field changes meaning or
becomes required-then-absent (both new fields are additions to the `required`
array, but only because this contract requires every declared property to be
explicit-nullable rather than optional — the wire shape for an existing
producer that omits them would already fail validation *before* this
amendment too, so nothing that validated before now fails).

```diff
   RecordingStateSnapshot:
-    required: [state, …, pauseCount, takeoverBy, errorCode, errorMessage]
+    required: [state, …, pauseCount, takeoverBy, takeoverAt, takeoverByDisplayName, errorCode, errorMessage]
     properties:
       …
       takeoverBy:
         oneOf: [{ $ref: '#/components/schemas/Ulid' }, { type: 'null' }]
+      takeoverAt:
+        oneOf: [{ $ref: '#/components/schemas/Instant' }, { type: 'null' }]
+      takeoverByDisplayName:
+        type: [string, 'null']
```

Plus `events.md` §2.1's `RecordingStatePayload` field list (prose only — the
payload itself is the hand-authored zod mirror in `packages/shared`, not a
generated schema).

**Frontend obligations (Wave 2)**
- S-06's `use-recorder-lock.ts` reads these on the snapshot to name *who* took
  over and *when* — states 6, 7 and 9 ([S-06 §5](screens/S-06-design.md#5-states)).
  A displaced lecturer cannot call `listUsers` (admin-only) to resolve the bare
  `takeoverBy` ULID any other way (S06-D-4).
- The displaced-owner notice and the new-owner strip both consume
  `takeoverByDisplayName`/`takeoverAt` directly — no client-side lookup.

**Zod obligation — done in this run**
- `packages/shared/src/schemas/generated/` regenerated from the amended
  contract (`pnpm --filter @eduscope/shared codegen`) — `zRecordingStateSnapshot`
  carries both fields.
- `packages/shared/src/schemas/events.ts`'s hand-authored `zRecordingStatePayload`
  (events.md is not codegen'd) gains `takeoverAt: zEventInstant.nullable()` and
  `takeoverByDisplayName: z.string().nullable()`, matching the REST shape
  field-for-field as the contract's Conventions block requires.
- `packages/shared/test/rest-coverage.test.ts`'s `idle` snapshot fixture
  updated with both new fields (a `required`-array addition makes an
  incomplete fixture a test failure, which is the point).

**Mock obligations — done in this run**
- `mock/machines/recording.ts`'s `recording.state` payload builder reads
  `session.takeoverAt` / `session.takeoverByDisplayName` off `world.data`,
  mirroring the existing `takeoverBy` read.
- `mock/rest/recording.ts`'s `takeoverRecording` sets all three
  (`takeoverBy`/`takeoverAt`/`takeoverByDisplayName`) from the **acting**
  admin (`currentUser(ctx)`) *before* scheduling R-21 — R-21 itself carries no
  per-call data, the same reasoning `acknowledgeAlert` already uses for
  `acknowledgedBy`. `ownerUserId` is untouched (C-1).
- **Pre-existing gap closed as a prerequisite, not a new decision:**
  `startRecording` never set `session.ownerUserId`/`ownerDisplayName` at all —
  every session was ownerless in the mock, so LP-6 mutual exclusion (which
  CG-14/CG-15 both assume) had nothing to compare against. `mock/rest/recording.ts`'s
  `startRecording` now records the caller as owner before accepting, from
  `currentUser(ctx)`. This is mechanical (the schema already declared the
  fields; nothing previously wrote them) and required for CG-15's guard to be
  meaningful rather than vacuous — see the note under A-6.
- **S-06 §10's "no seeded second user is an owner" gap** (states 1, 2, 9
  unreachable): `MockWorld` gains a seed-only `seedState(machine, state)`
  escape hatch (bypasses `apply()`'s legality check, runs no effects — a live
  command must still always go through `apply()`), and `create-mock-client.ts`'s
  `bootstrapFromSeed` now consumes the previously-inert `WorldSeed.recordingOwnedByOtherUser`
  flag: when set, it seeds a session already `recording`, owned by `a.perera`
  (the seed's canonical lecturer — every past `Recording` fixture is already
  theirs), reachable by logging in as anyone else. **No script sets this flag
  yet** — see "Flagged, not decided here" below.

---

#### A-6 · CG-15 · `updateAudioControl` — G-AUTH-OWNER guard

*Additive at the schema level* (a newly declared `403`; request/response
bodies unchanged), but a genuine new server-side refusal — recorded as
**additive** per S-06 §9 #2's own characterization, not reclassified here.

```diff
   /audio/controls/{roleId}:
     put:
       operationId: updateAudioControl
-      summary: Set gain/mute; applied to real hardware, result pushed as audio.control
+      summary: Set gain/mute; applied to real hardware, result pushed as audio.control — owner or admin only (G-AUTH-OWNER) while a session is non-terminal
       description: |
         Room Controls master mute writes the same `muted` field — one control,
         one truth (LP-14, [D-10]). 202 because application to the ALSA path is
         asynchronous; the audio.control event carries appliedState
         applied|failed (never assumed success — B-55/B-12 lessons).
+
+        v0.3, CG-15: while the recording session is non-terminal, only the
+        session owner or an admin may call this — `403 not-authorized`
+        otherwise. …
       responses:
         '202': { $ref: '#/components/responses/CommandAccepted' }
+        '403': { $ref: '#/components/responses/Problem' }
         '422': { $ref: '#/components/responses/Problem' }
```

`not-authorized` was already in `Problem.code`'s closed enum (used by
`takeoverRecording` and others) — no enum growth.

**Frontend obligations (Wave 2)**
- S-06 disables S-09/S-11's audio controls, **with the reason inline**, when
  `use-recorder-lock` reports `locked` — [S-06 §9 #2](screens/S-06-design.md#9-contract-changes-this-design-requires-v03),
  [§12](screens/S-06-design.md#12-requirements-this-screen-places-on-other-screens).
  Client-side disabling is convenience; this row is what makes it honest
  (B-15 was exactly a client-only version of this same control).

**Mock obligations — done in this run**
- `mock/rest/sources.ts`'s `updateAudioControl` throws `403 not-authorized`
  when the recording machine is non-terminal (`isRecordingNonTerminal`, a new
  shared helper in `mock/machines/recording.ts` — non-terminal = not
  `idle`/`completed`/`error`, read off the machine's own `terminal`/`initial`
  rather than a second hardcoded list) **and** the caller is neither the
  session owner nor an admin. No non-terminal session means no guard (S-06 §9
  #2's own carve-out).
- This is the guard's **first** functioning owner comparison in the mock —
  see A-5's note that `startRecording` previously never set an owner at all,
  which this guard would otherwise have made vacuously-always-true for anyone
  but an admin.
- Covered in `test/mock/v0-3-wave2-gate.test.ts` (new — this gap had zero
  prior coverage): refused for a non-owner non-admin while recording, allowed
  for the owner, allowed for an admin, not gated with no active session.

---

#### A-7 · CG-16 · `powerOffDevice` — no resolving event

*Behavioral, prose only.* No path, schema or response changed — only the
operation `description`, clarifying what `CommandAccepted.resolveBySec`
means for this one operation.

```diff
   /device/power-off:
     post:
       operationId: powerOffDevice
       summary: LP-13 confirmed power-off — REFUSED server-side while a session is non-terminal (R-22)
+      description: |
+        v0.3, CG-16: this command has NO resolving event. … The transport
+        closing IS the resolution.
       responses:
```

**Frontend obligations (Wave 2)**
- S-12's `accepted` terminal state suppresses U-2 (the WS-drop reconnect
  banner) — the drop is the success signal, not a fault
  ([S-12 §5](screens/S-12-design.md#5-states) states 7/8, S12-D-6). That flag
  lives in `apps/panel/src/store/connection.ts`, owned by S-12's own build —
  not touched by this amendment.
- `accepted, not halted` (state 8) offers exactly one **Try again**, never an
  automatic retry (S12-D-5).

**Mock obligations — done in this run**
- `mock/rest/device.ts`'s `powerOffDevice` rewritten: previously it **always
  accepted**, regardless of recording state, with a comment noting the
  browser mock couldn't simulate a real halt — a placeholder that predates
  S-12's wireframe and no longer matches R-22's actual contract ("refused
  server-side while non-terminal"). It now:
  1. Refuses `409 poweroff.refused` while `isRecordingNonTerminal`, firing R-22
     (see A-8) as the cross-panel alert carrier.
  2. Otherwise accepts, and — unless a scenario forces `replace: 'stall'`
     (new, see below) — schedules the mock's connection controller to close
     the transport 1.5 s later (`ConnectionController.closeForShutdown`, new;
     the `'closed'` phase already existed in `stream.ts`'s `ConnectionStatus`
     type but was never emitted anywhere).
- `commands.ts`'s `COMMAND_PLANS` no longer auto-fires R-22 on every
  `powerOffDevice` call (it fired unconditionally before, including on
  success — backwards from R-22's actual role as the *refusal's* alert).
- **New scenario primitive**, additive to the existing `refuse`/`unreachable`
  vocabulary: `ForcedTransition.replace: 'stall'` + `ScenarioEngine.onStall()`
  — accepts the command normally but suppresses its resolving side effect.
  Needed because CG-16's whole point is that `powerOffDevice` has no
  resolving *event* to force via the existing `intercept`/`onCommand`
  mechanisms; `'stall'` is the only way a scenario can reach S-12 §5 state 8
  at all.
- `RestContext` gains an optional `connection?: ConnectionController` (optional
  so hand-built test contexts without a live connection keep typechecking;
  only `powerOffDevice` reads it). `create-mock-client.ts` builds the
  connection controller before `rest` now (previously after) so it can be
  threaded through.
- Covered in `test/mock/v0-3-wave2-gate.test.ts` (new): refuses + alerts while
  recording, accepts + closes the transport while idle, `'stall'` suppresses
  the close so `resolveBySec` elapsing reads as not-halted.

---

#### A-8 · CG-17 · `system.alert` emitter list — add R-22

*Additive.* One entry in an existing, closed list.

```diff
-    | Emitter | Every raising/clearing transition: R-02/R-04/…/R-20, RA-04, … |
+    | Emitter | Every raising/clearing transition: R-02/R-04/…/R-20/R-22, RA-04, … |
```

**Frontend obligations (Wave 2)**
- S-03's banner host already has a `poweroff.refused` row (screen-inventory
  §2 S-03) — this row is what licenses it on paper. S-12 itself reads the
  synchronous `409`, not the alert, and **suppresses** the banner while its
  own overlay is open (S12-D-3) — the alert is for the *second* panel.

**Mock obligations — done in this run**
- Covered by A-7's fix: R-22 now fires (`alert('poweroff.refused', 'info')`,
  unchanged) exactly when `powerOffDevice` refuses, which is also the only
  time `system.alert{poweroff.refused}` should exist. Asserted directly in
  `test/mock/v0-3-wave2-gate.test.ts`.

---

### Scenario catalog

**No new script.** Both mock gaps this gate needed were reachable by
extending existing infrastructure, per S-06 §10 and S-12 §10's own framing
("a forced-transition hook rather than an eighth script"):

| Mechanism | Reaches |
|---|---|
| `ForcedTransition.replace: 'stall'` (new primitive, extends the existing `refuse`/`unreachable` vocabulary) | S-12 §5 state 8, `accepted, not halted` |
| `MockWorld.seedState` + `WorldSeed.recordingOwnedByOtherUser` (now wired; previously declared but inert) | S-06 §5 states 1, 2, 9 — the locked view |
| `extendScenario('happy', { on: { command: 'takeoverRecording' }, … })` (existing hook, unchanged) | S-06 §5 states 3–8, once a screen needs to force the timing |

### Flagged, not decided here

**Which script(s) set `recordingOwnedByOtherUser: true`.** The flag is now
fully functional (A-5), but no script in the catalog enables it, so the
locked view is not yet reachable from the dev overlay by name — only via a
test that builds a `MockWorld` directly. Setting it on `happy` was considered
and rejected here: `happy`'s current job is the idle→recording→…→completed
demo (Wave 2's own exit condition, "J-1 happy … demo end-to-end"), and
seeding an already-owned-by-someone-else live session would start that
journey mid-flight instead of at `idle`, for anyone who does not log in as
`a.perera`. No existing script's *description* fits a locked view either —
each already demonstrates a specific failure mode unrelated to ownership.
This is a screen-authorship decision (S-06's own plan run), not a contract
one, and is exactly what `frontend-conventions.md` §4 assigns to the screen
that needs the state — flagging rather than choosing, per this run's own
"present options, don't design" rule. Two options, in order of fit:

1. **Recommended:** S-06's plan run adds a **ninth script** (e.g. `locked-view`)
   whose only job is `seed: { recordingOwnedByOtherUser: true }` on top of
   `happy`'s otherwise-default seed — new script, but for a state
   (second-owner/admin/third-party viewpoints) no existing script's name or
   description covers, which is the "add an eighth [here, ninth] script"
   exception the catalog rule already allows for a genuinely new class of
   state, not a variation of one.
2. **A per-switch seed override** on `switchScenario`/`createMockClient`
   (e.g. a second parameter merged over the chosen script's `seed`), so the
   dev overlay can toggle it independent of scenario name. Larger API surface
   change to `MockClient`/`createMockClient` for a single boolean; not done
   here.

### Verification

| Check | Result |
|---|---|
| `packages/shared` codegen re-run from the amended contract | `types.gen.ts` + `zod.gen.ts` regenerated; `takeoverAt`, `takeoverByDisplayName`, and the `updateAudioControl` `403` all present |
| `pnpm --filter @eduscope/shared typecheck` + `test` | pass (21 tests, incl. the updated `rest-coverage.test.ts` fixture) |
| `pnpm --filter @eduscope/api-client typecheck` + `test` | pass (215 tests, incl. 10 new in `test/mock/v0-3-wave2-gate.test.ts` covering all four CG rows plus the `seedState` primitive) |
| `pnpm --filter @eduscope/panel typecheck` + `test` | pass (193 tests) — confirms nothing downstream of `packages/shared`/`packages/api-client` regressed |
| Contract-honesty gate | every new/changed mock response (`RecordingStateSnapshot`, the two new `Problem` shapes) still runs through `validated()` against the generated zod schemas |

---

## 0.1.0 → 0.2.0 — 2026-08-04 · Wave 1 (Auth & shell) gate

Carries **CG-10 … CG-13**, the four gaps the S-01 and S-02 wireframe gates
answered. All four were `Blocking`/`Medium` against Wave 1; Wave 1's plan run is
unblocked by this amendment.

Sources: [S-01 §9](screens/S-01-design.md#9-contract-changes-this-design-requires-v02),
[S-02 §9](screens/S-02-design.md#9-contract-changes-this-design-requires-v02),
[open-decisions §5.2](../discovery/open-decisions.md).

`info.version` `0.1.0` → `0.2.0`.

**`contracts/events.md` was NOT touched — no WS event changed.** All four
amendments live on the REST surface. `auth.session-revoked` is a `Problem`
code, not an event; there is no auth or session event in the catalog. The
events.md version table is deliberately left at `0.1.0`.

### Amendment rows

| # | CG | Decision | Severity | Change |
|---|---|---|---|---|
| **A-1** | [CG-10](screen-inventory.md#10-contract-gaps) | S01-D-3 | **additive** (response enum widened) | `Problem.code` gains `auth.account-disabled` |
| **A-2** | CG-11 | S01-D-5 | **additive** | `Problem.meta.reason` declared; new `SessionRevokedReason` enum |
| **A-3** | CG-12 | S02-D-1 | **breaking** (request validation tightened) | `ChangePasswordRequest.newPassword` gains a composition `pattern` |
| **A-4** | CG-13 | S02-D-3 | **behavioral** (prose; no schema change) | `/auth/logout` added to the `mustResetPassword` exemption list |

---

#### A-1 · CG-10 · `Problem.code` — add `auth.account-disabled`

*Additive.* Widens a response enum. Not source-breaking for producers; it **is**
breaking for any consumer doing an exhaustive `switch` on `Problem['code']`,
which is why `Problem.code` is documented as a closed set whose growth is a
version bump.

```diff
           enum:
             - auth.invalid-credentials
+            - auth.account-disabled
             - auth.session-revoked
```

Plus a `description` on `login` fixing the ordering, which is a security
property rather than a nicety: the credential pair is checked **first**, so
`auth.account-disabled` is only ever returned to someone who already has the
password. That is the narrow enumeration S01-D-3 accepted, and no wider one.

**Frontend obligations (Wave 1)**
- S-01 renders the `disabled account` state — a **warning**, not an error
  ([S-01 §5](screens/S-01-design.md#5-states)); copy: *"This account is not
  active — ask your administrator."*
- Any `Problem.code` switch in `apps/panel` must handle the new member; the
  generated union makes an unhandled one a type error, not a runtime surprise.

**Mock obligations — done in this run**
- `mock/rest/auth.ts` · `login` checks `user.disabled` after the credential
  pair and throws `401 auth.account-disabled`. No session is created.
- `mock/seed/users.ts` · fourth seed user `r.fonseka` / `Correct-horse-9`,
  `disabled: true`, so the state is reachable from a fresh mock with no scenario.

---

#### A-2 · CG-11 · `Problem.meta.reason` + `SessionRevokedReason`

*Additive.* `meta` stays `additionalProperties: true`; one key gains a declared
shape. **The closed `code` enum is untouched** — that was the point of S01-D-5.

```diff
         meta:
           type: object
-          description: Named-reason detail (e.g. unbound roleId; recorder owner for LP-6). Never secrets (INV-ST-1).
+          description: |
+            Named-reason detail (…). Still open-ended; `reason` is the one key
+            with a declared shape (v0.2, CG-11 / S01-D-5).
+          properties:
+            reason:
+              allOf:
+                - $ref: '#/components/schemas/SessionRevokedReason'
           additionalProperties: true

     # ── enums (closed sets — adding a value is a contract bump) ──
+    SessionRevokedReason:
+      type: string
+      enum: [expired, logout, takeover, admin]
```

The contract states that `reason` is set on `auth.session-revoked` **only, and
on every occurrence of it** — a sometimes-present reason would leave S-01 with
the vague wording the gap exists to remove.

**Frontend obligations (Wave 1 + Wave 2)**
- S-01's `session expired` state words four cases from `meta.reason`
  ([S-01 §6](screens/S-01-design.md#6-copy-deck)); `logout` renders **no
  message** — the user meant to.
- **S-06 (W-2)** must read the same vocabulary so a takeover reads identically
  on both sides of R-21 ([S-01 §12](screens/S-01-design.md#12-requirements-this-screen-places-on-other-screens)).
  This row is the shared definition; S-06 does not get its own.

**Zod obligation — done in this run**
- `packages/shared/src/schemas/rest.ts`'s `zProblem` override previously
  **replaced** `meta` with a bare catchall object, which would have discarded
  the newly-typed `reason`. It is now built *from* the generated shape
  (`.shape.meta.unwrap().catchall(z.unknown())`), keeping both the declared key
  and the open-ended remainder. Any future declared key in `meta` needs no edit
  there.

**Mock obligations — done in this run**
- `refreshToken` emits `meta: { reason: 'expired' }` on `auth.session-revoked`.
- `takeover` is reachable only through the scenario engine (below).

---

#### A-3 · CG-12 · `ChangePasswordRequest.newPassword` — legacy parity

***Breaking.*** A request body that validated under 0.1.0 (`"password"`,
`"12345678"`) is refused under 0.2.0 with `422 validation.invalid`. Nothing in
the repo sends such a body today, so the practical blast radius is the seeded
credentials only — but it is a real narrowing and is recorded as breaking.

```diff
-        newPassword: { type: string, minLength: 8, maxLength: 256 }
+        newPassword:
+          type: string
+          minLength: 8
+          maxLength: 256
+          pattern: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)'
```

Length stays in `minLength`/`maxLength` and the `pattern` carries **only** the
three composition lookaheads, so the length rule is stated once and cannot
drift against itself.

**Frontend obligations (Wave 1)**
- `password-policy.ts` is the single client mirror and must accept and reject
  exactly this set. S-02's testing floor already requires a test asserting the
  mirror and the server agree — that test is the gate on this row.
- `rejected (policy)` (`422`) stays implemented even though a correct mirror
  makes it unreachable in practice ([S-02 §5](screens/S-02-design.md#5-states)).
- S-33 (user import) inherits the same rule.

**Mock obligations — done in this run**
- `mock/rest/auth.ts` · `changePassword` validates the body with
  `zChangePasswordRequest` — the schema **generated from this contract**, not a
  hand-written regex — and throws `422 validation.invalid`. The mock validator
  therefore cannot drift from the rule the client mirrors.
- Body validation runs **before** the current-password check: a `422` is about
  the request, a `401` about the user.
- The seeded temp credential `temp-pass-1` is unchanged — the policy constrains
  `newPassword` only, so the forced-reset demo account still logs in.

---

#### A-4 · CG-13 · `/auth/logout` exempt from the reset lock

*Behavioral.* Prose only — no schema, no path, no operation changed. It widens
what is permitted, so it cannot break an existing client.

```diff
       `403 not-authorized`. While `mustResetPassword` is true, every surface
-      except `/auth/change-password` and `/auth/me` answers
-      `403 auth.password-reset-required` (INV-U-3).
+      except `/auth/change-password`, `/auth/me` and `/auth/logout` answers
+      `403 auth.password-reset-required` (INV-U-3). `/auth/logout` is exempt
+      because revoking your own session is not what the reset lock protects …
```

Plus the matching `description` on the `logout` operation, so the exemption is
visible where it is used and not only in the Conventions preamble.

**Frontend obligations (Wave 1)**
- S-02's forced mode carries a real **Sign out** that calls `POST /auth/logout`,
  discards tokens, and navigates to `/login` with no message (`reason: logout`)
  — [S-02 §3](screens/S-02-design.md#3-sign-out-on-the-forced-screen).
- Sign out is **not** an escape from the reset: there is still no skip, no
  dismiss, and no route to the dashboard.

**Mock obligations — done in this run**
- `mock/rest/auth.ts` · `logout` is documented as never gated on
  `mustResetPassword`, and a test proves a user with `mustResetPassword: true`
  can log out. The mock has no reset lock on its other surfaces at all — that is
  pre-existing and out of this amendment's scope; only the exempt behaviour is
  asserted here, per S-02 §10's *"follow whichever way #4 resolves — and only
  that way"*.

---

### Scenario catalog

`auth-failures` appended to `packages/api-client/src/mock/scenario/` — the
catalog is **extended, never forked** (frontend-conventions §4). It carries the
two v0.2 states that no ordinary mock interaction can produce:

| Rule | Reaches |
|---|---|
| `refreshToken` → `401 auth.session-revoked`, `meta.reason: takeover` | S-01 `session expired`, takeover wording (R-21) |
| `changePassword` → `422 validation.invalid`, `nth: 1` | S-02 `rejected (policy)` with a *compliant* password — the case a correct client mirror can never produce. `nth: 1` so the retry succeeds and the demo recovers |

The other v0.2 states need no script: `disabled account` is reachable by logging
in as `r.fonseka`, and Sign out works because `/auth/logout` is exempt.

**Two follow-ups this creates, neither owned by this run:**

1. **The catalog is now eight, not seven.** `frontend-conventions.md` §4 and
   `screen-inventory.md` §11 (Wave 0 exit condition) both enumerate the
   seven-script Wave-0 catalog. Both instruct that it be extended, so the
   addition is in line with them, but the two literal lists are now one entry
   short. They are approved design docs — **flagged for their owner, not edited
   here.**
2. **S-01's `backend unreachable` is still not scenario-reachable.** It is a
   transport failure (network error / the 10 s ceiling), not a named `Problem`,
   and the scenario engine has no transport-level primitive — only
   `intercept(transition)` and `onCommand(operationId) → Problem`. Adding one is
   a scenario-engine change, not a contract amendment. It stays **Wave 1 work**,
   as S-01 §10 assigns it.

### Verification

| Check | Result |
|---|---|
| `packages/shared` codegen re-run from the amended contract | `types.gen.ts` + `zod.gen.ts` regenerated; `SessionRevokedReason`, the new code, and the `newPassword` regex all present |
| `pnpm typecheck` (4 projects) | pass |
| `pnpm test` (32 files) | **297 pass**, including 14 new assertions in `test/mock/auth-v0-2.test.ts` (one per amendment) and 3 new in `packages/shared/test/rest-coverage.test.ts` |
| Contract-honesty gate | every mock refusal in the new tests is parsed with `zProblem` as well as inspected |

### Follow-up found in passing — fixed 2026-08-04

`SEED_CREDENTIALS` in `mock/seed/users.ts` was a module-level mutable map:
unlike `createSeed()`, it was **not** rebuilt per mock client, so a successful
`changePassword` (or `updateUser`) changed the password for every later test and
every later `createMockClient()` in the same process.

Fixed at the mock rather than at each caller: it is now
`createCredentialStore()`, minted per client in `create-mock-client.ts` beside
`createSeed()` and reached through `RestContext.credentials`. It stays a sibling
of `Seed`, never a member — no entity in the contract-valid graph may carry a
password (INV-U-1). `switchScenario` rebuilds it along with the world, so a
scenario switch also discards a changed password.

Callers updated: `rest/auth.ts` (`login`, `changePassword`) and `rest/users.ts`
(`createUser`, `updateUser`). The snapshot-and-restore `beforeEach` workaround
is gone from `auth-v0-2.test.ts`, replaced by two regression tests — one for
cross-client leakage, one for `switchScenario` — both confirmed to fail against
a shared store.

---

## 0.5.0 → 0.6.0 — 2026-08-11 · Wave 7 (Student quiz app) gate

Carries exactly the five answered Wave 7 rows: **CG-1, CG-22, CG-23, CG-24,
CG-25**. The main `openapi.yaml` version and the new `quiz-app.yaml` version are
`0.6.0`. `contracts/events.md` **did change** because CG-22…CG-25 amend the
student WebSocket contract. No projector/CG-2 or other open gap is included.

Authoritative registration policy supplied for SQO-1 on 2026-08-11:
`^[A-Z]{2}[0-9]{7,8}$`, strict uppercase, `inputMode=text`, maximum 10
characters, hint "Two uppercase letters followed by 7 or 8 digits"; full name
keeps the existing domain maximum of 128.

### Amendment rows

| CG | Decision id | Severity | Exact old → new diff | Frontend obligation | Mock obligation |
|---|---|---|---|---|---|
| **CG-1** | **SQ-D-1, SQ-D-2, SQ-D-3, SQ-D-4** | **additive** | **Old:** no student REST contract; `openapi.yaml` listed join/register/answer as an open surface and `quiz-app-client.ts` carried provisional handwritten shapes and `^[A-Z]{2}\d{8}$`. **New:** `contracts/quiz-app.yaml` defines `resolveJoinCode`, `registerParticipant`, `submitAnswer`; the Secure/HttpOnly/SameSite=Lax `eduscope_participant` cookie; confirmed `RegistrationPolicy`; created/rejoined and accepted/already-accepted outcomes; named `quiz.session-not-found`, `quiz.unavailable`, `quiz.session-closed`, `registration.invalid-name`, `registration.invalid-student-id`, `question.closed`, and `answer.invalid-option` problems with field pointers. `openapi.yaml info.version: 0.5.0 → 0.6.0` and its open-item prose now links the contract. | Route anonymous/returning/closed directly; render the returned policy and named problems; use `{fullName,studentIdNumber}` and `{selectedOptionId}`; rely on the cookie rather than browser-readable participant credentials; first answer locks immediately and server outcome wins races. | Validate every response/request with generated quiz schemas; reach case-insensitive resolution, created/rejoined, both invalid fields, closed/unavailable/not-found, accepted/duplicate/invalid/closed and request-reply loss. |
| **CG-22** | **SQ-D-2, SQ-D-5** | **additive** | **Old:** events.md only said student events used "its own realtime channel"; no URL, auth, backoff, or snapshot boundary/order. **New:** events.md §5 defines `GET /api/student/v1/stream`, participant-cookie auth, 0.5→10 s unlimited reconnect, server→student envelope, and atomic connect sequence `quiz.session → quiz.participant → exactly one quiz.question → applicable quiz.result → live deltas`. | Buffer each connect snapshot and replace student state atomically; never merge into stale question/result state and never queue offline answers. | `connect()` emits and returns the ordered complete snapshot; `student-quiz-reconnect` exposes offline then atomic reconnect through the shared catalog. |
| **CG-23** | **SQ-D-5** | **breaking** | **Old:** one `quiz.question` object required `publicationId`, `prompt`, `options` for every `state: open\|closed\|none` and called the nullable value `ownAnswer`. **New:** strict discriminated variants: `open\|closed` require publication, prompt, 2–4 options and `ownAnswerOptionId`; `none` permits only `{state:'none'}`. | Branch on `state` before reading question fields; treat `ownAnswerOptionId` as an option id; waiting/reconnect must accept the fieldless `none` variant. | Catalog snapshots expose 2-, 3-, and 4-option variants plus `none`/closed; zod rejects question fields on `none` and option counts outside 2–4. |
| **CG-24** | **SQ-D-6** | **additive** | **Old:** `quiz.result` carried only `publicationId,isCorrect,correctOptionId,pointsAwarded,runningScore,ownRank`. **New:** adds required `question:{prompt,options[{id,label,text}]}`, `selectedOptionId: Ulid\|null`, and `rankState: pending\|current`; existing fields remain. | Render S-40 entirely from the result; `selectedOptionId=null` means missed; show rank-updating from `rankState=pending`; never depend on S-39 memory. | Catalog reaches correct/current, incorrect/pending and missed/current results after cold connect and validates each complete payload. |
| **CG-25** | **SQ-D-5; S-41 §7 ruling** | **breaking** | **Old:** one student `quiz.session` object had `state: open\|closed` plus nullable `finalScore`, `finalRank`, `answeredCount`, with no participation discriminator. **New:** strict variants: open permits final fields absent/null and has no participation field; closed/participated requires non-null score/rank and `answeredCount>0`; closed/none requires `finalScore=0, finalRank=null, answeredCount=0`. | Branch on `participationState`; render participated own summary versus gentle never-answered terminal state; do not infer zero from missing data. | `student-quiz-happy` reaches participated terminal data and `student-quiz-closed` reaches the exact zero/none summary; zod rejects contradictory combinations. |

### Generated layer and mock lockstep

- `packages/shared` codegen now runs against both OpenAPI files. Core output was
  regenerated from `openapi.yaml`; student output lives in
  `src/schemas/quiz-generated/` and is explicitly re-exported by
  `quiz-rest.ts` without duplicating the core `Ulid` export.
- `events.ts` supplies the strict CG-23/CG-25 discriminated unions and the
  additive self-contained result schema used by `StudentServerEvent`.
- The provisional quiz mock and its hard-coded regex were removed. The mock
  validates against generated REST zod plus shared event zod.
- The existing scenario catalog was extended, never forked, with
  `student-quiz-happy`, `student-quiz-returning`, `student-quiz-closed`,
  `student-quiz-reconnect`, and `student-quiz-failures`.
- The self-registration adapter no longer persists participant identity in
  `localStorage`; the HttpOnly cookie remains the durable rejoin truth.

### Verification

| Check | Result |
|---|---|
| Core + quiz OpenAPI generation | pass; main generated layer refreshed and `quiz-generated/{types,zod}.gen.ts` created from `quiz-app.yaml` |
| TypeScript | pass: `packages/shared`, `packages/api-client`, `apps/quiz` |
| Shared contract tests | **29 pass** |
| API client/mock/scenario tests | **288 pass** |
| Quiz app tests | **10 pass** |

No tag was created.
