# Wave 4 — AI & Insights: Gate Evidence

Recorded while executing `docs/plans/screens/wave-4-ai-and-insights.md`.

---

## GATE S-13 — AI Studio

**Automated evidence:**
- Testing Library: `pnpm --filter @eduscope/panel test -- ai/use-ai-studio screens/ai/ai-studio-card` — 23/23 passed (2 files). Named tests cover `unavailable`(hidden), `armed`, `generating`, `held`, `degraded`, `set ready`(banner+count), `set failed`, `superseded`, `interval pending`, U-1 skeleton, U-2 dimmed, U-5 refusal copy.
- Playwright: `apps/panel/e2e/s13-ai-studio.spec.ts` — 3/3 passed (primary: arms → interval defaults 20 → Generate Now → ready banner → Review opens S-14; failure: `llm-timeout` degrades with Retry, recording chrome stays live; kiosk: no page scroll, ≥44px interval control).
- Boundary lint: `pnpm lint` and `pnpm test tools/eslint-rules/gate-boundary.test.ts` — green.

**Scenario-overlay demo walk (S-13 rows):**

| Row | Script/action | Observed |
|---|---|---|
| `unavailable` (hidden) | `happy` + World: AI disabled | Card absent; `CaptureAssuranceCard` shows instead |
| `armed` | `happy`, Start | ~1s after record-start, countdown `armed`, interval selectable, Generate Now enabled |
| `generating` | `happy`, tap Generate Questions Now | "Generating…" on a disabled button |
| `held` | `happy` → Start → Pause | Countdown frozen, "paused" caption, Generate Now disabled |
| `degraded` | `llm-timeout` → Start → Generate now | ~4s later, unavailable body + Retry; countdown held |
| `set ready` | `happy` → Generate now | Green banner "A new set is ready" + count + Review Questions opens S-14 |
| `set failed` | `llm-timeout` → Generate now | "couldn't generate" + retry |
| `superseded` | `happy` → Generate now twice | Latest banner replaces; lecturer-authored drafts persist |
| `interval change pending` | `happy`, change interval select | Brief pending state, then new `remainingMs` |
| U-1 | reload mid-mock | `session-main-skeleton` then the card |
| U-2 | `ws-flap`, past `T-WS-STALE` | Card dims, countdown frozen, controls disabled |
| U-5 | `llm-timeout`, second Generate | Inline `409 ai.unavailable` reason, no spinner |

**Contract/implementation gap found during execution (recorded only — no contract edit made):**
- None specific to S-13. The root-cause mock gap discovered in this gate window (question/publication id correlation, see S-14's entry below) affected S-13's own draft-count query indirectly, since `use-ai-studio.ts`'s ready-banner count reads `listQuestions({ state: 'draft' })` from the same REST snapshot S-14 lists from.

---

## GATE S-20 — Quiz join

**Automated evidence:**
- Testing Library: `pnpm --filter @eduscope/panel test -- ai/quiz-qr ai/use-quiz-session screens/ai/quiz-join-chip screens/ai/quiz-join-modal` — 21/21 passed (4 files). Every 4a state, the anti-placebo checks (no retry/reconnect control in `failed`), and the CG-19 live stale path are covered.
- Playwright: `apps/panel/e2e/s20-quiz-join.spec.ts` — 2/2 passed (primary: "starting…" → "N joined" → QR+code+URL visible → close returns focus to chip; failure: `quiz-network-loss` → `Quiz unavailable`, no retry control).
- Boundary lint — green.

**Scenario-overlay demo walk (S-20 rows):**

| Row | Script/action | Observed |
|---|---|---|
| `absent` (not rendered) | `happy` + World: Quiz server unavailable, before record | Chip absent |
| `requesting` | `happy`, Start | "Quiz · starting…", non-interactive, bounded ≤8s |
| `open` | `happy`, ~2s after start | "Quiz · N joined"; tap opens modal with QR + code + URL + count |
| `open` + `stale` | `quiz-network-loss`, ~3s after Z-01 | Count dims + ⚠, "may be out of date · last synced …"; QR/code unchanged |
| `failed` | `quiz-network-loss` (or World: Quiz server unavailable at start) | Chip `Quiz unavailable` (`--warning`); modal explains, **no Retry** |
| `closed` (unmounts) | `happy`, Stop | Chip unmounts |
| U-1 | reload mid-`open` | Skeleton chip from REST snapshot, no layout shift |
| U-2 | `ws-flap` | Chip dimmed, count frozen + reconnecting marker; QR still usable |
| U-5 | n/a | Inapplicable — S-20 issues no command |

**Contract/implementation gap found during execution (recorded only — no contract edit made):**
- None found specific to S-20.

---

## GATE S-14 — Questions review

**Automated evidence:**
- Testing Library: `pnpm --filter @eduscope/panel test -- ai/use-questions screens/ai/questions-modal screens/ai/question-card` — 22/22 passed (3 files). Every enumerated state covered, incl. Send disabled exactly when `useQuizSession().state !== 'open'`, immutable-edit 409 leaves the row unchanged, superseded-while-open keeps authored rows.
- Playwright: `apps/panel/e2e/s14-questions.spec.ts` — 3/3 passed (primary: expand a draft, tap-a-letter correct, Send → sending → sent, echoed in S-16; failure: quiz unavailable at record-start disables Send with the same 4a reason S-20's chip shows; immutable: editing a `sent` question shows the 409 reason and does not revert).
- Boundary lint — green.

**Scenario-overlay demo walk (S-14 rows):**

| Row | Script/action | Observed |
|---|---|---|
| `empty` | `happy`, open modal before any generate | `.us-empty` "No questions right now" |
| `loading` | `happy` → Generate now → immediately Review | Generating body, not empty |
| `populated` | `happy` → Generate now → ready → Review | Collapsed accordion, seeded drafts incl. one "Yours" |
| `editing` | edit a draft prompt | `edited:true` echo, one audit entry |
| `edit refused (immutable)` | edit the seeded `sent` question | Rejection shown, not reverted |
| `discarding`/`discarded` | Discard a draft | Row leaves |
| `regenerating` | Regenerate in-modal | New set requested |
| `sending` | Send a draft | Pending; projector not switched yet |
| `sent` | resolves | Question moves to sent list |
| `send failed` | forced `Q-32` | "couldn't send to the projector" + retry; slides unchanged |
| `send refused (quiz unavailable)` | World: Quiz server unavailable at record-start | Send disabled with the reason — same 4a `failed` S-20's chip shows |
| `superseded while open` | Generate now while modal open | List updates; authored draft stays |
| U-2/U-4/U-5 | `ws-flap`, pending states above | Modal read-only under `ws-flap`; refusal copy as above |

**Contract/implementation gap found during execution (recorded only — no contract edit made):**
- The mock's question/publication id correlation was structurally broken across Q-12/Q-19/Q-30/Q-31: a freshly-generated draft (Q-12) was never pushed into `seed.questions`, so `listQuestions` never returned it and the frontend only ever saw an empty-content WS-merge stub for it; `sendToProjector`'s resulting `ai.question`/`quiz.publication` events read a single global `ai.publication.ulid`/`ai.question.ulid` pointer rather than the specific question actually targeted, so a live send's resolving echo could carry the wrong id (or an unrelated one) once more than one question existed. Caught only once real end-to-end Playwright journeys tried to send a *specific* freshly-generated draft and observed it never reaching `sent` (unit tests each stubbed a single question/echo pair in isolation and never exercised the correlation). Fixed in `packages/api-client/src/mock/rest/ai.ts` (subscriptions that mirror a freshly-generated draft into `seed.questions` on its first `ai.question{draft, provenance:'generated'}` broadcast, and mirror a live-created publication into `seed.publications` on its first `quiz.publication{publishing}` broadcast) and in `packages/api-client/src/mock/machines/ai.ts` (`sendToProjector`/`createQuestion`/`editQuestion`/`discardQuestion` now stamp the *specific* question id being acted on into `world.data` before running their transition plan, rather than relying on a single shared pointer). Covered by the new `packages/api-client/test/mock/wave4-question-id-correlation.test.ts` (3 tests).
- A related TanStack Query key collision: `use-ai-studio.ts`'s ready-banner draft count and `use-questions.ts`'s full question list both used the unparameterized `AI_KEYS.questions(sessionId)` key for two differently-filtered queries, so one hook's cached (differently-shaped) result silently served the other. Fixed by parameterizing `AI_KEYS.questions` with an explicit `state` segment (`apps/panel/src/ai/query-keys.ts`), and `use-ai-studio.ts`'s `draftsQuery` now keys on `AI_KEYS.questions(sessionId, 'draft')`.
- Both `use-questions.ts` and `use-insights.ts` cache their REST snapshot with `staleTime: Infinity` and had no path to refetch when a live event announced a row the snapshot didn't yet contain. Fixed by adding a "refetch once per newly-observed id" effect to each hook (`apps/panel/src/ai/use-questions.ts`, `apps/panel/src/ai/use-insights.ts`).

---

## GATE S-15 — Add Question

**Automated evidence:**
- Testing Library: `pnpm --filter @eduscope/panel test -- ai/use-add-question screens/ai/add-question-dialog` — 14/14 passed (2 files). Every state covered incl. the validity-gate reasons and a rejected save keeping the form intact.
- Playwright: `apps/panel/e2e/s15-add-question.spec.ts` — 2/2 passed (primary: prompt + 2 choices + correct → Save → a new "Yours" draft appears in S-14; invalid: submit stays blocked with the specific reason until the prompt and every choice are filled).
- Boundary lint — green.

**Scenario-overlay demo walk (S-15 rows):**

| Row | Script/action | Observed |
|---|---|---|
| `empty` (blank) | `happy`, open dialog | Blank prompt + 2 default choices |
| `filling` | add/remove choices | Choice count stays within 2–4 |
| `invalid` | leave the prompt or a choice blank | Save disabled + the specific violated reason |
| `saving` (U-4) | Save with a valid form | Brief pending state |
| `rejected` | World: AI disabled after opening | `409` rejection shown, form intact |
| `saved` | Save with a valid form | Dialog closes; new "Yours" draft appears in S-14 |
| OSK | focus the prompt field | Body scrolls internally only; the correct-answer letter row stays visible under the keyboard; no page scroll |

**Contract/implementation gap found during execution (recorded only — no contract edit made):**
- None new beyond the id-correlation fix recorded under S-14 (this dialog's `createQuestion` echo depends on the same correlation code path).

---

## GATE S-16 — Previous Questions

**Automated evidence:**
- Testing Library: `pnpm --filter @eduscope/panel test -- ai/use-insights screens/ai/insights-column screens/ai/previous-questions-tab` — 22/22 passed (3 files). Covers exactly-one-"Now showing", `seq`-gap resync replacing (not adding to) counts (INV-AP-1), and the reveal-note-not-reopening-acceptance case.
- Playwright: `apps/panel/e2e/s16-previous-questions.spec.ts` — 2/2 passed.
- Boundary lint — green.

**Scenario-overlay demo walk (S-16 rows):**

| Row | Script/action | Observed |
|---|---|---|
| `empty` | `happy`, Start before any send | "This fills as questions are sent to students." (not "no data") |
| `populated` + Now showing | `happy`, send a question | Card with "Now showing" badge |
| `withdrawn` | `setProjector(null)` from a shown card | Badge gone, publication stays `open` |
| `closed` | Close the question | Card states the close reason |
| `re-projected (reveal)` | Re-project a `closed` publication | Correct answer shown; "students can no longer respond" — acceptance not reopened |
| `responses stale` | a *live* sent question whose sync later goes stale | **Not independently reachable under `quiz-network-loss`** — see gap below |
| `sync failed` | `Z-32` | Degraded banner; recording untouched |
| `publish failed` | forced `Q-32` | S-14's send-failure echoed here |
| U-1/U-2/U-3/U-4/U-5 | cold load, `ws-flap`, forced `seq` gap | Skeleton; read-only under flap; a resync replaces counts, never adds |

**Contract/implementation gap found during execution (recorded only — no contract edit made):**
- **Plan/mock contradiction, redesigned with explicit user sign-off.** The plan's S-16 failure test called for `quiz-network-loss` → send a question → observe its responses go stale. `quiz-network-loss.ts`'s own `forced` rules (`packages/api-client/src/mock/scenario/scripts/quiz-network-loss.ts:28-39`) unconditionally refuse every `sendToProjector` command with a 409 — by the scenario's own stated design ("Send to Projector is refused with a named reason"), so no question can ever be successfully sent while this scenario is active. Separately, `Z-30`'s `quiz.publication{syncState:'stale'}` payload builder (`packages/api-client/src/mock/machines/ai.ts:300-318`) mints a brand-new id via `nextUlid()` whenever no prior in-session send has set `ai.publication.ulid` — so even the seed's pre-existing closed publication can never become the target of that stale flip. Net effect: a live "sent question, now marked stale" state is unreachable through any UI path under `quiz-network-loss`, contradicting the plan's literal test description. Per user decision (asked mid-execution), the S-16 failure test was redefined to assert the scenario's actual, reachable behavior instead: Send is refused with the named 409 reason, no new publication card is created, and recording stays untouched. The `responses stale` row's actual mechanics remain covered at the unit level (`previous-questions-tab.test.tsx`, a directly-crafted stale WS delta).

---

## GATE S-17 — Leaderboard

**Automated evidence:**
- Testing Library: `pnpm --filter @eduscope/panel test -- ai/use-leaderboard screens/ai/leaderboard-tab` — 14/14 passed (2 files). Covers tie-rank sharing, `answered:0` → accuracy 0, and recompute-without-refetch on a `quiz.responses` delta.
- Playwright: `apps/panel/e2e/s17-leaderboard.spec.ts` — 3/3 passed (primary: ranked rows with medals, `{correct}/{answered}`, score, a row opens S-19; failure: `quiz-network-loss` marks the whole list stale; never-projectable: no projector control anywhere on the tab).
- Boundary lint — green.

**Scenario-overlay demo walk (S-17 rows):**

| Row | Script/action | Observed |
|---|---|---|
| `empty` | no answers yet | Explanatory empty state |
| `populated` | `happy` | Seed's 3 ranked rows with top-3 medals |
| `live` | responses streaming | Live dot while streaming |
| `stale` | `quiz-network-loss` | Whole list marked out of date |
| `quiz unavailable` | World: Quiz server unavailable | Explanatory empty state, not a zero table |
| `accuracy edge case` | a student who missed a question | Unanswered, not incorrect (INV-QP-2) |
| U-1/U-2/U-3/U-5 | cold load, `ws-flap` | Skeleton; stale-marked under flap; no projector affordance anywhere |

**Contract/implementation gap found during execution (recorded only — no contract edit made):**
- None found specific to S-17. (Unlike S-16/S-18, the leaderboard's stale state is driven by the *global* `quiz.sync` machine state rather than a per-publication correlation, so it is fully reachable under `quiz-network-loss` with no redesign needed.)

---

## GATE S-18 — Response names

**Automated evidence:**
- Testing Library: `pnpm --filter @eduscope/panel test -- ai/use-publication-responses screens/ai/names-dialog` — 11/11 passed (2 files). Covers the filter switch, the stale banner not presenting counts as current, and closing on scrim tap.
- Playwright: `apps/panel/e2e/s18-names.spec.ts` — 2/2 passed.
- Boundary lint — green.

**Scenario-overlay demo walk (S-18 rows):**

| Row | Script/action | Observed |
|---|---|---|
| `loading` | open the dialog cold | Skeleton |
| `empty` | open for a publication nobody has answered | "Nobody has answered yet" |
| `populated` | `happy`, S-16 badge on a sent publication | Three filterable name lists |
| `stale` | `quiz-network-loss`, open any publication's dialog | Banner with `syncedAt` — see note below |
| `sync failed` | `Z-32` | Sync-failed banner supersedes the stale one |
| U-2/U-5 | `ws-flap` | Read-only; no command issued by this screen |

**Contract/implementation gap found during execution (recorded only — no contract edit made):**
- The plan's S-18 failure test assumed a *live-sent* question's responses going stale under `quiz-network-loss` — unreachable for the same reason recorded under S-16 (every `sendToProjector` is unconditionally refused under this scenario). However, `listPublicationResponses` (`packages/api-client/src/mock/rest/quiz.ts:25-37`) computes `stale` from the *global* `world.state('quiz.sync')`, not from any per-publication correlation — unlike S-16's `syncState`, which *is* correlated per-publication via WS deltas. So opening the names dialog for **any** existing publication (including the seed's pre-existing one, with no live send required) correctly shows the stale banner with `syncedAt` once `quiz.sync` flips, ~3s after record-start under `quiz-network-loss`. The e2e test was simplified to drop the unreachable live-send step and instead wait for the global sync flip before opening the seed's own publication — this matches the plan's literal assertion ("stale banner with `syncedAt`") without needing a workaround.

---

## GATE S-19 — Student detail, and Wave-4 exit

**Automated evidence:**
- Testing Library: `pnpm --filter @eduscope/panel test -- screens/ai/student-detail-dialog` — 5/5 passed.
- Playwright: `apps/panel/e2e/s19-student-detail.spec.ts` — 2/2 passed (primary: an S-17 row opens per-question history with the running score and rank; partial: a late-joiner's missed questions render unanswered, never incorrect).
- Full green: `pnpm lint && pnpm typecheck && pnpm test && pnpm gate` — all exit 0. Workspace totals: 129 test files, 1109 tests passed, 0 failed. `tools/eslint-rules/gate-boundary.test.ts` (which itself re-runs `pnpm lint` and confirms a deliberately-introduced direct-network import fails the build) is green.
- All 19 Wave-4 Playwright specs (S-13 through S-20, primary + failure + kiosk/immutable/never-projectable variants) run together, 19/19 passed.

**Scenario-overlay demo walk (S-19 rows):**

| Row | Script/action | Observed |
|---|---|---|
| `loading` | open from an S-17 row cold | Skeleton |
| `populated` | `happy`, an S-17 row | Per-question history, running score, and rank matching the leaderboard entry |
| `partial` | a leaderboard entry with `answered < publication count` | Missed questions render **unanswered**, never incorrect (INV-QP-2) |
| `stale` | `quiz-network-loss` | Data marked stale, not fabricated |
| U-2/U-5 | `ws-flap` | Read-only; no command issued by this screen |

**Wave-4 exit condition (J-2 end-to-end, one mock session):**
- `happy`: Start → AI Studio arms (countdown `armed`, interval defaults 20) + quiz opens (chip "starting…" → "N joined") → Generate now → ready banner → Review opens S-14 → tap-a-letter correct → Send → "sending…" → `sent` → S-16 shows the card "Now showing" → S-17's leaderboard fills as responses stream in → a leaderboard row opens S-19 with matching score/rank → an S-16 badge opens S-18 with the same names, filterable by Responded/Correct/Incorrect.
- Switch to `llm-timeout`: Studio degrades to its Retry state (`degraded`/`set failed`); `data-recording-state="recording"` holds throughout — recording is unaffected by the AI failure.
- Switch to `quiz-network-loss`: quiz session flips to `stale` then S-20's chip reads `Quiz unavailable`; S-14's Send is disabled with the same named reason (S20-D-5, "one truth, two surfaces" — asserted together in `s14-questions.spec.ts`'s failure test); recording stays untouched throughout.
- All three legs verified via the individual per-screen Playwright specs above (each already exercises the relevant scenario end-to-end); no separate combined spec file was added, since the plan's exit condition is a walkthrough/demo requirement rather than a new automated test artifact, and the per-screen specs already cover every leg of it in isolation with `data-recording-state` asserted at each failure boundary.

**Contract/implementation gap found during execution (recorded only — no contract edit made):**
- See S-14's entry for the id-correlation and query-key-collision fixes, which were the two structural mock/frontend gaps found and fixed during this gate window. See S-16 and S-18's entries for the `quiz-network-loss` scenario-vs-plan contradiction found for two of the eight screens' failure tests, and how each was resolved (one redesigned to the scenario's actual behavior with user sign-off, one resolved without a workaround once the true stale-computation mechanism was understood).
