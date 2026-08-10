# S-38 Self-registration — two-field identity gate — wireframe & screen design

> Closes the S-38 part of **W-11**. Status: design complete, awaiting W-11
> approval. Exactly two fields and one primary action ship on this screen.

## 0. Evidence base

PRD INT-4/QZ-3 requires real name + valid-format student ID, format validation
only in V1. State-machines Z-11 and INV-SI-1/INV-QP-1 make student ID the stable
identity key and rejoin idempotent. Domain-model `StudentIdentity` bounds name at
128 and ID at 32, but `contracts/` has no registration operation or actual ID
format. No quiz `B-*` exists in the behavioral inventory.

## 1. Wireframe

```text
┌──────────────────────────────────────┐
│  ● EDUSCOPE                          │
│                                      │
│          Join the live quiz          │
│  Tell your lecturer who is answering.│
│                                      │
│  Your real name                      │
│  ┌────────────────────────────────┐  │
│  │                                │  │ ≥56 px
│  └────────────────────────────────┘  │
│                                      │
│  Student ID                          │
│  ┌────────────────────────────────┐  │
│  │                                │  │ ≥56 px
│  └────────────────────────────────┘  │
│  Used to keep your score and rank    │
│  with you in this quiz.              │
│                                      │
│  ┌────────────────────────────────┐  │
│  │        Join the quiz           │  │ ≥56 px
│  └────────────────────────────────┘  │
│  [field error / connection status]   │
│                                      │
│  (24 px safe bottom)                 │
└──────────────────────────────────────┘
```

The student-ID hint is contract data, not hardcoded campus lore. The form stays
on one viewport at 360×640; narrow/short devices may scroll the content region,
while the primary action remains above the safe bottom.

## 2. Component breakdown

| Component | Responsibility |
|---|---|
| `RegistrationForm` | Owns the two values, trims on submit, preserves them through recoverable errors |
| `PolicyField` | Applies server-supplied max length, input mode, pattern and human hint without inventing a format |
| `RegistrationSubmit` | One ≥56 px primary action; pending label `Joining…`; bounded failure |
| `FieldProblem` | Maps named contract problems to one field or the form; moves focus to the first invalid field |

## 3. States mapped to `state-machines.md`

| Screen state | Mapping | Rendering/transition |
|---|---|---|
| empty / filling | 4b `registering` after Z-10 | normal form; CTA disabled only when required values blank |
| invalid name | Z-11 guard false | inline `Enter your real name.` |
| invalid student ID | Z-11 guard false | contract-policy hint beside field; no roster claim |
| submitting | Z-11 in flight | fields retained and disabled; local pending CTA; no indefinite spinner |
| registered | Z-11 then Z-12 | secure participant cookie set; replace-route to S-39 |
| duplicate rejoin | INV-SI-1 + INV-QP-1 | server returns existing participant; same route to S-39, no duplicate-success fiction |
| session closed while registering | Z-15 wins race | route to S-41; never retry registration into a closed session |
| offline/retry | before authoritative Z-11 | keep both values; no queued submit; retry when online |

## 4. Tokens, touch and accessibility

No new token. Shared S-37 shell; `--surface`, `--border`, `--accent`,
`--danger-soft`, `--text*`, `--sp-3/7/10`, `--radius-md`; text ≥`--fs-md`.
Inputs and CTA are ≥56 px. Labels remain visible; placeholders do not substitute
for labels. `autocomplete="name"` is allowed for the name; student ID does not
claim an email/username autocomplete semantic. Errors use `aria-describedby` and
the form summary is `aria-live="polite"`.

## 5. Behavioral requirements preserved

INV-SI-1 (ID is the key), INV-SI-2 (no other identity/result is exposed),
INV-QP-1 (rejoin is unique), and Z-11 (format only, not roster verification).
No behavioral-inventory `B-*` applies; this replaces no legacy student form.

## 6. Testing/scenario floor

Empty, filling, each field invalid, submitting, created, duplicate rejoin,
closed race, service error and offline retention. The primary journey asserts
that the response sets the participant session and replaces to S-39; a privacy
test asserts the response contains no class/other-student data.

## 7. Contract changes this design requires

### CG-1 — registration slice of `quiz-app.yaml` (additive; blocking)

The new student contract must add an idempotent `registerParticipant` operation
for a resolved open session:

- request `{fullName, studentIdNumber}` with the domain-model length bounds;
- response `{quizSessionId, participantId, outcome: created | rejoined}` and a
  Secure/HttpOnly/SameSite=Lax participant cookie;
- `RegistrationPolicy{studentIdPattern, studentIdHint, inputMode,
  studentIdMaxLength, fullNameMaxLength}` returned during S-37 resolution;
- named `registration.invalid-name`, `registration.invalid-student-id`, and
  `quiz.session-closed` problems with field pointers.

This is **additive** and blocks all validation, duplicate-rejoin and successful
routing states. The policy shape settles the UI contract without inventing the
institute's still-unconfirmed ID pattern (recorded as SQO-1).

