# Wave 4 — AI & Insights (S-13, S-14, S-15, S-16, S-17, S-18, S-19, S-20) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. (This project does **not** use subagent-driven-development.)

**Goal:** Build the lecturer-facing AI question flow (Studio card, Questions review, Add Question), the panel-only Insights column (Previous Questions, Leaderboard, and their two drill-down dialogs), and the Quiz join chip/QR modal — every one of them consuming the already-built AI/quiz mock machines through the `EduscopeClient` boundary, and every enumerated state reachable from the scenario dev overlay.

**Architecture:** The AI/quiz **mock machines, seed, REST adapter, and scenario scripts already exist** (`packages/api-client/src/mock/machines/{ai,quiz}.ts`, `rest/{ai,quiz}.ts`, `seed/ai.ts`, `scripts/{llm-timeout,quiz-network-loss,happy}.ts`). Wave 4 is almost entirely **panel UI** that reads them. One small mock-wiring task couples the machines to the record-start moment (so the Studio arms and the quiz opens when recording begins) and couples the countdown to the QuestionSet (so a "set ready" / "set failed" banner actually occurs); everything else is screens. Shared read/command logic lives in `apps/panel/src/ai/`; the S-13 Studio card replaces the existing `.us-sessionlayout__ai-slot` placeholder; the Insights column mounts below the meeting card in the S-05 sidebar; S-14/S-15/S-18/S-19 and the S-20 modal are `OverlayHost` overlays; the S-20 chip lives in the S-13 header. **No contract file is edited in this wave** (CG-19 already landed v0.4.0).

**Tech Stack:** React 18.3 · TypeScript strict (ESM `.js` import specifiers) · react-router 7 · TanStack Query 5 · zustand 5 · CSS custom-property tokens with `us-*` semantic classes · `qrcode` (SVG string encoder, S-20 only) · Vitest + Testing Library · Playwright.

---

## Global Constraints

These apply to every task. Every task's requirements implicitly include this section.

### Binding sources and precedence

- [`docs/design/frontend-conventions.md`](../../design/frontend-conventions.md) is **binding**. Its client-boundary (§1), prototype-porting (§2), kiosk/keyboard (§3), state/scenario (§4), testing (§5), and token (§6) rules win over this plan if any wording drifts.
- Screen behavior comes from [`screen-inventory.md`](../../design/screen-inventory.md) §0.3–0.4 and the S-13, S-14, S-15, S-16, S-17, S-18, S-19, S-20 sections.
- The approved [`S-20-design.md`](../../design/screens/S-20-design.md) governs S-20 in full; nothing here may contradict it.
- Runtime behavior comes from [`state-machines.md`](../../design/state-machines.md) §3 (machines 2a–2d, `Q-01…Q-36`) and §5 (machines 4a/4d, `Z-01…Z-06`, `Z-30…Z-33`), and §8 (the prototype-UI → state hand-check).
- REST/event shapes come from [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) v0.4.0 and [`contracts/events.md`](../../../contracts/events.md) v0.4.0. **Do not edit either contract.** `contract-amendments.md`: amendments happen before a plan run, never during it.
- `/prototype/src/components/ai/*` is **visual/behavioral reference only**. Port hierarchy, spacing, `us-*` class names, and interactions. **Do not port** `context/QuestionContext.tsx`, `COUNTDOWN_SPEED`, `mock/students.ts`, `simulateResponses`, `CLASS_ROSTER`, or any simulated timer/roster.

### Prototype map

| Screen | Prototype reference | Reproduce | Bind instead to |
|---|---|---|---|
| S-13 | `ai/QuestionAssistant.tsx`, `ai/CountdownToNext.tsx` (`GenerateControls`), `.us-readybanner` | dark `.us-assistant` card, split "generate every N / Generate Now", green ready banner | `getAiCountdown` + `ai.countdown`, `ai.set`, `generateNow`/`setAiInterval` commands. **No `COUNTDOWN_SPEED`.** Default interval **20** (not the prototype's 15). |
| S-14 | `ai/QuestionsModal.tsx`, `ai/QuestionCard.tsx` (`.us-qrow--active`, `.us-qcard__custom` "Yours" chip) | 680 px modal, collapsed accordion of MCQ cards, tap-a-letter correct answer, Send to Projector | `listQuestions`/`getQuestionSet`, `editQuestion`/`discardQuestion`/`sendToProjector`/`generateNow`, `ai.set`/`ai.question`/`quiz.publication`/`quiz.session` |
| S-15 | `ai/AddQuestionDialog.tsx` | prompt + 2–4 choices + tap-a-letter correct, portals **light** into `.us-panel` | `createQuestion` (`QuestionCreate`); resolves on `ai.question{draft, lecturer-authored}` |
| S-16 | `ai/InsightsPanel.tsx`, `ai/SentToProjectorPanel.tsx` (`.us-pqcard__badge` "Now showing") | tab in the dark insights column; sent cards newest-first; Responses/Correct/Incorrect badges | `listPublications`, `quiz.publication`/`quiz.responses`; `closePublication`/`setProjector`. **No `simulateResponses`.** |
| S-17 | `ai/LeaderboardPanel.tsx` (`.us-lb__statvalue`) | ranked rows, medals top-3, `{correct}/{answered}`, score, accuracy, avg time | `getLeaderboard` + recompute on `quiz.responses`; **derived, never stored** |
| S-18 | `ai/NamesDialog.tsx` | three filterable name lists for one publication | `listPublicationResponses` + `quiz.responses` |
| S-19 | `ai/StudentDetailDialog.tsx` | one student's per-question history | `getLeaderboard` entry + `listPublicationResponses` joined on `studentIdNumber` |
| S-20 | **none** — governed by [`S-20-design.md`](../../design/screens/S-20-design.md) | chip in S-13 header + 680 px QR modal | `getQuizSession` + `quiz.session`, `system.alert{quiz.unavailable}` |

### Client boundary, async truth, and stores (frontend-conventions §1)

- Components import no `fetch`/`axios`/`WebSocket`. They call `useClient()` and use TanStack Query for REST plus atomic selectors from `apps/panel/src/store/selectors.ts` for WS. The ESLint boundary rule must stay green.
- Commands are **202-async**. `generateNow`, `sendToProjector`, `editQuestion`, `discardQuestion`, `createQuestion`, `setAiInterval`, `closePublication`, `setProjector` return `CommandAccepted` = ACCEPTED, not DONE; the UI reacts to the resolving WS event (`ai.set`/`ai.question`/`quiz.publication`), never flips optimistically. Only where a screen spec says so (nowhere in this wave) is optimistic UI allowed.
- Multi-field WS reads use `useWsShallow`; single-field reads use an atomic selector. Never a bare object-returning `useWsStore(...)`.
- `sessionId` for the session-scoped queries comes from `useRecordingSession()?.sessionId`; a query is `enabled` only when it is present (the mock ignores the filter, but the gate keeps the real adapter honest).

### Kiosk, keyboard, accessibility (frontend-conventions §3)

- Fixed 1280×800; the page never scrolls. The Studio card, the insights column, and every modal body scroll **internally** only.
- The S-13 card owns the **dark scope**: `.us-assistant` re-declares `--surface`/`--text`/`--accent`; nested `us-*` children must use tokens, never literal darks. Overlays render **light** because `OverlayHost` mounts them inside `.us-panel`, not inside `.us-assistant` (see `overlays/overlay-host.tsx`). Keep that.
- Touch targets ≥ 44 px (`--tap-min`); accordion headers ≥ 56 px; badge drill-down targets padded to ≥ 44 px even when they read as 28 px chips. No hover-only affordances.
- Text fields (S-14 inline edit, S-15 prompt/choices) bind the shared on-screen keyboard via `useKeyboard`/`keyboard-host`; the screen sizes itself with `calc(var(--panel-h) - var(--osk-h))` and never threads keyboard-open state. The correct-answer letter row stays visible while typing.
- Icon-only buttons carry `aria-label`; selected tabs use `aria-selected`; pending/result regions use `aria-live`; the S-20 chip is a `button` with `aria-haspopup="dialog"`.
- **Insights are panel-only — never projected** (LP-17, A-16, INV-LB-3). S-17 in particular has a hard authorization boundary against projector output.

### Tokens (frontend-conventions §6)

- Use only existing tokens in `apps/panel/src/styles/tokens.css`. Medals: `--gold`/`--silver`/`--bronze` exist. `--modal-w` = 680 px exists.
- **`--warn`/`--warn-soft` do NOT exist.** S-20 §7 flagged this. Use the existing `--warning` for warn text/icon and the established soft-fill idiom `color-mix(in srgb, var(--warning) 12%, transparent)` (already used by `.us-captureverdict--tier-3` in `session.css`) for `failed`/`stale` chip/banner fills. Do **not** mint `--warn`/`--warn-soft`.

### Testing floor (frontend-conventions §5)

- Testing Library: one rendering test for **every** state enumerated under the owning S-section (including the U-states named there).
- Playwright: the primary journey **plus at least one failure scenario** per screen.
- Contract honesty: every mocked response validates against the `contracts/` zod schemas (already enforced by the api-client `contract-honesty` test; do not weaken it).
- Each task ends with its targeted tests, then a task-scoped commit.

---

## Decisions This Plan Takes

| Id | Decision | Reason |
|---|---|---|
| **W4-D-1** | Arm the AI countdown (`Q-01`) and open the quiz session (`Z-01`) from the **`R-05` record-start data reducer**, gated on `world.data['ai.enabledAtStart']` / `world.data['quiz.available']` stamped in `bootstrapFromSeed`. | `R-05` already re-emits `ai.countdown`/`quiz.session` but never *drives* them, so today nothing arms/opens on the happy path. Machine 4a's `Z-01` guard is *recording ∧ configured ∧ AI enabled* — record-start is exactly that moment. Keeps `happy` empty (honoring its "fix the machine, not the scenario" comment). |
| **W4-D-2** | Couple the countdown to the QuestionSet: `Q-02`/`Q-03` (entering `generating`) also `fire('Q-11', …)`, so a set runs `generating → ready`(`Q-12`) → green banner, or `→ failed`(`Q-13`) under `llm-timeout`. | The set machine (2b) is otherwise only reachable by a scenario driver; `llm-timeout` forces `Q-12→Q-13` but nothing fires `Q-12`. This is the one coupling that makes the S-13 "set ready"/"set failed" banner real from the UI. |
| **W4-D-3** | S-13 derives **`held`** from `recordingState === 'paused'` (freeze countdown, disable Generate Now) rather than wiring `R-08→Q-07`. | The paused fact is already on the recording slice; deriving it avoids a second cross-machine coupling for a purely visual freeze. `superseded` is likewise derived — the UI renders the latest `ai.set{ready}`. |
| **W4-D-4** | Remove the now-redundant `Z-01` timeline entry from `quiz-network-loss`; keep its `Z-30`. | With W4-D-1, `R-05` opens the session; the script only needs to drive the sync going `stale`. |
| **W4-D-5** | Insights data is REST snapshot (`listPublications`/`getLeaderboard`) **merged with** the live WS store (`quiz.publication`/`quiz.responses`); the leaderboard is **recomputed client-side**, never stored (INV-LB-1). Ties share a rank (INV-LB-2); a missed question is **unanswered, not incorrect** (INV-QP-2); accuracy is `correct/answered`, `0` when `answered = 0`. | Matches the contract's "derived" leaderboard and the parity invariants; the mock's `getLeaderboard` already returns pre-ranked entries, so recompute only merges live deltas. |
| **W4-D-6** | The S-20 QR is encoded **client-side** from `joinUrl` with the `qrcode` package rendered to an **SVG string** in `quiz-qr.tsx`; the component takes **no data source** (S20-D-3). | A QR is a pure function of its payload (S-20 C-3). SVG string keeps it inline, themeable-around, and printable; the plate is white in both themes (S20-D-8). |
| **W4-D-7** | S-20 draws **no Retry/reconnect control**; `failed` states that reconnection is automatic. The count shows `joinedCount`, marked stale, never `onlineCount` (S20-D-2/D-6). | The panel owns no mint op; recovery is `Z-04` automatic. |
| **W4-D-8** | Add scenario-overlay dev buttons for `generateNow` and `sendToProjector` (and a `Send-refused`-ready `quiz-network-loss` selection). No new World seed. | Every enumerated state must be reachable from the overlay (frontend-conventions §4); the AI/quiz world seeds (`aiEnabled`, `quizAvailable`) already exist. |

---

## File Structure

**Shared AI/quiz read + command logic** — `apps/panel/src/ai/`

| Path | Responsibility |
|---|---|
| `apps/panel/src/ai/use-ai-studio.ts` | S-13 model: merges `getAiCountdown` snapshot + `ai.countdown`/`ai.set` WS; derives `armed`/`generating`/`held`/`degraded`/`set ready`/`set failed`; `generateNow()`/`setInterval()` 202 commands with pending/refusal. |
| `apps/panel/src/ai/use-quiz-session.ts` | S-20/S-14 model: one read of `QuizSessionProjection` from `getQuizSession` snapshot + `quiz.session` WS (via a new selector). Exposes `{ state, joinUrl, joinCode, joinedCount, syncState, updatedAt }`. |
| `apps/panel/src/ai/use-questions.ts` | S-14 list model: `listQuestions`/`getQuestionSet` + live `ai.question`/`ai.set`; `editQuestion`/`discardQuestion`/`sendToProjector` 202 commands, immutable-edit (409) surfacing, Send gated on `useQuizSession().state`. |
| `apps/panel/src/ai/use-add-question.ts` | S-15 form model: `createQuestion` (`QuestionCreate`), INV-Q-1 validity, 422/409 rejection, resolves on the `ai.question{draft, lecturer-authored}` echo. |
| `apps/panel/src/ai/use-insights.ts` | S-16 model: `listPublications` + live `quiz.publication`/`quiz.responses`; "Now showing" (exactly one, INV-QPUB-1), withdrawn/closed/reveal, responses-stale, `closePublication`/`setProjector`. |
| `apps/panel/src/ai/use-leaderboard.ts` | S-17 model: `getLeaderboard` + recompute on `quiz.responses` (W4-D-5); live/stale/quiz-unavailable. |
| `apps/panel/src/ai/use-publication-responses.ts` | S-18/S-19 model: `listPublicationResponses(publicationId)` + `quiz.responses`; `{ items, syncedAt, stale }`. |
| `apps/panel/src/ai/quiz-qr.tsx` | Pure `joinUrl → <svg>` QR (W4-D-6); no client, no store. |
| `apps/panel/src/ai/ai.css` | The dark `.us-assistant` scope, `.us-readybanner`, question-card, insights, leaderboard, quiz-chip/modal styles — ported from `/prototype/src/styles/app.css`, tokens only. |

**Screens & overlays**

| Path | Responsibility |
|---|---|
| `apps/panel/src/screens/ai/ai-studio-card.tsx` | S-13 card: countdown/interval/Generate Now/ready banner/degraded, hosts the S-20 chip and opens S-14. Replaces `.us-sessionlayout__ai-slot`. |
| `apps/panel/src/screens/ai/questions-modal.tsx` | S-14 modal shell + collapsed accordion of `question-card.tsx`. |
| `apps/panel/src/screens/ai/question-card.tsx` | S-14 one MCQ: prompt, options, correct mark, "Yours" chip, inline edit, per-card Send/Discard. |
| `apps/panel/src/screens/ai/add-question-dialog.tsx` | S-15 dialog. |
| `apps/panel/src/screens/ai/quiz-join-chip.tsx` | S-20 header chip (all of Machine 4a). |
| `apps/panel/src/screens/ai/quiz-join-modal.tsx` | S-20 680 px modal (open/stale/failed bodies) + `quiz-qr`. |
| `apps/panel/src/screens/ai/insights-column.tsx` | S-16/S-17 tab wrapper (`.us-insightswrap`), mounted in the S-05 sidebar; owns tab state + the collapse seam (`.us-insightswrap--collapsed`) from W3-D-6. |
| `apps/panel/src/screens/ai/previous-questions-tab.tsx` | S-16 tab body. |
| `apps/panel/src/screens/ai/leaderboard-tab.tsx` | S-17 tab body. |
| `apps/panel/src/screens/ai/names-dialog.tsx` | S-18 overlay. |
| `apps/panel/src/screens/ai/student-detail-dialog.tsx` | S-19 overlay. |

**Store & mock wiring**

| Path | Responsibility |
|---|---|
| `apps/panel/src/store/selectors.ts` | Add `useQuizSession`, `useAiSet`, `usePublicationsList`, `useAlert(id)` selectors. |
| `apps/panel/src/screens/session/session-layout.tsx` | Mount `<AiStudioCard/>` in the ai-slot; mount `<InsightsColumn/>` in the sidebar. |
| `packages/api-client/src/mock/create-mock-client.ts` | W4-D-1: stamp `ai.enabledAtStart`/`quiz.available` in `bootstrapFromSeed`. |
| `packages/api-client/src/mock/machines/recording.ts` | W4-D-1: extend the `R-05` data reducer to schedule `Q-01`/`Z-01`. |
| `packages/api-client/src/mock/machines/ai.ts` | W4-D-2: `Q-02`/`Q-03` fire `Q-11`. |
| `packages/api-client/src/mock/scenario/scripts/quiz-network-loss.ts` | W4-D-4: drop redundant `Z-01`. |
| `apps/panel/src/devtools/scenario-overlay.tsx` | W4-D-8: `generateNow`/`sendToProjector` dev buttons. |

Tests sit beside each `.ts`/`.tsx`. Playwright specs: `apps/panel/e2e/s13-ai-studio.spec.ts`, `s14-questions.spec.ts`, `s15-add-question.spec.ts`, `s16-previous-questions.spec.ts`, `s17-leaderboard.spec.ts`, `s18-names.spec.ts`, `s19-student-detail.spec.ts`, `s20-quiz-join.spec.ts`.

---

## Task 1: Mock wiring — arm the Studio and open the quiz on record-start; couple countdown→set

**Goal:** Make the S-13 and S-20 states reachable from a normal record-start and from the existing scenarios, and add the overlay convenience buttons. This is the only mock task; everything after is UI.

**Files:**
- Modify: `packages/api-client/src/mock/create-mock-client.ts` (`bootstrapFromSeed`)
- Modify: `packages/api-client/src/mock/machines/recording.ts` (`R-05` reducer)
- Modify: `packages/api-client/src/mock/machines/ai.ts` (`Q-02`, `Q-03`)
- Modify: `packages/api-client/src/mock/scenario/scripts/quiz-network-loss.ts`
- Modify: `apps/panel/src/devtools/scenario-overlay.tsx`
- Test: `packages/api-client/test/mock/wave4-ai-quiz-wiring.test.ts`

**Interfaces:**
- Produces: after `startRecording()` resolves in a default world, `world.state('ai.countdown') === 'armed'` and `world.state('quiz.session')` reaches `open`; entering the countdown's `generating` drives `ai.set` to `ready` (or `failed` under `llm-timeout`).
- Consumes: existing `Q-01/Q-02/Q-03/Q-11/Q-12`, `Z-01/Z-02`, `R-05` and the `world.data` seed flags.

- [ ] **Step 1: Write the failing wiring test**

In `wave4-ai-quiz-wiring.test.ts`, using the mock client + the existing test clock helpers (mirror `packages/api-client/test/mock/*` setup):

1. `happy`, default seed: start recording, advance the clock past `R-05` + the `Q-01→Q-02` and `Z-01→Z-02` fires; assert `getAiCountdown()` state is `armed` (after the generate cycle completes) and `getQuizSession()` state is `open` with a non-null `joinUrl`/`joinCode`.
2. Advancing further, a `QuestionSet` reaches `ready` (`ai.set` event with `state:'ready'` observed on `events$`, `count >= 1`).
3. Seed `{ aiEnabled: false }`: after record-start, `getAiCountdown()` stays `unavailable` and no `ai.set{ready}` is emitted.
4. Seed `{ quizAvailable: false }`: after record-start, `getQuizSession()` stays `absent`.
5. `llm-timeout`: after a generate cycle, `ai.set` reaches `failed` with `error:'timeout'` and the countdown holds in `degraded`.
6. `quiz-network-loss`: the session reaches `open` then `quiz.session` carries `syncState:'stale'` (no separate `Z-01` timeline needed).

Run: `pnpm --filter @eduscope/api-client test -- wave4-ai-quiz-wiring`
Expected: FAIL (nothing arms/opens on record-start today).

- [ ] **Step 2: Stamp the seed flags in `bootstrapFromSeed`**

In `create-mock-client.ts`, inside `bootstrapFromSeed`, after the storage block, add:

```ts
// Wave 4 (W4-D-1): the AI studio arms and the quiz session opens on record-start
// (R-05's data reducer reads these), gated by the same world seeds the overlay
// already exposes. Stamped here so REST snapshots and the record-start drive agree.
world.data['ai.enabledAtStart'] = worldSeed.aiEnabled ?? true;
world.data['quiz.available'] = worldSeed.quizAvailable ?? true;
```

- [ ] **Step 3: Drive `Q-01`/`Z-01` from the `R-05` reducer**

In `recording.ts`, replace the bare `TRANSITION_DATA_REDUCERS['R-05'] = openSegment;` with a wrapper that also schedules the gated follow-ons. Add near the existing reducers:

```ts
// W4-D-1: record-start is machine 4a's Z-01 guard moment (recording ∧ configured ∧
// AI enabled) and machine 2a's Q-01 arm. Schedule them here — gated by the seed
// flags bootstrapFromSeed stamped — rather than as unconditional `fire` effects, so
// an AI-disabled or quiz-unavailable world stays absent/unavailable. Idempotent by
// the machines' own `from` guards (Q-01 only from `unavailable`, Z-01 only from
// `absent`), so a second R-05 (e.g. after a resume path) cannot double-arm.
TRANSITION_DATA_REDUCERS['R-05'] = (w, t) => {
  openSegment(w, t);
  if (w.data['ai.enabledAtStart'] === true && w.state('ai.countdown') === 'unavailable') {
    w.schedule('Q-01', 400);
  }
  if (w.data['quiz.available'] === true && w.state('quiz.session') === 'absent') {
    w.schedule('Z-01', 400);
  }
};
```

(If `openSegment` is a named local, keep its definition; only its registration changes. Verify the import of `TRANSITION_DATA_REDUCERS` is already present — it is used one line above.)

- [ ] **Step 4: Couple the countdown to the set (`Q-02`/`Q-03` fire `Q-11`)**

In `ai.ts`, add `fire('Q-11', 50)` to the effect lists of `Q-02` and `Q-03`:

```ts
t(M_COUNTDOWN, 'Q-02', ['armed'], 'generating', citeA('Q-02'),
  emit('ai.countdown'),
  emit('ai.set', { state: 'requested' }),
  fire('Q-11', 50),                          // W4-D-2: drive the QuestionSet lifecycle
  fire('Q-04', TIMERS['T-LLM-REQUEST'] / 15)),

t(M_COUNTDOWN, 'Q-03', ['armed', 'degraded'], 'generating', citeA('Q-03'),
  set('ai.remainingMs', DEFAULT_REMAINING_MS),
  emit('ai.countdown', { remainingMs: DEFAULT_REMAINING_MS }),
  emit('ai.set', { state: 'requested', trigger: 'manual' }),
  fire('Q-11', 50),                          // W4-D-2
  fire('Q-04', TIMERS['T-LLM-REQUEST'] / 15)),
```

`Q-11` already fires `Q-12` (→ `ready` + a draft `ai.question`); `llm-timeout` already forces `Q-12→Q-13` (→ `failed`) and `Q-14→Q-05` (→ countdown `degraded`). No change to those scripts.

- [ ] **Step 5: Drop the redundant `Z-01` from `quiz-network-loss`**

In `quiz-network-loss.ts`, remove the `{ transition: 'Z-01', afterMs: 800 }` timeline entry (R-05 now opens the session) and keep `{ transition: 'Z-30', afterMs: 3_000 }`. Update the module comment's timeline sentence to say the session is opened by record-start. Leave the `forced` rules (`Z-31→Z-32`, `sendToProjector` refusal) untouched.

- [ ] **Step 6: Add overlay dev buttons (W4-D-8)**

In `scenario-overlay.tsx`, inside `.us-devoverlay__transport`, add two buttons (mirror the existing `swallow(client.*)` pattern), so every AI/quiz command is reachable without building the screen first:

```tsx
<button type="button" data-testid="dev-generate-now" onClick={() => swallow(client.generateNow())}>
  Generate now
</button>
<button
  type="button"
  data-testid="dev-send-to-projector"
  onClick={() => swallow(client.sendToProjector('__seed-draft__'))}
>
  Send to projector
</button>
```

Use the seeded draft question id rather than the literal above — resolve it via a small helper that reads the first `state:'draft'` row from `client.listQuestions({ sessionId })`; if that is awkward inside the overlay, hardcode against the seed's `draftGeneratedId` exposed through a `client.world` data key. (The screens issue the real command; this button is a demo shortcut only.)

- [ ] **Step 7: Run the wiring test to PASS**

Run: `pnpm --filter @eduscope/api-client test -- wave4-ai-quiz-wiring`
Expected: PASS. Then `pnpm --filter @eduscope/api-client test -- contract-honesty` — still green (no shape changed).

- [ ] **Step 8: Commit**

```bash
git add packages/api-client apps/panel/src/devtools/scenario-overlay.tsx
git commit -m "feat(wave-4): arm AI studio + quiz session on record-start; couple countdown to set"
```

---

## Task 2: Store selectors + shared query keys

**Files:**
- Modify: `apps/panel/src/store/selectors.ts`
- Test: `apps/panel/src/store/selectors.test.tsx` (extend)
- Create: `apps/panel/src/ai/query-keys.ts`

**Interfaces:**
- Produces: `useQuizSession(): QuizSessionPayload | null`, `useAiSet(): AiSetPayload | null`, `usePublicationsList(): QuizPublicationPayload[]` (via `useWsShallow`, stable), `useAlert(id: string): SystemAlert | undefined`; and `AI_KEYS = { countdown, questions(sessionId), publications(sessionId), leaderboard(sessionId), quizSession, responses(publicationId) }`.
- Consumes: the existing `useWsStore`/`useWsShallow` from Task-0 scaffold.

- [ ] **Step 1: Write failing selector tests** — assert `useQuizSession` returns the store's `quizSession` and re-renders only on `quiz.session` ingest; `usePublicationsList` returns a stable array across an unrelated ingest (shallow equality holds). (Mirror the existing `selectors.test.tsx` render-count pattern.)
- [ ] **Step 2: Run — FAIL** (`pnpm --filter @eduscope/panel test -- store/selectors`).
- [ ] **Step 3: Add the selectors** — atomic single-field ones as one-liners; `usePublicationsList` as `useWsShallow(s => Object.values(s.publications))`; `useAlert` as `useWsStore(s => s.alerts[id])`.
- [ ] **Step 4: Add `query-keys.ts`** — a plain `const` map of the six key factories.
- [ ] **Step 5: Run — PASS.**
- [ ] **Step 6: Commit** `git commit -m "feat(wave-4): add quiz/ai store selectors and shared query keys"`.

---

## Task 3: S-13 — AI Studio card

**Files:**
- Create: `apps/panel/src/ai/use-ai-studio.ts` (+ `.test.ts`)
- Create: `apps/panel/src/screens/ai/ai-studio-card.tsx` (+ `.test.tsx`)
- Create/extend: `apps/panel/src/ai/ai.css`
- Modify: `apps/panel/src/screens/session/session-layout.tsx` (mount `<AiStudioCard/>` in the ai-slot; keep the `useAiEnabled` gate and the skeleton branch)

**Component breakdown:**
- `use-ai-studio.ts` — merges `getAiCountdown` (TanStack Query, `AI_KEYS.countdown`) with `useAiCountdown()`/`useAiSet()` WS; the interval banner count comes from `listQuestions({ state:'draft' })`. Derives the enumerated view state and exposes `generateNow()`/`setInterval(n)` (202, pending flag, refusal `Problem`).
- `ai-studio-card.tsx` — the dark `.us-assistant` card. Left: `⟳ Next set in mm:ss` (rendered **locally from `nextAt`** via the existing `useTicker`, never per-second events, INV-G-7) + interval `select` (native, 10/15/20/30, default 20). Right: `Generate Questions Now`. Footer: green `.us-readybanner` with draft count + `Review Questions` (opens S-14). Header trailing edge hosts `<QuizJoinChip/>` (Task 6). Degraded/failed variants swap the body for the reason + `Retry` (= `generateNow`).

**State → scenario-overlay map** (every enumerated S-13 state):

| State | Trigger | Demo |
|---|---|---|
| `unavailable` (hidden) | `G-AI-ENABLED` false | Overlay **World → AI disabled** ✓; card is absent (`useAiEnabled` false), `CaptureAssuranceCard` shows instead |
| `armed` | `Q-01`/`Q-04` | `happy`, overlay **Start** → after ~1 s the countdown is `armed`, interval selectable, Generate Now enabled |
| `generating` | `Q-02`/`Q-03` | `happy` → tap **Generate Questions Now** (or overlay **Generate now**): "Generating…" on a disabled button |
| `held` | `recordingState==='paused'` (W4-D-3) | `happy` → Start → overlay **Pause**: countdown frozen, "paused" caption, Generate Now disabled |
| `degraded` | `Q-05` | `llm-timeout` → Start → Generate now: after ~4 s, unavailable body + **Retry**; countdown held |
| `set ready` | `ai.set{ready}` (`Q-12`) | `happy` → Generate now → green banner "A new set is ready" + count + Review Questions |
| `set failed` | `ai.set{failed}` (`Q-13`) | `llm-timeout` → Generate now: "couldn't generate" + retry |
| `superseded` | new `ai.set{ready}` while a banner shows (W4-D-3) | `happy` → Generate now twice; latest banner replaces; lecturer-authored drafts persist |
| `interval change pending` | `Q-10` (`setAiInterval`) | `happy` → change the interval select: U-4 pending, then the new `remainingMs` |
| U-1 | cold load | Reload mid-mock: `session-main-skeleton` then the card |
| U-2 | `T-WS-STALE` | `ws-flap`: card dims, countdown frozen, controls disabled |
| U-4 | any pending command | covered by generating / interval pending above |
| U-5 | `generateNow` refused | `llm-timeout` (2nd generate refuses `409 ai.unavailable`): inline reason, no spinner |

**Test list (`ai-studio-card.test.tsx` / `use-ai-studio.test.ts`)** — one render test each: unavailable(hidden), armed, generating, held, degraded, set-ready(banner+count), set-failed, superseded (latest banner wins, authored draft survives), interval-pending, U-1 skeleton, U-2 dimmed/disabled, U-5 refusal copy. Hook tests: `generateNow` issues the command and stays pending until `ai.set` resolves; `setInterval` maps to `setAiInterval`; countdown text derives from `nextAt` (no per-second WS dependency).

- [ ] **Step 1:** Write the failing `use-ai-studio.test.ts` (state derivation + command 202 lifecycle).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement `use-ai-studio.ts`.
- [ ] **Step 4:** Run hook tests — PASS.
- [ ] **Step 5:** Write failing `ai-studio-card.test.tsx` (the render list above).
- [ ] **Step 6:** Run — FAIL.
- [ ] **Step 7:** Implement `ai-studio-card.tsx` + port the `.us-assistant`/`.us-readybanner` styles into `ai.css` (tokens only); mount it in `session-layout.tsx`.
- [ ] **Step 8:** Run — PASS; `pnpm --filter @eduscope/panel test -- session/session-layout` still green.
- [ ] **Step 9:** Commit `git commit -m "feat(S-13): AI Studio card"`.

---

## Task 4: S-20 — Quiz join chip, QR modal, QR component

> Built right after S-13 because the chip mounts in the S-13 header (S-20 §12) and S-14's disabled Send reads the same 4a `failed` (S20-D-5). Governed in full by [`S-20-design.md`](../../design/screens/S-20-design.md).

**Files:**
- Add dep: `qrcode` + `@types/qrcode` to `apps/panel/package.json`
- Create: `apps/panel/src/ai/quiz-qr.tsx` (+ `.test.tsx`)
- Create: `apps/panel/src/ai/use-quiz-session.ts` (+ `.test.ts`)
- Create: `apps/panel/src/screens/ai/quiz-join-chip.tsx` (+ `.test.tsx`)
- Create: `apps/panel/src/screens/ai/quiz-join-modal.tsx` (+ `.test.tsx`)
- Extend: `apps/panel/src/ai/ai.css`

**Component breakdown** (S-20 §4):
- `quiz-qr.tsx` — `QuizQr({ value, size })` → `<svg>` via `qrcode`'s SVG string, error-correction level M, quiet-zone margin, white plate in both themes. Pure; no client, no store; identical output for identical `value`.
- `use-quiz-session.ts` — `useQuizSession()` (Task 2 selector) merged with `getQuizSession` snapshot; returns `{ state, joinUrl, joinCode, joinedCount, syncState, updatedAt }`.
- `quiz-join-chip.tsx` — renders all of Machine 4a as a header chip; tappable only in `open`/`failed`; issues **no** command; `aria-haspopup="dialog"`.
- `quiz-join-modal.tsx` — 680 px modal; the `open`/`stale`/`failed`/`requesting` bodies of S-20 §2.3–§2.6; footer count + freshness; focus-trapped, `Esc` + ✕ close, focus returns to the chip.

**State → scenario-overlay map** (S-20 §5.1):

| State | Trigger | Demo |
|---|---|---|
| `absent` (not rendered) | `quizServerBaseUrl` null / not recording | Overlay **World → Quiz server unavailable** ✓ *before* record, or AI disabled |
| `requesting` | `Z-01` | `happy` → Start: chip "Quiz · starting…" (bounded ≤ 8 s), non-interactive |
| `open` | `Z-02` | `happy` → after ~2 s: "Quiz · N joined"; tap → modal shows QR + code + URL + count |
| `open` + `stale` | `Z-30` (CG-19 live) | `quiz-network-loss`: count dims + ⚠, "may be out of date · last synced …"; QR/code unchanged |
| `failed` | `Z-03`/`Z-06` | `quiz-network-loss` (drive `Z-06`, or `Z-03` via quiz-unavailable-at-start): chip `Quiz unavailable` `--warning`; modal explains, **no Retry** |
| `closed` (unmounts) | `Z-05` | `happy` → overlay **Stop**: chip unmounts |
| U-1 | cold load | Reload mid-`open`: skeleton chip from REST snapshot, no layout shift |
| U-2 | `T-WS-STALE` | `ws-flap`: chip dimmed, count frozen + reconnecting marker; modal read-only, QR still usable |
| U-5 | n/a | recorded inapplicable — S-20 issues no command (§5.1) |

**Test list** (S-20 §13):
- Render per row above: `absent`(renders nothing), `requesting`, `open`, `open+stale`, `failed`, `closed`, U-1, U-2; plus modal `open`/`stale`/`failed` bodies.
- **Anti-placebo:** in `failed`, the modal has exactly one interactive role (the ✕) — **no** `button`/input matching `/retry|reconnect/i`. In `stale`, the count is marked (freshness/⚠ present) and not styled live.
- `quiz-qr.tsx`: same `joinUrl` twice → identical output; holds no state/subscription (structural).
- **One count, one value:** a single `quiz.session` joined-count event → chip and modal footer show the same number.
- **CG-19 live path:** a `quiz.session{syncState:'stale'}` flips chip/modal to stale **without** a REST refetch.
- **One truth across S-14** (added in Task 5's gate): a single 4a `failed` → chip `Quiz unavailable` **and** S-14 Send disabled with the matching reason.

- [ ] **Step 1:** Add `qrcode`/`@types/qrcode`; `pnpm install`.
- [ ] **Step 2:** Write failing `quiz-qr.test.tsx` (purity + determinism) and `use-quiz-session.test.ts`.
- [ ] **Step 3:** Run — FAIL.
- [ ] **Step 4:** Implement `quiz-qr.tsx` and `use-quiz-session.ts`.
- [ ] **Step 5:** Run — PASS.
- [ ] **Step 6:** Write failing `quiz-join-chip.test.tsx` + `quiz-join-modal.test.tsx` (the list above).
- [ ] **Step 7:** Run — FAIL.
- [ ] **Step 8:** Implement both + styles; mount `<QuizJoinChip/>` at the S-13 header trailing edge (≥ 44 px, ≥ 8 px from Generate Now) and wire the modal through `OverlayHost`.
- [ ] **Step 9:** Run — PASS.
- [ ] **Step 10:** Commit `git commit -m "feat(S-20): quiz join chip, QR modal, client-side QR"`.

---

## Task 5: S-14 — Questions review modal

**Files:**
- Create: `apps/panel/src/ai/use-questions.ts` (+ `.test.ts`)
- Create: `apps/panel/src/screens/ai/questions-modal.tsx` (+ `.test.tsx`)
- Create: `apps/panel/src/screens/ai/question-card.tsx` (+ `.test.tsx`)
- Extend: `apps/panel/src/ai/ai.css`
- Wire: opened from S-13's `Review Questions` / `Generate Now` via `OverlayHost`

**Component breakdown** (screen-inventory S-14):
- `use-questions.ts` — `listQuestions`/`getQuestionSet` snapshot + live `ai.question`/`ai.set`; `editQuestion`(409 `question.immutable` surfaced, not reverted), `discardQuestion`, `sendToProjector` (gated on `useQuizSession().state === 'open'`), regenerate (= `generateNow`). Superseded-while-open: list updates on new `ai.set`, lecturer-authored (`questionSetId === null`) rows persist.
- `questions-modal.tsx` — 680 px shell; `empty`/`loading`/`populated` bodies; single-column accordion, **all collapsed by default**; `Add Question` opens S-15; Send/Cancel row reflows above the OSK.
- `question-card.tsx` — prompt, 2–4 options, correct option marked, "Yours" chip for lecturer-authored, tap-a-letter correct selection, inline edit, per-card Send/Discard.

**State → scenario-overlay map:**

| State | Trigger | Demo |
|---|---|---|
| `empty` | no drafts | `happy` → open modal before any generate: `.us-empty` "No questions right now" |
| `loading` | opened while `generating` | `happy` → Generate now → immediately Review: generating body, not empty |
| `populated` | drafts exist | `happy` → Generate now → ready → Review: collapsed accordion (seed has 2 drafts incl. a "Yours") |
| `editing` | `Q-20` | edit a draft prompt; one audit entry (mock echoes `edited:true`) |
| `edit refused (immutable)` | `409 question.immutable` | try to edit a `sent` question (seed has one): rejection shown, not reverted |
| `discarding`/`discarded` | `Q-21` | Discard a draft: row leaves |
| `regenerating` | `Q-03` | Regenerate in-modal |
| `sending` | `Q-30` (U-4) | Send a draft: pending; projector not switched yet |
| `sent` | `Q-31` | resolves; question moves to sent |
| `send failed` | `Q-32` | (drive `Q-32` via overlay/`pipeline`-style force) "couldn't send to the projector" + retry; slides unchanged |
| `send refused (quiz unavailable)` | `G-QUIZ-AVAILABLE` false | `quiz-network-loss`: Send disabled with the reason (same 4a `failed` as S-20) |
| `superseded while open` | `Q-16` + new set | Generate now while modal open: list updates, authored draft stays |
| U-2/U-4/U-5 | — | `ws-flap` (modal read-only), pending states above, refusal copy |

**Test list:** one render test per state above; plus: Send is disabled (with reason) exactly when `useQuizSession().state !== 'open'`; an immutable-edit 409 shows the reason and leaves the row unchanged; a new `ai.set{ready}` while open keeps `questionSetId === null` rows.

- [ ] **Step 1–2:** Failing `use-questions.test.ts` → FAIL.
- [ ] **Step 3–4:** Implement `use-questions.ts` → PASS.
- [ ] **Step 5–6:** Failing `questions-modal.test.tsx` + `question-card.test.tsx` → FAIL.
- [ ] **Step 7–8:** Implement both + styles; wire open-from-S-13 → PASS.
- [ ] **Step 9:** Commit `git commit -m "feat(S-14): questions review modal"`.

---

## Task 6: S-15 — Add Question dialog

**Files:**
- Create: `apps/panel/src/ai/use-add-question.ts` (+ `.test.ts`)
- Create: `apps/panel/src/screens/ai/add-question-dialog.tsx` (+ `.test.tsx`)
- Wire: opened from S-14's `Add Question` via `OverlayHost` (renders **light** — mounts in `.us-panel`, not `.us-assistant`)

**Component breakdown** (screen-inventory S-15):
- `use-add-question.ts` — `createQuestion(QuestionCreate)`; INV-Q-1 validity (≥ 2 options, one correct, non-blank prompt); 422 validation / 409 AI-disabled rejection; resolves on the `ai.question{draft, lecturer-authored}` echo, then closes.
- `add-question-dialog.tsx` — prompt + 2–4 choices (add/remove bound 2–4), tap-a-letter correct (only among filled choices); body scrolls internally with the active field kept in view; the correct-answer letter row stays visible under the OSK.

**State → scenario-overlay map:** `empty` (blank), `filling` (add/remove choices), `invalid` (submit disabled + specific reason), `saving` (U-4), `rejected` (`422`/`409`), `saved` (closes; new "Yours" draft appears in S-14), U-2/U-4/U-5. All reachable from `happy` by opening the dialog; `rejected/409` via **World → AI disabled** after opening (or a forced `createQuestion` refusal).

**Test list:** render per state; validity gate blocks submit with the exact reason per violation; save resolves on the WS echo and the dialog closes; a rejected save keeps the form intact.

- [ ] **Step 1–2:** Failing hook test → FAIL. **Step 3–4:** Implement → PASS.
- [ ] **Step 5–6:** Failing dialog test → FAIL. **Step 7–8:** Implement + wire → PASS.
- [ ] **Step 9:** Commit `git commit -m "feat(S-15): add question dialog"`.

---

## Task 7: S-16 — Insights: Previous Questions (+ the insights column shell)

**Files:**
- Create: `apps/panel/src/screens/ai/insights-column.tsx` (+ `.test.tsx`) — the tab wrapper for S-16/S-17
- Create: `apps/panel/src/ai/use-insights.ts` (+ `.test.ts`)
- Create: `apps/panel/src/screens/ai/previous-questions-tab.tsx` (+ `.test.tsx`)
- Extend: `apps/panel/src/ai/ai.css`
- Modify: `apps/panel/src/screens/session/session-layout.tsx` (mount `<InsightsColumn/>` below the meeting card; consume the `--meeting-open` collapse seam from W3-D-6 via `.us-insightswrap--collapsed`)

**Component breakdown** (screen-inventory S-16):
- `insights-column.tsx` — dark card in the sidebar; two tabs (`Previous Questions` / `Leaderboard`), `aria-selected`, tabs stay visible when the wrapper collapses; owns tab state.
- `use-insights.ts` — `listPublications` snapshot merged with live `quiz.publication`/`quiz.responses` (via `usePublicationsList`); newest-first; exactly one "Now showing" (INV-QPUB-1); `closePublication`/`setProjector` commands.
- `previous-questions-tab.tsx` — sent cards, timestamp, correct answer green, Responses/Correct/Incorrect badges (≥ 44 px tap → S-18), re-projected reveal note.

**State → scenario-overlay map:**

| State | Trigger | Demo |
|---|---|---|
| `empty` | column starts empty | `happy` → Start before any send: "fills as questions are sent" copy (not "no data") |
| `populated` + Now showing | `Q-31` | `happy` → send a question: card with "Now showing" badge |
| `withdrawn` | `Q-36` to slides | overlay/`setProjector(null)`: badge gone, publication still `open` |
| `closed` | `Q-33/34/35` | Close the question: card states which reason |
| `re-projected (reveal)` | `Q-36` on a `closed` pub | re-project a closed pub: correct answer shown, **acceptance not reopened** — copy makes that unambiguous |
| `responses stale` | `Z-30` | `quiz-network-loss`: amber "responses may be out of date" |
| `sync failed` | `Z-32` | `quiz-network-loss`: degraded; recording untouched |
| `publish failed` | `Q-32` | S-14 send-failure echoed here |
| U-1/U-2/U-3/U-4/U-5 | — | cold load; `ws-flap`; a `seq` gap forces resync (counts **replaced, never patched**, INV-AP-1) |

**Test list:** render per state; exactly one card carries "Now showing"; a `seq`-gap resync replaces counts rather than adding to them; a re-projected closed publication renders the reveal note and does not show an open/acceptance state.

- [ ] **Step 1–2:** Failing `use-insights.test.ts` → FAIL. **Step 3–4:** Implement → PASS.
- [ ] **Step 5–6:** Failing `insights-column.test.tsx` + `previous-questions-tab.test.tsx` → FAIL.
- [ ] **Step 7–8:** Implement both + styles; mount in the sidebar → PASS; `session-layout` tests still green.
- [ ] **Step 9:** Commit `git commit -m "feat(S-16): insights column + previous questions tab"`.

---

## Task 8: S-17 — Insights: Leaderboard

**Files:**
- Create: `apps/panel/src/ai/use-leaderboard.ts` (+ `.test.ts`)
- Create: `apps/panel/src/screens/ai/leaderboard-tab.tsx` (+ `.test.tsx`)
- Extend: `apps/panel/src/ai/ai.css`

**Component breakdown** (screen-inventory S-17):
- `use-leaderboard.ts` — `getLeaderboard` snapshot recomputed on `quiz.responses` (W4-D-5, DM-10 formula: score = correct × 10, INT-2); ties share a rank (INV-LB-2); accuracy = `correct/answered`, `0` when `answered = 0` (INV-QP-2); response time is insight-only, never scores (QZ-5).
- `leaderboard-tab.tsx` — dense ranking, medals top-3 (`--gold`/`--silver`/`--bronze`), `{correct}/{answered}`, score, accuracy, avg time; rows ≥ 56 px (→ S-19); live dot while streaming; **never projected**.

**State → scenario-overlay map:** `empty` (no answers), `populated` (seed's 3 ranked rows + medals), `live` (streaming dot), `stale` (`quiz.responses.stale` → whole list marked out-of-date), `quiz unavailable` (explanatory empty state, not a zero table), `accuracy edge case` (a student who missed a question is unanswered not incorrect), U-1/U-2/U-3/U-5. `stale`/`quiz unavailable` via `quiz-network-loss` / **World → Quiz server unavailable**.

**Test list:** render per state; tie → equal rank; `answered:0` → accuracy 0 and column header doesn't imply "incorrect"; a `quiz.responses` delta recomputes score/accuracy without a refetch; the tab is asserted panel-only (no projector affordance).

- [ ] **Step 1–2:** Failing hook test → FAIL. **Step 3–4:** Implement → PASS.
- [ ] **Step 5–6:** Failing tab test → FAIL. **Step 7–8:** Implement + styles → PASS.
- [ ] **Step 9:** Commit `git commit -m "feat(S-17): insights leaderboard tab"`.

---

## Task 9: S-18 — Response names dialog

**Files:**
- Create: `apps/panel/src/ai/use-publication-responses.ts` (+ `.test.ts`)
- Create: `apps/panel/src/screens/ai/names-dialog.tsx` (+ `.test.tsx`)
- Wire: opened from an S-16 badge via `OverlayHost`

**Component breakdown** (screen-inventory S-18):
- `use-publication-responses.ts` — `listPublicationResponses(publicationId)` + live `quiz.responses`; returns `{ items, syncedAt, stale }` (minimal PII, DM-14).
- `names-dialog.tsx` — three filterable name lists (Responded / Correct / Incorrect); long lists scroll internally within `.us-modal__panel`; closes on scrim tap; does not persist across navigation.

**State → scenario-overlay map:** `loading`, `empty` (nobody answered yet), `populated` (three lists), `stale` (banner with `syncedAt`), `sync failed`, U-2/U-5. `stale`/`sync failed` via `quiz-network-loss`.

**Test list:** render per state; the filter switches lists; stale shows the `syncedAt` banner without presenting counts as current; the dialog closes on scrim tap.

- [ ] **Step 1–2:** Failing hook test → FAIL. **Step 3–4:** Implement → PASS.
- [ ] **Step 5–6:** Failing dialog test → FAIL. **Step 7–8:** Implement + wire → PASS.
- [ ] **Step 9:** Commit `git commit -m "feat(S-18): response names dialog"`.

---

## Task 10: S-19 — Student detail dialog

**Files:**
- Create: `apps/panel/src/screens/ai/student-detail-dialog.tsx` (+ `.test.tsx`)
- Wire: opened from an S-17 row via `OverlayHost` (reuses `use-leaderboard` entry + `use-publication-responses` per publication, joined on `studentIdNumber`, QZ-3/INV-SI-1)

**Component breakdown** (screen-inventory S-19): one student's per-question history — chosen option, correct or not, response time, running score, rank. Joined client-side on `studentIdNumber` across `getLeaderboard` entry + `listPublicationResponses`.

**State → scenario-overlay map:** `loading`, `populated`, `partial` (student joined late — missed questions show **unanswered**, never incorrect, INV-QP-2), `stale`, U-2/U-5. `partial` via a leaderboard entry whose `answered < publication count`; `stale` via `quiz-network-loss`.

**Test list:** render per state; a late-joiner's missed questions render as unanswered (not incorrect); the running score/rank match the leaderboard entry; stale marks the data without fabricating.

- [ ] **Step 1–2:** Failing dialog test → FAIL. **Step 3–4:** Implement → PASS.
- [ ] **Step 5:** Commit `git commit -m "feat(S-19): student detail dialog"`.

---

## Per-screen gates

Each gate is executable verification. The generic shape (repeated per screen):

1. **Playwright** — the primary journey **plus one failure scenario** (spec named in File Structure).
2. **Testing Library** — one rendering test per enumerated state (already written in the build task); run the screen's test glob and confirm every state name is present.
3. **Scenario demo checklist** — walk every row of that screen's State → scenario-overlay map from the running mock; confirm each state is reachable from the overlay.
4. **Boundary lint** — `pnpm lint` + `pnpm test tools/eslint-rules/gate-boundary.test.ts`: exit 0, **no direct network import**.
5. Commit the spec + a line in `docs/plans/screens/wave-4-ai-and-insights-gate.md`.

---

## Task 11: GATE S-13 — AI Studio

- [ ] **Step 1: Playwright** `apps/panel/e2e/s13-ai-studio.spec.ts`:
  - Primary: `happy` → Start → countdown arms → interval shows **20** → Generate now → generating (disabled) → green ready banner with count → Review opens S-14.
  - Failure: `llm-timeout` → Start → Generate now → degraded body + Retry; **recording chrome stays active** (assert `data-recording-state="recording"`).
  - Kiosk: card never causes page scroll; interval is a real ≥ 44 px control.
  Run `pnpm --filter @eduscope/panel e2e -- s13-ai-studio` → PASS.
- [ ] **Step 2: Testing Library** `pnpm --filter @eduscope/panel test -- ai/use-ai-studio screens/ai/ai-studio-card` → PASS with every S-13 state named.
- [ ] **Step 3:** Walk the S-13 scenario demo checklist (table in Task 3).
- [ ] **Step 4:** `pnpm lint && pnpm test tools/eslint-rules/gate-boundary.test.ts` → exit 0.
- [ ] **Step 5:** `git add apps/panel/e2e/s13-ai-studio.spec.ts docs/plans/screens/wave-4-ai-and-insights-gate.md && git commit -m "test(S-13): gate AI Studio"`.

## Task 12: GATE S-20 — Quiz join

- [ ] **Step 1: Playwright** `s20-quiz-join.spec.ts`:
  - Primary: `happy` → Start → chip "starting…" → "N joined" → open modal → QR + code + URL visible → close (focus returns to chip).
  - Failure: `quiz-network-loss` → chip → `Quiz unavailable`; modal explains "reconnecting automatically"; assert **no** control matching `/retry|reconnect/i` and exactly one interactive role (✕).
  - Stale: `quiz-network-loss` → `open` then chip shows ⚠ / "may be out of date"; QR + code unchanged.
  Run → PASS.
- [ ] **Step 2:** `pnpm --filter @eduscope/panel test -- ai/quiz-qr ai/use-quiz-session screens/ai/quiz-join-chip screens/ai/quiz-join-modal` → PASS (every 4a state + anti-placebo + CG-19 live-path tests).
- [ ] **Step 3:** Walk the S-20 checklist (Task 4).
- [ ] **Step 4:** boundary lint → exit 0.
- [ ] **Step 5:** commit `test(S-20): gate quiz join`.

## Task 13: GATE S-14 — Questions review

- [ ] **Step 1: Playwright** `s14-questions.spec.ts`:
  - Primary: `happy` → generate → Review → expand a card → tap-a-letter correct → Send → sending → sent (moves to sent list).
  - Failure: `quiz-network-loss` → Send disabled with the quiz-unavailable reason; **the same 4a `failed` that shows `Quiz unavailable` on the S-20 chip** (assert both in one run — S20-D-5 "one truth, two surfaces").
  - Immutable: editing a `sent` question shows the 409 reason and does not revert.
  Run → PASS.
- [ ] **Step 2:** `pnpm --filter @eduscope/panel test -- ai/use-questions screens/ai/questions-modal screens/ai/question-card` → PASS (every S-14 state).
- [ ] **Step 3:** Walk the S-14 checklist. **Step 4:** boundary lint. **Step 5:** commit `test(S-14): gate questions review`.

## Task 14: GATE S-15 — Add Question

- [ ] **Step 1: Playwright** `s15-add-question.spec.ts`: primary (open → prompt + 2 choices + correct → save → new "Yours" draft in S-14); failure (`invalid` blocks submit with reason; **World → AI disabled** → `409` rejection keeps the form). OSK: opening the keyboard scrolls the body internally only, correct-answer row stays visible, no page scroll. Run → PASS.
- [ ] **Step 2:** `pnpm --filter @eduscope/panel test -- ai/use-add-question screens/ai/add-question-dialog` → PASS.
- [ ] **Step 3:** checklist. **Step 4:** boundary lint. **Step 5:** commit `test(S-15): gate add question`.

## Task 15: GATE S-16 — Previous Questions

- [ ] **Step 1: Playwright** `s16-previous-questions.spec.ts`: primary (`happy` → send → "Now showing" card → close → states reason → re-project → reveal note, acceptance not reopened); failure (`quiz-network-loss` → responses-stale amber marker, recording untouched). Run → PASS.
- [ ] **Step 2:** `pnpm --filter @eduscope/panel test -- ai/use-insights screens/ai/insights-column screens/ai/previous-questions-tab` → PASS.
- [ ] **Step 3:** checklist (incl. INV-AP-1 resync-replaces-counts). **Step 4:** boundary lint. **Step 5:** commit `test(S-16): gate previous questions`.

## Task 16: GATE S-17 — Leaderboard

- [ ] **Step 1: Playwright** `s17-leaderboard.spec.ts`: primary (`happy` → responses stream → ranked rows, medals, `{correct}/{answered}`, score, live dot; a row opens S-19); failure (`quiz-network-loss` → whole list marked stale). Assert the surface is **never** projectable. Run → PASS.
- [ ] **Step 2:** `pnpm --filter @eduscope/panel test -- ai/use-leaderboard screens/ai/leaderboard-tab` → PASS (incl. tie-rank, `answered:0` accuracy, recompute-without-refetch).
- [ ] **Step 3:** checklist. **Step 4:** boundary lint. **Step 5:** commit `test(S-17): gate leaderboard`.

## Task 17: GATE S-18 — Response names

- [ ] **Step 1: Playwright** `s18-names.spec.ts`: primary (S-16 badge → dialog → filter Responded/Correct/Incorrect); failure (`quiz-network-loss` → stale banner with `syncedAt`). Run → PASS.
- [ ] **Step 2:** `pnpm --filter @eduscope/panel test -- ai/use-publication-responses screens/ai/names-dialog` → PASS.
- [ ] **Step 3:** checklist. **Step 4:** boundary lint. **Step 5:** commit `test(S-18): gate response names`.

## Task 18: GATE S-19 — Student detail, and Wave-4 exit

- [ ] **Step 1: Playwright** `s19-student-detail.spec.ts`: primary (S-17 row → per-question history, running score, rank); failure/partial (late-joiner → missed questions render **unanswered**, not incorrect). Run → PASS.
- [ ] **Step 2:** `pnpm --filter @eduscope/panel test -- screens/ai/student-detail-dialog` → PASS.
- [ ] **Step 3:** checklist.
- [ ] **Step 4: Full green** — `pnpm lint && pnpm typecheck && pnpm test && pnpm gate` → exit 0 throughout; no component imports a network primitive.
- [ ] **Step 5: Wave-4 exit condition** — from one mock session demonstrate J-2 end-to-end: `happy` Start → Studio arms + quiz opens → Generate now → ready → Review → Send → "Now showing" in S-16 + leaderboard fills in S-17 → drill into S-18/S-19; then switch to `llm-timeout` (Studio degrades, recording unaffected) and `quiz-network-loss` (quiz stale/unavailable, Send refused, S-20 chip `Quiz unavailable`, recording unaffected).
- [ ] **Step 6:** Complete `docs/plans/screens/wave-4-ai-and-insights-gate.md` with all eight screen sections + the Wave-4 exit condition + any contract gap found in execution (record only; do not amend contracts). Commit `test(S-19): gate student detail and close Wave 4`.

---

## Self-Review

**Spec coverage** — S-13 (Task 3/11), S-14 (5/13), S-15 (6/14), S-16 (7/15), S-17 (8/16), S-18 (9/17), S-19 (10/18), S-20 (4/12); mock wiring for the AI/quiz record-start + set lifecycle (Task 1); store selectors (Task 2). CG-19 already landed v0.4.0 — no contract edit. Every enumerated state in each S-section has a scenario-overlay demo row and a Testing-Library render test; every screen has a Playwright primary + failure journey. Boundary lint is a step in every gate.

**Placeholders** — mechanical work (mock wiring, selectors) carries full code; UI tasks carry file paths + component breakdown + state→scenario map + test list + per-task verification, per the run's granularity instruction (no full component code).

**Type consistency** — `useQuizSession`/`useAiSet`/`usePublicationsList`/`useAlert` (Task 2) are consumed by Tasks 3–10 as named; `AI_KEYS` factories are the query keys throughout; the S-20 chip/modal read the one `use-quiz-session` selector (S20-D, "one control, one truth"); S-14's Send and S-20's chip both read the same 4a state (S20-D-5), asserted in Task 13.
