# Wave 3 — Channels & Outputs: Gate Evidence

Recorded while executing `docs/plans/screens/wave-3-channels-and-outputs.md`.

---

## GATE S-25 — Advanced shell

**Automated evidence:**
- Testing Library: `pnpm --filter @eduscope/panel test -- src/screens/advanced/advanced-shell src/routes src/auth/require-role` — 31/31 passed. Named tests cover `admin`, `lecturer`, `category selected`, `back to dashboard`, `recording-live restrictions`, U-1, U-2, U-6.
- Playwright: `apps/panel/e2e/s25-advanced.spec.ts` — 5/5 passed (admin primary journey, lecturer nav count, U-6 deep link, live-restriction chrome persistence, geometry).
- Boundary lint: `pnpm lint` and `pnpm test tools/eslint-rules/gate-boundary.test.ts` — green.

**Scenario-overlay demo walk (S-25 rows):**

| Row | Script/action | Observed |
|---|---|---|
| `admin` | `happy`, sign in as admin, Advanced | Title "System Administration", nav label "Categories", 10 nav rows |
| `lecturer` | `happy`, sign in as lecturer, Advanced | Title "Advanced", nav label "Outputs", 2 rows (Local Capture Layout, Streaming Configuration) |
| `category selected` | `happy`, tap any permitted nav item | Tapped item gets `aria-current="page"`; others do not |
| `back to dashboard` | `happy`, Back to Dashboard | Navigates to `/`, S-04 renders |
| `recording-live restrictions` | `happy` → Start → Advanced | Recording frame (`[data-testid="recording-frame"]`) stays visible in Advanced; both lecturer nav rows remain present |
| U-1 | `happy`, cold first entry to Advanced after sign-in | `advanced-shell-skeleton` renders before `getMe`/role resolves (unit-tested in isolation; in the live app `auth.role` is already set so this path is exercised at the component-test level, not observably in the e2e run) |
| U-2 | `ws-flap`, wait past `T-WS-STALE` | Nav rows remain visible while stale (S-25 does not gate its own nav on staleness — S-03's reconnecting marker is the inherited indicator) |
| U-6 | `happy` as lecturer, navigate to `/advanced/network` | Redirects to `/advanced/local-capture` inside the lecturer's own shell; no admin nav row, no 403 text |

**Contract/implementation gap found during execution (recorded only — no contract edit made):**
- `.us-adm { height: 100% }` resolved against `.us-panel`'s own 800px height rather than the space actually left under S-03's 62px header, because `OverlayProvider` renders no wrapping element and `.us-panel` has no flex/grid layout — every route element is sized against the full panel height by default. This overflowed the panel by ~62px (all 10 admin rows), invisible to Testing Library (jsdom does no real layout) and only caught by the Playwright geometry check. Fixed by sizing `.us-adm` with `height: calc(100% - var(--header-h))` — the same pattern `.us-dashboard` (S-04/S-05) already uses. This is a pattern every future full-height route element needs to repeat; worth a shared class if Wave 4 adds another top-level route.

---

## GATE S-26 — Local Capture Layout

**Automated evidence:**
- Testing Library: `pnpm --filter @eduscope/panel test -- src/channels src/screens/advanced/use-local-capture-layout src/screens/advanced/local-capture-screen` — all passed. Named tests cover loading/U-1, populated, pending/U-4, invalid preset, applied, refused/U-5, U-2.
- Playwright: `apps/panel/e2e/s26-local-capture.spec.ts` — 4/4 passed (primary journey incl. in-app-navigation persistence, channel-failures pending→refused→applied, invalid-preset visibility, geometry).
- Boundary lint: `pnpm lint` and `pnpm test tools/eslint-rules/gate-boundary.test.ts` — green.

**Scenario-overlay demo walk (S-26 rows):**

| Row | Script/action | Observed |
|---|---|---|
| `loading` / U-1 | `happy`, cold first entry to `/advanced/local-capture` | `local-capture-skeleton` renders before the four catalog queries resolve |
| `populated` | `happy`, `/advanced/local-capture` | Exactly the five LP-7 local presets render as cards; "Always on" badge shown; no switch/toggle anywhere |
| `pending` / U-4 | **channel-failures**, first valid preset tap | Tapped card shows "Saving…"; no other card does; 1.2 s transport delay observed |
| `invalid preset` | `happy` + World: Students Camera unbound | "Slides + students, side by side" (and any preset requiring Students Camera) renders disabled with "Needs Students Camera, which is not connected." |
| `applied` | `happy`, choose another valid preset | Tapped card gets `aria-pressed="true"`, preview updates; selection persists across an in-app navigation away and back (same live mock world) |
| `refused` / U-5 | `channel-failures`, second valid preset tap | Named 422 "This layout could not be applied." renders in the adjacent live region |
| U-2 | `ws-flap`, wait past stale threshold | Every preset card disabled with "Not connected — you can't change this right now." |

**Implementation gap found during execution (recorded only — no contract edit made):**
- The Task 3 design originally computed "invalid preset" reasons from `GET /sources/bindings` (`listSourceBindings`), which carries `x-required-role: admin` in the contract. Since S-26/S-08 are lecturer-reachable screens, every lecturer catalog read silently 403'd and the screen never left its loading skeleton in the real (non-stubbed) app — invisible to the Testing Library suite because every unit test stubbed `listSourceBindings` directly, bypassing the role gate the mock enforces. Caught only by the Playwright run against the built app. Fixed by switching `useChannelCatalog`'s unbound-role check to `GET /sources/status` (`getSourcesStatus` + the live `sources.status` WS row), which is reachable by both roles and already carries the `unbound` health state INV-SB-3 needs — this also more directly matches "an offline-but-bound role is not unbound," since `unbound` and `offline` are different `SourceHealthState` values on the same read. `apps/panel/src/channels/channel-queries.ts` and every test fixture across S-08/S-26/S-27 were updated to match (`CHANNEL_QUERY_KEYS.sourceStatus` replaces the removed `sourceBindings` key).

---

## GATE S-27 — Streaming Configuration

**Automated evidence:**
- Testing Library: `pnpm --filter @eduscope/panel test -- src/channels src/screens/advanced/use-streaming-channel src/screens/advanced/use-stream-targets src/screens/advanced/stream-target-form src/screens/advanced/stream-target-list src/screens/advanced/streaming-screen` — all passed (loading/U-1, no targets, populated, off/preflight/starting/on/failed/restarting/stopping, preflight failed, idle/live semantics, write-only key, saving/U-4, rejected/U-5, U-2).
- Playwright: `apps/panel/e2e/s27-streaming.spec.ts` — 7/7 passed (admin primary journey, lecturer reachability + no target calls, channel-failures preflight failure + restart, save failure sequence, empty state, secret regression, geometry).
- Boundary lint + contract honesty: `pnpm lint`, `pnpm test tools/eslint-rules/gate-boundary.test.ts`, `pnpm --filter @eduscope/api-client test -- contract-honesty wave3-channel-contract wave3-scenarios` — all green.

**Scenario-overlay demo walk (S-27 rows):**

| Row | Script/action | Observed |
|---|---|---|
| `loading` / U-1 | `happy`, cold first entry to `/advanced/streaming` | Skeleton renders before the catalog + target queries resolve |
| `no targets configured` | `happy` + World: No streaming destinations configured | `stream-targets-empty` explanatory state renders for admin |
| `populated` | `happy` as admin | Seeded "Main YouTube Channel" target shown with Configured chip, Edit/Delete |
| channel `off`/`preflight`/`starting`/`on`/`failed`/`restarting`/`stopping` | `happy` and `channel-failures`, Start → toggle | State word text matches each transition; switch never reads checked for `failed`/transient states |
| `preflight failed` | `channel-failures` → Start → toggle | Named reason "The streaming destination could not be reached. Your lecture is still recording." renders; recording frame stays visible |
| `idle vs live toggle semantics` | `happy`, compare idle vs live | Idle: label "Stream on next recording", writes only `updateChannelConfig`. Live: label "Start streaming now"/"Stop streaming now", writes only enable/disableChannel |
| `stream key write-only` | `happy` as admin, edit seeded target | Configured chip shown; key field always blank; DOM never contains the seeded or replacement key |
| `saving` / U-4 | `channel-failures`, first Save | 1.2 s "Saving…" then a generic (unnamed) transport failure |
| `save rejected` / U-5 | `channel-failures`, second Save | Named 422 "The streaming destination rejected these settings." |
| U-2 | `ws-flap`, wait past stale threshold | Switch disabled |

**Implementation gap found during execution (recorded only — no contract edit made):**
- `useStreamingChannel`'s (and, identically, `useMeetingChannel`'s) live toggle called `requestEnabled(status !== 'on')` — from a `failed` consumer this issues `enableChannel` again, but CH-01/CH-04 are only legal from `off` (state-machines §2.2), so the command silently hits an illegal-transition guard in the mock and the switch never leaves its failure reason. A lecturer/admin recovering from a failed streaming or meeting consumer would find the toggle permanently inert. Every unit test stubbed `enableChannel`/`disableChannel` directly, so none exercised the mock's real legality guard — caught only by the Playwright recovery journey. Fixed both hooks to call `requestEnabled(status === 'off')`: from `off` this enables; from `on` **or** `failed` it disables — `failed` must be acknowledged with CH-10 before a fresh enable can succeed, matching the demo map's "disable, then re-enable" recovery sequence.

---
