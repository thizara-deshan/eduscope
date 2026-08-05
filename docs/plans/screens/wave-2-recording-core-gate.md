# Wave 2 recording core gate — record

Exit condition (screen-inventory §11 Wave 2): the recording-core screens are
implemented, their enumerated states are covered, and the primary/failure
journeys run end to end against the mock adapter at 1280×800.

This file is appended screen-by-screen as Tasks 19–24 complete.

---

## S-04 — Dashboard, idle

### Automated gate

| Command | Result |
|---|---|
| `pnpm --filter @eduscope/panel e2e s04-idle` | exit 0 — **6 passed** |
| `pnpm --filter @eduscope/panel test src/screens/dashboard` | exit 0 — **150 passed** across 8 files |
| `pnpm lint` | exit 0 |
| `pnpm test tools/eslint-rules/gate-boundary.test.ts` | exit 0 — **3 passed**; a direct panel `fetch` still fails the build |
| `pnpm --filter @eduscope/panel build` | exit 0; preview served at `http://127.0.0.1:4173` |

### Playwright journeys

| # | Journey | Result |
|---|---|---|
| 1 | `happy`: greeting/name/one Start → pending on S-04 → confirmed S-05 + red frame | ✅ pass |
| 2 | `start-fails`, Class A: named inline refusal, unchanged pill geometry, frame never existed | ✅ pass |
| 3 | `start-fails`, Class B: second attempt reaches plain-language error, frame never existed | ✅ pass |
| 4 | `disk-full`: Start disabled before a tap; reason quotes the payload's `90%` policy threshold | ✅ pass |
| 5 | Geometry: Start ≥300×96; both 54 px bar heads are visible inside the viewport | ✅ pass |
| 6 | No document scroll at 1280×800 | ✅ pass |

### Testing Library state matrix

| Enumerated state / invariant | Covered by |
|---|---|
| `idle / ready` | `idle-hero.test.tsx`, `dashboard-screen.test.tsx` |
| `starting` | `idle-hero.test.tsx`; owner initial-start routing in `dashboard-screen.test.tsx` |
| `refused: storage critical` | `use-start-recording.test.ts`, `idle-hero.test.tsx`, `dashboard-screen.test.tsx` |
| `refused: recorder busy` | `use-start-recording.test.ts`; S-06 lock rendering in `dashboard-screen.test.tsx` |
| `refused: not provisioned` | `start-refusal.test.tsx` |
| `refused: no mounted volume` | `start-refusal.test.tsx` |
| `refused: invalid channel config` | `start-refusal.test.tsx`, `idle-hero.test.tsx` |
| `start failed` | `idle-hero.test.tsx`; failure transition in `use-start-recording.test.ts` |
| `recovery pending` | `idle-hero.test.tsx`; owner recovery routing in `dashboard-screen.test.tsx` |
| `storage warning` | `dashboard-screen.test.tsx` — Start remains enabled |
| U-1 | cold holding copy in `idle-hero.test.tsx` |
| U-2 | offline rendering + command no-op tests |
| U-4 | `T-START-CONFIRM` fake-timer ceiling |
| U-5 | named refusal table + rendered inline copy; no tooltip |

No enumerated row is missing.

### Scenario demo checklist

| # | State | How reached | Observed |
|---|---|---|---|
| 1 | `idle / ready` | `happy`, sign in as `a.perera` | Greeting + name + one enabled Start; both bars collapsed and visible |
| 2 | `starting` | Start | Pending label remains on S-04 for ~1.2 s; no recording frame |
| 3 | `refused: storage critical` | `disk-full` | Start already disabled; inline reason quotes `90%`; admin remedy is unit-covered |
| 4 | `refused: recorder busy` | World → **Recorder owned by another user**, admin, overlay Start | S-06 lock card, not a hero error |
| 5 | `refused: config invalid` | `start-fails`, first Start | Students Camera named inline; pill retains its full bounding box |
| 6 | `start failed` | `start-fails`, dismiss, second Start | Red error card + Try Again; MutationObserver saw no frame |
| 7 | `recovery pending` | no scenario producer (W2-D-8) | Unit-rendered as *Checking the previous session*; see contract gap below |
| 8 | `storage warning` | World → **Storage: warning** | Start enabled and S-03 warning banner visible |
| 9 | U-2 | `ws-flap`, wait past `T-WS-STALE` | Reconnecting marker + disabled Start + *Not connected* |

### 1280×800 prototype/token comparison

| Check | Result |
|---|---|
| Greeting/name | ✅ `--fs-2xl` computes to **21 px** and `--fs-display` to **46 px** |
| Start geometry | ✅ ≥340×110 with the Task-7-mandated 38/54 px prototype padding; refusal copy does not resize it |
| Disabled reason | ✅ always rendered inline; no `title`-only affordance |
| Bottom bars | ✅ both heads compute to 54 px and are in the viewport; dashboard content no longer clips the Room Controls head |
| Focus | ✅ 3 px `--accent` `:focus-visible` outline |
| Reduced motion | ✅ pending label remains readable and the dot's animation computes to `none` |
| Colour/radius/spacing | ✅ token-based, except the explicitly approved Task-7 prototype geometry literals listed below |

Approved interpretation: the binding token sheet wins over the checklist's
conflicting 22 px prose, so the greeting remains `--fs-2xl` (21 px). Task 7's
explicit prototype geometry literals (`340px`, `110px`, `38px 54px`, `26px`)
remain reviewed exceptions rather than prompting a design-system rewrite.

### Defects found and fixed during this gate

1. **Critical storage was not a preflight state.** `disk-full` left Start
   enabled until a command refusal, while the S-04 design and gate require the
   known critical condition to disable it before a tap. S-04 now consumes the
   live/full storage payload, generates the refusal from the real
   `criticalThresholdPct`, and never issues the command while the policy blocks
   starts.
2. **The pending S-04 frame was unreachable.** The first
   `recording.state{starting, startReason:initial}` made the owner verdict switch
   immediately to S-05. Owner `initial` and `recovery` confirmation now remain
   on S-04; `resume` still remains on S-05, and other users still see S-06.
3. **The Room Controls head was below the clipped kiosk viewport.** The
   dashboard used `min-height:100%` below a 62 px header and added an 8 px gap
   not present in the binding vertical budget. It now uses the header-adjusted
   height with no invented inter-bar gap. The E2E geometry test asserts both
   heads are actually in the viewport, not merely present in the DOM.

### Contract gaps found in passing

- **Candidate CG — boot recovery visibility (W2-D-8).** The contract carries
  no `recovering` snapshot/state, so the panel cannot distinguish boot recovery
  from a pending cold snapshot. There is deliberately no scenario producer.
  The rendering is covered against the same hook path by Testing Library. In
  the mock preview, browser Network throttling cannot delay the in-process
  `EduscopeClient` call, so this state cannot be honestly frozen from DevTools;
  a real-transport run can use the documented Slow 3G procedure.

### Tooling notes

- The in-app browser runtime could not start because Windows denied its Node
  bootstrap access under `C:\Users\Thizara\AppData`. The plan's installed
  Playwright/Chromium path was used for all browser checks.
- The prototype had an incomplete `node_modules` and no `nvm`; with approval,
  `npm ci` rebuilt the lockfile-pinned dependencies and the prototype built
  successfully under the available Node 24 runtime.

---

## S-07 — Session transport card

### Automated gate

| Command | Result |
|---|---|
| `pnpm --filter @eduscope/panel e2e s07-transport` | exit 0 — **5 passed** |
| `pnpm --filter @eduscope/panel test src/screens/transport` | exit 0 — **22 passed** across 2 files |
| `pnpm --filter @eduscope/panel test src/store src/screens/transport` | exit 0 — **34 passed** across 5 files (closed-segment store regression included) |
| `pnpm lint` | exit 0 |
| `pnpm test tools/eslint-rules/gate-boundary.test.ts` | exit 0 — **3 passed** |
| `pnpm --filter @eduscope/panel build` | exit 0 |

### Playwright journeys

| # | Journey | Result |
|---|---|---|
| 1 | `happy`: digits tick → Pause freezes them for 2 s → Resume ticks → Stop disables both controls + Saving → Saved | ✅ pass |
| 2 | `pipeline-crash-midway`: R-16 at 40 s → closed-segment seam persists → digits advance → recording frame remains | ✅ pass |
| 3 | Honest figure: a pause longer than 3 s is excluded from the resumed elapsed duration | ✅ pass |
| 4 | One-tap Stop: a MutationObserver confirms no `alertdialog` ever enters the DOM | ✅ pass |
| 5 | U-2 `ws-flap`: stale card disables both commands; a dispatched offline Stop does not replay after reconnect | ✅ pass |

### Testing Library state matrix

| Enumerated state / invariant | Covered by |
|---|---|
| `recording` | ticking digits + enabled Pause/Stop in `timer-card.test.tsx` |
| `paused` | frozen persisted duration, paused note, Resume/Stop |
| `pause pending` | only Pause reads *Pausing…*; Stop remains available |
| `resume pending` | only Resume reads *Resuming…*; Stop remains available |
| `stop pending` | Stop reads *Stopping…*; the other transport is locked |
| `starting (resume)` | `Starting…` while the active segment has no timing anchor |
| `stopping / finalizing` | `Saving…`; both controls disabled in both states |
| `not owner` | transport actions absent; S-06 owns the live layout |
| `collapsed` | actions absent, small digits class, 44 px expand target |
| `segment seam` | crash-ended closed segment renders the continuity sentence |
| U-2 | stale marker and note; both commands disabled; hook issues no offline request |
| U-4 | `T-CMD-RESOLVE` fake-clock ceiling renders a failure |
| U-5 | rejected command renders its named reason inline and restores the control |
| elapsed table | paused, live ticker delta, null anchor, and null persisted duration (`00:00:00`, never `NaN`) |

No enumerated row is missing.

### Scenario demo checklist

| # | State | How reached | Observed |
|---|---|---|---|
| 1 | `recording` | `happy` → Start | Digits advance locally; Pause + Stop enabled |
| 2 | `paused` | Pause | Digits freeze; *Recording paused*; Resume + Stop |
| 3 | `pause` / `resume` / `stop pending` | tap each | Only the pressed command receives its pending label; command lockout is immediate |
| 4 | `starting (resume)` | Pause → Resume | Brief `Starting…` before R-05 opens segment 2 |
| 5 | `stopping / finalizing` | Stop | Both controls disabled; *Saving…*; then Saved |
| 6 | `not owner` | no live producer (S06-D-1) | Unit-rendered only; the product routes a non-owner to S-06 |
| 7 | `collapsed` | collapse chevron | Unit-covered: small digits, hidden actions, 44 px target |
| 8 | `segment seam` | `pipeline-crash-midway` → Start → wait ~40 s | Continuity sentence remains after R-17; digits continue and the red frame survives |
| 9 | U-2 | `ws-flap` → wait through drop + `T-WS-STALE` | Card marked stale, both controls disabled; offline Stop is not replayed after reconnect |

### Defects found and fixed during this gate

1. **The crash scenario never crashed.** Its forced R-16 rule existed, but no
   timeline entry scheduled R-16. The scenario now schedules it at 40 seconds,
   with a virtual-clock regression proving the truncated segment and R-17
   recovery.
2. **New recordings carried no timing or segment lifecycle.** The mock emitted
   state names but left `startedAt`, `recordedDurationMs`, segment indices/counts
   and pause counts null. Transition data reducers now accumulate persisted
   closed-segment duration, exclude pause/restart gaps, and expose the active
   segment anchor required for local ticking.
3. **A developer scenario switch changed the lecturer's identity.** User IDs
   were regenerated from a module-global counter, so the mounted auth context
   and rebuilt world disagreed and the owner was routed to S-06. Seeded user IDs
   are now stable module constants; a regression asserts identity across
   `switchScenario()`.
4. **The seam marker was erased synchronously.** R-16's closed crash segment was
   immediately replaced by R-17's new `capturing` row. The store now defines
   `lastSegment` as the most recently closed segment, so the marker persists
   until the next close event.

The remaining-task visual review was omitted by explicit user direction.

---

## S-06 — Recorder lock & takeover

### Automated gate

| Command | Result |
|---|---|
| `pnpm --filter @eduscope/panel e2e s06-lock` | exit 0 — **6 passed** |
| `pnpm --filter @eduscope/panel test src/screens/dashboard src/danger` | exit 0 — **161 passed** across 10 files |
| `pnpm lint` | exit 0 |
| `pnpm test tools/eslint-rules/gate-boundary.test.ts` | exit 0 — **3 passed** |

### Playwright journeys

| # | Journey | Result |
|---|---|---|
| 1 | Admin lock card, running elapsed, Cancel focus, pending state, successful takeover and prior-owner attribution | ✅ pass |
| 2 | Stop while confirm is open, then confirm: 409 message and destructive action replaced by Close | ✅ pass |
| 3 | One R-21 state viewed sequentially as the new admin owner and the displaced original owner | ✅ pass |
| 4 | Lecturer lock card contains no action | ✅ pass |
| 5 | Confirm footer has a 24px gap and the destructive action is last | ✅ pass |
| 6 | Recording frame and notch remain visible on the locked view | ✅ pass |

### Testing Library state matrix

The focused suite covers all thirteen S-06 rows, U-1/U-2, all four dialog
states, the 96-row authority fold, shared revocation copy, unchanged prior-owner
attribution, and the shared elapsed-time rule. No enumerated row is missing.

### Scenario demo checklist

| # | State | How reached | Observed |
|---|---|---|---|
| 1 | `locked (lecturer)` | World → Recorder owned by another user; sign in as `n.silva` and finish reset | A. Perera card, no action, owner/admin-only explanation |
| 2 | `locked (admin)` | Same world; sign in as `admin` | Quiet Take over action; no Stop |
| 3 | `locked (admin, ending)` | Dev overlay → Stop | Action withdrawn; Saving… |
| 4 | `locked (starting)` | No live producer | Unit-tested |
| 5 | `takeover confirm` | Tap Take over | Alert dialog; initial focus on Cancel |
| 6 | `takeover pending` | Confirm | Taking over…; actions locked |
| 7 | `takeover refused` (409) | Open confirm; dev overlay → Stop; confirm | Ended message; Close replaces Take over |
| 8 | `takeover refused` (403) | No live producer | Unit-tested |
| 9 | `taken over (new owner)` | Complete takeover as admin | S-05 plus A. Perera attribution strip |
| 10 | `taken over (displaced)` | Sign out admin; sign in as `a.perera` in the same mock world | Lock card plus non-dismissible shared warning sentence |
| 11 | `taken over (revoked)` | `auth-failures` Wave-1 path | Login uses the same shared first sentence |
| 12 | `taken over (third party)` | No third seeded actor | Unit-tested |
| 13 | `session ended while locked` | Dev overlay → Stop; wait for completion | Lock card unmounts and S-04 returns |
| 14 | U-2 | `ws-flap` | Stale explanation; Take over disabled |

### Approved gate adaptations

- Browser contexts do not share an in-page mock world. The two sides of R-21
  are therefore proven sequentially in one world: admin takes over and signs
  out, then A. Perera signs in and sees the displaced-owner state.
- Mock world rebuilds now carry only `auth.currentUserId`, keeping the mounted
  UI session and server-side authorization aligned while all other world state
  remains disposable.

The remaining-task visual review was omitted by explicit user direction.

---

## S-05 — Dashboard, session (AI disabled)

### Automated gate

| Command | Result |
|---|---|
| `pnpm --filter @eduscope/panel e2e s05-session` | exit 0 — **6 passed** |
| `pnpm --filter @eduscope/panel test src/screens/session` | exit 0 — **91 passed** across 8 files |
| `pnpm lint` | exit 0 |
| `pnpm test tools/eslint-rules/gate-boundary.test.ts` | exit 0 — **3 passed** |
| `pnpm --filter @eduscope/panel build` | exit 0 |

### Playwright journeys

| # | Journey | Result |
|---|---|---|
| 1 | `happy`, AI disabled: assured verdict → PC preview opens as S-10 → close → density, tier and all three tile states unchanged | ✅ pass |
| 2 | `pipeline-crash-midway`: CAM 1 reaches tier 4 with the R-SRC-1 reassurance; tile x-order is unchanged | ✅ pass |
| 3 | Both bottom bars expanded: capture card retains a ≥388px client box, has no internal overflow, and `.us-dashboard__main` does not clip | ✅ pass |
| 4 | Recording-blocked Room Controls uses the approved safety-copy envelope, **≤194px** | ✅ pass |
| 5 | One lecturer-camera fault reads *Reconnecting* on both S-05 and S-09 | ✅ pass |
| 6 | AI enabled/disabled stable S-05 runs: header, recording frame, sidebar and both bars have identical bounding boxes; only main-column content changes | ✅ pass |

### Testing Library state matrix

| Enumerated state / invariant | Covered by |
|---|---|
| `assured` | tier 1 sentence and all-online fold cases |
| `attention` (source/channel/storage) | exhaustive fold rows and rendered tier 3 verdict |
| `problem` (source/channel/storage) | tier 4 rows, mic tie-break and R-SRC-1 reassurance |
| `checking` | cold, unknown-source, preflight, null-storage and stale rows |
| `paused` | exact paused sentence and no false reassurance |
| `stopping / finalizing` | exact saving sentence; tiles freeze |
| U-1 | four-block card-local skeleton with tier 2 verdict |
| U-2 | stale input degrades the fold to tier 2 |
| U-3 | populated store/query rows remain mounted without a skeleton flash |
| U-4 / U-5 inapplicable | exactly three tile buttons; no non-tile card action exists |
| §13 exhaustive fold | 64 pure fold tests, including unknown outranking online and mic-offline tie-break |
| generated policy | disk row renders byte figures and the retention-policy sentence from payload data |
| density | ResizeObserver drives comfortable/dense without omitting any fact |
| AI layout choice | Capture Assurance and S-13 are mutually exclusive; TimerCard/sidebar remain in both |

No enumerated row is missing.

### Scenario demo checklist

All S-05 rows use the World strip's **AI disabled (INT-10 go-live default)**
unless the row explicitly compares the AI-enabled layout.

| # | State | How reached | Observed |
|---|---|---|---|
| 1 | `assured` | `happy` → Start | *Everything this lecture needs is working*; three live tiles |
| 2 | `attention` (source) | `pipeline-crash-midway` → wait ~5 s | CAM 1 reads *Reconnecting* in both S-05 and S-09; tile position is unchanged |
| 2b | `attention` (storage) | World → Storage warning | Unit-covered generated sentence: *The disk is filling up.* |
| 3 | `problem` (source) | pipeline scenario → wait ~12 s | *CAM 1 has no signal.* plus *Your lecture is still recording.*; no tile reorder |
| 4 | `problem` (mic) | same scenario → wait ~20 s | Unit-covered mic-specific silence sentence wins the tier-4 tie |
| 5 | `checking` | `ws-flap` / cold input | Unit-covered tier 2 *Checking the room…* with no false colour claim |
| 6 | `paused` | Pause | Unit-covered amber paused sentence; live source facts remain |
| 7 | `stopping / finalizing` | Stop | Unit-covered saving sentence and non-tappable tiles |
| 8 | U-1 | unresolved card data | Unit-covered four-block skeleton in the card's own shape |
| 9 | U-2 | stale input | Unit-covered verdict degradation to tier 2 |
| 10 | U-3 | reconnect/resync | Store/query tests retain populated rows without a skeleton flash |
| 11 | dense density | expand both bars | Browser proves ≥388px card, no card overflow and no main clipping |

### Approved gate adaptations

- Task 18's safety explanation requires a **194px** Room Controls envelope
  while recording is non-terminal. This gate asserts `≤194px` for S-05; the
  ordinary idle/available bar remains `≤168px`.
- The World strip changes provisioning through `switchScenario()`, which
  disposes the active mock world. Layout invariance is therefore compared
  across two independently started stable S-05 runs rather than pretending the
  harness supports a hot provisioning update.

### Defects found and fixed during this gate

1. **World-strip changes left REST query truth stale.** `switchScenario()`
   rebuilt WebSocket state but the mounted TanStack Query cache still reported
   the prior world's provisioning, so checking AI disabled continued to render
   S-13. The dev overlay now invalidates all REST-backed queries after a world
   rebuild; its focused regression proves the provisioning row is invalidated.
2. **The dense session grid clipped by 184px.** With both bars open, the main
   slot was 390px but CSS grid's automatic minimum expanded its scroll height
   to 574px. The row and both grid children now admit shrinking, and the
   documented both-bars-open density spends no vertical session padding, which
   preserves the capture card's 388px floor without document or main-region
   clipping.

The remaining-task visual review was omitted by explicit user direction.

---

## S-09 — Sources & audio bar

### Automated gate

| Command | Result |
|---|---|
| `pnpm --filter @eduscope/panel e2e s09-sources` | exit 0 — **6 passed** |
| `pnpm --filter @eduscope/panel test src/screens/sources src/audio` | exit 0 — **48 passed** across 7 files |
| `pnpm lint` | exit 0 |
| `pnpm test tools/eslint-rules/gate-boundary.test.ts` | exit 0 — **3 passed** |

### Playwright journeys

| # | Journey | Result |
|---|---|---|
| 1 | Three live tiles, moving mic meter, two −5 gain steps, and applied mute truth | ✅ pass |
| 2 | Lecturer camera degrades then goes offline and disables; lecturer mic then reaches its offline critical state | ✅ pass |
| 3 | Failed mute remains Live and names the apply failure | ✅ pass |
| 4 | Three collapsed dots mirror the expanded tile states | ✅ pass |
| 5 | Three seconds of audio telemetry change no React render count | ✅ pass |
| 6 | Expanded bar remains within 154px | ✅ pass |

### Testing Library state matrix

The focused suite covers online, degraded, offline, unknown and unbound roles;
collapsed dots; live, muted, pending, failed, offline and authority-locked audio;
U-1, U-2, U-4 and U-5; preview states are also covered by the shared sources
slice. No enumerated S-09 row is missing.

### Scenario demo checklist

| # | State | How reached | Observed |
|---|---|---|---|
| 1 | `online` | `happy`; expand sources | Live green, tappable tiles |
| 2 | `degraded` | `pipeline-crash-midway`; ~5s | Lecturer camera reconnecting with degraded state |
| 3 | `offline` | Same; ~12s | No signal and disabled tile |
| 4 | `unknown` | `ws-flap`; ~5s | Unit-covered checking state rather than stale healthy truth |
| 5 | `unbound` | Inspect expanded bar | Exactly three video tiles; room mic absent |
| 6 | collapsed dots | Collapse bar | Three dots matching tile state order |
| 7 | audio `live` | `happy` | Meter's `--level` changes from telemetry |
| 8 | audio `muted` | Tap switch | Muted applied truth |
| 9 | `gain pending` | Tap ± | Unit-covered pending lock until applied event |
| 10 | `apply failed` | World → Mic changes fail to apply; tap mute | Switch remains Live and failure line appears |
| 11 | `mic offline` | Pipeline scenario; ~20s | Offline mic state and explicit no-signal reason |
| 12 | `locked` | Recorder owned by another user; non-owner lecturer | Unit-covered disabled controls with inline authority reason |
| 13 | U-2 | `ws-flap`; 10s | Unit-covered dimmed tiles and disabled controls |

The remaining-task visual review was omitted by explicit user direction.

---

## S-10 — Source preview lightbox

### Automated gate

| Command | Result |
|---|---|
| `pnpm --filter @eduscope/panel e2e s10-preview` | exit 0 — **6 passed** |
| `pnpm --filter @eduscope/panel test src/screens/sources` | exit 0 — **41 passed** across 6 files |
| `pnpm lint` | exit 0 |
| `pnpm test tools/eslint-rules/gate-boundary.test.ts` | exit 0 — **3 passed** |

### Playwright journeys

| # | Journey | Result |
|---|---|---|
| 1 | Shape-holding skeleton, LIVE state, changing frames, explicit close, recording untouched | ✅ pass |
| 2 | Degraded lecturer-camera preview streams until offline, then replaces the frame with its reason | ✅ pass |
| 3 | Offline source tile is disabled and cannot negotiate | ✅ pass |
| 4 | First painted frame arrives in under one second | ✅ pass |
| 5 | Scrim closes and the explicit close target is at least 44px | ✅ pass |
| 6 | Lightbox bounds remain inside the panel-local overlay | ✅ pass |

### Testing Library state matrix

The focused sources suite covers negotiating, live, all four negotiation error
codes, mid-preview source loss, closed, U-2, U-5, and the regression that closing
a preview issues no recording command. No enumerated S-10 row is missing.

### Scenario demo checklist

| # | State | How reached | Observed |
|---|---|---|---|
| 1 | `negotiating` | `happy`; tap a live tile | Skeleton holds the 16:9 frame shape |
| 2 | `live` | Same tap | LIVE chip and changing mock frames within one second |
| 3 | `source-offline` negotiation failure | Pipeline scenario after camera is offline | Tile is disabled; dedicated failure copy is unit-tested |
| 4 | `source-unbound` / `busy` / `internal` | No live producers | Unit-tested |
| 5 | source offline mid-preview | Open degraded lecturer camera before ~12s | Last frame is removed and the unavailable reason appears |
| 6 | `closed` | Close button or scrim | Lightbox closes; recording state is unchanged |
| 7 | U-2 | `ws-flap` while open | Unit-tested disconnected close reason |

### Approved gate adaptation

- Source health `degraded` remains preview-capable, matching S-09's contract
  that preview may stutter. The mock now ends a preview only when the source
  becomes unavailable, with a focused virtual-clock regression.

The remaining-task visual review was omitted by explicit user direction.

---

## S-11 — Room Controls bar

### Automated gate

| Command | Result |
|---|---|
| `pnpm --filter @eduscope/panel e2e s11-room` | exit 0 — **6 passed** |
| `pnpm --filter @eduscope/panel test src/screens/room` | exit 0 — **45 passed** across 7 files |
| `pnpm lint` | exit 0 |
| `pnpm test tools/eslint-rules/gate-boundary.test.ts` | exit 0 — **3 passed** |
| forbidden-import grep for `not-connected-*.tsx` | zero matches |

### Playwright journeys

| # | Journey | Result |
|---|---|---|
| 1 | Three regions, applied mute, and collapse | ✅ pass |
| 2 | Failed mute preserves Live truth and names the direction | ✅ pass |
| 3 | Expanded idle bar remains within 168px | ✅ pass |
| 4 | Tab order contains exactly Advanced, Collapse, Lecturer Mic, Power off | ✅ pass |
| 5 | S-11 and S-09 read and update one shared microphone truth | ✅ pass |
| 6 | NOT CONNECTED makes no on/off/level/temperature claims | ✅ pass |

### Testing Library state matrix

The focused room suite covers live, muted, pending, apply failed, mic offline,
U-1, U-2 and U-5; collapsed, expanded and Advanced-visible bar states; applied
truth; the shared control; and all three anti-placebo invariants. No enumerated
S-11 row is missing.

### Scenario demo checklist

| # | State | How reached | Observed |
|---|---|---|---|
| 1 | `collapsed` | `happy` | ROOM CONTROLS head with Advanced and Show controls |
| 2 | `expanded` | Show controls | MICROPHONE, POWER and NOT CONNECTED regions within 168px |
| 3 | `advanced visible` | Either role | Unit-tested shared Advanced entry |
| 4 | mic `live` | `happy` | Switch on; Live |
| 5 | mic `muted` | Tap switch | Switch off; Muted |
| 6 | mic `pending` | Tap switch | Unit-tested pending lock with unmoved applied truth |
| 7 | mic `apply failed` | World → Mic changes fail to apply | Still live failure copy and applied switch position |
| 8 | mic `offline` | Pipeline scenario; ~20s | Unit-tested disabled row with inline reason |
| 9 | mic U-2 | `ws-flap`; 10s | Unit-tested not-connected reason |
| 10 | `[D-10]` region | Always | Five inert rows, one notice, no interaction or state claims |

The remaining-task visual review was omitted by explicit user direction.

---

## S-12 — Power-off confirm

### Automated gate

| Command | Result |
|---|---|
| `pnpm --filter @eduscope/panel e2e s12-poweroff` | exit 0 — **6 passed** |
| `pnpm --filter @eduscope/panel test src/screens/room src/shell src/store` | exit 0 — **99 passed** across 16 files |
| `pnpm lint` | exit 0 |
| `pnpm test tools/eslint-rules/gate-boundary.test.ts` | exit 0 — **3 passed** |
| `pnpm gate` | exit 0 — **5 passed**: panel 1a/1b/1e and quiz 1c/1d; Gate 1b covers nine scripts |
| `pnpm typecheck` | exit 0 across all four projects |
| `pnpm test` | exit 0 — **848 passed** across 90 files |

### Playwright journeys

| # | Journey | Result |
|---|---|---|
| 1 | Accepted shutdown fills the panel and suppresses U-2 beyond `T-WS-STALE` | ✅ pass |
| 2 | Recording begun behind the confirm produces the shared reason and lecture-focus remedy | ✅ pass |
| 3 | Destruction requires three taps: expand, entry, confirm | ✅ pass |
| 4 | Live recording disables the entry with its reason inline | ✅ pass |
| 5 | `poweroff-not-halted` traverses other refusal, not-halted, retry and acceptance | ✅ pass |
| 6 | A 202 leaves the pending dialog mounted | ✅ pass |

### Testing Library state matrix

The focused suite covers all ten S-12 rows, the blocked/refused copy identity,
expected-drop suppression and its ordinary-disconnect inverse, the not-halted
ceiling, requester-banner suppression, and no optimistic close. No enumerated
S-12 row is missing.

### Scenario demo checklist

| # | State | How reached | Observed |
|---|---|---|---|
| 1 | `entry available` | `happy` idle; expand Room Controls | Quiet Power off entry in the POWER region |
| 2 | `entry blocked` | Start a recording | Disabled entry, inline shared reason, Go to the lecture |
| 3 | `entry disconnected` | `ws-flap`; 10s | Unit-covered not-connected reason |
| 4 | `confirm` | Tap Power off | Hall-naming dialog; Cancel receives focus |
| 5 | `pending` | Confirm | Powering off…; both actions locked; dialog remains |
| 6 | `refused (recording)` | Open idle dialog; dev Start; wait for S-05; confirm | Shared reason and neutral lecture jump; no destructive action |
| 7 | `accepted` | Confirm while idle | Assertive Shutting down terminal; no reconnecting marker |
| 8 | `accepted, not halted` | `poweroff-not-halted`; second attempt | Not-halted line and one Try again |
| 9 | `refused (other)` | Same scenario; first attempt | Problem title and Close replacing destruction |
| 10 | U-1 | Cold recording snapshot | Unit-covered disabled entry until truth arrives |
| 11 | requester banner suppression | Cause recording refusal while dialog is open | Refusal stays in the dialog; shell banner is suppressed for its lifetime |

The remaining-task visual review was omitted by explicit user direction.

---

## Wave 2 exit condition — J-1

### Happy path

The combined S-04 and S-07 gates demonstrate the unbroken path on `happy` with
AI disabled: login → S-04 → Start → starting without a recording frame → S-05
with red chrome and assured Capture Assurance → Pause with frozen digits →
Resume with ticking digits → Stop → Saving… → Saved → S-04. Mock transition
timing is deterministic: start confirmation **1.2s**, pause **250ms**, resume
confirmation **1.05s**, and Stop-to-Saved **2.5s**.

### Failure path

The S-04 `start-fails` gate demonstrates both attempts without a frame: the
first Start is refused immediately with the named Students Camera reason and no
session row; the second enters starting and reaches the plain-language error in
**1.2s**. MutationObservers prove the red frame never appears, and mock/unit
coverage proves no phantom library row is created.

### Cross-screen couplings

| Coupling | Assertion |
|---|---|
| One elapsed rule across S-07 and S-06 | Task 22 focused dashboard/transport coverage |
| One `AudioControl` truth across S-09 and S-11 | S-11 E2E shared-control journey and room/audio unit tests |
| One `sources.status` truth across S-09 and S-05 | S-05 E2E compares the same lecturer-camera health word in both surfaces |
| S-11 168px envelope → S-05 388px floor | S-11 height E2E plus S-05 both-bars-open floor E2E |

## States with no live producer

| State | Why | Coverage |
|---|---|---|
| S-10 `busy` | One lightbox cannot create two concurrent negotiations on one connection | Testing Library |
| S-10 `internal` | No honest staged server-internal failure exists in the mock | Testing Library |
| S-10 `source-unbound` | The only unbound role is not rendered as a tappable tile | Testing Library |
| S-07 `not owner` | S-06 routes a non-owner to the lock card instead | Testing Library |
| S-04 `recovery pending` | The contract has no distinct recovery snapshot | Testing Library |

## Contract gaps found in passing

- **Candidate CG — boot recovery visibility (W2-D-8).** The contract cannot
  distinguish a boot recovery from a cold pending snapshot. Wave 2 does not
  invent a producer or amend the contract; this remains a candidate row for
  the Wave-3 contract amendment.
