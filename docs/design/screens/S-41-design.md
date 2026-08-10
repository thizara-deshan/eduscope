# S-41 Session ended — terminal own-summary — wireframe & screen design

> Closes the S-41 part of **W-11**. Status: design complete, awaiting W-11
> approval. This is terminal: no navigation, retry, share or restart control.

## 0. Evidence base

Screen inventory S-41, PRD QZ-6 and state-machines Z-15 fix final score, own rank
and answered count. INV-SI-2 forbids class data; the current student
`quiz.session` makes all final fields nullable and cannot distinguish a valid
zero/never-answered summary from an incomplete event. No quiz `B-*` applies.

## 1. Wireframes

```text
Participation                         Never answered / stale link
┌────────────────────────────────┐    ┌────────────────────────────────┐
│ ● EDUSCOPE                     │    │ ● EDUSCOPE                     │
│                                │    │                                │
│       This quiz has ended      │    │       This quiz has ended      │
│                                │    │                                │
│  Final score          40       │    │  You didn’t answer a question │
│  Final rank            3       │    │  in this quiz.                 │
│  Questions answered    5       │    │                                │
│                                │    │  Thanks for joining.           │
│  Thanks for taking part.       │    │                                │
│  You can close this tab.       │    │  You can close this tab.       │
│                                │    │                                │
└────────────────────────────────┘    └────────────────────────────────┘

Not found:
│ This quiz link is no longer available. │
│ Check the code with your lecturer.     │
```

The never-answered variant does not render `0 points` or `rank —`; it avoids
zero-shaming while remaining truthful. A close received after reconnect uses
the same terminal summary, with a brief `Reconnected` live announcement only.

## 2. Component breakdown

| Component | Responsibility |
|---|---|
| `EndedHeading` | Terminal fact, no success/failure claim |
| `FinalOwnSummary` | Final score, own rank and answered count for participated state only |
| `NoParticipationMessage` | Gentle zero-action terminal variant |
| `StaleLinkMessage` | Separate not-found wording; does not fabricate a session summary |

## 3. States mapped to `state-machines.md`

| Screen state | Mapping | Rendering |
|---|---|---|
| ended with participation | Z-15 + closed summary `participated` | three-row own summary |
| ended, never answered | Z-15 + `participationState=none` | gentle empty terminal; no zero score/rank |
| ended while offline | Z-13→Z-14 receives Z-15 snapshot | same authoritative terminal summary |
| session not found | S-37 resolve 404; no machine | stale-link copy only |

## 4. Tokens, touch and accessibility

No new token. Shared shell; neutral `--surface`, `--surface-2`, `--border`,
`--text*`, `--accent-soft`, `--radius-lg`, `--sp-7/10`, `--shadow-sm`.
Final values use `--fs-3xl`; all text ≥`--fs-md`. No green confetti, animation or
ranking medal: ending is a fact, and rank is not necessarily a win. Heading is
focused on route entry; summary is a definition list. No controls are rendered.

## 5. Behavioral requirements preserved

INV-SI-2 (own only), INV-LB-2 (same own rank as panel), Z-15/QZ-6 (closed
summary), and INV-QP-2 (zero answers is not incorrect). No legacy `B-*` applies.

## 6. Testing/scenario floor

Participated, never answered, offline-close reconnect, and not-found. A terminal
structural test asserts no link/button/share control. Privacy coverage asserts
no other identity or leaderboard list reaches payload or DOM.

## 7. Contract changes this design requires

### CG-25 — deterministic closed-session summary (breaking; blocking)

Make student `quiz.session` a state-discriminated contract. For `state=closed`,
require `participationState: participated | none` and:

- `participated`: non-null `finalScore`, `finalRank`, `answeredCount > 0`;
- `none`: `answeredCount=0`, `finalScore=0`, `finalRank=null`.

For `state=open`, final fields remain absent/null. This is **breaking** to the
current permissive shared event schema, but it is required to distinguish a
complete zero from missing data. It blocks every trustworthy S-41 summary.

