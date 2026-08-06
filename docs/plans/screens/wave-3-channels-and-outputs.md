# Wave 3 — Channels & Outputs (S-25, S-26, S-27, S-08) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the role-scoped Advanced shell, Local Capture Layout, Streaming Configuration, and the in-session Live Meeting card so all three output channels use the contract-defined preset vocabulary, async channel truth comes from `channel.state`, and every enumerated screen state is demonstrable from the mock scenario overlay.

**Architecture:** Correct the existing `listChannels` adapter to return the contract's `{ config, status }` rows, then place shared query/mutation logic and data-driven layout rendering in `apps/panel/src/channels/`. S-25 becomes a nested route layout around S-26/S-27; S-08 remains a child of the existing S-05 session sidebar. The mock receives only the missing Wave-3 fixtures and one focused `channel-failures` scenario; no contract file changes and no second client boundary are introduced.

**Tech Stack:** React 18.3 · TypeScript strict · react-router 7 · TanStack Query 5 · zustand 5 · CSS custom-property tokens with `us-*` semantic classes · Vitest + Testing Library · Playwright.

---

## Global Constraints

These requirements apply to every task.

### Binding sources and precedence

- [`docs/design/frontend-conventions.md`](../../design/frontend-conventions.md) is binding. Its client-boundary, prototype-porting, kiosk, state/scenario, testing, and token rules win over this plan if wording drifts.
- Screen behavior comes from [`screen-inventory.md`](../../design/screen-inventory.md) §0.3–0.4, S-08, S-25, S-26, S-27, §8, and §11.
- Runtime behavior comes from [`state-machines.md`](../../design/state-machines.md) §2.2 (CH-01…CH-10), §8, and §10; pause never stops meeting or streaming (SM-Q-4).
- REST and event shapes come from [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) v0.3.0 and [`contracts/events.md`](../../../contracts/events.md) v0.3.0. **Do not edit either contract in this wave.** `contract-amendments.md` says amendments happen before a plan run, never during it.
- `/prototype` is visual/behavioral reference only. Port hierarchy, spacing, semantic class names, and interactions; do not port `RecordingContext`, `mock/session.ts`, local channel arrays, simulated timers, or mock feeds.

### Prototype map

| Screen/shared unit | Prototype reference | Reproduce | Replace with production scaffold truth |
|---|---|---|---|
| S-25 | `prototype/src/components/admin/AdminPage.tsx`, `examples/advance/*.png` | 58 px topbar, 232 px sidebar, icon + label nav rows, active blue row, internally scrolling content | react-router nested routes and `useAuth`/`getMe`; no local `category` state or `PAGES` map |
| S-26 | `admin/pages/LocalCaptureLayout.tsx` | always-on badge, large preview beside preset tiles | `listChannels`, `listLayoutPresets`, `sources.status`, `updateChannelConfig` |
| S-27 | `admin/pages/StreamingConfig.tsx`, `advanceMenuExample7.png` | separated channel control, preset area, platform chips, credentials card, saved-target list | contract platforms only (`youtube`, `facebook`, `custom-rtmp`), write-only key semantics, real role split, REST mutations and WS status |
| S-08 | `components/ChannelCard.tsx`, `outputs/channelMeta.tsx`, dashboard examples 2/3 | compact Live Meeting card, switch, inline accordion, three camera preset buttons | `channel.state`, channel commands, shared preset catalog, source-binding validity |
| Shared layouts | `outputs/LayoutPresetPicker.tsx`, `outputs/LayoutPreview.tsx` | tile hierarchy, selected treatment, geometry preview | `LayoutPreset.allowedChannels`, `tiles`, `outputs`, `requiredRoles`; never `CHANNEL_LAYOUTS` or a preset-id switch |

### Client boundary, async truth, and stores

- Components import no `fetch`, `axios`, or `WebSocket`. They call `useClient()` and use TanStack Query for REST plus selectors from `apps/panel/src/store/selectors.ts` for WS.
- Channel enable/disable is 202-async. A switch becomes ON only after `channel.state{state:on}`; an accepted command never flips it optimistically.
- `updateChannelConfig` and stream-target CRUD use their REST response to update/invalidate TanStack Query data. They do not write synthetic WS rows into the zustand store.
- S-08 and S-27 read one channel through `useChannelStatus(channelId)`. Any multi-field WS read uses `useWsShallow`; no bare object-returning selector.
- `listChannels` must match the existing OpenAPI response: exactly three `{ config: ChannelConfig, status: ChannelStatus }` rows. This is an adapter correction, not a contract change.

### Kiosk, keyboard, accessibility, and layout

- Fixed 1280×800 panel. The page never scrolls. S-25's content region may scroll; the 10-item sidebar must fit without scrolling at 800 px.
- Every nav row is at least 48 px; every other interactive target is at least 44 px. Preset cards are at least 150×110 px. No hover-only information.
- S-27 text inputs are controlled and bind `useOskField`; the screen sizes itself with `calc(var(--panel-h) - var(--header-h) - var(--osk-h))` and never receives keyboard-open state.
- The stream-key field is blank on every load. It may say **Configured** or **Not configured** from `hasStreamKey`; it never receives a masked/default value. The adjacent Paste control reports clipboard denial inline.
- Icon-only controls require `aria-label`; selected routes use `aria-current="page"`; selected presets/platforms use `aria-pressed`; pending and result messages use appropriate `aria-live` regions.
- Use only existing tokens in `apps/panel/src/styles/tokens.css`. Overlays remain absolute inside `.us-panel`; none of these screens needs a new overlay except the existing danger confirmation for deleting a stream target.

### Closed preset vocabulary (LP-7)

The mock seed and every UI filter must agree on this table:

| Channel | Allowed presets |
|---|---|
| `local` | `fifty-fifty`, `side-by-side`, `cam-1`, `cam-2`, `separate-files` |
| `meeting` | `cams-fifty-fifty`, `cam-1`, `cam-2` |
| `streaming` | `fifty-fifty`, `side-by-side`, `cam-1`, `cam-2`, `pc-only` |

`separate-files` means two outputs only: Presentation without audio and Lecturer Camera with audio. No screen renders a preset merely because it exists in the full `/layouts` response.

### Testing floor

- Testing Library: one rendering test for every state enumerated under the owning S-section, including U-states named there.
- Playwright: primary journey plus at least one failure scenario per screen.
- Every mock REST response is validated against the generated zod schemas. The anonymous `/channels` item is validated with a composed `z.object({ config: zChannelConfig, status: zChannelStatus })`.
- Every final screen gate runs boundary lint and proves no direct network import.
- Each task ends with its targeted tests, then a task-scoped commit. Do not stage the user's existing `.gitignore` change.

---

## Decisions This Plan Takes

| Id | Decision | Reason |
|---|---|---|
| **W3-D-1** | Correct `EduscopeClient.listChannels()` from `ChannelStatus[]` to `ChannelSnapshot[]`, where `ChannelSnapshot = { config, status }`. | OpenAPI already specifies this body; S-26/S-27 need `alwaysOn`, `enabledByDefault`, and `streamTargetIds`, none of which exist on `ChannelStatus`. |
| **W3-D-2** | S-27 is reachable by both roles, but stream-target list/CRUD is admin-only. Lecturers can change streaming layout/default/live state and see only a configured-target count derived from `ChannelConfig.streamTargetIds`. | S-25/27 explicitly admit lecturers; `/settings/stream-targets` is explicitly `x-required-role: admin`, and `streamTargetIds` writes also require admin. This keeps both sources true without a speculative contract edit. |
| **W3-D-3** | Add one scenario, `channel-failures`, rather than adding a generic fault framework. | It groups the otherwise unreachable Wave-3 branches: meeting start failure, streaming preflight failure, delayed transport failure, named config refusal, and rejected stream-target save. Existing `happy` remains untouched. |
| **W3-D-4** | Add two World-strip booleans: `studentsCameraBound` and `streamTargetsConfigured`, both default `true`. | Invalid-preset and no-target states are starting-world facts, not narratives. The overlay already owns per-switch `WorldSeed` controls. |
| **W3-D-5** | A CH-09 restart is represented as `state: 'starting'` plus a non-null restart reason and `channel.restarting` alert. | `ChannelRuntimeState` has no `restarting` member, while the state machine explicitly maps CH-09 to `starting`. The reason lets S-08/S-27 distinguish it from an ordinary start without changing the contract. |
| **W3-D-6** | S-08 lifts `meetingLayoutsOpen` into `SessionLayout` and exposes the sidebar collapse class, but does not render a fake S-16/S-17 insights panel. | Wave 4 owns insights. Wave 3 supplies the real accordion state/callback seam so Wave 4 can attach `.us-insightswrap--collapsed` without changing S-08. |
| **W3-D-7** | S-08's inventory row `preflight / starting` is one pending visual state. The meeting machine legally demonstrates it via `starting`; a component test also feeds `preflight`. S-27 demonstrates the actual streaming preflight transition. | Machine 1c states CH-01 preflight is streaming-only. A mock-only illegal meeting transition would contradict the required state machine. |

---

## File Structure

| Path | Responsibility |
|---|---|
| `packages/api-client/src/client.ts` | Export `ChannelSnapshot`; correct `listChannels` signature. |
| `packages/api-client/src/mock/rest/channels.ts` | Contract-valid channel snapshots, preset/binding validation, config persistence, correct failed-state disable. |
| `packages/api-client/src/mock/seed/sources.ts` | Exact LP-7 preset/channel vocabulary and optional Students Camera binding. |
| `packages/api-client/src/mock/seed/device.ts` | Configured/empty stream-target fixture. |
| `packages/api-client/src/mock/seed/index.ts` | Build device targets before channel configs and thread target ids once. |
| `packages/api-client/src/mock/machines/channel.ts` | Named failure/restart reasons and reason clearing. |
| `packages/api-client/src/mock/scenario/scripts/channel-failures.ts` | Wave-3 forced transitions/refusals. |
| `apps/panel/src/channels/channel-queries.ts` | Shared query keys, channel snapshot/preset lookup, allowed preset filtering and invalid-role reasons. |
| `apps/panel/src/channels/use-channel-config.ts` | `updateChannelConfig` mutation state and exact cache replacement. |
| `apps/panel/src/channels/use-channel-runtime-command.ts` | 202 enable/disable lifecycle resolved only by `channel.state`. |
| `apps/panel/src/channels/layout-preview.tsx` | Data-driven preview from `tiles`/`outputs`; no preset-id switch. |
| `apps/panel/src/channels/layout-preset-picker.tsx` | Shared accessible preset cards. |
| `apps/panel/src/channels/channels.css` | Shared preview/picker/status styling using existing tokens. |
| `apps/panel/src/screens/advanced/advanced-shell.tsx` | S-25 topbar/sidebar and nested `<Outlet>`. |
| `apps/panel/src/screens/advanced/advanced-nav.ts` | One route/label/icon/role catalog for all 10 categories. |
| `apps/panel/src/screens/advanced/advanced-index.tsx` | Role-specific index redirect. |
| `apps/panel/src/screens/advanced/advanced.css` | Fixed shell geometry and internal scrolling. |
| `apps/panel/src/screens/advanced/local-capture-screen.tsx` | S-26 composition. |
| `apps/panel/src/screens/advanced/use-local-capture-layout.ts` | S-26 state model over shared channel data/mutation. |
| `apps/panel/src/screens/session/meeting-channel-card.tsx` | S-08 visual component and accordion. |
| `apps/panel/src/screens/session/use-meeting-channel.ts` | S-08 live command/preset state. |
| `apps/panel/src/screens/advanced/streaming-screen.tsx` | S-27 composition and role-specific sections. |
| `apps/panel/src/screens/advanced/use-streaming-channel.ts` | Idle-default versus live command semantics. |
| `apps/panel/src/screens/advanced/use-stream-targets.ts` | Admin-only list/create/update/delete query/mutations. |
| `apps/panel/src/screens/advanced/stream-target-form.tsx` | Controlled platform/display-name/URL/write-only-key editor with OSK and paste. |
| `apps/panel/src/screens/advanced/stream-target-list.tsx` | Saved targets, configured-key status, edit/delete actions. |
| `apps/panel/src/routes/router.tsx` | Nested Advanced route layout and real S-25/S-26/S-27 elements. |

Tests sit beside each `.ts`/`.tsx` unit; Playwright specs are `apps/panel/e2e/s25-advanced.spec.ts`, `s26-local-capture.spec.ts`, `s27-streaming.spec.ts`, and `s08-meeting.spec.ts`.

---

## Task 1: Align channel API/mock data with the existing contract and LP-7

**Files:**

- Modify: `packages/api-client/src/client.ts`
- Modify: `packages/api-client/src/index.ts`
- Modify: `packages/api-client/src/mock/rest/channels.ts`
- Modify: `packages/api-client/src/mock/seed/sources.ts`
- Modify: `packages/api-client/src/mock/seed/device.ts`
- Modify: `packages/api-client/src/mock/seed/index.ts`
- Modify: `apps/panel/src/screens/session/capture-outputs-row.tsx`
- Modify: `apps/panel/src/screens/session/capture-outputs-row.test.tsx`
- Modify: `apps/panel/src/screens/session/capture-assurance-card.test.tsx`
- Test: `packages/api-client/test/mock/wave3-channel-contract.test.ts`
- Modify test: `packages/api-client/test/mock/contract-honesty.test.ts`

**Interfaces:**

- Produces: `ChannelSnapshot { config: ChannelConfig; status: ChannelStatus }` and `listChannels(): Promise<ChannelSnapshot[]>`.
- Preserves: the three `channel.state` WS rows and all existing S-05 output rendering.

- [ ] **Step 1: Write failing adapter and LP-7 tests**

Assert all of the following in `wave3-channel-contract.test.ts`:

1. `listChannels()` returns exactly `local`, `meeting`, `streaming`, each with zod-valid `config` and `status`.
2. `allowedChannels` produces exactly the three preset sets in Global Constraints.
3. local defaults to `fifty-fifty`, is `alwaysOn`, and cannot be disabled.
4. `separate-files` has exactly two outputs (Presentation and Lecturer Camera).
5. an unbound required role rejects `updateChannelConfig` with `422 config.invalid` and a named title.
6. a lecturer may change `presetId`/`enabledByDefault` but receives `403 not-authorized` when writing `streamTargetIds`.
7. disabling a failed channel drives CH-10 to `off`, rather than illegally requesting CH-07.

Run: `pnpm --filter @eduscope/api-client test -- wave3-channel-contract`
Expected: FAIL against the current status-only response and drifted seed vocabulary.

- [ ] **Step 2: Correct the public client interface**

Use this exact mechanical shape in `client.ts`, export it from `index.ts`, and change the method signature:

```ts
export interface ChannelSnapshot {
  readonly config: ChannelConfig;
  readonly status: ChannelStatus;
}

listChannels(): Promise<ChannelSnapshot[]>;
```

- [ ] **Step 3: Return and validate `{ config, status }` rows**

In `mock/rest/channels.ts`, compose `zChannelSnapshot` from generated schemas and build each row from the seed config plus the live machine status. Do not hand-write a duplicate channel schema.

```ts
const zChannelSnapshot = z.object({
  config: zChannelConfig,
  status: zChannelStatus,
});
```

`updateChannelConfig` must:

- validate `preset.allowedChannels`;
- validate every `preset.requiredRoles` row has an enabled `SourceBinding` with a physical input;
- call `requireAdmin(ctx)` only when `streamTargetIds` is present;
- update the seed config and `world.data[channel.<id>.presetId|ratioA|ratioB]` so later WS transitions use the saved config;
- return the zod-validated `ChannelConfig`.

`disableChannel` chooses CH-10/CH-10S when the live machine is `failed`, otherwise CH-07/CH-07S.

- [ ] **Step 4: Fix seed truth once**

Build the default stream-target fixture before channel configs and thread its enabled target ids into `createSourcesSeed` when creating the streaming `ChannelConfig`; do not generate a second target-id list. Task 2 adds the empty-target World override after its `WorldSeed` field exists.

Replace the current `allowedChannels` drift with the exact LP-7 table. Change local's default from the currently invalid `pc-only` to `fifty-fifty`, and reduce `separate-files` to the two specified outputs.

- [ ] **Step 5: Adapt existing S-05 consumers**

`CaptureOutputsRow` iterates `snapshot.config.channelId`, falls back from WS to `snapshot.status`, and reads the display preset from the resulting `presetId`. Update its fixtures and the capture-assurance fixture shape; do not change S-05 copy or layout.

- [ ] **Step 6: Strengthen contract honesty**

Change `contract-honesty.test.ts` so each `listChannels` item parses both `zChannelConfig` and `zChannelStatus`. Keep the existing one-schema list table for sources/audio.

- [ ] **Step 7: Verify and commit**

```bash
pnpm --filter @eduscope/api-client typecheck
pnpm --filter @eduscope/api-client test
pnpm --filter @eduscope/panel test -- src/screens/session
git add packages/api-client apps/panel/src/screens/session/capture-outputs-row.tsx apps/panel/src/screens/session/capture-outputs-row.test.tsx apps/panel/src/screens/session/capture-assurance-card.test.tsx
git commit -m "fix(channels): align snapshots and presets with the contract"
```

---

## Task 2: Add only the missing Wave-3 scenario states

**Files:**

- Modify: `packages/api-client/src/mock/scenario/types.ts`
- Create: `packages/api-client/src/mock/scenario/scripts/channel-failures.ts`
- Modify: `packages/api-client/src/mock/scenario/registry.ts`
- Modify: `packages/api-client/src/mock/create-mock-client.ts`
- Modify: `packages/api-client/src/mock/seed/sources.ts`
- Modify: `packages/api-client/src/mock/seed/device.ts`
- Modify: `packages/api-client/src/mock/machines/channel.ts`
- Modify: `packages/api-client/src/mock/rest/channels.ts`
- Test: `packages/api-client/test/mock/wave3-scenarios.test.ts`
- Modify: `apps/panel/src/devtools/scenario-overlay.tsx`
- Modify: `apps/panel/src/devtools/scenario-overlay.test.tsx`

**Interfaces:**

- Adds `ScenarioName = ... | 'channel-failures'`.
- Adds `WorldSeed.studentsCameraBound: boolean` and `WorldSeed.streamTargetsConfigured: boolean`.
- Uses existing `ForcedTransition`; no new replacement mode, scheduler, or scenario-engine abstraction.

- [ ] **Step 1: Write failing scenario tests**

Cover:

- World `studentsCameraBound: false` makes `sources.status{students-cam}` be `unbound` in REST and initial WS snapshot.
- World `streamTargetsConfigured: false` returns `[]` and streaming `streamTargetIds: []`.
- first meeting enable under `channel-failures` reaches `failed` with a named reason; disable returns to off; second enable reaches on.
- first streaming enable reaches `preflight`, then `failed` with a named preflight reason; recording stays recording.
- first `updateChannelConfig` fails at transport after 1,200 ms, second returns named `422`, third succeeds.
- first `createStreamTarget` follows the same delayed-failure → named-422 → success sequence.
- CH-09/CH-09S emit `starting` with the restart reason, then return to on.

Run: `pnpm --filter @eduscope/api-client test -- wave3-scenarios`
Expected: FAIL because the script/seed fields/reasons do not exist.

- [ ] **Step 2: Add the focused script at full-code granularity**

Create `channel-failures.ts` with this complete rule set (use contract-valid `Problem` codes/titles):

```ts
import type { ScenarioScript } from '../types.js';

export const channelFailures: ScenarioScript = {
  name: 'channel-failures',
  description:
    'Output failures: a meeting consumer fails to start, streaming preflight fails without stopping the recording, and configuration saves demonstrate delayed transport failure then a named rejection before recovering.',
  forced: [
    { on: { transition: 'CH-05' }, nth: 1, replace: 'CH-06' },
    { on: { transition: 'CH-02' }, nth: 1, replace: 'CH-03' },
    { on: { command: 'updateChannelConfig' }, nth: 1, replace: 'unreachable', delayMs: 1_200 },
    {
      on: { command: 'updateChannelConfig' }, nth: 1, replace: 'refuse',
      refusal: { status: 422, code: 'config.invalid', title: 'This layout could not be applied.' },
    },
    { on: { command: 'createStreamTarget' }, nth: 1, replace: 'unreachable', delayMs: 1_200 },
    {
      on: { command: 'createStreamTarget' }, nth: 1, replace: 'refuse',
      refusal: { status: 422, code: 'validation.invalid', title: 'The streaming destination rejected these settings.' },
    },
  ],
};
```

Register it once in the catalog and update the overlay catalog-count assertion from nine to ten.

- [ ] **Step 3: Make failure/restart reasons observable**

In `channel.ts`, import the existing `set` effect and place it before `emit('channel.state')`:

- CH-01/CH-04/CH-05/CH-08/CH-10 clear the channel reason.
- CH-03 sets `The streaming destination could not be reached. Your lecture is still recording.`
- CH-06/CH-06S set `The output consumer did not start.`
- CH-09/CH-09S set `The output stopped unexpectedly and is restarting.`

This is mock payload data only; do not add `restarting` to the contract enum.

- [ ] **Step 4: Wire the two existing World-strip style controls**

Default both new fields to `true` in `create-mock-client.ts`. Seed an unbound Students Camera consistently in roles/status/bindings; `bootstrapFromSeed` and `seedSnapshot` must inspect the binding and must not drive that role to HL-02 when disabled.

Add overlay checkboxes labelled exactly:

- `Students Camera unbound`
- `No streaming destinations configured`

Switching either rebuilds the world and invalidates queries through the overlay's existing `rebuild` path.

- [ ] **Step 5: Add deterministic restart controls to the existing transport strip**

While `channel-failures` is active, show `Meeting consumer exited` and `Streaming consumer exited`. Read the two channels through atomic selectors; enable each button only when its channel is on. The click calls the already-exposed mock world transition (`CH-09` or `CH-09S`). Do not expose this through `EduscopeClient` and do not add a general force-state API.

- [ ] **Step 6: Verify and commit**

```bash
pnpm --filter @eduscope/api-client typecheck
pnpm --filter @eduscope/api-client test
pnpm --filter @eduscope/panel test -- src/devtools
git add packages/api-client apps/panel/src/devtools
git commit -m "test(scenarios): expose channel failure and restart states"
```

---

## Task 3: Build the shared channel query, command, picker, and preview units

**Files:**

- Create: `apps/panel/src/channels/channel-queries.ts`
- Create: `apps/panel/src/channels/channel-queries.test.tsx`
- Create: `apps/panel/src/channels/use-channel-config.ts`
- Create: `apps/panel/src/channels/use-channel-config.test.tsx`
- Create: `apps/panel/src/channels/use-channel-runtime-command.ts`
- Create: `apps/panel/src/channels/use-channel-runtime-command.test.tsx`
- Create: `apps/panel/src/channels/layout-preview.tsx`
- Create: `apps/panel/src/channels/layout-preview.test.tsx`
- Create: `apps/panel/src/channels/layout-preset-picker.tsx`
- Create: `apps/panel/src/channels/layout-preset-picker.test.tsx`
- Create: `apps/panel/src/channels/channels.css`

**Interfaces:**

- `CHANNEL_QUERY_KEYS.snapshots = ['channels']`, `CHANNEL_QUERY_KEYS.presets = ['layout-presets']` reuse the keys S-05 already uses.
- `useChannelCatalog(channelId)` returns `{ config, status, options, loading }`; each option is `{ preset, disabled, reason }`.
- `useChannelConfig(channelId)` returns `{ save(patch), phase, problem, reset }`, with phase `idle | saving | applied | refused`.
- `useChannelRuntimeCommand(channelId)` returns `{ requestEnabled(boolean), pending, problem }`; pending resolves only when WS reaches the requested terminal state or `T-CMD-RESOLVE` expires.
- `LayoutPreview` consumes one `LayoutPreset`; `LayoutPresetPicker` consumes pre-filtered options and mutation state.

- [ ] **Step 1: Test catalog filtering and invalid-role reasoning**

Tests must prove the full `/layouts` response is filtered by `allowedChannels`, an unbound required role remains visible-but-disabled with `Needs <role>, which is not connected.`, and an offline-but-bound role is not treated as unbound.

- [ ] **Step 2: Implement the query/cache boundary**

Use two TanStack queries and `useChannelStatus(channelId)`. Snapshot config is REST truth; live status is WS truth with the snapshot status as cold fallback. `useChannelConfig.onSuccess` replaces only the matching row's `config` in `['channels']`; it leaves the row's status and every other row unchanged.

- [ ] **Step 3: Test and implement async runtime commands**

Cover off → starting → on, on → stopping → off, refused command, stale connection, restart (`starting` + restart reason), and the 10-second unresolved ceiling. Never set checked=true on the 202.

- [ ] **Step 4: Build a data-driven preview**

For `single`/`composite`, position `tiles` as percentages of `canvas`. For `multi-file`, render one labelled frame per `outputs` entry rather than overlapping full-canvas tiles. Use the existing PC/camera visual vocabulary, but derive role, geometry, and file count from contract data. Tests cover all three kinds and prove no preset-id branch is required.

- [ ] **Step 5: Build the shared picker**

Each 150×110 minimum card contains preview, display name, description, selected check, and inline disabled reason. `aria-pressed` tracks the applied config, `aria-disabled`/`disabled` block invalid options, and only the tapped card shows saving. An applied message and refused message are adjacent to the grid in polite live regions.

- [ ] **Step 6: Verify and commit**

```bash
pnpm --filter @eduscope/panel test -- src/channels
pnpm --filter @eduscope/panel typecheck
git add apps/panel/src/channels
git commit -m "feat(channels): add shared channel controls and layout picker"
```

---

## Task 4: S-25 — role-scoped Advanced shell and nested routing

**Files:**

- Create: `apps/panel/src/screens/advanced/advanced-nav.ts`
- Create: `apps/panel/src/screens/advanced/advanced-shell.tsx`
- Create: `apps/panel/src/screens/advanced/advanced-shell.test.tsx`
- Create: `apps/panel/src/screens/advanced/advanced-index.tsx`
- Create: `apps/panel/src/screens/advanced/advanced.css`
- Modify: `apps/panel/src/routes/router.tsx`
- Modify: `apps/panel/src/routes/router.test.tsx`
- Modify: `apps/panel/src/auth/require-role.tsx`
- Modify: `apps/panel/src/auth/require-role.test.tsx`

**Component breakdown:**

- `ADVANCED_NAV_ITEMS`: exact path, S-id, label, icon and `roles` for 10 items. Preserve prototype order (Network, Encoder, Local Storage, Firmware, Users, Logs, Local Capture, Streaming), then append Upload Queue and Device & Identity.
- `AdvancedShell`: `getMe` cold skeleton, title/nav label by role, topbar Back button, role-filtered sidebar, `<Outlet>` content.
- `AdvancedIndex`: admin → `/advanced/network`; lecturer → `/advanced/local-capture`.
- Existing future screens remain `ScreenPlaceholder` children inside the real shell.

- [ ] **Step 1: Write one rendering/router test per S-25 state**

Tests: `admin` (10 items and exact title/label), `lecturer` (2 items), `category selected`, `back to dashboard`, `recording-live restrictions` (all permitted nav remains visible and recording chrome survives), U-1 shaped shell skeleton, U-2 inherited reconnecting marker without hiding nav, and U-6 lecturer deep-link to `/advanced/network` landing in the lecturer shell at `/advanced/local-capture`.

- [ ] **Step 2: Convert Advanced into a nested route**

Replace the three flat S-25/S-26/S-27 route entries with a parent `path: '/advanced'` whose element is `<RequireRole><AdvancedShell /></RequireRole>`. Add an index redirect and relative children for `local-capture`, `streaming`, and admin-only future routes. Keep `PanelShell` above it so S-03 header, alerts, recording frame, and pause indicator remain mounted.

Add an optional `redirectTo` prop to `RequireRole`; admin-only Advanced children pass `/advanced/local-capture`. Other role mismatches retain the existing `/` fallback.

- [ ] **Step 3: Port the shell's visual hierarchy**

Reproduce `.us-adm__topbar`, `.us-adm__sidebar`, `.us-adm__navitem`, and `.us-adm__content` with existing tokens. Content scrolls internally; sidebar does not scroll at 10 items; nav rows meet 48 px; Back to Dashboard meets 44 px and navigates to `/`.

- [ ] **Step 4: Verify and commit**

```bash
pnpm --filter @eduscope/panel test -- src/screens/advanced/advanced-shell src/routes src/auth/require-role
pnpm --filter @eduscope/panel typecheck
git add apps/panel/src/screens/advanced/advanced-nav.ts apps/panel/src/screens/advanced/advanced-shell.tsx apps/panel/src/screens/advanced/advanced-shell.test.tsx apps/panel/src/screens/advanced/advanced-index.tsx apps/panel/src/screens/advanced/advanced.css apps/panel/src/routes apps/panel/src/auth/require-role.tsx apps/panel/src/auth/require-role.test.tsx
git commit -m "feat(S-25): add the role-scoped Advanced shell"
```

---

## Task 5: S-26 — Local Capture Layout

**Files:**

- Create: `apps/panel/src/screens/advanced/use-local-capture-layout.ts`
- Create: `apps/panel/src/screens/advanced/use-local-capture-layout.test.tsx`
- Create: `apps/panel/src/screens/advanced/local-capture-screen.tsx`
- Create: `apps/panel/src/screens/advanced/local-capture-screen.test.tsx`
- Modify: `apps/panel/src/screens/advanced/advanced.css`
- Modify: `apps/panel/src/routes/router.tsx`

**Component breakdown:**

- `useLocalCaptureLayout`: selects `local`, exposes five filtered options, and delegates saves to `useChannelConfig`.
- `LocalCaptureScreen`: always-on header, large applied preview, shared picker, loading skeleton, result/refusal slot.
- There is no switch, toggle callback, or disabled-looking always-on switch.

- [ ] **Step 1: Write one test per S-26 state**

Cover `loading`/U-1, `populated`, `pending`/U-4, `invalid preset`, `applied`, `refused`/U-5, and U-2. Also assert exactly five local presets, selected styling follows the returned config rather than the tap, `separate-files` renders two outputs, and no switch exists.

- [ ] **Step 2: Implement the hook and screen**

Keep the large preview on the left and preset cards on the right at 1280×800. The card title and explanatory copy make local capture's always-on behavior explicit. During save, disable only conflicting preset actions; on stale WS, disable all mutations with the shell's reconnecting explanation.

- [ ] **Step 3: Verify and commit**

```bash
pnpm --filter @eduscope/panel test -- src/screens/advanced/use-local-capture-layout src/screens/advanced/local-capture-screen
pnpm --filter @eduscope/panel typecheck
git add apps/panel/src/screens/advanced apps/panel/src/routes/router.tsx
git commit -m "feat(S-26): add Local Capture layout configuration"
```

---

## Task 6: S-08 — Live Meeting card in the session sidebar

**Files:**

- Create: `apps/panel/src/screens/session/use-meeting-channel.ts`
- Create: `apps/panel/src/screens/session/use-meeting-channel.test.tsx`
- Create: `apps/panel/src/screens/session/meeting-channel-card.tsx`
- Create: `apps/panel/src/screens/session/meeting-channel-card.test.tsx`
- Modify: `apps/panel/src/screens/session/session-layout.tsx`
- Modify: `apps/panel/src/screens/session/session-layout.test.tsx`
- Modify: `apps/panel/src/screens/session/session.css`

**Component breakdown:**

- `useMeetingChannel`: shared catalog + runtime command + preset mutation, hard-bound to `meeting`; no idle/default branch.
- `MeetingChannelCard`: head row, status/reason, Toggle, Layouts button, three-card inline accordion, paused local echo.
- `SessionLayout`: owns `meetingLayoutsOpen`, renders Timer then Meeting card in the 430 px sidebar, and publishes `us-sessionlayout__sidebar--meeting-open` for Wave 4's insights wrapper.

- [ ] **Step 1: Write one test per S-08 state**

Cover `off`, combined `preflight / starting` pending rendering (feed both statuses), `on` open and closed, `failed` with named reason and checked=false, `restarting` distinct from ordinary starting, `stopping`, `accordion open`, `preset change pending`, `invalid preset`, `still on while paused`, U-1, U-2, U-4, and U-5.

Specific regressions:

- a 202 alone never checks the switch;
- turning on expands; turning off collapses; Layouts can collapse while still on;
- opening publishes the lifted sidebar class;
- meeting options are exactly `cams-fifty-fifty`, `cam-1`, `cam-2`;
- the failed/restarting copy never says recording stopped;
- reduced motion leaves the accordion contents reachable.

- [ ] **Step 2: Implement the command and accordion behavior**

Use the existing Toggle visual vocabulary, but bind checked strictly to `state === 'on'`. Pending states show spinner plus text. Restarting uses W3-D-5. Failure renders reason adjacent to the switch. Preset saves use the shared config mutation and do not close the accordion.

- [ ] **Step 3: Integrate within the existing S-05 height budget**

Timer remains first; meeting card follows. At the 388 px dense floor, card head remains visible and the accordion itself may internally clip/scroll, never the page. Do not add an insights placeholder. Assert no page overflow with both bottom bars expanded.

- [ ] **Step 4: Verify and commit**

```bash
pnpm --filter @eduscope/panel test -- src/screens/session
pnpm --filter @eduscope/panel typecheck
git add apps/panel/src/screens/session
git commit -m "feat(S-08): add the Live Meeting channel card"
```

---

## Task 7: S-27 — Streaming Configuration and admin target CRUD

**Files:**

- Create: `apps/panel/src/screens/advanced/use-streaming-channel.ts`
- Create: `apps/panel/src/screens/advanced/use-streaming-channel.test.tsx`
- Create: `apps/panel/src/screens/advanced/use-stream-targets.ts`
- Create: `apps/panel/src/screens/advanced/use-stream-targets.test.tsx`
- Create: `apps/panel/src/screens/advanced/stream-target-form.tsx`
- Create: `apps/panel/src/screens/advanced/stream-target-form.test.tsx`
- Create: `apps/panel/src/screens/advanced/stream-target-list.tsx`
- Create: `apps/panel/src/screens/advanced/stream-target-list.test.tsx`
- Create: `apps/panel/src/screens/advanced/streaming-screen.tsx`
- Create: `apps/panel/src/screens/advanced/streaming-screen.test.tsx`
- Modify: `apps/panel/src/screens/advanced/advanced.css`
- Modify: `apps/panel/src/routes/router.tsx`

**Component breakdown:**

- `useStreamingChannel`: idle uses `enabledByDefault` + `updateChannelConfig`; recording/paused uses 202 channel commands and WS status.
- `useStreamTargets`: enabled only for admins; list/create/update/delete, cache update/invalidation, Problem/transport normalization.
- `StreamTargetForm`: three platform chips only, display name, ingest URL, blank replacement key, configured/not-configured status, Paste, Save.
- `StreamTargetList`: enabled targets with edit and existing `DangerConfirm` delete.
- `StreamingScreen`: channel-control card, preview/picker card, then admin credentials/targets or lecturer management explanation.

- [ ] **Step 1: Write hook tests for the two toggle meanings**

At `idle`, label is `Stream on next recording`, checked is `config.enabledByDefault`, and the click calls only `updateChannelConfig`. At `recording`/`paused`, label is `Start streaming now` or `Stop streaming now`, checked comes only from WS, and the click calls only enable/disable. Starting/stopping/failed/restarting and stale states disable conflicting actions.

- [ ] **Step 2: Write one rendering test per S-27 state**

Cover `loading`/U-1, `no targets configured`, `populated`, channel `off`, `preflight`, `starting`, `on`, `failed`, `restarting`, `stopping`, `preflight failed`, `idle vs live toggle semantics`, `stream key write-only`, `saving`/U-4, `save rejected`/U-5, and U-2.

Role tests prove:

- lecturer never calls `listStreamTargets` and sees layout/toggle plus configured count;
- admin sees target list/form and can create/update/delete;
- platform chips are exactly YouTube, Facebook, Custom RTMP;
- no `StreamTarget` response or DOM node contains a stream key or masked fake value.

- [ ] **Step 3: Implement target CRUD and keyboard behavior**

Use controlled fields with `useOskField`. Editing pre-fills display name and ingest URL, leaves key empty, and sends `streamKey` only when the operator entered a replacement. Paste reads the clipboard on explicit tap; failure stays inline and never clears an existing field. Delete uses the existing danger confirmation and removes the target id from the streaming config only through an admin-authorized config mutation.

- [ ] **Step 4: Implement channel status and preflight honesty**

Preflight failure shows its named reason followed by `Your lecture is still recording.` The switch is never ON while failed. CH-09 says restarting, not starting. Target editing while streaming does not alter local/meeting state or recording chrome.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter @eduscope/panel test -- src/screens/advanced
pnpm --filter @eduscope/panel typecheck
git add apps/panel/src/screens/advanced apps/panel/src/routes/router.tsx
git commit -m "feat(S-27): add streaming configuration and target management"
```

---

## Complete State → Scenario-Overlay Map

Every inventory row is listed. **NEW** marks Wave-3 scenario/World controls. Query loading is demonstrated by entering the route after a scenario switch with its cache removed. S-08's combined pending row follows W3-D-7.

| Screen | Enumerated state | Overlay script/action |
|---|---|---|
| S-25 | `admin` | `happy`, sign in as admin, Advanced |
| S-25 | `lecturer` | `happy`, sign in as lecturer, Advanced |
| S-25 | `category selected` | `happy`, tap any permitted nav item |
| S-25 | `back to dashboard` | `happy`, Back to Dashboard |
| S-25 | `recording-live restrictions` | `happy` → Start → Advanced; nav remains present and recording chrome remains live |
| S-25 | U-1 | `happy`, cold first entry to Advanced after sign-in |
| S-25 | U-2 | `ws-flap`, wait past `T-WS-STALE` |
| S-25 | U-6 | `happy` as lecturer, navigate to `/advanced/network`; redirect to role-scoped S-25/S-26 |
| S-26 | `loading` / U-1 | `happy`, cold first entry to `/advanced/local-capture` |
| S-26 | `populated` | `happy`, `/advanced/local-capture` |
| S-26 | `pending` / U-4 | **NEW** `channel-failures`, first valid preset tap (1.2 s transport delay) |
| S-26 | `invalid preset` | `happy` + **NEW World:** Students Camera unbound |
| S-26 | `applied` | `happy`, choose another valid preset |
| S-26 | `refused` / U-5 | `channel-failures`, second valid preset tap (named 422) |
| S-26 | U-2 | `ws-flap`, wait past stale threshold |
| S-08 | `off` | `happy` → Start; meeting untouched |
| S-08 | `preflight / starting` | `happy` → Meeting on; legal meeting state is `starting`; S-27 below demonstrates `preflight` |
| S-08 | `on` | `happy` → Meeting on, wait for CH-05 |
| S-08 | `failed` | **NEW** `channel-failures` → Start → Meeting on (first CH-05 becomes CH-06) |
| S-08 | `restarting` | `channel-failures`, recover meeting to on → `Meeting consumer exited` |
| S-08 | `stopping` | `happy`, Meeting off |
| S-08 | `accordion open` | `happy`, Meeting on or Layouts |
| S-08 | `preset change pending` / U-4 | `channel-failures`, first valid preset tap |
| S-08 | `invalid preset` | `happy` + **NEW World:** Students Camera unbound, open Layouts |
| S-08 | `still on while paused` | `happy` → Start → Meeting on → Pause |
| S-08 | U-1 | `happy`, cold session render before channel/layout queries resolve |
| S-08 | U-2 | `ws-flap` while recording, wait past stale threshold |
| S-08 | U-5 | `channel-failures`, second valid preset tap |
| S-27 | `loading` / U-1 | `happy`, cold first entry to `/advanced/streaming` |
| S-27 | `no targets configured` | `happy` + **NEW World:** No streaming destinations configured |
| S-27 | `populated` | `happy` as admin |
| S-27 | channel `off` | `happy`, default state |
| S-27 | channel `preflight` | `happy` → Start → Start streaming now |
| S-27 | channel `starting` | same journey after CH-02 |
| S-27 | channel `on` | same journey after CH-05S |
| S-27 | channel `failed` / `preflight failed` | **NEW** `channel-failures` → Start → Start streaming now (first CH-02 becomes CH-03) |
| S-27 | channel `restarting` | `channel-failures`, recover streaming to on → `Streaming consumer exited` |
| S-27 | channel `stopping` | `happy`, Stop streaming now |
| S-27 | `idle vs live toggle semantics` | `happy`, compare idle label/action, then Start and compare live label/action |
| S-27 | `stream key write-only` | `happy` as admin, edit seeded target; Configured + blank key field |
| S-27 | `saving` / U-4 | `channel-failures`, first Save (1.2 s transport delay) |
| S-27 | `save rejected` / U-5 | `channel-failures`, second Save (named 422) |
| S-27 | U-2 | `ws-flap`, wait past stale threshold |

---

# Final Per-Screen Gates

These are the final tasks. Each gate is executable and writes evidence to `docs/plans/screens/wave-3-channels-and-outputs-gate.md`. A gate fails if a state row is missing even when the test command is green.

Standing preview command for every gate:

```bash
pnpm --filter @eduscope/panel build
pnpm --filter @eduscope/panel preview
```

The Playwright viewport remains 1280×800.

---

## Task 8: GATE S-25 — Advanced shell

- [ ] **Step 1: Add and run the primary/failure Playwright journeys**

`apps/panel/e2e/s25-advanced.spec.ts`:

- Primary: admin signs in → Advanced → exactly 10 nav rows → chooses Streaming → `aria-current=page` moves → Back returns to `/`.
- Lecturer journey: lecturer sees only Local Capture and Streaming.
- Failure/U-6: lecturer deep-links to `/advanced/network` and lands in the role-scoped shell at `/advanced/local-capture`, never a 403 card and never an admin nav row.
- Live restriction: start recording, enter Advanced, recording frame/notch persist and no nav item is silently removed.
- Geometry: sidebar does not scroll, every row ≥48 px, page has no scroll.

Run: `pnpm --filter @eduscope/panel e2e -- s25-advanced`
Expected: PASS.

- [ ] **Step 2: Run Testing Library for every enumerated state**

```bash
pnpm --filter @eduscope/panel test -- src/screens/advanced/advanced-shell src/routes src/auth/require-role
```

Expected: PASS with named tests for `admin`, `lecturer`, `category selected`, `back to dashboard`, `recording-live restrictions`, U-1, U-2, U-6.

- [ ] **Step 3: Execute the scenario demo checklist**

Walk every S-25 row in the Complete State → Scenario-Overlay Map and record observed copy, route, selected nav item, role, and recording chrome. Missing evidence fails the gate.

- [ ] **Step 4: Boundary lint still green**

```bash
pnpm lint
pnpm test tools/eslint-rules/gate-boundary.test.ts
```

Expected: exit 0; no direct network imports.

- [ ] **Step 5: Record and commit the gate**

```bash
git add apps/panel/e2e/s25-advanced.spec.ts docs/plans/screens/wave-3-channels-and-outputs-gate.md
git commit -m "test(S-25): gate the Advanced shell"
```

---

## Task 9: GATE S-26 — Local Capture Layout

- [ ] **Step 1: Add and run the primary/failure Playwright journeys**

`apps/panel/e2e/s26-local-capture.spec.ts`:

- Primary: lecturer opens Local Capture → sees five presets and Always on → chooses Separate files → only the tapped tile is pending → applied preview becomes two files → reload keeps the selection within the current mock world.
- Failure: `channel-failures`, first change shows pending then transport failure; second shows named refusal; third applies.
- Invalid: World Students Camera unbound leaves affected presets visible with reasons and disabled.
- Geometry: preset tiles ≥150×110, no toggle exists, page does not scroll; only content region may scroll with OSK closed.

Run: `pnpm --filter @eduscope/panel e2e -- s26-local-capture`
Expected: PASS.

- [ ] **Step 2: Run Testing Library for every enumerated state**

```bash
pnpm --filter @eduscope/panel test -- src/channels src/screens/advanced/use-local-capture-layout src/screens/advanced/local-capture-screen
```

Expected: PASS with named tests for loading/U-1, populated, pending/U-4, invalid preset, applied, refused/U-5, U-2.

- [ ] **Step 3: Execute the scenario demo checklist**

Walk every S-26 row in the Complete State → Scenario-Overlay Map. Confirm the exact five-item LP-7 vocabulary and that invalid presets are visible, named, and inert.

- [ ] **Step 4: Boundary lint still green**

```bash
pnpm lint
pnpm test tools/eslint-rules/gate-boundary.test.ts
```

Expected: exit 0; no direct network imports.

- [ ] **Step 5: Record and commit the gate**

```bash
git add apps/panel/e2e/s26-local-capture.spec.ts docs/plans/screens/wave-3-channels-and-outputs-gate.md
git commit -m "test(S-26): gate Local Capture layouts"
```

---

## Task 10: GATE S-27 — Streaming Configuration

- [ ] **Step 1: Add and run the primary/failure Playwright journeys**

`apps/panel/e2e/s27-streaming.spec.ts`:

- Primary/admin: open Streaming → edit seeded YouTube target without exposing its key → save a replacement key → set streaming default while idle → start recording → Start streaming now → preflight → starting → on → stop to off.
- Primary/lecturer: page is reachable; target endpoint is never called; layout/default/live controls work; admin management explanation is shown.
- Failure: `channel-failures` first live start reaches named preflight failure while recording chrome remains red; recover, reach on, simulate consumer exit, observe restarting then on.
- Save failure: first Save shows 1.2 s saving then transport failure; second shows named 422; third succeeds.
- Empty: World No streaming destinations configured renders the explanatory empty state.
- Secret regression: DOM/body snapshots contain no seeded/replacement key and no fake masked value.
- Geometry/OSK: chips and Paste ≥44 px; key is not truncated; opening OSK creates internal scrolling only and no page scroll.

Run: `pnpm --filter @eduscope/panel e2e -- s27-streaming`
Expected: PASS.

- [ ] **Step 2: Run Testing Library for every enumerated state**

```bash
pnpm --filter @eduscope/panel test -- src/channels src/screens/advanced/use-streaming-channel src/screens/advanced/use-stream-targets src/screens/advanced/stream-target-form src/screens/advanced/stream-target-list src/screens/advanced/streaming-screen
```

Expected: PASS with named tests for loading/U-1, no targets, populated, off, preflight, starting, on, failed, restarting, stopping, preflight failed, idle/live semantics, write-only key, saving/U-4, rejected/U-5, U-2.

- [ ] **Step 3: Execute the scenario demo checklist**

Walk every S-27 row in the Complete State → Scenario-Overlay Map. Record the toggle label and method semantics at idle versus live, the preflight copy, and proof that local recording is unaffected.

- [ ] **Step 4: Boundary lint and contract honesty still green**

```bash
pnpm lint
pnpm test tools/eslint-rules/gate-boundary.test.ts
pnpm --filter @eduscope/api-client test -- contract-honesty wave3-channel-contract wave3-scenarios
```

Expected: exit 0; no direct network imports and no secret-bearing/mock-invalid response.

- [ ] **Step 5: Record and commit the gate**

```bash
git add apps/panel/e2e/s27-streaming.spec.ts docs/plans/screens/wave-3-channels-and-outputs-gate.md
git commit -m "test(S-27): gate streaming configuration"
```

---

## Task 11: GATE S-08 — Live Meeting card and Wave-3 exit condition

- [ ] **Step 1: Add and run the primary/failure Playwright journeys**

`apps/panel/e2e/s08-meeting.spec.ts`:

- Primary: `happy` → start recording → meeting off → turn on (spinner, not checked) → on + accordion open → choose Cam 1 → collapse Layouts while staying on → Pause shows local still-on echo and S-03 persistent indicator → Resume → turn off through stopping to off.
- Failure: `channel-failures` first enable reaches failed with a named reason and unchecked switch; disable acknowledges to off; second enable reaches on; simulate consumer exit and observe restarting distinctly before recovery.
- Invalid: World Students Camera unbound keeps both affected meeting presets visible and disabled with reasons.
- Reconnecting: `ws-flap` disables the switch and preset commands; nothing queues for replay.
- Geometry: all controls ≥44 px, accordion works under reduced motion, both bottom bars expanded still produce no page scroll.

Run: `pnpm --filter @eduscope/panel e2e -- s08-meeting`
Expected: PASS.

- [ ] **Step 2: Run Testing Library for every enumerated state**

```bash
pnpm --filter @eduscope/panel test -- src/channels src/screens/session src/shell/streaming-while-paused
```

Expected: PASS with named tests for off, preflight and starting renderings, on open/closed, failed, restarting, stopping, accordion open, preset pending, invalid preset, still on while paused, U-1, U-2, U-4, U-5.

- [ ] **Step 3: Execute the scenario demo checklist**

Walk every S-08 row in the Complete State → Scenario-Overlay Map. For the combined `preflight / starting` row, record meeting's legal `starting` demo and cross-reference S-27's real `preflight` evidence per W3-D-7; do not inject an illegal meeting-machine state.

- [ ] **Step 4: Boundary lint, full tests, and prior gates still green**

```bash
pnpm lint
pnpm test tools/eslint-rules/gate-boundary.test.ts
pnpm typecheck
pnpm test
pnpm gate
```

Expected: exit 0 throughout; no component imports a direct network primitive.

- [ ] **Step 5: Demonstrate the Wave-3 exit condition**

From one mock session, demonstrate all three channels with the exact LP-7 vocabulary:

1. Before recording, set local layout and streaming default in Advanced.
2. Start recording; local is on and cannot be toggled.
3. Enable Live Meeting, change among its three camera-only presets, and leave it on through Pause.
4. Enable Streaming through preflight; prove meeting, streaming, and local remain independent.
5. Force a streaming preflight failure and a meeting consumer restart; in both cases recording remains active.
6. Stop each optional channel and confirm only that consumer changes.
7. Confirm admin sees 10 categories, lecturer sees only the two output pages.

- [ ] **Step 6: Record and commit the final gate**

Complete `docs/plans/screens/wave-3-channels-and-outputs-gate.md` with all four screen sections, the Wave-3 exit condition, and any contract gap found in execution (record only; do not amend contracts in the gate).

```bash
git add apps/panel/e2e/s08-meeting.spec.ts docs/plans/screens/wave-3-channels-and-outputs-gate.md
git commit -m "test(S-08): gate Live Meeting and close Wave 3"
```
