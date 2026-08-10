# S-37 Join — mobile entry gate — wireframe & screen design

> Closes the S-37 part of **W-11**. Status: design complete, awaiting the W-11
> approval requested after this run. This screen is the QR/manual-code entry to
> the student quiz app; it never creates a participant by itself.

## 0. Evidence base

- `screen-inventory.md` S-37 and §6 fix the route, states, 360–430 px portrait
  viewport, ≥16 px text, one-handed use and flaky-link behavior.
- PRD QZ-1/QZ-2 and J-3 fix direct QR entry; INT-4 keeps student identity out of
  this screen.
- State-machines Z-10/Z-12/Z-15 fix routing: anonymous → S-38, returning → S-39,
  closed → S-41. INV-QP-1 forbids creating a second participant on rejoin.
- `contracts/` has no student REST route (CG-1). `QuizSessionCreateResponse` only
  proves that `joinCode` is opaque and at most eight characters.
- The behavioral inventory contains no student-quiz `B-*` behavior. This is
  net-new; no legacy behavior is silently carried forward.
- Frontend conventions and the inventory token sheet bind this screen to the
  existing light palette, spacing/type/radius scales and contract-validated
  client boundary.

## 1. Design decision

Use an **automatic route gate with a manual fallback**, not a landing page.
A valid QR should not cost an extra tap: resolve, then replace-route directly to
S-38 or S-39. The visible screen exists for resolving, manual entry and failures.
This is preferable to (a) a welcome page, which adds friction to every scan, and
(b) putting registration on this route, which conflates session resolution with
participant creation and makes rejoin harder to reason about.

## 2. Wireframe

```text
┌──────────────────────────────────────┐  360–430 px
│  ● EDUSCOPE                          │  56 px brand bar
│                                      │
│          Join the live quiz          │
│  Scan the room QR, or enter its code │
│                                      │
│  Quiz code                           │
│  ┌────────────────────────────────┐  │
│  │  AB12CD                        │  │  ≥56 px, ≤8 chars
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │             Join               │  │  ≥56 px
│  └────────────────────────────────┘  │
│                                      │
│  [status/error region in-place]      │
│                                      │
│  (reserved 24 px above browser UI)   │
└──────────────────────────────────────┘

Direct QR resolving:
┌──────────────────────────────────────┐
│  ● EDUSCOPE                          │
│                                      │
│          Joining the quiz…           │
│  ┌────────────────────────────────┐  │
│  │ skeleton in the code-card shape│  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

Invalid/expired code keeps the field and renders `That quiz code is not active.`
Unreachable/offline renders `We can’t reach the quiz service.` plus a full-width
`Try again` button. No raw status or exception text appears.

## 3. Component breakdown

| Component | Responsibility |
|---|---|
| `QuizMobileShell` | Shared brand bar, centered 360–430 px content column, safe-bottom padding, reconnect announcement host |
| `JoinResolver` | Reads route code, calls the contract client once, replace-routes from the authoritative outcome |
| `JoinCodeForm` | Opaque code input, trim + case-insensitive submission, max length from contract, full-width Join |
| `JoinStatus` | Shaped skeleton, invalid/closed/unreachable/offline copy; focus and `aria-live` management |

The code is treated as opaque: no grouping and no invented numeric-only keyboard.
Use `autocapitalize="characters"`, but the server remains case-insensitive.

## 4. States mapped to `state-machines.md`

| Screen state | Machine/event mapping | Rendering/transition |
|---|---|---|
| resolving | before Z-10; student REST resolution in flight | shaped skeleton; no full-screen spinner |
| open, new participant | Z-10 / 4b `anonymous → registering` | replace-route to S-38; no success interstitial |
| open, returning participant | INV-QP-1 + Z-12/Z-14 | replace-route to S-39 using the existing participant session |
| session not found | no machine instance | field remains editable; named not-active error |
| session closed | Z-15 / 4a `closed` | replace-route to S-41 terminal no-participation variant |
| service unreachable | request has no authoritative answer | retry in place; never reinterpret as not-found |
| manual code entry | UI-local | empty/filling/invalid; Join enabled only for non-blank input |
| offline/reconnecting | student equivalent of U-2 | retain code, disable Join, show reconnecting; never queue submission |

## 5. Tokens, touch and accessibility

No new token. `--bg`, `--surface`, `--border`, `--text*`, `--accent`,
`--danger-soft`, `--brand-red`, `--sp-3/7/10`, `--radius-md`, `--shadow-sm` and
the existing system font make this native beside prototype-derived screens.
Quiz text uses `--fs-md` or larger; title uses `--fs-3xl`. The input/primary
button are ≥56 px, focus uses the 3 px `--accent` ring, errors are text + icon
and never color-only. The content never occupies the bottom 24 px.

## 6. Behavioral requirements preserved

- INV-QP-1: resolution/rejoin never creates a participant.
- QZ-2/J-3: a QR scan is direct and costs no confirmation tap.
- U-2/U-5 principles: connectivity is not misreported as invalid input; nothing
  is queued while offline.
- No `B-*` applies; the evidence check found no legacy student quiz surface.

## 7. Testing/scenario floor

Rendering coverage: resolving, manual empty/filling, invalid/expired, closed,
returning, unreachable, offline/reconnecting. Journey coverage: QR → S-38,
returning QR → S-39, manual code retry. Contract honesty validates every mock
against the future `quiz-app.yaml`.

## 8. Contract changes this design requires

### CG-1 — student REST contract (additive; blocking)

Create `contracts/quiz-app.yaml`. S-37 needs a public, rate-limited, case-
insensitive `resolveJoinCode` operation returning:

- `quizSessionId` and `state: open | closed`;
- `participantState: anonymous | returning`, derived only from a valid secure
  participant session cookie;
- the registration-policy object consumed by S-38;
- named `quiz.session-not-found` and `quiz.unavailable` problems.

The same contract must define the Secure, HttpOnly, SameSite=Lax participant
cookie used by registration, REST answers and the student stream. This is
**additive** because no student REST contract exists. It blocks every S-37 route
outcome except a visual-only mock.

