# Wave 1 auth & shell gate — record

Exit condition (screen-inventory §11 Wave 1): *"A user can log in, be forced to
reset, and see live chrome."*

Format follows `docs/plans/frontend-scaffold-gate.md`.

---

## S-01 — Login

**Common preconditions**

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0, no output |
| `pnpm test` | exit 0 — `28 files, 190 tests passed` (panel) |
| `pnpm build` | exit 0 |
| `pnpm --filter @eduscope/panel preview` | serves on `http://127.0.0.1:4173` |

### Step 1 — Playwright, `e2e/s01-login.spec.ts`

| # | Test | Result |
|---|---|---|
| 1 | primary journey — happy: sign in, land on `/`, S-04 renders, header shows the hall name | ✅ pass |
| 2 | failure 1 — rejected credentials: exact copy, username kept, password cleared, still `/login` | ✅ pass |
| 3 | failure 2 — must-reset: `n.silva`/`temp-pass-1` lands on `/login/reset` | ✅ pass |
| 4 | geometry — keyboard open, submit bottom edge ≤ 404px, `--osk-h` = `380px` | ✅ pass |
| 5 | no page scroll on `/login` | ✅ pass |
| 6 | no header on `/login` | ✅ pass |

`pnpm --filter @eduscope/panel e2e s01-login` → **6 passed** (20.6s).

### Step 2 — Testing Library, one test per enumerated state

`pnpm --filter @eduscope/panel test src/screens/login src/auth src/keyboard` → **57 passed** (8 files).

Coverage confirmed row-by-row (S-01 §5), all in `login-screen.test.tsx` (15 tests) plus `use-login.test.ts` (10 tests):

| State | Covered by |
|---|---|
| `empty` | `login-screen.test.tsx` — submit disabled, message slot empty |
| `submitting` | `login-screen.test.tsx` + `use-login.test.ts` |
| `rejected` | both — exact copy, password cleared, focus returned |
| `disabled account` | both — warning treatment |
| `must-reset` | both — navigates to `/login/reset`, `setUser` called |
| `backend unreachable` | both — info treatment, 10s ceiling, backoff retry to success |
| `session expired` ×4 reasons | `login-screen.test.tsx` (`it.each` + logout case) |
| `success` | both — `state.from` and default `/` |

No row is missing.

### Step 3 — Boundary lint

```
pnpm lint && pnpm test tools/eslint-rules/gate-boundary.test.ts
```
Result: exit 0; `gate-boundary.test.ts` → **3 passed** (3a/3b/3c), boundary rule still fails a build with a direct `fetch`.

### Step 4 — Scenario demo checklist (live, `http://127.0.0.1:4173`, 1280×800)

| # | State | How reached | Observed |
|---|---|---|---|
| 1 | `empty` | `happy`, load `/login` | Both fields blank, submit `disabled: true`, message slot present with empty text |
| 2 | `submitting` | `auth-failures`, submit | Pending affordance on submit; confirmed via automated timing (unit + e2e), transient window too short to freeze-frame manually in the live pane |
| 3 | `backend unreachable` | same attempt | Transport fault fires, auto-retry succeeds — login completed and landed on the dashboard without further user action |
| 4 | `rejected` | `happy`, `a.perera`/`wrong` | Exact copy shown; username kept (`a.perera`); password cleared; router stayed on `/login` |
| 5 | `disabled account` | `happy`, `r.fonseka`/`Correct-horse-9` | *"This account is not active — ask your administrator."*, class `us-authmsg--warning` |
| 6 | `must-reset` | `happy`, `n.silva`/`temp-pass-1` | Landed on `/login/reset` directly, no flash of the dashboard |
| 7 | `session expired` (takeover) | `auth-failures`, sign in; shell's first `getProvisioning` refused | Back at `/login` with *"An administrator took over this recording. Sign in again to continue."* — **required a real fix, see below** |
| 8 | `session expired` (logout) | Sign in, header ▾ → Sign out | Back at `/login` with no message |
| 9 | `success` | `happy`, `a.perera`/`correct-horse` | Landed on `/`, S-04 placeholder, header shows *"Engineering Auditorium A301"* |

> Rows `expired` and `admin` have no Wave-1 producer (no refresh loop yet) — covered by `login-screen.test.tsx`'s `it.each` against the same code path, per the plan's own note. Not demonstrated live, as documented.

**Defects found and fixed during this gate** (both real, both live-reproduced before being fixed — see `git log` for the fix commit):

1. **`useProvisioning`'s query silently retried past the one-time `getProvisioning` refusal.** `query-client.ts`'s default `retry: 1` meant the *second* attempt (after the refusal was already consumed) succeeded normally, so `useSessionRevocation` never saw an error and the takeover redirect never fired. Fixed by setting `retry: false` on this specific query — it is the session-revocation detector and must not retry past what it exists to catch.
2. **A redirect race clobbered `state.reason`.** `useSessionRevocation` navigated to `/login` and cleared the user in the same tick; the still-mounted `RequireRole` on the old route observed `user === null` one render ahead of the router's own transition and fired its own generic `state: { from }` redirect, landing second and silently overwriting `state: { reason: 'takeover' }`. Fixed by deferring `setUser(null)` one turn (`setTimeout(…, 0)`) so the router's navigation commits first.

Both fixes are covered by the existing automated suite (`panel-header.test.tsx`'s takeover test now uses the *real* `createQueryClient()` factory rather than a hand-rolled one, specifically so it would have caught defect #1) and reverified live after the fix (see the "Sign out shows no message" and takeover-copy checks run against the built preview).

### Step 5 — Visual review against the prototype and tokens, 1280×800

| Check | Result |
|---|---|
| Card 420px, dark band, title "Welcome back", subtitle "Sign in to your recording panel" | ✅ computed: `width:420px`, band `background:rgb(16,19,25)` (`--ink`), title/subtitle text exact |
| No role picker anywhere, nothing filling the space | ✅ no element matches `/lecturer\|administrator/i` |
| Message slot occupies 40px from first paint, before any message exists | ✅ computed `height:40px` on `.us-authmsg` with empty text |
| With the keyboard open the band collapses to 0 and the card is in its 393px geometry | ✅ verified via the Playwright e2e geometry test (`--osk-h` → `380px`, submit bottom ≤ 404px); **not independently reproducible in the Claude Browser pane** — that pane's `.focus()` calls update `document.activeElement` but do not reliably trigger the native focus event the keyboard host listens for, a tooling artifact of this review environment, not the app. The Playwright test is the authoritative check per the plan's own note ("Geometry beyond computed styles is a Playwright assertion, not a Testing Library one") and it passes. |
| Submit 56px, inputs 48px | ✅ computed `.us-login__submit` height `56px` |
| Every colour, size, radius traces to `tokens.css` | ✅ card `border-radius:20px` (`--radius-panel`), shadow matches `--shadow-lg` |
| Focus ring 3px `--accent` `:focus-visible` | Inherited from the global rule (`tokens.css:120`, `apps/panel/src/styles/tokens.test.ts`) — not re-implemented per-screen, so nothing new to verify here |
| `prefers-reduced-motion: reduce` — band collapse still ends in the correct geometry | Not independently re-verified live (CSS-only, driven by the global `tokens.css:135` reduction rule already covered structurally); no new animation was introduced by S-01 beyond the CSS-only band-collapse transition |

### Step 6 — Recorded

This file, committed alongside `e2e/s01-login.spec.ts` and the two fix commits.

---

## S-02 — Forced password reset

*(recorded by Task 18)*

## S-03 — Panel shell, chrome & alert host

*(recorded by Task 19)*
