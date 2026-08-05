# Wave 2 — Recording Core (S-04, S-05, S-06, S-07, S-09, S-10, S-11, S-12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the panel's eight Wave-2 screens — S-04 Dashboard idle, S-05 Dashboard session (its approved `ai disabled` layout in full), S-06 Recorder lock & takeover, S-07 Session transport card, S-09 Sources & audio bar, S-10 Source preview lightbox (mock transport), S-11 Room Controls bar, S-12 Power-off confirm — plus the two product-wide vocabularies this cluster settles (`danger/` and `NotConnectedRegion`), so that J-1's happy path **and** its failure path demo end to end on the mock with every enumerated state reachable from the scenario dev overlay.

**Architecture:** `/` stops being a `ScreenPlaceholder` and becomes `screens/dashboard/dashboard-screen.tsx`, which chooses exactly one main region — **idle** (S-04), **session** (S-05) or **locked** (S-06) — from one pure verdict function (`use-recorder-lock.ts`) and always mounts the two bottom bars (S-09, S-11) beneath it. Everything crosses the `EduscopeClient` boundary through TanStack Query (request/response) and the zustand WS store (push); three new WS slices (`audioControls`, `lastSegment`, `expectedShutdown`) and their atomic selectors are the only store growth. Two scenario-engine primitives land — a per-switch `WorldSeed` override and a script `timeline` — so that source health, storage pressure, the AI flag and the locked view become reachable from the dev overlay without forking the catalog.

**Tech Stack:** React 18.3 · TypeScript strict · react-router 7 · TanStack Query 5 · zustand 5 · CSS custom-property tokens (`us-*` semantic classes, no Tailwind utilities) · Vitest + Testing Library (happy-dom) · Playwright.

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the cited source; where a source says a doc "wins", it wins.

**Binding documents.** [`docs/design/frontend-conventions.md`](../../design/frontend-conventions.md) is binding for every task: *"If a plan, chat, or piece of generated code contradicts this doc, this doc wins."* The four approved screen designs are binding in the same way and **win over the prototype wherever they disagree**:

| Doc | Owns |
|---|---|
| [`S-06-design.md`](../../design/screens/S-06-design.md) | The lock/takeover screen **and §3, the product-wide destructive-action vocabulary** (DGR-D-1…DGR-D-4) that S-12 inherits unchanged |
| [`S-12-design.md`](../../design/screens/S-12-design.md) | The power-off entry row, confirm and terminal state |
| [`S-05-ai-disabled-design.md`](../../design/screens/S-05-ai-disabled-design.md) | The Capture Assurance card, the verdict fold, and the sidebar in the flag-off layout |
| [`S-11-placeholders-design.md`](../../design/screens/S-11-placeholders-design.md) | The Room Controls bar **and §3, the product-wide `[D-10]` pattern** (RC-D-1…RC-D-4) |

Behavioural sources: [`screen-inventory.md`](../../design/screen-inventory.md) §0.3, §0.4, §2 (S-04…S-12), §8; [`state-machines.md`](../../design/state-machines.md) §1 (machine 1a, R-01…R-22, BR-1…BR-9), §2.2 (machine 1c, CH-01…CH-10), §5.5 (the WS link), §6 (machine 5a/5b/5c, HL-01…HL-23), §8 (the prototype→machine hand-check).

**Contract state.** `contracts/openapi.yaml` is at **v0.3.0** and `contracts/events.md` at **v0.3.0** (landed with the Wave-2 gate amendment, `ad2300c`). In force for this plan, from [`contract-amendments.md`](../../design/contract-amendments.md) §0.2.0→0.3.0:

- **A-5 / CG-14** — `RecordingStateSnapshot` **and** `RecordingStatePayload` carry `takeoverAt: Instant | null` and `takeoverByDisplayName: string | null`. Both are already produced by the mock (`mock/machines/recording.ts:151-152`, set in `mock/rest/recording.ts:63-65`).
- **A-6 / CG-15** — `updateAudioControl` is guarded with `G-AUTH-OWNER` while a session is non-terminal and declares `403 not-authorized`. Already enforced in `mock/rest/sources.ts:97-107`. **S06-D-5's fallback does not apply**: the guard landed, so S-06/S-09/S-11 disable the audio controls for a non-owner *with the reason inline*, never fake-disabled.
- **A-7 / CG-16** — `powerOffDevice` has **no resolving event**; the transport closing is the resolution and `resolveBySec` is the *not-halted* threshold (S12-D-2).
- **A-8 / CG-17** — `events.md` §2.10's `system.alert` emitter list includes R-22.
- **CG-6 closed as a confirm** — there is no `POST /device/restart` and none is to be invented (S12-D-1).
- **CG-18 closed as a recorded omission** — the disk block shows **bytes and the generated policy sentence**, never an hours estimate (S05-D-6).

**No contract change is permitted during this plan** (screen-inventory §10.1: *"never during a plan, and never speculatively"*). If a task discovers a genuine gap, it is recorded in the gate file as a candidate CG row and the screen renders the honest degraded form — see **W2-D-8**.

**The client boundary (frontend-conventions §1).** *"No component may import `fetch`, `axios`, or `WebSocket` directly. The ONLY network boundary is the `EduscopeClient` interface in `packages/api-client`."* The panel reaches it exactly one way: `useClient()` from `apps/panel/src/client/client-provider.tsx`. Data flows via TanStack Query + the zustand WS store only. WS state is read **only** through `apps/panel/src/store/selectors.ts` — one atomic selector per field, or `useWsShallow` for a multi-field read. Never `useWsStore(s => ({ … }))`.

**Telemetry never enters React state (frontend-conventions §1).** `audio.levels` arrives at 10 Hz and is short-circuited into `store/telemetry-store.ts` before any `set()` on the WS store (`ws-store.ts:62-67`). The S-09 level meter subscribes to it **imperatively** and writes a CSS custom property:

```ts
useEffect(() => useTelemetryStore.subscribe(
  (s) => s.audioLevels['mic-lecturer'],
  (rms) => el.current?.style.setProperty('--level', String(rms ?? 0)),
), []);
```

Zero React renders. Gate 1e (`e2e/gate-boot.spec.ts`) already asserts this globally and must stay green.

**Prototype usage (frontend-conventions §2).** `/prototype` is a behavioral and visual spec, not a code source. **MAY port:** layout, hierarchy, spacing, interaction behavior, the `us-*` semantic-class approach, the token custom properties. **MAY NOT port:** any context/mock logic. Named prototype-only code this wave must not reproduce:

| Prototype code | Why it must not be ported | Bind to instead |
|---|---|---|
| `SourcesPanel.tsx:15-43` `useMicLevels` random walk | frontend-conventions §2 names it explicitly; screen-inventory S-09 repeats it | `audio.levels` via `telemetry-store` |
| `RoomControlsPanel.tsx:41-46` — five `useState` seeds and every `'On'`/`'Off'`/`'Lowered'`/`'Raised'`/`{n}%`/`{n}°C` readout | **S-11 §1 C-1** — a state claim about hardware nothing is talking to. G-5. There is no successor | Nothing. `NotConnectedRegion` holds no state at all |
| `TimerCard.tsx:9` `elapsedSec` from a context tick | INV-G-7 — no per-second events | `startedAt` + `recordedDurationMs`, ticked locally by `hooks/use-ticker.ts` |
| `RecordingContext`'s `mics` array | There is **one** mic (`mic-lecturer`, LP-9) and its truth is `AudioControl.appliedState` | `listAudioControls` + `audio.control` |

**Design tokens (frontend-conventions §6, screen-inventory §8).** Every value comes from `apps/panel/src/styles/tokens.css`, which already carries the whole §8 sheet. **No new colour, size, spacing or radius value may be introduced by this plan** — all four design docs state "no new token" explicitly (S-06 §7, S-12 §7, S-05 §7, S-11 §7). The scrim is `color-mix(in srgb, var(--ink) 55%, transparent)`, not a new token.

**Kiosk & touch (frontend-conventions §3, screen-inventory §0.4).** Fixed **1280×800**; the page never scrolls, regions scroll internally. Touch targets ≥ **44 px** (`--tap-min`), rows **56 px** (`--tap-row`), 8 px minimum separation between adjacent destructive and non-destructive targets — **24 px (`--sp-10`, "danger separation") wherever a destructive control is involved** (S-06 §8, S-12 §8). **No hover-only affordance anywhere; tooltips are banned as the sole carrier of information.** `aria-label` on every icon-only control. Overlays are `position: absolute` inside `.us-panel`, **never** `position: fixed` — `OverlayHost` already enforces the mount point.

**The vertical budget (S-05 §1 C-2 — a number three screens depend on).**

| Bars | Room bar | Sources bar | Bars total | Main column |
|---|---|---|---|---|
| both collapsed | 54 | 54 | 108 | **602 px** |
| sources open | 54 | 154 | 208 | 502 px |
| room open | **168** | 54 | 222 | 488 px |
| both open | 168 | 154 | 322 | **388 px — the design floor** |

`800 − 62 (--header-h) − 28 (--sp-6 × 2) − bars`. The two bars stay **independent** (S05-D-8); no mutual-exclusion rule is invented. S-11's expanded bar is **168 px, not the prototype's 226** (S11-D-9) and S-05's floor is derived from it, so the 168 px envelope is asserted, not commented (S-11 §13).

**States & scenarios (frontend-conventions §4).** Every enumerated state must be implemented **and reachable via the scenario dev overlay**. The catalog is **extended, never forked**. It stands at eight — `happy`, `start-fails`, `pipeline-crash-midway`, `llm-timeout`, `disk-full`, `ws-flap`, `quiz-network-loss`, `auth-failures` — and this plan adds exactly **one** (**W2-D-3**), reaching nine. Everything else is reached by extending existing scripts, by the new per-switch `WorldSeed` override (**W2-D-1**) or by the new script `timeline` (**W2-D-2**).

**Testing floor (frontend-conventions §5).** Per screen: a Testing Library rendering test for **each enumerated state**; Playwright for the primary journey + at least one failure scenario; every mock response validates against the `contracts/` zod schemas via `mock/seed/index.ts`'s `validated()`. Four screens raise the floor above that and those raises are binding: S-06 §13 (the exhaustive authority table, the copy-identity assertion, the no-attribution-rewrite test, **two** Playwright failure scenarios), S-12 §13 (the copy-identity assertion, the expected-drop suppression test, the not-halted fake-timer test, the no-optimistic-close test), S-05 §13 (the exhaustive fold table, the `unknown`-outranks-`online` test, the R-SRC-1 sentence test, the generated-policy test, the 388 px floor, one-truth-two-renderings), S-11 §13 (the three anti-placebo assertions, apply-failed shows applied truth, one-control-one-truth, the 168 px envelope).

**Lint rules already in force (`eslint.config.js`).** `react-hooks/exhaustive-deps: error`. `jsx-a11y/no-autofocus: error` — `autoFocus` as a JSX attribute is forbidden; focus is set via a ref + `.focus()` in an effect (this matters for `DangerConfirm`, which must open focus on Cancel). `jsx-a11y/label-has-associated-control`, `control-has-associated-label`, `aria-props`, `aria-role`, `role-has-required-aria-props` all error. The boundary rules apply to every file in `boundaryFiles`.

**Timers.** No value is invented. From `packages/shared/src/constants/timers.ts` and `mock/commands.ts`:

| Constant | Value | Used by |
|---|---|---|
| `TIMERS['T-CMD-RESOLVE']` / `RESOLVE_BY_SEC` | 10 000 ms / 10 s | U-4's ceiling on every 202 in this wave; S-12 state 8's *not-halted* threshold |
| `TIMERS['T-WS-STALE']` | 10 000 ms | U-2 — applied by `store/connection.ts`'s `isStale` |
| `TIMERS['T-START-CONFIRM']` | 5 000 ms | S-04 `starting`'s ceiling |
| `TIMERS['T-BOOT-RECOVERY']` | 20 000 ms | S-04 `recovery pending`'s ceiling (**W2-D-8**) |

**Copy is fixed.** Every user-visible string comes from the copy deck of the owning design doc — [S-06 §6](../../design/screens/S-06-design.md#6-copy-deck), [S-12 §6](../../design/screens/S-12-design.md#6-copy-deck), [S-05 §6](../../design/screens/S-05-ai-disabled-design.md#6-copy-deck), [S-11 §6](../../design/screens/S-11-placeholders-design.md#6-copy-deck) — and is reproduced verbatim in the task that renders it. No plain-language string is improvised. Three strings are **shared constants**, not duplicated literals, and a test asserts each cannot drift:

| Constant | Value | Consumers | Asserted by |
|---|---|---|---|
| `TAKEOVER_REVOKED_SENTENCE` | `An administrator took over this recording.` | S-06 displaced notice, S-01's `reason: takeover` copy | S-06 §13 copy identity |
| `POWEROFF_BLOCKED_REASON` | `This device is recording — stop the lecture first.` | S-12 §2.1 entry row, S-12 §2.3 message slot, and the mock's own 409 title (`mock/rest/device.ts:11`) | S-12 §13 copy identity |
| `STILL_RECORDING_SENTENCE` | `Your lecture is still recording.` | Every tier-4 Capture Assurance verdict | S-05 §13 R-SRC-1 |

**Commit discipline.** One commit per task, at the end of the task, with the message given in that task's final step.

---

## Decisions this plan takes

Implementation decisions the design docs leave open, recorded so a reviewer can reject them individually rather than discovering them in a diff.

| Id | Decision | Why | Cost to reverse |
|---|---|---|---|
| **W2-D-1** | `WorldSeed` overrides become a **per-switch parameter**: `createMockClient(name, { seed })` and `MockClient.switchScenario(name, seed?)`, merged over the script's own `seed`. The dev overlay grows a **World strip** exposing every `WorldSeed` field. | [`contract-amendments.md`](../../design/contract-amendments.md) §"Flagged, not decided here" leaves this to S-06's plan run as one of two options and calls the flag "not yet reachable from the dev overlay by name". Option 1 (a ninth `locked-view` script) buys one boolean; option 2 buys **four** — the locked view (S-06), the flag-off layout (S-05, which INT-10 makes the go-live default), the apply-failed mic (S-11) and storage pressure — with no script whose *narrative* is a seed value. It also keeps `happy` the pristine spec path, which its own docblock demands. | Low — one optional parameter, one overlay strip |
| **W2-D-2** | `ScenarioScript` gains `timeline?: readonly { transition: TransitionId; afterMs: number }[]`, scheduled by `build()` through the existing `world.schedule`. | Machine 5a/5b faults have **no** producer today: `forced` can only intercept a transition something else already requested, and nothing requests `HL-04`/`HL-06`/`HL-08`. Both design docs name the exact scripts that must produce them — S-05 §10 (*"Extend `ws-flap` to stop emitting `sources.status` without closing the socket"*) and S-11 §10 (*"extend `pipeline-crash-midway` to include the audio role"*) — and neither is expressible without this. It also generalises what `bootstrapFromSeed` already does ad hoc with `world.apply('HL-10')`. | Low — one optional field, six lines in `build()` |
| **W2-D-3** | **One** new script: `poweroff-not-halted` (the ninth). It carries two rules that fire in sequence, so one run demonstrates S-12 states **9 → 8 → 7** and the Try-again recovery. | S-12 §5 states 8 and 9 are the only Wave-2 states neither a seed knob nor a timeline can reach — they need forced *command* behaviour, and no existing script's name or description covers "the device accepts a shutdown and never halts". That is the "genuinely new class of state" exception the catalog rule allows and that `contract-amendments.md` cites. `happy` may not carry it: its docblock forbids rules, and a `stall` on `happy` would make S-12's own primary journey unreachable. | Low — one file, one registry line |
| **W2-D-4** | `WorldSeed` gains **`audioApplyFails: boolean`** (default `false`). | S-11 §10 asks for `appliedState: failed` *"under a scenario flag"* and calls it *"the one state that proves B-55 is closed"*. `WorldSeed` is the existing home for world knobs (`recordingOwnedByOtherUser` already lives there and is a live-world concept, not a fixture shape — `seed/index.ts:58-67`). With W2-D-1 it needs no script at all. | Low — one boolean |
| **W2-D-5** | `start-fails` gains the **Class-A** `config.invalid` refusal at `nth: 1`; its existing R-05→R-06 force stays and becomes attempt 2. | S-04 enumerates both refusal classes (§0.4) and only Class B has a producer. Putting both on one script means one script demonstrates the whole distinction, and `nth: 1` makes the demo recover on the second tap — the pattern `auth-failures` already establishes for `changePassword` (*"the second attempt succeeds, so the demo recovers instead of dead-ending"*). | Low — one rule, one description line |
| **W2-D-6** | Alert suppression is a **dedicated three-line store**, `apps/panel/src/shell/alert-suppression.ts`, not a field on the WS store. | S-12 §12 requires S-03 to suppress its `poweroff.refused` banner *while the overlay is open* (S12-D-3), and `AlertBanners` cannot inspect an opaque `ReactNode` in the overlay stack. The WS store is contract-typed slices only (`ws-store.ts:18`); a UI-suppression list there would be the first non-contract field and would be reset by `reset()` at the wrong moments. A mount/unmount effect on the dialog is the exact lifetime required. | Low — one file |
| **W2-D-7** | The expected-shutdown flag is `expectedShutdown: boolean` on the **WS store**; `store/connection.ts` owns the **rule** — `isStale(status, expectedShutdown)` returns `false` while it is set. | S-12 §12 says *"`offline-marker.tsx` renders nothing while it is set, and `connection.ts` owns and resets it"*. `connection.ts` is documented as *"rules, not state: `ws-store.ts` owns the slices, this file owns what the slices mean"* (`connection.ts:6-9`), so the flag goes in the store and the meaning in `connection.ts`. `reset()` clears it, and the overlay already calls `reset()` before every scenario switch — which is exactly S-12 §10's *"must not leak between scenario runs"*. | Low |
| **W2-D-8** | S-04's **`recovery pending`** renders as the U-1 held-Start with its own copy (*"Checking the previous session"*), bounded by `T-BOOT-RECOVERY`. It gets **no scenario producer**, and that is recorded in the gate as a candidate CG row rather than papered over. | BR-1…BR-9 run server-side and `RecordingStateSnapshot` carries **no** `recovering` value — from the panel's seat the boot-recovery wait is literally indistinguishable from `getRecordingState` not having resolved. Inventing a field would be a contract change during a plan (§10.1). Demonstrated by DevTools request throttling and covered by a Testing Library test against a pending query. | Low — the rendering is already the U-1 one |
| **W2-D-9** | Wave 2 ships S-05's **`ai disabled` layout in full** and, for the flag-on branch, an explicitly-marked `data-screen="S-13"` slot. `.us-insightswrap` is mounted in **neither** branch this wave. | S-13/S-16/S-17 are Wave 4 and S-08 is Wave 3 (screen-inventory §11), so the flag-on main column has nothing to render yet. INT-10 makes flag-off the go-live default, so the layout that ships complete is the one most rooms will run. S05-D-2 already rules `.us-insightswrap` absent in the flag-off layout; leaving it absent in the flag-on slot too is a Wave-4 concern, flagged in Appendix B. | Low — one element swap in Wave 4 |
| **W2-D-10** | `use-audio-control.ts` lives in a shared **`apps/panel/src/audio/`** folder, alongside `auth/`, `keyboard/` and `danger/`. | S-11 §12 and S-05 §12 both require S-09 and S-11 to bind the *same* `AudioControl.muted` through the *same* selector, with a test asserting they cannot disagree. A hook owned by one screen and imported by the other invites a second copy; a shared folder is the shape the codebase already uses for exactly this ("the same pattern `auth/` … and `keyboard/` … already establish", S-06 §3.2). | Low |
| **W2-D-11** | Three mock **honesty fixes** land as ordinary mock work, not scenario work: (a) `startRecording` answers `409 recorder.busy` while a session is non-terminal (R-03); (b) `takeoverRecording` answers `409 conflict` once machine 1a is terminal (R-21 is `from: '*'` = non-terminal only); (c) the preview channel emits `error{source-offline}` and ends the negotiation when its role leaves `online` (S-10's *"source went offline mid-preview"*). | Each is a place where the mock currently contradicts a machine rather than a place a screen needs a scenario. (a) and (b) today schedule a transition that `world.apply` will throw on — an unhandled throw inside a `setTimeout`, not a refusal. (c) is enumerated by S-10 and has no code path at all. | Low — three guards |

**Known Wave-2 limitations, flagged not papered over.** Recorded in the gate file rather than hidden:

- **S-10 `busy` and `internal`** have no live producer. `busy` requires two concurrent negotiations on one panel connection and the lightbox is a single overlay; `internal` is a server fault the mock has no way to stage honestly. Both are covered by Testing Library tests against the same code path and inherit producers in Wave 8 with the real transport.
- **S-10 `source-unbound`** has no live producer: the only permanently unbound role is `mic-room` (INV-SR-2) and S-09 does not render unbound roles as tiles (HL-01), so no tap can reach it. Unit-tested.
- **S-07 `not owner`** has no live producer on `/`: S06-D-1 replaced the greyed-transport layout with the lock card, so a non-owner never sees S-07. Implemented and unit-tested so S-07 stays safe wherever it is mounted next.
- **S-04 `recovery pending`** — see **W2-D-8**.
- **S-05's sidebar** holds S-07 alone this wave; S-08's `flex: 1 1 auto` and `defaultExpanded` (S-05 §12) are Wave-3 work.

---

## File Structure

```
packages/api-client/src/
  index.ts                                      MODIFY  export WorldSeed
  mock/scenario/types.ts                        MODIFY  + WorldSeed.audioApplyFails, + ScenarioScript.timeline
  mock/scenario/registry.ts                     MODIFY  + poweroffNotHalted
  mock/scenario/scripts/poweroff-not-halted.ts  NEW     W2-D-3, the ninth script
  mock/scenario/scripts/start-fails.ts          MODIFY  + the Class-A config.invalid refusal (W2-D-5)
  mock/scenario/scripts/pipeline-crash-midway.ts MODIFY + the source-fault timeline (W2-D-2)
  mock/scenario/scripts/ws-flap.ts              MODIFY  + the HL-08 stale-telemetry timeline (W2-D-2)
  mock/create-mock-client.ts                    MODIFY  seed override, timeline scheduling, audio.control snapshot
  mock/seed/index.ts                            MODIFY  thread audioApplyFails through createSeed
  mock/seed/sources.ts                          MODIFY  seed appliedState from the knob
  mock/rest/recording.ts                        MODIFY  R-03 / R-21 guards (W2-D-11 a, b)
  mock/rest/sources.ts                          MODIFY  emit audio.control; honour audioApplyFails
  mock/events/preview.ts                        MODIFY  drop a live preview when its role leaves online (W2-D-11 c)
packages/api-client/test/mock/
  wave2-scenarios.test.ts                       NEW
  wave2-mock-gaps.test.ts                       NEW

apps/panel/src/
  store/ws-store.ts                             MODIFY  + audioControls, lastSegment, expectedShutdown
  store/connection.ts                           MODIFY  isStale(status, expectedShutdown)
  store/selectors.ts                            MODIFY  + useAudioControlRow, useLastSegment, useExpectedShutdown
  shell/alert-suppression.ts                    NEW     W2-D-6
  shell/alert-banners.tsx                       MODIFY  honour suppression
  audio/use-audio-control.ts                    NEW     W2-D-10 — the ONE mutation, two bars
  danger/danger-button.tsx                      NEW     S-06 §3 — SHARED with S-12, S-24, S-30
  danger/danger-confirm.tsx                     NEW     S-06 §3
  danger/danger.css                             NEW
  screens/dashboard/dashboard-screen.tsx        NEW     the `/` host: idle | session | locked + both bars
  screens/dashboard/idle-hero.tsx               NEW     S-04
  screens/dashboard/use-start-recording.ts      NEW     S-04
  screens/dashboard/start-refusal.tsx           NEW     S-04 named reasons + the admin jump
  screens/dashboard/use-recorder-lock.ts        NEW     S-06 — the authority verdict, pure
  screens/dashboard/lock-card.tsx               NEW     S-06
  screens/dashboard/takeover-confirm.tsx        NEW     S-06
  screens/dashboard/takeover-notice.tsx         NEW     S-06
  screens/dashboard/dashboard.css               NEW
  screens/transport/timer-card.tsx              NEW     S-07
  screens/transport/use-transport.ts            NEW     S-07
  screens/transport/transport.css               NEW
  screens/session/session-layout.tsx            NEW     S-05 composition + the layout choice
  screens/session/use-ai-enabled.ts             NEW     S-05 — G-AI-ENABLED, the ONE place
  screens/session/use-capture-assurance.ts      NEW     S-05 §2.3 — the worst-case fold, pure
  screens/session/capture-assurance-card.tsx    NEW     S-05
  screens/session/capture-verdict.tsx           NEW     S-05
  screens/session/capture-sources-row.tsx       NEW     S-05
  screens/session/capture-outputs-row.tsx       NEW     S-05
  screens/session/capture-disk-row.tsx          NEW     S-05
  screens/session/session.css                   NEW
  screens/sources/sources-bar.tsx               NEW     S-09
  screens/sources/source-tile.tsx               NEW     S-09
  screens/sources/mic-row.tsx                   NEW     S-09
  screens/sources/level-meter.tsx               NEW     S-09 — imperative telemetry
  screens/sources/preview-lightbox.tsx          NEW     S-10
  screens/sources/use-preview.ts                NEW     S-10
  screens/sources/sources.css                   NEW
  screens/room/room-controls-bar.tsx            NEW     S-11
  screens/room/mic-master-row.tsx               NEW     S-11
  screens/room/not-connected-region.tsx         NEW     S-11 §3 — PRODUCT-WIDE
  screens/room/not-connected-row.tsx            NEW     S-11
  screens/room/power-off-row.tsx                NEW     S-12 (S12-D-7: owned by S-12, mounted by S-11)
  screens/room/power-off-confirm.tsx            NEW     S-12
  screens/room/use-power-off.ts                 NEW     S-12
  screens/room/room.css                         NEW
  routes/router.tsx                             MODIFY  '/' -> DashboardScreen
  devtools/scenario-overlay.tsx                 MODIFY  + the World strip
  devtools/scenario-overlay.css                 MODIFY  + .us-devoverlay__world

apps/panel/src/**/*.test.{ts,tsx}               NEW     one per unit; enumerated in each task
apps/panel/e2e/
  s04-idle.spec.ts  s05-session.spec.ts  s06-lock.spec.ts  s07-transport.spec.ts
  s09-sources.spec.ts  s10-preview.spec.ts  s11-room.spec.ts  s12-poweroff.spec.ts   NEW
docs/plans/screens/
  wave-2-recording-core-gate.md                 NEW     the gate record (written by Tasks 19-26)
```

---

## Task 1: Scenario engine — per-switch world seeds and script timelines

The two scenario primitives the whole cluster rests on (**W2-D-1**, **W2-D-2**). Mechanical, so it is specified as full code.

**Files:**
- Modify: `packages/api-client/src/mock/scenario/types.ts:41-56`
- Modify: `packages/api-client/src/mock/create-mock-client.ts:36-39, 72-126`
- Modify: `packages/api-client/src/mock/seed/index.ts:58-78`
- Modify: `packages/api-client/src/mock/seed/sources.ts:19, 82-91`
- Modify: `packages/api-client/src/index.ts`
- Test: `packages/api-client/test/mock/wave2-scenarios.test.ts`

**Interfaces:**
- Consumes: `MockWorld.schedule` (`world.ts:78`), `createSeed` (`seed/index.ts:68`), `bootstrapFromSeed` (`create-mock-client.ts:198`).
- Produces: `WorldSeed` gains `audioApplyFails: boolean`; `ScenarioScript` gains `timeline?`; `createMockClient(scenario, { clock?, seed? })`; `MockClient.switchScenario(name, seed?)` and `MockClient.worldSeed: WorldSeed`; `WorldSeed` exported from `@eduscope/api-client`. Task 4 (the overlay World strip) and Tasks 2/3 (the scripts) consume all of it.

- [ ] **Step 1: Write the failing test**

`packages/api-client/test/mock/wave2-scenarios.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../../src/mock/create-mock-client.js';

describe('per-switch world seeds (W2-D-1)', () => {
  it('applies a seed override passed at construction', async () => {
    const client = createMockClient('happy', { seed: { recordingOwnedByOtherUser: true } });
    const snapshot = await client.getRecordingState();
    expect(snapshot.state).toBe('recording');
    expect(snapshot.ownerDisplayName).toBe('A. Perera');
    client.dispose();
  });

  it('applies a seed override passed at switch time, and drops it on the next switch', async () => {
    const client = createMockClient('happy');
    expect((await client.getRecordingState()).state).toBe('idle');

    client.switchScenario('happy', { aiEnabled: false });
    expect((await client.getProvisioning()).featureFlags.aiQuizEnabled).toBe(false);
    expect(client.worldSeed.aiEnabled).toBe(false);

    client.switchScenario('happy');
    expect((await client.getProvisioning()).featureFlags.aiQuizEnabled).toBe(true);
    client.dispose();
  });

  it('lets the override win over the script seed', async () => {
    const client = createMockClient('disk-full', { seed: { storagePressure: 'warning' } });
    expect((await client.getStorageOverview()).pressure).toBe('warning');
    client.dispose();
  });

  it('seeds a failed mic apply when audioApplyFails is set (W2-D-4)', async () => {
    const client = createMockClient('happy', { seed: { audioApplyFails: true } });
    const [mic] = await client.listAudioControls();
    expect(mic?.appliedState).toBe('failed');
    expect(mic?.lastError).toMatch(/mixer/i);
    client.dispose();
  });
});

describe('script timelines (W2-D-2)', () => {
  it('schedules a timeline transition against the world', async () => {
    const client = createMockClient('pipeline-crash-midway');
    const seen: string[] = [];
    client.events$.subscribe((e) => {
      if (e.event === 'sources.status') seen.push(`${e.payload.roleId}:${e.payload.state}`);
    });
    await new Promise((r) => setTimeout(r, 6_000));
    expect(seen).toContain('lecturer-cam:degraded');
    client.dispose();
  }, 10_000);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @eduscope/api-client test wave2-scenarios`
Expected: FAIL — `createMockClient` takes no `seed` option, `switchScenario` takes one argument, `worldSeed` is undefined.

- [ ] **Step 3: Widen `WorldSeed` and add `timeline`**

Replace `packages/api-client/src/mock/scenario/types.ts:41-56` with:

```ts
/**
 * World knobs applied before the world starts. Two of these are not fixture
 * shapes but LIVE world concepts — `recordingOwnedByOtherUser` (whose session
 * is currently open) and `audioApplyFails` (whether the mixer accepts a
 * change) — and they live here because this is the one place a caller can set
 * a world's starting conditions without inventing a script whose narrative is
 * a boolean (W2-D-1, W2-D-4).
 */
export interface WorldSeed {
  readonly storagePressure: 'ok' | 'warning' | 'critical';
  readonly aiEnabled: boolean;
  readonly quizAvailable: boolean;
  readonly recordingOwnedByOtherUser: boolean;
  /** S-11 §10's "scenario flag": updateAudioControl resolves `appliedState: failed` (INV-AC-1, B-55). */
  readonly audioApplyFails: boolean;
}

/** A transition the script drives on its own schedule, with no command behind it. */
export interface TimelineEntry {
  readonly transition: TransitionId;
  readonly afterMs: number;
}

export interface ScenarioScript {
  readonly name: ScenarioName;
  readonly description: string;
  forced: ForcedTransition[];
  readonly seed?: Partial<WorldSeed>;
  /**
   * Transitions this script DRIVES rather than intercepts (W2-D-2). `forced`
   * can only replace a transition something else already requested, so machine
   * 5a/5b faults — which no command triggers — are otherwise unreachable.
   * Scheduled through `world.schedule` at build time, so they inherit the
   * world's clock and are discarded with it on a scenario switch.
   */
  readonly timeline?: readonly TimelineEntry[];
  /** ws-flap only: drop and restore the socket on a cycle (events.md §1). */
  readonly wsFlap?: { readonly afterMs: number; readonly downMs: number; readonly repeat: number };
}
```

- [ ] **Step 4: Thread the knob through the seed**

`packages/api-client/src/mock/seed/index.ts` — pass the overrides to `createSourcesSeed`:

```ts
export function createSeed(overrides: Partial<WorldSeed> = {}): Seed {
  const users = createUsersSeed();
  const seed: Seed = {
    users,
    ...createDeviceSeed(overrides),
    ...createSourcesSeed(overrides),
    ...createRecordingsSeed(users),
    ...createAiSeed(),
  };
  return Object.freeze(seed);
}
```

`packages/api-client/src/mock/seed/sources.ts` — take the overrides and seed the mic's applied truth from them (add `import type { WorldSeed } from '../scenario/types.js';`):

```ts
export function createSourcesSeed(overrides: Partial<WorldSeed> = {}): SourcesSeed {
  const applyFails = overrides.audioApplyFails ?? false;
  // …unchanged through `sourceBindings`…

  // mic-lecturer only in V1 (LP-9) — appliedState is the truth the UI shows.
  // `audioApplyFails` seeds the world already in the failed state so S-11 §5.1
  // state 4 renders on FIRST paint, not only after a round trip (W2-D-4).
  const audioControls = [
    validated(zAudioControl, {
      roleId: 'mic-lecturer',
      gain: 72,
      muted: false,
      appliedState: applyFails ? 'failed' : 'applied',
      lastAppliedAt: SEED_EPOCH,
      lastError: applyFails ? 'The mixer did not accept the change.' : null,
    }),
  ];
```

- [ ] **Step 5: Accept the override and run the timeline in `build()`**

`packages/api-client/src/mock/create-mock-client.ts` — four edits.

Signature:

```ts
export function createMockClient(
  scenario: ScenarioName = 'happy',
  options: { clock?: Clock; seed?: Partial<WorldSeed> } = {},
): MockClient {
```

State, beside `let current: ScenarioName = scenario;`:

```ts
  // Re-derived on every build so `worldSeed` always describes the world that
  // is actually running, not the last override a caller happened to pass.
  let effectiveSeed!: WorldSeed;
```

Inside `build`:

```ts
  function build(name: ScenarioName, seedOverride: Partial<WorldSeed> = {}): void {
    // …unchanged teardown / engine / wrapped …
    const merged: WorldSeed = {
      storagePressure: 'ok',
      aiEnabled: true,
      quizAvailable: true,
      recordingOwnedByOtherUser: false,
      audioApplyFails: false,
      ...script.seed,
      ...seedOverride,      // the caller's override wins over the script's
    };
    effectiveSeed = merged;
    const seed = createSeed(merged);
    // …unchanged world / machines / envelopes …
    bootstrapFromSeed(world, seed, merged);
    // …unchanged connection / rest / connection.start() / startAudioLevels …

    // W2-D-2: transitions this script DRIVES. Scheduled last so the world is
    // fully bootstrapped (every bound role already `online`) before the first
    // fault fires, and through `world.schedule` so a `switchScenario` discards
    // them with the world they were scheduled against.
    for (const entry of script.timeline ?? []) {
      world.schedule(entry.transition, entry.afterMs);
    }

    seedSnapshot(world, seed);
    current = name;
  }

  build(scenario, options.seed ?? {});
```

Client surface:

```ts
    get scenario() {
      return current;
    },
    get worldSeed(): WorldSeed {
      return effectiveSeed;
    },
    get world() {
      return world;
    },
    switchScenario(name: ScenarioName, seed?: Partial<WorldSeed>) {
      build(name, seed ?? {});
    },
```

And widen the interface at the top of the file:

```ts
export interface MockClient extends EduscopeClient {
  readonly scenario: ScenarioName;
  /** The merged `WorldSeed` this world is actually running (W2-D-1). */
  readonly worldSeed: WorldSeed;
  readonly world: MockWorld;
  /** Dev-overlay only: rebuild the world under a different script and/or seed, live. */
  switchScenario(name: ScenarioName, seed?: Partial<WorldSeed>): void;
}
```

- [ ] **Step 6: Export the type**

`packages/api-client/src/index.ts`:

```ts
export type {
  ForcedTransition, ScenarioName, ScenarioScript, TimelineEntry, WorldSeed,
} from './mock/scenario/types.js';
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @eduscope/api-client test && pnpm --filter @eduscope/api-client typecheck`
Expected: PASS — the four seed tests green. The timeline test still fails (no script has a timeline until Task 3); mark it `it.todo` and Task 3 un-todos it.

- [ ] **Step 8: Commit**

```bash
git add packages/api-client/src packages/api-client/test/mock/wave2-scenarios.test.ts && git commit -m "feat(mock): per-switch world seeds and script timelines (W2-D-1, W2-D-2)"
```

---

## Task 2: `audio.control` end to end — the mock emits it, the store slices it, one selector reads it

`audio.control` is in the contract (events.md §2.7), in the zod layer, and in **nothing else**: the mock never emits it and `ws-store.ts` has no case for it, so `updateAudioControl` today mutates a seed row no screen can observe. S-09, S-11 and the "one control, one truth" tests all depend on this. Mechanical, so it is specified as full code.

**Files:**
- Modify: `packages/api-client/src/mock/rest/sources.ts:91-127`
- Modify: `packages/api-client/src/mock/rest/index.ts` (`RestContext`)
- Modify: `packages/api-client/src/mock/create-mock-client.ts` (`seedSnapshot`, `createRestOperations` call)
- Modify: `apps/panel/src/store/ws-store.ts:18-46, 75-128`
- Modify: `apps/panel/src/store/selectors.ts`
- Test: `packages/api-client/test/mock/wave2-mock-gaps.test.ts`, `apps/panel/src/store/selectors.test.tsx`

**Interfaces:**
- Consumes: `zAudioControlPayload` / `AudioControlPayload` (`@eduscope/shared`), `WorldSeed.audioApplyFails` (Task 1).
- Produces: `WsState.audioControls: Partial<Record<SourceRoleId, AudioControlPayload>>`; `WsState.lastSegment: RecordingSegmentPayload | null`; `WsState.expectedShutdown: boolean` + `setExpectedShutdown(value: boolean): void`; `useAudioControlRow(roleId: SourceRoleId): AudioControlPayload | undefined`; `useLastSegment(): RecordingSegmentPayload | null`; `useExpectedShutdown(): boolean`. Tasks 5, 8, 15, 17 and 18 consume them.

> The selector is `useAudioControlRow`, **not** `useAudioControl` — Task 15's screen-facing hook of that name wraps it with the mutation, the CG-15 guard and the state derivation. One name for two different things is how a screen ends up reading the row and issuing the command from two places.

- [ ] **Step 1: Write the failing tests**

`packages/api-client/test/mock/wave2-mock-gaps.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../../src/mock/create-mock-client.js';

describe('audio.control is emitted (events.md §2.7)', () => {
  it('emits the applied truth after updateAudioControl', async () => {
    const client = createMockClient('happy');
    const seen: unknown[] = [];
    client.events$.subscribe((e) => {
      if (e.event === 'audio.control') seen.push(e.payload);
    });
    await client.updateAudioControl('mic-lecturer', { muted: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.at(-1)).toMatchObject({
      roleId: 'mic-lecturer', muted: true, appliedState: 'applied', lastError: null,
    });
    client.dispose();
  });

  it('resolves as failed, with the REQUESTED value not applied, when audioApplyFails is set', async () => {
    const client = createMockClient('happy', { seed: { audioApplyFails: true } });
    const seen: Array<Record<string, unknown>> = [];
    client.events$.subscribe((e) => {
      if (e.event === 'audio.control') seen.push(e.payload as Record<string, unknown>);
    });
    await client.updateAudioControl('mic-lecturer', { muted: true });
    await new Promise((r) => setTimeout(r, 50));
    // INV-AC-1: the panel must be able to render the APPLIED state, so the
    // mock must not have applied the request.
    expect(seen.at(-1)).toMatchObject({ muted: false, appliedState: 'failed' });
    expect(seen.at(-1)?.lastError).toBeTypeOf('string');
    client.dispose();
  });

  it('includes audio.control in the boot snapshot', async () => {
    const client = createMockClient('happy');
    const names = await new Promise<string[]>((resolve) => {
      const seen: string[] = [];
      client.events$.subscribe((e) => seen.push(e.event));
      setTimeout(() => resolve(seen), 50);
    });
    expect(names).toContain('audio.control');
    client.dispose();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @eduscope/api-client test wave2-mock-gaps`
Expected: FAIL — no `audio.control` event is ever emitted.

- [ ] **Step 3: Emit it from the mock**

`packages/api-client/src/mock/rest/sources.ts` — replace the body of `updateAudioControl` after the CG-15 guard:

```ts
      const row = seed.audioControls.find((a) => a.roleId === roleId);
      if (!row) {
        throw new ProblemError({ status: 422, code: 'validation.invalid', title: `No audio control for ${roleId}` });
      }
      // No machine 5-adjacent module models AudioControl transitions; the ALSA
      // path is applied directly rather than through a scheduled transition,
      // same "no machine" category as firmware.ts / settings.ts.
      //
      // INV-AC-1 / B-55: when the mixer refuses, the requested value is NOT
      // written. `appliedState: failed` beside an already-applied `muted`
      // would be a fiction the panel could not distinguish from success, and
      // S-11 §5.1 state 4 exists precisely to render the gap between the two.
      if (!ctx.worldSeed.audioApplyFails) {
        Object.assign(row, {
          ...(body.gain !== undefined ? { gain: body.gain } : {}),
          ...(body.muted !== undefined ? { muted: body.muted } : {}),
          appliedState: 'applied',
          lastAppliedAt: nowIsoZ(world.clock),
          lastError: null,
        });
      } else {
        Object.assign(row, {
          appliedState: 'failed',
          lastError: 'The mixer did not accept the change.',
        });
      }
      // events.md §2.7: "Resolution of PUT /audio/controls/{roleId} after
      // pipeline-manager applies (or fails to apply) the mixer change."
      world.emit('audio.control', {
        roleId: row.roleId,
        gain: row.gain,
        muted: row.muted,
        appliedState: row.appliedState,
        lastError: row.lastError,
      });
      return validated(zCommandAccepted, {
        commandId: nextUlid(world),
        acceptedAt: nowIsoZ(world.clock),
        resolveBySec: RESOLVE_BY_SEC,
      });
```

`RestContext` gains `readonly worldSeed: WorldSeed;` in `mock/rest/index.ts`, and `create-mock-client.ts` passes it:

```ts
    rest = createRestOperations({
      world, engine, seed, connection, worldSeed: merged, credentials: createCredentialStore(),
    });
```

- [ ] **Step 4: Put it in the boot snapshot**

`create-mock-client.ts`, inside `seedSnapshot`, after the `sources.status` loop:

```ts
  // audio.control is a per-role row like sources.status, and the mic meter and
  // both bars render `appliedState` — a cold client with no audio.control has
  // to guess a switch position, which S-11 §5.1's U-1 row forbids.
  for (const control of seed.audioControls) world.emit('audio.control', control);
```

- [ ] **Step 5: Slice it in the store**

`apps/panel/src/store/ws-store.ts` — add `AudioControlPayload`, `RecordingSegmentPayload`, `SourceRoleId` to the imports, then:

```ts
  audioControls: Partial<Record<SourceRoleId, AudioControlPayload>>;
  /** The most recent segment event — S-07 reads `endReason: 'crash'` for R-16's seam marker. */
  lastSegment: RecordingSegmentPayload | null;
  /**
   * S12-D-6: a socket close that FOLLOWS a power-off 202 is the success signal,
   * not a fault. Set by `use-power-off`, cleared by `reset()` — which the dev
   * overlay already calls before every scenario switch, so it cannot leak
   * between runs (S-12 §10).
   */
  expectedShutdown: boolean;
  setExpectedShutdown(value: boolean): void;
```

In `EMPTY`: `audioControls: {}, lastSegment: null, expectedShutdown: false,`.

In the `ingest` switch, above `default`:

```ts
        case 'audio.control':
          return { audioControls: { ...get().audioControls, [envelope.payload.roleId]: envelope.payload } };
        case 'recording.segment': return { lastSegment: envelope.payload };
```

And beside `setConnection`:

```ts
  setExpectedShutdown(value) {
    set({ expectedShutdown: value, stale: value ? false : get().stale });
  },
```

- [ ] **Step 6: Add the selectors**

`apps/panel/src/store/selectors.ts`:

```ts
export const useLastSegment = () => useWsStore((s) => s.lastSegment);
export const useExpectedShutdown = () => useWsStore((s) => s.expectedShutdown);

/** THE mic read. Task 15's `useAudioControl` hook is its only caller (S-11 §12). */
export const useAudioControlRow = (roleId: SourceRoleId) =>
  useWsStore((s) => s.audioControls[roleId]);
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @eduscope/api-client test && pnpm --filter @eduscope/panel test src/store && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/api-client apps/panel/src/store && git commit -m "feat(mock,store): emit and slice audio.control, plus the segment and shutdown slices"
```

---

## Task 3: Mock honesty fixes and the scripts that drive Wave 2's faults

Three places the mock contradicts a machine (**W2-D-11**), the two script timelines the design docs name by file, the Class-A refusal (**W2-D-5**), and the ninth script (**W2-D-3**). Mechanical, so it is specified as full code.

**Files:**
- Modify: `packages/api-client/src/mock/rest/recording.ts:45-67`
- Modify: `packages/api-client/src/mock/events/preview.ts:47-179`
- Modify: `packages/api-client/src/mock/scenario/scripts/start-fails.ts`
- Modify: `packages/api-client/src/mock/scenario/scripts/pipeline-crash-midway.ts`
- Modify: `packages/api-client/src/mock/scenario/scripts/ws-flap.ts`
- Create: `packages/api-client/src/mock/scenario/scripts/poweroff-not-halted.ts`
- Modify: `packages/api-client/src/mock/scenario/types.ts` (`ScenarioName`), `registry.ts`
- Test: `packages/api-client/test/mock/wave2-mock-gaps.test.ts` (extend)

**Interfaces:**
- Consumes: `isRecordingNonTerminal` (`machines/recording.ts:131`), `sourceTransitionId` (`machines/health.ts:32`), `BOUND_SOURCE_ROLES` (`machines/index.ts:10`), `TimelineEntry` (Task 1).
- Produces: `ScenarioName` gains `'poweroff-not-halted'`; `startRecording` can reject `409 recorder.busy` carrying `meta.ownerDisplayName` / `meta.title`; `takeoverRecording` can reject `409 conflict`; the preview channel emits `error{source-offline}` on mid-preview loss.

- [ ] **Step 1: Write the failing tests**

Append to `packages/api-client/test/mock/wave2-mock-gaps.test.ts`:

```ts
describe('R-03 / R-21 guards (W2-D-11)', () => {
  it('refuses a start while another session is live, instead of throwing in a timer', async () => {
    const client = createMockClient('happy', { seed: { recordingOwnedByOtherUser: true } });
    await expect(client.startRecording()).rejects.toMatchObject({
      problem: { status: 409, code: 'recorder.busy' },
    });
    client.dispose();
  });

  it('refuses a takeover once machine 1a is terminal', async () => {
    const client = createMockClient('happy');
    await client.login({ username: 'admin', password: 'battery-staple', client: 'panel' });
    await expect(client.takeoverRecording()).rejects.toMatchObject({
      problem: { status: 409, code: 'conflict' },
    });
    client.dispose();
  });
});

describe('the preview drops when its role leaves online (S-10)', () => {
  it('emits error{source-offline} and stops frames', async () => {
    const client = createMockClient('happy');
    const preview = client.openPreview();
    const seen: Array<{ type: string; code?: string }> = [];
    preview.messages$.subscribe((m) => seen.push(m as { type: string; code?: string }));
    preview.send({ type: 'offer', negotiationId: 'n1', roleId: 'lecturer-cam', sdp: 'v=0' });
    await new Promise((r) => setTimeout(r, 600));
    expect(seen.some((m) => m.type === 'answer')).toBe(true);

    client.world.apply('HL-06@lecturer-cam');
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.at(-1)).toMatchObject({ type: 'error', code: 'source-offline' });
    preview.close();
    client.dispose();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @eduscope/api-client test wave2-mock-gaps`
Expected: FAIL on all three — `startRecording` resolves, `takeoverRecording` resolves, no `error` after the role drops.

- [ ] **Step 3: Guard `startRecording` and `takeoverRecording`**

`packages/api-client/src/mock/rest/recording.ts` — add `isRecordingNonTerminal` to the imports from `../machines/index.js`:

```ts
    startRecording: async () => {
      // R-03: mutual exclusion is SERVER-enforced (LP-6, B-15). Without this
      // the request resolved 202 and R-01 then threw `illegal transition` from
      // inside a setTimeout — an unhandled rejection, not a refusal — and
      // S-04's `refused: recorder busy` had no producer at all.
      if (isRecordingNonTerminal(world)) {
        world.apply('R-03'); // re-broadcasts the current state as the refusal
        throw new ProblemError({
          status: 409,
          code: 'recorder.busy',
          title: 'This device is already recording.',
          meta: {
            ownerDisplayName: (world.data['session.ownerDisplayName'] as string | null) ?? null,
            title: (world.data['session.title'] as string | null) ?? null,
          },
        });
      }
      const me = currentUser(ctx);
      world.data['session.title'] = 'CS2013 — Data Structures, Lecture 13';
      world.data['session.ownerUserId'] = me.id;
      world.data['session.ownerDisplayName'] = me.displayName;
      return accept('startRecording');
    },
```

```ts
    takeoverRecording: async () => {
      requireAdmin(ctx);
      // R-21 is `from: ['*']` — ANY NON-TERMINAL state. Scheduling it against a
      // finished session threw inside a timer; S-06 §5 state 5 words this exact
      // case as "That lecture has already ended."
      if (!isRecordingNonTerminal(world)) {
        throw new ProblemError({
          status: 409,
          code: 'conflict',
          title: 'That lecture has already ended.',
        });
      }
      const me = currentUser(ctx);
      world.data['session.takeoverBy'] = me.id;
      world.data['session.takeoverAt'] = nowIsoZ(world.clock);
      world.data['session.takeoverByDisplayName'] = me.displayName;
      return accept('takeoverRecording');
    },
```

> S-06 §12 requires S-04 to route to the lock view on `409 recorder.busy` **and** on a cold-load snapshot that says `locked` — **C-4**: "the refusal is the race, the snapshot is the common case". Both paths land in Task 7 / Task 13.

- [ ] **Step 4: Drop a live preview when its role leaves `online`**

`packages/api-client/src/mock/events/preview.ts` — inside `createPreviewChannel`, after `endCurrent` is defined:

```ts
  /**
   * S-10 `source went offline mid-preview`: "the server drops unilaterally; the
   * lightbox shows why rather than freezing on the last frame." Nothing did
   * that — the frame loop kept painting a source the world had already marked
   * offline, which is the B-12 class in miniature.
   */
  const unsubscribe = world.subscribeEvents((envelope) => {
    if (envelope.event !== 'sources.status' || !current) return;
    const payload = envelope.payload as { roleId: string; state: string };
    if (payload.roleId !== current.roleId || payload.state === 'online') return;
    const dying = current;
    endCurrent();
    emitter.emit({
      type: 'error',
      negotiationId: dying.negotiationId,
      code: payload.state === 'unbound' ? 'source-unbound' : 'source-offline',
      message: `source ${dying.roleId} is no longer available`,
    });
  });
```

and in the returned object:

```ts
    close() {
      closed = true;
      unsubscribe();
      endCurrent();
    },
```

- [ ] **Step 5: Extend `start-fails` with the Class-A refusal (W2-D-5)**

Replace `packages/api-client/src/mock/scenario/scripts/start-fails.ts`:

```ts
import type { ScenarioScript } from '../types.js';

/**
 * BOTH refusal classes on one script (state-machines §0.4).
 *
 * Attempt 1 is **Class A**: R-04's named-reason rejection — no session row is
 * created, so the library never grows a phantom `error` row (SM-Q-1), and S-04
 * must name which piece is missing rather than say "could not start"
 * (INV-SB-3, B-01).
 *
 * Attempt 2 is **Class B**: the session IS created and then fails to `error` —
 * a start that fails must never read as `recording` (B-12, LP-4, J-1 failure).
 *
 * `nth: 1` on the first rule is what makes the demo recover rather than
 * dead-end — the shape `auth-failures` already uses for `changePassword`.
 */
export const startFails: ScenarioScript = {
  name: 'start-fails',
  description:
    'The first Start is refused outright with a named configuration reason (Class A, no ' +
    'session row). The second creates a session whose consumer never confirms, so R-05 ' +
    'is replaced by R-06: starting -> error, and the red frame never appears.',
  forced: [
    {
      on: { command: 'startRecording' },
      nth: 1,
      replace: 'refuse',
      refusal: {
        status: 409,
        code: 'config.invalid',
        title: 'The Students Camera is not connected to this device.',
        detail:
          'The current recording layout needs it. An administrator can change the layout or reconnect the camera.',
      },
    },
    { on: { transition: 'R-05' }, replace: 'R-06' },
  ],
};
```

> The refusal reaches `onCommand` before `COMMAND_PLANS.startRecording` runs, so R-01 never fires and no session row exists — which is what Class A means. The Class-B rule needs no `nth`: on attempt 2 R-01 runs and its `fire('R-05')` is intercepted.

- [ ] **Step 6: Give `pipeline-crash-midway` and `ws-flap` timelines**

`pipeline-crash-midway.ts`:

```ts
import { sourceTransitionId } from '../../machines/health.js';
import type { ScenarioScript } from '../types.js';

/**
 * R-16 plus the source faults every Wave-2 confidence surface needs.
 *
 * The consumer dies mid-lecture, a NEW segment opens, and the lecture is not
 * ended by a dead pipeline. Alongside it the timeline walks machine 5a through
 * degraded -> offline on `lecturer-cam`, and offline on `mic-lecturer` — the
 * audio role §6.2 ranks CRITICAL ("a silent lecture is bad, so this is
 * impossible to miss") and that no script exercised before (S-11 §10). Both
 * recover, so the demo ends healthy rather than dead-ending. Delays are
 * demo-sized, not spec-length.
 */
export const pipelineCrashMidway: ScenarioScript = {
  name: 'pipeline-crash-midway',
  description:
    'The record consumer exits unexpectedly: R-16 truncates the open segment, raises ' +
    'recording.pipeline-lost, and R-17 resumes into a new segment — the seam is visible, ' +
    'the lecture survives. Meanwhile the lecturer camera degrades then drops, and the ' +
    'lecturer mic drops: a dead source never ends a lecture (R-SRC-1).',
  forced: [
    { on: { transition: 'R-05' }, nth: 1, replace: 'R-05', delayMs: 1_200 },
    { on: { transition: 'R-16' }, nth: 1, replace: 'R-16' },
  ],
  timeline: [
    { transition: sourceTransitionId('lecturer-cam', 'HL-04'), afterMs: 5_000 },
    { transition: sourceTransitionId('lecturer-cam', 'HL-06'), afterMs: 12_000 },
    { transition: sourceTransitionId('mic-lecturer', 'HL-06'), afterMs: 20_000 },
    { transition: sourceTransitionId('lecturer-cam', 'HL-07'), afterMs: 34_000 },
    { transition: sourceTransitionId('mic-lecturer', 'HL-07'), afterMs: 40_000 },
  ],
};
```

`ws-flap.ts` — add the timeline, keep `forced` and `wsFlap` as they are:

```ts
import { BOUND_SOURCE_ROLES } from '../../machines/index.js';
import { sourceTransitionId } from '../../machines/health.js';
import type { ScenarioScript } from '../types.js';

export const wsFlap: ScenarioScript = {
  name: 'ws-flap',
  description:
    'The panel loses the event socket three times. Live regions dim after 10 s, the ' +
    'recording frame is kept, commands are rejected rather than queued, and each ' +
    'reconnect forces a full snapshot resync. Before the first drop the telemetry goes ' +
    'stale with the socket still OPEN, so every source reads "checking" — never the last ' +
    'healthy value (HL-08, INV-DH-2).',
  forced: [],
  // S-05 §10: "the socket is fine but the data is old" is the one input for
  // which that distinction is the whole point, and it was untestable.
  timeline: [
    ...BOUND_SOURCE_ROLES.map((roleId, i) => ({
      transition: sourceTransitionId(roleId, 'HL-08'),
      afterMs: 5_000 + i * 200,
    })),
    ...BOUND_SOURCE_ROLES.map((roleId, i) => ({
      transition: sourceTransitionId(roleId, 'HL-02'),
      afterMs: 11_000 + i * 200,
    })),
  ],
  wsFlap: { afterMs: 15_000, downMs: 12_000, repeat: 3 },
};
```

- [ ] **Step 7: Add the ninth script (W2-D-3)**

`packages/api-client/src/mock/scenario/scripts/poweroff-not-halted.ts`:

```ts
import type { ScenarioScript } from '../types.js';

/**
 * B-50 from the other side.
 *
 * The legacy endpoint answered "Successfull" whether or not the shutdown ran,
 * and the legacy UI treated a failed request as success. S-12's `accepted, not
 * halted` (§5 state 8) is the inversion: the device accepted the command,
 * `resolveBySec` elapsed, the socket is still alive — so the panel says so and
 * offers ONE explicit retry rather than stranding a healthy device on a
 * terminal screen (S12-D-5).
 *
 * Three taps, three states, one run:
 *   1. `refused (other)` — an unrelated Problem; the destructive button is
 *      replaced by Close (§5 state 9)
 *   2. `accepted, not halted` — the 202 is accepted and `replace: 'stall'`
 *      suppresses the transport close that would otherwise resolve it (CG-16,
 *      S12-D-2), so the not-halted line and **Try again** appear (§5 state 8)
 *   3. Try again — no rule matches, the socket closes, `accepted` (§5 state 7)
 *
 * Both rules carry `nth: 1` deliberately. `match()` consumes an occurrence the
 * moment a rule's PREDICATE passes, and rule 1's predicate is only evaluated in
 * `onCommand` (it is a `refuse`) while rule 2's is only evaluated in `onStall` —
 * so their counters advance independently and `nth: 2` on rule 2 would never
 * fire.
 */
export const poweroffNotHalted: ScenarioScript = {
  name: 'poweroff-not-halted',
  description:
    'The shutdown is first refused for an unrelated reason, then accepted and never ' +
    'honoured. The panel must offer Try again rather than declaring failure or leaving a ' +
    'healthy device on a dead-end screen.',
  forced: [
    {
      on: { command: 'powerOffDevice' },
      nth: 1,
      replace: 'refuse',
      refusal: {
        status: 503,
        code: 'internal',
        title: 'The device could not be reached to shut it down.',
        detail: 'Try again in a moment.',
      },
    },
    { on: { command: 'powerOffDevice' }, nth: 1, replace: 'stall' },
  ],
};
```

Register it — `types.ts`:

```ts
  | 'auth-failures'
  /** Added for Wave 2's S-12 (W2-D-3, CG-16). */
  | 'poweroff-not-halted';
```

`registry.ts`: import it and add `'poweroff-not-halted': poweroffNotHalted,` as the last entry of `CATALOG`.

- [ ] **Step 8: Run every mock test**

Run: `pnpm --filter @eduscope/api-client test && pnpm --filter @eduscope/api-client typecheck`
Expected: PASS, including the previously-`todo` timeline test in `wave2-scenarios.test.ts` (un-todo it) and the existing `test/scenario/scripts.test.ts` sweep.

- [ ] **Step 9: Commit**

```bash
git add packages/api-client && git commit -m "feat(mock): R-03/R-21 guards, mid-preview source loss, fault timelines and the poweroff-not-halted script"
```

---

## Task 4: The dev overlay's World strip

Every Wave-2 state that is a *world condition* rather than a *narrative* is reached from here (**W2-D-1**). Without it the locked view, the flag-off layout and the apply-failed mic are unreachable from a browser.

**Files:**
- Modify: `apps/panel/src/devtools/scenario-overlay.tsx:38-144`
- Modify: `apps/panel/src/devtools/scenario-overlay.css`
- Modify: `apps/panel/e2e/gate-boot.spec.ts` (Gate 1b's script count 8 → 9)
- Test: `apps/panel/src/devtools/scenario-overlay.test.tsx` (extend)

**Interfaces:**
- Consumes: `MockClient.switchScenario(name, seed?)`, `MockClient.worldSeed`, `WorldSeed` (Task 1); `useWsStore.getState().reset()`.
- Produces: nothing importable — a dev surface. Its control **labels are fixed here** and quoted verbatim by every demo checklist in this plan.

- [ ] **Step 1: Write the failing test**

`apps/panel/src/devtools/scenario-overlay.test.tsx`:

```tsx
it('re-seeds the world without changing the script', async () => {
  const switchScenario = vi.fn();
  renderOverlay({ scenario: 'happy', worldSeed: BASE_SEED, switchScenario });
  await openOverlay();
  await userEvent.click(screen.getByLabelText('AI disabled (INT-10 go-live default)'));
  expect(switchScenario).toHaveBeenCalledWith('happy', expect.objectContaining({ aiEnabled: false }));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @eduscope/panel test src/devtools`
Expected: FAIL — no such control.

- [ ] **Step 3: Add the strip**

Hold the seed in local state beside `active`, and route **both** the script radios and the world controls through one helper so the reset-before-switch ordering (already load-bearing — see the comment at `scenario-overlay.tsx:56-61`) is written once:

```tsx
const [seed, setSeed] = useState<Partial<WorldSeed>>({});

const rebuild = (name: ScenarioName, nextSeed: Partial<WorldSeed>) => {
  useWsStore.getState().reset();     // BEFORE switchScenario — the new world
  client.switchScenario(name, nextSeed); // emits its bootstrap synchronously
  setActive(name);
  setSeed(nextSeed);
};
```

The strip renders inside the open panel, after the script list. **These labels are the contract with every demo checklist below:**

| Control | Type | `WorldSeed` field | Reaches |
|---|---|---|---|
| `AI disabled (INT-10 go-live default)` | checkbox | `aiEnabled: false` | S-05's whole approved layout |
| `Recorder owned by another user` | checkbox | `recordingOwnedByOtherUser: true` | S-06 states 1, 2, 9; S-07 `not owner`; S-12 state 2; S-04 `refused: recorder busy` |
| `Mic changes fail to apply` | checkbox | `audioApplyFails: true` | S-09 `apply failed`, S-11 §5.1 state 4 |
| `Storage: ok` / `Storage: warning` / `Storage: critical` | radio ×3 | `storagePressure` | S-04 `storage warning`, S-05 tiers 3 and 4 |
| `Quiz server unavailable` | checkbox | `quizAvailable: false` | Not a Wave-2 state — exposed because the field exists and a knob only a test can reach is a knob that rots |

Every control is a real `<label>`+`<input>` pair (`jsx-a11y/label-has-associated-control` errors otherwise) with an `aria-label` matching its visible text.

- [ ] **Step 4: Style it**

`scenario-overlay.css` — add `.us-devoverlay__world`, matching `.us-devoverlay__transport`'s existing bordered-block treatment. Dev-only; outside the visual review.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @eduscope/panel test src/devtools && pnpm gate`
Expected: PASS, `pnpm gate` still **5 passed**. Gate 1b asserts the overlay lists every catalog script — update its expected count to **nine** here rather than leaving a later task to discover it.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/devtools apps/panel/e2e/gate-boot.spec.ts && git commit -m "feat(devtools): world-seed strip so Wave 2's world conditions are reachable from the overlay"
```

---

## Task 5: U-2 suppression during a shutdown, and the alert-suppression registry

Two pieces of shell plumbing S-12 §12 places on *other* screens (**W2-D-6**, **W2-D-7**), built before the screen that needs them.

**Files:**
- Modify: `apps/panel/src/store/connection.ts:19`
- Modify: `apps/panel/src/store/ws-store.ts` (`setConnection`)
- Create: `apps/panel/src/shell/alert-suppression.ts`
- Modify: `apps/panel/src/shell/alert-banners.tsx:41-53`
- Test: `apps/panel/src/store/connection.test.ts`, `apps/panel/src/shell/alert-banners.test.tsx` (both extend)

**Interfaces:**
- Consumes: `WsState.expectedShutdown` (Task 2).
- Produces: `isStale(status: ConnectionStatus, expectedShutdown?: boolean): boolean`; `useAlertSuppression` with `suppress(code: string): void` / `release(code: string): void`. Task 18 (`use-power-off`) is the only caller of both.

- [ ] **Step 1: Write the failing tests**

`apps/panel/src/store/connection.test.ts`:

```ts
it('is not stale while a shutdown is expected (S12-D-6)', () => {
  const stale = { phase: 'stale', attempt: 3, since: '2026-08-05T10:00:00Z' } as const;
  const closed = { phase: 'closed', attempt: 0, since: '2026-08-05T10:00:00Z' } as const;
  expect(isStale(stale, false)).toBe(true);
  expect(isStale(stale, true)).toBe(false);
  // a socket that closed with no power-off behind it is the strongest U-2 there is
  expect(isStale(closed, false)).toBe(true);
  expect(isStale(closed, true)).toBe(false);
});
```

`apps/panel/src/shell/alert-banners.test.tsx`:

```tsx
it('hides a suppressed code and shows it again once released', async () => {
  useAlertSuppression.getState().suppress('poweroff.refused');
  renderBanners([alert({ code: 'poweroff.refused', title: 'Refused' })]);
  expect(screen.queryByTestId('alert-banner')).toBeNull();

  act(() => useAlertSuppression.getState().release('poweroff.refused'));
  expect(await screen.findByTestId('alert-banner')).toHaveTextContent('Refused');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @eduscope/panel test src/store/connection src/shell/alert-banners`
Expected: FAIL — `isStale` takes one argument; there is no suppression store.

- [ ] **Step 3: Widen the staleness rule**

`apps/panel/src/store/connection.ts`:

```ts
/**
 * U-2 — disconnected longer than `T-WS-STALE`: dim the live regions.
 *
 * Except when the panel ASKED for the socket to go away. A successful
 * `powerOffDevice` has no resolving event (CG-16); the transport closing IS the
 * resolution (S12-D-2), so rendering "reconnecting" over a correctly halting
 * device would be a false alarm at the exact moment the user did the right
 * thing (S12-D-6).
 *
 * `closed` joins `stale` here: an unexpected close is the strongest possible
 * U-2 condition and previously rendered as connected.
 *
 * Note what this deliberately does NOT do: clear the recording slice. The
 * device is still recording whether or not the panel can see it, and blanking
 * the frame would be the more dangerous lie of the two.
 */
export const isStale = (status: ConnectionStatus, expectedShutdown = false): boolean =>
  !expectedShutdown && (status.phase === 'stale' || status.phase === 'closed');
```

`ws-store.ts`'s `setConnection` becomes:

```ts
  setConnection(status) {
    set({ connection: status, stale: isStale(status, get().expectedShutdown) });
  },
```

- [ ] **Step 4: Add the suppression registry**

`apps/panel/src/shell/alert-suppression.ts`:

```ts
import { create } from 'zustand';

/**
 * Codes the shell must not render as banners right now (S12-D-3).
 *
 * U-5 puts a refusal next to the control that was pressed, so the panel that
 * ISSUED a refused command reads the 409 and must not also see the cross-panel
 * `system.alert` carrying the same fact — two carriers for one fact on one
 * screen is how a user learns to ignore banners. The banner-host row stays: it
 * is still the correct carrier for a SECOND panel.
 *
 * A dedicated store rather than a WS-store field (W2-D-6): the WS store holds
 * contract-typed slices and is cleared by `reset()` on every scenario switch,
 * which is the wrong lifetime. This one is owned by a mount/unmount effect on
 * the dialog that issued the command.
 */
interface AlertSuppressionState {
  readonly codes: readonly string[];
  suppress(code: string): void;
  release(code: string): void;
}

export const useAlertSuppression = create<AlertSuppressionState>((set) => ({
  codes: [],
  suppress: (code) => set((s) => (s.codes.includes(code) ? s : { codes: [...s.codes, code] })),
  release: (code) => set((s) => ({ codes: s.codes.filter((c) => c !== code) })),
}));
```

- [ ] **Step 5: Honour it in the banner host**

`alert-banners.tsx`:

```tsx
  const suppressed = useAlertSuppression((s) => s.codes);
  const active = Array.from(merged.values())
    .filter((a) => !a.clearedAt && !dismissed.has(a.id) && !suppressed.includes(a.code))
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
```

`offline-marker.tsx` needs **no change** — it reads `useIsStale()`, which now derives from the widened rule.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @eduscope/panel test src/store src/shell && pnpm typecheck`
Expected: PASS, including the existing S-03 shell tests — `connecting`, `open` and `reconnecting` all still return `false`, so no Wave-1 assertion moves.

- [ ] **Step 7: Commit**

```bash
git add apps/panel/src/store apps/panel/src/shell && git commit -m "feat(shell): expected-shutdown staleness suppression and the alert-suppression registry"
```

---

## Task 6: `danger/` — the product-wide destructive-action vocabulary

[S-06 §3](../../design/screens/S-06-design.md#3-the-destructive-action-vocabulary--product-wide) is explicitly **product-wide**: S-12 uses it this wave, and S-24 and S-30 inherit it unchanged in Wave 5/6 and *"may not define their own destructive treatment"*. It is therefore built once, here, before either consumer.

**Files:**
- Create: `apps/panel/src/danger/danger-button.tsx`
- Create: `apps/panel/src/danger/danger-confirm.tsx`
- Create: `apps/panel/src/danger/danger.css`
- Test: `apps/panel/src/danger/danger-button.test.tsx`, `apps/panel/src/danger/danger-confirm.test.tsx`

**Interfaces:**
- Consumes: `useOverlays()` (`overlays/overlay-host.tsx:55`) — the mount point, z-stack and `dismissible` flag already exist and **no second mechanism is proposed** (DGR-D-3).
- Produces:

```ts
export type DangerVariant = 'quiet' | 'solid';

export interface DangerButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  readonly variant: DangerVariant;
  readonly children: React.ReactNode;
}

/** DGR-D-4 — the only four states any DangerConfirm in this product has. */
export type DangerConfirmState = 'confirm' | 'pending' | 'refused' | 'done';

export interface DangerConfirmProps {
  readonly title: string;
  readonly body: React.ReactNode;
  /** The destructive label, e.g. "Take over" / "Power off". */
  readonly confirmLabel: string;
  /** Rendered instead of the destructive button while `state === 'pending'`. */
  readonly pendingLabel: string;
  readonly state: DangerConfirmState;
  /** The message slot's content. Reserved at 40px whether or not this is set. */
  readonly message?: React.ReactNode;
  /**
   * DGR-D-4 `refused`: the destructive button is REPLACED, never left live to
   * be re-tapped. The screen supplies its own remedy.
   */
  readonly remedy?: React.ReactNode;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  /** Defaults to "Cancel"; `refused` states pass "Close". */
  readonly cancelLabel?: string;
}
```

Tasks 13 (S-06) and 18 (S-12) are the two Wave-2 consumers.

**Component breakdown**

| Unit | Responsibility | Must not |
|---|---|---|
| `DangerButton` | The two tiers and nothing else — `quiet` (`--danger-soft` fill, `--danger` label, 1 px `--danger` border) and `solid` (`--danger` fill, `#fff` label, `--shadow-md`), both `--radius-lg`, `--fs-md`/700, 56 px | Know about dialogs, commands or screens. It takes tokens only |
| `DangerConfirm` | Title, body, the unconditionally-reserved 40 px message slot, the footer, the four DGR-D-4 states, the focus trap and the scrim | Own a command, a mutation or a `useOverlays().open` call. The screen opens it |

**Geometry and behaviour, from S-06 §3.2 / §3.3 — all binding**

- `--modal-w` (680 px), `--radius-xl`, `--shadow-lg`, `--sp-10` padding, `--surface`.
- Footer `justify-content: flex-end`, gap **`--sp-10`** (24 px — §8.5's *"danger separation"*). The destructive button is **last in DOM order**, therefore rightmost and last in the tab order.
- Cancel is default weight: `--surface` fill, 1 px `--border`, `--text`, 600, 56 px.
- The message slot is **reserved unconditionally at 40 px** — *"a refusal must not move a 56 px button under a finger that is already reaching for it"*. `aria-live="polite"`.
- Scrim `color-mix(in srgb, var(--ink) 55%, transparent)`. Not a new token.
- `role="alertdialog"`, `aria-labelledby` the title, `aria-describedby` the body.
- **Focus is trapped and opens on Cancel, never on the destructive button** — *"a bench keyboard's stray Enter must not destroy anything."* Set via a ref + `.focus()` in an effect (`jsx-a11y/no-autofocus` errors on the attribute).
- Opened through `useOverlays().open(node, { dismissible: false })`. The kiosk has no Escape key; Cancel is the touch exit; a stray palm on the scrim must not cancel a command already in flight.
- `prefers-reduced-motion`: the pending affordance is **not motion-only** — it also swaps the label to `pendingLabel` and locks both buttons.

- [ ] **Step 1: Write the failing tests**

`danger-button.test.tsx` — 3 tests:
1. `quiet` renders with the soft fill and the `--danger` label; `solid` renders with the solid fill and `#fff`; both ≥56 px.
2. Neither variant carries an `onClick` default, and both forward `disabled`.
3. A greyscale-safe check: the two variants differ by more than colour (border presence), asserted on computed style.

`danger-confirm.test.tsx` — 8 tests, one per DGR-D-4 state plus the four invariants:
1. `confirm` — title, body, both buttons live.
2. `pending` — the destructive button shows `pendingLabel`; **both** buttons are disabled.
3. `refused` — the message slot carries the reason and the destructive button is **absent**, replaced by `remedy`.
4. `done` — renders nothing (the screen owns the terminal rendering).
5. The message slot occupies 40 px **before any message exists** (query the element, assert it is in the document with `state="confirm"` and no `message`).
6. Initial focus is on **Cancel**, in every state that has one.
7. `role="alertdialog"` with `aria-labelledby`/`aria-describedby` wired to real ids.
8. The destructive button is the **last** focusable element in the dialog (tab order).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @eduscope/panel test src/danger`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement `DangerButton`, then `DangerConfirm`, then `danger.css`**

Build in that order; run the button tests green before starting the dialog. Every value comes from `tokens.css` — **no new token** (S-06 §7 states this explicitly, including for §3).

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @eduscope/panel test src/danger && pnpm lint`
Expected: PASS, 11 tests, lint exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/panel/src/danger && git commit -m "feat(danger): the product-wide destructive-action vocabulary (S-06 §3, DGR-D-1..D-4)"
```

---

## Task 7: S-04 — the dashboard host, the idle hero and every start refusal

The screen a lecturer sees 95 % of the time (screen-inventory §2 S-04). `/` stops being a placeholder. Prototype coverage is **full for the happy frame** (`prototype/src/components/IdleHero.tsx`) and **every refusal and failure state is new**.

**Files:**
- Create: `apps/panel/src/screens/dashboard/dashboard-screen.tsx`
- Create: `apps/panel/src/screens/dashboard/idle-hero.tsx`
- Create: `apps/panel/src/screens/dashboard/use-start-recording.ts`
- Create: `apps/panel/src/screens/dashboard/start-refusal.tsx`
- Create: `apps/panel/src/screens/dashboard/dashboard.css`
- Modify: `apps/panel/src/routes/router.tsx:11-14` (`'S-04': () => <DashboardScreen />`)
- Test: `idle-hero.test.tsx`, `use-start-recording.test.ts`, `start-refusal.test.tsx`, `dashboard-screen.test.tsx`

**Interfaces:**
- Consumes: `useClient()`, `useRecordingState()`, `useStoragePressure()`, `useIsStale()`, `useAuth()`, `useProvisioning()` (`shell/use-provisioning.ts:10`), `ProblemError` / `TransportError` (`@eduscope/api-client`), `TIMERS`.
- Produces:

```ts
/** screen-inventory §2 S-04's States list, as a discriminated union. */
export type StartState =
  | { readonly kind: 'ready' }
  | { readonly kind: 'holding'; readonly reason: 'cold' | 'recovery' }   // U-1 / W2-D-8
  | { readonly kind: 'starting' }
  | { readonly kind: 'refused'; readonly problem: Problem }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'offline' };                                        // U-2

export interface UseStartRecording {
  readonly state: StartState;
  start(): void;
  dismiss(): void;
}
export function useStartRecording(): UseStartRecording;

export function DashboardScreen(): JSX.Element;
```

Task 9 replaces `DashboardScreen`'s single child with the layout choice; Task 13 adds the locked branch.

**Component breakdown**

| Unit | Responsibility | Notes |
|---|---|---|
| `dashboard-screen.tsx` | The `/` host: a `<main data-testid="screen" data-screen="S-04">` region plus the two bottom-bar slots. **In this task it renders the hero unconditionally**; Tasks 9 and 13 add the session and locked branches to the same file | The bars are mounted here because screen-inventory calls S-09 and S-11 *"bottom bar on `/`"*, and S-06 §2's wireframe shows both present (collapsed) on the locked view too. They are `null` slots until Tasks 14 and 17 |
| `idle-hero.tsx` | Greeting + name + one Start pill. Presentation plus the pill's pending/disabled rendering. Knows no commands | Ports `.us-hero`, `.us-hero__greeting` 22 px, `.us-hero__name` 46 px (`--fs-display`), `.us-hero__start` 38/54 px padding pill, ~340×110 px. The greeting is time-derived, ported from `prototype/src/utils/format.ts`'s `greetingFor` — pure, so it is not "context/mock logic" |
| `use-start-recording.ts` | The union above, the 202, the `T-START-CONFIRM` ceiling, and `Problem.code` → refusal mapping. **The only place a start is issued** | `recorder.busy` ultimately resolves to the S-06 locked view (S-06 §12, **C-4**), which does not exist until Task 13. **This task maps it to the ordinary named refusal**, and Task 13 changes that one `case` — a two-line diff a reviewer can see, not a stub. The mock's R-03 already re-broadcasts `recording.state`, so Task 13's branch needs no extra fetch |
| `start-refusal.tsx` | The named reason, in plain language, **inline under the pill — never a tooltip** — plus the role-scoped jump | *"Refusal copy replaces the subtitle, never shrinks the pill."* The jump is rendered **only for `role === 'admin'`** (screen-inventory: *"admin gets a jump to the fixing screen"*), targets `/advanced/device` (not provisioned), `/advanced/storage` (no volume / storage) or `/advanced/local-capture` (invalid channel config), and is ≥44 px |

**States → what renders → which script demonstrates it**

| # | State | Rendering | Demonstrated by |
|---|---|---|---|
| 1 | `idle / ready` | Greeting, name, Start enabled | any script, `/` after sign-in |
| 2 | `starting` | Pill shows pending; **no recording frame yet** (B-12, LP-4) | `happy` → Start (R-01 → R-05 is 1.2 s) |
| 3 | `refused: storage critical` | Start **disabled**, the real policy text from the `Problem`, jump to S-30 for admins | `disk-full` → Start |
| 4 | `refused: recorder busy` | → the S-06 locked view | World strip **Recorder owned by another user**, then Start (R-03, W2-D-11a) |
| 5 | `refused: not provisioned` / `no mounted volume` / `invalid channel config` | The named reason inline; admin jump | `start-fails` → Start (attempt 1, Class A — W2-D-5) |
| 6 | `start failed` | Red card, plain-language cause, **Try Again**; no phantom library row (SM-Q-1) | `start-fails` → Start (attempt 2, Class B) |
| 7 | `recovery pending` | Start held, *"Checking the previous session"*, ceiling `T-BOOT-RECOVERY` | **No producer** — W2-D-8. DevTools request throttling + a Testing Library test with a pending query |
| 8 | `storage warning` | Start **enabled**; the banner is S-03's, not the hero's (HL-10) | World strip **Storage: warning** |
| — | U-1 | Greeting renders instantly from `getMe`; Start disabled until `getRecordingState` resolves | Testing Library, pending query |
| — | U-2 | Start disabled — *"a command cannot be sent, and must not appear sendable"* | `ws-flap`, after 10 s |
| — | U-4 | Pending on the pill, ceiling `T-START-CONFIRM` 5 s | fake-timer test |
| — | U-5 | Every refusal is the named reason beside the control, never a raw code | every refusal row above |

- [ ] **Step 1: Write the failing tests**

`use-start-recording.test.ts` — 8 tests, using a synchronous stub client through `ClientContext` (the `use-login` tests already establish this pattern) and `vi.useFakeTimers()`:

1. `start()` moves `ready` → `starting`.
2. A `recording.state{recording}` event resolves `starting` → `ready` (the hero unmounts; the hook simply stops holding).
3. `T-START-CONFIRM` elapsing with no event yields `failed` with a plain-language message — **not** an indefinite spinner (U-4).
4. A `409 storage.critical` yields `refused` carrying the `Problem`, and `Problem.detail` reaches the rendering (INV-RP-1: the text is data).
5. A `409 config.invalid` yields `refused`.
6. A `409 recorder.busy` yields `refused` with that code (Task 13 re-routes it).
7. A `TransportError` yields `failed`, not `refused` — a transport failure is not a refusal.
8. `start()` is a **no-op while `stale`** — the command is rejected client-side and never queued (state-machines §5.5).

`idle-hero.test.tsx` — 6 tests: ready / starting (pending, pill unmoved) / disabled-with-reason / holding-cold / holding-recovery / offline. Each asserts the pill's bounding role and that the reason is **rendered text, not a `title` attribute**.

`start-refusal.test.tsx` — 4 tests: the three named reasons render their own copy and their own jump target; a lecturer sees **no** jump.

`dashboard-screen.test.tsx` — 2 tests: `/` renders `data-screen="S-04"` when 1a is `idle`; both bottom-bar slots are present in the DOM even while empty (so Tasks 14/17 have somewhere to land and the vertical budget is measurable from the start).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @eduscope/panel test src/screens/dashboard`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Build `use-start-recording.ts`**

The refusal mapping is a `switch` on `Problem.code` and must handle `auth.account-disabled` (A-1) in its exhaustiveness check even though S-04 cannot produce it. Copy for `failed` comes from the `Problem`/`errorMessage`, never a literal — S-03's `RecordingChrome` already renders `session.errorMessage` and this must not disagree with it.

- [ ] **Step 4: Build `idle-hero.tsx` + `start-refusal.tsx` + `dashboard.css`**

Port `.us-hero` from `prototype/src/components/IdleHero.tsx` and `prototype/src/styles/app.css`. **Do not** port `useRecording()`; the pill's `onClick` is `start()` from the hook.

- [ ] **Step 5: Wire the route**

`routes/router.tsx` — add `'S-04': () => <DashboardScreen />` to `SCREEN_ELEMENTS`. The `RouteSpec` row and its `RequireRole` gate are unchanged.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @eduscope/panel test src/screens/dashboard && pnpm lint && pnpm typecheck`
Expected: PASS, 20 tests, lint exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/panel/src/screens/dashboard apps/panel/src/routes/router.tsx && git commit -m "feat(S-04): the dashboard host, the idle hero and every start refusal"
```

---

## Task 8: S-07 — the session transport card

*"The lecturer's confidence instrument"* (LP-4, LP-5). Prototype coverage is **full** (`prototype/src/components/TimerCard.tsx`); pending, stopping, not-owner and seam are new.

**Files:**
- Create: `apps/panel/src/screens/transport/timer-card.tsx`
- Create: `apps/panel/src/screens/transport/use-transport.ts`
- Create: `apps/panel/src/screens/transport/transport.css`
- Test: `timer-card.test.tsx`, `use-transport.test.ts`

**Interfaces:**
- Consumes: `useRecordingSession()`, `useRecordingState()`, `useIsStale()`, `useLastSegment()` (Task 2), `useTicker(1_000)` (`hooks/use-ticker.ts:17`), `useAuth()`, `useClient()`.
- Produces:

```ts
/**
 * S-06 C-5 / S06-D-7: the ONE elapsed computation in the product. The lock
 * card (Task 13) imports this exact function — two screens showing one
 * lecture's duration by two rules is how B-08 happened.
 */
export function elapsedMs(
  session: Pick<RecordingStatePayload, 'state' | 'startedAt' | 'recordedDurationMs'>,
  now: number,
): number;

export type TransportCommand = 'pause' | 'resume' | 'stop';
export interface UseTransport {
  readonly pending: TransportCommand | null;
  readonly failure: string | null;
  readonly canCommand: boolean;   // G-AUTH-OWNER && !stale
  run(command: TransportCommand): void;
}
export function useTransport(): UseTransport;

export function TimerCard(props: { readonly defaultCollapsed?: boolean }): JSX.Element;
```

`elapsedMs` is consumed by Task 13.

**Component breakdown**

| Unit | Responsibility | Notes |
|---|---|---|
| `use-transport.ts` | The three 202s, the `T-CMD-RESOLVE` ceiling per command, `G-AUTH-OWNER`, and the U-2 lockout | *"A stop tapped offline must never fire on reconnect"* — `run()` is a no-op while stale and says so |
| `timer-card.tsx` | Digits, the paused note, the collapse chevron, the two transport buttons, the seam marker | **No confirm dialog on Stop** — S-07's touch note and S06-D-2 both depend on it: *"the lecture must stop in one tap; a second tap in front of a room is the failure mode"* |

**The elapsed rule (C-5, verbatim from two design docs)**

- `recording` → `recordedDurationMs + (now − Date.parse(startedAt))`, ticked locally at 1 Hz. No per-second events (INV-G-7).
- `paused` → **frozen at `recordedDurationMs`**. Pause gaps excluded — the honest figure, and the fix for B-08's `NaN` after restart.
- `startedAt === null` (1a `starting`, before R-05) → the digits are replaced by *"Starting…"*.
- Digits are `--fs-timer` (38 px) `--mono` with `font-variant-numeric: tabular-nums`, wrapped in `aria-live="off"` — a per-second announcement makes a screen reader unusable.

**States → what renders → which script demonstrates it**

| # | State | Rendering | Demonstrated by |
|---|---|---|---|
| 1 | `recording` | Digits tick; Pause + Stop enabled | `happy` → Start |
| 2 | `paused` | Digits frozen at `recordedDurationMs`; *"Recording paused"*; Resume + Stop | `happy` → Pause |
| 3 | `pause pending` / `resume pending` / `stop pending` | U-4 on the pressed button only; `pausing` is deliberately **not** a state (SM-Q-2) | `happy` → each button (250 ms plans) |
| 4 | `starting (resume)` | After R-10, before R-05 confirms | `happy` → Pause → Resume (R-05 at 800 ms) |
| 5 | `stopping / finalizing` | All transport disabled, *"Saving…"* | `happy` → Stop |
| 6 | `not owner` | Transport buttons **hidden**, not disabled (`G-AUTH-OWNER`) | **No live producer** — S06-D-1 replaced this layout with the lock card. Unit-tested |
| 7 | `collapsed` | Digits shrink 38 → 24 px, actions hidden; chevron ≥44 px | tap the chevron |
| 8 | `segment seam` | A subtle continuity marker; *"the lecture is not ended by a dead pipeline"* | `pipeline-crash-midway` → Start, wait for R-16 (`lastSegment.endReason === 'crash'`) |
| — | U-2 | Digits keep ticking from the last known `startedAt`, the card is marked **stale**, transport **disabled** | `ws-flap`, after 10 s |
| — | U-4 / U-5 | Ceiling and named reason on the pressed button | fake-timer test / any refusal |

- [ ] **Step 1: Write the failing tests**

`use-transport.test.ts` — 6 tests: each command issues its own 202 and marks only itself pending; the matching `recording.state` clears it; `T-CMD-RESOLVE` elapsing produces `failure`; `canCommand` is false when `ownerUserId !== me.id` and when stale; `run()` while stale issues **nothing** (assert the client method was not called).

`timer-card.test.tsx` — 9 tests, one per row above plus an `elapsedMs` unit table asserting: a `paused` session ignores wall-clock advance; a `recording` session advances by exactly the ticker delta; `startedAt: null` renders *"Starting…"*; and a `recordedDurationMs: null` renders `00:00:00`, never `NaN` (**the B-08 regression test**).

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @eduscope/panel test src/screens/transport`

- [ ] **Step 3: Build `use-transport.ts` and `elapsedMs`**

- [ ] **Step 4: Build `timer-card.tsx` + `transport.css`**

Port `.us-timercard`, `__digits`, `__pause`, `__stop`, `__chev` from the prototype. Keep the prototype's colour/weight distinction between Pause and Stop.

- [ ] **Step 5: Run the tests** — `pnpm --filter @eduscope/panel test src/screens/transport && pnpm lint`
Expected: PASS, 15 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/screens/transport && git commit -m "feat(S-07): the session transport card and the one elapsed-time rule"
```

---

## Task 9: S-05 — the session composition and the layout choice

S-05 is a **composition**; the states below are the ones the composition itself owns. Its `ai disabled` layout is [approved](../../design/screens/S-05-ai-disabled-design.md) and S05-D-10 is binding: *"S-05 chooses between two layouts; it does not fork into two screens."*

**Files:**
- Create: `apps/panel/src/screens/session/session-layout.tsx`
- Create: `apps/panel/src/screens/session/use-ai-enabled.ts`
- Create: `apps/panel/src/screens/session/session.css`
- Modify: `apps/panel/src/screens/dashboard/dashboard-screen.tsx` (the idle ↔ session branch)
- Test: `use-ai-enabled.test.ts`, `session-layout.test.tsx`, `dashboard-screen.test.tsx` (extend)

**Interfaces:**
- Consumes: `useClient()` + TanStack Query for `getProvisioning`, `useRecordingState()`, `TimerCard` (Task 8).
- Produces:

```ts
/**
 * G-AI-ENABLED = `featureFlags.aiQuizEnabled && llmEndpoint !== null`
 * (state-machines §0.3, S-05 C-1). **Nothing else in the panel may compute
 * this.** `undefined` while the provisioning query is in flight.
 */
export function useAiEnabled(): boolean | undefined;

export function SessionLayout(): JSX.Element;
```

**Layout, from S-05 §3 and the prototype's `App.tsx`**

```
main column 798px            sidebar --sidebar-w 430px
1280 − 36 (--sp-8 × 2) − 430 − 16 gap = 798

  aiEnabled === false  →  <CaptureAssuranceCard/>   (Task 11)
  aiEnabled === true   →  the S-13 slot             (W2-D-9)
  either way           →  sidebar: <TimerCard/>     (Task 8)
                          .us-insightswrap is NOT mounted (S05-D-2, W2-D-9)
```

**States (S-05 §5 owns them; children enumerate their own)**

| # | State | Rendering | Demonstrated by |
|---|---|---|---|
| 1 | `recording` | Full layout, all children live | `happy` → Start |
| 2 | `paused` | Amber chrome from S-03; timer frozen; the *still-streaming* indicator if any channel is `on` (already built, `shell/streaming-while-paused.tsx`) | `happy` → Start → Pause |
| 3 | `ai disabled` | **The AI studio is hidden entirely**; the main column is the Capture Assurance card; `.us-insightswrap` absent | World strip **AI disabled (INT-10 go-live default)** |
| 4 | `ai degraded` | Studio visible in its unavailable state | **Wave 4** (S-13). Not in scope; the S-13 slot renders a marked placeholder (W2-D-9) |
| 5 | `insight column collapsed` | The accordion/insights mutual exclusion | **Wave 3/4** (S-08 + S-16/S-17). The rule is preserved verbatim and has no second participant this wave (S05-D-2) |
| 6 | `stopping / finalizing` | Chrome from S-03; transport disabled | `happy` → Stop |
| — | U-1 | **Does not apply** — this layout is only reached from a live session | asserted by a test that mounting with 1a `idle` renders S-04 instead |
| — | U-2 / U-3 / U-4 / U-5 | Inherited | `ws-flap` |

- [ ] **Step 1: Write the failing tests**

`use-ai-enabled.test.ts` — 4 tests: both flags true → `true`; `aiQuizEnabled: false` → `false`; `llmEndpoint: null` → `false`; query in flight → `undefined` (so the layout does not flicker between two main columns).

`session-layout.test.tsx` — 6 tests: the flag-off branch mounts the capture card and **not** the S-13 slot; the flag-on branch does the reverse; `.us-insightswrap` is in neither; the sidebar is exactly `--sidebar-w`; `TimerCard` is mounted in both; `undefined` renders the sidebar with a main-column skeleton and never a spinner.

`dashboard-screen.test.tsx` — 2 more: 1a `recording` + owner renders `data-screen="S-05"`; 1a `completed` returns to `S-04`.

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @eduscope/panel test src/screens/session src/screens/dashboard`

- [ ] **Step 3: Build `use-ai-enabled.ts`**

One `useQuery({ queryKey: ['provisioning'] })` — the **same key** `shell/use-provisioning.ts` already uses, so this is a cache read, not a second request.

- [ ] **Step 4: Build `session-layout.tsx` + `session.css`, and branch in `dashboard-screen.tsx`**

The S-13 slot is `<div data-screen="S-13" data-wave="4">` with the section's name and nothing else — explicitly marked so a reviewer cannot mistake it for a finished surface, and so Wave 4 replaces exactly one element (W2-D-9).

- [ ] **Step 5: Run the tests** — `pnpm --filter @eduscope/panel test src/screens && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/screens && git commit -m "feat(S-05): the session composition, G-AI-ENABLED and the layout choice"
```

---

## Task 10: S-05 — `use-capture-assurance`, the worst-case fold

*"The fold is a hook, not a component, because §2.3 is the one rule in this screen that can be wrong in a way nobody notices — a verdict that reads 'working' over a stale projection looks perfectly fine in a screenshot."* Pure, exported, and tested without rendering.

**Files:**
- Create: `apps/panel/src/screens/session/use-capture-assurance.ts`
- Test: `apps/panel/src/screens/session/use-capture-assurance.test.ts`

**Interfaces:**
- Consumes: `useWsShallow` over `sources`, `channels`, `storage`, `recording`, plus `useIsStale()`.
- Produces:

```ts
export type VerdictTier = 1 | 2 | 3 | 4;   // assured | checking | attention | problem

export interface CaptureVerdict {
  readonly tier: VerdictTier;
  /** The display name of the thing the sentence is about, or null at tiers 1/2. */
  readonly subject: string | null;
  readonly sentence: string;
  /** Tier 4 only. Always `STILL_RECORDING_SENTENCE` while 1a is non-terminal. */
  readonly reassurance: string | null;
}

/** PURE. Exported separately from the hook so the table-driven test never renders. */
export function foldCaptureVerdict(input: CaptureAssuranceInput): CaptureVerdict;
export function useCaptureAssurance(): CaptureVerdict;

/**
 * S-05 §13's R-SRC-1 assertion, and the second sentence of every tier-4
 * verdict. A constant, not a literal, so the test can assert identity rather
 * than a substring match.
 */
export const STILL_RECORDING_SENTENCE = 'Your lecture is still recording.';

export interface CaptureAssuranceInput {
  readonly sources: Partial<Record<SourceRoleId, SourcesStatusPayload>>;
  readonly channels: Partial<Record<string, ChannelStatePayload>>;
  readonly pressure: StorageStatusPayload['pressure'] | null;
  readonly recording: RecordingStatePayload['state'] | 'idle';
  readonly stale: boolean;
  /** U-1: no snapshot has arrived yet, so the fold cannot claim tier 1. */
  readonly cold: boolean;
}
```

`STILL_RECORDING_SENTENCE` lives here rather than in a copy module because the fold is the only thing that decides whether it applies, and Global Constraints names this file as its home.

**The ranking (S-05 §2.3, binding, and `unknown` outranking `online` is the load-bearing part)**

| Tier | Any input in this state | Sentence | Chrome |
|---|---|---|---|
| **4 · problem** | 5a `offline` (HL-03/HL-06) · 1c `failed` (CH-06) · 5b `critical` (HL-12) | Names the thing, then **`STILL_RECORDING_SENTENCE`** | `--danger`, `--danger-soft` |
| **3 · attention** | 5a `degraded` (HL-04) · 1c `restarting` (CH-09) · 5b `warning` (HL-10) | Names the thing | `--warning` |
| **2 · checking** | 5a `unknown` (HL-08) · U-1 cold · U-2 after `T-WS-STALE` | *"Checking the room…"* | `--text-muted`, **no colour claim** |
| **1 · assured** | every enabled role `online`, every enabled channel `on`/`recording`, 5b `ok` | *"Everything this lecture needs is working"* | `--success` dot only |

Two overrides on top of the fold:

- **`mic-lecturer` at `offline` always wins ties** — §6.2 ranks it critical: *"a silent lecture is bad, so this is impossible to miss."* Its sentence is *"The microphone has no signal — this lecture is recording silence."*
- **1a `paused` and `stopping`/`finalizing`** replace the sentence entirely (*"Paused — nothing is being recorded right now."* / *"Saving your lecture…"*) without changing the tier's chrome rules.
- `unbound` roles are **not inputs** (HL-01 — they are not rendered at all).

- [ ] **Step 1: Write the failing test**

`use-capture-assurance.test.ts` — table-driven over the **cross-product** of 5a × 1c × 5b, exactly as S-05 §13 requires:

```ts
const ROLE_STATES = ['online', 'degraded', 'offline', 'unknown'] as const;
const CHANNEL_STATES = ['on', 'starting', 'restarting', 'failed', 'off'] as const;
const PRESSURES = ['ok', 'warning', 'critical'] as const;

describe('the fold is never greener than its worst input (S05-D-3)', () => {
  for (const role of ROLE_STATES)
    for (const channel of CHANNEL_STATES)
      for (const pressure of PRESSURES)
        it(`role=${role} channel=${channel} pressure=${pressure}`, () => {
          const verdict = foldCaptureVerdict(build({ role, channel, pressure }));
          expect(verdict.tier).toBe(expectedTier(role, channel, pressure));
        });
});

it('ranks unknown ABOVE online: one stale role with everything else healthy is tier 2', () => {
  const verdict = foldCaptureVerdict(build({ role: 'unknown', channel: 'on', pressure: 'ok' }));
  expect(verdict.tier).toBe(2);
  expect(verdict.sentence).toBe('Checking the room…');
});

it('a dead mic always wins the tie', () => {
  const verdict = foldCaptureVerdict(
    build({ role: 'offline', channel: 'failed', pressure: 'critical', micOffline: true }),
  );
  expect(verdict.sentence).toContain('recording silence');
});

it('every tier-4 verdict carries the R-SRC-1 sentence while 1a is non-terminal', () => {
  for (const role of ROLE_STATES)
    for (const channel of CHANNEL_STATES)
      for (const pressure of PRESSURES) {
        const v = foldCaptureVerdict(build({ role, channel, pressure, recording: 'recording' }));
        if (v.tier === 4) expect(v.reassurance).toBe(STILL_RECORDING_SENTENCE);
      }
});
```

`expectedTier` is written independently of the implementation (a plain `max` over three lookup tables) so the test is not a restatement of the code.

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @eduscope/panel test use-capture-assurance`

- [ ] **Step 3: Implement `foldCaptureVerdict` and the hook**

The hook reads through `useWsShallow` (a multi-field read — never a bare `useWsStore(s => ({…}))`). Every sentence is a module constant from the S-05 §6 copy deck, **not** a template assembled at the call site.

- [ ] **Step 4: Run the tests** — `pnpm --filter @eduscope/panel test use-capture-assurance`
Expected: PASS, 63 table rows + 4 named tests.

- [ ] **Step 5: Commit**

```bash
git add apps/panel/src/screens/session && git commit -m "feat(S-05): the capture-assurance fold, and unknown outranking online"
```

---

## Task 11: S-05 — the Capture Assurance card

The main column for the layout INT-10 makes the go-live default. *"It answers the only question a lecturer with no AI studio has — is this lecture being captured, and is it safe? — as a verdict followed by the evidence behind it."*

**Files:**
- Create: `apps/panel/src/screens/session/capture-assurance-card.tsx`
- Create: `apps/panel/src/screens/session/capture-verdict.tsx`
- Create: `apps/panel/src/screens/session/capture-sources-row.tsx`
- Create: `apps/panel/src/screens/session/capture-outputs-row.tsx`
- Create: `apps/panel/src/screens/session/capture-disk-row.tsx`
- Modify: `apps/panel/src/screens/session/session.css`, `session-layout.tsx`
- Test: one `.test.tsx` per file above

**Interfaces:**
- Consumes: `useCaptureAssurance()` (Task 10), `useWsShallow` for `sources`/`channels`/`storage`, `listChannels` + `listLayoutPresets` + `getStorageOverview` via TanStack Query, `useOverlays()` for the S-10 tap (Task 16 supplies the lightbox; until then the tap opens nothing and a test asserts the handler exists).
- Produces: `CaptureAssuranceCard`, mounted by `SessionLayout` when `useAiEnabled() === false`.

**Component breakdown (S-05 §4, binding)**

| Unit | Responsibility | Must not |
|---|---|---|
| `capture-assurance-card.tsx` | Composition + the §2.2 **density switch** only. Owns no data | Fetch anything |
| `capture-verdict.tsx` | The tier's chrome and sentence(s). Holds **no logic** | Re-derive the tier |
| `capture-sources-row.tsx` | Three tiles in the **fixed** role order `presentation`, `lecturer-cam`, `students-cam`, each opening S-10. `unbound` roles are not rendered (HL-01) | Reorder under stress — *"the failing tile keeps its position; a moving tile is a second problem"* |
| `capture-outputs-row.tsx` | One row per channel from `listChannels`, preset name resolved through `listLayoutPresets`. `local` is always present | Be interactive — the rows carry no target and open nothing |
| `capture-disk-row.tsx` | Free/total bytes and the sentence **generated** from `RetentionPolicy` | Hardcode the sentence (INV-RP-1, B-53) or show an hours estimate (S05-D-6, CG-18) |

**Density (S-05 §2.1 / §2.2)** — the switch is on the **main column's measured height**, not a media query:

| | comfortable (≥ 480 px) | dense (< 480 px, floor **388**) |
|---|---|---|
| Verdict | `--fs-2xl`/800, two lines | `--fs-xl`/800, one line, **wraps rather than truncates** |
| Tiles | 248 × 140, caption **outside** the image (44 px strip) | 152 × 86 (`--srctile-w`), label returns to the overlay |
| Disk | label + bar + two lines | one line, bar dropped — **the free figure and the policy sentence both survive** |
| `SAVING TO` | 56 px rows | 44 px rows — **never condenses away** |

**Condensation, never omission (S05-D-9):** every fact present at 602 px is present at 388 px. A test asserts the dense rendering contains the same set of facts as the comfortable one.

**States → demonstrated by**

| # | State | Demonstrated by |
|---|---|---|
| 1 | `assured` | World strip **AI disabled**, `happy` → Start |
| 2 | `attention` | World strip **AI disabled** + **Storage: warning**; or `pipeline-crash-midway` at ~5 s (`lecturer-cam` degraded) |
| 3 | `problem` | `pipeline-crash-midway` at ~12 s (`lecturer-cam` offline) — two sentences, the second being **C-5** |
| 4 | `problem (mic)` | `pipeline-crash-midway` at ~20 s — *"recording silence"*, and it wins the tie |
| 5 | `checking` | `ws-flap` at ~5 s — HL-08 with the socket still **open** |
| 6 | `paused` | `happy` → Start → Pause |
| 7 | `stopping / finalizing` | `happy` → Stop — the card freezes and tiles stop being tappable |
| — | U-1 | Skeleton **in the card's own shape**: four blocks, verdict at tier 2 |
| — | U-2 | `ws-flap` after 10 s — the verdict **degrades to tier 2**, it does not hold tier 1 |
| — | U-3 | `ws-flap` reconnect — must not flash populated→skeleton→populated for unchanged rows |
| — | U-4 / U-5 | **Do not apply** — the card issues no command. A test asserts the card contains **zero** `button` roles other than the three tiles |

- [ ] **Step 1: Write the failing tests**

Ten rendering tests (one per row above), plus the four S-05 §13 raises:

1. **Generated policy text** — change `RetentionPolicy.maxAgeDays` in the mock and assert the rendered sentence changes (INV-RP-1, B-53).
2. **Bytes, never hours** — assert the disk row contains no `/\d+\s*h/` match.
3. **Condensation, never omission** — render at 602 and at 388 and assert the same fact set.
4. **Tiles are not tappable when `offline` or `unknown`** — `aria-disabled`, and the health word is the accessible name.

Accessibility assertions that are part of the floor: the verdict block is the **only** `aria-live` region on the card (`polite`, never `assertive` — *"the lecture is still recording, so this is urgent information, not an interruption of the room"*); every tier changes the **sentence** and every tile state changes its **word**, so a greyscale render keeps all seven states distinguishable.

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @eduscope/panel test src/screens/session`

- [ ] **Step 3: Build the five components bottom-up**

`capture-verdict` → `capture-sources-row` → `capture-outputs-row` → `capture-disk-row` → `capture-assurance-card`, running that file's tests green before the next.

- [ ] **Step 4: Style, and mount it**

`session.css`: the card is `--surface` — **light, not ink** (S05-D-5: the ink scope *means* the AI/insights family, and a room without the AI stack correctly shows no ink below the header). Tiles are `--radius-sm`, 1 px `--border`, `aspect-ratio: 16/9`, identical to `.us-srctile`. No animation at all (§8).

- [ ] **Step 5: Run the tests** — `pnpm --filter @eduscope/panel test src/screens/session && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/screens/session && git commit -m "feat(S-05): the Capture Assurance card, its four blocks and both densities"
```

---

## Task 12: S-06 — `use-recorder-lock`, the authority verdict

*"The one function the screen exists to get right, and it is pure — there is no excuse for testing it through the DOM"* (S-06 §13). Built and tested before anything renders it.

**Files:**
- Create: `apps/panel/src/screens/dashboard/use-recorder-lock.ts`
- Test: `apps/panel/src/screens/dashboard/use-recorder-lock.test.ts`

**Interfaces:**
- Consumes: `useRecordingSession()` (`selectors.ts:20`), `useAuth()` (`auth/auth-context.tsx:34`).
- Produces:

```ts
/** Machine 1a non-terminal = starting | recording | paused | stopping | finalizing. */
export type RecorderLock =
  | { readonly kind: 'idle' }
  /** ownerUserId === me.id, takeoverBy null — S-05 renders, on any client (LP-6). */
  | { readonly kind: 'owned' }
  /** Another owner. `canTakeOver` is G-ADMIN — a lecturer can NEVER take over (C-2). */
  | {
      readonly kind: 'locked';
      readonly ownerDisplayName: string | null;
      readonly title: string | null;
      readonly startedAt: string | null;
      readonly recordedDurationMs: number | null;
      readonly phase: 'starting' | 'live' | 'ending';
      readonly canTakeOver: boolean;
      /** §5 state 9 — a third party already took it over. No action for anyone. */
      readonly takenOverByDisplayName: string | null;
    }
  /** takeoverBy === me.id — the layout becomes S-05 plus an attribution strip. */
  | { readonly kind: 'takenOver'; readonly priorOwnerDisplayName: string | null; readonly at: string | null }
  /** ownerUserId === me.id but takeoverBy is someone else — §5 state 7. */
  | { readonly kind: 'displaced'; readonly byDisplayName: string | null; readonly at: string | null };

export function useRecorderLock(): RecorderLock;
export function foldRecorderLock(
  session: RecordingStatePayload | null,
  me: Pick<User, 'id' | 'role'> | null,
): RecorderLock;
```

Tasks 13 (the card), 9 (the dashboard branch), 15 and 17 (the CG-15 disabled mic) and 18 (S-12's blocked entry row) all consume it.

**The rules it encodes — all four are constraints, not choices (S-06 §1)**

- **C-1** Takeover transfers **authority, not attribution**. `ownerUserId` is never rewritten, so `takenOver` still carries the prior owner's name.
- **C-2** A lecturer can **never** take over: `canTakeOver` is `me.role === 'admin'`, never `G-AUTH-OWNER`.
- **C-4** The verdict reads the **snapshot**, not R-03's refusal meta.
- **S06-D-2** `locked (admin)` offers **Take over only — no Stop**. The union carries no `canStop`, deliberately.
- `phase: 'ending'` (1a `stopping`/`finalizing`) withdraws the action slot: *"R-21 would still be accepted; there is no authority left worth transferring"* (§5 state 2b).
- `phase: 'starting'` with `startedAt === null` replaces the digits with *"Starting…"* (§5 state 2c).

- [ ] **Step 1: Write the failing test**

`use-recorder-lock.test.ts` — the **exhaustive authority table** S-06 §13 demands, over the cross-product of

- viewer ∈ `{owner, other-lecturer, admin, admin-who-took-over}`
- 1a ∈ `{idle, starting, recording, paused, stopping, finalizing, completed, error}`
- `takeoverBy` ∈ `{null, me, other}`

= 96 rows, each asserting `kind`, and `canTakeOver` wherever `kind === 'locked'`. Plus four named tests:

1. `foldRecorderLock(null, me)` → `idle`.
2. A **terminal** 1a state is always `idle` regardless of `takeoverBy` (§5 state 11 — the card unmounts and `/` returns to S-04).
3. An `other-lecturer` viewer **never** gets `canTakeOver: true`, in any of the 24 combinations (**C-2**).
4. `takenOver` still names the **prior** owner and never `me` (**C-1** — this is the misreading the entire copy deck is written against).

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @eduscope/panel test use-recorder-lock`

- [ ] **Step 3: Implement `foldRecorderLock` and the hook**

No JSX in this file. The hook is three lines over the fold.

- [ ] **Step 4: Run the tests** — `pnpm --filter @eduscope/panel test use-recorder-lock`
Expected: PASS, 100 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/panel/src/screens/dashboard && git commit -m "feat(S-06): the recorder-lock authority verdict, exhaustively tested"
```

---

## Task 13: S-06 — the lock card, the takeover confirm and both attribution strips

*"What user B sees when the device is already recording for user A, and how an admin takes over."* Mutual exclusion is **server-enforced** (LP-6, B-15 — *"the legacy UI enforced it, which is to say it didn't"*).

**Files:**
- Create: `apps/panel/src/screens/dashboard/lock-card.tsx`
- Create: `apps/panel/src/screens/dashboard/takeover-confirm.tsx`
- Create: `apps/panel/src/screens/dashboard/takeover-notice.tsx`
- Modify: `apps/panel/src/screens/dashboard/dashboard-screen.tsx` (the locked branch)
- Modify: `apps/panel/src/screens/dashboard/use-start-recording.ts` (route `recorder.busy` to the lock view — the one branch Task 7 flagged)
- Modify: `apps/panel/src/screens/dashboard/dashboard.css`
- Create: `apps/panel/src/auth/session.ts` — **add** `TAKEOVER_REVOKED_SENTENCE` beside the existing revocation vocabulary
- Test: `lock-card.test.tsx`, `takeover-confirm.test.tsx`, `takeover-notice.test.tsx`, `dashboard-screen.test.tsx` (extend)

**Interfaces:**
- Consumes: `useRecorderLock()` (Task 12), `elapsedMs` (Task 8 — **C-5/S06-D-7: the exact same computation, imported, not reimplemented**), `DangerButton` / `DangerConfirm` (Task 6), `useOverlays()`, `useClient().takeoverRecording`, `useTicker(1_000)`.
- Produces: `LockCard`, `TakeoverConfirm`, `TakeoverNotice`; and `TAKEOVER_REVOKED_SENTENCE = 'An administrator took over this recording.'` exported from `auth/session.ts` so S-01 and S-06 cannot drift (§5.2).

**Geometry (S-06 §2, binding)** — the card is **560 px**, centred in the 602 px main region, occupying **S-04's hero slot**:

| Element | Token | px |
|---|---|---|
| card padding | `--sp-10` × 2 | 48 |
| eyebrow | `--fs-2xs`/700/caps/`--tracking-caps` | 17 |
| owner name | `--fs-3xl`/800/`--tracking-tight` | 29 |
| session title | `--fs-lg`/600, `--text-muted` | 25 |
| elapsed | `--fs-timer` `--mono`/700 | 46 |
| started caption | `--fs-xs`, `--text-faint` | 19 |
| note, 2 lines | `--fs-sm`, `--text-muted` | 42 |
| **lecturer subtotal** | | **270** |
| + rule (`--sp-9` · 1 px · `--sp-9`) + Take over 56 | | **367 admin** |

Owner at 24 px and elapsed at 38 px are both above the ≥21 px across-the-room floor; the session title is deliberately below it (§2.2). **The S-03 chrome stays red** — hiding the frame from a non-owner would be the same class of lie U-2 refuses to tell.

**Component breakdown (S-06 §4)**

| Unit | Responsibility | Must not |
|---|---|---|
| `lock-card.tsx` | Eyebrow, owner, title, elapsed, note, and an optional **action slot**. Presentation only | Know about takeover or roles — it is deliberately role-blind and takeover-blind |
| `takeover-confirm.tsx` | The confirm copy, the 202, and its resolution on `recording.state{takeoverBy}` | Reimplement the dialog; it is a `DangerConfirm` instance |
| `takeover-notice.tsx` | The two persistent attribution strips (§5 states 6 and 7) | Be dismissible — state 7's notice is explicitly **non-dismissible** |

**States → what renders → which script demonstrates it**

| # | State | Rendering | Demonstrated by |
|---|---|---|---|
| 1 | `locked (lecturer)` | Card, **no action slot**; the note names the remedy (**C-2**) | World strip **Recorder owned by another user**, signed in as `n.silva`… (see the note below) |
| 2 | `locked (admin)` | Card + **Take over** (`danger-quiet`). **No Stop** (S06-D-2) | Same, signed in as `admin` |
| 2b | `locked (admin, session ending)` | Action slot **withdrawn**, caption *"Saving…"* | Same, then dev-overlay **Stop** |
| 2c | `locked (starting)` | Digits replaced by *"Starting…"* | Testing Library (`startedAt: null`); no live producer — the seed enters at `recording` |
| 3 | `takeover confirm` | `DangerConfirm`, `dismissible: false` | tap **Take over** |
| 4 | `takeover pending` | DGR-D-4 `pending`; resolves on `recording.state{takeoverBy}` | the same tap (R-21 fires at 300 ms) |
| 5 | `takeover refused` (409) | Message slot, destructive button **replaced by Close** | Open the confirm, dev-overlay **Stop**, then confirm (W2-D-11b) |
| 5 | `takeover refused` (403) | Same treatment, different copy | Testing Library — no live producer (the role cannot change under the mock) |
| 6 | `taken over (new owner)` | Layout becomes **S-05**; a persistent strip states whose lecture it still is (**C-1**) | after a successful takeover |
| 7 | `taken over (displaced owner, still signed in)` | S-05 **collapses back** to this card + a non-dismissible notice | two panels, or the Playwright two-context spec (Task 22) |
| 8 | `taken over (displaced, session revoked)` | **Not rendered here** — `use-session-revocation.ts` routes to S-01 | `auth-failures` (already Wave 1) |
| 9 | `taken over (third party)` | Card + *"Taken over by R. Fernando."*; no action for anyone | Testing Library |
| 10 | `owner's own session` | **S-06 never renders** — S-05 does | `happy` → Start |
| 11 | `session ended while locked` | Card unmounts; `/` returns to **S-04** | dev-overlay **Stop** |
| — | U-1 | Card **skeleton in its own shape** — never a full-screen spinner | pending-query test |
| — | U-2 | Digits keep ticking; the card is marked stale; **Take over disabled** | `ws-flap` |

> **Sign-in note.** The seeded live session is owned by `a.perera`, so *any other* seeded account produces the locked view: `n.silva` (after their forced reset) for state 1, `admin` / `battery-staple` for state 2.

**Copy (S-06 §6, verbatim — every string below is fixed)**

| Where | Copy |
|---|---|
| Eyebrow, `recording` / `paused` / `stopping`,`finalizing` | **RECORDING IN PROGRESS** / **RECORDING PAUSED** / **SAVING** |
| Elapsed caption | started *12:45* |
| Note — locked (lecturer) | Only *A. Perera* or an administrator can stop this recording. |
| Note — locked (admin) | You can take over this recording. It keeps recording either way. |
| Note — locked (admin, ending) | This lecture is being saved. |
| Line — third party | Taken over by *R. Fernando*. |
| Confirm title | **Take over this recording?** |
| Confirm body | *A. Perera* is recording *CS2043 — Lecture 7*. Taking over ends their control of this panel. The lecture keeps recording, and it is still saved as **their** recording. |
| Confirm body, 2nd line | This is recorded against your name. |
| Confirm buttons | Cancel · **Take over** |
| refused 403 / 409 | You are no longer an administrator on this device. / That lecture has already ended. |
| Strip — new owner | You took over this recording from *A. Perera* at *14:12*. It is still saved as their lecture. |
| Notice — displaced | **An administrator took over this recording.** *R. Fernando* took over at *14:12*. You can no longer pause or stop this lecture. |
| U-2 marker | Not connected — this may be out of date. |

*"It keeps recording either way"* is **load-bearing, not reassurance**: the single most likely misreading of a button called Take over on a screen showing a live lecture is that it interrupts the lecture. R-21's *To* column says `unchanged`; the copy says so too.

- [ ] **Step 1: Write the failing tests**

Thirteen rendering tests — one per row of §5 — plus the three S-06 §13 raises:

1. **Copy identity** — the displaced notice's first sentence is **byte-identical** to `TAKEOVER_REVOKED_SENTENCE`, and S-01's `reason: takeover` rendering uses the same constant. §5.2 is only true if it cannot drift.
2. **No attribution rewrite** — after a successful takeover, `ownerUserId` is unchanged and the new-owner strip still names the **prior** owner (**C-1**).
3. **One elapsed rule** — `LockCard` and `TimerCard` fed the identical session render the identical digit string (**C-5/S06-D-7**; this is the second consumer that proves the rule is shared).

Plus the four `DangerConfirm` states re-asserted in this instance's context (Task 6 tested the component; this tests the wiring).

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @eduscope/panel test src/screens/dashboard`

- [ ] **Step 3: Build `lock-card.tsx`, then `takeover-notice.tsx`, then `takeover-confirm.tsx`**

`lock-card` first because it is presentation-only and the other two depend on its action slot.

- [ ] **Step 4: Branch the dashboard, and re-route `recorder.busy`**

`dashboard-screen.tsx` gains the `locked` / `displaced` branches. `use-start-recording.ts`'s `recorder.busy` case stops rendering a named refusal and instead lets the (already-updated) snapshot drive the locked branch — **C-4**: *"the refusal is the race, the snapshot is the common case."* Because the mock's R-03 re-broadcasts `recording.state`, no extra fetch is needed.

- [ ] **Step 5: Run the tests** — `pnpm --filter @eduscope/panel test src/screens/dashboard src/auth && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/screens/dashboard apps/panel/src/auth && git commit -m "feat(S-06): the lock card, the takeover confirm and both attribution strips"
```

---

## Task 14: S-09 — the sources bar and the role tiles

*"The fixed semantic trio `pc / cam1 / cam2` with per-tile presence/health"* (LP-8, HL-01…HL-08). Prototype coverage is **full for the frame**; degraded/offline/unknown/unbound are new.

**Files:**
- Create: `apps/panel/src/screens/sources/sources-bar.tsx`
- Create: `apps/panel/src/screens/sources/source-tile.tsx`
- Create: `apps/panel/src/screens/sources/sources.css`
- Modify: `apps/panel/src/screens/dashboard/dashboard-screen.tsx` (mount the bar in its slot)
- Test: `sources-bar.test.tsx`, `source-tile.test.tsx`

**Interfaces:**
- Consumes: `useWsShallow((s) => s.sources)`, `listSourceRoles` + `getSourcesStatus` via TanStack Query, `useOverlays()`, `useRecorderLock()`.
- Produces:

```ts
export const VIDEO_ROLE_ORDER = ['presentation', 'lecturer-cam', 'students-cam'] as const;
export function SourcesBar(): JSX.Element;
export function SourceTile(props: {
  readonly roleId: SourceRoleId;
  readonly displayLabel: string;
  readonly status: SourcesStatusPayload | undefined;
  readonly onOpen: (roleId: SourceRoleId) => void;
}): JSX.Element | null;
```

Task 16 supplies `onOpen`'s destination.

**States → what renders → which script demonstrates it**

| # | State | Rendering | Demonstrated by |
|---|---|---|---|
| 1 | `online` | Live tile, green dot, **tappable** → S-10 | any script |
| 2 | `degraded` | Amber ring + *"reconnecting…"*; preview may stutter | `pipeline-crash-midway` at ~5 s |
| 3 | `offline` | Grey tile, *"No signal"*, **not tappable** | `pipeline-crash-midway` at ~12 s |
| 4 | `unknown` | Grey tile, *"checking…"* — **never the last healthy value** (INV-DH-2, B-12) | `ws-flap` at ~5 s |
| 5 | `unbound` | Tile **not rendered at all** (only Admin shows it as "not installed") | `mic-room` is permanently here — asserted by a test that the bar renders exactly three video tiles |
| 6 | bar collapsed | Three `.us-panelbar__dots` coloured by the same states | default |
| — | U-1 | Tiles render as `unknown`, **not** as empty boxes | pending-query test |
| — | U-2 | Tiles dimmed; taps disabled | `ws-flap` after 10 s |

**Touch/kiosk notes (binding)** — tiles are `--srctile-w` (152 px) and are **the tap target themselves**, no separate expand icon. The collapsed bar head is `--panelbar-head-h` (54 px). The expanded bar is **154 px** (the number S-05's floor arithmetic uses); a test asserts it.

- [ ] **Step 1: Write the failing tests**

Eight rendering tests (one per row) plus:
- the bar's expanded height is ≤ 154 px at 1280 wide;
- an `offline` tile is `aria-disabled` and its accessible name is the **health word**, not "Expand";
- the three video roles render in `VIDEO_ROLE_ORDER` regardless of the order `getSourcesStatus` returns them.

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @eduscope/panel test src/screens/sources`

- [ ] **Step 3: Build `source-tile.tsx`, then `sources-bar.tsx`, then `sources.css`**

Port `.us-panelbar`, `.us-panelbar__head`, `.us-panelbar__dots`, `.us-srctile`, `.us-srctile__label`, `.us-srctile__live` from the prototype. The `SourceFeed` mock silhouette is **not** ported — a tile with no live preview renders the token-based placeholder that the design docs' `offline`/`unknown` fills already describe, and a live tile renders the last preview frame only once Task 16 exists (until then, the `online` fill).

- [ ] **Step 4: Mount it** in `dashboard-screen.tsx`'s sources slot.

- [ ] **Step 5: Run the tests** — `pnpm --filter @eduscope/panel test src/screens && pnpm lint`

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/screens && git commit -m "feat(S-09): the sources bar and the five role-tile states"
```

---

## Task 15: S-09 — the mic row: the live meter, the gain steppers and the applied truth

*"This is where legacy's placebo gain sliders (B-55) become real controls."*

**Files:**
- Create: `apps/panel/src/audio/use-audio-control.ts` (**W2-D-10 — shared with S-11**)
- Create: `apps/panel/src/screens/sources/mic-row.tsx`
- Create: `apps/panel/src/screens/sources/level-meter.tsx`
- Modify: `apps/panel/src/screens/sources/sources-bar.tsx`, `sources.css`
- Test: `use-audio-control.test.ts`, `mic-row.test.tsx`, `level-meter.test.tsx`

**Interfaces:**
- Consumes: `useAudioControlRow('mic-lecturer')` (Task 2), `useSourceStatus('mic-lecturer')`, `useTelemetryStore` (imperatively), `useRecorderLock()` (for the CG-15 guard), `useClient().updateAudioControl`.
- Produces:

```ts
export type AudioApplyState = 'live' | 'muted' | 'pending' | 'apply-failed' | 'offline' | 'locked';

export interface UseAudioControl {
  readonly control: AudioControlPayload | undefined;
  readonly state: AudioApplyState;
  /** CG-15: non-null when a non-owner is looking at a live session. */
  readonly disabledReason: string | null;
  setMuted(muted: boolean): void;
  setGain(gain: number): void;
}
/** THE mic mutation. S-09 and S-11 both call this — never a second copy. */
export function useAudioControl(roleId: SourceRoleId): UseAudioControl;

export function LevelMeter(props: { readonly roleId: SourceRoleId; readonly segments?: number }): JSX.Element;
```

**The two rules this row exists to enforce**

- **INV-AC-1 (the anti-placebo rule).** The panel shows *the actual applied state and the failure*, **never the requested value**. `pending` does **not** move the switch; `apply failed` shows the applied state with `lastError` beneath it. *"An optimistic flip followed by a revert is how a lecturer learns that the switch is a suggestion"* — and on a mute it means believing you are off-mic while the hall can hear you.
- **CG-15 / S06-D-5.** While a session is non-terminal and the viewer is neither owner nor admin, the control is disabled **with the reason inline** — the guard landed in v0.3, so this is honest rather than B-15 repeated.

**Telemetry (frontend-conventions §1).** `LevelMeter` subscribes to `useTelemetryStore` imperatively and writes `--level` on its own element. It renders **20 segments** (the prototype's `SEGMENTS`) driven entirely by CSS from that one custom property. A test asserts the component's render count does not increase across 30 telemetry ticks.

**States → demonstrated by**

| # | State | Demonstrated by |
|---|---|---|
| 1 | `live` — meter animating from `audio.levels` | any script |
| 2 | `muted` | tap the switch |
| 3 | `gain pending` (U-4) | tap ±; the 202 resolves on the next `audio.control` |
| 4 | `apply failed` | World strip **Mic changes fail to apply**, then tap the switch |
| 5 | `mic offline` — ranked **critical** (§6.2) | `pipeline-crash-midway` at ~20 s |
| 6 | `locked` (CG-15) | World strip **Recorder owned by another user**, signed in as `n.silva` |
| — | U-1 / U-2 / U-5 | pending query / `ws-flap` / any refusal |

**Touch notes.** Steppers are **±5 %**, each ≥44 px with **8 px separation** — *"a lecturer nudging gain mid-sentence must not hit the wrong one."*

- [ ] **Step 1: Write the failing tests**

`use-audio-control.test.ts` — 7 tests: each of the six states derives correctly from `{control, sourceStatus, lock, stale}`; and `setMuted` is a **no-op** when `disabledReason` is set (assert the client method was not called).

`mic-row.test.tsx` — 6 rendering tests, plus the S-11 §13 raise applied here:

> **`apply failed` shows applied truth** — a `muted: true` request that resolves as `appliedState: 'failed'` leaves the switch reading **Live** and renders the failure line. *"INV-AC-1 is only real if this exists."*

`level-meter.test.tsx` — 3 tests: 20 segments; `--level` updates on a telemetry tick; **render count unchanged** across 30 ticks.

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @eduscope/panel test src/audio src/screens/sources`

- [ ] **Step 3: Build `use-audio-control.ts`, `level-meter.tsx`, `mic-row.tsx`**

Port `.us-srcmic`, `__meter`, `__seg`, `__pct`, `.us-stepper` from the prototype. **Do not** port `useMicLevels`.

- [ ] **Step 4: Run the tests** — `pnpm --filter @eduscope/panel test src/audio src/screens && pnpm lint && pnpm gate`
Expected: PASS; `pnpm gate` still **5 passed** — Gate 1e (*"10 s of telemetry does not turn into renders"*) is the standing proof that the meter is imperative.

- [ ] **Step 5: Commit**

```bash
git add apps/panel/src/audio apps/panel/src/screens/sources && git commit -m "feat(S-09): the mic row, the imperative level meter and the applied-truth rule"
```

---

## Task 16: S-10 — the source preview lightbox (mock transport)

*"Full-motion preview of one source, visible < 1 s from tap"* (LP-8, INT-8, A-17). Replaces legacy's JPEG-over-socket previews and their global `killall` (B-18, B-06). Wave 2 builds the **mock transport**; Wave 8 replaces it with real WebRTC.

**Files:**
- Create: `apps/panel/src/screens/sources/preview-lightbox.tsx`
- Create: `apps/panel/src/screens/sources/use-preview.ts`
- Modify: `apps/panel/src/screens/sources/sources-bar.tsx` (the tap), `capture-sources-row.tsx` (the same tap), `sources.css`
- Test: `use-preview.test.ts`, `preview-lightbox.test.tsx`

**Interfaces:**
- Consumes: `useClient().openPreview()` → `PreviewChannel`, `isMockPreviewFrame` (`@eduscope/api-client/mock` — **mock-adapter-only**, so it is imported through a narrow helper that returns a plain frame string against a real client), `useOverlays()`.
- Produces:

```ts
/** events.md §3's four server error codes, verbatim. Not a shared export — the contract declares them inline on `PreviewServerMessage`. */
export type PreviewErrorCode = 'source-offline' | 'source-unbound' | 'busy' | 'internal';

export type PreviewState =
  | { readonly kind: 'negotiating' }
  | { readonly kind: 'live'; readonly frame: string }
  | { readonly kind: 'failed'; readonly code: PreviewErrorCode; readonly message: string }
  | { readonly kind: 'closed'; readonly reason: 'user' | 'disconnected' };

export function usePreview(roleId: SourceRoleId): { readonly state: PreviewState; close(): void };
export function PreviewLightbox(props: { readonly roleId: SourceRoleId; readonly label: string }): JSX.Element;
```

**Transport rules (events.md §3, binding)**

- A **separate socket** from the event stream. `negotiationId` is **client-minted per lightbox open**; **≤ 1 active negotiation per panel connection**.
- Teardown sends `close`. **Preview death never affects recording** — the thumbnails consumer is its own consumer.
- Losing *either* socket closes the lightbox **with a stated reason** (U-2).
- `Modal` semantics come from `OverlayHost`, which portals into `.us-panel`, never `position: fixed` — so the lightbox renders light even when opened from a dark scope.

**States → demonstrated by**

| # | State | Rendering | Demonstrated by |
|---|---|---|---|
| 1 | `negotiating` | A skeleton **holding the frame's shape**; budget < 1 s (the mock answers at 300 ms) | tap any online tile |
| 2 | `live` | Frames painting + a **LIVE** chip | the same tap, after the answer |
| 3 | `negotiation failed` · `source-offline` | Its own copy | `pipeline-crash-midway` after ~12 s, tap `lecturer-cam` |
| 3 | · `source-unbound` / `busy` / `internal` | Their own copy | **No live producer** — see the known-limitations list. Unit-tested |
| 4 | `source went offline mid-preview` | The server drops **unilaterally**; the lightbox shows why rather than freezing on the last frame | `pipeline-crash-midway`: open `lecturer-cam` at ~8 s and hold through 12 s (W2-D-11c) |
| 5 | `closed` | Teardown sends `close`; **recording is untouched** | tap ✕ or the scrim |
| — | U-2 / U-5 | The lightbox closes with a stated reason | `ws-flap` |

**Touch notes.** Close target ≥44 px in a predictable corner; tapping the scrim also closes. No pinch-zoom expectations — this is a fixed-size preview.

- [ ] **Step 1: Write the failing tests**

`use-preview.test.ts` — 7 tests: mints a fresh `negotiationId` per open; sends exactly one `offer`; transitions `negotiating` → `live` on `answer`; maps each of the four error codes to its own state; sends `close` on unmount; and — **the B-06 regression test** — closing the preview issues **no** recording command and leaves `recording.state` untouched.

`preview-lightbox.test.tsx` — 6 rendering tests (one per row) + a test that the ✕ is ≥44 px and labelled.

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @eduscope/panel test src/screens/sources`

- [ ] **Step 3: Build `use-preview.ts`, then `preview-lightbox.tsx`**

- [ ] **Step 4: Wire both tap sites** — `sources-bar.tsx` (S-09) and `capture-sources-row.tsx` (S-05). Both open the **same** component; S-05 §12 requires the two surfaces to agree.

- [ ] **Step 5: Run the tests** — `pnpm --filter @eduscope/panel test src/screens && pnpm lint && pnpm typecheck`

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/screens/sources apps/panel/src/screens/session && git commit -m "feat(S-10): the source preview lightbox on the mock transport"
```

---

## Task 17: S-11 — the Room Controls bar and the product-wide `[D-10]` pattern

*"A pattern decision, not a screen."* `NotConnectedRegion` is the product-wide rendering for `[D-10]` hardware and *"is inherited wherever that hardware appears"* (S11-D-4).

**Files:**
- Create: `apps/panel/src/screens/room/room-controls-bar.tsx`
- Create: `apps/panel/src/screens/room/mic-master-row.tsx`
- Create: `apps/panel/src/screens/room/not-connected-region.tsx`
- Create: `apps/panel/src/screens/room/not-connected-row.tsx`
- Create: `apps/panel/src/screens/room/room.css`
- Modify: `apps/panel/src/screens/dashboard/dashboard-screen.tsx` (mount the bar)
- Test: one `.test.tsx` per file above

**Interfaces:**
- Consumes: `useAudioControl('mic-lecturer')` (Task 15 — **the same hook, not a mirror**), `useAuth()`, `useNavigate()`.
- Produces:

```ts
export interface NotConnectedItem { readonly icon: ReactNode; readonly name: string }
/** PRODUCT-WIDE (S11-D-4). No data source, no client, no store subscription — ever. */
export function NotConnectedRegion(props: {
  readonly title: string;
  readonly items: readonly NotConnectedItem[];
}): JSX.Element;
export const ROOM_HARDWARE: readonly NotConnectedItem[];  // 5 static pairs
export function RoomControlsBar(): JSX.Element;
export function MicMasterRow(): JSX.Element;
```

**Layout (S-11 §2.2 / §2.3, binding)** — three regions, each **exactly 100 px**, in a 168 px expanded bar:

```
┌ MICROPHONE ~300 ─┐ ┌ POWER ~220 ─┐ ┌ NOT CONNECTED ~700 ──────────┐
│ Lecturer Mic     │ │ [Power off] │ │ These are not wired to this  │
│ Live    [ ●——— ] │ │ danger-quiet│ │ device.                      │
└──────────────────┘ └─────────────┘ │ ▫Projector ▫Screen ▫Speaker  │
   real · a control     real · S-12   │ ▫Lights ▫A/C   30px strip    │
                                      └──────────────────────────────┘
                                             inert · nothing
head 54 + content 100 + bottom padding 14 = 168
```

| Region | Arithmetic |
|---|---|
| `MICROPHONE` | `--sp-5` × 2 (24) + title 14 + `--sp-2` 6 + row 56 = **100** |
| `POWER` | 24 + 14 + 6 + button 56 = **100** |
| `NOT CONNECTED` | 24 + 14 + 6 + notice 20 + `--sp-2` 6 + chip row 30 = **100** |

**The four `[D-10]` rules (S-11 §3) — any surface rendering `[D-10]` hardware uses this and may not vary them**

- **RC-D-1 Structural separation.** Real controls and `[D-10]` rows never share a group, a card or a row. The boundary is always a *container* boundary, because that is the only distinction visible at three metres.
- **RC-D-2 Total inertness.** A `[D-10]` row renders an icon and a name. No control, no value, no state word, no tap target, no focus stop, no tooltip. **`aria-disabled` is wrong here — there is nothing to disable.**
- **RC-D-3 One notice per region, stating a fact.** *"These are not wired to this device."* One sentence for the whole region, never per row, and **never a promise** ("yet", "once wired") about hardware nobody has committed to.
- **RC-D-4 Silhouette is the carrier**; text and colour are secondary. The pattern must survive being read at three metres, in greyscale, with the caption illegible.

`NotConnectedRegion` **takes no data source and never will** — no client, no query, no store subscription, no props except a static list. *"That is not minimalism — it is the enforcement mechanism. A component with no way to receive a value cannot be given one in a later run"* (S11-D-7).

**States → demonstrated by**

| # | State | Demonstrated by |
|---|---|---|
| bar 1 | `collapsed` — 54 px head only | default |
| bar 2 | `expanded` — 168 px | tap **Show controls** |
| bar 3 | `advanced visible` — shown to **all roles**; the *destination* is role-scoped, not the button | any sign-in |
| mic 1–6 | `live` / `muted` / `pending` / `apply failed` / `mic offline` / U-1, U-2, U-5 | exactly as Task 15's table — **the same hook, the same states** |
| region | one rendering. No loading, no error, no empty, no disabled, **no U-1/U-2/U-4/U-5** | always |

- [ ] **Step 1: Write the failing tests**

Eight mic-row tests (S-11 §5.1) + one region test + one per bar state, **plus the three anti-placebo assertions that are the point of this screen** (S-11 §13):

```tsx
it('renders no interactive role anywhere inside the region', () => {
  render(<NotConnectedRegion title="NOT CONNECTED" items={ROOM_HARDWARE} />);
  const region = screen.getByRole('region', { name: /not connected/i });
  for (const role of ['button', 'switch', 'checkbox', 'link', 'slider'] as const) {
    expect(within(region).queryAllByRole(role)).toHaveLength(0);
  }
  expect(region.querySelectorAll('button, input, [tabindex], [role="switch"]')).toHaveLength(0);
});

it('makes no state claim about absent hardware (C-1)', () => {
  render(<NotConnectedRegion title="NOT CONNECTED" items={ROOM_HARDWARE} />);
  const region = screen.getByRole('region', { name: /not connected/i });
  // The prototype would fail this line today.
  expect(region.textContent).not.toMatch(/\b(on|off|lowered|raised|\d+%|\d+°C)\b/i);
});

it('is not in the tab order: the expanded bar reaches exactly four targets', async () => {
  renderBar();
  await userEvent.click(screen.getByRole('button', { name: /show controls/i }));
  const stops = await tabThrough();
  expect(stops).toEqual(['Advanced', 'Collapse', 'Lecturer Mic', 'Power off']);
});
```

Plus **one control, one truth**: drive a single `audio.control` event and assert S-09's `MicRow` and S-11's `MicMasterRow` report the same word.

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @eduscope/panel test src/screens/room`

- [ ] **Step 3: Build `not-connected-row.tsx` → `not-connected-region.tsx` → `mic-master-row.tsx` → `room-controls-bar.tsx` → `room.css`**

`ROOM_HARDWARE` is a module constant of five `{icon, name}` pairs: **Projector · Projector Screen · Speaker Volume · Lights · A/C**. There is no endpoint (**C-2**); an empty array from a query would build a data path for hardware that does not exist. The region is a `<section>` with `aria-labelledby` on its title and the notice as its **first child**, so the message is announced before the five names. `"A/C"` is the visible label; `aria-label="Air conditioning"` carries the long form.

- [ ] **Step 4: Mount it** in `dashboard-screen.tsx`'s room slot, with `Advanced` and `Collapse` **≥24 px apart** in the head. The `POWER` region renders **nothing** in this task — Task 18 fills it.

- [ ] **Step 5: Run the tests** — `pnpm --filter @eduscope/panel test src/screens && pnpm lint && pnpm typecheck`

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/screens/room apps/panel/src/screens/dashboard && git commit -m "feat(S-11): the Room Controls bar and the product-wide [D-10] pattern"
```

---

## Task 18: S-12 — the power-off entry row, the confirm and the terminal state

*"A confirmed halt, refused server-side while a session is non-terminal"* (LP-13, R-22, B-50). S-12 **owns** `power-off-row.tsx` even though S-11 renders it (S12-D-7): *"the screen that owns the consequence owns the control."*

**Files:**
- Create: `apps/panel/src/screens/room/power-off-row.tsx`
- Create: `apps/panel/src/screens/room/power-off-confirm.tsx`
- Create: `apps/panel/src/screens/room/use-power-off.ts`
- Modify: `apps/panel/src/screens/room/room-controls-bar.tsx` (mount it in the POWER region), `room.css`
- Test: `use-power-off.test.ts`, `power-off-row.test.tsx`, `power-off-confirm.test.tsx`

**Interfaces:**
- Consumes: `DangerButton` / `DangerConfirm` (Task 6), `useOverlays()`, `useRecorderLock()` (Task 12), `useIsStale()`, `useExpectedShutdown` + `setExpectedShutdown` (Task 2), `useAlertSuppression` (Task 5), `useClient().powerOffDevice`, `useProvisioning()` for `hallDisplayName` (**C-4** — naming the device costs no new data).
- Produces:

```ts
export const POWEROFF_BLOCKED_REASON = 'This device is recording — stop the lecture first.';

export type PowerOffState =
  | { readonly kind: 'confirm' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'refused-recording' }
  | { readonly kind: 'refused-other'; readonly title: string }
  | { readonly kind: 'accepted' }
  | { readonly kind: 'accepted-not-halted' };

export function usePowerOff(): {
  readonly state: PowerOffState;
  confirm(): void;
  retry(): void;
};
export function PowerOffRow(): JSX.Element;
export function PowerOffConfirm(): JSX.Element;
```

`POWEROFF_BLOCKED_REASON` is **one string used in two places** (the entry row and the message slot) — *"the client's belief and the server's ruling must not be worded differently, or the race reads as a second, unrelated problem."* It is also the mock's own 409 title (`mock/rest/device.ts:11`), so the two agree by construction.

**Component breakdown (S-12 §4)**

| Unit | Responsibility | Must not |
|---|---|---|
| `power-off-row.tsx` | The three entry forms (available / blocked / disconnected) and opening the confirm. **Owns no command** | Fire a shutdown from inside a layout component |
| `use-power-off.ts` | The union, the 202, the expected-drop flag, the `resolveBySec` ceiling, the `409` mapping | Close the dialog on the 202 (**there is no optimistic close** — B-50's UI treated request failure as success) |
| `power-off-confirm.tsx` | The copy and the terminal rendering | Define a destructive treatment of its own; the `Go to the lecture` replacement is a **neutral primary** (`--ink`/`#fff`), not a new tier |

**States → what renders → which script demonstrates it**

| # | State | Rendering | Demonstrated by |
|---|---|---|---|
| 1 | `entry available` | Row + `danger-quiet` **Power off** | `happy`, idle |
| 2 | `entry blocked (recording)` | Control disabled, **reason inline above it**, plus a jump to S-07. The dialog does not open | `happy` → Start; or World strip **Recorder owned by another user** |
| 3 | `entry disconnected` | Control disabled, *"Not connected — you cannot power off right now."* | `ws-flap` after 10 s |
| 4 | `confirm` | `DangerConfirm`, `dismissible: false`, 265 px | tap **Power off** |
| 5 | `pending` | Pending affordance, both buttons locked, label *"Powering off…"* | the same tap |
| 6 | `refused (recording)` | Message slot + the destructive button **replaced by** `Go to the lecture` | Open the dialog on `happy` (idle), then **Start** from the dev overlay, then confirm — the race §2.3 describes |
| 7 | `accepted` | Terminal *"Shutting down"* over a frozen shell; **U-2 suppressed** | `happy` → Power off → confirm |
| 8 | `accepted, not halted` | The second line + one **Try again** | `poweroff-not-halted`, second attempt |
| 9 | `refused (other)` | `Problem.title` in the slot; destructive button replaced by **Close** | `poweroff-not-halted`, first attempt |
| — | U-1 | The row renders disabled until `getRecordingState` resolves | pending-query test |

**The terminal state (§2.4) is a dead end by design** — there is no Cancel, because a shutdown cannot be un-sent. It must do two things: **stop pretending to be live** (live regions freeze; the clock keeps ticking because it is local wall time, not a claim about the device), and **suppress U-2** (the WS drop that follows is the *expected* outcome — Task 5's flag). **Try again** exists because a healthy device must not be stranded on a terminal screen; **one** explicit retry, never automatic — *"a shutdown is not a request you repeat on a timer."*

- [ ] **Step 1: Write the failing tests**

Ten rendering tests (one per row) plus the four S-12 §13 raises:

```ts
it('does not close the dialog on the 202 (B-50 inversion)', async () => { /* … */ });

it('renders accepted with NO U-2 marker, and U-2 normally without a preceding 202', async () => {
  // close AFTER a power-off 202  -> "Shutting down", no offline marker
  // the same close with no 202   -> the offline marker, as usual
});

it('produces state 8 and NOT a U-4 failure when resolveBySec elapses on a live socket', () => {
  vi.useFakeTimers();
  // C-1: there is no resolving event, so the ceiling must not be read as failure
});

it('uses ONE constant for the entry reason and the message slot', () => {
  expect(entryReasonText()).toBe(POWEROFF_BLOCKED_REASON);
  expect(messageSlotText()).toBe(POWEROFF_BLOCKED_REASON);
});
```

Plus: the confirm suppresses `poweroff.refused` on mount and **releases it on unmount** (Task 5's registry), and the expected-drop flag is cleared by `useWsStore.getState().reset()`.

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @eduscope/panel test src/screens/room`

- [ ] **Step 3: Build `use-power-off.ts`**

`confirm()` sets `setExpectedShutdown(true)` **when the 202 arrives**, not when the button is tapped — a refused command must not suppress U-2. The ceiling is `CommandAccepted.resolveBySec`, read from the 202 itself rather than the `TIMERS` constant, because the contract makes it a per-command value.

- [ ] **Step 4: Build `power-off-row.tsx` and `power-off-confirm.tsx`**

The blocked reason sits **inline above the disabled control, never in a tooltip** — the same rule S-04 applies to a disabled Start, and §0.4 bans tooltips as a sole carrier outright. The disabled control is `aria-disabled` with `aria-describedby` pointing at the reason. The terminal state is `aria-live="assertive"` — *"the one announcement on the panel that genuinely interrupts."*

- [ ] **Step 5: Mount it** in `room-controls-bar.tsx`'s POWER region — its own region, ≥`--sp-10` from `MICROPHONE`, not adjacent to `Advanced`. S-12's *three taps before anything destructive* holds: expand the bar → tap **Power off** → confirm.

- [ ] **Step 6: Run the tests** — `pnpm --filter @eduscope/panel test src/screens/room src/shell && pnpm lint && pnpm typecheck`

- [ ] **Step 7: Commit**

```bash
git add apps/panel/src/screens/room && git commit -m "feat(S-12): the power-off entry row, the confirm and the terminal state"
```

---

# The per-screen gates

The remaining tasks are the gates. Each is executable: nothing is signed off by
reading. Every gate has the same six steps in the same order, and a gate fails if
**any** enumerated state of its screen is not demonstrated — a green suite with a
missing row is a failed gate.

Each gate writes its own section of `docs/plans/screens/wave-2-recording-core-gate.md`:
one row per step, with the command, the result and the evidence.

**Standing preconditions for every gate**, run before Step 1:

```bash
pnpm --filter @eduscope/panel build && pnpm --filter @eduscope/panel preview
```

Playwright drives the preview build (the overlay is `MOCK_ADAPTER`-gated, not
`DEV`-gated, so it is present there). The viewport is **1280×800** in every spec
and every visual review — `playwright.config.ts` already sets it.

---

## Task 19: GATE S-04 — Dashboard, idle

- [ ] **Step 1: Write the Playwright spec**

`apps/panel/e2e/s04-idle.spec.ts`:

- **Primary journey** — `happy`: sign in as `a.perera` → `/` renders `[data-screen="S-04"]` with the greeting, the name and one Start pill → tap **Start** → the pill shows pending → within `T-START-CONFIRM` the layout becomes `[data-screen="S-05"]` and the red frame is present.
- **Failure — Class A** (`start-fails`, attempt 1): tap **Start** → the named reason renders **inline under the pill**, the pill is still full size, and `[data-testid="recording-frame"]` **never existed** (assert with a MutationObserver, the technique `panel-smoke.spec.ts` already uses).
- **Failure — Class B** (`start-fails`, attempt 2): tap **Start** again → the chrome reaches `error` with a plain-language cause, and again **the red frame never appeared**. This is J-1's failure path and B-12's regression test in one.
- **`disk-full`**: Start is **disabled** and its reason quotes a figure from the payload — proving the policy text is data, not a literal (INV-RP-1).
- **Geometry**: the Start pill's bounding box is ≥ 300 × 96 px (*"the single largest target in the product"*), and both bottom-bar heads are present at 54 px each.
- **No page scroll**: `document.documentElement.scrollHeight <= window.innerHeight`.

Run: `pnpm --filter @eduscope/panel e2e s04-idle` — Expected: PASS, 6 tests.

- [ ] **Step 2: Testing Library — one test per enumerated state**

Run: `pnpm --filter @eduscope/panel test src/screens/dashboard`

Expected: PASS, and the suite contains a rendering test for **every** row of screen-inventory §2 S-04: `idle / ready`, `starting`, `refused: storage critical`, `refused: recorder busy`, `refused: not provisioned`, `refused: no mounted volume`, `refused: invalid channel config`, `start failed`, `recovery pending`, `storage warning`, U-1, U-2, U-4, U-5. **A missing row fails this gate even if the suite is green.**

- [ ] **Step 3: Boundary lint still green**

```bash
pnpm lint && pnpm test tools/eslint-rules/gate-boundary.test.ts
```

Expected: exit 0 — no new file imports `fetch`, `axios` or `WebSocket`, and the rule still fails a build that does.

- [ ] **Step 4: Scenario demo checklist — every enumerated state, in the browser**

| # | State | How to reach it from the overlay | What to see |
|---|---|---|---|
| 1 | `idle / ready` | `happy`, signed in | Greeting + name + one dark Start pill; both bars collapsed |
| 2 | `starting` | → **Start** | Pending on the pill for ~1.2 s and **no frame** |
| 3 | `refused: storage critical` | `disk-full`, → **Start** | Start disabled, the real policy text inline, and (as admin) a jump to Local Storage |
| 4 | `refused: recorder busy` | World strip **Recorder owned by another user**, sign in as `admin`, → **Start** | The **S-06 lock card**, not an error on the hero |
| 5 | `refused: config invalid` | `start-fails`, → **Start** (1st) | *"The Students Camera is not connected to this device."* inline; pill unchanged in size |
| 6 | `start failed` | `start-fails`, → **Start** (2nd) | Red card, plain-language cause, **Try Again**; the frame never appeared |
| 7 | `recovery pending` | DevTools → Network → throttle to *Slow 3G*, reload | Start held with *"Checking the previous session"* — **no scenario producer (W2-D-8)** |
| 8 | `storage warning` | World strip **Storage: warning** | Start **enabled**, S-03 banner shown |
| 9 | U-2 | `ws-flap`, wait 10 s | Start disabled with its reason; the reconnecting marker in the shell |

> Record row 7 as *demonstrated by throttling, no scenario producer* and carry the candidate CG row into the gate file's "Contract gaps found in passing" section.

- [ ] **Step 5: Visual review against the prototype and the tokens, 1280×800**

Run the prototype (`cd prototype && nvm use 20 && npm run dev`) beside the panel and compare `IdleHero`:

- [ ] `.us-hero__greeting` 22 px, `.us-hero__name` 46 px (`--fs-display`), the Start pill's 38/54 px padding — the prototype's hero, reproduced.
- [ ] The pill is ~340 × 110 px and **refusal copy replaces the subtitle** rather than shrinking it.
- [ ] A disabled Start **always shows its reason inline** — no tooltip anywhere, and hovering reveals nothing that touch cannot reach.
- [ ] Both bottom-bar heads present at 54 px; the main region is 602 px with both collapsed.
- [ ] Every colour, size, radius and spacing traces to `tokens.css` — no literal hex, no off-scale px.
- [ ] Focus ring is the 3 px `--accent` `:focus-visible` ring.
- [ ] Re-run with `prefers-reduced-motion: reduce`: the pending affordance is still readable with animation frozen (it also changes the label).

- [ ] **Step 6: Record and commit**

```bash
git add apps/panel/e2e/s04-idle.spec.ts docs/plans/screens/wave-2-recording-core-gate.md && git commit -m "test(S-04): add the idle-dashboard e2e journeys and record the screen gate"
```

---

## Task 20: GATE S-07 — Session transport card

- [ ] **Step 1: Write the Playwright spec**

`apps/panel/e2e/s07-transport.spec.ts`:

- **Primary journey** — `happy`: Start → the digits tick (assert two samples ≥1 s apart differ) → **Pause** → the digits **freeze** (two samples 2 s apart are identical) → **Resume** → they tick again → **Stop** → all transport disabled and *"Saving…"* → `Saved`.
- **Failure — `pipeline-crash-midway`**: Start, wait for R-16 → the **seam marker** appears and the digits **keep running**; the lecture is not ended by a dead pipeline.
- **The honest figure**: after one pause of ≥3 s, the resumed digits are **less** than wall-clock-since-start by at least the pause length — pause gaps are excluded (B-08).
- **One tap to stop**: tapping **Stop** issues the command with **no** intermediate dialog (assert `[role="alertdialog"]` never appears).
- **U-2** (`ws-flap`): after 10 s the card is marked stale and both transport buttons are disabled; tapping **Stop** issues **nothing** (assert no state change on reconnect).

Run: `pnpm --filter @eduscope/panel e2e s07-transport` — Expected: PASS, 5 tests.

- [ ] **Step 2: Testing Library — one test per enumerated state**

Run: `pnpm --filter @eduscope/panel test src/screens/transport`

Expected: PASS, covering every row of screen-inventory §2 S-07: `recording`, `paused`, `pause pending`, `resume pending`, `stop pending`, `starting (resume)`, `stopping / finalizing`, `not owner`, `collapsed`, `segment seam`, U-2, U-4, U-5 — plus the `elapsedMs` table including the **`recordedDurationMs: null` → `00:00:00`, never `NaN`** row.

- [ ] **Step 3: Boundary lint still green**

```bash
pnpm lint && pnpm test tools/eslint-rules/gate-boundary.test.ts
```

Expected: exit 0.

- [ ] **Step 4: Scenario demo checklist**

| # | State | How to reach it | What to see |
|---|---|---|---|
| 1 | `recording` | `happy` → Start | Digits ticking, Pause + Stop enabled |
| 2 | `paused` | → **Pause** | Digits frozen, *"Recording paused"*, Resume + Stop |
| 3 | `pause` / `resume` / `stop pending` | tap each | Pending on **only** the pressed button (~250 ms) |
| 4 | `starting (resume)` | → **Resume** | Brief `starting` before R-05 confirms (~800 ms) |
| 5 | `stopping / finalizing` | → **Stop** | All transport disabled, *"Saving…"* |
| 6 | `not owner` | **No producer** — S06-D-1 replaced this layout with the lock card | Record as unit-tested only |
| 7 | `collapsed` | tap the chevron | Digits 38 → 24 px, actions hidden, chevron still ≥44 px |
| 8 | `segment seam` | `pipeline-crash-midway` → Start, wait ~40 s | A subtle continuity marker; the digits never stop |
| 9 | U-2 | `ws-flap`, wait 10 s | Card stale, transport disabled, digits still ticking from the last `startedAt` |

- [ ] **Step 5: Visual review against the prototype and the tokens, 1280×800**

Compare against `prototype/src/components/TimerCard.tsx`:

- [ ] `.us-timercard__digits` **38 px `--mono`** with tabular figures — the seconds column does not jitter, and it reads from the lectern.
- [ ] Pause and Stop keep the prototype's **colour and weight distinction**, and Stop has **no confirm dialog**.
- [ ] The collapse chevron is ≥44 px and its `aria-label` flips with state.
- [ ] The digits are `aria-live="off"` (a per-second announcement makes a screen reader unusable).
- [ ] Every value traces to `tokens.css`.
- [ ] Under `prefers-reduced-motion: reduce`, pending is still unambiguous.

- [ ] **Step 6: Record and commit**

```bash
git add apps/panel/e2e/s07-transport.spec.ts docs/plans/screens/wave-2-recording-core-gate.md && git commit -m "test(S-07): add the transport e2e journeys and record the screen gate"
```

---

## Task 21: GATE S-05 — Dashboard, session (the `ai disabled` layout)

- [ ] **Step 1: Write the Playwright spec**

`apps/panel/e2e/s05-session.spec.ts`:

- **Primary journey** — World strip **AI disabled**, `happy`: Start → the Capture Assurance card renders with the verdict *"Everything this lecture needs is working"* → tap a tile → **S-10 opens** → close → the card is unchanged. This is the journey S-05 §13 specifies.
- **Failure — `pipeline-crash-midway`** (§5 state 3): after ~12 s the verdict is tier 4, names the camera, **and contains *"Your lecture is still recording."*** The tile is promoted **by treatment, not by position** — assert the three tiles' x-order is unchanged.
- **The 388 px floor** (the one failure a component test cannot see): with **both** bottom bars expanded at 1280×800, the card's `scrollHeight <= clientHeight` and `.us-main` clips nothing.
- **The 168 px envelope**: the expanded room bar's height is **≤ 168 px** — S-05's floor is derived from it, so the coupling is asserted, not commented (S-11 §13).
- **One truth, two renderings**: drive one source fault and assert the card's tile and S-09's tile report the **same health word**.
- **The layout does not fork**: toggling **AI disabled** off replaces only the main column — the header, the chrome, the sidebar and both bars keep byte-identical bounding boxes (S05-D-10).

Run: `pnpm --filter @eduscope/panel e2e s05-session` — Expected: PASS, 6 tests.

- [ ] **Step 2: Testing Library — one test per enumerated state**

Run: `pnpm --filter @eduscope/panel test src/screens/session`

Expected: PASS, covering S-05 §5 rows 1–7 plus U-1, U-2 (**the tier degradation**), U-3, and the U-4/U-5 *inapplicability* assertion (zero non-tile buttons on the card). Plus the four §13 raises: the exhaustive fold table, `unknown` outranks `online`, the R-SRC-1 sentence, and the generated policy text.

- [ ] **Step 3: Boundary lint still green**

```bash
pnpm lint && pnpm test tools/eslint-rules/gate-boundary.test.ts
```

Expected: exit 0.

- [ ] **Step 4: Scenario demo checklist**

All rows below run with the World strip's **AI disabled (INT-10 go-live default)** checked.

| # | State | How to reach it | What to see |
|---|---|---|---|
| 1 | `assured` | `happy` → Start | *"Everything this lecture needs is working"*, `--success` dot only, three live tiles |
| 2 | `attention` (source) | `pipeline-crash-midway` → Start, wait ~5 s | *"CAM 1 is reconnecting."*, amber ring on that tile only |
| 2b | `attention` (storage) | World strip **Storage: warning** | *"The disk is filling up."*, disk bar amber |
| 3 | `problem` (source) | `pipeline-crash-midway`, wait ~12 s | Two sentences — the fault, then **"Your lecture is still recording."** The tile does **not** move |
| 4 | `problem (mic)` | same, wait ~20 s | *"The microphone has no signal — this lecture is recording silence."* — and it wins the tie |
| 5 | `checking` | `ws-flap`, wait ~5 s | *"Checking the room…"*, **no colour claim**, socket still open |
| 6 | `paused` | `happy` → Start → Pause | Amber chrome, *"Paused — nothing is being recorded right now."*, tiles still live |
| 7 | `stopping / finalizing` | → **Stop** | *"Saving your lecture…"*, tiles no longer tappable |
| 8 | U-1 | reload on a throttled network | Skeleton **in the card's own shape**, four blocks, verdict at tier 2 |
| 9 | U-2 | `ws-flap`, wait 10 s | The verdict **degrades to tier 2** — it does not hold tier 1 |
| 10 | U-3 | `ws-flap`, on reconnect | No populated→skeleton→populated flash for unchanged rows |
| 11 | dense density | expand **both** bottom bars | Card condenses: one-line verdict, 152 × 86 tiles, one-line disk — **no fact is lost** |

- [ ] **Step 5: Visual review against S-05's wireframe and the tokens, 1280×800**

There is no prototype for this card — review against [S-05 §2](../../design/screens/S-05-ai-disabled-design.md#2-wireframe) and §7:

- [ ] Main column **798 px**, sidebar **430 px** (`--sidebar-w`), gap 16.
- [ ] Comfortable: tiles 248 × 140 with the **44 px caption strip outside the image** (`--fs-md`/700 role, `--fs-sm` health word) — the reason this density exists.
- [ ] Dense: tiles 152 × 86 (`--srctile-w`) with the label back on the overlay; `SAVING TO` **never condenses**.
- [ ] The card is **light (`--surface`), not ink** — a room without the AI stack shows **no ink surface below the header** (S05-D-5).
- [ ] The disk block shows **bytes and the generated policy sentence**, and no hours estimate anywhere (S05-D-6 / CG-18).
- [ ] `.us-insightswrap` is **not in the DOM** — not collapsed, not empty-stated (S05-D-2).
- [ ] Greyscale filter: all seven states remain distinguishable — every tier changes the **sentence** and every tile state changes its **word**.
- [ ] The verdict block is the **only** `aria-live` region on the card, and it is `polite`, not `assertive`.
- [ ] No animation at all; `prefers-reduced-motion` is a no-op here by design.

- [ ] **Step 6: Record and commit**

```bash
git add apps/panel/e2e/s05-session.spec.ts docs/plans/screens/wave-2-recording-core-gate.md && git commit -m "test(S-05): add the session e2e journeys, the 388px floor and record the screen gate"
```

---

## Task 22: GATE S-06 — Recorder lock & takeover

S-06 §13 raises the floor to **two** Playwright failure scenarios, *"because the second is the only end-to-end proof that one R-21 event renders correctly on both sides."*

- [ ] **Step 1: Write the Playwright spec**

`apps/panel/e2e/s06-lock.spec.ts`, all with the World strip's **Recorder owned by another user**:

- **Primary journey**: sign in as `admin` → `/` shows the lock card naming *A. Perera*, *CS2043 — Lecture 7* and a running elapsed figure → tap **Take over** → the confirm opens with focus on **Cancel** → confirm → pending → the layout becomes **S-05** with the attribution strip *"You took over this recording from A. Perera…"*.
- **Failure 1 — `takeover refused (409)`**: open the confirm, use the dev overlay's **Stop** to end the session, then confirm → the message slot reads *"That lecture has already ended."* and the destructive button is **replaced by Close**, never left live.
- **Failure 2 — the displaced-owner collapse**: two browser contexts, `a.perera` in one (S-05, owner) and `admin` in the other. The admin takes over; **the owner's S-05 collapses back to the lock card** with the non-dismissible notice. This is the two-sides-of-one-event proof.
- **The lecturer has no action**: signed in as `n.silva`, the card renders with **no button at all** — assert zero `button` roles inside the card (**C-2**).
- **Danger separation**: the confirm's footer gap is **24 px** and the destructive button is the **last** focusable element.
- **The chrome is not suppressed for a non-owner**: the red frame and `● RECORDING` notch are present on the locked view (§2).

Run: `pnpm --filter @eduscope/panel e2e s06-lock` — Expected: PASS, 6 tests.

- [ ] **Step 2: Testing Library — one test per enumerated state**

Run: `pnpm --filter @eduscope/panel test src/screens/dashboard src/danger`

Expected: PASS, covering all **thirteen** rows of S-06 §5 (1, 2, 2b, 2c, 3, 4, 5, 6, 7, 8-as-routed, 9, 10, 11) plus U-1 and U-2, **plus the four DGR-D-4 dialog states**, **plus** the four §13 raises:

- [ ] the **authority table** — 96 rows over *{owner, other-lecturer, admin, admin-who-took-over}* × *{idle…finalizing}* × *{takeoverBy: null, me, other}*, asserted on the pure fold, not through the DOM;
- [ ] the **copy identity** — the displaced notice's first sentence is byte-identical to S-01's `reason: takeover` string, from `TAKEOVER_REVOKED_SENTENCE`;
- [ ] **no attribution rewrite** — after a takeover `ownerUserId` is unchanged and the strip still names the prior owner;
- [ ] **one elapsed rule** — `LockCard` and `TimerCard` fed the same session render the same digits.

- [ ] **Step 3: Boundary lint still green**

```bash
pnpm lint && pnpm test tools/eslint-rules/gate-boundary.test.ts
```

Expected: exit 0.

- [ ] **Step 4: Scenario demo checklist**

| # | State | How to reach it | What to see |
|---|---|---|---|
| 1 | `locked (lecturer)` | World strip **Recorder owned by another user**, sign in as `n.silva` (complete the forced reset) | Card with **no action**; *"Only A. Perera or an administrator can stop this recording."* |
| 2 | `locked (admin)` | same, sign in as `admin` | Card + **Take over** in `danger-quiet`. **No Stop** (S06-D-2) |
| 3 | `locked (admin, ending)` | then dev overlay → **Stop** | Action slot **withdrawn**, caption *"Saving…"* |
| 4 | `locked (starting)` | **No producer** — the seed enters at `recording` | Record as unit-tested |
| 5 | `takeover confirm` | tap **Take over** | 680 px dialog, focus on **Cancel**, scrim does not dismiss |
| 6 | `takeover pending` | confirm | *"Taking over…"*, both buttons locked |
| 7 | `takeover refused` (409) | open the confirm, dev overlay → **Stop**, then confirm | *"That lecture has already ended."*, destructive button replaced by **Close** |
| 8 | `takeover refused` (403) | **No producer** — the mock role cannot change underneath | Record as unit-tested |
| 9 | `taken over (new owner)` | complete a takeover | Layout becomes S-05 + the attribution strip naming **A. Perera** |
| 10 | `taken over (displaced)` | second browser context as `a.perera` | S-05 collapses to the card + the non-dismissible warning notice |
| 11 | `taken over (revoked)` | `auth-failures` (Wave 1 path) | Back at `/login` with the same first sentence |
| 12 | `taken over (third party)` | **No producer** — needs a third seeded actor | Record as unit-tested |
| 13 | `session ended while locked` | dev overlay → **Stop**, let it finish | The card unmounts and `/` returns to **S-04** |
| 14 | U-2 | `ws-flap` | *"Not connected — this may be out of date."*, **Take over disabled** |

- [ ] **Step 5: Visual review against S-06's wireframe and the tokens, 1280×800**

- [ ] Card **560 px** wide in S-04's hero slot, centred in the 602 px main region; lecturer height ≈270 px, admin ≈367 px.
- [ ] Owner name **24 px** (`--fs-3xl`), elapsed **38 px** (`--fs-timer` `--mono`) — both above the ≥21 px across-the-room floor; the session title is `--fs-lg`, deliberately below it.
- [ ] The eyebrow is `--record` while recording, `--warning` while paused, `--text-muted` while saving.
- [ ] **Take over** is `danger-quiet` at 56 px; the confirm's **Take over** is `danger-solid`; **no filled red button acts on first tap anywhere.**
- [ ] Footer gap **24 px** (`--sp-10`), Cancel at default weight, destructive on the **right** and last in the tab order.
- [ ] The displaced notice is `--warning`, **not** `--danger` — nothing was destroyed, and `--danger` in this product means *this will destroy data*.
- [ ] The message slot occupies 40 px from first paint, before any message exists.
- [ ] No tooltip anywhere; every disabled control carries its reason as inline text.
- [ ] Every value traces to `tokens.css` — **no new token** (S-06 §7, including §3).
- [ ] `prefers-reduced-motion: reduce`: pending also changes the label to *"Taking over…"*, so nothing is carried by motion alone.

- [ ] **Step 6: Record and commit**

```bash
git add apps/panel/e2e/s06-lock.spec.ts docs/plans/screens/wave-2-recording-core-gate.md && git commit -m "test(S-06): add the lock/takeover e2e journeys, both failure paths, and record the screen gate"
```

---

## Task 23: GATE S-09 — Sources & audio bar

- [ ] **Step 1: Write the Playwright spec**

`apps/panel/e2e/s09-sources.spec.ts`:

- **Primary journey** — `happy`: expand the sources bar → three live tiles with green dots and one mic row with a **moving** meter (sample `--level` twice, 500 ms apart, and assert it changed) → tap **−** twice → the percentage falls by 10 → tap the mute switch → the row reads **Muted**.
- **Failure — `pipeline-crash-midway`**: the camera tile goes amber (*"reconnecting…"*) then grey (*"No signal"*) and stops being tappable; the mic tile goes offline and the fault is surfaced as **critical**.
- **`apply failed`** (World strip **Mic changes fail to apply**): tapping mute leaves the switch reading **Live** and renders *"Still live — the mute didn't apply."* — the B-55 closure.
- **Collapsed dots**: with the bar collapsed, three dots carry the same three states as the tiles.
- **Telemetry does not render**: `window.__renderCount` is unchanged across 3 s of levels (Gate 1e's technique, re-asserted at the screen that owns the meter).
- **The bar's expanded height is ≤ 154 px** — the number S-05's floor arithmetic uses.

Run: `pnpm --filter @eduscope/panel e2e s09-sources` — Expected: PASS, 6 tests.

- [ ] **Step 2: Testing Library — one test per enumerated state**

Run: `pnpm --filter @eduscope/panel test src/screens/sources src/audio`

Expected: PASS, covering every row of screen-inventory §2 S-09: per-role `online`, `degraded`, `offline`, `unknown`, `unbound`; the collapsed dots; audio `live`, `muted`, `gain pending`, `apply failed`; `mic offline`; U-1 (*"tiles render as `unknown`, not as empty boxes"*), U-2, U-4, U-5 — plus the CG-15 `locked` row.

- [ ] **Step 3: Boundary lint still green**

```bash
pnpm lint && pnpm test tools/eslint-rules/gate-boundary.test.ts
```

Expected: exit 0.

- [ ] **Step 4: Scenario demo checklist**

| # | State | How to reach it | What to see |
|---|---|---|---|
| 1 | `online` | `happy`, expand the bar | Live tile, green dot, tappable |
| 2 | `degraded` | `pipeline-crash-midway`, ~5 s | Amber ring + *"reconnecting…"* |
| 3 | `offline` | same, ~12 s | Grey tile, *"No signal"*, **not tappable** |
| 4 | `unknown` | `ws-flap`, ~5 s | Grey tile, *"checking…"* — never the last healthy value |
| 5 | `unbound` | inspect the DOM | Exactly **three** video tiles; `mic-room` renders nowhere |
| 6 | collapsed dots | collapse the bar | Three dots, same colours as the tiles |
| 7 | audio `live` | `happy` | Meter animating from `audio.levels` |
| 8 | audio `muted` | tap the switch | Meter at zero, row reads **Muted** |
| 9 | `gain pending` | tap ± | U-4 on the stepper until `audio.control` resolves |
| 10 | `apply failed` | World strip **Mic changes fail to apply**, tap mute | Switch still **Live** + the failure line |
| 11 | `mic offline` | `pipeline-crash-midway`, ~20 s | Ranked **critical** — impossible to miss |
| 12 | `locked` (CG-15) | World strip **Recorder owned by another user**, sign in as `n.silva` | Controls disabled **with the reason inline**, never fake-disabled |
| 13 | U-2 | `ws-flap`, 10 s | Tiles dimmed, controls disabled |

- [ ] **Step 5: Visual review against the prototype and the tokens, 1280×800**

Compare against `prototype/src/components/sources/SourcesPanel.tsx`:

- [ ] `.us-srctile` **152 px** (`--srctile-w`), the tile itself is the tap target — no separate expand icon.
- [ ] `.us-srcmic__meter` renders **20 segments**, driven entirely by a CSS custom property.
- [ ] Steppers are **±5 %**, each ≥44 px with **8 px separation**.
- [ ] The collapsed head is **54 px** so it is reachable without precision.
- [ ] **No random walk anywhere** — grep the diff for `Math.random` and expect zero hits in `src/screens/sources`.
- [ ] Every value traces to `tokens.css`.
- [ ] Greyscale: every tile state is still distinguishable by its **word**, not only its ring.

- [ ] **Step 6: Record and commit**

```bash
git add apps/panel/e2e/s09-sources.spec.ts docs/plans/screens/wave-2-recording-core-gate.md && git commit -m "test(S-09): add the sources-bar e2e journeys and record the screen gate"
```

---

## Task 24: GATE S-10 — Source preview lightbox

- [ ] **Step 1: Write the Playwright spec**

`apps/panel/e2e/s10-preview.spec.ts`:

- **Primary journey** — `happy`: tap a live tile → the lightbox opens with a skeleton **holding the frame's shape** → within **1 s** the LIVE chip and a painting frame appear (assert two frames 500 ms apart differ) → tap ✕ → the lightbox closes and **recording is untouched** (`data-recording-state` unchanged).
- **Failure — `pipeline-crash-midway`**: open `lecturer-cam` at ~8 s and hold through 12 s → the lightbox shows **why** rather than freezing on the last frame (the mid-preview drop, W2-D-11c).
- **`negotiation failed`**: after the camera is offline, tapping the S-05 card's tile is impossible (not tappable) — so open from a still-`online` role and let it drop, and separately assert the failure copy for `source-offline` from a Testing Library test.
- **INT-8 budget**: time from tap to the first painted frame is **< 1 s**.
- **Scrim closes**: tapping the scrim closes the lightbox; the ✕ is ≥44 px.
- **Not fixed**: the lightbox's bounding box is inside `.us-panel`'s, proving it portals into the panel rather than the viewport.

Run: `pnpm --filter @eduscope/panel e2e s10-preview` — Expected: PASS, 6 tests.

- [ ] **Step 2: Testing Library — one test per enumerated state**

Run: `pnpm --filter @eduscope/panel test src/screens/sources`

Expected: PASS, covering every row of screen-inventory §2 S-10: `negotiating`, `live`, `negotiation failed` × **four codes** (`source-offline`, `source-unbound`, `busy`, `internal`), `source went offline mid-preview`, `closed`, U-2, U-5 — plus the B-06 regression test (closing a preview issues no recording command).

- [ ] **Step 3: Boundary lint still green**

```bash
pnpm lint && pnpm test tools/eslint-rules/gate-boundary.test.ts
```

Expected: exit 0. Note that `use-preview.ts` reaches the preview socket **only** through `EduscopeClient.openPreview()` — no `WebSocket` import exists anywhere in the panel.

- [ ] **Step 4: Scenario demo checklist**

| # | State | How to reach it | What to see |
|---|---|---|---|
| 1 | `negotiating` | `happy`, tap a live tile | A skeleton in the frame's shape for ~300 ms — never a spinner over an empty box |
| 2 | `live` | the same tap | LIVE chip + a moving mock frame |
| 3 | `negotiation failed · source-offline` | `pipeline-crash-midway` after ~12 s, tap the S-09 tile via the collapsed bar before it disables | Its own copy, not a generic error |
| 4 | `· source-unbound` / `busy` / `internal` | **No live producer** | Record as unit-tested; producers arrive in Wave 8 |
| 5 | `source went offline mid-preview` | `pipeline-crash-midway`: open `lecturer-cam` at ~8 s, hold | The lightbox states why; it does **not** freeze on the last frame |
| 6 | `closed` | tap ✕ or the scrim | Closes; **recording untouched** |
| 7 | U-2 | `ws-flap` while open | The lightbox closes **with a stated reason** |

- [ ] **Step 5: Visual review against the prototype and the tokens, 1280×800**

Compare against `SourcesPanel`'s `Modal` + `.us-lightbox`:

- [ ] The lightbox renders **light** even though `Modal` portals into `.us-panel` — assert visually that no ink scope leaks in.
- [ ] Close target ≥44 px in a **predictable corner**; the scrim also closes.
- [ ] Fixed-size preview — no pinch-zoom affordance, no resize handle.
- [ ] `position: absolute` inside `.us-panel`, never `fixed`.
- [ ] Every value traces to `tokens.css`.

- [ ] **Step 6: Record and commit**

```bash
git add apps/panel/e2e/s10-preview.spec.ts docs/plans/screens/wave-2-recording-core-gate.md && git commit -m "test(S-10): add the preview-lightbox e2e journeys and record the screen gate"
```

---

## Task 25: GATE S-11 — Room Controls bar

- [ ] **Step 1: Write the Playwright spec**

`apps/panel/e2e/s11-room.spec.ts`:

- **Primary journey** — `happy`: expand the room bar → three regions (`MICROPHONE`, `POWER`, `NOT CONNECTED`) → tap the mic switch → it resolves to **Muted** → collapse. This is the journey S-11 §13 specifies.
- **Failure — `apply failed`** (World strip **Mic changes fail to apply**): the switch stays **Live** and the failure line names **which way the failure fell**.
- **The 168 px envelope**: the expanded bar's height is **≤ 168 px** at 1280×800 — S-05's floor is derived from it, so this is a cross-screen coupling and is asserted, not commented.
- **The anti-placebo tab sweep**: tabbing through the expanded bar reaches exactly `Advanced`, `Collapse`, the mic `Toggle` and `Power off` — **and nothing else**.
- **One control, one truth**: mute from S-11, then expand S-09 and assert its mic row reads the same word (and vice versa).
- **No state claims**: the `NOT CONNECTED` region's text contains no `on`/`off`/`lowered`/`raised`/`%`/`°C`.

Run: `pnpm --filter @eduscope/panel e2e s11-room` — Expected: PASS, 6 tests.

- [ ] **Step 2: Testing Library — one test per enumerated state**

Run: `pnpm --filter @eduscope/panel test src/screens/room`

Expected: PASS, covering all **eight** rows of S-11 §5.1 (`live`, `muted`, `pending`, `apply failed`, `mic offline`, U-1, U-2, U-5), **one** for the region (§5.2 — it has exactly one rendering) and **one per bar state** (§5.3: `collapsed`, `expanded`, `advanced visible`), plus the three **anti-placebo assertions**:

- [ ] `NotConnectedRow` renders **no** `button`, `input`, `[role=switch]` or `[tabindex]` — querying for interactive roles inside the region returns **zero**. *"If this test ever fails, G-5 has been broken."*
- [ ] The region contains no text matching `/\b(on|off|lowered|raised|\d+%|\d+°C)\b/` — **C-1 as an executable rule; the prototype would fail it today.**
- [ ] The region is not focusable.

Plus **`apply failed` shows applied truth** and **one control, one truth**.

- [ ] **Step 3: Boundary lint still green**

```bash
pnpm lint && pnpm test tools/eslint-rules/gate-boundary.test.ts
```

Expected: exit 0. Additionally grep `src/screens/room/not-connected-*.tsx` and expect **zero** imports of `useClient`, `useQuery` or any selector — S11-D-7 makes the absence structural, and this is where that is checked.

- [ ] **Step 4: Scenario demo checklist**

| # | State | How to reach it | What to see |
|---|---|---|---|
| 1 | `collapsed` | `happy` | 54 px head, `ROOM CONTROLS`, `Advanced` + `Show controls` ≥24 px apart; **no dot cluster** |
| 2 | `expanded` | tap **Show controls** | 168 px: two regions you can press, one you cannot |
| 3 | `advanced visible` | sign in as either role | `Advanced` present for **all roles**; the destination is what is role-scoped |
| 4 | mic `live` | `happy` | Switch on, *"Live"* |
| 5 | mic `muted` | tap it | Switch off, *"Muted"* |
| 6 | mic `pending` | tap it | U-4 on the switch and **the switch does not move** |
| 7 | mic `apply failed` | World strip **Mic changes fail to apply** | *"Still live — the mute didn't apply."*; switch shows the **applied** state |
| 8 | mic `offline` | `pipeline-crash-midway`, ~20 s | Row disabled with the reason inline |
| 9 | mic U-2 | `ws-flap`, 10 s | *"Not connected — you can't change this right now."* |
| 10 | the `[D-10]` region | always | Five chips, one notice, **nothing pressable** |

- [ ] **Step 5: Visual review against the prototype and the tokens, 1280×800**

Compare against `prototype/src/components/room/RoomControlsPanel.tsx` — this screen deliberately **deviates** from it, and the review is the check that the deviation is complete:

- [ ] Groups are `MICROPHONE` / `POWER` / `NOT CONNECTED`, **not** Projector / Audio / Environment (S11-D-1, deviating from LP-14's grouping with **C-4** recorded).
- [ ] **All five `useState` seeds are gone**, and so is every `'On'`/`'Off'`/`'Lowered'`/`'Raised'`/`{n}%`/`{n}°C` readout (S11-D-2).
- [ ] The expanded bar is **168 px, down from 226** — *"honesty is the cheaper layout."*
- [ ] All three regions are exactly **100 px**; the chip strip is **30 px** and has no `--tap-min` floor because it is not a target.
- [ ] `NotConnectedRow` uses `--surface-2` (flush, **not** raised to `--surface`) and `--text-muted` (**not** `--text-faint`) — inert, not unimportant.
- [ ] The notice reads *"These are not wired to this device."* — **no "yet"**, no promise of future hardware (S11-D-5).
- [ ] **Distance test:** step three metres back. The captions are illegible and the pattern still reads correctly, because silhouette is the carrier (RC-D-4).
- [ ] **Greyscale test:** with colour removed the three regions remain distinguishable by their contents alone — switch, button, nothing.
- [ ] No new placeholder colour or tint anywhere (S11-D-10).
- [ ] Every value traces to `tokens.css`.

- [ ] **Step 6: Record and commit**

```bash
git add apps/panel/e2e/s11-room.spec.ts docs/plans/screens/wave-2-recording-core-gate.md && git commit -m "test(S-11): add the room-controls e2e journeys, the anti-placebo sweep and record the screen gate"
```

---

## Task 26: GATE S-12 — Power-off confirm, and the Wave 2 exit condition

- [ ] **Step 1: Write the Playwright spec**

`apps/panel/e2e/s12-poweroff.spec.ts`:

- **Primary journey** — `happy`, idle: expand Room Controls → tap **Power off** → the confirm names the hall → confirm → *"Shutting down"* fills the panel, the shell beneath is frozen, and **no reconnecting marker appears** even after `T-WS-STALE`. This is the journey S-12 §13 specifies.
- **Failure — `refused (recording)`**: open the confirm while idle, use the dev overlay's **Start**, then confirm → the message slot reads `POWEROFF_BLOCKED_REASON` and the destructive button is **replaced by** `Go to the lecture`, which lands on the transport card.
- **Three taps minimum**: from a cold dashboard, nothing destructive is reachable in fewer than three taps (expand → Power off → confirm).
- **The entry is blocked while recording**: with a session live, the row's control is `aria-disabled` with the reason **inline above it** and the dialog does not open.
- **`poweroff-not-halted`**: first confirm → `refused (other)` with **Close**; second → *"The device has not shut down yet."* + **Try again**; the retry → the socket closes and the terminal state settles. One run, three states.
- **No optimistic close**: the dialog is still open immediately after the 202 (B-50's inversion).

Run: `pnpm --filter @eduscope/panel e2e s12-poweroff` — Expected: PASS, 6 tests.

- [ ] **Step 2: Testing Library — one test per enumerated state**

Run: `pnpm --filter @eduscope/panel test src/screens/room src/shell src/store`

Expected: PASS, covering all **ten** rows of S-12 §5 (`entry available`, `entry blocked`, `entry disconnected`, `confirm`, `pending`, `refused (recording)`, `accepted`, `accepted, not halted`, `refused (other)`, U-1) plus the four §13 raises:

- [ ] **the blocked/refused copy identity** — §2.1's inline reason and §2.3's message-slot text come from **one constant**;
- [ ] **the expected-drop suppression** — a socket close *after* a 202 renders `accepted` and **no** U-2 marker, and the same close **without** a preceding 202 renders U-2 normally. *"This is the one behaviour that, if inverted, makes a correct shutdown look like a fault."*
- [ ] **the not-halted branch** — a fake-timer test that `resolveBySec` elapsing with a live socket produces state 8 and **not** a U-4 failure (**C-1**);
- [ ] **no optimistic close** — the dialog does not close on the 202.

- [ ] **Step 3: Boundary lint still green, and the Wave-0 gates unregressed**

```bash
pnpm lint && pnpm test tools/eslint-rules/gate-boundary.test.ts && pnpm gate && pnpm typecheck && pnpm test
```

Expected: exit 0 throughout; `pnpm gate` still reports **5 passed** (panel 1a/1b/1e + quiz 1c/1d), with Gate 1b now counting **nine** catalog scripts.

- [ ] **Step 4: Scenario demo checklist**

| # | State | How to reach it | What to see |
|---|---|---|---|
| 1 | `entry available` | `happy` idle, expand Room Controls | `danger-quiet` **Power off**, 56 px, in its own region |
| 2 | `entry blocked (recording)` | `happy` → Start | Control disabled, the reason **inline above it**, plus `Go to the lecture` |
| 3 | `entry disconnected` | `ws-flap`, 10 s | Disabled, *"Not connected — you cannot power off right now."* |
| 4 | `confirm` | tap **Power off** | 680 × 265 px dialog naming *Engineering Auditorium A301*; focus on **Cancel** |
| 5 | `pending` | confirm | *"Powering off…"*, both buttons locked, **dialog does not close** |
| 6 | `refused (recording)` | open the dialog while idle, dev overlay → **Start**, then confirm | The message slot + `Go to the lecture` as a **neutral primary**, never a force option |
| 7 | `accepted` | `happy` idle → confirm | *"Shutting down"* + the hall name; live regions frozen; **no reconnecting marker** |
| 8 | `accepted, not halted` | `poweroff-not-halted`, 2nd attempt | *"The device has not shut down yet."* + one **Try again** in `danger-solid` |
| 9 | `refused (other)` | `poweroff-not-halted`, 1st attempt | The `Problem.title` in the slot; destructive button replaced by **Close** |
| 10 | U-1 | reload on a throttled network | The row renders disabled until `getRecordingState` resolves |
| 11 | no banner for the requester | with the dialog open, cause a `poweroff.refused` | The **409 in the slot** and **no** shell banner (S12-D-3); the banner returns once the dialog closes |

- [ ] **Step 5: Visual review against S-12's wireframe and the tokens, 1280×800**

- [ ] The entry row is `--surface-2`, `--radius-md`, `--tap-row` 56 px, in the **POWER** region — ≥24 px from `MICROPHONE`, not adjacent to `Advanced`.
- [ ] The dialog is **680 × 265 px** centred in `.us-panel`; no text field, so `--osk-h` is 0 and does not enter the maths.
- [ ] The second body sentence is present and is the one that earns its place: *"Someone has to press the power button in this room to turn it back on."*
- [ ] `Go to the lecture` is a **neutral primary** (`--ink`/`#fff`), not a third danger tier.
- [ ] The terminal state is `aria-live="assertive"`; the message slot is `aria-live="polite"`.
- [ ] The clock keeps ticking on the terminal screen (local wall time), while every live region is frozen.
- [ ] No new token; the dialog's tokens are S-06 §7's, inherited.
- [ ] `prefers-reduced-motion: reduce`: the pending affordance also changes the label, so nothing is motion-only.

- [ ] **Step 6: Wave 2 exit condition**

screen-inventory §11 Wave 2: ***"J-1 happy and its failure path demo end-to-end on the mock."*** Demonstrate both, unbroken, and record the timing:

**Happy** (`happy`, World strip **AI disabled**): `/login` → sign in as `a.perera` → S-04 idle → **Start** → `starting` with no frame → red frame + S-05 with the Capture Assurance card reading *assured* → **Pause** → amber chrome, digits frozen → **Resume** → **Stop** → *"Saving…"* → `Saved` → back to S-04.

**Failure** (`start-fails`): **Start** → the Class-A named refusal with no session created → **Start** again → `starting` → `error` with a plain-language cause → **the red frame never appeared at any point** and the library grew no phantom row.

Then confirm the four cross-screen couplings this wave introduced are all asserted somewhere, and name where:

| Coupling | Asserted by |
|---|---|
| One elapsed rule across S-07 and S-06 | Task 22, Step 2 |
| One `AudioControl` truth across S-09 and S-11 | Task 25, Steps 1 and 2 |
| One `sources.status` truth across S-09 and S-05 | Task 21, Step 1 |
| S-11's 168 px → S-05's 388 px floor | Tasks 21 and 25, Step 1 |

- [ ] **Step 7: Record and commit**

Complete `docs/plans/screens/wave-2-recording-core-gate.md` with the S-12 section, the wave exit condition, and two closing sections: **"States with no live producer"** (the five recorded in Global Constraints) and **"Contract gaps found in passing"** (S-04's `recovery pending`, W2-D-8 — a candidate CG row for the Wave-3 amendment, **not** applied here).

```bash
git add apps/panel/e2e/s12-poweroff.spec.ts docs/plans/screens/wave-2-recording-core-gate.md && git commit -m "test(S-12): add the power-off e2e journeys and record the Wave 2 gate"
```

---

## Appendix A — State → scenario-script map (the whole cluster, one table)

Every enumerated state and the exact thing that demonstrates it. **NEW** marks work this plan adds; **World:** marks the dev-overlay World strip (Task 4); **none** marks a state with no live producer, recorded in the gate rather than faked.

| Screen | State | Reached by |
|---|---|---|
| S-04 | `idle / ready` | any script |
| S-04 | `starting` | `happy` → Start |
| S-04 | `refused: storage critical` | `disk-full` → Start |
| S-04 | `refused: recorder busy` | **World:** Recorder owned by another user → Start (**NEW** R-03 guard, W2-D-11a) |
| S-04 | `refused: config invalid` (all three) | `start-fails` attempt 1 (**NEW** Class-A rule, W2-D-5) |
| S-04 | `start failed` | `start-fails` attempt 2 |
| S-04 | `recovery pending` | **none** — DevTools throttle + unit test (W2-D-8) |
| S-04 | `storage warning` | **World:** Storage: warning |
| S-04 | U-1 / U-2 / U-4 / U-5 | pending query / `ws-flap` / fake timers / any refusal |
| S-05 | `recording` | `happy` → Start |
| S-05 | `paused` | `happy` → Pause |
| S-05 | `ai disabled` | **World:** AI disabled (**NEW**, W2-D-1) |
| S-05 | `ai degraded` | **Wave 4** — S-13 |
| S-05 | `insight column collapsed` | **Wave 3/4** — S-08 + S-16/S-17 |
| S-05 | `stopping / finalizing` | `happy` → Stop |
| S-05 card | `assured` | **World:** AI disabled + `happy` |
| S-05 card | `attention` | `pipeline-crash-midway` ~5 s (**NEW** timeline) / **World:** Storage: warning |
| S-05 card | `problem` | `pipeline-crash-midway` ~12 s (**NEW** timeline) |
| S-05 card | `problem (mic)` | `pipeline-crash-midway` ~20 s (**NEW** timeline, S-11 §10) |
| S-05 card | `checking` | `ws-flap` ~5 s (**NEW** HL-08 timeline, S-05 §10) |
| S-05 card | `paused` / `saving` | `happy` → Pause / Stop |
| S-05 card | U-1 / U-2 / U-3 | pending query / `ws-flap` / `ws-flap` reconnect |
| S-06 | `locked (lecturer)` | **World:** Recorder owned by another user, as `n.silva` |
| S-06 | `locked (admin)` | same, as `admin` |
| S-06 | `locked (admin, ending)` | same, then dev-overlay Stop |
| S-06 | `locked (starting)` | **none** — unit test |
| S-06 | `takeover confirm` / `pending` | tap Take over |
| S-06 | `takeover refused` (409) | open the confirm, dev-overlay Stop, confirm (**NEW** R-21 guard, W2-D-11b) |
| S-06 | `takeover refused` (403) | **none** — unit test |
| S-06 | `taken over (new owner)` | complete a takeover |
| S-06 | `taken over (displaced)` | two browser contexts |
| S-06 | `taken over (revoked)` | `auth-failures` (Wave 1) |
| S-06 | `taken over (third party)` | **none** — unit test |
| S-06 | `owner's own session` | `happy` → Start |
| S-06 | `session ended while locked` | dev-overlay Stop |
| S-07 | `recording` / `paused` | `happy` → Start / Pause |
| S-07 | `pause` / `resume` / `stop pending` | tap each |
| S-07 | `starting (resume)` | `happy` → Resume |
| S-07 | `stopping / finalizing` | `happy` → Stop |
| S-07 | `not owner` | **none** — S06-D-1 removed the layout; unit test |
| S-07 | `collapsed` | tap the chevron |
| S-07 | `segment seam` | `pipeline-crash-midway` R-16 (**NEW** `lastSegment` slice) |
| S-09 | `online` | any script |
| S-09 | `degraded` / `offline` | `pipeline-crash-midway` ~5 s / ~12 s (**NEW** timeline) |
| S-09 | `unknown` | `ws-flap` ~5 s (**NEW** timeline) |
| S-09 | `unbound` | structural — `mic-room` renders nowhere |
| S-09 | audio `live` / `muted` / `gain pending` | any script |
| S-09 | `apply failed` | **World:** Mic changes fail to apply (**NEW**, W2-D-4) |
| S-09 | `mic offline` | `pipeline-crash-midway` ~20 s (**NEW** timeline) |
| S-09 | `locked` (CG-15) | **World:** Recorder owned by another user, as `n.silva` |
| S-10 | `negotiating` / `live` / `closed` | `happy`, tap a tile |
| S-10 | `failed: source-offline` | `pipeline-crash-midway` |
| S-10 | `failed: source-unbound` / `busy` / `internal` | **none** — unit tests; Wave 8 |
| S-10 | `offline mid-preview` | `pipeline-crash-midway`, hold through the drop (**NEW**, W2-D-11c) |
| S-11 | bar `collapsed` / `expanded` / `advanced` | tap |
| S-11 | mic states | as S-09's rows — the same hook |
| S-11 | `[D-10]` region | always; it has exactly one rendering |
| S-12 | `entry available` | `happy` idle |
| S-12 | `entry blocked` | `happy` → Start, or **World:** Recorder owned by another user |
| S-12 | `entry disconnected` | `ws-flap` |
| S-12 | `confirm` / `pending` | tap Power off |
| S-12 | `refused (recording)` | open while idle, dev-overlay Start, confirm |
| S-12 | `accepted` | `happy` idle → confirm |
| S-12 | `accepted, not halted` | `poweroff-not-halted` 2nd attempt (**NEW** script, W2-D-3) |
| S-12 | `refused (other)` | `poweroff-not-halted` 1st attempt (**NEW** script) |

---

## Appendix B — What this cluster hands to later waves

| Artefact | Inherited by |
|---|---|
| `danger/` — `DangerButton`, `DangerConfirm`, DGR-D-1…D-4 | **S-24** (delete recording) and **S-30** (format storage), which *"may not define their own destructive treatment"* |
| `screens/room/not-connected-*.tsx` — `NotConnectedRegion`, RC-D-1…D-4 | **Any** future `[D-10]` surface (S11-D-4) |
| `audio/use-audio-control.ts` | S-08's audio-adjacent controls; any later screen touching `AudioControl` |
| `screens/transport/use-transport.ts` + `elapsedMs` | Any screen showing a lecture's duration — the rule is now shared by construction |
| `screens/dashboard/use-recorder-lock.ts` | S-08 (`G-AUTH-OWNER` on the channel toggle), S-25+ wherever ownership gates a control |
| `screens/sources/use-preview.ts` + `preview-lightbox.tsx` | **Wave 8** replaces the mock transport behind the same component |
| `screens/session/use-ai-enabled.ts` | **Wave 4** — S-13/S-16/S-17 mount behind this one gate |
| The S-13 slot in `session-layout.tsx` | **Wave 4** swaps exactly one element (W2-D-9) |
| The sidebar's `flex` layout | **Wave 3** — S-08 takes the slack with `flex: 1 1 auto` and `defaultExpanded` (S-05 §12) |
| `WorldSeed` overrides + the overlay World strip | Every later wave needing a world condition rather than a narrative |
| `ScenarioScript.timeline` | Any later screen needing a machine fault no command triggers |
| `shell/alert-suppression.ts` | Any later screen that reads a refusal synchronously and must not double-report it |
| The `expectedShutdown` rule in `store/connection.ts` | S-31 (firmware apply), which has the same "the drop is expected" shape |
| The dev overlay's transport strip | **Retired here** — S-04's real Start pill and S-07's real transport replace it. Keep the strip only for the states this plan's checklists still reach through it (`Stop` on a session the viewer does not own, and `Start` while a dialog is open); note that in the gate file |
