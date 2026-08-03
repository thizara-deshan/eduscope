# Wave 0 scaffold gate — record

Exit condition (screen-inventory §11 Wave 0): *"A screen can be built without
touching `fetch`."*

| # | Gate | Command | Result | Evidence |
|---|---|---|---|---|
| 1 | Both apps boot on the mock; the overlay switches scripts live; telemetry causes no renders | `pnpm gate` | ✅ pass | `5 passed` / panel (3, 13.3s) + quiz (2, 38.4s) |
| 2 | Client covers 100 % of contract operations and events | `pnpm --filter @eduscope/api-client test gate-contract-coverage` | ✅ pass | 77 / 77 operations, 22 / 22 events, `5 passed` |
| 3 | The boundary rule fails the build on a direct fetch | `pnpm test tools/eslint-rules/gate-boundary.test.ts` | ✅ pass | `exit=1` with `no-restricted-globals`, `3 passed` |
| 4 | CI green | `gh run watch` | ✅ pass | all 6 jobs green (typecheck, lint, test, build, e2e, gate) on the PR against `worktree-frontend-scaffold`, confirmed by user, 2026-08-03 |

Supporting local runs, all green on commit `d6d3cb6` (2026-08-03):

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0, no `error TS` |
| `pnpm lint` | exit 0, no output |
| `pnpm test` | exit 0, `30 files, 276 tests passed` (includes `gate-contract-coverage.test.ts` and `gate-boundary.test.ts`) |
| `pnpm build` | exit 0, `vite build` (panel) and `next build` (quiz) both succeed |
| `pnpm gate` | exit 0, `5 passed` across the two apps |
| `pnpm e2e` | exit 0, `6 passed` — panel's `e2e/` directory now holds both `gate-boot.spec.ts` (Task 21, 3 tests) and the pre-existing `panel-smoke.spec.ts` (Task 19, 3 tests); the plan's "3 passed" estimate predates Task 21 adding a second spec file to the same directory |

## Post-gate conformance pass (2026-08-04)

A validation sweep of the repo against this plan found the tree structurally
complete but **not reproducibly green**, and closed the gaps below. Re-verified
after, on Node 24 / pnpm 9.6 with Chromium 1234 installed:

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0, no output |
| `pnpm test` | exit 0, **31 files / 280 tests passed** |
| `pnpm build` | exit 0 |
| `pnpm e2e` | exit 0, **6 passed** |
| `pnpm gate` | exit 0, **5 passed** — panel 3 (1a, 1b, 1e) + quiz 2 (1c, 1d) |

| Finding | Resolution |
|---|---|
| `pnpm lint` exited 1 on a clean tree (1142 errors) — ESLint flat config does not read `.gitignore`, so `eslint .` walked `.claude/worktrees/` (a full second copy of the repo, `prototype/` and `legacy-Codebase/` included) and `.agents/skills/`. This failed Gate 3's `3a` and `3c`. | Added `.claude/**`, `.agents/**`, `agent/**`, `revamp-guide/**` to the `ignores` block in `eslint.config.js`. |
| Gate 3's `3b` asserted only a non-zero exit code, so it passed **vacuously** while lint was red — it would have passed with the boundary rule deleted. | `gate-boundary.test.ts` now asserts the failure names `no-restricted-globals` and points at the `__gate__` fixture. |
| `mock/events/emitter.ts`, `store/connection.ts` and `test/event-coverage.test.ts` appeared in the File Structure but did not exist; their logic was inlined elsewhere. | Extracted to the specified paths — no duplication, all behaviour-preserving. `event-coverage.test.ts` is new coverage from the client's side of the boundary. |
| The mock simulation shipped in the panel's **production** entry chunk (415.56 kB / 124.31 kB gzip). Confirmed by grepping the built artifact for `pipeline-crash-midway`. Flipping `VITE_EDUSCOPE_REAL_API` did not remove it, because the dev overlay's static `listScenarios` import anchored the whole catalog. | `client-provider.tsx` loads the mock via dynamic `import()`, and the overlay is `lazy()` behind a build-time flag, so both split out of the entry chunk. See the adapter-selection note below for which flag. |
| Nothing enforced that. | CI's `build` job now fails if the entry chunk exceeds **150 kB gzip**. |
| `ScaffoldShell` incremented `window.__renderCount` in the render body — impure, and double-counted under `StrictMode`, inflating Gate 1e's own measurement. | Moved into a `useEffect`, so it counts commits. |
| `tools/workspace.test.ts` asserted `vitest.workspace.ts` contains `'jsdom'`. That file only delegates and never names an environment, so the assertion was satisfied by a **comment** and kept passing after the panel moved to happy-dom. | Rewritten to assert the environment in each app's own `vitest.config.ts`. The plan's Task 1 snippet was corrected to match. |
| Root `package.json` still carried an unused `jsdom` devDependency. | Removed; lockfile regenerated (`lockfileVersion: '9.0'` preserved). |
| `packages/shared/node_modules/` held an npm-style `.package-lock.json` from a stray `npm install` inside a pnpm workspace. | Deleted. |
| The plan's own text disagreed with itself or with the repo in four places: Node floor still `22.11`; Task 13 still specified `jsdom`; File Structure placed `contract-honesty.test.ts` at `test/` while Task 10 placed it at `test/mock/`. | Plan corrected in place, each with an inline note. Every path the plan declares — 79 in File Structure, 145 across all task Files blocks — now resolves on disk. |

### The overlay gate is adapter selection, not `import.meta.env.DEV`

Gating the scenario overlay on `import.meta.env.DEV` was the obvious move and it
was **wrong**: Playwright drives `vite preview`, a production build, where `DEV`
is false. Gate 1b (*"the overlay switches every catalog script live"*) and the
matching smoke test both failed on a missing `scenario-hotspot` — the gate caught
it, which is what the gate is for.

`App.tsx` now gates on `import.meta.env.VITE_EDUSCOPE_REAL_API !== '1'`. The
overlay only ever does anything against a mock client, so it ships exactly when
the mock ships, and the flag that selects the adapter is the flag that decides
both. Resulting builds, measured:

| Build | Entry chunk | Split chunks | Catalog / overlay / preview mock in entry? |
|---|---|---|---|
| default (mock adapter — dev, CI, Playwright) | 383.14 kB / **115.81 kB gzip** | `create-mock-client` 30.70 kB, `registry` 2.85 kB, `scenario-overlay` 1.57 kB | no — lazily fetched after first paint |
| `VITE_EDUSCOPE_REAL_API=1` (the device) | 357.82 kB / **108.40 kB gzip** | none | **no — eliminated entirely** |

Baseline before this pass was 415.56 kB / 124.31 kB gzip in one chunk, with the
whole simulation inside it. The device build is the one that matters, and it is
now 16 kB gzip lighter with none of the mock in it.

### Deliberately not changed

- **`PREVIEW_FPS = 8` / `toDataURL`.** Flagged as a main-thread encode cost on
  the RK3588, then withdrawn: Task 11's cost note and this plan's Self-Review
  already price it (one reused canvas, 480×270 @ q0.5, 8 fps) and explicitly
  reject an `OffscreenCanvas` rewrite, since Wave 8 replaces the path with a
  WebRTC `MediaStream` and `convertToBlob` would not return the JPEG data URI
  the scaffold is specified to produce.
- **Route-level code splitting.** Every route element is currently the same
  `ScreenPlaceholder`; converting to `lazy:` would point dynamic imports at
  screen modules that do not exist yet. This belongs in prompt 09's first task.
- **`boundaryExempt: ['packages/api-client/src/**']`.** Matches the plan
  verbatim. Narrow it to `real/` when the Phase-4 adapter lands.
- **The stale `.claude/worktrees/frontend-scaffold` worktree.** Fully merged
  into `main` and now ESLint-ignored, so it is inert; removing it needs a
  permission this session did not have.

**Gate 4 status: closed.** The `gate` job was added to
`.github/workflows/ci.yml` (Step 1); every command it runs was verified
green locally, then the branch was pushed to the open PR. Two CI runs
failed on Node engine mismatches (see below), fixed and re-pushed; the
third run went green across all 6 jobs, confirmed by the user 2026-08-03.
`gh` CLI was never available in this environment, so CI was watched by the
user directly rather than via `gh run watch`.

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
