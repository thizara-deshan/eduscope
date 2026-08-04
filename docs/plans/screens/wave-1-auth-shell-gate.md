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

**Common preconditions:** same as S-01 above — `pnpm typecheck`/`lint`/`test`/`build` all exit 0 (`28 files, 190 tests`), `pnpm --filter @eduscope/panel preview` serves the build.

### Step 1 — Playwright, `e2e/s02-reset.spec.ts`

| # | Test | Result |
|---|---|---|
| 1 | primary journey — happy: `n.silva`/`temp-pass-1` → forced reset → compliant password twice → lands on `/` | ✅ pass |
| 2 | failure — rejected (current): wrong current password → exact copy, field cleared and refocused, still `/login/reset` | ✅ pass |
| 3 | geometry — submit bottom edge ≤ 404px in both `forced` and `voluntary` | ✅ pass (**required two real fixes, see below**) |
| 4 | no header on `/login/reset` | ✅ pass |
| 5 | no escape from forced: no Cancel/Skip/Dashboard control, and a programmatic client-side nav to `/` bounces straight back | ✅ pass |

`pnpm --filter @eduscope/panel e2e s02-reset` → **5 passed**.

### Step 2 — Testing Library, one test per enumerated state

`pnpm --filter @eduscope/panel test src/screens/reset` → **45 passed** across 5 files.

| State / non-state row | Covered by |
|---|---|
| `forced` | `reset-screen.test.tsx` |
| `voluntary` | `reset-screen.test.tsx` |
| `validating` | `reset-screen.test.tsx`, `policy-checklist.test.tsx` |
| `mismatch` | `reset-screen.test.tsx`, `use-change-password.test.ts` |
| `submitting` | both |
| `rejected (current)` | both |
| `rejected (policy)` | both |
| `success` (forced → `/`, voluntary → `state.from`) | `reset-screen.test.tsx` |
| **policy mirror** (client ⇄ `zChangePasswordRequest`) | `password-policy.test.ts` — 12 assertions |
| **`getMe` re-read** (stale `mustResetPassword` does not navigate) | `use-change-password.test.ts` |

No row missing.

### Step 3 — Boundary lint

`pnpm lint && pnpm test tools/eslint-rules/gate-boundary.test.ts` → exit 0, **3 passed**.

### Step 4 — Scenario demo checklist (live, 1280×800)

| # | State | How reached | Observed |
|---|---|---|---|
| 1 | `forced` | `happy`, sign in as `n.silva` | **Sign out** in the header row (confirmed ≥44px live), reason sentence present, no Cancel |
| 2 | `voluntary` | Sign in as `a.perera`, header ▾ → Change password | Cancel present (unit-tested; the header-menu route to it is covered by e2e test 3 above) |
| 3 | `validating` | Type into New password | Unit-tested (`reset-screen.test.tsx`); checklist rows confirmed rendering ○ for all 5 rules on an empty form live |
| 4 | `mismatch` | Type a different Confirm | Unit-tested |
| 5 | `submitting` | Submit a valid form | Unit-tested (`use-change-password.test.ts`, `reset-screen.test.tsx`) |
| 6 | `rejected (current)` | Wrong current password | Confirmed live via e2e: exact copy, Current password cleared and refocused |
| 7 | `rejected (policy)` | `auth-failures`, submit a compliant password | Unit-tested (`use-change-password.test.ts`); the `auth-failures` script's `changePassword` `nth:1` rule is the same mechanism proven in Task 1's `transport-faults.test.ts` |
| 8 | `success` | Complete the reset as `n.silva` | Confirmed live and via e2e: lands on `/`, does not bounce back |
| 9 | Sign out | Tap Sign out from `forced` | Unit-tested (`reset-screen.test.tsx`); genuinely revokes since `/auth/logout` is exempt (A-4) |

**Defects found and fixed during this gate** (both real, both found via the live/e2e geometry check, not by unit tests — the unit tests render the card in isolation and never previously assembled the full authenticated shell + reset card together):

1. **The reset card was ~66px taller than its budget**, pushing the submit button's bottom edge to ~419px against the ≤404px requirement. Root causes, all in `reset.css`/`reset-card.tsx`:
   - The reason block is a bare `<p>` tag, which carries the browser's default paragraph margin (~14–16px) — nothing in the design's own height budget accounts for a margin, since the budget assumes text alone. Fixed with an explicit `margin: 0`.
   - The header row stacked a button's already-44px `min-height` (from the global touch-target rule) underneath an *additional* `padding-bottom` and a separate `margin-bottom`, double-counting space the design's "44" figure already included. Restructured the card as a flex column with a single `gap` between header and body, and removed the redundant padding/margin.
   - The reason block's padding (`--sp-5`, 12px) and the right column's inter-element gap were trimmed slightly (`--sp-3`/`--sp-4`) to land the total comfortably under budget without dropping below any token floor.
   - Settled measurement after the fix: card height 407px, submit bottom **388.6px** — comfortably inside 404px, close to the design's own stated 395px/407px figures.
2. **The user menu's "Change password" item was unclickable when a seeded alert banner was showing** (`firmware.update-available`, present on `happy` from cold render). `.us-usermenu__popup` has `z-index: 1000`, but that value is scoped to its nearest positioned ancestor's stacking context — `.us-header` (`z-index: 20`) — so the sibling `.us-alertlane` (`z-index: 40`) painted (and captured pointer events) above the entire header, popup included, regardless of the popup's own z-index. Fixed by raising `.us-header`'s own `z-index` to `45` (still below `.us-recnotch`'s `55`, which must stay on top of everything). Found via Playwright's own diagnostic ("`.us-alertbanner__text` intercepts pointer events") while driving the voluntary-mode geometry test through the real header menu.

A third, unrelated flakiness source was found and fixed in the *test* itself, not the app: `.us-reset`'s height is CSS-transitioned (200ms) off the `--osk-h` custom property. The property flips the instant `KeyboardHost`'s effect runs, but the animated layout settles a beat later — measuring `boundingBox()` immediately after the property changes can catch a mid-transition frame. Both `s01-login.spec.ts` and `s02-reset.spec.ts`'s geometry tests now wait 300ms after confirming `--osk-h` before measuring.

### Step 5 — Visual review against the tokens, 1280×800

There is no prototype for this screen (route B) — reviewed against S-02 §2/§7 directly.

| Check | Result |
|---|---|
| Card 680px, and that width is `--modal-w` | ✅ computed `width: 680px` (token, not a new constant) |
| Two columns, 380/236, gap `--sp-9`, top-aligned | ✅ structurally verified (`reset-card.test.tsx`); submit sits at the bottom of the right column under the checklist |
| `voluntary` omits the reason block, card shortens | ✅ (`reset-card.test.tsx`) |
| Rule rows carry a ✓/○ glyph, not colour alone | ✅ confirmed live — all 5 rows render `○` glyphs before any input |
| Reveal button on New password only, ≥44px | ✅ confirmed live — exactly one `.us-field__reveal` in the DOM |
| Sign out ≥44px | ✅ confirmed live — computed `min-height: 44px` |
| Inputs 48px, submit 56px; no page scroll | ✅ (unit + e2e) |
| Every value traces to `tokens.css` | ✅ — `--modal-w`, `--sp-*`, `--radius-*`, `--fs-*` throughout; no new value introduced |

### Step 6 — Recorded

This section, committed alongside `e2e/s02-reset.spec.ts` and the fix commit (reset-card layout + header z-index).

## S-03 — Panel shell, chrome & alert host

**Common preconditions:** `pnpm typecheck`/`lint`/`test`/`build` all exit 0 (`28 files, 192 tests`), `pnpm --filter @eduscope/panel preview` serves the build.

### Step 1 — Playwright, `e2e/s03-shell.spec.ts`

| # | Test | Result |
|---|---|---|
| 1 | primary journey — happy: header (hall, clock, user), Start → Pause → Resume → Stop → Saved → idle chrome | ✅ pass (**required a real fix, see below**) |
| 2 | failure — start-fails: chrome reaches `error`, red frame never appears (MutationObserver) | ✅ pass (**required a real fix, see below**) |
| 3 | ws-flap: after `T-WS-STALE` the reconnecting marker appears and the frame is retained | ✅ pass |
| 4 | disk-full: a `storage.critical` banner renders (verbatim from the payload) | ✅ pass (**required a real fix, see below**) |
| 5 | layout invariance: `<Outlet/>`'s box is byte-identical with and without a banner | ✅ pass |
| 6 | no header at `/login`/`/login/reset`; header present at `/` | ✅ pass |

`pnpm --filter @eduscope/panel e2e s03-shell` → **6 passed** (35.4s — the ws-flap test alone needs ~33s since the script's first drop is scripted at 15s and `T-WS-STALE` is another 10s).

### Step 2 — Testing Library, one test per enumerated state

`pnpm --filter @eduscope/panel test src/shell src/routes src/devtools` → **60 passed** across 9 files, covering: idle/recording/paused/saving(stopping+finalizing)/saved/error chrome, panel-offline (frame retained), the banner host (per-severity, cold render, acknowledge, cleared, duplicate-merge), still-streaming-while-paused, the two-row user menu, and no-header on the two auth routes.

### Step 3 — Boundary lint and the Wave-0 gates

```
pnpm lint && pnpm test tools/eslint-rules/gate-boundary.test.ts && pnpm gate
```
Result: exit 0; boundary gate **3 passed**; `pnpm gate` → **5 passed** (panel 1a/1b/1e + quiz 1c/1d) — confirms Task 12's probe move stayed harmless.

### Step 4 — Scenario demo checklist (live, 1280×800)

| # | State | How reached | Observed |
|---|---|---|---|
| 1 | `idle chrome` | `happy`, signed in | Header only, no frame, no notch |
| 2 | `recording chrome` | Overlay → Start | 4px `--record` frame + `RECORDING` notch (confirmed live and via e2e) |
| 3 | `paused chrome` | → Pause | Amber frame + `PAUSED`, dot animation stopped (e2e) |
| 4 | `saving chrome` | → Stop | Neutral frame + `SAVING…`, sub-caption differs stopping (0.9s) vs finalizing (1.4s) (e2e) |
| 5 | `saved` | let it finish | Transient `Saved`, then idle chrome (e2e) |
| 6 | `error` | `start-fails` → Start | Error card with a plain-language cause; red frame never appeared (e2e, MutationObserver) |
| 7 | `panel offline` (U-2) | `ws-flap`, wait past 10s stale | Reconnecting marker; frame retained (e2e) |
| 8 | Banner · info | `happy` on load | Seeded `firmware.update-available`, `--info` treatment (confirmed live) |
| 9 | Banner · warning + error | `disk-full`, → Start | `storage.critical` banner renders; recording never proceeds (e2e) — **see the text-content caveat below** |
| 10 | Banner · machine-raised error | `pipeline-crash-midway`, → Start | Not separately demonstrated this pass — same banner mechanism as row 9, already proven end to end |
| 11 | Acknowledge | Tap a banner's acknowledge | Banner hides immediately (**required a real fix, see below**); may legitimately re-raise after `T-ALERT-REEVALUATE` (30s, INV-SA-1) |
| 12 | Still streaming while paused | Overlay → Meeting on → Start → Pause | Unit-tested (`streaming-while-paused.test.tsx`); not separately re-driven live this pass |
| 13 | User menu | Header ▾ | Two ≥56px rows: Change password → S-02 voluntary; Sign out → `/login` (confirmed live and via e2e in the wave-exit run) |
| 14 | No header | `/login`, `/login/reset` | Confirmed (e2e) |

**Defects found and fixed during this gate** (all real, all found live — none caught by the pre-existing unit-test suite, which tests each component in isolation and never assembled the full authenticated shell + overlay + banners + chrome together):

1. **`RecordingChrome` rendered the same red "RECORDING" frame during `starting` as during confirmed `recording`.** Screen-inventory §2 S-03 has no enumerated chrome for `starting` at all (it goes straight from idle to recording chrome), and B-12 requires a failed start never read as recording. Since `start-fails` substitutes R-06 for the *would-be* R-05 confirmation, the session sits in `starting` for ~1.2s before failing — during which the frame was incorrectly already showing red. Fixed by treating `starting` the same as `idle` (no frame at all) until `recording` is confirmed. Guarded with a new unit test.
2. **The scenario overlay's `choose()` handler reset the WS store *after* switching scenarios**, not before. The new scenario's bootstrap (e.g. `disk-full`'s seeded critical storage pressure) raises its alerts *synchronously* inside `switchScenario()` itself, and the panel's event subscription ingests them just as synchronously — resetting afterward wiped out exactly the alerts the new scenario had just raised. `disk-full`'s `storage.critical` banner never reached the UI as a result. Fixed by reordering: reset the store, *then* switch.
3. **Acknowledging a banner did nothing.** The mock's `acknowledgeAlert` only stamps `acknowledgedBy`, never `clearedAt` (contract-honest — INV-SA-1 documents that a still-true condition should re-raise, not be permanently suppressed server-side), and `listAlerts()` has `staleTime: Infinity` with nothing invalidating it, so a re-fetch would have returned the same never-cleared row anyway. Dismissal has to be local UI state. Fixed `AlertBanners` to track dismissed ids client-side ("hide for now", exactly what the contract's own wording for acknowledge says) rather than waiting on a server round-trip that was never going to change anything. Guarded with a new unit test.

**Known gap, flagged rather than papered over:** the `storage.critical`/`storage.warning` alerts raised by the mock's storage-pressure machine (`mock/machines/health.ts`, `mock/machines/recording.ts`) go through a generic fallback (`world.ts`'s `buildAlert()`) that sets `title: code` literally — i.e. the banner in row 9 above reads `"storage.critical"`, not a plain-language sentence naming the real retention-policy percentage. This is a **pre-existing Wave-0 mock gap**, not touched by any Wave-1 task's file list (only the seeded, static alerts — `firmware.update-available`, `source.degraded` — carry real copy). The **frontend's own behavior is correct and is what Task 15 tests**: `AlertBanners` renders `title`/`detail` verbatim with no hardcoding, proven with a fixture that does carry a policy percentage. Satisfying INV-RP-1 in the mock itself (a dedicated alert-text builder for the two storage codes, referencing the real `RetentionPolicy`) is out of this wave's scope and is flagged for whoever owns `packages/api-client`'s mock machines.

### Step 5 — Visual review against the prototype and tokens, 1280×800

| Check | Result |
|---|---|
| Header 62px, dark `--ink`, brand left, clock centred, user right | ✅ computed `height: 62px`, `background: rgb(16,19,25)` (`--ink`) |
| Logout replaced by the `▾` menu | ✅ `aria-haspopup="menu"` confirmed live and via e2e |
| Clock ≥19px with tabular numerals | ✅ computed `font-size: 19px` |
| Frame `--radius-panel` (20px), `position: absolute`, never `fixed` | ✅ (`recording-chrome.test.tsx`) |
| Notch reads identically in all three captions | ✅ one component, `RECORDING`/`PAUSED`/`SAVING…` via a shared class |
| Banner lane fixed 56px, overlays rather than pushes | ✅ computed `height: 56px`, `position: absolute`; layout-invariance e2e test confirms the Outlet never moves |
| Every dismiss/acknowledge target ≥44px with an `aria-label` | ✅ (`alert-banners.test.tsx`) |
| Reduced motion — recording state still unambiguous with the pulse frozen | Inherited from the global `tokens.css:135` rule; the notch's caption text (not the dot) is what carries the state, so nothing is lost |
| Every value traces to `tokens.css`; `us-*` semantic classes, no Tailwind | ✅ throughout `shell.css` |

### Step 6 — Wave exit condition

screen-inventory §11 Wave 1: *"A user can log in, be forced to reset, and see live chrome."* Demonstrated as one unbroken Playwright run: `/login` → sign in as `n.silva` → forced reset → `/` → Start → recording chrome → Stop → `Saved` → header ▾ → Sign out → `/login`. **Passed in a single run, no manual steps skipped.**

### Step 7 — Recorded

This section, committed alongside `e2e/s03-shell.spec.ts` and the fix commit (recording-chrome starting-state, scenario-overlay reset ordering, alert-banners local dismiss).
