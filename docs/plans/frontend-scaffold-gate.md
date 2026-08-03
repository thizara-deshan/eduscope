# Wave 0 scaffold gate — record

Exit condition (screen-inventory §11 Wave 0): *"A screen can be built without
touching `fetch`."*

| # | Gate | Command | Result | Evidence |
|---|---|---|---|---|
| 1 | Both apps boot on the mock; the overlay switches scripts live; telemetry causes no renders | `pnpm gate` | ✅ pass | `5 passed` / panel (3, 13.3s) + quiz (2, 38.4s) |
| 2 | Client covers 100 % of contract operations and events | `pnpm --filter @eduscope/api-client test gate-contract-coverage` | ✅ pass | 77 / 77 operations, 22 / 22 events, `5 passed` |
| 3 | The boundary rule fails the build on a direct fetch | `pnpm test tools/eslint-rules/gate-boundary.test.ts` | ✅ pass | `exit=1` with `no-restricted-globals`, `3 passed` |
| 4 | CI green | `gh run watch` | ⏳ pending | not yet run — `gh` CLI unavailable in this environment; blocked on user pushing/opening the PR (see Task 20 note below) |

Supporting local runs, all green on commit `d6d3cb6` (2026-08-03):

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0, no `error TS` |
| `pnpm lint` | exit 0, no output |
| `pnpm test` | exit 0, `30 files, 276 tests passed` (includes `gate-contract-coverage.test.ts` and `gate-boundary.test.ts`) |
| `pnpm build` | exit 0, `vite build` (panel) and `next build` (quiz) both succeed |
| `pnpm gate` | exit 0, `5 passed` across the two apps |
| `pnpm e2e` | exit 0, `6 passed` — panel's `e2e/` directory now holds both `gate-boot.spec.ts` (Task 21, 3 tests) and the pre-existing `panel-smoke.spec.ts` (Task 19, 3 tests); the plan's "3 passed" estimate predates Task 21 adding a second spec file to the same directory |

**Gate 4 status:** the `gate` job was added to `.github/workflows/ci.yml`
(Step 1) and every command it runs has been verified green locally above.
Actually watching a CI run requires pushing this branch and either the `gh`
CLI (not installed in this environment) or an authenticated GitHub session
(the in-app browser has none). Per the ruling recorded against Task 20, the
user is pushing/opening the PR themselves and will report the run result —
this row stays pending until that's confirmed, and the scaffold is not
declared complete until it is.

**Node floor bumped twice: 22.11.0 → 22.12.0 → 22.13.0 (all five jobs
failed the first two PR runs).** The user reported all five CI jobs
failing with `ERR_PNPM_UNSUPPORTED_ENGINE`, twice in a row:

1. `vite@7.3.6` (resolved from the plan's own "Vite >= 7" floor) requires
   Node `>=22.12.0`, which the plan's original floor (`22.11.0`) doesn't
   satisfy. Bumped to 22.12.0.
2. That still failed: `eslint-visitor-keys@5.0.1` (a transitive dep of
   `eslint@9`) requires `^22.13.0` specifically — `22.12.0` doesn't match
   that range. Bumped to 22.13.0, this time verified against every
   installed package's `engines.node` field (not just the one that broke)
   so a third round isn't needed.

Both invisible locally, since this environment runs Node 24. Genuine
conflicts between the plan's own Global Constraints ("Node >= 22.11" vs.
"Vite >= 7" / whatever `eslint@9` pulls in), not given-code bugs; asked the
human partner which governs before the first bump (2026-08-03), approved:
bump the floor wherever it's pinned, including the locked test in
`tools/workspace.test.ts`. All 276 tests pass after both changes.

## Deliberate exclusions

- **`quiz-sync` operations (4).** `quizSyncCreateSession`, `quizSyncCloseSession`,
  `quizSyncPublish`, `quizSyncClosePublication` are hosted by the quiz service
  with core-api as the client (openapi.yaml, tag `quiz-sync`). No browser calls
  them. Gate 2b asserts the exclusion list is exactly these four.
- **CG-1.** The student-facing REST surface has no contract. `QuizAppClient`'s
  REST half is provisional and labelled as such in the source; its event half is
  contract-validated. `apps/quiz` screens are buildable on the mock;
  **integration is blocked until `contracts/quiz-app.yaml` lands.**
- **CG-2, CG-3, CG-7.** Not scaffold blockers; they block Waves 5/6 and 8.
- **`--danger` / `--info` tokens.** Defined in `tokens.css`, used by nothing —
  screen-inventory §8.2 requires wireframe approval before use.

## What this scaffold does NOT contain

No screen implementation. Route files render placeholders. S-01…S-42 are prompt 09.
