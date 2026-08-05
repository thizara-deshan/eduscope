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

