# Wave 7 — Student Quiz App (S-37, S-38, S-39, S-40, S-41) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not use `superpowers:subagent-driven-development` in this project.

**Goal:** Build the mobile student quiz journey from join-code resolution through self-registration, one-tap locked answering, own result/rank, and the terminal own-summary screen.

**Architecture:** Keep the three existing Next.js routes: S-37 at `/j/[joinCode]`, S-38 at `/j/[joinCode]/register`, and S-39/S-40/S-41 as states of `/s/[quizSessionId]`; add `/j` only as the required manual-code entry alias. All REST commands go through `QuizAppClient` and TanStack Query, while student realtime snapshots/deltas enter one zustand store atomically. The existing shared scenario catalog remains the only catalog; a quiz-only dev overlay selects its student scripts and invokes a small set of typed mock transitions for otherwise transient states.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, TanStack Query 5, zustand 5, React Hook Form, zod-generated contract schemas, Vitest + Testing Library, Playwright.

## Global Constraints

- `docs/design/frontend-conventions.md` is binding in every task. No component imports or calls `fetch`, `axios`, `WebSocket`, `XMLHttpRequest`, or `EventSource`; only `QuizAppClient` may cross the network boundary, and `pnpm lint` must remain green.
- Use TanStack Query for REST request state and the student zustand store for realtime state. Do not introduce page-local simulated timers, rosters, countdowns, or seed data.
- `contracts/quiz-app.yaml` v0.6.0 and `contracts/events.md` §5 are already approved. Do not amend either contract in this wave. Parse every mock REST body/event through the existing generated/shared zod schemas.
- Commands are server-authoritative. The one explicit optimistic behavior is S-39's first-tap visual lock; the REST result reconciles it, including `already-accepted` and `question.closed`.
- The student stream reconnect sequence is 0.5, 1, 2, 4, 8 seconds, then 10 seconds capped and unlimited. Every successful connect replaces the whole student state from the ordered snapshot; never merge it into stale question/result state.
- Portrait target is 360–430 px. Text is at least `--fs-md` (16 px); answer cards are full-width and at least 64 px tall; other controls are at least 44 px; reserve the bottom 24 px; no hover-only behavior.
- Keep the prototype-derived CSS custom-property system. The student app has no prototype screen to port, so use the existing palette/type/spacing/radius values and do not invent colors, Tailwind component styling, or a dark theme.
- No visible countdown, confirm dialog, class leaderboard, other-student identity, share action, terminal navigation, or queued offline answer.
- Testing floor per screen: one Testing Library rendering test per enumerated state; Playwright primary journey plus at least one failure scenario; scenario overlay demonstration for every enumerated state.
- Work test-first within each task and commit each independently. Do not fold the five final per-screen gates into implementation tasks.

---

## Current scaffold facts

- `apps/quiz` currently contains route skeletons only. S-37 and S-38 render headings; `/s/[quizSessionId]` renders the S-39 waiting heading. S-40 and S-41 have no components yet.
- `apps/quiz/app/layout.tsx` imports the small global stylesheet but does not mount `QuizClientProvider`, a query client, a realtime store bridge, or a scenario overlay.
- `apps/quiz/src/client/quiz-client-provider.tsx` always builds `createMockQuizClient()` with the default scenario and exposes the client/identity provider. It cannot switch scenarios yet.
- The current `QuizIdentityProvider` seam and `createSelfRegistrationProvider` are usable for S-38. Do not replace them with page-local identity state or expose the HttpOnly participant cookie to JavaScript.
- `QuizAppClient` already exposes the three contract-backed REST operations, `connect()`, `events$`, and `dispose()`. `createMockQuizClient` validates every REST body/event with zod.
- The shared scenario catalog already has `student-quiz-happy`, `student-quiz-returning`, `student-quiz-closed`, `student-quiz-reconnect`, and `student-quiz-failures`. Static presets cover most payload variants, but not a visually sustained offline state, the open→closed registration race, or a late-answer refusal while the session itself remains open.
- `connect()` currently both emits each snapshot frame through `events$` and returns the completed array. The app must buffer/ignore those frames and commit the returned snapshot once so a reconnect cannot flash partial or stale UI.
- `apps/quiz/package.json` has `test` and a boot-only `gate`, but no general `e2e` script. Playwright already uses a 390×844 viewport and probes `/j/ABC123`.
- Baseline execution was attempted on 2026-08-11. The bundled pnpm aborted before tests because it wanted to purge/reinstall `node_modules` in a non-interactive shell (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`); this is an environment condition, not a known source failure. Re-run the listed baseline commands before implementation after the workspace dependency installation is stable.

## File responsibility map

| Area | Files | Responsibility |
|---|---|---|
| App composition | `apps/quiz/app/layout.tsx`, `apps/quiz/src/app/quiz-app-providers.tsx`, `apps/quiz/src/client/query-client.ts`, `apps/quiz/src/client/quiz-client-provider.tsx` | Mount one query client, one quiz client/identity provider, one stream bridge, and the mock-only scenario overlay. |
| Shared mobile UI | `apps/quiz/src/components/quiz-mobile-shell.tsx`, `apps/quiz/src/components/connection-strip.tsx`, `apps/quiz/app/globals.css` | Brand bar, 360–430 px content column, safe bottom, focus/typography/touch rules, and textual connectivity status. |
| Realtime state | `apps/quiz/src/store/quiz-store.ts`, `apps/quiz/src/store/selectors.ts`, `apps/quiz/src/realtime/use-student-stream.ts` | Atomic snapshot replacement, live delta ingestion, connection/reconnect lifecycle, and small selector hooks. |
| Scenario demo | `packages/api-client/src/mock/scenario/types.ts`, `packages/api-client/src/mock/scenario/scripts/student-quiz.ts`, `packages/api-client/src/mock/scenario/registry.ts`, `packages/api-client/src/quiz/quiz-app-client.ts`, `apps/quiz/src/devtools/quiz-scenario-overlay.tsx`, `apps/quiz/src/devtools/quiz-scenario-overlay.css` | Extend the one catalog, expose typed mock-only transitions, switch client instances safely, and make all states demonstrable. |
| S-37 | `apps/quiz/app/j/page.tsx`, `apps/quiz/app/j/[joinCode]/page.tsx`, `apps/quiz/src/screens/join/*` | Automatic QR resolution plus manual entry and retry states. |
| S-38 | `apps/quiz/app/j/[joinCode]/register/page.tsx`, `apps/quiz/src/screens/registration/*` | Policy-backed two-field self-registration and named-problem handling. |
| S-39 | `apps/quiz/app/s/[quizSessionId]/page.tsx`, `apps/quiz/src/screens/live/*` | Waiting/answering/submitting/locked/rejected/reconnecting states and route-level state selection. |
| S-40 | `apps/quiz/src/screens/result/*` | Self-contained own result, correct-answer reveal, score, rank freshness, and next-question wait. |
| S-41 | `apps/quiz/src/screens/ended/*` | Participated, never-answered, offline-close, and stale-link terminal variants. |
| Gates | `apps/quiz/e2e/s37-join.spec.ts` … `s41-ended.spec.ts`, `apps/quiz/package.json` | One executable Playwright gate per screen plus targeted/full verification commands. |

## State → scenario / overlay demonstration map

The overlay lists only shared-catalog entries whose `studentQuiz` field exists. “Force” below means a typed `MockQuizAppClient.forceStudentTransition(...)` control added in Task 2; it is dev-only and does not add a production event or contract field.

| Screen | Enumerated state | Scenario demo checklist |
|---|---|---|
| S-37 | resolving | Select `student-quiz-happy`, open `/j/ABC123`; its configured REST demo delay keeps the shaped skeleton visible before resolution. |
| S-37 | session open, new participant | `student-quiz-happy` → `/j/ABC123` → replace-route to `/j/ABC123/register`. |
| S-37 | session open, returning participant | `student-quiz-returning` → `/j/ABC123` → replace-route to `/s/{quizSessionId}`; no participant is created. |
| S-37 | session not found | Any student script → `/j` → enter `INVALID`; retain the editable field and show `That quiz code is not active.` |
| S-37 | session closed | `student-quiz-closed` → `/j/ABC123` → S-41 never-answered terminal state. |
| S-37 | quiz service unreachable / retry | `student-quiz-failures` → `/j/ABC123`; first resolve throws `TransportError`, `Try again` resolves on the second attempt. |
| S-37 | manual code entry | Open `/j`; empty, fill with lowercase `abc123`, submit, and assert the outgoing code is normalized case-insensitively by the client. |
| S-37 | offline | Open `/j`, force `student.connection.offline`, retain the code/disable Join/show reconnecting; force `student.connection.restore`, then retry. |
| S-38 | empty / filling | `student-quiz-happy` → registration route; type into each of the two fields. |
| S-38 | invalid name | Submit whitespace name + valid ID; `registration.invalid-name` points to `/fullName`, focus returns to the name field. |
| S-38 | invalid student ID format | Submit valid name + `IT12`; `registration.invalid-student-id` points to `/studentIdNumber` and the contract policy hint remains visible. |
| S-38 | submitting | Submit valid values under `student-quiz-happy`; its configured REST demo delay keeps fields retained/disabled and CTA `Joining…` visible. |
| S-38 | registered | `student-quiz-happy` valid submit → created response → replace-route to S-39. |
| S-38 | duplicate rejoin | `student-quiz-returning` direct registration route + valid submit → `rejoined` response → same S-39 route, with no duplicate-success interstitial. |
| S-38 | session closed while registering | **New script `student-quiz-registration-closed`** resolves open/anonymous, then `registerParticipant` returns `quiz.session-closed`; route to S-41. |
| S-38 | service error | `student-quiz-failures`; after resolution retry, valid registration returns `quiz.unavailable`, preserving both values. |
| S-38 | offline / retry | Force `student.connection.offline` before submit; mutation is not queued, values remain; restore and explicitly resubmit. |
| S-39 | waiting | `student-quiz-happy` on session route, force `student.question.none`; show calm wait card and keep-tab-open copy. |
| S-39 | answerable (2 / 3 / 4 options) | Force `student.question.open-2`, `student.question.open-3`, and `student.question.open-4` in turn; full card is tappable and no timer exists. |
| S-39 | submitting | On an open question tap B; the configured REST demo delay keeps the optimistic B lock and all inert cards visible. |
| S-39 | locked | `student-quiz-happy`, tap B, accepted REST response; B stays highlighted with finality copy. |
| S-39 | duplicate/already accepted | `student-quiz-returning`, tap any option; reconcile to the authoritative stored option from `already-accepted`, never the second tap. |
| S-39 | rejected — question closed | **New script `student-quiz-late-answer`** keeps session open/question visible but makes submit return `question.closed`; render explicit late copy. |
| S-39 | network error before reply | `student-quiz-failures`, force an open question, tap once; reply is lost after storage, UI returns to answerable with retry copy; tap again and reconcile `already-accepted`. |
| S-39 | missed | From waiting/answerable force `student.question.close-missed`; atomically emit closed question + missed result and render S-40 missed, never incorrect. |
| S-39 | offline / reconnecting | Force `student.connection.offline`; retain/dim current question and make options inert. Force restore; `connect()` returns a complete snapshot, committed once with no stale-question flash. |
| S-39 | session closed | Force `student.session.close-participated` or select `student-quiz-closed`; S-41 supersedes the live screen. |
| S-40 | correct | `student-quiz-happy`, force `student.result.correct-current`; render +10, correct option, score, own rank. |
| S-40 | incorrect | `student-quiz-returning`, force `student.result.incorrect-pending`; render own + correct answers and +0. |
| S-40 | missed | `student-quiz-reconnect` or force `student.question.close-missed`; render `No answer received`, not incorrect. |
| S-40 | rank updating | Force `student.result.incorrect-pending`; rank reads `Updating…` while score remains. |
| S-40 | awaiting next question | Any result state includes the dominant wait instruction; force `student.question.open-4` to return to S-39 and clear the prior result. |
| S-40 | offline | While a result is visible force `student.connection.offline`; retain the authoritative result and add reconnecting strip. |
| S-40 | session closed | While a result is visible force `student.session.close-participated`; S-41 supersedes it. |
| S-41 | ended with participation | `student-quiz-happy`, force `student.session.close-participated`; render final score/rank/answered count only. |
| S-41 | ended, never answered | `student-quiz-closed` or force `student.session.close-none`; render the gentle no-participation copy without zero score/rank. |
| S-41 | ended while offline | Force offline, then `student.session.prepare-close-participated`, then restore; reconnect snapshot lands directly on the same participated terminal summary with a polite `Reconnected` announcement. |
| S-41 | session not found | `student-quiz-session-not-found` on a direct `/s/{quizSessionId}` boot; `connect()` rejects the named problem and the route renders stale-link copy only. Invalid manual join codes remain S-37, per S-37's more specific approved behavior. |

---

## Task 1: App foundation — providers, mobile shell, tokens, and test harness

**Files:**
- Create: `apps/quiz/src/app/quiz-app-providers.tsx`
- Create: `apps/quiz/src/client/query-client.ts`
- Create: `apps/quiz/src/components/quiz-mobile-shell.tsx`
- Create: `apps/quiz/src/components/quiz-mobile-shell.test.tsx`
- Create: `apps/quiz/src/components/connection-strip.tsx`
- Modify: `apps/quiz/app/layout.tsx`
- Modify: `apps/quiz/app/globals.css`
- Modify: `apps/quiz/package.json`
- Modify: `apps/quiz/app/routes.test.tsx`

**Interfaces:**
- Produces: `QuizAppProviders({children}: {children: ReactNode})`, `QuizMobileShell({children, connectionState?})`, and one app-lifetime `QueryClient` with `retry:false`, `refetchOnWindowFocus:false`, and no polling.
- Consumes: existing `QuizClientProvider`; Task 3 adds the stream bridge inside the provider composition without changing screen call sites.

- [ ] **Step 1: Write failing foundation tests**

  Cover the brand bar, main landmark, 360–430 px content class, 24 px safe-bottom token, ≥16 px root/body/input text, ≥44 px generic touch target, ≥64 px answer token, visible focus ring, reduced-motion override, and absence of hover selectors. Update route tests to expect the providers without changing route outcomes.

- [ ] **Step 2: Run the focused tests and confirm the missing components/tokens fail**

  Run: `pnpm --filter @eduscope/quiz test -- src/components/quiz-mobile-shell.test.tsx app/routes.test.tsx`

- [ ] **Step 3: Add the minimal provider and token foundation**

  `QuizAppProviders` is a `'use client'` boundary that nests `QueryClientProvider` and `QuizClientProvider`. `layout.tsx` stays a server component and wraps `children` once. Port only the needed approved tokens from `apps/panel/src/styles/tokens.css`: palette semantics, `--fs-md/xl/3xl`, `--sp-1…10`, `--radius-md/lg`, `--shadow-sm`, `--tap-min`, plus `--tap-answer:64px` and `--safe-bottom:24px`. Keep page scrolling available for short phones, but prohibit horizontal overflow.

  Add `"e2e": "playwright test"` and change `gate` to run all quiz e2e specs once Tasks 8–12 exist.

- [ ] **Step 4: Verify foundation**

  Run: `pnpm --filter @eduscope/quiz test -- src/components/quiz-mobile-shell.test.tsx app/routes.test.tsx`
  Run: `pnpm --filter @eduscope/quiz typecheck`
  Expected: PASS; existing three route skeleton assertions remain green.

- [ ] **Step 5: Commit**

```bash
git add apps/quiz/app apps/quiz/src/app apps/quiz/src/client/query-client.ts apps/quiz/src/components apps/quiz/package.json
git commit -m "feat(quiz): add mobile app foundation"
```

---

## Task 2: Scenario engine and quiz client demo transitions

**Files:**
- Modify: `packages/api-client/src/mock/scenario/types.ts`
- Modify: `packages/api-client/src/mock/scenario/scripts/student-quiz.ts`
- Modify: `packages/api-client/src/mock/scenario/registry.ts`
- Modify: `packages/api-client/src/quiz/quiz-app-client.ts`
- Modify: `packages/api-client/test/student-quiz-v0-6.test.ts`

**Interfaces:**
- Produces: `StudentQuizTransitionId`, `MockQuizAppClient`, `forceStudentTransition(id)`, and the three new catalog scripts `student-quiz-registration-closed`, `student-quiz-late-answer`, `student-quiz-session-not-found`.
- Preserves: production `QuizAppClient`; v0.6 REST/event schemas; the single shared `ScenarioName`/`listScenarios()` catalog.

- [ ] **Step 1: Add failing scenario/client tests**

  Assert each new script is returned by `listScenarios()`, all existing snapshots still zod-parse, offline makes REST reject without queuing, restore permits a new `connect()`, forced question/result/session transitions emit valid events, registration-closed resolves open before rejecting registration, late-answer keeps session open while rejecting submit, and session-not-found rejects `connect()` with `quiz.session-not-found`.

- [ ] **Step 2: Run the focused test and verify the new types/methods are missing**

  Run: `pnpm --filter @eduscope/api-client test -- student-quiz-v0-6.test.ts`

- [ ] **Step 3: Add the exact mechanical types**

```ts
export type StudentQuizTransitionId =
  | 'student.connection.offline'
  | 'student.connection.restore'
  | 'student.question.none'
  | 'student.question.open-2'
  | 'student.question.open-3'
  | 'student.question.open-4'
  | 'student.question.close-missed'
  | 'student.result.correct-current'
  | 'student.result.incorrect-pending'
  | 'student.result.rank-current'
  | 'student.session.prepare-close-participated'
  | 'student.session.close-participated'
  | 'student.session.close-none';

export interface MockQuizAppClient extends QuizAppClient {
  forceStudentTransition(id: StudentQuizTransitionId): void;
}
```

  Add the three scenario names to `ScenarioName`. Extend `StudentQuizScenario` with `connectOutcome?: 'ok' | 'session-not-found'` and `restDelayMs?: Partial<Record<'resolveJoinCode' | 'registerParticipant' | 'submitAnswer', number>>`. Keep REST race outcomes in `StudentQuizScenario`; do not force them through panel machine `TransitionId` because these operations are quiz-service-owned and do not belong to the device world.

- [ ] **Step 4: Implement the minimal stateful mock behavior**

  Make `createMockQuizClient` return `MockQuizAppClient`. Hold mutable `connection`, `question`, `result`, `summary`, and `preparedSummary` values initialized from the selected script. Await only the script's declared REST demo delay before settling an operation; use fake timers in unit tests so coverage stays fast. `forceStudentTransition` must only update those values and emit the corresponding zod-parsed `StudentServerEvent`; `student.connection.offline` also makes all REST calls fail with `TransportError`, while `restore` merely permits the app's reconnect loop to call `connect()` again. `prepare-close-participated` changes only the next snapshot so the offline-close path does not fabricate a live event while disconnected.

  `student.question.open-*` clears the prior result before emitting the open question. `student.question.close-missed` emits the closed question and then a self-contained missed result. `student.result.rank-current` re-emits the current result with `rankState:'current'` and non-null own rank. Session close emits the discriminated terminal session event.

- [ ] **Step 5: Add coherent scripts**

  First make existing journey presets internally coherent:

  - `student-quiz-happy`: starts `summary:'open'`, `result:'none'`, four-option question, and visible demo delays on resolve/register/answer. Correct result and participated close are later forced through the overlay.
  - `student-quiz-returning`: starts `summary:'open'`, `result:'none'`, three-option question, and `answer:'already-accepted'`. Incorrect/pending result is later forced.
  - `student-quiz-reconnect`: retains the two-option/missed reconnect snapshot used for S-40 cold-connect coverage.
  - `student-quiz-failures`: starts `summary:'open'` with a four-option question so reply-loss is reachable on a direct S-39 route.

  - `student-quiz-registration-closed`: `resolution:'open-anonymous'`, `registration:'session-closed'`, open session/no result.
  - `student-quiz-late-answer`: returning participant, open four-option question, `answer:'question-closed'`, open session/no result.
  - `student-quiz-session-not-found`: `connectOutcome:'session-not-found'`; join/registration fields can use ordinary valid defaults but are not its demo path.

  Update the existing contract test that treated `student-quiz-happy` as already terminal: force `student.session.close-participated` before asserting the participated summary. This preserves CG-25 coverage while allowing the primary join/register journey to reach S-39.

- [ ] **Step 6: Verify scenario mechanics**

  Run: `pnpm --filter @eduscope/api-client test -- student-quiz-v0-6.test.ts scenario/scripts.test.ts`
  Run: `pnpm --filter @eduscope/api-client typecheck`
  Expected: PASS; no contract files or generated schema files change.

- [ ] **Step 7: Commit**

```bash
git add packages/api-client/src/mock/scenario packages/api-client/src/quiz/quiz-app-client.ts packages/api-client/test/student-quiz-v0-6.test.ts
git commit -m "test(quiz): expose Wave 7 scenario transitions"
```

---

## Task 3: Client switching, atomic realtime store, reconnect bridge, and quiz overlay

**Files:**
- Modify: `apps/quiz/src/client/quiz-client-provider.tsx`
- Create: `apps/quiz/src/client/quiz-client-provider.test.tsx`
- Create: `apps/quiz/src/store/quiz-store.ts`
- Create: `apps/quiz/src/store/quiz-store.test.ts`
- Create: `apps/quiz/src/store/selectors.ts`
- Create: `apps/quiz/src/realtime/use-student-stream.ts`
- Create: `apps/quiz/src/realtime/use-student-stream.test.tsx`
- Create: `apps/quiz/src/devtools/quiz-scenario-overlay.tsx`
- Create: `apps/quiz/src/devtools/quiz-scenario-overlay.test.tsx`
- Create: `apps/quiz/src/devtools/quiz-scenario-overlay.css`
- Modify: `apps/quiz/src/app/quiz-app-providers.tsx`

**Interfaces:**
- Produces: `useQuizSession()`, `useQuizQuestion()`, `useQuizResult()`, `useQuizConnectionState()`, `useSnapshotStatus()`, `useQuizScenarioControls()`.
- Store actions: `replaceSnapshot(events: readonly StudentServerEvent[])`, `ingest(event: StudentServerEvent)`, `setReconnecting()`, `setConnectProblem(problem)`, `reset()`.
- Screen precedence on `/s`: connect problem `quiz.session-not-found` → S-41 stale link; closed session → S-41; result present → S-40; otherwise S-39.

- [ ] **Step 1: Write failing store/provider/reconnect/overlay tests**

  Test exact snapshot replacement (old question/result removed when absent), live delta replacement by event kind, no render-visible partial snapshot, offline retention, capped reconnect delay calculation, cleanup on scenario switch/unmount, and overlay filtering to `script.studentQuiz`. Test that selecting a scenario disposes the old client, resets store/query cache, and reconnects the new client once.

- [ ] **Step 2: Run focused tests and verify failure**

  Run: `pnpm --filter @eduscope/quiz test -- src/store src/realtime src/client src/devtools`

- [ ] **Step 3: Wire client selection with exact ownership**

  Keep construction inside `useEffect`, now keyed by provider-owned `scenario`. Expose `scenario`, `switchScenario(name)`, and a narrowed mock transition callback through context; screens continue to receive only `QuizAppClient`. On switch: dispose the old client, reset the student store, clear the quiz query cache, create the new client, then reconnect.

  Do not import the scenario catalog from any screen. The overlay alone calls `listScenarios()` and renders only student entries, behind the same mock-adapter condition used to choose `createMockQuizClient`.

- [ ] **Step 4: Implement atomic stream wiring**

  Subscribe before `connect()` only to buffer frames emitted during the call. When `connect()` resolves, discard the buffered duplicate snapshot frames and call `replaceSnapshot(returnedEvents)` once; afterward route new `events$` frames to `ingest`. On transport failure set reconnecting, retain the last authoritative state, and retry with `[500,1000,2000,4000,8000,10000]` ms capped/unlimited. On named `quiz.session-not-found`, stop retrying and store the problem for S-41.

  Use this exact ownership pattern inside the effect (with the surrounding cancellation, retry timer, and cleanup checks covered by the tests):

```ts
let snapshotting = false;
const off = client.events$.subscribe((event) => {
  if (!snapshotting) useQuizStore.getState().ingest(event);
});

const connectAtomic = async () => {
  snapshotting = true;
  try {
    const snapshot = await client.connect();
    if (!cancelled) useQuizStore.getState().replaceSnapshot(snapshot);
  } finally {
    snapshotting = false;
  }
};
```

  `replaceSnapshot` parses the array as a complete set before one zustand `set`: exactly one session, one participant, one question, and zero-or-one result. It replaces `question` and `result` with `null` when absent rather than retaining prior values.

- [ ] **Step 5: Build the hidden mobile scenario overlay**

  Reuse the panel's 2-second invisible-corner long-press interaction, but create quiz-specific markup/CSS sized for 360 px. It contains scenario radios plus buttons for every `StudentQuizTransitionId`; controls have text labels and ≥44 px targets. No panel `WorldSeed`, recorder, or channel controls enter this app.

- [ ] **Step 6: Verify integration foundation**

  Run: `pnpm --filter @eduscope/quiz test -- src/store src/realtime src/client src/devtools`
  Run: `pnpm --filter @eduscope/quiz typecheck`
  Run: `pnpm lint`
  Expected: PASS; search confirms no direct network primitive under `apps/quiz`.

- [ ] **Step 7: Commit**

```bash
git add apps/quiz/src/app apps/quiz/src/client apps/quiz/src/store apps/quiz/src/realtime apps/quiz/src/devtools
git commit -m "feat(quiz): wire atomic student realtime scenarios"
```

---

## Task 4: S-37 Join — resolver, manual code entry, routing, and failures

**Files:**
- Create: `apps/quiz/app/j/page.tsx`
- Modify: `apps/quiz/app/j/[joinCode]/page.tsx`
- Create: `apps/quiz/src/screens/join/join-screen.tsx`
- Create: `apps/quiz/src/screens/join/join-code-form.tsx`
- Create: `apps/quiz/src/screens/join/join-status.tsx`
- Create: `apps/quiz/src/screens/join/use-join-resolution.ts`
- Create: `apps/quiz/src/screens/join/join-screen.test.tsx`
- Create: `apps/quiz/src/screens/join/join.css`

**Component breakdown:**
- `JoinScreen`: composes the shared shell and decides auto-resolve versus manual entry.
- `JoinResolver` behavior lives in `useJoinResolution`: one query per submitted normalized code and authoritative replace-routing.
- `JoinCodeForm`: opaque string, trim on submit, `maxLength=32` from the landed contract, `autoCapitalize="characters"`, no invented numeric keyboard.
- `JoinStatus`: shaped skeleton and named invalid/closed/unreachable/offline status with focus/`aria-live` management.

**Routing outcomes:** open+anonymous → `/j/{normalizedCode}/register`; open+returning → `/s/{quizSessionId}`; closed → `/s/{quizSessionId}` where the closed snapshot renders S-41; not-found stays on S-37; transport/unavailable stays with retry.

- [ ] **Step 1: Write one failing rendering/behavior test per S-37 state**

  Tests: resolving skeleton; manual empty; manual filling/lowercase submission; open-new route; open-returning route with no register call; not-found editable error; closed terminal route; unavailable; unreachable then retry; offline retained code/disabled submit/restored retry. Assert raw exception/status text never renders and focus reaches the status or invalid field as appropriate.

- [ ] **Step 2: Run focused tests and confirm skeleton behavior fails**

  Run: `pnpm --filter @eduscope/quiz test -- src/screens/join`

- [ ] **Step 3: Implement the S-37 components without copying prototype logic**

  Use TanStack `useQuery({queryKey:['join-code', normalizedCode], enabled:submittedCode!==null, retry:false})`. Map only `QuizAppProblemError.problem.code` and `TransportError`; unknown errors use the same bounded unreachable copy. Use `router.replace`, never a success screen. `/j` passes an empty initial code and does not auto-submit; `/j/[joinCode]` auto-submits the route code once.

- [ ] **Step 4: Verify S-37**

  Run: `pnpm --filter @eduscope/quiz test -- src/screens/join app/routes.test.tsx`
  Run: `pnpm --filter @eduscope/quiz typecheck && pnpm lint`
  Expected: every S-37 row in the mapping table passes in Testing Library and both join routes compile.

- [ ] **Step 5: Commit**

```bash
git add apps/quiz/app/j apps/quiz/src/screens/join
git commit -m "feat(S-37): add quiz join gate"
```

---

## Task 5: S-38 Self-registration — policy form and idempotent rejoin

**Files:**
- Modify: `apps/quiz/app/j/[joinCode]/register/page.tsx`
- Create: `apps/quiz/src/screens/registration/registration-screen.tsx`
- Create: `apps/quiz/src/screens/registration/registration-form.tsx`
- Create: `apps/quiz/src/screens/registration/policy-field.tsx`
- Create: `apps/quiz/src/screens/registration/field-problem.tsx`
- Create: `apps/quiz/src/screens/registration/use-registration.ts`
- Create: `apps/quiz/src/screens/registration/registration-screen.test.tsx`
- Create: `apps/quiz/src/screens/registration/registration.css`

**Component breakdown:**
- `RegistrationScreen`: resolves the code/policy, composes exactly two fields and one primary action, and handles route-level closed/unavailable states.
- `RegistrationForm`: owns values with React Hook Form, trims on submit, preserves them through recoverable errors.
- `PolicyField`: applies `fullNameMaxLength`, `studentIdPattern`, `studentIdHint`, `inputMode`, and `studentIdMaxLength` from resolution data.
- `FieldProblem`: maps JSON pointers `/fullName` and `/studentIdNumber`, connects `aria-describedby`, and focuses the first invalid field.
- `useRegistration`: calls the identity seam/client mutation; routes both `created` and `rejoined` to `/s/{quizSessionId}`.

- [ ] **Step 1: Write one failing rendering/behavior test per S-38 state**

  Tests: empty; filling; invalid name; invalid ID; submitting retained/disabled; registered-created route; duplicate-rejoined route; session-closed race route; unavailable/service error; offline retention and explicit resubmit. Add privacy assertion that neither response nor DOM exposes another participant/class list. Assert exactly two textbox controls and one primary action.

- [ ] **Step 2: Run focused tests and confirm missing UI fails**

  Run: `pnpm --filter @eduscope/quiz test -- src/screens/registration`

- [ ] **Step 3: Implement minimal policy-driven registration**

  Resolve the join code first to obtain server policy; do not hardcode the regex/hint in UI files. Client-side validation may use the returned policy for immediate feedback, but named server problems remain authoritative. `quiz.session-closed` replace-routes to the terminal session URL; `quiz.unavailable` and transport failure preserve values and expose retry. Never store/read the participant cookie.

- [ ] **Step 4: Verify S-38**

  Run: `pnpm --filter @eduscope/quiz test -- src/screens/registration src/identity`
  Run: `pnpm --filter @eduscope/quiz typecheck && pnpm lint`
  Expected: every S-38 mapping row passes; existing A-16 identity seam tests stay green.

- [ ] **Step 5: Commit**

```bash
git add apps/quiz/app/j/[joinCode]/register apps/quiz/src/screens/registration apps/quiz/src/identity
git commit -m "feat(S-38): add student self-registration"
```

---

## Task 6: S-39 Play — route state selection and one-tap answer lifecycle

**Files:**
- Modify: `apps/quiz/app/s/[quizSessionId]/page.tsx`
- Create: `apps/quiz/src/screens/live/quiz-session-screen.tsx`
- Create: `apps/quiz/src/screens/live/quiz-live-header.tsx`
- Create: `apps/quiz/src/screens/live/question-viewport.tsx`
- Create: `apps/quiz/src/screens/live/answer-option.tsx`
- Create: `apps/quiz/src/screens/live/use-submit-answer.ts`
- Create: `apps/quiz/src/screens/live/quiz-session-screen.test.tsx`
- Create: `apps/quiz/src/screens/live/live.css`

**Component breakdown:**
- `QuizSessionScreen`: applies the route precedence from Task 3 and delegates S-39/S-40/S-41 without navigation between question/result states.
- `QuizLiveHeader`: brand + words/icons for connected/reconnecting, with no score/rank dependency.
- `QuestionViewport`: stable waiting/question/rejected region; no per-question route or remount.
- `AnswerOption`: whole-card ≥64 px button with letter/text and pressed/submitting/locked semantics.
- `useSubmitAnswer`: optimistic first-tap lock, one in-flight request, option **id** body, authoritative reconciliation, no offline queue.

- [ ] **Step 1: Write one failing rendering/behavior test per S-39 state**

  Tests: waiting; answerable with 2/3/4 options; submitting selected/inert; accepted locked; already-accepted reconciliation to stored option; rejected closed; reply loss returns answerable then retry locks stored answer; missed delegates S-40; sustained offline/reconnecting retains/dims and disables; atomic reconnect has no stale question frame; session close delegates S-41. Add structural assertions for no countdown/timer, no confirm dialog, and option IDs—not indexes—sent to the client. Test answer-vs-close in both orders and assert only the server outcome renders.

- [ ] **Step 2: Run focused tests and confirm the route skeleton fails**

  Run: `pnpm --filter @eduscope/quiz test -- src/screens/live`

- [ ] **Step 3: Implement the minimal answer state reducer inside the mutation hook**

  Local mutation phases are `idle | submitting | locked | rejected-closed | retryable`. Reset them only when `publicationId` changes or the store supplies an authoritative own-answer. Disable all options while submitting/locked/offline. On `accepted` or `already-accepted`, use the response's `selectedOptionId`; on `question.closed`, render the explicit rejected copy; on transport failure, return to answerable with retry instruction.

- [ ] **Step 4: Implement route-level state precedence**

  Do not route between S-39 and S-40. `QuizSessionScreen` reads small selector hooks and renders `EndedScreen` for closed/not-found, else `ResultScreen` when a current result exists, else S-39. A new open publication clears the previous result in the store and reveals S-39 in place.

- [ ] **Step 5: Verify S-39**

  Run: `pnpm --filter @eduscope/quiz test -- src/screens/live src/store src/realtime`
  Run: `pnpm --filter @eduscope/quiz typecheck && pnpm lint`
  Expected: every S-39 state and race passes; no direct network primitive or countdown exists.

- [ ] **Step 6: Commit**

```bash
git add apps/quiz/app/s apps/quiz/src/screens/live
git commit -m "feat(S-39): add locked quiz answering"
```

---

## Task 7: S-40 Result and S-41 Session ended

**Files:**
- Create: `apps/quiz/src/screens/result/result-screen.tsx`
- Create: `apps/quiz/src/screens/result/result-verdict.tsx`
- Create: `apps/quiz/src/screens/result/answer-reveal.tsx`
- Create: `apps/quiz/src/screens/result/own-standing.tsx`
- Create: `apps/quiz/src/screens/result/next-question-wait.tsx`
- Create: `apps/quiz/src/screens/result/result-screen.test.tsx`
- Create: `apps/quiz/src/screens/result/result.css`
- Create: `apps/quiz/src/screens/ended/ended-screen.tsx`
- Create: `apps/quiz/src/screens/ended/final-own-summary.tsx`
- Create: `apps/quiz/src/screens/ended/no-participation-message.tsx`
- Create: `apps/quiz/src/screens/ended/stale-link-message.tsx`
- Create: `apps/quiz/src/screens/ended/ended-screen.test.tsx`
- Create: `apps/quiz/src/screens/ended/ended.css`

**Component breakdown:**
- S-40 `ResultVerdict`, `AnswerReveal`, `OwnStanding`, and `NextQuestionWait` consume only the self-contained `quiz.result` payload.
- S-41 `EndedScreen` owns the neutral heading; `FinalOwnSummary`, `NoParticipationMessage`, and `StaleLinkMessage` are mutually exclusive terminal bodies.

- [ ] **Step 1: Write one failing rendering test per S-40 state**

  Tests: correct/current; incorrect/current; missed/current; rank pending; rank becomes current; awaiting-next instruction; next open question returns S-39; offline retains complete result; session closed supersedes with S-41. Cold-render every result from only `quiz.result`—do not seed S-39 question memory. Assert no class list/other identity and no action/auto-dismiss timer.

- [ ] **Step 2: Write one failing rendering test per S-41 state**

  Tests: participated three-row summary; never-answered gentle copy with no `0 points`/rank dash; offline close appears on reconnect; direct-session not-found stale copy. Structural test: no button, link, share, retry, navigation, confetti, or medal. Privacy test: own values only.

- [ ] **Step 3: Run focused tests and confirm components are missing**

  Run: `pnpm --filter @eduscope/quiz test -- src/screens/result src/screens/ended`

- [ ] **Step 4: Implement S-40 from the result payload only**

  Find own/correct option text from `result.question.options` IDs. `selectedOptionId:null` + `isCorrect:null` is missed and uses neutral styling. `rankState:'pending'` renders `Updating…` without clearing score. Keep `Waiting for the next question` visually dominant and let store transitions, not timers, replace the screen.

- [ ] **Step 5: Implement S-41's discriminated terminal bodies**

  Branch on `participationState` only after `session.state==='closed'`. Participated shows the definition list; none shows gentle copy and intentionally hides zero score/rank. A stored not-found connect problem shows stale-link copy. Focus the terminal heading on entry and use a polite live announcement only for offline→closed reconnect.

- [ ] **Step 6: Verify S-40/S-41**

  Run: `pnpm --filter @eduscope/quiz test -- src/screens/result src/screens/ended src/screens/live`
  Run: `pnpm --filter @eduscope/quiz typecheck && pnpm lint`
  Expected: every S-40 and S-41 state passes and route precedence remains deterministic.

- [ ] **Step 7: Commit**

```bash
git add apps/quiz/src/screens/result apps/quiz/src/screens/ended apps/quiz/src/screens/live/quiz-session-screen.tsx
git commit -m "feat(quiz): add own result and terminal summary"
```

---

## Final per-screen gates (Tasks 8–12)

These are the final tasks of the plan. Each gate must execute all four requirements: every enumerated state demonstrated through the scenario checklist; boundary lint green; one Testing Library test per enumerated state; Playwright primary journey plus one failure scenario. Do not proceed past a red gate.

### Task 8: Gate — S-37 Join

**Files:** Create `apps/quiz/e2e/s37-join.spec.ts`.

- [ ] **Step 1: Execute the S-37 scenario demo checklist**

  In the hidden overlay demonstrate resolving, new, returning, not-found, closed, unreachable/retry, manual entry, and offline/restore exactly as mapped above. Record the checklist in Playwright test annotations/comments beside the assertion that covers each state.

- [ ] **Step 2: Add Playwright primary + failure journeys**

  Primary: `student-quiz-happy`, scan `/j/ABC123`, assert automatic replace to registration; also enter lowercase through `/j` and assert case-insensitive success. Failure: `student-quiz-failures`, assert unreachable copy, retained code, and successful explicit retry. Include returning and closed routing assertions in the same spec without adding a second gate file.

- [ ] **Step 3: Run the executable gate**

  Run: `pnpm --filter @eduscope/quiz test -- src/screens/join`
  Run: `pnpm --filter @eduscope/quiz e2e -- e2e/s37-join.spec.ts`
  Run: `pnpm lint && pnpm --filter @eduscope/api-client test`
  Expected: every S-37 Testing Library state, Playwright journey/failure, boundary rule, and contract-validation test PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/quiz/e2e/s37-join.spec.ts
git commit -m "test(S-37): gate join routing and retry"
```

---

### Task 9: Gate — S-38 Self-registration

**Files:** Create `apps/quiz/e2e/s38-registration.spec.ts`.

- [ ] **Step 1: Execute the S-38 scenario demo checklist**

  Demonstrate empty, filling, both field failures, submitting, created, rejoined, closed race, unavailable, and offline retention/restore. Confirm the policy hint is contract-provided and only two fields/one action render.

- [ ] **Step 2: Add Playwright primary + failure journeys**

  Primary: anonymous join → valid real name/ID → `created` → S-39 route. Failure: `student-quiz-registration-closed`, begin from an open resolution, submit valid retained values, assert the authoritative close routes to S-41. Also assert a malformed ID stays in S-38 with field focus.

- [ ] **Step 3: Run the executable gate**

  Run: `pnpm --filter @eduscope/quiz test -- src/screens/registration src/identity`
  Run: `pnpm --filter @eduscope/quiz e2e -- e2e/s38-registration.spec.ts`
  Run: `pnpm lint && pnpm --filter @eduscope/api-client test`
  Expected: every S-38 state, primary/failure journey, boundary rule, privacy assertion, and contract-validation test PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/quiz/e2e/s38-registration.spec.ts
git commit -m "test(S-38): gate registration and closed race"
```

---

### Task 10: Gate — S-39 Play

**Files:** Create `apps/quiz/e2e/s39-play.spec.ts`.

- [ ] **Step 1: Execute the S-39 scenario demo checklist**

  Demonstrate waiting, 2/3/4-option answerable, submitting, locked, already-accepted reconciliation, rejected-closed, request/reply loss + retry, missed, sustained offline/reconnecting + atomic restore, and session close. Inspect that no timer/confirm dialog appears.

- [ ] **Step 2: Add Playwright primary + failure journeys**

  Primary: returning/open question → tap B once → immediate optimistic lock → accepted/authoritative B remains locked → close/result transition. Failure: `student-quiz-late-answer` → tap once → explicit `Question closed before your answer arrived.` and no accepted copy. Add one request/reply-loss retry assertion to prove idempotent reconciliation.

- [ ] **Step 3: Run the executable gate**

  Run: `pnpm --filter @eduscope/quiz test -- src/screens/live src/store src/realtime`
  Run: `pnpm --filter @eduscope/quiz e2e -- e2e/s39-play.spec.ts`
  Run: `pnpm lint && pnpm --filter @eduscope/api-client test`
  Expected: every S-39 state/race, primary/failure journey, boundary rule, no-timer/no-dialog assertions, and contract tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/quiz/e2e/s39-play.spec.ts
git commit -m "test(S-39): gate locked answer and late refusal"
```

---

### Task 11: Gate — S-40 Result and own rank

**Files:** Create `apps/quiz/e2e/s40-result.spec.ts`.

- [ ] **Step 1: Execute the S-40 scenario demo checklist**

  Demonstrate correct, incorrect, missed, rank updating/current, awaiting-next→new question, offline retention, and session close. Cold-load each result from its complete result snapshot and confirm own-only data.

- [ ] **Step 2: Add Playwright primary + failure journeys**

  Primary: correct result renders +10, revealed correct option, running score/current own rank, then forced next question returns to S-39. Failure: incorrect/pending result renders own vs correct answers and `Updating…`, then offline preserves it; rank-current transition updates only rank.

- [ ] **Step 3: Run the executable gate**

  Run: `pnpm --filter @eduscope/quiz test -- src/screens/result`
  Run: `pnpm --filter @eduscope/quiz e2e -- e2e/s40-result.spec.ts`
  Run: `pnpm lint && pnpm --filter @eduscope/api-client test`
  Expected: every S-40 state, primary/failure journey, privacy/boundary assertions, and contract tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/quiz/e2e/s40-result.spec.ts
git commit -m "test(S-40): gate own result and rank freshness"
```

---

### Task 12: Gate — S-41 Session ended

**Files:** Create `apps/quiz/e2e/s41-ended.spec.ts`.

- [ ] **Step 1: Execute the S-41 scenario demo checklist**

  Demonstrate participated, never answered, offline-close reconnect, and direct-session not-found. Confirm all four are terminal and expose no other participant data.

- [ ] **Step 2: Add Playwright primary + failure journeys**

  Primary: force participated close and assert final score, final own rank, answered count, close-tab instruction, and no controls. Failure: force offline, prepare close, restore, assert direct terminal summary + `Reconnected` announcement; also select session-not-found and assert stale-link copy without fabricated summary.

- [ ] **Step 3: Run the executable gate and full Wave 7 sanity**

  Run: `pnpm --filter @eduscope/quiz test -- src/screens/ended`
  Run: `pnpm --filter @eduscope/quiz e2e -- e2e/s41-ended.spec.ts`
  Run: `pnpm --filter @eduscope/quiz test && pnpm --filter @eduscope/quiz e2e`
  Run: `pnpm --filter @eduscope/quiz typecheck && pnpm --filter @eduscope/api-client typecheck`
  Run: `pnpm lint && pnpm --filter @eduscope/api-client test && pnpm --filter @eduscope/shared test`
  Expected: every S-41 state, all five Playwright screen gates, all Testing Library state suites, boundary lint, typechecks, and contract-validation suites PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/quiz/e2e/s41-ended.spec.ts
git commit -m "test(S-41): gate terminal own summary"
```

---

## Decisions taken in this plan

- **W7-D-1 — `/j` is the manual-entry alias.** A dynamic `/j/[joinCode]` route cannot represent an empty manual form. The alias renders the same S-37 component with auto-resolution disabled; it is not a sixth screen or a second join workflow.
- **W7-D-2 — two not-found contexts remain distinct.** Invalid/expired join codes remain editable on S-37, matching S-37's approved copy. S-41 stale-link copy is used only when a direct session route cannot resolve an active participant session. This covers both inventories without turning an input error into a terminal screen.
- **W7-D-3 — S-39/S-40/S-41 do not navigate among themselves.** They are state branches of `/s/[quizSessionId]`; only S-37/S-38 use replace-routing into that route.
- **W7-D-4 — scenario transitions are mock controls, not contract events.** They drive already-approved `StudentServerEvent` payloads or transport behavior and stay on `MockQuizAppClient`. Production `QuizAppClient` and v0.6 contracts remain unchanged.
- **W7-D-5 — no real adapter is introduced.** The current project phase intentionally implements screens against the contract-validating mock, matching `createRealClient`'s Phase-4 placeholder policy. All screen code still depends only on `QuizAppClient`, so the later adapter can replace the provider construction without screen changes.

## Self-review notes

- **Spec coverage:** every state enumerated by S-37…S-41 in `screen-inventory.md` and every additional approved design state appears in the scenario map and in its owning Testing Library list. The five final tasks each repeat the required scenario, boundary, Testing Library, and Playwright checks.
- **Contract/state-machine coverage:** Z-10…Z-15 and Z-20…Z-26 are represented; reconnect performs atomic snapshot replacement; option IDs, first-answer durability, missed semantics, rank freshness, and discriminated terminal summaries remain server-authoritative.
- **Prototype/boundary/kiosk/testing rules:** no prototype mock logic is ported; no screen crosses the client boundary; all student mobile touch/type/safe-bottom rules are explicit; every screen owns a final executable gate.
- **Type consistency:** `StudentQuizTransitionId`, `MockQuizAppClient.forceStudentTransition`, store action names, selector names, and route precedence are defined once and consumed verbatim by later tasks.
- **Scope:** no contract amendment, real transport, SSO, class leaderboard, projector work, or full component code is included. Mechanical scenario/client wiring is specified at code-level granularity; UI tasks remain component/test/behavior plans.
