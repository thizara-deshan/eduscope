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
