# Wave 5 — Recordings Library & Upload Queue (S-21, S-22, S-23, S-24, S-35) Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox
> (`- [ ]`) syntax for tracking. **This project does NOT use
> superpowers:subagent-driven-development** — execute inline, committing after
> each task, and stop for review at the per-screen gates (Tasks 19–23).

**Goal:** Build the recordings library (S-21), recording detail + authenticated
player (S-22), USB export overlay (S-23), delete-recording confirm (S-24), and
the admin upload queue (S-35) — five screens that share one derived upload/merge
badge and open from one list.

**Architecture:** Each screen is a route/overlay under `apps/panel/src`. All data
crosses the `EduscopeClient` boundary (mock adapter today); REST snapshots come
through TanStack Query and live transitions through the zustand WS store
(`store/ws-store.ts` + `store/selectors.ts`). The badge is a single pure function
(`use-recording-badge.ts`) imported by both S-21 rows and S-35 rows so the two
screens can never disagree. New live events (`recording.artifact`, `upload.job`,
`upload.part`, `export.job`, `usb.volumes`) are added to the store and driven by
the mock's REST operations and scenario catalog.

**Tech Stack:** React 18, react-router 7, TanStack Query 5, zustand 5, zod 3,
Vitest + Testing Library, Playwright. Mock world is a discrete-event simulation in
`packages/api-client/src/mock`.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied
verbatim from the binding design docs.

- **Contract floor: v0.5.0.** CG-3, CG-5, CG-7, CG-20, CG-21 are already applied
  (commit `ab7ae78`); the `EduscopeClient` methods and zod schemas below already
  exist. Do **not** re-amend the contract.
- **Client boundary (frontend-conventions §1, ENFORCED by `pnpm lint`):** no
  component imports `fetch`, `axios`, `WebSocket`, `XMLHttpRequest`, `EventSource`,
  `RTCPeerConnection`, or reads `window.fetch`/`navigator.sendBeacon`. The only
  network boundary is `EduscopeClient` (`packages/api-client`). Rule source:
  `tools/eslint-rules/no-direct-network.js`; it applies to `apps/**` and
  `packages/**` except `packages/api-client/src/**`. The S-22 player's `<video>`
  source is an object URL built from the `Blob` that `client.getRecordingMedia`
  returns — never a hand-assembled URL.
- **Data flow:** TanStack Query owns request/response; the WS store owns the push
  channel. Screens read WS state through `store/selectors.ts` only — one atomic
  selector per field, or `useWsShallow` for a multi-field read. Never call
  `useWsStore()` with no selector and never return a fresh object/array from a
  bare `useWsStore(...)`.
- **Commands are 202-async:** a `CommandAccepted` means ACCEPTED, not DONE. The UI
  reacts to the resolving WS transition within `TIMERS['T-CMD-RESOLVE']` (10 s);
  after that it renders a failure, never a spinner. No optimistic UI unless the
  screen spec says so. There is **no** outbound command queue — a command tapped
  while disconnected must not fire on reconnect (U-2).
- **Kiosk & touch (frontend-conventions §3):** fixed 1280×800; the page itself
  never scrolls — only internal regions do. Touch targets ≥ 44 px (`--tap-min`);
  multi-target rows ≥ 64 px (`--tap-row-lg`). No hover-only affordances. Text
  fields open the shared on-screen keyboard; screens size with
  `calc(var(--panel-h) - var(--osk-h))` and never re-render when it opens. Every
  icon-only button has an `aria-label`.
- **Tokens (frontend-conventions §6):** no new colour, spacing, or type value.
  Reuse the token sheet (`docs/design/screen-inventory.md §8`,
  `apps/panel/src/styles/tokens.css`). If a screen seems to need a token that does
  not exist, that is a gate question — not an in-run mint.
- **The badge is one derivation, shared verbatim (S-21 LIB-D-1):** `mergeState` +
  derived `uploadState` + the client-derivable retention predicate → label + tone
  + glyph, written once in `use-recording-badge.ts`, imported by S-21 and S-35.
  Colour is never the only signal — every badge pairs a word with its tone.
- **Admin gating (U-6):** delete (`deleteRecording`), merge-retry
  (`retryMergeRecording`), the upload queue route, and requeue
  (`requeueUploadJob`) are admin-only. A control the role cannot use is **absent**,
  not disabled; a `403` reaching the UI is a bug surface rendered as `refused`.
- **Testing floor (per screen, frontend-conventions §5):** a Testing Library
  render test for **each enumerated state**; a Playwright primary journey + at
  least one failure scenario; every mock response validates against the
  `contracts/` zod schemas. Every enumerated state is reachable from the scenario
  dev overlay.

## Contract & scaffold facts the tasks rely on (already true today)

- `EduscopeClient` (`packages/api-client/src/client.ts`) already exposes:
  `listRecordings({cursor,limit,state,includeDeleted,q,ownerUserId})`,
  `getRecording(id)`, `deleteRecording(id)`, `retryMergeRecording(id)`,
  `getRecordingMedia(id,fileId,{download})` → `Blob`, `listExportTargets()`,
  `createExport({recordingIds,targetDevicePath})` → `ExportJob`, `getExport(id)`,
  `cancelExport(id)`, `listUploadJobs({cursor,limit,state})`, `getUploadJob(id)`,
  `requeueUploadJob(id)`.
- Enums (`packages/shared/src/schemas/generated/zod.gen.ts`): `RecordingState =
  capturing|finalizing|merging|ready|failed|deleted`; `MergeState =
  not-needed|pending|running|done|failed`; `UploadJobState =
  queued|uploading|completing|done|failed|dead-letter|cancelled`;
  `UploadFailureClass = connectivity|server|permanent`; `ExportJobState =
  queued|copying|completed|failed|cancelled`; `SegmentState =
  capturing|finalizing|finalized|truncated|failed`; `SegmentEndReason =
  pause|stop|crash|error|takeover`. `Recording.deleteReason ∈
  admin|retention|disk-pressure|null`.
- Event payloads (`packages/shared/src/schemas/events.ts`) already defined:
  `RecordingArtifactPayload {recordingId,sessionId,state,mergeState,durationMs,
  totalBytes,deleteReason}`, `UploadJobPayload {jobId,recordingId,state,attempt,
  failureClass,nextAttemptAt,progressPct,lastError,blockedBy}`, `UploadPartPayload
  {partId,jobId,streamKey,state,bytesSent,bytesTotal}`, `ExportJobPayload
  {jobId,state,bytesCopied,bytesTotal,error}`, `UsbVolumesPayload {volumes}`.
- **The WS store does NOT yet ingest these five events** — `ws-store.ts`'s ingest
  switch falls through to `default: return {}` for `upload.*` etc. Task 1 adds them.
- `ClientProvider` (`apps/panel/src/client/client-provider.tsx:67`) already
  subscribes `client.events$` into `useWsStore.getState().ingest`, so new store
  slices flow automatically once ingest handles the event.
- Routes already exist as placeholders: `/library` → S-21, `/library/:recordingId`
  → S-22 (`routes/router.tsx`), `/advanced/uploads` → S-35 (admin child). Tasks
  wire the real elements into `SCREEN_ELEMENTS` / `ADVANCED_SCREEN_ELEMENTS`.
- The mock is fully seeded for Wave 5 (`mock/seed/recordings.ts`): 8 recordings
  spanning `ready`/`merging`(mergeState running)/`failed`(mergeState failed)/
  `deleted`, plus `uploadState` values `done`/`uploading`/`dead-letter`/`failed`,
  5 upload jobs including CG-20 `connectivity` (attempt 0) and `server` (attempt 3)
  failure classes, and 2 USB volumes (one too small for CG-21). All owned by
  lecturer `a.perera`.
- Overlays mount through `useOverlays().open(node, { dismissible })` /
  `OverlayHost` (`overlays/overlay-host.tsx`). `DangerConfirm` / `DangerButton`
  (`danger/`) implement S-06 §3 (states `confirm|pending|refused|done`, initial
  focus Cancel, `dismissible:false`). Role comes from `useAuth().role`.
- The scenario dev overlay (`devtools/scenario-overlay.tsx`) renders
  `listScenarios()` live, so a new scenario in the registry appears automatically;
  `WorldSeed` checkboxes render from `client.worldSeed`.
- Merge pattern reference: `apps/panel/src/ai/use-questions.ts` (REST snapshot +
  live delta map + `invalidateQueries` on newly-seen ids + 202 pending resolved by
  the promised WS transition, ceiling `T-CMD-RESOLVE`).

## State → scenario / seed demonstration map (the dev-overlay checklist)

Most Wave-5 states render from the **static seed under the default `happy`
world** the moment the screen opens; only genuinely live transitions need a
scenario. New scenario/world work is delivered in Tasks 3–4.

| Screen · state | How it is reached from the dev overlay |
|---|---|
| S-21 loading (U-1) | cold mount; `ws-flap` for the reconnecting variant |
| S-21 empty (lecturer/admin) | World knob **`recordingsPresent:false`** (Task 3) |
| S-21 populated + badges #1–#9 | default `happy` — seed rows 0–7 already cover ready/merging/merge-failed/uploading/dead-letter/failed(offline)/failed(server)/deleted |
| S-21 retention-marker (#9) | seed a row aged past `retentionDeleteAfter` with `uploadState≠done` (Task 8 seed note) under `happy` |
| S-21 removed-under-user (state 9) | **`disk-full`** emits `recording.artifact{deleted,deleteReason:disk-pressure}` for a visible row (Task 4) |
| S-21 deleting (self, state 10) | admin opens ⋯→Delete (S-24) → `deleteRecording` emits `recording.artifact{deleted,deleteReason:admin}` (Task 2) |
| S-21 deleted-tombstone | admin + `Show deleted` chip → `includeDeleted=true` returns seed row 5 |
| S-21 selection mode / load-more | tap Select; Load-more appears when the mock page has a `nextCursor` |
| S-22 populated single / preparing / merge-failed / deleted | open seed rows 0 (ready) / 3 (merging) / 4 (mergeState failed) ; deleted via `disk-full` while open |
| S-22 not found / forbidden | navigate to a bad id (mock 404); open a non-owned recording as a second lecturer (mock 403, Task 2) |
| S-22 file missing / playback failed | Testing Library with a crafted `RecordingDetail` (primary); overlay shows file-missing via the `failed` seed row's derived `missing` file |
| S-22 retry pending → preparing | admin taps Retry under `pipeline-crash-midway` → `retryMergeRecording` emits `recording.artifact{merging}` (Task 2) |
| S-23 no drive / drives listed / insufficient space | World knob `recordingsPresent` irrelevant; `no drive` via empty-targets knob (Task 3); default seed lists 2 drives (one too small) |
| S-23 queued → copying → completed | run an export under `happy`; `createExport` drives `export.job` byte steps (Task 3) |
| S-23 drive removed mid-copy | **`usb-pull`** scenario (`exportOutcome:drive-removed`, Task 3–4) |
| S-23 cancelled / create refused | Cancel copy → `export.job{cancelled}`; pick the too-small drive after a race → `422 export.insufficient-space` (CG-21, already in mock) |
| S-24 confirm / never-uploaded / in-flight / pending / refused / deleted | open Delete on seed rows: row 0 (uploaded), row 3/5 (uploadState≠done → never-uploaded), row 1 (uploading → in-flight line); refused via a lecturer token |
| S-35 loading / empty | cold mount; empty via **`recordingsPresent:false`** (Task 3) |
| S-35 preparing/queued/uploading/done | seed jobs (row 1 uploading 62%, row 0 done) under `happy` |
| S-35 offline (CG-20) vs failed(server) | static seed jobs (connectivity attempt 0 vs server attempt 3); live transition into offline via **`wan-loss`** (Task 4) |
| S-35 dead-letter + requeue | seed job (row 2 dead-letter) → Try again now → `requeueUploadJob` emits `upload.job{queued}` (Task 2) |
| S-35 part expansion / cancelled | expand any row (`getUploadJob` parts); cancelled appears after an S-24 deletion of a mid-upload recording |

---

## Task 1: Wave-5 WS store slices & selectors

Add the five Wave-5 live events to the store so every screen's hook can merge
live transitions over its REST snapshot. Mechanical — full code below.

**Files:**
- Modify: `apps/panel/src/store/ws-store.ts`
- Modify: `apps/panel/src/store/selectors.ts`
- Test: `apps/panel/src/store/ws-store.test.ts`
- Test: `apps/panel/src/store/selectors.test.tsx`

**Interfaces:**
- Produces (consumed by Tasks 7, 10, 15, 17):
  - `WsState.artifacts: Record<string, RecordingArtifactPayload>` (keyed by `recordingId`)
  - `WsState.uploadJobs: Record<string, UploadJobPayload>` (keyed by `recordingId`; one job per recording, INV-UJ-1)
  - `WsState.uploadParts: Record<string, UploadPartPayload>` (keyed by `partId`)
  - `WsState.exportJobs: Record<string, ExportJobPayload>` (keyed by `jobId`)
  - `WsState.usbVolumes: UsbVolumesPayload | null`
  - selectors: `useArtifactEvents()`, `useUploadJobEvents()`, `useUploadPartEvents()`, `useExportJobEvents()`, `useUsbVolumes()`

- [ ] **Step 1: Write the failing test** in `ws-store.test.ts`

```ts
it('ingests recording.artifact keyed by recordingId', () => {
  useWsStore.getState().ingest(envelope('recording.artifact', {
    recordingId: 'R1', sessionId: 'S1', state: 'deleted', mergeState: 'done',
    durationMs: null, totalBytes: null, deleteReason: 'disk-pressure',
  }, 0));
  expect(useWsStore.getState().artifacts['R1']?.state).toBe('deleted');
});

it('ingests upload.job keyed by recordingId and export.job by jobId', () => {
  useWsStore.getState().ingest(envelope('upload.job', {
    jobId: 'J1', recordingId: 'R2', state: 'queued', attempt: 0,
    failureClass: null, nextAttemptAt: null, progressPct: 0, lastError: null, blockedBy: null,
  }, 1));
  useWsStore.getState().ingest(envelope('export.job', {
    jobId: 'E1', state: 'copying', bytesCopied: 10, bytesTotal: 100, error: null,
  }, 2));
  expect(useWsStore.getState().uploadJobs['R2']?.state).toBe('queued');
  expect(useWsStore.getState().exportJobs['E1']?.bytesCopied).toBe(10);
});

it('ingests usb.volumes as the latest list', () => {
  useWsStore.getState().ingest(envelope('usb.volumes', { volumes: [] }, 3));
  expect(useWsStore.getState().usbVolumes?.volumes).toEqual([]);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @eduscope/panel test -- store/ws-store.test.ts`
Expected: FAIL (`artifacts` undefined / patches not applied).

- [ ] **Step 3: Add the state fields, EMPTY defaults, ingest cases, and imports** in `ws-store.ts`

Add to the payload-type import from `@eduscope/shared`:
`RecordingArtifactPayload, UploadJobPayload, UploadPartPayload, ExportJobPayload, UsbVolumesPayload`.

Add to `interface WsState` (near the other keyed maps):

```ts
  /** S-21/S-22: live recording.artifact keyed by recordingId (merge/ready/failed/deleted). */
  artifacts: Record<string, RecordingArtifactPayload>;
  /** S-21/S-35: live upload.job keyed by recordingId (one job per recording, INV-UJ-1). */
  uploadJobs: Record<string, UploadJobPayload>;
  /** S-35: live upload.part keyed by partId (expanded rows). */
  uploadParts: Record<string, UploadPartPayload>;
  /** S-23: live export.job keyed by jobId. */
  exportJobs: Record<string, ExportJobPayload>;
  /** S-23: the latest session-scoped usb.volumes list (CG-3). */
  usbVolumes: UsbVolumesPayload | null;
```

Add to `EMPTY`: `artifacts: {}, uploadJobs: {}, uploadParts: {}, exportJobs: {}, usbVolumes: null,`.

Add these cases to the ingest `switch` (before `default:`):

```ts
        case 'recording.artifact':
          return { artifacts: { ...get().artifacts, [envelope.payload.recordingId]: envelope.payload } };
        case 'upload.job':
          return { uploadJobs: { ...get().uploadJobs, [envelope.payload.recordingId]: envelope.payload } };
        case 'upload.part':
          return { uploadParts: { ...get().uploadParts, [envelope.payload.partId]: envelope.payload } };
        case 'export.job':
          return { exportJobs: { ...get().exportJobs, [envelope.payload.jobId]: envelope.payload } };
        case 'usb.volumes':
          return { usbVolumes: envelope.payload };
```

- [ ] **Step 4: Add selectors** in `selectors.ts`

```ts
export const useArtifactEvents = () => useWsShallow((s) => s.artifacts);
export const useUploadJobEvents = () => useWsShallow((s) => s.uploadJobs);
export const useUploadPartEvents = () => useWsShallow((s) => s.uploadParts);
export const useExportJobEvents = () => useWsShallow((s) => s.exportJobs);
export const useUsbVolumes = () => useWsStore((s) => s.usbVolumes);
```

Add a `selectors.test.tsx` case asserting `useUploadJobEvents` returns a stable
reference across an unrelated ingest (the `useWsShallow` guarantee), mirroring the
existing `usePublicationsList` test.

- [ ] **Step 5: Run tests and confirm they pass**

Run: `pnpm --filter @eduscope/panel test -- store/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/store/
git commit -m "feat(wave5): WS store slices + selectors for recording.artifact/upload.*/export.job/usb.volumes"
```

---

## Task 2: Mock REST resolving-event emits + honest getRecording/getRecordingMedia authorization

Make the Wave-5 REST commands emit their single resolving WS event (so the
202-async contract works end-to-end and the demo checklist states are reachable),
and enforce per-request ownership on `getRecording`/`getRecordingMedia` (C-1, so
S-22's `forbidden` state is reachable). Mechanical — full code.

**Files:**
- Modify: `packages/api-client/src/mock/rest/recordings.ts`
- Modify: `packages/api-client/src/mock/rest/uploads.ts`
- Test: `packages/api-client/test/mock/wave5-library-queue.test.ts` (new)

**Interfaces:**
- Consumes: `RestContext.world.emit(event, payload)`, `currentUser(ctx)`,
  `isAdmin(ctx)` (already imported in `rest/recordings.ts`).
- Produces: `recording.artifact` (delete/retry), `upload.job` (requeue),
  `export.job` (cancel), `usb.volumes` (targets) resolving events; `403` from
  `getRecording`/`getRecordingMedia` for a non-owner lecturer.

- [ ] **Step 1: Write the failing test** (new file)

```ts
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../../src/mock/create-mock-client.js';
// helper: log in as admin / a second lecturer, collect events$ payloads.
```
Tests to include:
- `deleteRecording` (admin) emits one `recording.artifact` with `state:'deleted'`, `deleteReason:'admin'`, matching `recordingId`.
- `retryMergeRecording` (admin) on the `mergeState:'failed'` seed row emits `recording.artifact{state:'merging', mergeState:'running'}`.
- `requeueUploadJob` (admin) on the dead-letter seed job emits `upload.job{state:'queued'}` for that recording.
- `cancelExport` emits `export.job{state:'cancelled'}`.
- `listExportTargets` emits a `usb.volumes` snapshot whose `volumes` equals the seed drives.
- `getRecording` as a lecturer who is **not** the owner throws `ProblemError` `403`; as the owner or an admin it resolves.
- `getRecordingMedia` as a non-owner lecturer throws `403`.

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @eduscope/api-client test -- wave5-library-queue`
Expected: FAIL (no events emitted; getRecording never 403s).

- [ ] **Step 3: Emit resolving events in `rest/recordings.ts`**

In `deleteRecording`, after setting `row.state='deleted'`/`deletedAt`/`deleteReason`, before the `return`:

```ts
      world.emit('recording.artifact', {
        recordingId: row.id, sessionId: row.sessionId, state: 'deleted',
        mergeState: row.mergeState, durationMs: row.durationMs,
        totalBytes: row.totalBytes, deleteReason: 'admin',
      });
```

In `retryMergeRecording`, after setting `row.state='merging'`/`row.mergeState='running'`:

```ts
      world.emit('recording.artifact', {
        recordingId: row.id, sessionId: row.sessionId, state: 'merging',
        mergeState: 'running', durationMs: row.durationMs,
        totalBytes: row.totalBytes, deleteReason: null,
      });
```

In `cancelExport`, after `job.state='cancelled'`:

```ts
      world.emit('export.job', {
        jobId: job.id, state: 'cancelled', bytesCopied: job.bytesCopied,
        bytesTotal: job.bytesTotal, error: null,
      });
```

In `listExportTargets`, before returning:

```ts
      world.emit('usb.volumes', { volumes: seed.usbVolumes });
```

Add per-request ownership to `getRecording` (after the `404` check) and
`getRecordingMedia` (after its `404`): a lecturer who is not the owner gets `403`.

```ts
      const me = currentUser(ctx);
      if (!isAdmin(ctx) && row.ownerUserId !== me.id) {
        throw new ProblemError({ status: 403, code: 'forbidden', title: 'You do not have access to this recording' });
      }
```

- [ ] **Step 4: Emit the resolving event in `rest/uploads.ts`**

In `requeueUploadJob`, after `row.state='queued'` and the counter updates, add
(`world` is already destructured from `ctx`):

```ts
      world.emit('upload.job', {
        jobId: row.id, recordingId: row.recordingId, state: 'queued',
        attempt: row.attempt, failureClass: null, nextAttemptAt: null,
        progressPct: 0, lastError: null, blockedBy: null,
      });
```

- [ ] **Step 5: Run tests and confirm they pass**

Run: `pnpm --filter @eduscope/api-client test -- wave5-library-queue`
Expected: PASS. Also run `pnpm --filter @eduscope/api-client test` to confirm the
existing `contract-honesty` and `operation-coverage` suites stay green (emitted
payloads validate through `world.emit`'s `zEventEnvelope.parse`).

- [ ] **Step 6: Commit**

```bash
git add packages/api-client/
git commit -m "feat(wave5): mock REST resolving-event emits + per-request recording authorization"
```

---

## Task 3: Mock live export progression + WorldSeed knobs (empty & export outcome)

Give `createExport` a real byte-stepping `export.job` progression, and add two
World knobs: `recordingsPresent` (empty states for S-21/S-35) and `exportOutcome`
(so `usb-pull` can end a copy in a removed-drive failure). Mechanical — full code.

**Files:**
- Modify: `packages/api-client/src/mock/scenario/types.ts` (WorldSeed fields)
- Modify: `packages/api-client/src/mock/create-mock-client.ts` (merged defaults)
- Modify: `packages/api-client/src/mock/seed/recordings.ts` (respect `recordingsPresent`)
- Modify: `packages/api-client/src/mock/rest/recordings.ts` (`createExport` progression)
- Modify: `apps/panel/src/devtools/scenario-overlay.tsx` (two checkboxes)
- Test: `packages/api-client/test/mock/wave5-library-queue.test.ts` (extend)

**Interfaces:**
- Produces: `WorldSeed.recordingsPresent: boolean` (default `true`),
  `WorldSeed.exportOutcome: 'complete' | 'drive-removed' | 'failed'` (default
  `'complete'`); a `createExport` that drives `export.job` → `copying` (≥ ~5 %
  byte steps) → terminal on `world.clock`.

- [ ] **Step 1: Write failing tests** (extend the Task-2 file)

- With default world, `createExport` for a fitting drive drives `export.job`
  events `queued → copying (bytesCopied increasing) → completed`, with
  `bytesCopied === bytesTotal` at completion; collected via a fake clock advanced
  through the schedule.
- With `exportOutcome:'drive-removed'`, the terminal event is
  `export.job{state:'failed', error:/removed/i}` and `bytesCopied < bytesTotal`.
- With `recordingsPresent:false`, `listRecordings` (lecturer) returns
  `{items:[], nextCursor:null}` and `listUploadJobs` (admin) returns `{items:[]}`.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @eduscope/api-client test -- wave5-library-queue`
Expected: FAIL.

- [ ] **Step 3: Add the WorldSeed fields** in `scenario/types.ts`

```ts
  /** Wave 5 — when false, the recordings/uploads seed is empty: S-21 & S-35 empty states. */
  readonly recordingsPresent: boolean;
  /** Wave 5 — how a live export terminates (S-23 `usb-pull` uses 'drive-removed'). */
  readonly exportOutcome: 'complete' | 'drive-removed' | 'failed';
```

- [ ] **Step 4: Add the merged defaults** in `create-mock-client.ts` `build()`'s `merged` object

```ts
      recordingsPresent: true,
      exportOutcome: 'complete',
```
(placed alongside the other defaults, before `...script.seed`).

- [ ] **Step 5: Honour `recordingsPresent` in the seed**

`createSeed` calls `createRecordingsSeed(users)`. Thread the flag through: give
`createRecordingsSeed(users, opts?: { recordingsPresent?: boolean })` and, when
`recordingsPresent === false`, return `{ recordings: [], uploadJobs: [],
exportJobs: [], usbVolumes }` (keep `usbVolumes` — the export flow still lists
drives). Pass `{ recordingsPresent: merged.recordingsPresent }` from `createSeed`.
Verify the `createSeed` signature already receives the merged `WorldSeed` (it is
built from it in `build()`); if not, thread the flag the same way `aiEnabled` is.

- [ ] **Step 6: Drive the export progression** in `rest/recordings.ts` `createExport`

Replace the current `return job;` tail with a scheduled progression. Add a module
helper:

```ts
function driveExport(world: RestContext['world'], job: ExportJob, outcome: 'complete' | 'drive-removed' | 'failed') {
  const STEP_MS = 300;
  const steps = 6; // ~5% granularity of bytesTotal across the copy
  world.clock.setTimeout(() => {
    world.emit('export.job', { jobId: job.id, state: 'copying', bytesCopied: 0, bytesTotal: job.bytesTotal, error: null });
  }, STEP_MS);
  for (let i = 1; i <= steps; i += 1) {
    const copied = Math.floor((job.bytesTotal * i) / steps);
    const failHere = outcome !== 'complete' && i === Math.ceil(steps / 2);
    world.clock.setTimeout(() => {
      if (failHere) {
        job.state = 'failed';
        world.emit('export.job', {
          jobId: job.id, state: 'failed', bytesCopied: copied, bytesTotal: job.bytesTotal,
          error: outcome === 'drive-removed' ? 'The drive was removed before the copy finished' : 'The copy failed',
        });
        return;
      }
      if (job.state !== 'queued' && job.state !== 'copying') return; // cancelled/failed already
      if (i === steps) {
        job.state = 'completed';
        job.bytesCopied = job.bytesTotal;
        world.emit('export.job', { jobId: job.id, state: 'completed', bytesCopied: job.bytesTotal, bytesTotal: job.bytesTotal, error: null });
      } else {
        job.bytesCopied = copied;
        world.emit('export.job', { jobId: job.id, state: 'copying', bytesCopied: copied, bytesTotal: job.bytesTotal, error: null });
      }
    }, STEP_MS * (i + 1));
  }
}
```

Call `driveExport(world, job, ctx.worldSeed.exportOutcome)` before `return job;`.
Confirm `RestContext` exposes `worldSeed` (it is passed to `createRestOperations`
in `create-mock-client.ts`); if the outcome is not on `RestContext`, read it from
the `worldSeed` field the context already carries. If a `failHere` step fires,
later steps guard on `job.state` so they no-op.

- [ ] **Step 7: Add the two dev-overlay checkboxes** in `scenario-overlay.tsx`'s
`<fieldset className="us-devoverlay__world">` (mirror the existing checkbox idiom):

```tsx
            <label>
              <input type="checkbox"
                checked={!client.worldSeed.recordingsPresent}
                onChange={(e) => rebuild(active, { ...seed, recordingsPresent: !e.target.checked })}
                aria-label="No recordings on device (empty state)" />
              No recordings on device (empty state)
            </label>
            <label>
              <input type="checkbox"
                checked={client.worldSeed.exportOutcome === 'drive-removed'}
                onChange={(e) => rebuild(active, { ...seed, exportOutcome: e.target.checked ? 'drive-removed' : 'complete' })}
                aria-label="Export fails mid-copy (drive removed)" />
              Export fails mid-copy (drive removed)
            </label>
```

- [ ] **Step 8: Run tests and confirm they pass**

Run: `pnpm --filter @eduscope/api-client test -- wave5-library-queue` then
`pnpm --filter @eduscope/api-client test`.
Expected: PASS (contract-honesty stays green).

- [ ] **Step 9: Commit**

```bash
git add packages/api-client/ apps/panel/src/devtools/
git commit -m "feat(wave5): live export.job progression + recordingsPresent/exportOutcome world knobs"
```

---

## Task 4: Scenario `emits` primitive + `usb-pull`/`wan-loss` scenarios + disk-full retention removal

Add a minimal scenario primitive for scheduling raw entity events (the discrete
machines model no upload/export/retention lifecycle), then use it for the three
new live demonstrations. Mechanical — full code.

**Files:**
- Modify: `packages/api-client/src/mock/scenario/types.ts` (`ScheduledEmit`, `emits`)
- Modify: `packages/api-client/src/mock/create-mock-client.ts` (schedule `emits`)
- Create: `packages/api-client/src/mock/scenario/scripts/usb-pull.ts`
- Create: `packages/api-client/src/mock/scenario/scripts/wan-loss.ts`
- Modify: `packages/api-client/src/mock/scenario/registry.ts` (register both, add to `ScenarioName`)
- Modify: `packages/api-client/src/mock/scenario/scripts/disk-full.ts` (retention `emits`)
- Test: `packages/api-client/test/scenario/wave5-scenarios.test.ts` (new)

**Interfaces:**
- Produces: `ScenarioName` gains `'usb-pull' | 'wan-loss'`; `ScenarioScript.emits?:
  readonly ScheduledEmit[]`; `ScheduledEmit = { event: PanelEventName; afterMs:
  number; payload: (seed: Seed) => unknown }`.

- [ ] **Step 1: Write failing tests** (new file)

- Switching to `wan-loss` and advancing the clock emits an `upload.job` for the
  uploading seed job with `state:'failed'`, `failureClass:'connectivity'`,
  `attempt:0` (S-35 offline).
- Switching to `disk-full` and advancing the clock emits a `recording.artifact`
  with `state:'deleted'`, `deleteReason:'disk-pressure'` for a seed recording.
- `usb-pull`'s `worldSeed.exportOutcome === 'drive-removed'`.
- `listScenarios()` includes `usb-pull` and `wan-loss`.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @eduscope/api-client test -- wave5-scenarios`
Expected: FAIL.

- [ ] **Step 3: Add the primitive** in `scenario/types.ts`

Add `PanelEventName` to the `@eduscope/shared` import and a type-only
`import type { Seed } from '../seed/index.js';`. Then:

```ts
/** A raw entity event a script schedules on the world clock (no machine behind it). */
export interface ScheduledEmit {
  readonly event: PanelEventName;
  readonly afterMs: number;
  /** Built from the seed so it can reference deterministic seed ids. */
  readonly payload: (seed: Seed) => unknown;
}
```
Add to `ScenarioScript`: `readonly emits?: readonly ScheduledEmit[];`

- [ ] **Step 4: Schedule `emits`** in `create-mock-client.ts` `build()`, right after the `timeline` loop

```ts
    for (const e of script.emits ?? []) {
      world.clock.setTimeout(() => world.emit(e.event, e.payload(seed)), e.afterMs);
    }
```
(`seed` and `world` are already in scope there.)

- [ ] **Step 5: Create the two scripts**

`scripts/usb-pull.ts`:

```ts
import type { ScenarioScript } from '../types.js';

/** S-23 failure path: the copy starts, then the drive is pulled mid-transfer.
 *  The source recordings are never touched (INV-EX-3) — Try again re-copies. */
export const usbPull: ScenarioScript = {
  name: 'usb-pull',
  description: 'A USB copy is interrupted: the drive is removed mid-transfer, the export fails, and the recordings stay safe on the device.',
  forced: [],
  seed: { exportOutcome: 'drive-removed' },
};
```

`scripts/wan-loss.ts`:

```ts
import type { ScenarioScript } from '../types.js';

/** S-35 CG-20: an in-flight upload loses the network. It becomes failed +
 *  connectivity, spending NO attempt — "Waiting for the network", not "failed N of 8". */
export const wanLoss: ScenarioScript = {
  name: 'wan-loss',
  description: 'The upload server becomes unreachable: an in-flight upload switches to "waiting for the network" and spends no retry attempts (§4.4).',
  forced: [],
  emits: [
    {
      event: 'upload.job',
      afterMs: 2_000,
      payload: (seed) => {
        const job = seed.uploadJobs.find((j) => j.state === 'uploading') ?? seed.uploadJobs[0]!;
        return {
          jobId: job.id, recordingId: job.recordingId, state: 'failed',
          failureClass: 'connectivity', attempt: 0, nextAttemptAt: null,
          progressPct: job.progressPct, lastError: 'connect timeout — no route to the upload server', blockedBy: null,
        };
      },
    },
  ],
};
```

- [ ] **Step 6: Register both** in `registry.ts`

Add imports and entries to `CATALOG` (`'usb-pull': usbPull, 'wan-loss': wanLoss`),
and add `| 'usb-pull' | 'wan-loss'` to the `ScenarioName` union in `types.ts`
(with a one-line "Added for Wave 5's S-23/S-35" comment matching the existing
per-wave comments).

- [ ] **Step 7: Extend `disk-full.ts`** with the retention removal

Add to the `diskFull` object (keep the existing `seed`/`forced`):

```ts
  emits: [
    {
      event: 'recording.artifact',
      afterMs: 3_000,
      payload: (seed) => {
        const r = seed.recordings[0]!; // a visible, uploaded library row
        return {
          recordingId: r.id, sessionId: r.sessionId, state: 'deleted',
          mergeState: r.mergeState, durationMs: r.durationMs, totalBytes: r.totalBytes,
          deleteReason: 'disk-pressure',
        };
      },
    },
  ],
```

- [ ] **Step 8: Run tests and confirm they pass**

Run: `pnpm --filter @eduscope/api-client test -- wave5-scenarios` then
`pnpm --filter @eduscope/api-client test`.
Expected: PASS. (The scenario coverage test may assert the catalog size — update
that count if it exists.)

- [ ] **Step 9: Commit**

```bash
git add packages/api-client/
git commit -m "feat(wave5): scenario emits primitive + usb-pull/wan-loss scenarios + disk-full retention removal"
```

---

## Task 5: Shared badge derivation `use-recording-badge` (pure)

The single §3 derivation, JSX-free and data-source-free, imported by S-21 and
S-35. This is the one thing the two screens must render identically.

**Files:**
- Create: `apps/panel/src/screens/library/use-recording-badge.ts`
- Test: `apps/panel/src/screens/library/use-recording-badge.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 6, 8, 17):
  ```ts
  export type BadgeTone = 'success' | 'accent' | 'warning' | 'danger' | 'muted' | 'record';
  export interface RecordingBadge {
    readonly label: string;
    readonly tone: BadgeTone;
    readonly glyph: string;          // decorative reinforcement only (● ◐ ▲ ⚠)
    readonly secondary?: string;     // the RET-2 "kept" second line (#9)
  }
  export function recordingBadge(rec: Pick<Recording,
    'state' | 'mergeState' | 'uploadState' | 'progressPct' extends never ? never : never>,
    now?: number): RecordingBadge;
  ```
  Practically the input is the `Recording` fields `state`, `mergeState`,
  `uploadState`, `retentionDeleteAfter`, plus the live `progressPct`/`nextAttemptAt`
  the caller supplies from `upload.job` (pass a small `{progressPct?, nextAttemptAt?}`
  as a second arg rather than reading a store). Signature:
  `recordingBadge(rec: Recording, live?: { progressPct?: number; nextAttemptAt?: string | null }, now?: number): RecordingBadge`.

**The §3.1 matrix (precedence: merge state outranks upload state; #9 is a second line):**

| # | Condition | label | tone | glyph |
|---|---|---|---|---|
| 8 | `state === 'capturing'` | `Recording` | record | ● |
| 1 | `mergeState ∈ {pending, running}` | `Preparing…` | muted | ◐ |
| 2 | `mergeState === 'failed'` | `Couldn't prepare this recording` | warning | ⚠ |
| 3 | `uploadState === 'queued'` (no merge) | `Waiting to upload` | muted | ◐ |
| 4 | `uploadState ∈ {uploading, completing}` | `Uploading… {progressPct}%` | accent | ▲ |
| 5 | `uploadState === 'done'` | `Uploaded` | success | ● |
| 6 | `uploadState === 'failed'` | `Upload failed — retrying (next try {nextAttemptAt})` | warning | ▲ |
| 7 | `uploadState === 'dead-letter'` | `Upload needs attention` | danger | ⚠ |
| 9 | `now > retentionDeleteAfter ∧ uploadState !== 'done'` | (second line) `Kept — never uploaded (won't auto-delete)` | warning | ⚠ |

- [ ] **Step 1: Write the failing tests** — one assertion per matrix row (#1–#9),
  driven by `mergeState`/`uploadState`/`retentionDeleteAfter` combinations, asserting
  `{label, tone}`; plus: precedence (a `mergeState:'running'` row with
  `uploadState:'failed'` reads `Preparing…`, not the upload label); #9 composes as
  `secondary` onto an otherwise-normal badge (a `failed` upload past retention shows
  both the upload label and the "Kept" second line); `nextAttemptAt` is quoted from
  the field, `progressPct` from the live arg (never a guessed backoff).

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @eduscope/panel test -- use-recording-badge`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `recordingBadge`** — a pure `switch`/`if` ladder in
  precedence order, no imports beyond the `Recording` type and no JSX. The RET-2
  predicate is `Date.parse(rec.retentionDeleteAfter) < (now ?? Date.now()) &&
  rec.uploadState !== 'done'`. Return `secondary` only when #9 holds.

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm --filter @eduscope/panel test -- use-recording-badge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/panel/src/screens/library/use-recording-badge.*
git commit -m "feat(S-21/S-35): pure use-recording-badge derivation (LIB-D-1)"
```

---

## Task 6: `recording-badge.tsx` presentation

Render `recordingBadge`'s verdict as the chip — pure of any data source (it can
only receive a `Recording` + optional live fields), so it can never be wired to a
placebo.

**Files:**
- Create: `apps/panel/src/screens/library/recording-badge.tsx`
- Create: `apps/panel/src/screens/library/library.css` (badge tones map to existing tokens)
- Test: `apps/panel/src/screens/library/recording-badge.test.tsx`

**Interfaces:**
- Consumes: `recordingBadge` (Task 5).
- Produces: `<RecordingBadge rec={Recording} live={{progressPct?, nextAttemptAt?}}/>`.

**Component:** maps `tone → token class` (`success→--success`, `accent→--accent`,
`warning→--warning`, `danger→--danger`/`--danger-soft`, `muted→--text-muted`,
`record→--record`/`--record-soft` per §7 token table), renders `glyph` +
`label` + optional `secondary` second line. The label is always text (LIB-D-2);
the glyph is `aria-hidden`.

- [ ] **Step 1:** Write render tests: label text present for a `done` and a
  `dead-letter` recording; the `secondary` line renders when #9 holds; the status
  reads without colour (assert the word, not a class); glyph is `aria-hidden`.
- [ ] **Step 2:** Run → FAIL. `pnpm --filter @eduscope/panel test -- recording-badge`
- [ ] **Step 3:** Implement the component + the `.us-badge` tone classes in `library.css` using existing tokens only.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(S-21): RecordingBadge chip`.

---

## Task 7: `use-recordings.ts` — paged list + live merge

The paged `listRecordings` query keyed on `{q, ownerUserId, state, includeDeleted}`,
merged live with `recording.artifact` and `upload.job`. Handles Load-more (cursor,
C-7), U-1/U-3 (no populated→skeleton flash), removed-under-user, and selection.

**Files:**
- Create: `apps/panel/src/screens/library/query-keys.ts`
- Create: `apps/panel/src/screens/library/use-recordings.ts`
- Test: `apps/panel/src/screens/library/use-recordings.test.ts`

**Interfaces:**
- Consumes: `useClient()`, `useArtifactEvents()`, `useUploadJobEvents()` (Task 1),
  `useIsStale()`.
- Produces (consumed by Tasks 8, 9):
  ```ts
  export interface LibraryFilters { q?: string; ownerUserId?: string; state?: RecordingState; includeDeleted?: boolean }
  export interface RemovedRow { recordingId: string; deleteReason: string | null }
  export interface UseRecordings {
    loading: boolean;
    rows: readonly Recording[];         // REST rows patched by live artifact/upload.job
    removed: readonly RemovedRow[];     // rows an artifact{deleted} pulled under the user (state 9/10)
    hasMore: boolean;
    loadMore(): void;
    loadingMore: boolean;
  }
  export function useRecordings(filters: LibraryFilters): UseRecordings;
  ```
- `LIB_KEYS.recordings(filters)` in `query-keys.ts`, mirroring `AI_KEYS`.

**Behaviour notes (design, not code):**
- Use `useQuery` (or `useInfiniteQuery`) keyed on the full filter object; Load-more
  appends the next `nextCursor` page without re-skeletoning existing rows (U-3).
  The mock returns `nextCursor` when the slice exceeds `limit`.
- Merge: for each REST row, overlay the live `artifacts[row.id]`
  (mergeState/uploadState/state) and `uploadJobs[row.id]`
  (progressPct/nextAttemptAt fed to the badge) — the same shape `use-questions.ts`
  uses. An artifact with `state:'deleted'` for a currently-listed row moves it to
  `removed` with its `deleteReason` (state 9/10) and drops it from `rows`.
- The hook issues **no** owner predicate of its own (C-1) — it renders exactly what
  the page returns. Filters map to server params only.
- Changing a filter resets the cursor (a new query key) — never a client filter.

- [ ] **Step 1:** Write tests:
  - lecturer token: renders exactly the mock's owner-scoped page; asserts no client owner-filtering (feed a mixed-owner mock page and assert every returned row renders).
  - `q`/`ownerUserId` change re-issues `listRecordings` with the param and a reset cursor.
  - a live `upload.job{progressPct}` for a listed row updates the badge input without a refetch.
  - a live `recording.artifact{deleted, deleteReason}` for a listed row moves it to `removed`.
  - Load-more appends page 2 and existing rows keep their identity (no skeleton flash).
- [ ] **Step 2:** Run → FAIL. `pnpm --filter @eduscope/panel test -- use-recordings`
- [ ] **Step 3:** Implement the query + merge + removed/selection derivation.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(S-21): use-recordings paged query + live merge`.

---

## Task 8: S-21 row, filters, and selection bar

The presentational pieces of the list. Row is presentation-only (knows nothing
about fetching or roles); filters map edits to `LibraryFilters`; the selection bar
owns selection state and the Σ-bytes total.

**Files:**
- Create: `apps/panel/src/screens/library/recording-row.tsx`
- Create: `apps/panel/src/screens/library/library-filters.tsx`
- Create: `apps/panel/src/screens/library/selection-bar.tsx`
- Modify: `apps/panel/src/screens/library/library.css`
- Test: `recording-row.test.tsx`, `library-filters.test.tsx`, `selection-bar.test.tsx`

**Interfaces:**
- `<RecordingRow rec={Recording} live={{progressPct?, nextAttemptAt?}} showOwner={boolean} selectable={boolean} selected={boolean} onOpen onPlay onToggle onMenu/>` — 64 px row; body is the detail tap target; Play and ⋯ and the checkbox are each their own ≥ 44 px target ≥ 8 px apart (§8); renders `<RecordingBadge/>`; owner shown only when `showOwner`. Tombstone variant (deleted row): `--surface-2`/`--text-faint`, **no Play**, shows `deletedAt`/`deleteReason`/`deletedBy`.
- `<LibraryFilters value={LibraryFilters} isAdmin={boolean} onChange/>` — Search chip (text field → `q`, opens the OSK), and for admin the Owner picker chip (→ `ownerUserId`) and a `Show deleted` chip (→ `includeDeleted`). Chips, not menus; clearing a chip re-issues without the param.
- `<SelectionBar count={number} totalBytes={number} onCancel onExport/>` — replaces the title row; shows count + Σ `totalBytes`; `Copy to USB →` calls `onExport`.

**State → this task:** populated rows (badges #1–#9), owner column (admin),
tombstone (deleted), selection mode, the two/three filter chips.

- [ ] **Step 1:** Write render tests:
  - `RecordingRow`: body/Play/checkbox are distinct targets each ≥ their min (assert roles + accessible names `{title}, {badge label}, {duration}`); owner hidden when `showOwner=false`; tombstone has no Play control.
  - `LibraryFilters`: typing Search calls `onChange({q})`; Owner picker absent for a lecturer, present for admin; clearing a chip emits the param removed.
  - `SelectionBar`: renders count and summed bytes; `Copy to USB →` fires `onExport`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the three components + CSS (existing tokens; §7 token table).
- [ ] **Step 4:** Run → PASS. `pnpm --filter @eduscope/panel test -- library/`
- [ ] **Step 5:** Commit `feat(S-21): recording row, filters, selection bar`.

---

## Task 9: `library-screen.tsx` + wire route + header entry point (LIB-D-6)

The route container (title/filters/list/load-more/empty), wired real, reachable
from a header entry visible to both roles.

**Files:**
- Create: `apps/panel/src/screens/library/library-screen.tsx`
- Modify: `apps/panel/src/routes/router.tsx` (`SCREEN_ELEMENTS['S-21']`)
- Modify: `apps/panel/src/shell/panel-header.tsx` (a `Recordings` link, both roles)
- Modify: `apps/panel/src/shell/shell.css` (link styling, existing tokens)
- Test: `library-screen.test.tsx`; Modify: `apps/panel/src/routes/router.test.tsx`

**Interfaces:**
- Consumes: `useRecordings` (Task 7), `useAuth().role`, the Task-8 components,
  `useOverlays` (to open S-23 from the selection bar, wired in Task 16;
  placeholder `onExport` here that Task 16 replaces).
- Produces: the mounted S-21 screen at `/library`.

**Behaviour:**
- Fixed header/title/filter rows; the **list body scrolls internally**
  (`calc(var(--panel-h) - …)`), page never scrolls (§8).
- Empty states: lecturer `You haven't recorded anything yet.` / admin `No
  recordings on this device.` (choose by `role`).
- Loading = skeleton rows in the list shape (U-1), not a full-screen spinner; no
  populated→skeleton flash on resync (U-3).
- Selection mode toggles the checkbox column and the selection bar; tapping a row
  in selection mode toggles its checkbox instead of opening detail.
- Removed-under-user rows animate out with the non-alarming note keyed on
  `deleteReason` (`retention → removed after 14 days`, `disk-pressure → removed to
  free space`, `admin → removed by an administrator`).
- The header `Recordings` link routes to `/library` for both roles (LIB-D-6). (The
  post-stop "Saved" toast link is S-03/S-04's surface, out of scope here — note it
  as a requirement placed on S-04.)

**State → this task:** loading, empty(lecturer), empty(admin), populated,
selection mode, load-more pending, removed-under-user, deleted-tombstone, U-2.

- [ ] **Step 1:** Write render tests for each S-21 state via a mock client:
  loading, both empty states (World knob `recordingsPresent:false` or a mock
  returning `[]`), populated, selection mode + Σ bytes, load-more pending, removed
  (ingest a `recording.artifact{deleted}` for a visible row → non-alarming note per
  reason), tombstone (admin + `includeDeleted`), U-2 (stale disables destructive
  taps). Add a `router.test.tsx` assertion that `/library` renders the real screen.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the screen, wire `SCREEN_ELEMENTS['S-21']`, add the header link.
- [ ] **Step 4:** Run → PASS. `pnpm --filter @eduscope/panel test -- library-screen router`
- [ ] **Step 5:** Commit `feat(S-21): library screen + route + header entry point`.

---

## Task 10: S-22 `use-recording-detail.ts`

`getRecording(id)` merged live with `recording.artifact` (merge/ready/failed/
deleted) and `upload.job` (the header badge). Surfaces `404`/`403` as typed states.

**Files:**
- Create: `apps/panel/src/screens/library/detail/use-recording-detail.ts`
- Test: `apps/panel/src/screens/library/detail/use-recording-detail.test.ts`

**Interfaces:**
- Consumes: `useClient()`, `useArtifactEvents()`, `useUploadJobEvents()`, `ProblemError`.
- Produces (consumed by Tasks 11, 12):
  ```ts
  export type DetailStatus = 'loading' | 'not-found' | 'forbidden' | 'ready' | 'deleted';
  export interface UseRecordingDetail {
    status: DetailStatus;
    detail: RecordingDetail | null;   // patched by live artifact/upload.job
    refetch(): void;                  // used by retry-merge to reload after the merging event
  }
  export function useRecordingDetail(recordingId: string): UseRecordingDetail;
  ```
- The screen-level state (`preparing`/`merge failed`/`file missing`/`populated
  single|multi`) is derived in Task 12 from `detail.mergeState`/`files`, not here.

- [ ] **Step 1:** Tests: 404 → `not-found`; 403 → `forbidden`; 200 → `ready` with
  segments/files; a live `recording.artifact{deleted}` while mounted → `deleted`; a
  live `recording.artifact{merging}` after a retry re-derives to `ready` with
  `mergeState:'running'` (invalidates/refetches like `use-questions`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement query + typed-error mapping + live merge.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(S-22): use-recording-detail`.

---

## Task 11: S-22 player, stream-picker, segment-list, file-list, retry-merge

The presentational + control pieces. The player's source is an object URL built
from the client's `Blob` (boundary-safe). Admin Retry is a function of `role`,
tested without rendering the player.

**Files (all under `apps/panel/src/screens/library/detail/`):**
- Create: `recording-player.tsx`, `stream-picker.tsx`, `segment-list.tsx`, `file-list.tsx`, `retry-merge.tsx`
- Create: `detail.css`
- Test: one `*.test.tsx` per component

**Interfaces:**
- `<RecordingPlayer recordingId file={RecordingFile}/>` — custom touch controls
  (play/pause ≥ 56 px, scrub ≥ 24 px tall + ≥ 44 px thumb, skip/mute/fullscreen
  ≥ 44 px, all `aria-label`led; scrub is a `slider` with `aria-valuetext` =
  timecode). `src` is `URL.createObjectURL(await client.getRecordingMedia(recordingId,
  file.id))`, revoked on unmount. A media error surfaces `playback failed`
  (Try again) — distinct from `file missing` (`file.state === 'missing'`, C-6).
- `<StreamPicker files value onChange/>` — ≥ 44 px chips over the distinct
  `streamKey`s; absent when there is one `streamKey` (C-2).
- `<SegmentList segments/>` — ordered by `index` (SEG-2), with `⚠ seam` markers for
  `truncated`/`crash` (naming the `endReason`: `crash → pipeline restart`, else
  `ended early`) and `✕ no usable footage` for `failed` (SEG-5). Informational.
- `<FileList files/>` — downloadable deliverables; Download uses
  `client.getRecordingMedia(…, {download:true})` and states it targets the browser.
- `<RetryMerge recordingId/>` — admin-only (`useAuth().role === 'admin'`, else
  renders nothing, U-6); owns the `retryMergeRecording` 202 and resolves on
  `recording.artifact{merging}` (U-4, ceiling `T-CMD-RESOLVE`); `409` → U-5 named
  reason, the button replaced by the remedy; styled `--accent` (recovery, not
  `--danger`, DTL-D-3).

- [ ] **Step 1:** Tests:
  - player builds `src` via the client (assert the client media method is called; a `403`/error from it surfaces `forbidden`/`playback failed`, not a frozen frame); `file.state==='missing'` renders `file missing` with the admin S-35 link and no player.
  - stream-picker absent for one streamKey; present + switches source for two (keyed on `streamKey`, never file index).
  - segment-list renders seam words for `truncated`/`crash`/`failed` (assert the words, not colour).
  - retry-merge renders for admin only; a `409` shows U-5 and the button is replaced (never re-tappable).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the five components + CSS.
- [ ] **Step 4:** Run → PASS. `pnpm --filter @eduscope/panel test -- detail/`
- [ ] **Step 5:** Commit `feat(S-22): player, stream picker, segment/file lists, admin retry`.

---

## Task 12: `recording-detail-screen.tsx` + wire route

The route container that selects the per-state body and wires S-22 real.

**Files:**
- Create: `apps/panel/src/screens/library/detail/recording-detail-screen.tsx`
- Modify: `apps/panel/src/routes/router.tsx` (`SCREEN_ELEMENTS['S-22']`)
- Test: `recording-detail-screen.test.tsx`; Modify: `router.test.tsx`

**Interfaces:** Consumes `useRecordingDetail` (Task 10) + Task-11 components +
`useParams().recordingId`. Derives the screen state from `status` + `mergeState` +
`files`: `loading`/`not found`/`forbidden`/`populated (single|multi)`/`preparing`
(mergeState pending|running → play a segment, no merged file yet)/`merge failed`
(mergeState failed → segments kept + admin Retry)/`playing`/`playback failed`/`file
missing`/`deleted`. `‹ Back to recordings` routes to `/library`. Detail body
scrolls internally; player has a fixed aspect box (§7).

**State → this task:** all §4 states (loading, not found, forbidden, populated
single/multi, preparing, merge failed, playing, playback failed, file missing,
retry pending, deleted, U-2).

- [ ] **Step 1:** Write one render test per §4 state (mock a `RecordingDetail`
  per case; `merge failed` tested for **both** admin (Retry present) and lecturer
  (Retry absent, U-6); `deleted` via a live `recording.artifact{deleted}`). Add a
  `router.test.tsx` assertion that `/library/:id` renders the real screen.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the container + state derivation; wire `SCREEN_ELEMENTS['S-22']`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(S-22): recording detail screen + route`.

---

## Task 13: S-24 delete confirm + entry points

The `DangerConfirm` instance (the entire screen; everything else is the shared
danger folder, C-1). Chooses the body from `uploadState`, adds the in-flight line,
owns the `deleteRecording` 202. Wired into S-21's ⋯ menu and S-22's actions
(admin only, U-6).

**Files:**
- Create: `apps/panel/src/screens/library/delete-recording-confirm.tsx`
- Create: `apps/panel/src/screens/library/delete-body.ts` (pure body/label selection)
- Modify: `apps/panel/src/screens/library/recording-row.tsx` (⋯ → Delete, admin only)
- Modify: `apps/panel/src/screens/library/detail/recording-detail-screen.tsx` (Delete action, admin only)
- Test: `delete-recording-confirm.test.tsx`, `delete-body.test.ts`

**Interfaces:**
- `deleteBody(rec: Recording): { body: string; escalated: boolean; inFlight: boolean; metaTag: 'uploaded' | 'never uploaded' }`
  — pure: `escalated = rec.uploadState !== 'done'` (§2.2 stronger body, C-3);
  `inFlight = rec.uploadState ∈ {queued, uploading, completing}` (§2.3 line, C-5).
- `open(<DeleteRecordingConfirm rec={Recording} onDone/>, { dismissible: false })`
  — supplies title/body/label to `DangerConfirm`; maps 202 → `pending`, refusal
  `403`/`404`/`409` → `refused` (named reason, destructive button replaced by
  Close), `recording.artifact{deleted}` → `done` (closes; opener reflects removal).
  Copy verbatim from S-24 §5 (Title `Delete this recording?`, the two bodies, the
  in-flight line, `Cancel`/`Delete`/`Deleting…`, the two refusal strings).

**State → this task:** confirm (uploaded), confirm (never uploaded), confirm +
in-flight, pending, refused (lecturer 403 bug surface / 409), deleted, U-2
(destructive button disabled while stale). No type-to-confirm (C-6).

- [ ] **Step 1:** Tests:
  - `deleteBody`: uploaded → calm body + `uploaded` tag; `uploadState:'failed'/null` → escalated body + `never uploaded` tag; `uploadState:'uploading'` → `inFlight` true.
  - confirm dialog: initial focus is Cancel (inherited); Delete → `pending` (both locked); a lecturer `403` → `refused` with the named reason and Close replacing Delete; `recording.artifact{deleted}` → dialog closes; while stale (U-2) the destructive button is disabled.
  - `recording-row` shows Delete in ⋯ only for admin.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `delete-body.ts`, the confirm, and the two admin-only entry points.
- [ ] **Step 4:** Run → PASS. `pnpm --filter @eduscope/panel test -- delete-`
- [ ] **Step 5:** Commit `feat(S-24): delete-recording confirm + admin entry points`.

---

## Task 14: S-23 `use-eta.ts` (pure)

The ETA is a pure function of transfer bytes over time (EXP-D-3) — no client, no
store, mirroring S-20's `quiz-qr` structural discipline.

**Files:**
- Create: `apps/panel/src/screens/library/export/use-eta.ts`
- Test: `apps/panel/src/screens/library/export/use-eta.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface EtaSample { bytesCopied: number; at: number }  // at = ms epoch
  /** seconds remaining, smoothed over recent samples; null before enough samples. */
  export function computeEta(bytesTotal: number, samples: readonly EtaSample[]): number | null;
  ```

- [ ] **Step 1:** Tests: fewer than 2 samples → `null` (shows "Starting…"); a steady
  byte-rate over samples → a plausible smoothed seconds-remaining; the function holds
  no state and reads no `freeBytes` (structural: it takes only the two args).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement (rate = Δbytes/Δtime over the recent window; remaining =
  (bytesTotal − last.bytesCopied)/rate).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(S-23): pure use-eta`.

---

## Task 15: S-23 `use-export.ts`

Opens the flow (calling `listExportTargets`, which marks the session subscribed,
CG-3/C-3), merges `usb.volumes` live, issues `createExport`, tracks the job via
`getExport` + `export.job`. Exposes the §4 state.

**Files:**
- Create: `apps/panel/src/screens/library/export/use-export.ts`
- Test: `apps/panel/src/screens/library/export/use-export.test.ts`

**Interfaces:**
- Consumes: `useClient()`, `useUsbVolumes()`, `useExportJobEvents()` (Task 1),
  `useEta`, `useIsStale()`.
- Produces (consumed by Task 16):
  ```ts
  export type ExportState = 'no-drive' | 'drives-listed' | 'insufficient-space'
    | 'queued' | 'copying' | 'completed' | 'drive-removed' | 'failed' | 'cancelled' | 'create-refused';
  export interface UseExport {
    state: ExportState;
    volumes: readonly UsbVolume[];       // from listExportTargets + live usb.volumes
    needBytes: number;                   // Σ totalBytes of the selection
    job: ExportJobPayload | null;
    etaSeconds: number | null;
    refusalReason: string | null;        // CG-21 named reason for create-refused
    pick(devicePath: string): void;      // createExport
    cancel(): void;                      // cancelExport
    retry(): void;                       // re-issue createExport, same recordingIds
  }
  export function useExport(recordingIds: readonly string[], needBytes: number): UseExport;
  ```

**Behaviour:** on mount call `listExportTargets` (subscribes to `usb.volumes`);
merge live `usb.volumes` for insert/remove; a drive whose `freeBytes < needBytes`
is not pickable (C-6); if no drive has room → `insufficient-space`; `createExport`
→ `queued`, then follow `export.job` for `copying`/`completed`/`failed`(distinguish
`drive-removed` by the error text)/`cancelled`; a `422 export.insufficient-space`
→ `create-refused` with the named reason (CG-21) back to the picker; U-2 marks
progress stale (the copy continues device-side) and disables Cancel. Never reads
`freeBytes` to measure progress (C-2). If the same session re-opens with its job
running, re-attach via `getExport` + `export.job` (never a second copy, §2.7).

- [ ] **Step 1:** Tests (mock client):
  - opening calls `listExportTargets`; a live `usb.volumes` insert moves `no-drive → drives-listed`.
  - a drive smaller than `needBytes` is flagged not-pickable; all-too-small → `insufficient-space`.
  - `pick` → `createExport`; the mock's `export.job` steps drive `queued → copying (bytes increase) → completed`; `etaSeconds` becomes non-null once ≥ 2 samples.
  - progress reads `export.job.bytesCopied`, never `UsbVolume.freeBytes` (assert the component/hook never consults freeBytes for the bar).
  - `usb-pull` world → terminal `drive-removed`; `retry` re-issues `createExport` with the same `recordingIds`.
  - a `422 export.insufficient-space` → `create-refused` with the named reason; a generic `validation.invalid` is **not** treated as a space problem.
  - session scoping: a second mock session's overlay never receives session A's `export.job`/`usb.volumes` (assert no cross-session leakage).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(S-23): use-export flow hook`.

---

## Task 16: S-23 export overlay (modal, drive picker, progress, result) + wire from selection

The 680 px overlay and its per-state body, opened from S-21's selection bar.

**Files (all under `apps/panel/src/screens/library/export/`):**
- Create: `export-modal.tsx`, `drive-picker.tsx`, `export-progress.tsx`, `export-result.tsx`, `export.css`
- Modify: `apps/panel/src/screens/library/library-screen.tsx` (selection bar `onExport` opens the modal via `useOverlays`)
- Test: `export-modal.test.tsx`, `drive-picker.test.tsx`, `export-progress.test.tsx`, `export-result.test.tsx`

**Interfaces:**
- `open(<ExportModal recordingIds needBytes/>, { dismissible: true })`.
- `<DrivePicker volumes needBytes onPick/>` — ≥ 64 px cards (not a dropdown, C-1);
  a card with `freeBytes < needBytes` shows the shortfall and is not selectable
  (C-6); Copy enabled only when a drive with room is picked; nothing auto-selected
  (EXP-D-1). Each card is a `button` announcing `{label}, {free} free,
  {enough/not enough} for {bytes}`.
- `<ExportProgress job etaSeconds onCancel/>` — bar + percentage from
  `bytesCopied/bytesTotal`; `about {eta} left`; the "Don't remove the drive…" line
  throughout; Cancel copy. `progressbar` with `aria-valuenow`/`aria-valuetext`.
- `<ExportResult state volume error onRetry onDone/>` — completed (`Done` /
  `Safe to remove the drive.`, large `--success`, `aria-live="polite"`), drive
  removed / failed (source-safe line + Try again), cancelled (calm terminal).
- Copy verbatim from S-23 §5.

**State → this task:** no drive, drives listed (incl. a too-small card),
insufficient space, queued, copying, completed, drive removed, failed, cancelled,
create refused, U-1, U-2.

- [ ] **Step 1:** Write one render test per §4 state (drive from `useExport`
  states); assert "Safe to remove" is `aria-live`; assert no auto-pick (Copy
  disabled until a card is chosen); assert every failure body asserts source safety.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the four components + CSS; wire the selection bar's `onExport` to `useOverlays().open(<ExportModal…/>)`.
- [ ] **Step 4:** Run → PASS. `pnpm --filter @eduscope/panel test -- export/`
- [ ] **Step 5:** Commit `feat(S-23): USB export overlay + selection wiring`.

---

## Task 17: S-35 `use-upload-row-label.ts` + `use-upload-jobs.ts`

`use-upload-row-label` composes `use-recording-badge` (never forks it) and adds
only the CG-20 offline/server split. `use-upload-jobs` is the paged list merged
with `upload.job`/`upload.part`.

**Files (all under `apps/panel/src/screens/advanced/uploads/`):**
- Create: `use-upload-row-label.ts`, `use-upload-jobs.ts`, `query-keys.ts`
- Test: `use-upload-row-label.test.ts`, `use-upload-jobs.test.ts`

**Interfaces:**
- Consumes: `recordingBadge` (Task 5), `useClient()`, `useUploadJobEvents()`,
  `useUploadPartEvents()` (Task 1).
- Produces:
  ```ts
  export interface UploadRowLabel { badge: RecordingBadge; offline: boolean; offlineCopy?: string }
  /** Reuses recordingBadge for every shared state; adds ONLY the offline split. */
  export function uploadRowLabel(job: UploadJob): UploadRowLabel;

  export interface UseUploadJobs {
    loading: boolean;
    jobs: readonly UploadJob[];       // listUploadJobs patched by live upload.job
    hasMore: boolean;
    loadMore(): void;
  }
  export function useUploadJobs(filter: { state?: UploadJobState }): UseUploadJobs;
  ```
- `offline = job.state === 'failed' && job.failureClass === 'connectivity'`
  (CG-20, C-5). `offlineCopy` = the §6 "Waiting for the network · will keep trying"
  / "Last tried {t}. No attempts used…" strings. The server-class failed row keeps
  `recordingBadge`'s #6 label with `attempt N of {cap}` (cap 8, §4.4). Reading
  `lastError` to decide the class is forbidden — the class is `failureClass`.

- [ ] **Step 1:** Tests:
  - `uploadRowLabel`: two jobs both `state:'failed'`, one `failureClass:'connectivity'` (→ `offline:true`, offline copy, **no** attempt count) and one `failureClass:'server'` (→ badge #6 with `attempt N of 8`) render **different** rows — the headline CG-20 test.
  - a `dead-letter` job → badge #7 + reason (`lastError`).
  - **badge parity with S-21:** feed one recording's fields through both `recordingBadge` (S-21) and `uploadRowLabel` (S-35) for every shared state and assert an identical label (import the Task-5 suite / a shared fixture).
  - `useUploadJobs`: a live `upload.job{progressPct}` patches the row; a live `upload.part` updates the expanded part; `state` filter re-issues the query.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement both hooks + `UPLOAD_KEYS`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(S-35): upload row label (CG-20 split) + use-upload-jobs`.

---

## Task 18: S-35 components + `upload-queue-screen.tsx` + wire route

The admin console rows, part expansion, requeue, and the screen, wired into the
Advanced shell.

**Files (all under `apps/panel/src/screens/advanced/uploads/`):**
- Create: `upload-job-row.tsx`, `upload-parts.tsx`, `requeue-button.tsx`, `upload-queue-screen.tsx`, `uploads.css`
- Modify: `apps/panel/src/routes/router.tsx` (`ADVANCED_SCREEN_ELEMENTS['S-35']` → real; drop the placeholder for `uploads`)
- Test: `upload-job-row.test.tsx`, `upload-parts.test.tsx`, `requeue-button.test.tsx`, `upload-queue-screen.test.tsx`

**Interfaces:**
- `<UploadJobRow job/>` — 64 px row; badge/label from `uploadRowLabel`;
  attempt/next-retry/progress; a ≥ 44 px expand affordance (`aria-expanded`);
  **no cancel** anywhere (C-1); the offline row is `--warning` "Waiting for the
  network" (never an attempt count); requeue only on `dead-letter`.
- `<UploadParts jobId/>` — `getUploadJob` parts + live `upload.part`, each with
  `bytesSent/bytesTotal`; a `missing` part shows `✕ file missing` (explains the
  dead-letter, U-08); read-only (C-2).
- `<RequeueButton job/>` — dead-letter only; `Try again now` (states its effect);
  owns the `requeueUploadJob` 202, resolves on `upload.job{queued}`; `409
  upload.not-requeueable` → U-5 (named reason, not left re-tappable); `--accent`
  (recovery, not `--danger`).
- `<UploadQueueScreen/>` — inside `.us-adm__content` (S-25 shell, already renders
  admin children); title + `State: All` filter chip + list + Load more + the
  `empty` good state (`Everything has been uploaded.`, C-7). Route is already
  admin-gated (`ADVANCED_ADMIN_CHILDREN` + `navItemsForRole`); the nav item exists
  (`advanced-nav.ts`).

**State → this task:** loading, empty, queued, preparing, uploading, done,
**offline** (no attempt count), failed (server, attempt N of 8), dead-letter +
requeue, requeue pending, requeue refused (409), part expansion (incl. a missing
part), cancelled, U-2, U-6.

- [ ] **Step 1:** Write one render test per §5.1 state (mock jobs); the headline
  offline-vs-failed test (two `failed` jobs render different rows); dead-letter is
  never hidden (present with reason + requeue); requeue on a non-dead-letter → 409
  U-5; a structural test that **no** button matching `/cancel/i` renders on any row
  (C-1); the route is admin-only (a lecturer never sees the nav item). Add a
  `router.test.tsx` assertion that `/advanced/uploads` renders the real screen.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the components + screen; wire `ADVANCED_SCREEN_ELEMENTS['S-35']`.
- [ ] **Step 4:** Run → PASS. `pnpm --filter @eduscope/panel test -- uploads/ router`
- [ ] **Step 5:** Commit `feat(S-35): upload queue screen + rows + parts + requeue`.

---

## Task 19: S-21 gate (executable verification)

Do not proceed to review until every box passes. Run from the repo root.

- [ ] **Every enumerated state demonstrated via the scenario demo checklist.**
  `pnpm dev:panel`, open `/library`, long-press the dev-overlay hotspot, and walk:
  populated + each badge (default `happy`, seed rows 0–7); empty (World knob
  `No recordings on device`); removed-under-user (`disk-full` — a visible row
  animates out with "removed to free space"); deleting (admin ⋯→Delete →
  self-removal); deleted-tombstone (admin + `Show deleted`); selection mode +
  Σ bytes; load-more; U-2 (`ws-flap`). Confirm each renders per S-21 §5.1.
- [ ] **Boundary lint green (no direct network imports).**
  `pnpm lint` → 0 errors. Grep confirms no `fetch`/`axios`/`WebSocket` under
  `apps/panel/src/screens/library/`.
- [ ] **Testing Library: one test per enumerated state.**
  `pnpm --filter @eduscope/panel test -- screens/library` → all green; the file
  set covers loading, both empty states, populated, each badge (#1–#9 via
  `use-recording-badge` **and** rendered in a row), removed-under-user (each
  `deleteReason`), deleting, deleted-tombstone, selection mode, load-more pending,
  U-2, U-6, and the CG-5 chip→param mapping (cursor resets, no client filtering),
  and the server-scoping test (lecturer renders exactly the mock's page).
- [ ] **Badge parity fixture present** (asserted here, verified fully in Task 23):
  the shared `use-recording-badge` suite exists and is importable by S-35.
- [ ] **Contract honesty:** `pnpm --filter @eduscope/api-client test` green
  (every mocked `listRecordings`/`recording.artifact`/`upload.job` validates).
- [ ] **Playwright: primary journey + one failure scenario.** Create
  `apps/panel/e2e/s21-library.spec.ts`: primary — stop a recording (dev overlay) →
  open `/library` → a row cycles `Preparing… → Waiting to upload → Uploading… →
  Uploaded`; failure — `disk-full` removes a row with the non-alarming note.
  `pnpm --filter @eduscope/panel e2e s21-library.spec.ts` → green.
- [ ] **Typecheck:** `pnpm typecheck` → clean.
- [ ] Commit `test(S-21): gate library` (spec + any test-only additions).

---

## Task 20: S-22 gate (executable verification)

- [ ] **Every enumerated state via the demo checklist.** `/library/:id` from S-21:
  populated single (seed row 0), preparing (seed row 3), merge failed + admin Retry
  (`pipeline-crash-midway`, admin token — recovers to preparing→ready), lecturer
  sees no Retry (U-6), not found (bad id), forbidden (open a non-owned recording as
  a second lecturer), file missing / playback failed (the `failed` seed row / a
  media error), deleted (`disk-full` while open). Confirm per S-22 §4.
- [ ] **Boundary lint green.** `pnpm lint` → 0 errors; the player's `<video src>`
  is an object URL from `client.getRecordingMedia` (no direct network).
- [ ] **Testing Library: one test per §4 state.**
  `pnpm --filter @eduscope/panel test -- screens/library/detail` green — loading,
  not found, forbidden, populated single + multi, preparing, merge failed (admin
  **and** lecturer), playback failed, file missing, retry pending, deleted, U-2;
  the admin gate tested without rendering the player; authenticated-media test
  (src via client; a 403 surfaces `forbidden`); streamKey selection by key, not
  index; seam-honesty words present.
- [ ] **Contract honesty:** `pnpm --filter @eduscope/api-client test` green
  (`getRecording`/`getRecordingMedia`/`recording.artifact`, incl. CG-7 retry).
- [ ] **Playwright: primary + failure.** `apps/panel/e2e/s22-detail.spec.ts`:
  primary — open a recording, play the merged file (scrub/seek/Range), download;
  failure — `pipeline-crash-midway` → merge failed → admin retry → preparing→ready.
  `pnpm --filter @eduscope/panel e2e s22-detail.spec.ts` → green.
- [ ] **Typecheck:** `pnpm typecheck` clean. Commit `test(S-22): gate recording detail`.

---

## Task 21: S-23 gate (executable verification)

- [ ] **Every enumerated state via the demo checklist.** Select recordings in
  S-21 → Copy to USB: no drive (empty-targets), drives listed (two seed drives,
  one too small → not selectable), insufficient space, queued→copying→completed
  (`happy` — real bytes + ETA + "Safe to remove"), drive removed mid-copy
  (`usb-pull`), cancelled (Cancel copy), create refused (CG-21). Confirm per S-23 §4.
- [ ] **Boundary lint green.** `pnpm lint` → 0 errors under `.../export/`.
- [ ] **Testing Library: one test per §4 state.**
  `pnpm --filter @eduscope/panel test -- screens/library/export` green — no drive,
  drives listed (with a too-small card), insufficient space, queued, copying,
  completed, drive removed, failed, cancelled, create refused (CG-21 vs generic
  validation), U-1, U-2; `use-eta` pure-function test (null before enough samples,
  no state, no store); progress reads real bytes never `freeBytes`; session scoping
  (session B never sees session A's job); no auto-pick.
- [ ] **Contract honesty:** `pnpm --filter @eduscope/api-client test` green
  (`listExportTargets`/`createExport`/`getExport`/`export.job`/`usb.volumes`, incl.
  `export.insufficient-space`).
- [ ] **Playwright: primary + failure.** `apps/panel/e2e/s23-export.spec.ts`:
  primary — select → open → insert drive (World/hotplug) → pick → watch real-byte
  progress to completed → "Safe to remove"; failure — `usb-pull` (source safe, Try
  again). `pnpm --filter @eduscope/panel e2e s23-export.spec.ts` → green.
- [ ] **Typecheck:** `pnpm typecheck` clean. Commit `test(S-23): gate USB export`.

---

## Task 22: S-24 gate (executable verification)

- [ ] **Every enumerated state via the demo checklist.** As admin from S-21 ⋯→Delete
  and from S-22: confirm (uploaded, seed row 0), confirm never-uploaded (seed row
  3/5, uploadState≠done — stronger body), confirm + in-flight (seed row 1,
  uploading), pending, refused (lecturer token → 403 bug surface, button replaced by
  Close), deleted (dialog closes; S-21 row removed / S-22 routes back), U-2
  (destructive disabled). Confirm per S-24 §4.
- [ ] **Boundary lint green.** `pnpm lint` → 0 errors; `delete-recording-confirm.tsx`
  imports no `fetch`/`axios`/`WebSocket`.
- [ ] **Testing Library: one test per state.**
  `pnpm --filter @eduscope/panel test -- delete-` green — the four shared states
  filled in, the `deleteBody` pure selection (uploaded vs never-uploaded vs
  in-flight) tested without the dialog, initial focus Cancel, no type-to-confirm,
  the refused button replacement, U-2. Delete absent in the row menu for a lecturer.
- [ ] **Contract honesty:** `pnpm --filter @eduscope/api-client test` green
  (`deleteRecording` 202 → `recording.artifact{deleted}` + `upload.job{cancelled}`
  when in flight).
- [ ] **Playwright: primary + failure.** Fold into `s21-library.spec.ts` (S-24 is
  an overlay on S-21): primary — admin deletes an uploaded recording, the row
  disappears; failure — a lecturer never sees the Delete control. `pnpm
  --filter @eduscope/panel e2e s21-library.spec.ts` → green.
- [ ] **Typecheck:** `pnpm typecheck` clean. Commit `test(S-24): gate delete confirm`.

---

## Task 23: S-35 gate (executable verification)

- [ ] **Every enumerated state via the demo checklist.** As admin,
  `/advanced/uploads`: loading, empty (`No recordings on device` knob), queued /
  preparing / uploading / done (seed jobs), **offline** vs failed(server) (seed
  jobs — the offline row shows "Waiting for the network · No attempts used", the
  server row "attempt 3 of 8"), a live transition into offline (`wan-loss`),
  dead-letter + requeue (Try again now → queued), requeue refused (409), part
  expansion (incl. a missing part), cancelled. Confirm per S-35 §5.1.
- [ ] **Boundary lint green.** `pnpm lint` → 0 errors under `.../uploads/`.
- [ ] **Testing Library: one test per §5.1 state.**
  `pnpm --filter @eduscope/panel test -- screens/advanced/uploads` green —
  including the headline offline/failed split (two `failed` jobs render different
  rows; the connectivity job shows **no** attempt count), dead-letter never hidden,
  requeue guard (409 → U-5, not re-tappable), the `/cancel/i` structural absence
  (C-1), U-6, part expansion with a missing part.
- [ ] **Badge parity across S-21 (LIB-D-1):** the test feeding one
  recording/upload-job to a library row and a queue row asserts an identical badge
  label for every shared state — green (this is the "one truth, two screens"
  guarantee promised in Task 19).
- [ ] **Contract honesty:** `pnpm --filter @eduscope/api-client test` green
  (`listUploadJobs`/`getUploadJob`/`upload.job`/`upload.part`, incl. `failureClass`).
- [ ] **Playwright: primary + failure.** `apps/panel/e2e/s35-uploads.spec.ts`:
  primary — as admin watch a job go `Preparing… → Waiting to upload → Uploading… →
  Uploaded` (`happy`); failure — `wan-loss` shows "Waiting for the network" (not
  "failed"), then a dead-letter requeued with "Try again now". `pnpm
  --filter @eduscope/panel e2e s35-uploads.spec.ts` → green.
- [ ] **Typecheck:** `pnpm typecheck` clean. Commit `test(S-35): gate upload queue`.

---

## Self-review (run before executing)

**Spec coverage** — each screen's §4/§5 states, §9 contract items, §10 mock/scenario
work, and §13 testing floor map to a task:
- S-21: badge matrix (Task 5/6), list/filters/selection/empty/tombstone/removed
  (Tasks 7–9), CG-5 chips (Task 8/9 — contract already applied), scenario removal
  (Task 4), gate (Task 19). ✓
- S-22: detail/player/segments/files (Tasks 10–12), CG-7 retry (Task 11, contract
  applied; mock emit Task 2), authenticated media object-URL (Task 11), forbidden
  authorization (Task 2), gate (Task 20). ✓
- S-23: use-eta/use-export/modal (Tasks 14–16), CG-3 subscribe + CG-21 refusal
  (Task 2 emit + mock already refuses), live progression + usb-pull (Tasks 3–4),
  gate (Task 21). ✓
- S-24: delete confirm inheriting S-06 DangerConfirm (Task 13), no contract change,
  gate (Task 22). ✓
- S-35: row label CG-20 split + jobs/parts/requeue (Tasks 17–18), requeue emit
  (Task 2), wan-loss (Task 4), badge parity (Tasks 5/17/23), gate (Task 23). ✓
- Store wiring for all five live events (Task 1). ✓

**Placeholder scan:** every mechanical task (1–4) carries full code; UI tasks carry
exact paths, interfaces, a concrete test list, and per-task verification commands —
no "add error handling", no "write tests for the above" without names.

**Type consistency:** `recordingBadge`/`RecordingBadge` (Task 5) are reused by
Tasks 6, 8, 17. `LibraryFilters` (Task 7) is consumed by Tasks 8, 9. `UseExport`
`ExportState` (Task 15) is consumed by Task 16. `uploadRowLabel` (Task 17) is
consumed by Task 18. Store selectors (Task 1) are the only WS read path in Tasks 7,
10, 15, 17. Live maps are keyed consistently: `artifacts`/`uploadJobs` by
`recordingId`, `uploadParts` by `partId`, `exportJobs` by `jobId`.
