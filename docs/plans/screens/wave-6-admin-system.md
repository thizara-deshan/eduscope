# Wave 6 — Admin & System (S-28, S-29, S-30, S-31, S-32, S-33, S-34, S-36) Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox
> (`- [ ]`) syntax for tracking. **This project does NOT use
> superpowers:subagent-driven-development** — execute inline, committing after
> each task, and stop for review at the per-screen gates (Tasks 12–19).

**Goal:** Build the eight admin/system Advanced screens — Network Settings
(S-28), Encoder Settings (S-29), Local Storage (S-30), Firmware Update (S-31),
User Management (S-32), Excel bulk import (S-33, overlay on S-32), System Logs
(S-34), and Device & Identity (S-36) — every one a read-or-configure surface
hosted inside the S-25 Advanced shell, admin-only.

**Architecture:** Each screen is a child route under `/advanced` in
`apps/panel/src/screens/advanced/<screen>/`. All data crosses the
`EduscopeClient` boundary (mock adapter today): REST snapshots through TanStack
Query, live transitions through the zustand WS store (`store/ws-store.ts` +
`store/selectors.ts`). Every REST operation and every zod schema these screens
need **already exists** in the client and the mock is already seeded — the work
is the UI, the read/merge hooks, two new WS store slices (`firmware.state`,
`log.entry`), and the scenario/world knobs that make each enumerated state
reachable from the dev overlay.

**Tech Stack:** React 18, react-router 7, TanStack Query 5, zustand 5, zod 3,
Vitest + Testing Library, Playwright. Mock world is a discrete-event simulation
in `packages/api-client/src/mock`.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied
verbatim from the binding docs (`docs/design/frontend-conventions.md` — which
wins over this plan on any conflict — the screen-inventory §5 sections, and
`docs/design/screens/S-36-design.md`).

- **Contract floor: v0.5.0 — no contract change in this wave.** Every endpoint,
  event, enum and zod schema these screens use already exists
  (`packages/shared`, `packages/api-client/src/client.ts`). S-36 is explicitly
  the "a design run can add nothing" case (S-36-design §9). Do **not** amend
  `contracts/` or `packages/shared/src/schemas`.
- **Client boundary (frontend-conventions §1, ENFORCED by `pnpm lint`):** no
  component imports `fetch`, `axios`, `WebSocket`, `XMLHttpRequest`,
  `EventSource`. The only network boundary is `EduscopeClient`
  (`packages/api-client`). Rule source: `tools/eslint-rules/no-direct-network.js`
  (applies to `apps/**` and `packages/**` except `packages/api-client/src/**`).
  The S-34 CSV download builds an object URL from a `Blob` wrapping the string
  `exportLogsCsv` returns — never a hand-assembled network URL.
- **Data flow:** TanStack Query owns request/response; the WS store owns the
  push channel. Screens read WS state through `store/selectors.ts` only — one
  atomic selector per field, or `useWsShallow` for a multi-field read. Never
  call `useWsStore()` with no selector and never return a fresh object/array
  from a bare `useWsStore(...)`.
- **Commands are 202-async:** a `CommandAccepted` means ACCEPTED, not DONE. The
  UI reacts to the resolving WS transition within `TIMERS['T-CMD-RESOLVE']`
  (10 s); after that it renders a failure, never a spinner. No optimistic UI
  unless the screen spec says so. There is no outbound command queue — a command
  tapped while disconnected must not fire on reconnect (U-2).
- **Kiosk & touch (frontend-conventions §3):** fixed 1280×800; the page itself
  never scrolls — only internal regions (`.us-adm__content`) do. Touch targets
  ≥ 44 px (`--tap-min`). No hover-only affordances — row action columns are
  persistent, never hover-revealed. Text fields open the shared on-screen
  keyboard; screens size with `calc(var(--panel-h) - var(--osk-h))` and never
  re-render when it opens. Every icon-only button has an `aria-label`.
- **Tokens (frontend-conventions §6):** no new colour, spacing, or type value.
  Reuse the token sheet (`docs/design/screen-inventory.md §8`,
  `apps/panel/src/styles/tokens.css`). A token that seems missing is a gate
  question, not an in-run mint. S-36 mints nothing (S-36-design §7).
- **Admin gating (U-6):** all eight routes are admin-only. They are already
  registered as `ADVANCED_ADMIN_CHILDREN` in `routes/router.tsx` behind
  `<RequireRole role="admin" redirectTo="/advanced/local-capture">`, and
  `advanced-nav.ts` already filters them out for lecturers. A lecturer never
  sees the nav row and a deep-link lands in their own shell — **never a 403**. A
  `403` reaching the UI is a bug surface, not a normal state.
- **State is always in words, never colour alone (frontend-conventions §3,
  S-36-design §8):** every status (capture `Present/Recovering/Failed`, SMART
  `Good/Warning/Failing/unknown`, publisher `running/exited`, alert severity,
  pressure `ok/warning/critical`) carries a word next to any dot.
- **Testing floor (per screen, frontend-conventions §5):** a Testing Library
  render test for **each enumerated state**; a Playwright primary journey + at
  least one failure scenario; every mock response validates against the
  `contracts/` zod schemas (the mock already calls `validated(...)`
  everywhere). Every enumerated state is reachable from the scenario dev
  overlay.

## Discovered facts the tasks rely on (true in the scaffold today)

- **Routes exist as placeholders.** `routes/router.tsx` maps S-28/S-29/S-30/
  S-31/S-32/S-34/S-36 (and S-35, done) as admin children; each renders
  `<ScreenPlaceholder>` until `ADVANCED_SCREEN_ELEMENTS` gains its real element.
  Tasks wire the real element in. S-33 is an **overlay** on S-32 (no route).
- **The Advanced nav already lists all 10 admin categories** for admins
  (`advanced-nav.ts`), including Device & Identity (`🆔`, `/advanced/device`).
  No nav change is needed.
- **Every REST op already exists and is seeded** (`packages/api-client/src/mock/
  rest/*` + `mock/seed/device.ts`, `mock/seed/users.ts`): `listNetworkConfigs`/
  `updateNetworkConfig`, `listPhysicalInputs`/`updatePhysicalInput`,
  `listSourceBindings`/`updateSourceBinding`, `getEncoderSettings`/
  `updateEncoderSettings`, `getStorageOverview`/`registerStorageVolume`/
  `formatStorageVolume`, `getFirmwareState`/`checkFirmware`/`applyFirmware`,
  `listUsers`/`createUser`/`updateUser`/`deleteUser`/`importUsers`, `queryLogs`/
  `exportLogsCsv`, `getProvisioning`/`getDeviceHealth`/`listAlerts`/
  `acknowledgeAlert`. All are `requireAdmin`-guarded server-side.
- **The WS store already ingests** `device.health`, `system.alert`,
  `storage.status`, `sources.status`, `channel.state` (`store/ws-store.ts`).
  Existing selectors: `useStorageStatus`, `useAlert(id)`, `useSourceStatus`,
  `useIsStale`, `useConnectionPhase`. **Missing** (Task 1 adds): a
  `deviceHealth` selector, an alerts-list selector, a `firmware.state` slice, a
  `log.entry` (live-tail) slice.
- **`firmware.state` and `log.entry` are in the event union** (`zPanelServerEvent`,
  payloads `zFirmwareUpdate` / `zLogEntry`) but the store `ingest` switch falls
  through to `default: return {}` for both. The mock does **not** yet emit
  either — Task 8 wires firmware emission, Task 11 wires log-tail emission.
- **`device.health` WS payload is a partial** (`DeviceHealthPayload`:
  `captureCardState`, `publisherStates`, `ntpSynced`, `clockOffsetMs`,
  `diskHealth`, `lastBootAt` — no `observedAt`, no storage/cpu/temp). The full
  snapshot comes from REST `getDeviceHealth`. Staleness (C-3) is therefore
  **arrival-time based**, not a payload field — Task 1 tracks `deviceHealthAt`.
- **`DeviceHealth` has NO recovery-attempt-count field** (verified against
  `zDeviceHealth`). The capture-card "attempt N of 2 this hour" copy has no
  contract source under the no-contract-change rule. **Resolution:** render the
  documented Machine-5c budget **cap** ("up to 2 recovery attempts per hour",
  a constant from state-machines §6.4) plus the `since` timestamp — never a
  fabricated live counter. Recorded as **plan sub-decision W6-D-1** (§ Decisions).
- **Scenario/world seams:** the dev overlay (`devtools/scenario-overlay.tsx`)
  renders `listScenarios()` as radios automatically (a new script in the
  registry appears with no overlay edit), but **each `WorldSeed` knob needs an
  explicit control added to that file**. `extendScenario(name, ...rules)` pushes
  forced rules; a script's `timeline`/`emits` drive machine transitions/raw
  events with no command behind them. e2e drives the overlay via a 2 s
  long-press on `scenario-hotspot` then a radio by name (see
  `e2e/s25-advanced.spec.ts`, `e2e/s35-uploads.spec.ts`).
- **e2e credentials:** admin = `admin` / `battery-staple`; lecturer =
  `a.perera` / `correct-horse`. Navigate to Advanced: `Show controls` →
  `Advanced` → nav button by label. The seeded `firmware.update-available`
  info alert overlaps the S-25 topbar — dismiss it first in geometry-sensitive
  specs (see `s25-advanced.spec.ts`'s `dismissAlerts`).
- **Seed baseline** (`mock/seed/device.ts` / `users.ts`): provisioning complete
  (G-PROVISIONED passes); health `present`/`good`, `ntpSynced:true`,
  `publisherStates: {}` (Task 2 seeds real rows); 2 alerts (one uncleared info
  `firmware.update-available`, one cleared `source.degraded`); one mounted
  `recordings` volume (SMART good); two network configs (LAN static + vLAN
  dhcp); encoder profile + capabilities where **`codecs: ['h264']` only**
  (H.265/AV1 are prototype fiction, B-56); one stream target; firmware `idle`
  with `rollbackVersion` set; 6 logs; four users spanning
  `local`/`institute` source, `mustResetPassword`, and `disabled`.

## State → scenario / world demonstration map (the dev-overlay checklist)

New scenario script (Task 2): **`capture-fault`**. New `WorldSeed` knobs
(declared Task 2; consumed as noted): `provisioned`, `clockSynced`, `diskHealth`,
`networkApplyFails`, `firmwareOutcome`, `userImportRejects`.

| Screen · state | How it is reached from the dev overlay |
|---|---|
| **S-28** loading / populated | cold mount / default `happy` (LAN, vLAN, camera-IP cards from seed) |
| S-28 dirty / validating | edit a field / type an invalid IP-CIDR (client validation) |
| S-28 applying → applied | edit + Apply → `updateNetworkConfig` 202, row re-read shows new `appliedAt` |
| S-28 apply failed | World knob **`networkApplyFails:true`** → row readback carries `lastApplyError` + a `system.alert`; prior config stays in effect |
| S-28 self-lockout warning | edit the **LAN** interface address (client-side warning, no scenario) |
| S-28 camera rebind | edit a camera IP → `updatePhysicalInput` re-probes the role: tile `unknown` → `online` (Task 5 wires the mock re-probe) |
| S-28 no-Wi-Fi | always — structural test asserts no SSID field exists |
| **S-29** loading / populated | cold mount / `happy` — only capability-backed options render (`codecs:['h264']`; H.265/AV1 absent) |
| S-29 dirty / saving | move the bitrate stepper / Save → `updateEncoderSettings` |
| S-29 save rejected (422) | set bitrate outside `capabilities.videoBitrateKbps` {2000..8000} → mock 422 with the offending field |
| S-29 applies-next-session notice | always shown while dirty (an encoder change never applies mid-lecture) |
| **S-30** loading / populated | cold mount / `happy` (stats, SMART line, volume list, retention policy in real numbers) |
| S-30 pressure ok/warning/critical | World radio **`Storage: ok/warning/critical`** (existing `storagePressure` knob) |
| S-30 disk good/warning/failing/unknown | World knob **`diskHealth`** (Task 2) |
| S-30 register drive pending/registered/409/422 | Register form → `registerStorageVolume` (409 via `disk-full`-style duplicate uuid; 422 via bad uuid) |
| S-30 format confirm / refused(recording) / formatting / failed | Danger-zone Format: type-to-confirm the volume label; refused via `format.refused` while recording (Start from overlay first); failed via `disk-full` |
| S-30 retention blocked | `disk-full` scenario surfaces never-uploaded-past-retention items |
| **S-31** idle / checking / up-to-date / update-available | `happy` (`getFirmwareState` idle) → Check → knob **`firmwareOutcome`** selects the terminal (`up-to-date` vs `update-available`) |
| S-31 downloading / verifying / applying / done | Apply under `firmwareOutcome:'update-available'` steps through phases via `firmware.state` emits (Task 8) |
| S-31 signature failed | knob `firmwareOutcome:'signature-fail'` — a distinct, loud `verifying`→`failed` |
| S-31 failed / rolled-back | knob `firmwareOutcome:'apply-fail'` / `'rolled-back'` |
| S-31 refused while recording | Start from overlay, then Apply → mock 409 |
| **S-32** loading / populated | cold mount / `happy` (4 seed users: local+institute, mustReset, disabled) |
| S-32 empty (no match) | search `q=` that matches nothing (`.us-adm__note`) |
| S-32 search / role filter / pagination | type in search / role chip / Load more (seed page has a cursor when limit is small) |
| S-32 add user pending/created/409/422 | Add User form → `createUser`; 409 via an existing username (`admin`) |
| S-32 edit user / institute-sourced read-only | ⋯→Edit on `a.perera` (source `institute` → roster-owned fields read-only) |
| S-32 delete user / refuse-last-admin-or-self | ⋯→Delete on `n.silva`; deleting `admin` (self / last admin) is refused client-side (CG-9) |
| **S-33** idle / file selected / uploading / accepted | open Bulk Import overlay → pick a file → `importUsers` (default `applied`) |
| S-33 rejected (the headline state) | World knob **`userImportRejects:true`** → `UserImportBatch{state:'rejected', rejections[]}`, "nothing was imported" |
| S-33 wrong file type / unreadable | pick a `.txt` (client-side reject before upload) |
| **S-34** loading / empty(no logs) / empty(no match) | cold mount / knob-free empty via a `q` that matches nothing vs a level with no rows |
| S-34 populated / filtering / session drill-in | `happy` (6 seed logs) → level/category chips, search, `sessionId` |
| S-34 live tail / tail stale (U-2) | `GET /logs` subscribes → `log.entry` emits (Task 11); `ws-flap` marks the tail stale while the query still works |
| S-34 exporting / export ready / export failed | Export CSV → `exportLogsCsv` (same filter set); failed via a refuse rule |
| **S-36** loading / populated | cold mount / `happy` |
| S-36 not provisioned | World knob **`provisioned:false`** → `hallCode` + `expectedStorageVolumeUuid` null; banner names both fields |
| S-36 clock unsynced | World knob **`clockSynced:false`** → `ntpSynced:false`, `clockOffsetMs:4200`, an uncleared `clock` system.alert |
| S-36 capture present | `happy` (seed `present`) |
| S-36 capture absent / recovering / failed | Scenario **`capture-fault`** drives `present → absent → recovering → failed` |
| S-36 publisher running/exited (+ lastErrorCode) | `happy` — Task 2 seeds `publisherStates` incl. a `mic-lecturer` `exited` row with `lastErrorCode` |
| S-36 health stale | `ws-flap` — after `T-WS-STALE` every health value reads "— checking…", never last-healthy |
| S-36 alerts populated / acknowledged-still-active | `happy` (seed alerts) → Acknowledge; the row stays labelled "✓ acknowledged · still active" |
| S-36 alert cleared / no active alerts | Show-cleared toggle reveals the cleared `source.degraded`; empty via acknowledging/clearing all (calm "No active alerts.") |
| S-36 acknowledge pending (U-4) / U-5 refused | tap Acknowledge (pending → echo); 404 (already cleared) → benign reason next to the button |

---

## Task 1: WS store slices & selectors for firmware, logs, device-health & alerts

Mechanical — full code. Adds the two missing live slices (`firmware.state`,
`log.entry`), arrival-time tracking for device health (C-3 staleness), and the
list/atomic selectors the admin screens read.

**Files:**
- Modify: `apps/panel/src/store/ws-store.ts`
- Modify: `apps/panel/src/store/selectors.ts`
- Test: `apps/panel/src/store/ws-store.test.ts`
- Test: `apps/panel/src/store/selectors.test.tsx`

**Interfaces:**
- Produces (consumed by Tasks 3, 8, 11):
  - `WsState.firmware: FirmwareUpdate | null`
  - `WsState.logTail: LogEntry[]` (bounded ring, newest last, max 200)
  - `WsState.deviceHealthAt: number | null` (`Date.now()` at last `device.health`)
  - selectors: `useFirmwareState()`, `useLogTail()`, `useDeviceHealth()`
    (`{ health: DeviceHealthPayload | null; healthAt: number | null }`),
    `useAlertsList()` (`SystemAlert[]`)

- [ ] **Step 1: Write the failing test** in `ws-store.test.ts`

```ts
it('ingests firmware.state as the latest full read view', () => {
  useWsStore.getState().ingest(envelope('firmware.state', {
    id: 'F1', currentVersion: '2026.1.3', availableVersion: '2026.2.0',
    state: 'downloading', signatureVerified: true, rollbackVersion: '2026.1.2',
    startedAt: null, finishedAt: null, lastError: null,
  }, 0));
  expect(useWsStore.getState().firmware?.state).toBe('downloading');
});

it('appends log.entry to a bounded tail (max 200, newest last)', () => {
  for (let i = 0; i < 205; i += 1) {
    useWsStore.getState().ingest(envelope('log.entry', {
      id: `L${i}`, at: '2026-08-10T09:00:00.000Z', level: 'INFO', category: 'System',
      service: 'core-api', message: `m${i}`, sessionId: null, userId: null, context: null,
    }, i + 1));
  }
  const tail = useWsStore.getState().logTail;
  expect(tail).toHaveLength(200);
  expect(tail[tail.length - 1]?.id).toBe('L204');
});

it('records deviceHealthAt when device.health arrives', () => {
  useWsStore.getState().ingest(envelope('device.health', {
    captureCardState: 'present', publisherStates: {}, ntpSynced: true,
    clockOffsetMs: 0, diskHealth: 'good', lastBootAt: '2026-08-10T06:00:00.000Z',
  }, 300));
  expect(useWsStore.getState().deviceHealthAt).not.toBeNull();
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @eduscope/panel test -- store/ws-store.test.ts`
Expected: FAIL (`firmware`/`logTail`/`deviceHealthAt` undefined).

- [ ] **Step 3: Add fields, EMPTY defaults, ingest cases & imports** in `ws-store.ts`

Add to the `@eduscope/shared` value/type import: `FirmwareUpdate, LogEntry`.
Add to `interface WsState` (near `deviceHealth`):

```ts
  /** S-31: latest firmware.state full read view. */
  firmware: FirmwareUpdate | null;
  /** S-34: bounded live-tail ring (newest last, max 200). */
  logTail: LogEntry[];
  /** S-36 C-3: wall-clock of the last device.health, for T-HEALTH-STALE staleness. */
  deviceHealthAt: number | null;
```

Add to `EMPTY`: `firmware: null, logTail: [], deviceHealthAt: null,`.

Change the existing `device.health` case and add the two new cases in the
ingest `switch`:

```ts
        case 'device.health':
          return { deviceHealth: envelope.payload, deviceHealthAt: Date.now() };
        case 'firmware.state':
          return { firmware: envelope.payload };
        case 'log.entry': {
          const next = [...get().logTail, envelope.payload];
          if (next.length > 200) next.splice(0, next.length - 200);
          return { logTail: next };
        }
```

(Leave the `default: return {}` — every other catalog event keeps its behaviour.)

- [ ] **Step 4: Run the store test to green**

Run: `pnpm --filter @eduscope/panel test -- store/ws-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Add selectors** in `selectors.ts`

```ts
import type { SystemAlert } from '@eduscope/shared';

/** S-30/S-36: the live device.health snapshot + when it last arrived (C-3 staleness). */
export const useDeviceHealth = () =>
  useWsShallow((s) => ({ health: s.deviceHealth, healthAt: s.deviceHealthAt }));
/** S-36: uncleared alerts as a stable array (the store prunes cleared rows on ingest). */
export const useAlertsList = (): SystemAlert[] => useWsShallow((s) => Object.values(s.alerts));
/** S-31: latest firmware.state. */
export const useFirmwareState = () => useWsStore((s) => s.firmware);
/** S-34: live log tail. */
export const useLogTail = () => useWsShallow((s) => s.logTail);
```

- [ ] **Step 6: Write a selector test** in `selectors.test.tsx` asserting
  `useAlertsList()` returns `[]` initially and the ingested alert after a
  `system.alert` envelope; `useDeviceHealth()` returns `{ health: null,
  healthAt: null }` initially. Run:

Run: `pnpm --filter @eduscope/panel test -- store/selectors.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/panel/src/store
git commit -m "feat(wave6): firmware/log-tail WS slices + device-health & alerts selectors"
```

---

## Task 2: Scenario & world-knob foundation (capture-fault, admin world knobs, publisher seed)

Mechanical — full code. Adds the shared scenario/seed seams every later admin
task consumes: the new `WorldSeed` knobs (type + defaults + overlay controls),
seeded `publisherStates`, a seeded `clock` alert path, and the `capture-fault`
script.

**Files:**
- Modify: `packages/api-client/src/mock/scenario/types.ts` (`WorldSeed`, `ScenarioName`)
- Modify: `packages/api-client/src/mock/scenario/registry.ts` (register `capture-fault`)
- Create: `packages/api-client/src/mock/scenario/scripts/capture-fault.ts`
- Modify: `packages/api-client/src/mock/seed/device.ts` (knob branches + publishers)
- Modify: `apps/panel/src/devtools/scenario-overlay.tsx` (world-knob controls)
- Test: `packages/api-client/src/mock/scenario/scenario.test.ts` (or the existing scenario test file)

**Interfaces:**
- Produces (consumed by Tasks 3–11): `WorldSeed` gains
  `provisioned: boolean` (default `true`), `clockSynced: boolean` (default
  `true`), `diskHealth: SmartStatus` (default `'good'`), `networkApplyFails:
  boolean` (default `false`), `firmwareOutcome: 'up-to-date' | 'update-available'
  | 'signature-fail' | 'apply-fail' | 'rolled-back'` (default `'update-available'`),
  `userImportRejects: boolean` (default `false`). `ScenarioName` gains
  `'capture-fault'`.

- [ ] **Step 1: Add the knobs to `WorldSeed`** in `types.ts`

```ts
  /** Wave 6 S-36 — when false, hallCode + expectedStorageVolumeUuid are null (not-provisioned). */
  readonly provisioned: boolean;
  /** Wave 6 S-36 — when false, ntpSynced=false, clockOffsetMs large, and a clock system.alert is raised. */
  readonly clockSynced: boolean;
  /** Wave 6 S-30/S-36 — SMART status for the device health + recordings volume. */
  readonly diskHealth: 'good' | 'warning' | 'failing' | 'unknown';
  /** Wave 6 S-28 — updateNetworkConfig readback carries lastApplyError + raises an alert; prior config stays. */
  readonly networkApplyFails: boolean;
  /** Wave 6 S-31 — which terminal the firmware check/apply lifecycle drives to. */
  readonly firmwareOutcome: 'up-to-date' | 'update-available' | 'signature-fail' | 'apply-fail' | 'rolled-back';
  /** Wave 6 S-33 — importUsers returns a rejected batch with row-level reasons, writing nothing. */
  readonly userImportRejects: boolean;
```

Add `'capture-fault'` to the `ScenarioName` union with a `/** Added for Wave 6
S-36. */` comment.

- [ ] **Step 2: Wire the defaults** wherever `WorldSeed` defaults are assembled
  (the `createSeed(overrides)` call chain / `world.ts` default seed). Grep for
  an existing default like `recordingsPresent: true` and add the six new keys
  beside it with the defaults above. Run `pnpm --filter @eduscope/api-client
  typecheck` to confirm no missing-field errors remain.

- [ ] **Step 3: Consume the knobs + seed publishers** in `seed/device.ts`

In `createDeviceSeed`, read the knobs and adjust `provisioning`, `deviceHealth`,
the volume SMART, and `alerts`:

```ts
  const provisioned = overrides.provisioned ?? true;
  const clockSynced = overrides.clockSynced ?? true;
  const diskHealth = overrides.diskHealth ?? 'good';
```

- In `provisioning`, when `!provisioned` set `hallCode: null`,
  `hallDisplayName: null`, `expectedStorageVolumeUuid: null` (leave every other
  field set — the "fields that ARE set still show" case, S-36-design §2.2).
- In `deviceHealth`, set `diskHealth`, `ntpSynced: clockSynced`,
  `clockOffsetMs: clockSynced ? 12 : 4200`, and replace `publisherStates: {}`
  with three rows:

```ts
    publisherStates: {
      presentation:   { status: 'running', lastErrorCode: null,        since: SEED_EPOCH },
      'lecturer-cam': { status: 'running', lastErrorCode: null,        since: SEED_EPOCH },
      'mic-lecturer': { status: 'exited',  lastErrorCode: 'alsa_xrun', since: SEED_EPOCH },
    },
```

- On `volume`, set `smartStatus: diskHealth`.
- Append a `clock` alert to `alerts` when `!clockSynced` (uncleared, so it shows
  and re-raises, C-4):

```ts
    ...(clockSynced ? [] : [{
      id: seedId('alert'), code: 'clock.unsynced', severity: 'warning' as const,
      category: 'System' as const, title: 'Clock is not synced',
      detail: 'Generated titles and retention may be off until NTP recovers.',
      raisedAt: SEED_EPOCH, clearedAt: null, clearedReason: null,
      acknowledgedBy: null, context: null, relatedEntity: null,
    }]),
```

Also apply `diskHealth` to `getDeviceHealth` output — note `rest/provisioning.ts`
already spreads `seed.deviceHealth`, so seeding it is enough; confirm during the
task that `getDeviceHealth` returns the seeded `diskHealth`/`publisherStates`.

- [ ] **Step 4: Create `capture-fault.ts`**

```ts
import type { ScenarioScript } from '../types.js';

/**
 * Machine 5c (state-machines §6.4): the presentation capture card drops out and
 * the supervised watchdog fails to recover it. Drives present → absent →
 * recovering → failed so S-36 can render each capture state and the "camera-only
 * recording still works" reassurance (A-08, S-36-design §2.4).
 */
export const captureFault: ScenarioScript = {
  name: 'capture-fault',
  description:
    'The presentation capture card is lost and the watchdog cannot recover it: ' +
    'present → absent → recovering → failed. Camera-only recording keeps working.',
  // HL-21 (absent → recovering) auto-fires HL-22 (recover) after 1.5 s; intercept
  // that to HL-23 so recovering ends in failed, not present.
  forced: [{ on: { transition: 'HL-22' }, replace: 'HL-23' }],
  timeline: [
    { transition: 'HL-20', afterMs: 2_000 }, // present → absent
    { transition: 'HL-21', afterMs: 4_000 }, // absent → recovering (→ HL-23 failed)
  ],
};
```

- [ ] **Step 5: Register it** in `registry.ts` — import `captureFault` and add
  `'capture-fault': captureFault,` to `CATALOG`.

- [ ] **Step 6: Add overlay controls** in `scenario-overlay.tsx` for the six
  knobs (inside the `<fieldset className="us-devoverlay__world">`), matching the
  existing pattern: booleans as checkboxes, `diskHealth`/`firmwareOutcome` as
  radio groups (like `storagePressure`). Each `onChange` calls
  `rebuild(active, { ...seed, <knob>: <value> })` and carries an `aria-label`.
  Example (boolean):

```tsx
            <label>
              <input
                type="checkbox"
                checked={!client.worldSeed.provisioned}
                onChange={(e) => rebuild(active, { ...seed, provisioned: !e.target.checked })}
                aria-label="Device not provisioned"
              />
              Device not provisioned
            </label>
```

- [ ] **Step 7: Test** the scenario + seed. In the scenario test file assert
  `getScenario('capture-fault')` exists and its `forced[0].replace === 'HL-23'`;
  in a mock test assert `createDeviceSeed({ provisioned: false }).provisioning
  .hallCode === null` and `createDeviceSeed({ clockSynced: false }).deviceHealth
  .ntpSynced === false` and that a `clock.unsynced` alert is present. Run:

Run: `pnpm --filter @eduscope/api-client test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/api-client/src apps/panel/src/devtools
git commit -m "feat(wave6): capture-fault scenario + admin world knobs + seeded publisher states"
```

---

## Task 3: S-36 Device & Identity — data hooks

The three read/merge hooks (S-36-design §4). No component code yet.

**Files:**
- Create: `apps/panel/src/screens/advanced/device/use-provisioning.ts`
- Create: `apps/panel/src/screens/advanced/device/use-device-health.ts`
- Create: `apps/panel/src/screens/advanced/device/use-alerts.ts`
- Create: `apps/panel/src/screens/advanced/device/query-keys.ts`
- Test: co-located `*.test.ts` for each hook.

> **Note on the name collision:** a `shell/use-provisioning.ts` already exists
> (it returns only `hallDisplayName` for S-03's header and is the
> session-revocation detector). This is a **different** hook in a different
> directory — do not merge them. The device hook returns the full
> `DeviceProvisioning` + derived missing-fields, and must **not** set
> `retry: false` (that behaviour is specific to the shell detector).

**Interfaces:**
- Produces (consumed by Task 4):
  - `useProvisioning(): { provisioning: DeviceProvisioning | undefined; loading: boolean; missingFields: string[] }`
    — `missingFields` is the `G-PROVISIONED` derivation: the human labels of any
    of `hallCode` / `expectedStorageVolumeUuid` that are `null`/absent.
  - `useDeviceHealth(): { health: DeviceHealth | undefined; loading: boolean; isStale: boolean }`
    — REST `getDeviceHealth` snapshot merged with the live `device.health`
    partial; `isStale` is `useIsStale()` OR (`healthAt !== null` and
    `now - healthAt > TIMERS['T-HEALTH-STALE']`), recomputed on a `useTicker`.
  - `useAlerts({ includeCleared }): { alerts: SystemAlert[]; loading: boolean; acknowledge(id): void; ackPending: string | null; ackError: string | null }`
    — REST `listAlerts` merged with live `system.alert` (store already prunes
    cleared rows; `includeCleared` re-fetches with the flag). `acknowledge`
    calls `acknowledgeAlert`, holds `ackPending=id` until the `system.alert`
    echo (ceiling `T-CMD-RESOLVE`), maps a 404 to `ackError` (U-5).

- [ ] **Step 1: `query-keys.ts`** — export `DEVICE_KEYS = { provisioning:
  ['provisioning'] as const, health: ['device-health'] as const, alerts:
  (includeCleared: boolean) => ['alerts', { includeCleared }] as const }`.
  (Note the existing `['provisioning']` shell key is compatible — both read the
  same endpoint; keep the string identical so they share cache.)

- [ ] **Step 2: Write the failing test for `use-provisioning`** — render the
  hook with a mock client returning a provisioning row with `hallCode: null`;
  assert `missingFields` includes `'Hall code'` and excludes set fields. Run
  and confirm it fails (module not found).

- [ ] **Step 3: Implement `use-provisioning.ts`** — `useQuery` on
  `DEVICE_KEYS.provisioning` → `client.getProvisioning()`; derive
  `missingFields` from the required-field map `{ hallCode: 'Hall code',
  expectedStorageVolumeUuid: 'Expected storage volume' }`. Run the test to
  green.

- [ ] **Step 4: Write the failing test for `use-device-health`** — feed a REST
  snapshot (`observedAt` now) with no WS event and assert `isStale === false`;
  then set the store `stale` flag and assert `isStale === true`. Confirm it
  fails.

- [ ] **Step 5: Implement `use-device-health.ts`** — `useQuery` on
  `DEVICE_KEYS.health` → `client.getDeviceHealth()`; read `useDeviceHealth()`
  (store) + `useIsStale()`; merge the live partial over the snapshot; derive
  `isStale` per the interface using `useTicker` (`hooks/use-ticker.ts`) at ~1 s
  and `TIMERS['T-HEALTH-STALE']`. Run to green.

- [ ] **Step 6: Write the failing test for `use-alerts`** — mock
  `listAlerts` returns one uncleared alert; `acknowledge(id)` calls
  `acknowledgeAlert` and, on the returned row with `clearedAt: null`, keeps the
  alert in the list (it must NOT vanish, C-4). Also assert a rejected
  `acknowledgeAlert` (404) sets `ackError`. Confirm it fails.

- [ ] **Step 7: Implement `use-alerts.ts`** — `useQuery` on
  `DEVICE_KEYS.alerts(includeCleared)` → `client.listAlerts({ includeCleared })`;
  merge with `useAlertsList()`; a `useMutation` for `acknowledgeAlert` sets
  `ackPending`, resolves on the echoed `system.alert` (or `T-CMD-RESOLVE`
  ceiling), maps 404 → `ackError`. Run to green.

- [ ] **Step 8: Run all three hook tests + typecheck**

Run: `pnpm --filter @eduscope/panel test -- screens/advanced/device`
Then: `pnpm --filter @eduscope/panel typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/panel/src/screens/advanced/device
git commit -m "feat(S-36): provisioning/device-health/alerts read hooks"
```

---

## Task 4: S-36 Device & Identity — screen, cards & tests

The stacked status-sheet column (S-36-design §2, §4). No full component code here
— build to the wireframe and the copy deck (§6) and token table (§7).

**Files:**
- Create: `apps/panel/src/screens/advanced/device/device-identity-screen.tsx`
- Create: `apps/panel/src/screens/advanced/device/identity-card.tsx`
- Create: `apps/panel/src/screens/advanced/device/feature-flags-panel.tsx`
- Create: `apps/panel/src/screens/advanced/device/time-clock-card.tsx`
- Create: `apps/panel/src/screens/advanced/device/device-health-card.tsx`
- Create: `apps/panel/src/screens/advanced/device/publisher-states-table.tsx`
- Create: `apps/panel/src/screens/advanced/device/alert-list.tsx`
- Create: `apps/panel/src/screens/advanced/device/alert-row.tsx`
- Create: `apps/panel/src/screens/advanced/device/copy-id.tsx`
- Create: `apps/panel/src/screens/advanced/device/device.css`
- Modify: `apps/panel/src/routes/router.tsx` (`ADVANCED_SCREEN_ELEMENTS['S-36']`)
- Test: co-located `*.test.tsx` per component.

**Component breakdown** (S-36-design §4 table is authoritative):
- `device-identity-screen.tsx` — title + `Provisioned`/`Not provisioned` summary
  chip; the not-provisioned banner naming `missingFields` (§2.2); stacks the
  five cards in `.us-adm__content`; `data-screen="S-36"`.
- `identity-card.tsx` — `DeviceProvisioning` read view; `<CopyId>` on device id /
  serial / hall code / storage uuid; `— not set (required)` in `--danger` for
  each missing field; serial `null` → `not recorded`.
- `feature-flags-panel.tsx` — legible On/Off (Off is `--text-faint`, neutral);
  the AI-off line "Off — turned off for this room; recording is unaffected";
  `llmEndpoint` null → "not configured — AI studio unavailable"; `quizServerBaseUrl`
  null → "not configured — quiz features unavailable".
- `time-clock-card.tsx` — timezone / ntpServers / synced offset; `ntpSynced:false`
  → `--warning` + "Clock not synced · offset {n} ms" + pointer to the System alert.
- `device-health-card.tsx` — observed line ("observed {time} · refreshes every
  60 s"; stale → "last update was {n} s ago" in `--warning` and all values
  "— checking…"); capture-card state **in words** + the budget cap ("up to 2
  recovery attempts per hour", W6-D-1) + `since`; SMART line (`unknown` legit,
  `--text-faint`) + free/total + `Manage → S-30` link; cpu/temp/last-boot; embeds
  `<PublisherStatesTable>`.
- `publisher-states-table.tsx` — per-`SourceRoleId` process row: status word +
  `since` + `err: {lastErrorCode}` when set (surfaced, not swallowed).
- `alert-list.tsx` — `Show cleared` toggle (re-fetch with `includeCleared`);
  "No active alerts." calm empty; `role="list"`.
- `alert-row.tsx` — `article` named `{severity} {title}`; severity glyph+word,
  category, title, detail, `raisedAt`; `Acknowledge` (`--surface-2` neutral,
  ≥ 44 px) → pending → "✓ acknowledged · still active"; never says "resolved";
  disabled while `useIsStale()`.
- `copy-id.tsx` — `⧉` copy button (≥ 44 px, `aria-label`), writes
  `navigator.clipboard`, announces "Copied {label}" via `aria-live`.

**State → demonstration:** see the map above (S-36 rows). New forced transitions
needed: the `capture-fault` script (Task 2) for absent/recovering/failed; knobs
`provisioned`/`clockSynced` (Task 2); `ws-flap` (existing) for health-stale.

**Testing Library list** (one per §5.1 state — S-36-design §13):
1. `loading` — skeleton card shapes, no full-screen spinner.
2. `populated` — identity fields, features legible, health present, alerts render.
3. `not provisioned` — banner names `Hall code` **and** `Expected storage
   volume`; inline `— not set (required)` markers; **health and alerts still
   render** (assert a health value and an alert row are present).
4. `clock unsynced` — Time card `--warning`, offset shown, pointer to the alert.
5. capture `present` / `absent` / `recovering` (asserts the "up to 2 … per hour"
   budget cap text, **not** a fabricated counter) / `failed` (asserts "camera-only
   recording still works").
6. publisher `exited` — asserts `alsa_xrun` `lastErrorCode` is shown.
7. `health stale` (**headline, INV-DH-2/C-3**) — with the store `stale` flag set,
   every health value reads "— checking…" and **no** `Present`/`Good`/`running`
   survives anywhere in the card.
8. alerts populated / `acknowledged still active` (**headline, INV-SA-1/C-4**) —
   after `acknowledge`, the row **stays**, labelled "✓ acknowledged · still
   active", never removed; copy never says "resolved".
9. `alert cleared` — visible only under Show cleared.
10. `no active alerts` — the calm line.
11. `acknowledge pending` (U-4) — pending on the button, resolves on echo.
12. `U-2` — health/alert regions dimmed + not-live; **identity stays crisp**;
    Acknowledge disabled.
13. `U-5` — 404 on acknowledge → benign reason next to the button.
14. **Read-only structural (C-1)** — no `input`; no `button` matching
    `/save|edit|apply/i`; only buttons are CopyId, Acknowledge, Show-cleared.
15. **Feature/recording independence (C-5, INV-DP-4)** — `aiQuizEnabled:false`
    renders AI neutral Off while Recording shows On.
16. `copy-id` — clicking copies and announces "Copied {label}" (mock
    `navigator.clipboard`).

- [ ] **Step 1:** Build `copy-id.tsx` + test (clipboard write + aria-live).
- [ ] **Step 2:** Build `identity-card.tsx` + `feature-flags-panel.tsx` +
  `time-clock-card.tsx` with tests (states 2, 3, 4, 15).
- [ ] **Step 3:** Build `publisher-states-table.tsx` + `device-health-card.tsx`
  with tests (states 5, 6, 7).
- [ ] **Step 4:** Build `alert-row.tsx` + `alert-list.tsx` with tests (states 8,
  9, 10, 11, 13).
- [ ] **Step 5:** Build `device-identity-screen.tsx` (chip, banner, stack) with
  tests (states 1, 2, 3, 12, 14) and wire `ADVANCED_SCREEN_ELEMENTS['S-36'] =
  () => <DeviceIdentityScreen />` in `router.tsx` (import it).
- [ ] **Step 6:** Run the screen's tests + boundary lint + typecheck.

Run: `pnpm --filter @eduscope/panel test -- screens/advanced/device`
Run: `pnpm lint`
Run: `pnpm --filter @eduscope/panel typecheck`
Expected: PASS; lint reports no direct-network import.

- [ ] **Step 7: Commit**

```bash
git add apps/panel/src/screens/advanced/device apps/panel/src/routes/router.tsx
git commit -m "feat(S-36): device & identity status sheet + route wiring"
```

---

## Task 5: S-28 Network Settings

Screen-inventory §5 S-28. LAN + vLAN + camera-IP cards; 202 + row readback;
octet/numeric touch inputs.

**Files:**
- Create: `apps/panel/src/screens/advanced/network/network-screen.tsx`
- Create: `apps/panel/src/screens/advanced/network/network-card.tsx` (one card: LAN or vLAN)
- Create: `apps/panel/src/screens/advanced/network/camera-ip-card.tsx`
- Create: `apps/panel/src/screens/advanced/network/ip-input.tsx` (octet-segmented numeric field)
- Create: `apps/panel/src/screens/advanced/network/ip-validate.ts` (pure IPv4/CIDR checks)
- Create: `apps/panel/src/screens/advanced/network/use-network-config.ts`
- Create: `apps/panel/src/screens/advanced/network/use-camera-bindings.ts`
- Create: `apps/panel/src/screens/advanced/network/network.css`
- Modify: `apps/panel/src/routes/router.tsx` (`ADVANCED_SCREEN_ELEMENTS['S-28']`)
- Modify (mock, full code below): `packages/api-client/src/mock/rest/sources.ts` (camera re-probe) and `packages/api-client/src/mock/rest/settings.ts` (`networkApplyFails`)
- Test: co-located tests + `ip-validate.test.ts`.

**Component/hook breakdown:**
- `use-network-config.ts` — `listNetworkConfigs` snapshot; `updateNetworkConfig`
  (202 → re-read the row; the row carries `appliedAt`/`lastApplyError`, contract
  C-5 — there is no `network.apply` event); exposes per-card dirty + apply state.
- `use-camera-bindings.ts` — `listPhysicalInputs` + `listSourceBindings` +
  `getSourcesStatus`, merged with live `sources.status` (existing
  `useSourceStatus`); `updatePhysicalInput` edits the camera address in **exactly
  one place** (INV-PI-2).
- `ip-validate.ts` — pure functions `isValidIpv4(s)`, `isValidCidr(s)`; no I/O.
- `ip-input.tsx` — four octet fields + prefix; numeric OSK layout; no free-text.
- `network-card.tsx` — LAN/vLAN card with dirty marker, Apply, applying spinner,
  `lastApplyError` readback, and the **self-lockout warning** when the edited
  interface is the LAN address the panel talks to.
- `camera-ip-card.tsx` — CAM 1 / CAM 2 address; Save re-probes → tile
  `unknown` → `online`/`offline`.

- [ ] **Step 1: Mock wiring — camera re-probe** (full code) in `rest/sources.ts`,
  end of `updatePhysicalInput`, before `return`:

```ts
      // Editing a bound camera address re-probes its role (HL-09): the tile goes
      // unknown, then resolves online shortly after (S-28 camera-rebind state).
      const binding = seed.sourceBindings.find((b) => b.physicalInputId === inputId && b.enabled);
      if (binding && BOUND_SOURCE_ROLES.includes(binding.roleId)) {
        world.apply(sourceTransitionId(binding.roleId, 'HL-08')); // any → unknown
        world.clock.setTimeout(() => world.apply(sourceTransitionId(binding.roleId, 'HL-02')), 1_200); // → online
      }
```

Add the imports `BOUND_SOURCE_ROLES` (already imported) and `sourceTransitionId`
(from `../machines/health.js`).

- [ ] **Step 2: Mock wiring — apply-failed knob** (full code) in
  `rest/settings.ts` `updateNetworkConfig`, replace the success `Object.assign`
  block with a knob branch:

```ts
      if (ctx.worldSeed.networkApplyFails) {
        row.lastApplyError = 'Interface did not come back up; previous config kept.';
        world.emit('system.alert', validated(zSystemAlert, {
          id: nextUlid(world), code: 'network.apply-failed', severity: 'error',
          category: 'System', title: 'Network apply failed', detail: row.lastApplyError,
          raisedAt: nowIsoZ(world.clock), clearedAt: null, clearedReason: null,
          acknowledgedBy: null, context: null, relatedEntity: null,
        }));
      } else {
        Object.assign(row, { /* existing field spread */ appliedAt: nowIsoZ(world.clock), lastApplyError: null });
      }
```

Import `zSystemAlert` and `validated`. (This keeps the 202 return unchanged — the
UI reacts by re-reading the row.)

- [ ] **Step 3: `ip-validate.ts` + test** — write failing tests for
  `isValidIpv4('10.20.4.12') === true`, `isValidIpv4('999.1.1.1') === false`,
  `isValidCidr('10.20.4.0/24') === true`. Implement. Run to green.

- [ ] **Step 4:** Build `ip-input.tsx`, `network-card.tsx`, `camera-ip-card.tsx`,
  `network-screen.tsx`, and the two hooks; wire `ADVANCED_SCREEN_ELEMENTS['S-28']`.

**Testing Library list** (one per S-28 state):
`loading`; `populated` (LAN/vLAN/camera cards); `dirty`; `validating` (invalid IP
disables Apply, shows the reason); `applying`; `apply failed` (readback shows
`lastApplyError`, prior values remain); `self-lockout warning` (editing LAN
address surfaces the warning); `camera rebind` (tile `unknown` → `online`);
`no-Wi-Fi` (structural — no element labelled SSID/Wi-Fi exists); `U-2` (Apply
disabled while stale); `U-6` covered at the gate.

- [ ] **Step 5:** Write those Testing Library tests.
- [ ] **Step 6:** Run tests + lint + typecheck.

Run: `pnpm --filter @eduscope/panel test -- screens/advanced/network`
Run: `pnpm --filter @eduscope/api-client test`
Run: `pnpm lint && pnpm --filter @eduscope/panel typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/panel/src/screens/advanced/network apps/panel/src/routes/router.tsx packages/api-client/src/mock/rest
git commit -m "feat(S-28): network settings (LAN/vLAN/camera IP) + apply-readback + camera re-probe"
```

---

## Task 6: S-29 Encoder Settings

Screen-inventory §5 S-29. Only capability-backed options render (B-56); ± steppers
+ numeric readout, never a bare range; save-rejected (422); applies-next-session.

**Files:**
- Create: `apps/panel/src/screens/advanced/encoder/encoder-screen.tsx`
- Create: `apps/panel/src/screens/advanced/encoder/bitrate-stepper.tsx` (± + numeric readout; reuse `.us-stepper` if present)
- Create: `apps/panel/src/screens/advanced/encoder/capability-select.tsx` (renders ONLY `capabilities`-listed options)
- Create: `apps/panel/src/screens/advanced/encoder/use-encoder-settings.ts`
- Create: `apps/panel/src/screens/advanced/encoder/encoder.css`
- Modify: `apps/panel/src/routes/router.tsx` (`ADVANCED_SCREEN_ELEMENTS['S-29']`)
- Test: co-located tests.

**Hook/component breakdown:**
- `use-encoder-settings.ts` — `getEncoderSettings` (returns `{ profile,
  capabilities }`); `updateEncoderSettings` (Save, U-4); maps a 422 to the
  offending field.
- `capability-select.tsx` — codec/container/framerate/gop/rate-control selects
  built **from `capabilities`** — with the seed that is `codecs:['h264']` only,
  so H.265/AV1 must be **absent**, not disabled (the point of the row).
- `bitrate-stepper.tsx` — ± steppers within `capabilities.videoBitrateKbps`
  {2000..8000} + numeric readout.
- `encoder-screen.tsx` — cards + dirty state + Save + the persistent
  "applies next session" notice (an encoder change never applies mid-lecture).

**Testing Library list:** `loading`; `populated` (assert **no** H.265/AV1 option
renders — only `h264`); `dirty`; `saving`; `save rejected` (set bitrate 9000 →
422, offending field flagged, value not applied); `applies-next-session notice`
present whenever dirty; `U-2` (Save disabled while stale). No new scenario needed
(422 is intrinsic to the mock's capability check).

- [ ] **Step 1:** Build the hook + components + screen; wire the route.
- [ ] **Step 2:** Write the Testing Library tests above.
- [ ] **Step 3:** Run tests + lint + typecheck.

Run: `pnpm --filter @eduscope/panel test -- screens/advanced/encoder`
Run: `pnpm lint && pnpm --filter @eduscope/panel typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/panel/src/screens/advanced/encoder apps/panel/src/routes/router.tsx
git commit -m "feat(S-29): encoder settings — capability-gated options + save-rejected"
```

---

## Task 7: S-30 Local Storage

Screen-inventory §5 S-30. Stats + SMART + retention-in-real-numbers; register +
format as one guarded danger-zone op with type-to-confirm-by-name.

**Files:**
- Create: `apps/panel/src/screens/advanced/storage/storage-screen.tsx`
- Create: `apps/panel/src/screens/advanced/storage/capacity-stats.tsx` (total/free/used% + pressure)
- Create: `apps/panel/src/screens/advanced/storage/disk-health-row.tsx` (SMART; `unknown` legit)
- Create: `apps/panel/src/screens/advanced/storage/retention-policy-card.tsx` (RetentionPolicy → real numbers)
- Create: `apps/panel/src/screens/advanced/storage/volume-list.tsx`
- Create: `apps/panel/src/screens/advanced/storage/register-drive-form.tsx`
- Create: `apps/panel/src/screens/advanced/storage/format-danger-zone.tsx` (confirm-by-name via `DangerConfirm`)
- Create: `apps/panel/src/screens/advanced/storage/use-storage.ts`
- Create: `apps/panel/src/screens/advanced/storage/storage.css`
- Modify: `apps/panel/src/routes/router.tsx` (`ADVANCED_SCREEN_ELEMENTS['S-30']`)
- Test: co-located tests.

**Hook/component breakdown:**
- `use-storage.ts` — `getStorageOverview` snapshot merged with live
  `storage.status` (existing `useStorageStatus`, `useStoragePressure`) and
  `device.health` (existing `useDeviceHealth` from Task 1 for SMART);
  `registerStorageVolume` / `formatStorageVolume` commands.
- `disk-health-row.tsx` — SMART `good/warning/failing/unknown` in words;
  `unknown` in `--text-faint`, never hardcoded Good (INV-DH-2, C-7).
- `retention-policy-card.tsx` — the SAME policy text the dashboard banner uses,
  generated from `RetentionPolicy` (INV-RP-1) — "delete uploaded oldest first
  past {maxAgeDays} days; never delete un-uploaded".
- `format-danger-zone.tsx` — reuse `danger/DangerConfirm` (S-06 §3 states
  `confirm|pending|refused|done`, initial focus Cancel, `dismissible:false`);
  the confirm field must match the volume **label** (or uuid when unlabelled);
  button disabled until the typed text matches exactly (J-5).

**State → demonstration:** pressure via existing `storagePressure` radio; SMART
via `diskHealth` knob (Task 2); register 409/422 via duplicate/bad uuid;
`format refused (recording)` by Starting a recording from the overlay first;
`formatting`/`format failed` via `disk-full`; `retention blocked` via `disk-full`.

**Testing Library list:** `loading`; `populated` (stats + SMART + volume list +
retention numbers); `pressure ok/warning/critical`; `disk good/warning/failing/
unknown`; `register drive` pending/registered/409/422; `format confirm` (button
disabled until name matches); `format refused (recording)` (409 message);
`formatting`; `format failed` (previous registration intact, INV-SV-3);
`retention blocked`; `U-2`.

- [ ] **Step 1:** Build the hook + components + screen; wire the route.
- [ ] **Step 2:** Write the Testing Library tests above.
- [ ] **Step 3:** Run tests + lint + typecheck.

Run: `pnpm --filter @eduscope/panel test -- screens/advanced/storage`
Run: `pnpm lint && pnpm --filter @eduscope/panel typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/panel/src/screens/advanced/storage apps/panel/src/routes/router.tsx
git commit -m "feat(S-30): local storage — SMART, retention numbers, confirm-by-name format"
```

---

## Task 8: S-31 Firmware Update

Screen-inventory §5 S-31. The ten-state linear lifecycle + refused-while-recording;
`firmware.state` is the full read view on every change. Includes the mock
lifecycle + emission (full code).

**Files:**
- Create: `apps/panel/src/screens/advanced/firmware/firmware-screen.tsx`
- Create: `apps/panel/src/screens/advanced/firmware/firmware-lifecycle.tsx` (the state → panel mapping)
- Create: `apps/panel/src/screens/advanced/firmware/use-firmware.ts`
- Create: `apps/panel/src/screens/advanced/firmware/firmware.css`
- Modify: `apps/panel/src/routes/router.tsx` (`ADVANCED_SCREEN_ELEMENTS['S-31']`)
- Modify (mock, full code below): `packages/api-client/src/mock/rest/firmware.ts`
- Test: co-located tests + a mock firmware test.

**Hook breakdown:**
- `use-firmware.ts` — `getFirmwareState` snapshot merged with live
  `firmware.state` (`useFirmwareState`, Task 1); `checkFirmware` / `applyFirmware`
  commands (both admin, refused while recording per the mock 409).

- [ ] **Step 1: Mock lifecycle + emission** (full code). Replace
  `rest/firmware.ts`'s `checkFirmware`/`applyFirmware` bodies so each phase
  mutates `seed.firmware` **and emits** `firmware.state`, and the terminal is
  driven by `ctx.worldSeed.firmwareOutcome`:

```ts
    const push = () => world.emit('firmware.state', validated(zFirmwareUpdate, seed.firmware));

    checkFirmware: async (): Promise<CommandAccepted> => {
      requireAdmin(ctx);
      const refusal = engine.onCommand('checkFirmware');
      if (refusal) throw new ProblemError(refusal);
      seed.firmware.state = 'checking'; push();
      world.clock.setTimeout(() => {
        if (ctx.worldSeed.firmwareOutcome === 'up-to-date') {
          seed.firmware.state = 'idle'; seed.firmware.availableVersion = null;
        } else {
          seed.firmware.state = 'idle'; seed.firmware.availableVersion = '2026.2.0';
        }
        push();
      }, 1_000);
      return accepted();
    },

    applyFirmware: async (): Promise<CommandAccepted> => {
      requireAdmin(ctx);
      const refusal = engine.onCommand('applyFirmware');
      if (refusal) throw new ProblemError(refusal);
      if (world.state('recording') !== 'idle') {
        throw new ProblemError({ status: 409, code: 'conflict', title: 'A lecture is in progress — firmware apply is refused while recording' });
      }
      const outcome = ctx.worldSeed.firmwareOutcome;
      const steps: Array<() => void> = [
        () => { seed.firmware.state = 'downloading'; },
        () => { seed.firmware.state = 'verifying'; },
      ];
      if (outcome === 'signature-fail') {
        steps.push(() => { seed.firmware.state = 'failed'; seed.firmware.signatureVerified = false; seed.firmware.lastError = 'Signature verification failed'; });
      } else if (outcome === 'apply-fail') {
        steps.push(() => { seed.firmware.state = 'applying'; });
        steps.push(() => { seed.firmware.state = 'failed'; seed.firmware.lastError = 'Apply failed'; });
      } else if (outcome === 'rolled-back') {
        steps.push(() => { seed.firmware.state = 'applying'; });
        steps.push(() => { seed.firmware.state = 'rolled-back'; seed.firmware.lastError = 'Reverted to the previous version'; });
      } else {
        steps.push(() => { seed.firmware.state = 'applying'; });
        steps.push(() => { seed.firmware.state = 'done'; seed.firmware.finishedAt = nowIsoZ(world.clock); seed.firmware.currentVersion = seed.firmware.availableVersion ?? seed.firmware.currentVersion; seed.firmware.availableVersion = null; });
      }
      seed.firmware.startedAt = nowIsoZ(world.clock);
      steps.forEach((step, i) => world.clock.setTimeout(() => { step(); push(); }, (i + 1) * 800));
      return accepted();
    },
```

Factor a small `accepted()` helper (the existing `validated(zCommandAccepted,
{...})` block). Keep `zFirmwareUpdate` imported.

- [ ] **Step 2: Mock test** — assert `checkFirmware` with
  `firmwareOutcome:'up-to-date'` leaves `availableVersion` null, and that
  `firmware.state` events are emitted (spy on `world.emit`). Run to green.

- [ ] **Step 3:** Build `use-firmware.ts`, `firmware-lifecycle.tsx`,
  `firmware-screen.tsx`; wire the route. `firmware-lifecycle.tsx` maps each state
  to its panel; `done` shows the unmissable "do not power off / reboot required"
  message; `failed`/`signature failed` are loud, distinct states.

**Testing Library list** (one per state): `idle`; `checking`; `up to date`;
`update available` (version/notes/size); `downloading` (progress); `verifying`;
`applying`; `done` (reboot-required, unmissable); `failed`; `rolled-back` (with
reason); **`signature failed`** (distinct, loud); `refused while recording` (409);
`U-2`.

- [ ] **Step 4:** Write those Testing Library tests (feed crafted
  `FirmwareUpdate` snapshots).
- [ ] **Step 5:** Run tests + lint + typecheck.

Run: `pnpm --filter @eduscope/panel test -- screens/advanced/firmware`
Run: `pnpm --filter @eduscope/api-client test`
Run: `pnpm lint && pnpm --filter @eduscope/panel typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/screens/advanced/firmware apps/panel/src/routes/router.tsx packages/api-client/src/mock/rest/firmware.ts
git commit -m "feat(S-31): firmware lifecycle + firmware.state emission + refused-while-recording"
```

---

## Task 9: S-32 User Management

Screen-inventory §5 S-32. One directory, two roles; add/edit/delete/paginate/
search; `source` column; hashed passwords never returned; last-admin/self delete
refused (CG-9).

**Files:**
- Create: `apps/panel/src/screens/advanced/users/user-management-screen.tsx`
- Create: `apps/panel/src/screens/advanced/users/user-table.tsx` (rows ≥ 56 px, persistent action column)
- Create: `apps/panel/src/screens/advanced/users/user-search.tsx` (`q` + role filter chips)
- Create: `apps/panel/src/screens/advanced/users/add-user-dialog.tsx`
- Create: `apps/panel/src/screens/advanced/users/edit-user-dialog.tsx` (institute-sourced fields read-only)
- Create: `apps/panel/src/screens/advanced/users/delete-user-confirm.tsx` (reuse `DangerConfirm`)
- Create: `apps/panel/src/screens/advanced/users/last-admin.ts` (pure guard: refuse deleting self or the last admin)
- Create: `apps/panel/src/screens/advanced/users/use-users.ts`
- Create: `apps/panel/src/screens/advanced/users/users.css`
- Modify: `apps/panel/src/routes/router.tsx` (`ADVANCED_SCREEN_ELEMENTS['S-32']`)
- Test: co-located tests + `last-admin.test.ts`.

**Hook/util breakdown:**
- `use-users.ts` — `useInfiniteQuery` on `listUsers({ cursor, limit, q, role })`
  (cursor pagination, "load more"); `createUser` / `updateUser` / `deleteUser`
  mutations invalidating the list; no WS.
- `last-admin.ts` — `canDelete(target, allUsers, meId): { ok: boolean; reason?:
  string }` — refuse when `target.id === meId` (self) or when `target.role ===
  'admin'` and it is the only admin (CG-9). This is client-side defence;
  the delete confirm reads it.
- `edit-user-dialog.tsx` — displayName/role/`disabled`/password; setting a
  password forces reset next login (the admin-triggered reset, §11 Q-3). When
  `source === 'institute'`, roster-owned fields (displayName/role) are read-only
  (PF-8, `[D-02b]`).

**Testing Library list:** `loading`; `empty (no match)` (search yields the
`.us-adm__note`); `populated` (name/username/role/source/last-login/mustReset/
disabled columns; seed has local+institute, a mustReset and a disabled user);
`search` + `role filter`; `pagination` (Load more appends); `add user`
pending/created/409(`admin` taken)/422; `edit user` (institute-sourced fields
read-only); `delete user` pending/deleted; `refuse last-admin/self`
(`canDelete` blocks with reason); `U-2`.

- [ ] **Step 1: `last-admin.ts` + test** — write failing tests for `canDelete`
  (self blocked; sole admin blocked; a lecturer with two admins present allowed).
  Implement. Run to green.
- [ ] **Step 2:** Build `use-users.ts` + the table/search/dialogs/confirm; wire
  the route.
- [ ] **Step 3:** Write the Testing Library tests above.
- [ ] **Step 4:** Run tests + lint + typecheck.

Run: `pnpm --filter @eduscope/panel test -- screens/advanced/users`
Run: `pnpm lint && pnpm --filter @eduscope/panel typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/panel/src/screens/advanced/users apps/panel/src/routes/router.tsx
git commit -m "feat(S-32): user management — table/search/paginate/add/edit/delete + last-admin guard"
```

---

## Task 10: S-33 Excel bulk import (overlay on S-32)

Screen-inventory §5 S-33. Whole-batch validation (B-44): any invalid row rejects
the entire batch with row-level reasons and writes nothing; the rejection report
is the design job. Includes the mock rejected-batch branch (full code).

**Files:**
- Create: `apps/panel/src/screens/advanced/users/import/bulk-import-overlay.tsx`
- Create: `apps/panel/src/screens/advanced/users/import/file-picker.tsx` (states where the file comes from)
- Create: `apps/panel/src/screens/advanced/users/import/rejection-report.tsx` (scrollable row → reason table)
- Create: `apps/panel/src/screens/advanced/users/import/use-import.ts`
- Modify: `apps/panel/src/screens/advanced/users/user-management-screen.tsx` (Bulk Import button → `useOverlays().open`)
- Modify (mock, full code below): `packages/api-client/src/mock/rest/users.ts` (`userImportRejects`)
- Test: co-located tests.

**Breakdown:**
- The overlay mounts through `useOverlays().open(node, { dismissible })` /
  `OverlayHost` (S-33 is UI-local state, no route).
- `use-import.ts` — `importUsers({ file })`; the response IS the verdict
  (synchronous) — `accepted` (`state:'applied'`) vs `rejected`
  (`state:'rejected'`, `rejections[]`). Every accepted user is flagged
  `mustResetPassword` server-side (INV-UI-2); the file is not retained (INV-UI-3).
- `file-picker.tsx` — required columns statement; client-side wrong-file-type
  reject (non-`.xlsx`) before any upload.
- `rejection-report.tsx` — the headline surface: a scrollable `row → reason`
  table + an explicit **"Nothing was imported."** statement. No partial writes.

- [ ] **Step 1: Mock rejected branch** (full code) in `rest/users.ts`
  `importUsers`, before the current success return:

```ts
      if (ctx.worldSeed.userImportRejects) {
        return validated(zUserImportBatch, {
          id: seedId('import-batch'), filename: 'roster.xlsx', uploadedAt: nowIsoZ(world.clock),
          state: 'rejected', rowCount: 3, acceptedCount: 0,
          rejections: [
            { row: 2, reason: 'Username "a.perera" already exists' },
            { row: 3, reason: 'Missing required cell: displayName' },
          ],
        });
      }
```

(Confirm the `zUserImportBatch` rejection shape during the task — match the
schema's field names for the row/reason.)

- [ ] **Step 2:** Add overlay control for `userImportRejects` in
  `scenario-overlay.tsx` (checkbox, same pattern as Task 2 Step 6).
- [ ] **Step 3:** Build the overlay + file picker + rejection report + hook; wire
  the Bulk Import button.

**Testing Library list:** `idle` (file picker + required columns); `file selected`
(name/size/row count if parseable); `uploading`/`validating`; `accepted`
(N users created, all flagged for reset); **`rejected`** (row→reason table +
"Nothing was imported."); `wrong file type` (client reject); `unreadable file`;
`U-2` (upload blocked while stale).

- [ ] **Step 4:** Write the Testing Library tests above.
- [ ] **Step 5:** Run tests + lint + typecheck.

Run: `pnpm --filter @eduscope/panel test -- screens/advanced/users/import`
Run: `pnpm --filter @eduscope/api-client test`
Run: `pnpm lint && pnpm --filter @eduscope/panel typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/screens/advanced/users packages/api-client/src apps/panel/src/devtools
git commit -m "feat(S-33): excel bulk import overlay + whole-batch rejection report"
```

---

## Task 11: S-34 System Logs

Screen-inventory §5 S-34. Level/category/search/time-range filters, `sessionId`
drill-in, cursor pagination, live tail (`log.entry`), CSV export using the same
filter set. Includes the mock log-tail emission (full code).

**Files:**
- Create: `apps/panel/src/screens/advanced/logs/logs-screen.tsx`
- Create: `apps/panel/src/screens/advanced/logs/log-filters.tsx` (level/category chips, search, time range)
- Create: `apps/panel/src/screens/advanced/logs/log-table.tsx` (rows ≥ 44 px, tap-to-expand message)
- Create: `apps/panel/src/screens/advanced/logs/log-export.ts` (Blob + object URL download from `exportLogsCsv`)
- Create: `apps/panel/src/screens/advanced/logs/use-logs.ts`
- Create: `apps/panel/src/screens/advanced/logs/logs.css`
- Modify: `apps/panel/src/routes/router.tsx` (`ADVANCED_SCREEN_ELEMENTS['S-34']`)
- Modify (mock, full code below): `packages/api-client/src/mock/rest/logs.ts` (log-tail emission on subscribe)
- Test: co-located tests.

**Hook/util breakdown:**
- `use-logs.ts` — `useInfiniteQuery` on `queryLogs({ level, category, q, from,
  to, sessionId, cursor, limit })` (newest first, cursor pagination) merged with
  the live tail (`useLogTail`, Task 1); a `tail stale` flag from `useIsStale()`
  (U-2 — the tail is marked stale but the query still works).
- `log-export.ts` — `exportLogsCsv(sameFilters)` → `new Blob([csv], { type:
  'text/csv' })` → `URL.createObjectURL` → anchor download; states
  exporting/ready/failed. **No hand-assembled URL** (boundary rule).

- [ ] **Step 1: Mock log-tail emission** (full code) in `rest/logs.ts`. Mark the
  session subscribed on the first `queryLogs` call and emit a bounded run of
  synthetic `log.entry` events on the world clock:

```ts
    let tailStarted = false;
    // ...inside queryLogs, after computing the page, before return:
      if (!tailStarted) {
        tailStarted = true;
        const kinds = [
          { level: 'INFO', category: 'System', message: 'Heartbeat OK.' },
          { level: 'WARN', category: 'Hardware', message: 'students-cam signal dipped.' },
          { level: 'INFO', category: 'Auth', message: 'admin viewed the log.' },
        ] as const;
        kinds.forEach((k, i) => ctx.world.clock.setTimeout(() => {
          ctx.world.emit('log.entry', validated(zLogEntry, {
            id: seedId('log'), at: nowIsoZ(ctx.world.clock), service: 'core-api',
            sessionId: null, userId: null, context: null, ...k,
          }));
        }, (i + 1) * 1_500));
      }
```

Import `nowIsoZ`, `seedId` (from `../seed/index.js`).

- [ ] **Step 2: Mock test** — spy on `world.emit` and assert `queryLogs` schedules
  `log.entry` emits once (not on every call). Run to green.
- [ ] **Step 3:** Build `use-logs.ts`, `log-filters.tsx`, `log-table.tsx`,
  `log-export.ts`, `logs-screen.tsx`; wire the route.

**Testing Library list:** `loading`; `empty (no logs)`; `empty (no match)`
(different copy — "change your filter"); `populated` (newest first);
`filtering`/`filter applied` (level/category/`q`/from/to/`sessionId`); `session
drill-in`; `live tail` (an appended `log.entry` shows atop); `tail stale` (U-2 —
tail marked stale, query still returns rows); `exporting`/`export ready`/`export
failed`; `U-5` (export refused). CSV export uses the same filter set as the query.

- [ ] **Step 4:** Write the Testing Library tests above.
- [ ] **Step 5:** Run tests + lint + typecheck.

Run: `pnpm --filter @eduscope/panel test -- screens/advanced/logs`
Run: `pnpm --filter @eduscope/api-client test`
Run: `pnpm lint && pnpm --filter @eduscope/panel typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/screens/advanced/logs apps/panel/src/routes/router.tsx packages/api-client/src/mock/rest/logs.ts
git commit -m "feat(S-34): system logs — filters, live tail, CSV export (same filter set)"
```

---

## Per-screen gates (Tasks 12–19)

Each gate is executable verification, run after its screen's implementation task.
A gate creates a Playwright spec (primary journey + one failure scenario) and
runs the full check list. **Do not proceed past a red gate** — fix in the
screen's task and re-run. The scenario helpers (`openScenarioOverlay`,
`switchScenario`, sign-in, `goAdvanced`) are copied from
`e2e/s25-advanced.spec.ts` / `e2e/s35-uploads.spec.ts`.

Every gate runs this common check list:
- **Every enumerated state demonstrated** via the dev-overlay checklist (the
  screen's row in the State → scenario map, exercised in the Testing Library
  suite and, for the live ones, in the Playwright spec).
- **Boundary lint green:** `pnpm lint` reports no direct network import
  (`fetch`/`axios`/`WebSocket`/`XMLHttpRequest`/`EventSource`) anywhere under the
  screen's directory.
- **Testing Library test per enumerated state** (the task's list) passes.
- **Playwright:** the primary journey + at least one failure scenario pass.
- **Contract honesty:** every mock response validates against `contracts/` zod
  schemas — `pnpm --filter @eduscope/api-client test` stays green.

---

### Task 12: Gate — S-28 Network Settings

**Files:** Create `apps/panel/e2e/s28-network.spec.ts`.

- [ ] **Step 1: Primary journey spec** — admin → Advanced → Network Settings;
  edit the vLAN card's address, Apply, assert the row re-reads with a new
  `appliedAt`/applied marker (202 + readback).
- [ ] **Step 2: Failure spec** — enable the `Network apply fails` world knob →
  edit + Apply → assert the `lastApplyError` readback appears and the previous
  address is still shown (prior config stays in effect).
- [ ] **Step 3: Run the gate**

Run: `pnpm --filter @eduscope/panel test -- screens/advanced/network`
Run: `pnpm --filter @eduscope/panel e2e -- e2e/s28-network.spec.ts`
Run: `pnpm lint && pnpm --filter @eduscope/api-client test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/panel/e2e/s28-network.spec.ts
git commit -m "test(S-28): gate — network apply-readback journey + apply-failed"
```

---

### Task 13: Gate — S-29 Encoder Settings

**Files:** Create `apps/panel/e2e/s29-encoder.spec.ts`.

- [ ] **Step 1: Primary journey** — admin → Encoder Settings; assert **no**
  H.265/AV1 option exists (only H.264); step the bitrate; Save; assert the
  "applies next session" notice.
- [ ] **Step 2: Failure** — set the bitrate above the capability max (8000) →
  assert the 422 rejection surfaces on the offending field and the value is not
  applied.
- [ ] **Step 3: Run the gate**

Run: `pnpm --filter @eduscope/panel test -- screens/advanced/encoder`
Run: `pnpm --filter @eduscope/panel e2e -- e2e/s29-encoder.spec.ts`
Run: `pnpm lint && pnpm --filter @eduscope/api-client test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/panel/e2e/s29-encoder.spec.ts
git commit -m "test(S-29): gate — capability-gated options + save-rejected"
```

---

### Task 14: Gate — S-30 Local Storage

**Files:** Create `apps/panel/e2e/s30-storage.spec.ts`.

- [ ] **Step 1: Primary journey** — admin → Local Storage; assert the stats,
  SMART line (in words), and retention policy in real numbers; open the format
  danger zone and confirm the button stays disabled until the typed name matches
  the volume label exactly.
- [ ] **Step 2: Failure** — switch to `disk-full` (or the `diskHealth:failing`
  knob) and assert the failing SMART state + the retention-blocked / format-failed
  surface renders honestly (previous registration intact).
- [ ] **Step 3: Run the gate**

Run: `pnpm --filter @eduscope/panel test -- screens/advanced/storage`
Run: `pnpm --filter @eduscope/panel e2e -- e2e/s30-storage.spec.ts`
Run: `pnpm lint && pnpm --filter @eduscope/api-client test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/panel/e2e/s30-storage.spec.ts
git commit -m "test(S-30): gate — confirm-by-name format + SMART/retention honesty"
```

---

### Task 15: Gate — S-31 Firmware Update

**Files:** Create `apps/panel/e2e/s31-firmware.spec.ts`.

- [ ] **Step 1: Primary journey** — admin → Firmware; with
  `firmwareOutcome:'update-available'`, Check → update available → Apply → observe
  downloading → verifying → applying → done (reboot-required message unmissable).
- [ ] **Step 2: Failure** — with `firmwareOutcome:'signature-fail'`, Apply →
  assert the loud, distinct `signature failed` state (not a generic error).
- [ ] **Step 3: Run the gate**

Run: `pnpm --filter @eduscope/panel test -- screens/advanced/firmware`
Run: `pnpm --filter @eduscope/panel e2e -- e2e/s31-firmware.spec.ts`
Run: `pnpm lint && pnpm --filter @eduscope/api-client test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/panel/e2e/s31-firmware.spec.ts
git commit -m "test(S-31): gate — firmware lifecycle journey + signature-fail"
```

---

### Task 16: Gate — S-32 User Management

**Files:** Create `apps/panel/e2e/s32-users.spec.ts`.

- [ ] **Step 1: Primary journey** — admin → User Management; search filters the
  directory; add a new user (created); edit `a.perera` and assert institute-owned
  fields are read-only.
- [ ] **Step 2: Failure** — attempt to delete `admin` (self / last admin) and
  assert it is refused client-side with the reason (CG-9); attempt to add a user
  named `admin` and assert the 409.
- [ ] **Step 3: Run the gate**

Run: `pnpm --filter @eduscope/panel test -- screens/advanced/users`
Run: `pnpm --filter @eduscope/panel e2e -- e2e/s32-users.spec.ts`
Run: `pnpm lint && pnpm --filter @eduscope/api-client test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/panel/e2e/s32-users.spec.ts
git commit -m "test(S-32): gate — directory journey + last-admin/self-delete refusal"
```

---

### Task 17: Gate — S-33 Excel bulk import

**Files:** Create `apps/panel/e2e/s33-import.spec.ts`.

- [ ] **Step 1: Primary journey** — admin → User Management → Bulk Import; pick a
  `.xlsx`; assert the accepted batch reports N users, all flagged for reset.
- [ ] **Step 2: Failure** — enable the `Bulk import rejects` world knob → import →
  assert the row→reason rejection table and the explicit "Nothing was imported."
  statement (no partial writes: the directory count is unchanged).
- [ ] **Step 3: Run the gate**

Run: `pnpm --filter @eduscope/panel test -- screens/advanced/users/import`
Run: `pnpm --filter @eduscope/panel e2e -- e2e/s33-import.spec.ts`
Run: `pnpm lint && pnpm --filter @eduscope/api-client test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/panel/e2e/s33-import.spec.ts
git commit -m "test(S-33): gate — accepted import + whole-batch rejection report"
```

---

### Task 18: Gate — S-34 System Logs

**Files:** Create `apps/panel/e2e/s34-logs.spec.ts`.

- [ ] **Step 1: Primary journey** — admin → System Logs; apply a level +
  category filter and assert the table narrows; assert a live-tail entry appears
  atop; trigger CSV export and assert the download is offered.
- [ ] **Step 2: Failure** — switch to `ws-flap` and assert the tail is marked
  stale while the query still returns rows (U-2).
- [ ] **Step 3: Run the gate**

Run: `pnpm --filter @eduscope/panel test -- screens/advanced/logs`
Run: `pnpm --filter @eduscope/panel e2e -- e2e/s34-logs.spec.ts`
Run: `pnpm lint && pnpm --filter @eduscope/api-client test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/panel/e2e/s34-logs.spec.ts
git commit -m "test(S-34): gate — filter/tail/export journey + ws-flap tail-stale"
```

---

### Task 19: Gate — S-36 Device & Identity

**Files:** Create `apps/panel/e2e/s36-device.spec.ts`.

- [ ] **Step 1: Primary journey** — admin → Device & Identity; assert the
  `Provisioned` chip, an identity id with a working Copy button (announces
  "Copied …"), the features rendered legibly (AI Off neutral, recording On),
  and the seeded alerts; Acknowledge one and assert it **stays** labelled
  "acknowledged · still active" (never removed, C-4).
- [ ] **Step 2: Failure** — switch to `capture-fault` and assert the capture card
  moves through absent → recovering → failed, ending with "camera-only recording
  still works" (never a dead-device reading). (Also cover `provisioned:false` and
  `ws-flap` health-stale in the Testing Library suite per Task 4.)
- [ ] **Step 3: Run the gate**

Run: `pnpm --filter @eduscope/panel test -- screens/advanced/device`
Run: `pnpm --filter @eduscope/panel e2e -- e2e/s36-device.spec.ts`
Run: `pnpm lint && pnpm --filter @eduscope/api-client test`
Expected: all PASS.

- [ ] **Step 4: Full-suite sanity + commit**

Run: `pnpm --filter @eduscope/panel test && pnpm --filter @eduscope/api-client test && pnpm lint`
Expected: PASS.

```bash
git add apps/panel/e2e/s36-device.spec.ts
git commit -m "test(S-36): gate — status-sheet journey + capture-fault + acknowledge≠fixed"
```

---

## Decisions taken in this plan

- **W6-D-1 — capture-card "attempt N of 2/hour" renders the budget cap, not a
  live counter.** `DeviceHealth` carries no recovery-attempt-count field and the
  design mandates no contract change (S-36-design §9). The card renders the
  documented Machine-5c cap ("up to 2 recovery attempts per hour", state-machines
  §6.4) plus the state word and `since`, satisfying C-8 (the budget is visible)
  without inventing a field. If a live attempt counter is later wanted, it is an
  additive `DeviceHealth` field — a gate discussion, not an in-run change.
- **DIO-1 (from S-36-design §14) stays display-only.** S-36 shows
  `expectedStorageVolumeUuid` copyable and does **not** fetch `GET /storage` to
  cross-check the mounted volume. Unchanged here; routed in
  `docs/discovery/open-decisions.md §9.6`.
- **The device screen's `use-provisioning.ts` is separate from
  `shell/use-provisioning.ts`.** Different directory, different return shape, and
  it must not carry the shell hook's `retry: false` (that is the
  session-revocation detector's behaviour).

## Self-review notes

- **Spec coverage:** every S-28…S-34, S-36 state enumerated in screen-inventory
  §5 and every S-36 state in S-36-design §5.1 maps to a row in the State →
  scenario table and a Testing Library test in the owning task. S-33 is built as
  an overlay on S-32 (no route), matching the inventory.
- **No contract change:** confirmed — all endpoints/events/enums pre-exist; the
  only `packages/shared` reads are types. The only mock edits add emission and
  knob branches, never new schemas.
- **Type consistency:** hook names (`useDeviceHealth`, `useAlertsList`,
  `useFirmwareState`, `useLogTail`) are defined in Task 1 and consumed by the
  same names in Tasks 3, 8, 11. `WorldSeed` knob names are defined once in Task 2
  and consumed verbatim later.
- **Boundary:** the only object-URL/Blob use is S-34's CSV download, built from
  `exportLogsCsv`'s returned string — no hand-assembled network URL, mirroring
  the S-22 player pattern the boundary rule already permits.
