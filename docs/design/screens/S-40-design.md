# S-40 Result & own rank — read-only between-question result — wireframe & screen design

> Closes the S-40 part of **W-11**. Status: design complete, awaiting W-11
> approval. It shows only this student's result and rank.

## 0. Evidence base

PRD INT-2/4 and QZ-5/6 fix +10, own correctness, running score and own rank only.
State-machines Z-25/Z-26, INV-QP-2 and DM-10 fix missed semantics and dense rank.
The existing `quiz.result` event lacks the question/options and selected option,
so a cold/reconnected S-40 cannot name the revealed correct answer; `ownRank:null`
also cannot distinguish a one-second update from no rank. No quiz `B-*` applies.

## 1. Wireframes

```text
Correct                              Incorrect / missed
┌────────────────────────────────┐   ┌────────────────────────────────┐
│ ● EDUSCOPE       ● Connected   │   │ ● EDUSCOPE       ● Connected   │
│                                │   │                                │
│          ✓ Correct             │   │      Not this time             │
│             +10                │   │          +0                    │
│                                │   │                                │
│  Correct answer                │   │  Correct answer                │
│  B  Photosynthesis…            │   │  B  Photosynthesis…            │
│                                │   │                                │
│  Your score          30        │   │  Your score          20        │
│  Your rank           4         │   │  Your rank       Updating…     │
│                                │   │                                │
│  Waiting for the next question │   │  Waiting for the next question │
│  Keep this tab open.           │   │  Keep this tab open.           │
└────────────────────────────────┘   └────────────────────────────────┘
```

Incorrect also identifies `Your answer: A …`. Missed says `No answer received`
and never uses incorrect/error styling. Offline keeps the last authoritative
result visible with a reconnecting strip; it never clears a score to zero.

## 2. Component breakdown

| Component | Responsibility |
|---|---|
| `ResultVerdict` | Correct/incorrect/missed icon, words and points; no color-only meaning |
| `AnswerReveal` | Prompt context, own answer when present, correct label/text after close only |
| `OwnStanding` | Running score and own rank; explicit `Updating…` state |
| `NextQuestionWait` | Dominant keep-open instruction; transitions on next `quiz.question:open` |

## 3. States mapped to `state-machines.md`

| Screen state | Mapping | Rendering/transition |
|---|---|---|
| correct | Z-25, `isCorrect=true` | success verdict, +10, revealed answer, score/rank |
| incorrect | Z-25, `isCorrect=false` | neutral/danger-soft verdict, own + correct answers, +0 |
| missed | Z-26, `isCorrect=null` | `No answer received`; +0; accuracy wording absent |
| rank updating | result `rankState=pending` | score remains; rank reads `Updating…`, never `—` without explanation |
| awaiting next | post Z-25/Z-26 | dominant wait copy; next Z-20 replace-routes/state to S-39 |
| offline | Z-13 | last authoritative result remains, marked reconnecting; no live action |
| session closed | Z-15 | S-41 supersedes this screen |

## 4. Tokens, touch and accessibility

No new token. Correct uses `--success/--success-soft`; incorrect uses
`--danger/--danger-soft`; missed uses neutral `--surface-2/--text-muted` so
absence is not shamed. Score/rank use `--fs-3xl`; body is ≥`--fs-md`; cards use
`--surface`, `--radius-lg`, `--sp-7/10`, `--shadow-sm`. Verdict words and glyphs
carry meaning without color. There is no action target or auto-dismiss timer.

## 5. Behavioral requirements preserved

INV-SI-2 (own data only), INV-LB-2/DM-10 (own rank matches panel dense rank),
INV-QP-2 (missed is unanswered), INT-2 (+10 and no speed score), and
`correctOptionId` disclosure only after close. No legacy `B-*` applies.

## 6. Testing/scenario floor

Correct, incorrect, missed, rank pending/current, next question, offline and
session close. Privacy tests reject any payload/DOM containing a class list or
other identity. Cold-connect testing must render a complete result without
relying on S-39's in-memory question.

## 7. Contract changes this design requires

### CG-24 — self-contained `quiz.result` (additive; blocking)

Extend the student `quiz.result` payload with:

- `question:{prompt, options[{id,label,text}]}`;
- `selectedOptionId: Ulid | null` (`null` means missed);
- `rankState: pending | current`.

Keep `correctOptionId`, points, running score and own rank. These fields are
**additive** and reveal no other student. They block the correct-answer text,
incorrect own-answer comparison, deterministic missed state and honest
`rank updating` state after cold load/reconnect.

