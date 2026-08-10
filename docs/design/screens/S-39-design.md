# S-39 Play — one-tap locked answering — wireframe & screen design

> Closes the S-39 part of **W-11**. Status: design complete, awaiting W-11
> approval. This is the app's only write-heavy screen; the first accepted option
> is immutable.

## 0. Evidence base

PRD INT-2/3, QZ-4/5 and J-3 fix no timer, first tap final, +10 correct and an
explicit late-answer failure. State-machines 4b/4c Z-12…Z-26 and
INV-AN-1/INV-Q-2/INV-QPUB-4 bind reconnect, id-not-index submission and server
receive-time closure. `StudentServerEvent` exists, but the REST answer route and
student reconnect protocol do not; its `quiz.question{state:none}` shape is
internally impossible because question fields are still required. No quiz
`B-*` exists in the behavioral inventory.

## 1. Design decision

The screen is **one stable live surface**, not a per-question wizard. Waiting,
answerable, submitting, locked and rejected occupy the same question region so
realtime transitions never navigate or reset the browser. A confirm dialog is
rejected: it doubles taps and makes the first tap semantically ambiguous. A
brief press/release treatment gives immediate feedback, then the tapped card is
locked in place.

## 2. Wireframes

```text
Waiting                              Answerable
┌────────────────────────────────┐   ┌────────────────────────────────┐
│ ● EDUSCOPE       ● Connected   │   │ ● EDUSCOPE       ● Connected   │
│                                │   │                                │
│          Live quiz             │   │  Which statement best…?       │
│                                │   │                                │
│   Waiting for your lecturer’s  │   │ ┌────────────────────────────┐ │
│        next question.          │   │ │ A  First option            │ │ ≥64
│                                │   │ └────────────────────────────┘ │
│   Keep this tab open.          │   │ ┌────────────────────────────┐ │
│                                │   │ │ B  Second option           │ │ ≥64
│                                │   │ └────────────────────────────┘ │
│                                │   │ ┌────────────────────────────┐ │
│                                │   │ │ C  Third option            │ │ ≥64
│ (24 px safe bottom)            │   │ └────────────────────────────┘ │
└────────────────────────────────┘   └────────────────────────────────┘

Submitting / locked
┌────────────────────────────────┐
│  Which statement best…?       │
│ ┌────────────────────────────┐ │
│ │ B  Second option   Sending…│ │  accent plate, card inert
│ └────────────────────────────┘ │
│  Your answer is final.         │
└────────────────────────────────┘
```

`rejected — closed` replaces `Sending…` with `Question closed before your
answer arrived.` It never says the answer was accepted. A network failure before
reply returns to answerable with `We couldn’t confirm your answer. Tap again.`
The server response reconciles to the authoritative selected option if the
first request actually arrived.

## 3. Component breakdown

| Component | Responsibility |
|---|---|
| `QuizLiveHeader` | Brand + text connection state; no score/rank data dependency |
| `QuestionViewport` | Stable region switching waiting/question/rejected without route navigation |
| `AnswerOption` | Whole-card ≥64 px button, letter + text, pressed/submitting/locked state |
| `AnswerMutation` | Sends option **id**, never index; never queues offline; reconciles authoritative response |
| `ReconnectSnapshotGate` | Applies one atomic snapshot before rendering live deltas, preventing stale-question flashes |

## 4. States mapped to `state-machines.md`

| Screen state | Mapping | Rendering/transition |
|---|---|---|
| waiting | Z-12/Z-14 snapshot has `quiz.question:none` | calm waiting card; `Keep this tab open.` |
| answerable | Z-20 | prompt + 2–4 full-width options; **no timer** |
| submitting | Z-21 | tapped option optimistic accent lock; all options inert |
| locked | Z-22 | authoritative selected option remains highlighted; finality copy |
| rejected—closed | Z-23 / ¬G-PUBLICATION-OPEN | explicit late state; wait for missed/result transition |
| network error before reply | Z-24 | return to answerable with retry instruction; no hidden queue |
| missed | Z-26 | route/state transition to S-40 missed result; never incorrect |
| offline/reconnecting | Z-13 then Z-14 | retain last visual, dim/inert options, text marker; atomic snapshot on return |
| session closed | Z-15 | replace-route to S-41 |

## 5. Tokens, touch and accessibility

No new token. Option cards use `--surface`, `--border-strong`, `--radius-lg`,
`--sp-7`, `--shadow-sm`; selected uses `--accent-soft` + `--accent`; late/error
uses `--danger-soft`; waiting/offline uses `--surface-2`/`--text-muted`.
Prompt is `--fs-xl`; all other text ≥`--fs-md`. Each option is ≥64 px and the
whole card is the button. State is carried by word + border + icon, not color.
The press animation carries no information and disappears under reduced motion.

## 6. Behavioral requirements preserved

- INV-AN-1: unique participant/publication answer; second submit never overwrites.
- INV-Q-2/DM-7: selected option is sent as an ID.
- INV-QPUB-4: server receive time and authoritative `closedAt`, no client grace.
- INV-QP-2: missed is unanswered, never incorrect.
- INT-2: no countdown; response time remains invisible insight-only data.
- No legacy `B-*` applies.

## 7. Testing/scenario floor

Waiting, 2/3/4-option answerable, submitting, locked, duplicate response,
rejected closed, request-reply loss, missed, offline and atomic reconnect,
session closed. The headline race sends answer vs close in both orders and
asserts only the server outcome renders. A structural test asserts no timer and
no confirm dialog.

## 8. Contract changes this design requires

### CG-1 — answer operation in `quiz-app.yaml` (additive; blocking)

Add idempotent `submitAnswer` (participant cookie auth) with body
`{selectedOptionId}` and authoritative response
`{outcome: accepted | already-accepted, selectedOptionId}`. Declare
`question.closed` and `answer.invalid-option` problems. A duplicate for the same
participant/publication returns the stored option and never overwrites it.
This is additive and blocks Z-21…Z-24.

### CG-22 — student realtime transport and atomic resync (additive; blocking)

`contracts/events.md` must define the quiz-service student WS URL, participant-
cookie auth, reconnect backoff and an **atomic full snapshot on every connect**:
session → participant connection → exactly one current question (`open` or
`none`) → current own result when applicable, followed by live deltas. This is
additive and blocks honest Z-12/Z-14/offline rendering across S-39…S-41.

### CG-23 — discriminated `quiz.question` payload (breaking; blocking)

Replace the current single object with state-discriminated variants:

- `open|closed`: `publicationId`, `prompt`, 2–4 options and
  `ownAnswerOptionId: Ulid | null`;
- `none`: no publication/prompt/options fields.

Clarify that the own-answer value is an **option id**, not an answer-row id.
This is **breaking** to the current shared event type (although no production
student app consumes it yet) and blocks the waiting and reconnect states.

