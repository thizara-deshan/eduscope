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
