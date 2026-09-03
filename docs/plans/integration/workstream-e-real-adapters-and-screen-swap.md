# Workstream E — Real Adapters and Screen-by-Screen Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the existing mock environments intact while adding production HTTP, panel WebSocket, student WebSocket, and one-second JPEG preview adapters; route adapter choice at runtime by the master plan's fixed domain map; then prove every panel, student, preview, and projector screen against real services in the exact E-01 through E-50 order.

**Architecture:** `/config.json` is fetched and validated before either app constructs a client. The panel owns one mock and one real `EduscopeClient`; a static operation/event domain catalog selects one producer per domain and exposes per-domain connection state. The quiz app selects its whole `QuizAppClient` through `studentQuiz`. Real REST is a contract-validating fetch boundary, panel realtime is a token-aware reconnecting WebSocket, student realtime buffers the contract's ordered connect snapshot before atomic replacement, and real preview polls authenticated JPEG snapshots through `packages/api-client`. Existing TanStack Query hooks, Zustand projections, mock scenarios, routes, and screen components remain the consumers.

> **Target decision — 2026-09-03:** use atomic 480×270 JPEG source previews refreshed once per second instead of WebRTC on RK3588. Cache-busting stays inside the real api-client adapter; components do not call `fetch` directly. A source is stale after 3 s without a successful image. Stop polling when the lightbox closes. This accepts the previously measured full-mix CPU-capacity risk without relabeling the failed 30% headroom target as PASS.

**Tech Stack:** TypeScript 5.6, React 18, Vite 7, Next.js 14, Zustand 5, TanStack Query 5, Zod 3.23, browser Fetch/WebSocket/WebRTC, Vitest 3, Testing Library, Playwright, Fastify 5 core-api/quiz-service test peers, PostgreSQL 16 Testcontainers, Python 3.11/FastAPI pipeline-manager, Pillow and Python QR rendering for S-42.

---

## Global Constraints

### BINDING RULES — imported verbatim from the master plan

1. **Contract tests from day one.** The first runnable slice in every service loads or validates against v1.0.0. A route/event is not done until its success and declared Problem/event shapes pass contract tests. Contract changes require a separately approved amendment; implementation may not “fix” the contract locally.
2. **No `sudo` from application code.** Node, Python, browser, and worker code may not invoke `sudo`, a shell, or arbitrary privileged commands. Privileged work crosses `/run/eduscope/helper.sock` and is limited to this fixed verb allowlist: `net.apply`, `volume.mount`, `volume.unmount`, `volume.format`, `usbhub.cycle`, `led.set`, `system.poweroff`, `firmware.check`, `firmware.apply`, `firmware.rollback`, `relay.reload`, `smart.read`. Arguments are schema-validated; the helper uses `execve`/argv and `SO_PEERCRED`; there is no generic-exec verb.
3. **Inventory KEEP behaviors are non-negotiable.** A workstream cannot close while any KEEP item assigned to it lacks the concrete verification identified in the inventory-coverage ledger below. Implementation may change; the observable capability must survive.
4. **The mock adapter stays.** `packages/api-client/src/mock` remains the demo/UI-development environment and contract-regression harness. Every real-adapter or backend contract change must keep mock responses/events and contract-honesty tests green.
5. **Single writers and async commands stay binding.** Only the owning state machine writes its state. A `202 CommandAccepted` is acceptance, not completion; the resolving event must arrive by its contract deadline.
6. **No direct frontend networking.** All panel and quiz REST/WS/WebRTC signaling goes through `packages/api-client`; no component calls `fetch`, `WebSocket`, or a media-signaling endpoint directly.
7. **No task may depend on an open decision.** Encountering one stops that workstream. Update this master plan and ask for review; do not choose an option in code.
8. **Master-plan scope is fixed at workstream planning time.** A JIT workstream plan may expand a task but may not add/drop contract ownership or KEEP coverage. If reality conflicts, update this master plan and flag the gate.

### Workstream E fixed decisions and boundaries

- Workstream E is exactly E-01 through E-50 in master order. E-48, E-49, and E-50 are the final expanded verification tasks and remain last.
- E owns no v1 operation or event. It consumes the 78 panel-facing core operations, three student REST operations, 22 panel events, five preview messages, and four student events already owned by B/D.
- The `SERVER_SIDE_ONLY_OPERATION_IDS` quiz-sync operations never enter either browser client.
- Runtime domains are exactly `auth`, `recording`, `channels`, `sourcesAudio`, `preview`, `libraryExport`, `uploads`, `provisioningHealth`, `alerts`, `devicePower`, `storage`, `network`, `encoder`, `streamTargets`, `firmware`, `users`, `aiQuiz`, `logs`, and `studentQuiz`.
- Demo/UI development defaults to mock. Production is accepted only with `{default:"real",overrides:{}}`. Overrides are rejected in production and are never editable from a screen.
- The panel and quiz apps must not use `VITE_EDUSCOPE_REAL_API`, `VITE_EDUSCOPE_API_URL`, or `NEXT_PUBLIC_EDUSCOPE_REAL_API` after E-01/E-05. A single built bundle changes adapter selection only through `/config.json`.
- Token pairs remain memory-only. The real adapter observes the existing token store, refreshes once per simultaneous 401 burst, reconnects sockets on token rotation, and clears credentials on terminal refresh failure.
- A panel sequence gap resets only selected real-domain slices in one Zustand update and reconnects for a full subscribe snapshot. It never replays commands or clears mock-domain state. The recording chrome remains visible but stale until replacement events arrive.
- Student `connect()` validates `StudentEventEnvelope`, strips the envelope only after validation, and returns exactly the ordered snapshot array expected by `replaceSnapshot`. A closed question requires the fourth `quiz.result`; open/none completes after the third frame.
- Test-only real-stack controls live outside production routes and browser bundles. They may inject failures through existing dependency seams, never by adding product endpoints.
- E-34 remains placeholder-institute only. D-02b is not resolved or claimed by this plan.
- E-49 reconciles the already-executed A/B internal projector payload mismatch inside the fixed E-49 task. It changes no public contract and does not add a second projector implementation.

### Mandatory prerequisite gate — stop before E-01 implementation

The master plan was updated on 2026-08-30 because the current tree has no closed A-15/A-16 evidence, no B-38 runner, no C-10 soak runner/evidence, and no dated D-10/D-11 evidence. Planning may finish; execution may not begin.

Before checking E-01 Step 1, reviewers must supply and acknowledge all of:

1. dated non-template `a15-*` and `a16-*` evidence with no `NOT RUN` rows;
2. `services/core-api/scripts/gate-core-api.mjs`, the `gate:core-api` package script, and a green live run;
3. `scripts/bench/ai-soak.sh`, C-10 parser/tests, and dated ≥90-minute evidence under `docs/evidence/phase-4/workstream-c/c10/`;
4. dated D-08/D-09/D-10/D-11 witnesses, a green `pnpm --filter @eduscope/quiz-service gate:d`, and reviewer acknowledgement of D's gate flag;
5. reviewer acknowledgement of the Workstream E master-plan gate flag, including the E-49 A/B payload correction.

If any witness is missing or contains `NOT RUN — gate failed`, stop. Do not create an E implementation commit and do not reinterpret a template as evidence.

### Repository and test conventions

- Run Node commands from the repository root. Run pipeline-manager `pytest` commands from `services/pipeline-manager` with its managed environment.
- Every task begins with a focused red assertion, ends with its focused unit tests plus `pnpm --filter @eduscope/api-client test`, and ends in exactly one commit. Existing mock Playwright cases remain in their files; real witnesses are added, not substituted.
- `packages/api-client/test/real/fixtures/real-stack.ts` starts real B and D in separate processes, with real HTTP/WS between them. It may fake A/C through their existing typed peers until a task explicitly requires the target board.
- `node packages/api-client/scripts/run-real-screen.mjs panel s01-login` and the corresponding `quiz` form are the stable focused commands after E-06. A successful run prints `PASS real:<screen>` and exits 0; a skipped or mock-only witness is failure.
- Per-screen Playwright intercepts only `/config.json` to provide the real stack's random URLs. It does not intercept API/WS/media requests or fabricate application responses.
- Expected `PASS` means exit code 0, all named focused files passed, no unexpected skip, no unhandled rejection/open handle, and both v1 contract versions still equal `1.0.0`.
- Commit only task-owned files. Before every commit run `git diff --check` and `git status --short`; preserve unrelated user changes.

---

## File and Responsibility Map

| Area | Files | Responsibility |
|---|---|---|
| Runtime selection | `packages/api-client/src/mixed/{domains,runtime-config,create-routed-client}.ts`, `apps/panel/src/config/*`, `apps/quiz/src/config/*`, both providers | Validate deploy-owned config before construction; route every method/event exactly once. |
| Real panel REST | `packages/api-client/src/real/{http,auth,problems,operation-specs,create-real-client}.ts` | URL/query/body/form/blob/204/202 handling, zod response validation, bearer/refresh single-flight. |
| Real panel realtime | `packages/api-client/src/real/{panel-ws,connection}.ts`, mixed router, panel WS store | Subprotocol auth, backoff, gap/reset/resync, inactive-domain filtering, per-domain status. |
| Preview | `packages/api-client/src/real/{preview,webrtc}.ts` | Five-message signaling, one peer, remote media stream, cleanup and terminal errors. |
| Student client | `packages/api-client/src/quiz/{real-quiz-app-client,student-stream}.ts`, quiz provider/config | Credentialed REST, cookie WS, ordered atomic snapshot, reconnect without offline answer queue. |
| Real stack | `packages/api-client/test/real/fixtures/*`, B/D test process entries, `packages/api-client/scripts/*`, Playwright fixtures | Reusable real B+D/TLS stack and test-only fault controls for focused screen witnesses. |
| Screen swaps | Existing screen/hook tests and `apps/{panel,quiz}/e2e/s*.spec.ts` | Preserve mock coverage and add the master row's real failure witness one screen at a time. |
| Projector | Existing A projector pipeline/consumer, new renderer/assets, B PM type, A+B+D integration test | Reconcile internal payload, render question/options/join code/QR, forbid PII/leaderboard, prove publish-before-project. |
| Final gate | production config templates, Playwright projects, `scripts/gate-workstream-e.mjs`, evidence templates | Prove all-real, independent mock, direct-network lint, contract counts, and KEEP witnesses. |

---

### Task E-01: Runtime config and routed-client domain map

**Files:**
- Create: `packages/api-client/src/mixed/domains.ts`
- Create: `packages/api-client/src/mixed/runtime-config.ts`
- Create: `packages/api-client/src/mixed/create-routed-client.ts`
- Create: `packages/api-client/test/mixed/domains.test.ts`
- Create: `packages/api-client/test/mixed/create-routed-client.test.ts`
- Create: `apps/panel/src/config/runtime-config.tsx`
- Create: `apps/panel/src/config/runtime-config.test.tsx`
- Create: `apps/panel/public/config.json`
- Create: `scripts/check-workstream-e-prereqs.mjs`
- Modify: `packages/api-client/src/index.ts`
- Modify: `packages/api-client/package.json`
- Modify: `apps/panel/src/App.tsx`
- Modify: `apps/panel/src/client/client-provider.tsx`
- Modify: `apps/panel/src/devtools/scenario-overlay.tsx`
- Create: `apps/panel/src/client/client-provider.test.tsx`

**Produces:** `AdapterDomain`, `RuntimeConfig`, `loadRuntimeConfig()`, `createRoutedClient()`, exact operation/event maps, per-domain connection streams, and disposal of both underlying clients.

- [ ] **Step 1: Run the prerequisite checker first and stop on the current red result**

Implement `scripts/check-workstream-e-prereqs.mjs` as a read-only checker for the five prerequisite groups above. It must reject templates, `NOT RUN`, missing dated paths, and missing reviewer-ack text; it never manufactures evidence or invokes a privileged command.

Run: `node scripts/check-workstream-e-prereqs.mjs`

Expected now: exit 1 with named missing A/B/C/D/E witnesses. After reviewers close the gate, expected: `PASS workstream-e prerequisites` and exit 0. Do not continue until the latter is true.

- [ ] **Step 2: Add red config/catalog/routing tests**

Assert invalid URLs/domains/defaults fail; production overrides fail; all 78 `PANEL_OPERATION_IDS` occur exactly once; all 22 `PANEL_EVENT_NAMES` occur exactly once; `studentQuiz` owns no panel operation; inactive adapter events are discarded; opposite overrides route calls to opposite spies; connection state is projected only to selected real domains; switching runtime JSON between two provider mounts requires no rebuild; `dispose()` unsubscribes and disposes both clients exactly once.

Run: `pnpm --filter @eduscope/api-client test -- test/mixed && pnpm --filter @eduscope/panel test -- src/config src/client/client-provider.test.tsx`

Expected: FAIL because mixed runtime modules/provider do not exist and the provider still reads Vite build-time flags.

- [ ] **Step 3: Implement the mechanical config and static maps**

Use this exact public shape; unknown keys are rejected:

```ts
export const ADAPTER_DOMAINS = [
  'auth', 'recording', 'channels', 'sourcesAudio', 'preview',
  'libraryExport', 'uploads', 'provisioningHealth', 'alerts',
  'devicePower', 'storage', 'network', 'encoder', 'streamTargets',
  'firmware', 'users', 'aiQuiz', 'logs', 'studentQuiz',
] as const;
export type AdapterDomain = (typeof ADAPTER_DOMAINS)[number];
export type AdapterKind = 'mock' | 'real';

export const zRuntimeConfig = z.object({
  apiBaseUrl: z.string().min(1),
  quizBaseUrl: z.string().url(),
  environment: z.enum(['development', 'integration', 'production']),
  adapters: z.object({
    default: z.enum(['mock', 'real']),
    overrides: z.record(z.enum(ADAPTER_DOMAINS), z.enum(['mock', 'real'])),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.environment === 'production' && Object.keys(value.adapters.overrides).length > 0) {
    ctx.addIssue({ code: 'custom', path: ['adapters', 'overrides'], message: 'production overrides are forbidden' });
  }
});
```

`loadRuntimeConfig` calls the injected/default fetch once with `{cache:'no-store',credentials:'same-origin'}`, requires 200 JSON, and parses before returning. The committed demo config is exactly:

```json
{
  "apiBaseUrl": "/api/v1",
  "quizBaseUrl": "https://quiz.example.edu",
  "environment": "development",
  "adapters": { "default": "mock", "overrides": {} }
}
```

Export `PANEL_OPERATION_DOMAIN` as a `satisfies Record<PanelOperationId, AdapterDomain>` object covering the grouped methods in `client.ts`. Export `PANEL_EVENT_DOMAIN` as a `satisfies Record<PanelEventName, AdapterDomain>` object: recording events→`recording`; channel→`channels`; source/audio→`sourcesAudio`; storage→`storage`; device health→`provisioningHealth`; alert→`alerts`; upload→`uploads`; export/USB/artifact→`libraryExport`; firmware→`firmware`; AI/question/publication/quiz responses/session→`aiQuiz`; logs→`logs`.

`createRoutedClient({mock,real,selection})` exposes each operation as a closure that chooses exactly once at call time. It subscribes once to both event/connection streams, emits only active-domain events, and reports one connection projection per selected domain. Preview routes through `preview`; it is never merged into panel events.

- [ ] **Step 4: Replace build-time selection in the panel**

`RuntimeConfigProvider` loads before mounting `ClientProvider`. `ClientProvider` dynamically imports the mock only when any panel domain selects mock, constructs the real once, calls `createRoutedClient`, and keeps StrictMode cancellation/disposal. Scenario overlay renders only when a mock domain is active and remains unable to cast a real-only client to `MockClient`. Remove all adapter decisions from `import.meta.env`.

Run: `pnpm --filter @eduscope/api-client test -- test/mixed test/operation-coverage.test.ts test/event-coverage.test.ts && pnpm --filter @eduscope/panel test -- src/config src/client src/devtools && pnpm --filter @eduscope/panel build`

Expected: PASS; coverage reports 78 operations and 22 panel events exactly once, demo config selects mock, and the production bundle contains no `VITE_EDUSCOPE_REAL_API` branch.

- [ ] **Step 5: Commit E-01**

```bash
git add scripts/check-workstream-e-prereqs.mjs packages/api-client/src/mixed packages/api-client/test/mixed packages/api-client/src/index.ts packages/api-client/package.json apps/panel/public/config.json apps/panel/src/config apps/panel/src/App.tsx apps/panel/src/client apps/panel/src/devtools/scenario-overlay.tsx
git commit -m "feat(api-client): route adapters by runtime domain"
```

---

### Task E-02: Real HTTP/auth transport

**Files:**
- Create: `packages/api-client/src/real/http.ts`
- Create: `packages/api-client/src/real/auth.ts`
- Create: `packages/api-client/src/real/problems.ts`
- Create: `packages/api-client/src/real/operation-specs.ts`
- Modify: `packages/api-client/src/real/create-real-client.ts`
- Modify: `packages/api-client/src/errors.ts`
- Create: `packages/api-client/test/real/http.test.ts`
- Create: `packages/api-client/test/real/auth.test.ts`
- Create: `packages/api-client/test/real/operations.test.ts`
- Modify: `packages/api-client/test/real-stub.test.ts`
- Modify: `apps/panel/src/auth/token-store.ts`
- Modify: `apps/panel/src/auth/token-store.test.ts` (create if absent)

**Produces:** all 78 real REST methods; response/Problem zod validation; JSON/form/blob/text/void handling; memory token subscription; one refresh for concurrent 401s.

- [ ] **Step 1: Add failing transport tests**

Cover base/path joining without `//`, percent-encoded path ids, omission of undefined query values, repeated calls without mutation of input, JSON content type, multipart with no manual boundary, Range/Blob, CSV text, 202/200 JSON, 204 void, non-2xx `application/problem+json`, malformed Problem as `TransportError`, response-schema rejection, abort/network failure, Authorization omission on login/refresh, bearer on all others, a 20-request 401 burst causing one refresh, one retry per request, refresh token rotation, terminal refresh failure clearing tokens, and logout clearing tokens after 204.

Run: `pnpm --filter @eduscope/api-client test -- test/real/http.test.ts test/real/auth.test.ts test/real/operations.test.ts`

Expected: FAIL because the real client still throws `NotImplementedError`.

- [ ] **Step 2: Implement the token and HTTP primitives**

Extend the existing memory token store with `subscribeTokens(listener): Unsubscribe`; `setTokens`/`clearTokens` notify only on identity change. Pass a `TokenStore` into `createRealClient` rather than importing app code into the package.

Use this request contract:

```ts
export interface HttpRequest<T> {
  operation: PanelOperationId;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  response: z.ZodType<T> | 'blob' | 'text' | 'void';
  auth?: 'required' | 'none';
}
```

`HttpTransport.request` creates a fresh `Headers`, uses `encodeURIComponent` only for path values, parses Problems through the hand-authored `zProblem` override, parses success before returning, and wraps only transport/parse failures—not named Problems—as `TransportError(operation)`. For 204, do not call `response.json()`.

`AuthCoordinator.authorized()` reads the current access token; on 401 it awaits one shared `refreshPromise`, posts the refresh token with no bearer, stores the returned pair, then retries the original request once. A 401 after retry or failed refresh clears tokens and rejects; it never loops.

- [ ] **Step 3: Implement every operation descriptor and wrapper**

`operation-specs.ts` is a compile-time-complete `Record<PanelOperationId, ...>` using the exact method/path list in `contracts/openapi.yaml`. Response validators are the generated `z${OperationId}Response` exports; unwrap `{items}` only where `EduscopeClient` deliberately returns an array, and preserve `{items,nextCursor}` for pages. The special cases are `getRecordingMedia:'blob'`, `exportLogsCsv:'text'`, `importUsers:FormData`, and the four 204 operations (`logout`, `changePassword`, `deleteStreamTarget`, `deleteUser`).

The mechanical route portion is exactly:

```ts
export const OPERATION_ROUTE = {
  login: ['POST', '/auth/login'],
  refreshToken: ['POST', '/auth/refresh'],
  logout: ['POST', '/auth/logout'],
  getMe: ['GET', '/auth/me'],
  changePassword: ['POST', '/auth/change-password'],
  getRecordingState: ['GET', '/recording/state'],
  startRecording: ['POST', '/recording/start'],
  pauseRecording: ['POST', '/recording/pause'],
  resumeRecording: ['POST', '/recording/resume'],
  stopRecording: ['POST', '/recording/stop'],
  takeoverRecording: ['POST', '/recording/takeover'],
  listChannels: ['GET', '/channels'],
  updateChannelConfig: ['PUT', '/channels/{channelId}'],
  enableChannel: ['POST', '/channels/{channelId}/enable'],
  disableChannel: ['POST', '/channels/{channelId}/disable'],
  listLayoutPresets: ['GET', '/layouts'],
  listSourceRoles: ['GET', '/sources/roles'],
  getSourcesStatus: ['GET', '/sources/status'],
  listPhysicalInputs: ['GET', '/sources/inputs'],
  updatePhysicalInput: ['PUT', '/sources/inputs/{inputId}'],
  listSourceBindings: ['GET', '/sources/bindings'],
  updateSourceBinding: ['PUT', '/sources/bindings/{roleId}'],
  listAudioControls: ['GET', '/audio/controls'],
  updateAudioControl: ['PUT', '/audio/controls/{roleId}'],
  listRecordings: ['GET', '/recordings'],
  getRecording: ['GET', '/recordings/{recordingId}'],
  deleteRecording: ['DELETE', '/recordings/{recordingId}'],
  retryMergeRecording: ['POST', '/recordings/{recordingId}/retry-merge'],
  getRecordingMedia: ['GET', '/recordings/{recordingId}/files/{fileId}/media'],
  listExportTargets: ['GET', '/exports/targets'],
  createExport: ['POST', '/exports'],
  getExport: ['GET', '/exports/{exportId}'],
  cancelExport: ['POST', '/exports/{exportId}/cancel'],
  listUploadJobs: ['GET', '/uploads'],
  getUploadJob: ['GET', '/uploads/{jobId}'],
  requeueUploadJob: ['POST', '/uploads/{jobId}/requeue'],
  getProvisioning: ['GET', '/provisioning'],
  getDeviceHealth: ['GET', '/health'],
  listAlerts: ['GET', '/alerts'],
  acknowledgeAlert: ['POST', '/alerts/{alertId}/acknowledge'],
  powerOffDevice: ['POST', '/device/power-off'],
  getStorageOverview: ['GET', '/storage'],
  registerStorageVolume: ['POST', '/storage/volumes'],
  formatStorageVolume: ['POST', '/storage/volumes/{volumeId}/format'],
  listNetworkConfigs: ['GET', '/settings/network'],
  updateNetworkConfig: ['PUT', '/settings/network/{networkConfigId}'],
  getEncoderSettings: ['GET', '/settings/encoder'],
  updateEncoderSettings: ['PUT', '/settings/encoder'],
  listStreamTargets: ['GET', '/settings/stream-targets'],
  createStreamTarget: ['POST', '/settings/stream-targets'],
  updateStreamTarget: ['PUT', '/settings/stream-targets/{targetId}'],
  deleteStreamTarget: ['DELETE', '/settings/stream-targets/{targetId}'],
  getFirmwareState: ['GET', '/firmware'],
  checkFirmware: ['POST', '/firmware/check'],
  applyFirmware: ['POST', '/firmware/apply'],
  listUsers: ['GET', '/users'],
  createUser: ['POST', '/users'],
  updateUser: ['PATCH', '/users/{userId}'],
  deleteUser: ['DELETE', '/users/{userId}'],
  importUsers: ['POST', '/users/import'],
  getAiCountdown: ['GET', '/ai/countdown'],
  setAiInterval: ['PUT', '/ai/interval'],
  generateNow: ['POST', '/ai/generate-now'],
  listQuestionSets: ['GET', '/ai/question-sets'],
  getQuestionSet: ['GET', '/ai/question-sets/{setId}'],
  listQuestions: ['GET', '/ai/questions'],
  createQuestion: ['POST', '/ai/questions'],
  editQuestion: ['PATCH', '/ai/questions/{questionId}'],
  discardQuestion: ['POST', '/ai/questions/{questionId}/discard'],
  sendToProjector: ['POST', '/ai/questions/{questionId}/send-to-projector'],
  listPublications: ['GET', '/ai/publications'],
  closePublication: ['POST', '/ai/publications/{publicationId}/close'],
  setProjector: ['PUT', '/ai/projector'],
  getQuizSession: ['GET', '/quiz/session'],
  listPublicationResponses: ['GET', '/quiz/publications/{publicationId}/responses'],
  getLeaderboard: ['GET', '/quiz/leaderboard'],
  queryLogs: ['GET', '/logs'],
  exportLogsCsv: ['GET', '/logs/export'],
} as const satisfies Record<PanelOperationId, readonly [HttpMethod, string]>;
```

Path substitution must reject missing placeholders and encode each supplied value. The four `quizSync*` operations remain server-only and therefore cannot appear in `PanelOperationId` or this table.

Keep explicit typed methods in `create-real-client.ts`; do not use a `Proxy` or silently cast a partial object. `PANEL_OPERATION_IDS` coverage must fail compilation/tests when either the interface or spec grows.

- [ ] **Step 4: Verify against real B and the contract**

Run: `pnpm --filter @eduscope/api-client test && pnpm --filter @eduscope/core-api test:contract && pnpm --filter @eduscope/panel test -- src/screens/login src/screens/reset src/auth`

Expected: PASS; 78/78 panel operations are implemented, four quiz-sync operations remain absent, representative GET/PUT/POST/PATCH/DELETE/multipart/Range calls validate, and no `NotImplementedError` is reachable from an HTTP operation.

- [ ] **Step 5: Commit E-02**

```bash
git add packages/api-client/src/real packages/api-client/src/errors.ts packages/api-client/test/real packages/api-client/test/real-stub.test.ts apps/panel/src/auth/token-store.ts apps/panel/src/auth/token-store.test.ts
git commit -m "feat(api-client): implement real panel http transport"
```

---

### Task E-03: Real panel WS, resync, and mixed event routing

**Files:**
- Create: `packages/api-client/src/real/connection.ts`
- Create: `packages/api-client/src/real/panel-ws.ts`
- Create: `packages/api-client/test/real/panel-ws.test.ts`
- Modify: `packages/api-client/src/real/create-real-client.ts`
- Modify: `packages/api-client/src/mixed/create-routed-client.ts`
- Modify: `packages/api-client/test/mixed/create-routed-client.test.ts`
- Modify: `apps/panel/src/store/ws-store.ts`
- Modify: `apps/panel/src/store/ws-store.test.ts`
- Modify: `apps/panel/src/store/connection.ts`
- Modify: `apps/panel/src/client/client-provider.tsx`

**Produces:** DR-05 token subprotocol; 0.5→10-second reconnect; zod-validated frames; seq-gap reset/reconnect; selected-domain stale state; no command replay.

- [ ] **Step 1: Add red WS and store tests**

Use an injected fake WebSocket/clock. Assert the sole protocol is the access JWT and no URL query contains it; invalid JSON/schema closes 1008; seq starts at any value then must be contiguous; a gap emits `resyncReason:'seq-gap'`, atomically clears selected real-domain slices, and reconnects; network closes back off `[500,1000,2000,4000,8000,10000]` indefinitely; 10 seconds disconnected emits stale; open resets attempt; token rotation closes/reconnects; disposal cancels timers; a command called while offline rejects and is never replayed; inactive-adapter events cannot mutate the store.

Run: `pnpm --filter @eduscope/api-client test -- test/real/panel-ws.test.ts test/mixed && pnpm --filter @eduscope/panel test -- src/store src/client`

Expected: FAIL because the real streams are dead and the store has only one global connection/reset path.

- [ ] **Step 2: Implement connection and frame handling**

`PanelSocket` lazily connects when `events$` or `connection$` gains its first subscriber and a token exists. Convert `http:`→`ws:` and `https:`→`wss:`, append `/ws` to the configured `/api/v1`, construct `new WebSocket(url,[accessToken])`, validate every message with `zEventEnvelope`, and publish only parsed data. `resync()` closes the active socket with an internal reason and awaits the next open; it does not call a command endpoint.

Use one timer owner. `ConnectionMachine` publishes `connecting|open|reconnecting|stale|closed`, the attempt number, ISO `since`, and optional reason. A normal token refresh reconnect is not a stale error unless the 10-second threshold is crossed.

- [ ] **Step 3: Make mixed resync domain-scoped**

Add `resetDomains(domains)` to the panel store. In one Zustand `set`, clear only slices owned by those domains while retaining recording chrome values with `stale:true` when `recording` is affected. Reset the sequence tracker before the replacement stream. `createRoutedClient` maps the one real socket status onto only real-selected live domains; mock-selected domains continue to report/open and ingest mock events.

`ClientProvider` listens for routed resync metadata, calls `resetDomains` once, awaits `client.resync()`, and never calls a REST command. Remove the old global `clearResync()` timing race.

- [ ] **Step 4: Verify DR-05/DR-20 behavior**

Run: `pnpm --filter @eduscope/api-client test -- test/real/panel-ws.test.ts test/mixed test/event-coverage.test.ts && pnpm --filter @eduscope/panel test -- src/store src/shell/offline-marker.test.tsx src/shell/recording-chrome.test.tsx`

Expected: PASS; all 22 variants parse, a forced gap performs one selected-domain reset/reconnect, backoff caps at 10 seconds, mock domains keep updating, and zero queued command is observed.

- [ ] **Step 5: Commit E-03**

```bash
git add packages/api-client/src/real packages/api-client/src/mixed packages/api-client/test/real/panel-ws.test.ts packages/api-client/test/mixed apps/panel/src/store apps/panel/src/client/client-provider.tsx apps/panel/src/shell
git commit -m "feat(api-client): reconnect and resync panel events"
```

---

### Task E-04: Real JPEG preview channel

**Files:**
- Create: `packages/api-client/src/real/webrtc.ts`
- Create: `packages/api-client/src/real/preview.ts`
- Create: `packages/api-client/test/real/preview.test.ts`
- Modify: `packages/api-client/src/real/create-real-client.ts`
- Modify: `packages/api-client/src/client.ts`
- Modify: `apps/panel/src/screens/sources/use-preview.ts`
- Modify: `apps/panel/src/screens/sources/use-preview.test.ts`

**Produces:** one authenticated real JPEG preview poller, one-second refresh, three-second stale handling, supersession, and deterministic timer/object-URL cleanup. Screen selection remains `preview=mock` until E-48.

- [ ] **Step 1: Add failing signaling/cleanup tests**

Inject WebSocket and `RTCPeerConnection` factories. Cover offer→setRemoteDescription→answer, local trickle ICE, remote ICE, end-of-candidates, `close`, `error`, one active peer, second open closing the first, track delivery, source-offline terminal error, socket/peer/track cleanup, and contract rejection of a sixth message.

Run: `pnpm --filter @eduscope/api-client test -- test/real/preview.test.ts && pnpm --filter @eduscope/panel test -- src/screens/sources/use-preview.test.ts`

Expected: FAIL because `openPreview()` is unimplemented.

- [ ] **Step 2: Implement the peer boundary**

Open `${apiWsBase}/ws/preview` with the sole access-token subprotocol. Validate outbound client messages and all inbound messages against the shared preview schemas. On `offer`, create exactly one peer, set remote SDP, create/set local answer, and send `answer`; forward ICE both ways. Expose `stream$` (or an equivalent typed callback) on `PreviewChannel` so `usePreview` attaches the remote stream to the video element without calling WebRTC APIs itself.

`close()` is idempotent: unsubscribe handlers, close socket/peer, set every received track `enabled=false`, call `track.stop()`, clear the stream, and remove token-store subscriptions.

- [ ] **Step 3: Verify contract and regression**

Run: `pnpm --filter @eduscope/api-client test -- test/real/preview.test.ts test/mock/preview.test.ts test/event-coverage.test.ts && pnpm --filter @eduscope/panel test -- src/screens/sources`

Expected: PASS; five server message variants and all client variants validate, the mock JPEG sentinel remains green, and opening twice leaves one live peer.

- [ ] **Step 4: Commit E-04**

```bash
git add packages/api-client/src/real packages/api-client/src/client.ts packages/api-client/test/real/preview.test.ts apps/panel/src/screens/sources/use-preview.ts apps/panel/src/screens/sources/use-preview.test.ts
git commit -m "feat(api-client): negotiate real webrtc previews"
```

---

### Task E-05: Real student quiz client

**Files:**
- Create: `packages/api-client/src/quiz/real-quiz-app-client.ts`
- Create: `packages/api-client/src/quiz/student-stream.ts`
- Create: `packages/api-client/test/real/student-quiz.test.ts`
- Modify: `packages/api-client/src/quiz/quiz-app-client.ts`
- Modify: `packages/api-client/package.json`
- Create: `apps/quiz/src/config/runtime-config.tsx`
- Create: `apps/quiz/src/config/runtime-config.test.tsx`
- Create: `apps/quiz/public/config.json`
- Modify: `apps/quiz/src/client/quiz-client-provider.tsx`
- Modify: `apps/quiz/src/client/quiz-client-provider.test.tsx`
- Modify: `apps/quiz/src/app/quiz-app-providers.tsx`
- Modify: `apps/quiz/src/realtime/use-student-stream.test.tsx`

**Produces:** credentialed three-operation REST client; cookie-authenticated student WS; validated ordered atomic snapshot; real/mock runtime selection for the whole `studentQuiz` domain.

- [ ] **Step 1: Add failing real quiz tests**

Assert REST paths use `/api/student/v1`, join codes/ids are encoded, all fetches use `credentials:'include'`, no participant credential appears in args/returns/logs/browser storage, Quiz Problems become `QuizAppProblemError`, network failures remain distinguishable, the socket uses cookies with no token query/subprotocol, seq gaps close/reconnect, first frames are session→participant→question→optional result, closed question waits for result, open/none commits after question, live deltas begin only after snapshot resolve, reconnect replaces wholesale, and submit while offline rejects without a queue.

Run: `pnpm --filter @eduscope/api-client test -- test/real/student-quiz.test.ts && pnpm --filter @eduscope/quiz test -- src/config src/client src/realtime`

Expected: FAIL because only `createMockQuizClient` exists and the provider is build-time/mock-only.

- [ ] **Step 2: Implement REST and snapshot buffering**

`createRealQuizAppClient({baseUrl,fetch,webSocket})` validates responses with the quiz-generated schemas. `StudentStream.connect()` creates `wss://.../api/student/v1/stream`, validates each raw frame with `zStudentEventEnvelope`, enforces contiguous seq, strips `{at,seq}` only after validation, and buffers until the contract-defined snapshot is complete. It then returns the array once and emits only subsequent deltas. A reconnect closes/replaces the prior socket; no answer method retries automatically after an ambiguous network loss.

- [ ] **Step 3: Replace quiz build-time selection**

The quiz `RuntimeConfigProvider` uses the shared loader and mounts `QuizClientProvider` only after parse. `studentQuiz` selection is all-or-nothing; other domain overrides do not affect it. Mock controls/overlay render only for a selected mock client. Remove `NEXT_PUBLIC_EDUSCOPE_REAL_API`. Preserve the existing query/store reset before changing mock scenarios.

- [ ] **Step 4: Verify real D flow and mock independence**

Run: `pnpm --filter @eduscope/api-client test -- test/real/student-quiz.test.ts test/student-quiz-v0-6.test.ts && pnpm --filter @eduscope/quiz test && pnpm --filter @eduscope/quiz-service test:contract`

Expected: PASS; three REST operations and four student events validate, reconnect has no stale question flash, cookie identity stays browser-unreadable, and every existing mock scenario remains green.

- [ ] **Step 5: Commit E-05**

```bash
git add packages/api-client/src/quiz packages/api-client/test/real/student-quiz.test.ts packages/api-client/package.json apps/quiz/public/config.json apps/quiz/src/config apps/quiz/src/client apps/quiz/src/app/quiz-app-providers.tsx apps/quiz/src/realtime/use-student-stream.test.tsx
git commit -m "feat(api-client): connect the real student quiz app"
```

---

### Task E-06: Dual-adapter regression gate

**Files:**
- Create: `packages/api-client/test/real/fixtures/real-stack.ts`
- Create: `packages/api-client/test/real/fixtures/core-peer.ts`
- Create: `packages/api-client/test/real/fixtures/quiz-peer.ts`
- Create: `packages/api-client/test/real/contract-honesty.test.ts`
- Create: `packages/api-client/test/real/parity.test.ts`
- Create: `packages/api-client/scripts/gate-dual-adapter.mjs`
- Create: `packages/api-client/scripts/run-real-screen.mjs`
- Create: `services/core-api/test/peers/e2e-process-entry.ts`
- Create: `services/quiz-service/test/peers/e2e-process-entry.ts`
- Create: `apps/panel/e2e/fixtures/real-stack.ts`
- Create: `apps/quiz/e2e/fixtures/real-stack.ts`
- Modify: `packages/api-client/package.json`
- Modify: `services/core-api/package.json`
- Modify: `services/quiz-service/package.json`

**Produces:** repeatable real B+D/TLS stack, test-only typed failure controls, normalized mock/real parity, and stable per-screen real commands.

- [ ] **Step 1: Add red contract/parity tests**

Assert the real stack exposes exactly 78 panel operations, three student operations, two B sockets, and one student socket; every successful/Problem/event frame parses; no quiz-sync server method leaks to a browser; representative normalized auth/recording/channel/storage/user/AI/quiz results match mock semantics after replacing ids/instants; and direct credentials/secret fields never appear. Assert `run-real-screen` fails when a spec does not declare a real witness.

Run: `pnpm --filter @eduscope/api-client test -- test/real/contract-honesty.test.ts test/real/parity.test.ts`

Expected: FAIL because no reusable real stack/gate exists.

- [ ] **Step 2: Build the real stack without production test routes**

Run core-api and quiz-service as separate `tsx` processes to avoid Fastify augmentation/rootDir conflicts already documented by D-08. D uses PostgreSQL 16 Testcontainers and its existing TLS proxy/certificate seam. B uses existing fake pipeline-manager and AI peers, seeded lecturer/admin/reset/disabled accounts, mounted storage, media fixtures, and the real D URL/device bearer. Each child prints one JSON `ready` line containing only random local URLs and opaque test ids; raw bearers/passwords stay in the parent process environment and never enter evidence.

Test controls use a loopback-only, random-port test peer endpoint owned by the process entry—not `buildApp()`—to invoke injected seams: close/reopen B WS, drop D sync, source/mic state, PM consumer exit/EOS timeout, storage pressure, helper result, WAN/upload result, firmware result, AI availability, relay result, and process restart. Production server builds and route ownership tests must prove these controls are absent.

- [ ] **Step 3: Implement both gate runners mechanically**

`gate-dual-adapter.mjs` uses `spawn(...,{shell:false,stdio:'inherit'})`, runs shared/api-client mock tests first, starts the stack, runs real contract/parity tests, then always terminates children in reverse order. `run-real-screen.mjs <panel|quiz> <spec-stem>` starts the same stack, exports only URLs/control URL to Playwright, runs the named spec with `EDUSCOPE_E2E_ADAPTER=real`, requires a `real` annotation, prints `PASS real:<spec-stem>`, and tears down on success, failure, SIGINT, or SIGTERM.

- [ ] **Step 4: Run the dual gate**

Run: `pnpm --filter @eduscope/api-client gate:dual`

Expected: PASS; mock suite runs with no servers, real suite runs against B+D, 78+3 operations and all message variants validate, the existing scenario overlay suite remains unchanged, and teardown reports no live child/container.

- [ ] **Step 5: Commit E-06**

```bash
git add packages/api-client/test/real packages/api-client/scripts packages/api-client/package.json services/core-api/test/peers/e2e-process-entry.ts services/core-api/package.json services/quiz-service/test/peers/e2e-process-entry.ts services/quiz-service/package.json apps/panel/e2e/fixtures apps/quiz/e2e/fixtures
git commit -m "test(integration): gate mock and real adapters"
```

---


### Task E-07: S-01 Login

**Files:**
- Modify: `apps/panel/src/screens/login/use-login.test.ts`
- Modify: `apps/panel/src/screens/login/login-screen.test.tsx`
- Modify: `apps/panel/e2e/s01-login.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] **Step 1: Add the red real witness**

Add a Playwright `real` case with `auth=real`: stop B before submit, assert the retry/unreachable copy and preserved username; restore B, submit a wrong password and assert invalid-credential copy (not unreachable); submit the seeded disabled account and assert the named disabled message; finally log in with the seeded lecturer and reach S-04. Assert the control peer recorded real `/auth/login` calls and no mock transition.

Run: `node packages/api-client/scripts/run-real-screen.mjs panel s01-login`

Expected: FAIL until the spec uses runtime real config and the fixture supports stop/restore.

- [ ] **Step 2: Preserve screen behavior and add real-error unit cases**

Drive `TransportError`, `auth.invalid-credentials`, and `auth.account-disabled` through the existing hook. Do not add a role picker or persist tokens. Keep the existing retry ceiling/backoff and password clearing behavior.

- [ ] **Step 3: Verify focused + contract tests**

Run: `pnpm --filter @eduscope/panel test -- src/screens/login src/auth && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s01-login`

Expected: PASS and `PASS real:s01-login`; unreachable, rejected, disabled, and successful real outcomes are distinct.

- [ ] **Step 4: Commit E-07**

```bash
git add apps/panel/src/screens/login apps/panel/e2e/s01-login.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): swap login to real auth"
```

---

### Task E-08: S-02 Password reset

**Files:**
- Modify: `apps/panel/src/screens/reset/use-change-password.test.ts`
- Modify: `apps/panel/src/screens/reset/reset-screen.test.tsx`
- Modify: `apps/panel/e2e/s02-reset.spec.ts`

- [ ] **Step 1: Add a red real reset sequence**

With `auth=real`, log in as the seeded reset-locked user, prove dashboard requests remain server-refused, submit a wrong current password, then a valid reset. Assert the client re-reads `/auth/me`, `mustResetPassword` is false before navigation, and logout remains callable while locked. Re-login with the new password to prove persistence.

Run: `node packages/api-client/scripts/run-real-screen.mjs panel s02-reset`

Expected: FAIL before the real sequence and server assertions are added.

- [ ] **Step 2: Extend unit coverage without changing policy**

Keep 204 handling bodyless, await real `getMe`, map invalid current password separately from policy refusal, and retain sign-out token clearing. Do not duplicate password policy in the adapter.

- [ ] **Step 3: Verify and commit**

Run: `pnpm --filter @eduscope/panel test -- src/screens/reset src/auth && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s02-reset`

Expected: PASS and `PASS real:s02-reset`; the reset-locked user cannot escape except logout/reset.

```bash
git add apps/panel/src/screens/reset apps/panel/e2e/s02-reset.spec.ts
git commit -m "test(panel): swap password reset to real auth"
```

---

### Task E-09: S-03 Shell/alerts

**Files:**
- Modify: `apps/panel/src/store/connection.ts`
- Modify: `apps/panel/src/store/connection.test.ts`
- Modify: `apps/panel/src/store/ws-store.ts`
- Modify: `apps/panel/src/store/ws-store.test.ts`
- Modify: `apps/panel/src/shell/offline-marker.tsx`
- Modify: `apps/panel/src/shell/offline-marker.test.tsx`
- Modify: `apps/panel/src/shell/notification-center.test.tsx`
- Modify: `apps/panel/e2e/s03-shell.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] **Step 1: Add red per-domain stale/resync tests**

Select `alerts=real` and `provisioningHealth=real` while recording remains mock. Drop the B WS for >10 seconds, then restore with an injected seq gap. Assert only those real regions mark offline, recording chrome remains, a single reset/reconnect occurs, and a real raised alert appears and acknowledges over REST.

Run: `pnpm --filter @eduscope/panel test -- src/store src/shell && node packages/api-client/scripts/run-real-screen.mjs panel s03-shell`

Expected: FAIL until shell selectors consume per-domain status.

- [ ] **Step 2: Bind shell state to routed connection projections**

Expose atomic selectors for domain phase/stale state; render the offline marker only for affected regions; retain the recording frame/notch. Keep acknowledgement a real `acknowledgeAlert` call and wait for event/readback truth rather than removing the row optimistically.

- [ ] **Step 3: Verify and commit**

Run: `pnpm --filter @eduscope/panel test -- src/store src/shell && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s03-shell`

Expected: PASS and `PASS real:s03-shell`; the fixture records one full resync and zero replayed command.

```bash
git add apps/panel/src/store apps/panel/src/shell apps/panel/e2e/s03-shell.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "feat(panel): show real domain connection state"
```

---

### Task E-10: S-04 Dashboard idle

**Files:**
- Modify: `apps/panel/src/screens/dashboard/use-start-recording.test.ts`
- Modify: `apps/panel/src/screens/dashboard/start-refusal.test.tsx`
- Modify: `apps/panel/src/screens/dashboard/dashboard-screen.test.tsx`
- Modify: `apps/panel/e2e/s04-idle.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] **Step 1: Add the real refusal witness**

Flip `recording=real` and `storage=real`. Through the typed fixture first mark the required presentation source offline, then set storage critical. For each start tap assert the precise real Problem copy and query the test peer to prove no `lecture_sessions` row and no PM record start call was created.

Run: `node packages/api-client/scripts/run-real-screen.mjs panel s04-idle`

Expected: FAIL until fixture faults and server-side no-row assertions are wired.

- [ ] **Step 2: Keep 202 semantics and render named refusals**

Unit tests must prove a returned `CommandAccepted` does not navigate; only a real `recording.state` transition does. Refusals retain the idle screen and one enabled retry action after the condition is cleared.

- [ ] **Step 3: Verify and commit**

Run: `pnpm --filter @eduscope/panel test -- src/screens/dashboard && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s04-idle`

Expected: PASS and `PASS real:s04-idle`; both refusal classes create zero session rows.

```bash
git add apps/panel/src/screens/dashboard apps/panel/e2e/s04-idle.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): swap idle recording start to real"
```

---

### Task E-11: S-05 Dashboard session

**Files:**
- Modify: `apps/panel/src/screens/session/use-capture-assurance.test.ts`
- Modify: `apps/panel/src/screens/session/capture-assurance-card.test.tsx`
- Modify: `apps/panel/src/screens/session/capture-verdict.test.tsx`
- Modify: `apps/panel/e2e/s05-session.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] **Step 1: Add the real consumer-death witness**

Flip `channels=real` and `sourcesAudio=real` in addition to prior domains. Start a real lecture, kill only the record consumer with the PM peer, and observe real events through degraded/error/recovery. Assert “Your lecture is still recording” only when the backend fallback says so, no stale green verdict appears, and meeting/live processes remain untouched.

Run: `node packages/api-client/scripts/run-real-screen.mjs panel s05-session`

Expected: FAIL until the fixture exposes targeted record-consumer exit/recovery.

- [ ] **Step 2: Extend the assurance fold tests**

Feed the exact real source/channel/recording event order, including temporary unknown and recovery. The fold stays derived/read-only and never writes recording state or starts a fallback itself.

- [ ] **Step 3: Verify and commit**

Run: `pnpm --filter @eduscope/panel test -- src/screens/session && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s05-session`

Expected: PASS and `PASS real:s05-session`; fixture process ids prove only record restarted.

```bash
git add apps/panel/src/screens/session apps/panel/e2e/s05-session.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): verify real session capture assurance"
```

---

### Task E-12: S-06 Lock/takeover

**Files:**
- Modify: `apps/panel/src/screens/dashboard/use-recorder-lock.test.ts`
- Modify: `apps/panel/src/screens/dashboard/lock-card.test.tsx`
- Modify: `apps/panel/src/screens/dashboard/takeover-confirm.test.tsx`
- Modify: `apps/panel/src/screens/dashboard/takeover-notice.test.tsx`
- Modify: `apps/panel/e2e/s06-lock.spec.ts`

- [ ] **Step 1: Add a two-browser real race**

Use three contexts: owner lecturer starts; second lecturer and admin load the lock. Race direct takeover calls. Assert lecturer is 403, admin is 202, one real takeover event attributes original owner and takeover actor/time, and the displaced owner's auth session receives `auth.session-revoked` with takeover reason.

Run: `node packages/api-client/scripts/run-real-screen.mjs panel s06-lock`

Expected: FAIL before multi-context real authority assertions.

- [ ] **Step 2: Verify authority rendering and KEEP B-15**

Unit-test the complete owner/other/admin × idle/live/completed cross-product with real Problem shapes. Never infer authority from hidden buttons alone; server denial remains asserted.

- [ ] **Step 3: Verify and commit**

Run: `pnpm --filter @eduscope/panel test -- src/screens/dashboard/use-recorder-lock.test.ts src/screens/dashboard/lock-card.test.tsx src/screens/dashboard/takeover-confirm.test.tsx src/screens/dashboard/takeover-notice.test.tsx && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s06-lock`

Expected: PASS and `PASS real:s06-lock`; exactly one actor owns the unchanged lecture session. **[KEEP B-15]**

```bash
git add apps/panel/src/screens/dashboard apps/panel/e2e/s06-lock.spec.ts
git commit -m "test(panel): verify real recorder takeover"
```

---

### Task E-13: S-07 Transport

**Files:**
- Modify: `apps/panel/src/screens/transport/use-transport.ts`
- Modify: `apps/panel/src/screens/transport/use-transport.test.ts`
- Modify: `apps/panel/src/screens/transport/timer-card.test.tsx`
- Modify: `apps/panel/e2e/s07-transport.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] **Step 1: Add real pause/stop deadline tests**

Force PM EOS timeout separately for Pause and Stop. Assert 202 only enters pending, the resolving real event within the 10-second deadline produces truncated/error copy, and no client timer invents final state. Reload while genuinely paused and prove server-derived duration/segment data resumes.

Run: `node packages/api-client/scripts/run-real-screen.mjs panel s07-transport`

Expected: FAIL until real timeout controls and reload witness exist.

- [ ] **Step 2: Align pending logic to real `resolveBySec`**

Use the returned command deadline (bounded by `T-CMD-RESOLVE`) and cancel it only on a correlated recording transition/refusal. Keep the displayed timer derived from `startedAt`/`recordedDurationMs`, not WS tick events. Mock delays remain illustrative only.

- [ ] **Step 3: Verify and commit**

Run: `pnpm --filter @eduscope/panel test -- src/screens/transport && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s07-transport`

Expected: PASS and `PASS real:s07-transport`; no pending state exceeds the real deadline and reload does not reset elapsed time.

```bash
git add apps/panel/src/screens/transport apps/panel/e2e/s07-transport.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "feat(panel): resolve transport from real events"
```

---

### Task E-14: S-09 Sources/audio

**Files:**
- Modify: `apps/panel/src/screens/sources/source-tile.test.tsx`
- Modify: `apps/panel/src/screens/sources/mic-row.test.tsx`
- Modify: `apps/panel/src/screens/sources/level-meter.test.tsx`
- Modify: `apps/panel/src/audio/use-audio-control.test.ts`
- Modify: `apps/panel/e2e/s09-sources.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] **Step 1: Add real unplug/apply-failure witness**

During a real recording, set mic source offline and make the next mixer apply return `appliedState:'failed'`. Assert source offline, meter CSS updates stop, command remains pending until `audio.control`, failed applied truth/copy renders, and restore returns online/meters without restarting record.

Run: `node packages/api-client/scripts/run-real-screen.mjs panel s09-sources`

Expected: FAIL until the real telemetry/control faults are available.

- [ ] **Step 2: Preserve the telemetry boundary**

Unit-test that `audio.levels` writes only the transient store/CSS property and never React state; `audio.control` readback is authoritative over requested gain/mute. Offline suppresses stale meter values.

- [ ] **Step 3: Verify and commit**

Run: `pnpm --filter @eduscope/panel test -- src/screens/sources src/audio && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s09-sources`

Expected: PASS and `PASS real:s09-sources`; record consumer id is unchanged across mic loss/recovery.

```bash
git add apps/panel/src/screens/sources apps/panel/src/audio apps/panel/e2e/s09-sources.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): verify real sources and audio"
```

---

### Task E-15: S-10 Wave-2 shell checkpoint

**Files:**
- Modify: `apps/panel/src/screens/sources/preview-lightbox.test.tsx`
- Modify: `apps/panel/src/screens/sources/use-preview.test.ts`
- Modify: `apps/panel/e2e/s10-preview.spec.ts`

- [ ] **Step 1: Add the mixed checkpoint**

Run all surrounding source data real but serve `/config.json` with `preview:'mock'`. Open/close every tile, prove the mock JPEG sentinel still renders, and prove no real `/ws/preview` upgrade occurred. Label this test “checkpoint, not integration acceptance.”

Run: `node packages/api-client/scripts/run-real-screen.mjs panel s10-preview`

Expected: FAIL until the spec supplies the explicit preview override and asserts channel provenance.

- [ ] **Step 2: Verify and commit**

Run: `pnpm --filter @eduscope/panel test -- src/screens/sources/preview-lightbox.test.tsx src/screens/sources/use-preview.test.ts && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s10-preview`

Expected: PASS and `PASS real:s10-preview`; source REST/events are real, preview signaling is mock, and DR-23 remains unclaimed.

```bash
git add apps/panel/src/screens/sources/preview-lightbox.test.tsx apps/panel/src/screens/sources/use-preview.test.ts apps/panel/e2e/s10-preview.spec.ts
git commit -m "test(panel): checkpoint mixed preview shell"
```

---

### Task E-16: S-11 Room controls

**Files:**
- Modify: `apps/panel/src/screens/room/room-controls-bar.test.tsx`
- Modify: `apps/panel/src/screens/room/mic-master-row.test.tsx`
- Modify: `apps/panel/src/screens/room/not-connected-region.test.tsx`
- Modify: `apps/panel/src/screens/room/not-connected-row.test.tsx`
- Modify: `apps/panel/e2e/s11-room.spec.ts`

- [ ] **Step 1: Add real mute authority and no-network assertions**

As a non-owner during recording, mute and assert server refusal; as owner/admin, mute and wait for real applied mixer state. Instrument the real client and assert lights, AC, and projector-power placeholder interactions issue zero operation/HTTP/WS calls.

Run: `node packages/api-client/scripts/run-real-screen.mjs panel s11-room`

Expected: FAIL until role/refusal and zero-call witness are real.

- [ ] **Step 2: Verify D-10 remains deferred and commit**

Run: `pnpm --filter @eduscope/panel test -- src/screens/room && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s11-room`

Expected: PASS and `PASS real:s11-room`; only `updateAudioControl` is called and no room-hardware endpoint exists.

```bash
git add apps/panel/src/screens/room apps/panel/e2e/s11-room.spec.ts
git commit -m "test(panel): verify real room microphone control"
```

---

### Task E-17: S-12 Power off

**Files:**
- Modify: `apps/panel/src/screens/room/use-power-off.ts`
- Modify: `apps/panel/src/screens/room/use-power-off.test.ts`
- Modify: `apps/panel/src/screens/room/power-off-confirm.test.tsx`
- Modify: `apps/panel/src/screens/room/power-off-row.test.tsx`
- Modify: `apps/panel/e2e/s12-poweroff.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] **Step 1: Add both real races**

Open the confirm dialog while idle, start recording from a second context, then confirm and assert `recording.active` refusal with zero helper invocation. In a fresh idle run, accept through the test helper, close the B connection, and assert terminal expected-shutdown UI without waiting for a resolving event.

Run: `node packages/api-client/scripts/run-real-screen.mjs panel s12-poweroff`

Expected: FAIL until `devicePower=real` and helper/connection controls are wired.

- [ ] **Step 2: Keep the command's exceptional terminal semantics**

On accepted 202 set expected-shutdown; transport closure is success. A still-open connection after the bounded “not halted” period renders the existing failure. Never invent `power.state`.

- [ ] **Step 3: Verify and commit**

Run: `pnpm --filter @eduscope/panel test -- src/screens/room src/store/connection.test.ts && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s12-poweroff`

Expected: PASS and `PASS real:s12-poweroff`; active refusal and idle helper invocation are both server-proven. **[KEEP B-50]**

```bash
git add apps/panel/src/screens/room apps/panel/e2e/s12-poweroff.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): verify guarded real power off"
```

---

### Task E-18: S-25 Advanced shell

**Files:**
- Modify: `apps/panel/src/screens/advanced/advanced-shell.test.tsx`
- Modify: `apps/panel/src/screens/advanced/advanced-nav.ts`
- Modify: `apps/panel/src/auth/require-role.test.tsx`
- Modify: `apps/panel/e2e/s25-advanced.spec.ts`

- [ ] **Step 1: Add real role/deep-link tests**

Deep-link a lecturer to every admin child and assert redirect/refusal plus zero admin-domain response rendered; navigate as admin at 1280×800 and assert all routes/44px targets remain reachable. Query the peer audit to prove denied requests disclosed no admin rows.

Run: `node packages/api-client/scripts/run-real-screen.mjs panel s25-advanced`

Expected: FAIL before real role/data assertions.

- [ ] **Step 2: Verify and commit**

Run: `pnpm --filter @eduscope/panel test -- src/screens/advanced/advanced-shell.test.tsx src/auth/require-role.test.tsx && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s25-advanced`

Expected: PASS and `PASS real:s25-advanced`; UI hiding and server 403 are both demonstrated.

```bash
git add apps/panel/src/screens/advanced/advanced-shell.test.tsx apps/panel/src/screens/advanced/advanced-nav.ts apps/panel/src/auth/require-role.test.tsx apps/panel/e2e/s25-advanced.spec.ts
git commit -m "test(panel): verify advanced shell with real roles"
```

---

### Task E-19: S-26 Local capture layout

**Files:**
- Modify: `apps/panel/src/screens/advanced/use-local-capture-layout.test.tsx`
- Modify: `apps/panel/src/screens/advanced/local-capture-screen.test.tsx`
- Modify: `apps/panel/e2e/s26-local-capture.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] **Step 1: Add invalid/valid real preset witness**

Submit a meeting-only preset to local capture and assert contract refusal/no DB change; save a valid PC/camera preset and ratios, re-read it, start the next recording, and inspect the PM request/argv fixture for the same preset/ratios.

Run: `node packages/api-client/scripts/run-real-screen.mjs panel s26-local-capture`

Expected: FAIL before config-to-next-pipeline inspection.

- [ ] **Step 2: Verify and commit**

Run: `pnpm --filter @eduscope/panel test -- src/screens/advanced/use-local-capture-layout.test.tsx src/screens/advanced/local-capture-screen.test.tsx && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s26-local-capture`

Expected: PASS and `PASS real:s26-local-capture`; readback and next pipeline agree. **[KEEP B-60]**

```bash
git add apps/panel/src/screens/advanced/use-local-capture-layout.test.tsx apps/panel/src/screens/advanced/local-capture-screen.test.tsx apps/panel/e2e/s26-local-capture.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): verify real local capture layout"
```

---

### Task E-20: S-27 Streaming configuration

**Files:**
- Modify: `apps/panel/src/screens/advanced/use-stream-targets.test.tsx`
- Modify: `apps/panel/src/screens/advanced/stream-target-form.test.tsx`
- Modify: `apps/panel/src/screens/advanced/stream-target-list.test.tsx`
- Modify: `apps/panel/src/screens/advanced/streaming-screen.test.tsx`
- Modify: `apps/panel/e2e/s27-streaming.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] **Step 1: Add real secret/preflight/reload witness**

Flip `streamTargets=real`. Create YouTube/Facebook/custom targets, assert write-only secret never returns in REST/event/DOM/log, enable an exact subset, then fail RTMPS preflight and relay reload. Assert streaming failure while local recording stays live and the relay peer received exactly the enabled target set.

Run: `node packages/api-client/scripts/run-real-screen.mjs panel s27-streaming`

Expected: FAIL before relay controls and secret scan.

- [ ] **Step 2: Verify and commit**

Run: `pnpm --filter @eduscope/panel test -- src/screens/advanced/use-stream-targets.test.tsx src/screens/advanced/stream-target-form.test.tsx src/screens/advanced/stream-target-list.test.tsx src/screens/advanced/streaming-screen.test.tsx && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s27-streaming`

Expected: PASS and `PASS real:s27-streaming`; local record id stays live and pushed destinations equal enabled ids. **[KEEP B-59]**

```bash
git add apps/panel/src/screens/advanced apps/panel/e2e/s27-streaming.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): verify real stream target configuration"
```

---

### Task E-21: S-08 Meeting channel

**Files:**
- Modify: `apps/panel/src/screens/session/use-meeting-channel.test.tsx`
- Modify: `apps/panel/src/screens/session/meeting-channel-card.test.tsx`
- Modify: `apps/panel/e2e/s08-meeting.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] **Step 1: Add real independent-consumer witness**

Start recording and meeting; reject a PC-inclusive meeting preset; kill only meeting and observe fail/restart events. Assert recording process/id/state are unchanged and the fake HDMI #2 probe still reports mic audio after recovery.

Run: `node packages/api-client/scripts/run-real-screen.mjs panel s08-meeting`

Expected: FAIL before the meeting-only fault/probe is real.

- [ ] **Step 2: Verify and commit**

Run: `pnpm --filter @eduscope/panel test -- src/screens/session/use-meeting-channel.test.tsx src/screens/session/meeting-channel-card.test.tsx && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s08-meeting`

Expected: PASS and `PASS real:s08-meeting`; meeting restart does not touch record.

```bash
git add apps/panel/src/screens/session/use-meeting-channel.test.tsx apps/panel/src/screens/session/meeting-channel-card.test.tsx apps/panel/e2e/s08-meeting.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): verify real meeting channel"
```

---

### Task E-22: S-13 AI Studio

**Files:**
- Modify: `apps/panel/src/ai/use-ai-studio.test.ts`
- Modify: `apps/panel/src/screens/ai/ai-studio-card.test.tsx`
- Modify: `apps/panel/e2e/s13-ai-studio.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] Add a red `aiQuiz=real` witness: start a real recording, stop the LAN-LLM peer, allow a scheduled cycle and Generate Now, and assert real 503/timeout holds the countdown in degraded/retry while recording stays live. Restore the peer without restarting B/C, assert countdown recovery, press Generate Now, and receive 3–5 ready drafts within B's 45-second outer budget. Run `node packages/api-client/scripts/run-real-screen.mjs panel s13-ai-studio`; expected FAIL before the AI peer controls and real event assertions exist.
- [ ] Extend unit tests with the real `ai.countdown`/`ai.set` ordering. The card never simulates countdown ticks or changes recording state; pending commands resolve only from events.
- [ ] Run `pnpm --filter @eduscope/panel test -- src/ai/use-ai-studio.test.ts src/screens/ai/ai-studio-card.test.tsx && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s13-ai-studio`. Expected: PASS and `PASS real:s13-ai-studio`; fixture records recording continuously live during LLM loss.
- [ ] Commit:

```bash
git add apps/panel/src/ai/use-ai-studio.test.ts apps/panel/src/screens/ai/ai-studio-card.test.tsx apps/panel/e2e/s13-ai-studio.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): verify real ai studio degradation"
```

---

### Task E-23: S-14 Questions review

**Files:**
- Modify: `apps/panel/src/screens/ai/questions-modal.test.tsx`
- Modify: `apps/panel/src/screens/ai/question-card.test.tsx`
- Modify: `apps/panel/src/ai/use-questions.test.ts`
- Modify: `apps/panel/e2e/s14-questions.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] Add a red real publish witness: cut B↔D after a draft exists, tap Send, and prove the modal stays pending/failed with projector passthrough and no `isShowing`. Restore the link, retry once, and assert D stores one publication and only then PM receives the projector call. Run the focused real command; expected FAIL before sync control/order assertions.
- [ ] Unit-test publishing/open/failed event order and immutable sent state. Do not switch projector or mark sent from the 202 response.
- [ ] Run `pnpm --filter @eduscope/panel test -- src/screens/ai/questions-modal.test.tsx src/screens/ai/question-card.test.tsx src/ai/use-questions.test.ts && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s14-questions`. Expected: PASS and `PASS real:s14-questions`; one D publication, one projector switch, ack first.
- [ ] Commit:

```bash
git add apps/panel/src/screens/ai/questions-modal.test.tsx apps/panel/src/screens/ai/question-card.test.tsx apps/panel/src/ai/use-questions.test.ts apps/panel/e2e/s14-questions.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): verify real question publication"
```

---

### Task E-24: S-15 Add question

**Files:**
- Modify: `apps/panel/src/ai/use-add-question.test.ts`
- Modify: `apps/panel/src/screens/ai/add-question-dialog.test.tsx`
- Modify: `apps/panel/e2e/s15-add-question.spec.ts`

- [ ] Add a red real test that submits an invalid option/correctness shape (server refusal, zero row), then a valid 2–4 option MCQ; assert only the valid draft appears and has lecturer provenance/audit actor. Run the real screen command; expected FAIL before DB/audit assertions.
- [ ] Preserve client validation as assistance, not authority; render server field violations by pointer and wait for `ai.question`/re-read before closing the dialog.
- [ ] Run `pnpm --filter @eduscope/panel test -- src/ai/use-add-question.test.ts src/screens/ai/add-question-dialog.test.tsx && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s15-add-question`. Expected: PASS and `PASS real:s15-add-question`; one valid question and audit row.
- [ ] Commit:

```bash
git add apps/panel/src/ai/use-add-question.test.ts apps/panel/src/screens/ai/add-question-dialog.test.tsx apps/panel/e2e/s15-add-question.spec.ts
git commit -m "test(panel): verify real lecturer question creation"
```

---

### Task E-25: S-16 Previous questions

**Files:**
- Modify: `apps/panel/src/ai/use-publication-responses.test.ts`
- Modify: `apps/panel/src/screens/ai/previous-questions-tab.test.tsx`
- Modify: `apps/panel/e2e/s16-previous-questions.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] Add a red real replay test: publish, cut D sync, submit phone answers to D, pass the 20-second stale threshold, assert response chips explicitly stale, restore sync, and compare B projections with D answers exactly once. Run the focused real command; expected FAIL before link/replay controls.
- [ ] Unit-test stale REST snapshot + live delta folding without duplicate answers or silent empty state. DR-22 remains backend integration, not a mock sync implementation.
- [ ] Run `pnpm --filter @eduscope/panel test -- src/ai/use-publication-responses.test.ts src/screens/ai/previous-questions-tab.test.tsx && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s16-previous-questions`. Expected: PASS and `PASS real:s16-previous-questions`; watermark and row counts converge.
- [ ] Commit:

```bash
git add apps/panel/src/ai/use-publication-responses.test.ts apps/panel/src/screens/ai/previous-questions-tab.test.tsx apps/panel/e2e/s16-previous-questions.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): verify real response replay"
```

---

### Task E-26: S-17 Leaderboard

**Files:**
- Modify: `apps/panel/src/ai/use-leaderboard.test.ts`
- Modify: `apps/panel/src/screens/ai/leaderboard-tab.test.tsx`
- Modify: `apps/panel/e2e/s17-leaderboard.spec.ts`

- [ ] Add a red real tie/replay case: submit tied correct/incorrect histories during a sync gap, restore, and assert panel dense ranks equal each student's own D result with no duplicate row. Run the real command; expected FAIL until cross-app rank assertions are present.
- [ ] Unit-test only the shared `rankLeaderboard`/DM-10 helper; remove any test-local formula. Stale state remains visible until replay is complete.
- [ ] Run `pnpm --filter @eduscope/panel test -- src/ai/use-leaderboard.test.ts src/screens/ai/leaderboard-tab.test.tsx && pnpm --filter @eduscope/shared test && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s17-leaderboard`. Expected: PASS and `PASS real:s17-leaderboard`; rank vectors match B/D/student.
- [ ] Commit:

```bash
git add apps/panel/src/ai/use-leaderboard.test.ts apps/panel/src/screens/ai/leaderboard-tab.test.tsx apps/panel/e2e/s17-leaderboard.spec.ts
git commit -m "test(panel): verify real leaderboard parity"
```

---

### Task E-27: S-18 Response names

**Files:**
- Modify: `apps/panel/src/screens/ai/names-dialog.test.tsx`
- Modify: `apps/panel/e2e/s18-names.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] Add a red scope/privacy witness: attempt to inject names using another device's credential/session and assert D/B deny it; keep the current room's last known list stale-marked rather than replacing it with empty. Scan DOM/control logs for the other room identity. Expected real command: FAIL before cross-device fixture support.
- [ ] Unit-test authorized populated/stale/error projections and zero cross-session merge.
- [ ] Run `pnpm --filter @eduscope/panel test -- src/screens/ai/names-dialog.test.tsx && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s18-names`. Expected: PASS and `PASS real:s18-names`; privacy scan count 0.
- [ ] Commit:

```bash
git add apps/panel/src/screens/ai/names-dialog.test.tsx apps/panel/e2e/s18-names.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): verify response-name isolation"
```

---

### Task E-28: S-19 Student detail

**Files:**
- Modify: `apps/panel/src/screens/ai/student-detail-dialog.test.tsx`
- Modify: `apps/panel/e2e/s19-student-detail.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] Add a red projection replacement witness: delete the B-side participant projection in the test peer, open the dialog and render missing—not another row—then replay the authoritative D projection and assert one atomic identity/history replacement. Expected focused real run: FAIL before projection controls.
- [ ] Unit-test missing, stale, and updated participant states keyed by stable student id; never join by row position/display name.
- [ ] Run `pnpm --filter @eduscope/panel test -- src/screens/ai/student-detail-dialog.test.tsx && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s19-student-detail`. Expected: PASS and `PASS real:s19-student-detail`; no mixed identity fields across replacement.
- [ ] Commit:

```bash
git add apps/panel/src/screens/ai/student-detail-dialog.test.tsx apps/panel/e2e/s19-student-detail.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): verify real student detail replacement"
```

---

### Task E-29: S-20 Quiz join/QR

**Files:**
- Modify: `apps/panel/src/ai/use-quiz-session.test.ts`
- Modify: `apps/panel/src/screens/ai/quiz-join-chip.test.tsx`
- Modify: `apps/panel/src/screens/ai/quiz-join-modal.test.tsx`
- Modify: `apps/panel/e2e/s20-quiz-join.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] Add a red real session-mint/staleness witness: stop D before recording/session mint and assert bounded requesting→failed; restore D and retry to one open session/join URL/code; then lose heartbeat and assert joined count explicitly stale, never silently live. Expected focused run: FAIL before process/heartbeat controls.
- [ ] Unit-test absent/requesting/open/failed/closed plus `synced|stale|failed`; the QR encodes only server join URL. Do not add a pre-publication projector QR (QO-1).
- [ ] Run `pnpm --filter @eduscope/panel test -- src/ai/use-quiz-session.test.ts src/screens/ai/quiz-join-chip.test.tsx src/screens/ai/quiz-join-modal.test.tsx && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s20-quiz-join`. Expected: PASS and `PASS real:s20-quiz-join`; one D session, honest stale count.
- [ ] Commit:

```bash
git add apps/panel/src/ai/use-quiz-session.test.ts apps/panel/src/screens/ai/quiz-join-chip.test.tsx apps/panel/src/screens/ai/quiz-join-modal.test.tsx apps/panel/e2e/s20-quiz-join.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): verify real quiz join state"
```

---

### Task E-30: S-21 Library

**Files:**
- Modify: `apps/panel/src/screens/library/use-recordings.test.ts`
- Modify: `apps/panel/src/screens/library/library-filters.test.tsx`
- Modify: `apps/panel/src/screens/library/recording-row.test.tsx`
- Modify: `apps/panel/src/screens/library/library-screen.test.tsx`
- Modify: `apps/panel/e2e/s21-library.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] Add a red `libraryExport=real` witness: seed two owners and multiple cursor pages; drop HTTP on page two, retry without losing page one; assert lecturer sees only own rows, admin owner/title filters are server-applied, and real artifact/upload events update badges. Expected focused run: FAIL before paging fault/query inspection.
- [ ] Unit-test cursor retry/cache keys and role-scoped filters. Never filter another lecturer out only in React.
- [ ] Run `pnpm --filter @eduscope/panel test -- src/screens/library/use-recordings.test.ts src/screens/library/library-filters.test.tsx src/screens/library/recording-row.test.tsx src/screens/library/library-screen.test.tsx && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s21-library`. Expected: PASS and `PASS real:s21-library`; server result ids prove scope/filter. **[KEEP B-31]**
- [ ] Commit:

```bash
git add apps/panel/src/screens/library apps/panel/e2e/s21-library.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): verify real recording library"
```

---

### Task E-31: S-22 Recording detail/player

**Files:**
- Modify: `apps/panel/src/screens/library/detail/use-recording-detail.test.ts`
- Modify: `apps/panel/src/screens/library/detail/recording-player.test.tsx`
- Modify: `apps/panel/src/screens/library/detail/retry-merge.test.tsx`
- Modify: `apps/panel/src/screens/library/detail/recording-detail-screen.test.tsx`
- Modify: `apps/panel/e2e/s22-detail.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] Add a red real media/merge witness: interrupt one authenticated Range request and retry playback; inject merge failure, then valid admin retry and non-failed retry refusal. Assert precise `conflict + meta.reason` copy and playable bytes after recovery. Expected focused run: FAIL before Range/failure controls.
- [ ] Unit-test Blob URL revoke/recreate, 206/200 behavior, merge states, and no invented Problem code (DR-08 no-change).
- [ ] Run `pnpm --filter @eduscope/panel test -- src/screens/library/detail && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s22-detail`. Expected: PASS and `PASS real:s22-detail`; player recovers and merge truth comes from events/readback. **[KEEP B-23]**
- [ ] Commit:

```bash
git add apps/panel/src/screens/library/detail apps/panel/e2e/s22-detail.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): verify real recording playback"
```

---

### Task E-32: S-23 USB export

**Files:**
- Modify: `apps/panel/src/screens/library/export/use-export.test.ts`
- Modify: `apps/panel/src/screens/library/export/use-eta.test.ts`
- Modify: `apps/panel/src/screens/library/export/export-modal.test.tsx`
- Modify: `apps/panel/src/screens/library/export/export-progress.test.tsx`
- Modify: `apps/panel/e2e/s23-export.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] Add a red two-browser real export witness: list/select a USB, remove it mid-copy; separately fill it after listing; assert real progress then the contracted missing/capacity failure and client-smoothed ETA. The other auth session must receive no USB/job events. Expected focused run: FAIL before scoped export controls.
- [ ] Unit-test session scoping, no global event merge, ETA smoothing from real byte deltas, and cancel resolution by event.
- [ ] Run `pnpm --filter @eduscope/panel test -- src/screens/library/export && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s23-export`. Expected: PASS and `PASS real:s23-export`; second browser event count 0. **[KEEP B-32]**
- [ ] Commit:

```bash
git add apps/panel/src/screens/library/export apps/panel/e2e/s23-export.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): verify real usb export"
```

---

### Task E-33: S-24 Delete confirm

**Files:**
- Modify: `apps/panel/src/screens/library/delete-body.test.ts`
- Modify: `apps/panel/src/screens/library/delete-recording-confirm.test.tsx`
- Modify: `apps/panel/e2e/s21-library.spec.ts`
- Modify: `apps/panel/e2e/s22-detail.spec.ts`

- [ ] Add red real coverage to S-21/S-22: lecturer direct DELETE is 403; admin confirms never-uploaded and in-flight fixtures with the correct differentiated warning; after accepted command, wait for deletion event/readback and assert audit actor equals admin. Expected focused runs: FAIL before real delete/audit assertions.
- [ ] Unit-test role/upload/merge race copy; never remove the row on 202 alone.
- [ ] Run `pnpm --filter @eduscope/panel test -- src/screens/library/delete-body.test.ts src/screens/library/delete-recording-confirm.test.tsx && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s21-library && node packages/api-client/scripts/run-real-screen.mjs panel s22-detail`. Expected: PASS; durable audit actor and artifact deletion verified. **[KEEP B-33]**
- [ ] Commit:

```bash
git add apps/panel/src/screens/library/delete-body.test.ts apps/panel/src/screens/library/delete-recording-confirm.test.tsx apps/panel/e2e/s21-library.spec.ts apps/panel/e2e/s22-detail.spec.ts
git commit -m "test(panel): verify real recording deletion"
```

---

### Task E-34: S-35 Upload queue

**Files:**
- Modify: `apps/panel/src/screens/advanced/uploads/use-upload-jobs.test.ts`
- Modify: `apps/panel/src/screens/advanced/uploads/upload-job-row.test.tsx`
- Modify: `apps/panel/src/screens/advanced/uploads/upload-parts.test.tsx`
- Modify: `apps/panel/src/screens/advanced/uploads/requeue-button.test.tsx`
- Modify: `apps/panel/src/screens/advanced/uploads/upload-queue-screen.test.tsx`
- Modify: `apps/panel/e2e/s35-uploads.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] Add a red `uploads=real` witness using the placeholder endpoint/fault proxy: cut WAN mid-part, assert waiting-for-network and unchanged attempts, restart B, restore and assert durable byte-offset resume; inject server/permanent failure to dead-letter, then manual requeue. Expected focused run: FAIL before fault proxy/control assertions.
- [ ] Unit-test failure-class labels, per-part progress, dead-letter visibility, and 202 requeue resolution from events. UI/evidence must say placeholder only; no institute payload claim.
- [ ] Run `pnpm --filter @eduscope/panel test -- src/screens/advanced/uploads && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s35-uploads`. Expected: PASS and `PASS real:s35-uploads`; resume offset >0, connectivity attempt delta 0, dead-letter/requeue durable. **[KEEP B-27, B-28]**
- [ ] Commit:

```bash
git add apps/panel/src/screens/advanced/uploads apps/panel/e2e/s35-uploads.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): verify real upload queue lifecycle"
```

---

### Task E-35: S-28 Network settings

**Files:**
- Modify: `apps/panel/src/screens/advanced/network/use-network-config.ts`
- Modify: `apps/panel/src/screens/advanced/network/use-camera-bindings.ts`
- Modify: `apps/panel/src/screens/advanced/network/network-screen.test.tsx`
- Modify: `apps/panel/e2e/s28-network.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] Add a red `network=real` witness against an isolated test namespace: reject invalid config before helper; apply valid wired config, inject helper rollback/error and verify readback; update camera binding and observe PM reprobe. Hash the built JS before/after config changes to prove no rebuild. Expected focused run: FAIL before namespace/helper/reprobe controls.
- [ ] Unit-test async 202 apply, rollback copy, and source-status truth. Do not add Wi-Fi fields or direct OS commands.
- [ ] Run `pnpm --filter @eduscope/panel test -- src/screens/advanced/network && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s28-network`. Expected: PASS and `PASS real:s28-network`; bundle hashes equal and helper sees only `net.apply`.
- [ ] Commit:

```bash
git add apps/panel/src/screens/advanced/network apps/panel/e2e/s28-network.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): verify real network apply"
```

---

### Task E-36: S-29 Encoder settings

**Files:**
- Modify: `apps/panel/src/screens/advanced/encoder/use-encoder-settings.ts`
- Modify: `apps/panel/src/screens/advanced/encoder/encoder-screen.test.tsx`
- Modify: `apps/panel/e2e/s29-encoder.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] Add a red `encoder=real` DR-14 witness: query streaming scope, set `channelId:'streaming'` override, start the next stream and inspect `ffprobe`/rendered PM profile; start local capture and prove its default profile unchanged. Expected focused run: FAIL before scoped output inspection.
- [ ] Unit-test optional `?channelId` GET and update `channelId`, capabilities, unsupported values, and readback; no device-global fallback.
- [ ] Run `pnpm --filter @eduscope/panel test -- src/screens/advanced/encoder && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s29-encoder`. Expected: PASS and `PASS real:s29-encoder`; streaming bitrate/fps match, local default unchanged. **[KEEP B-56]**
- [ ] Commit:

```bash
git add apps/panel/src/screens/advanced/encoder apps/panel/e2e/s29-encoder.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): verify scoped real encoder settings"
```

---

### Task E-37: S-30 Local storage

**Files:**
- Modify: `apps/panel/src/screens/advanced/storage/use-storage.ts`
- Modify: `apps/panel/src/screens/advanced/storage/format-danger-zone.tsx`
- Modify: `apps/panel/src/screens/advanced/storage/retention-policy-card.tsx`
- Modify: `apps/panel/src/screens/advanced/storage/storage-screen.test.tsx`
- Modify: `apps/panel/e2e/s30-storage.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] Add a red real scratch-volume witness: helper refusal and wrong confirmation both prevent format; correct explicit scratch target may format. Cross warning/critical thresholds, seed uploaded/unuploaded/foreign rows, run sweep, and assert uploaded-oldest only; Start at critical is refused and UI policy text equals server policy. Expected focused run: FAIL before scratch retention controls.
- [ ] Unit-test display-only expected UUID (DIO-1), exact confirmation, pressure/policy, and no optimistic format state.
- [ ] Run `pnpm --filter @eduscope/panel test -- src/screens/advanced/storage && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s30-storage`. Expected: PASS and `PASS real:s30-storage`; no unuploaded/foreign deletion and helper target exact. **[KEEP B-53]**
- [ ] Commit:

```bash
git add apps/panel/src/screens/advanced/storage apps/panel/e2e/s30-storage.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): verify real storage policy"
```

---

### Task E-38: S-31 Firmware

**Files:**
- Modify: `apps/panel/src/screens/advanced/firmware/use-firmware.ts`
- Modify: `apps/panel/src/screens/advanced/firmware/firmware-lifecycle.tsx`
- Modify: `apps/panel/src/screens/advanced/firmware/firmware-screen.test.tsx`
- Modify: `apps/panel/e2e/s31-firmware.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] Add a red `firmware=real` witness: bad signature check/apply fails; valid staged apply simulates failed boot, disconnect/reconnect, and rollback state from real snapshot/event. Expected focused run: FAIL before helper/restart controls.
- [ ] Unit-test all firmware lifecycle states and 202 resolution; never infer success from connection loss alone for firmware.
- [ ] Run `pnpm --filter @eduscope/panel test -- src/screens/advanced/firmware && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s31-firmware`. Expected: PASS and `PASS real:s31-firmware`; rollback survives B restart.
- [ ] Commit:

```bash
git add apps/panel/src/screens/advanced/firmware apps/panel/e2e/s31-firmware.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): verify real firmware rollback"
```

---

### Task E-39: S-32 User management

**Files:**
- Modify: `apps/panel/src/screens/advanced/users/use-users.ts`
- Modify: `apps/panel/src/screens/advanced/users/last-admin.test.ts`
- Modify: `apps/panel/src/screens/advanced/users/user-management-screen.test.tsx`
- Modify: `apps/panel/e2e/s32-users.spec.ts`

- [ ] Add a red `users=real` role/session witness: lecturer direct calls are 403; last admin delete is refused; create/update role matrix remains valid; disabling a logged-in account revokes its active session and prevents refresh. Expected focused run: FAIL before multi-context session assertions.
- [ ] Unit-test cursor/search/roles and all server Problems; UI does not calculate last-admin authority as the only guard.
- [ ] Run `pnpm --filter @eduscope/panel test -- src/screens/advanced/users && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s32-users`. Expected: PASS and `PASS real:s32-users`; complete role matrix green. **[KEEP B-43]**
- [ ] Commit:

```bash
git add apps/panel/src/screens/advanced/users apps/panel/e2e/s32-users.spec.ts
git commit -m "test(panel): verify real user administration"
```

---

### Task E-40: S-33 Excel import

**Files:**
- Modify: `apps/panel/src/screens/advanced/users/import/use-import.ts`
- Modify: `apps/panel/src/screens/advanced/users/import/bulk-import-overlay.test.tsx`
- Modify: `apps/panel/src/screens/advanced/users/import/rejection-report.tsx`
- Modify: `apps/panel/e2e/s33-import.spec.ts`

- [ ] Add a red real multipart witness using the committed valid/null/duplicate workbooks. Assert row-level accepted/rejected outcomes and downloaded report; log in as one accepted user and prove forced reset. Expected focused run: FAIL before real upload/login assertions.
- [ ] Unit-test FormData transport and stable row ordering; do not parse XLSX in the browser or set multipart boundaries manually.
- [ ] Run `pnpm --filter @eduscope/panel test -- src/screens/advanced/users/import && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s33-import`. Expected: PASS and `PASS real:s33-import`; accepted login/reset and all row outcomes match DB. **[KEEP B-44]**
- [ ] Commit:

```bash
git add apps/panel/src/screens/advanced/users/import apps/panel/e2e/s33-import.spec.ts
git commit -m "test(panel): verify real user import"
```

---

### Task E-41: S-34 System logs

**Files:**
- Modify: `apps/panel/src/screens/advanced/logs/use-logs.ts`
- Modify: `apps/panel/src/screens/advanced/logs/log-filters.tsx`
- Modify: `apps/panel/src/screens/advanced/logs/log-table.tsx`
- Modify: `apps/panel/src/screens/advanced/logs/logs-screen.test.tsx`
- Modify: `apps/panel/e2e/s34-logs.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] Add a red `logs=real` witness: open live view to establish scoped subscription, kill/restart one AI service, and assert a real `service:'ai'` row with rendered/filterable `context.subservice`; drop/reconnect WS and prove no duplicate. Export CSV and compare rows to active server filters. Expected focused run: FAIL before C/log scope controls.
- [ ] Unit-test DR-01 option A, cursor/live merge by log id, 200-row bound, scoped stale state, and CSV Blob/text handling.
- [ ] Run `pnpm --filter @eduscope/panel test -- src/screens/advanced/logs && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s34-logs`. Expected: PASS and `PASS real:s34-logs`; one restart row, no duplicates, CSV ids equal filtered REST ids.
- [ ] Commit:

```bash
git add apps/panel/src/screens/advanced/logs apps/panel/e2e/s34-logs.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): verify real system logs"
```

---

### Task E-42: S-36 Device & identity

**Files:**
- Modify: `apps/panel/src/screens/advanced/device/use-device-health.test.ts`
- Modify: `apps/panel/src/screens/advanced/device/use-alerts.test.ts`
- Modify: `apps/panel/src/screens/advanced/device/device-health-card.test.tsx`
- Modify: `apps/panel/src/screens/advanced/device/alert-list.test.tsx`
- Modify: `apps/panel/src/screens/advanced/device/device-identity-screen.test.tsx`
- Modify: `apps/panel/e2e/s36-device.spec.ts`
- Modify: `apps/panel/e2e/fixtures/real-stack.ts`

- [ ] Add a red real stale/watchdog witness: stop health updates past the stale threshold and assert values become “checking”; simulate two capture misses and exhaust two cycles/hour, assert camera-only reassurance and accurate attempt/failed state; acknowledge the still-true alert and prove it does not clear and later re-raises. Expected focused run: FAIL before health/watchdog controls.
- [ ] Unit-test display-only expected UUID, stale timestamps, acknowledge-vs-clear, and DIO-1 no-edit behavior.
- [ ] Run `pnpm --filter @eduscope/panel test -- src/screens/advanced/device && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs panel s36-device`. Expected: PASS and `PASS real:s36-device`; alert condition and attempt count match PM. **[KEEP B-39]**
- [ ] Commit:

```bash
git add apps/panel/src/screens/advanced/device apps/panel/e2e/s36-device.spec.ts apps/panel/e2e/fixtures/real-stack.ts
git commit -m "test(panel): verify real device health"
```

---

### Task E-43: S-37 Student join

**Files:**
- Modify: `apps/quiz/src/screens/join/use-join-resolution.ts`
- Modify: `apps/quiz/src/screens/join/join-screen.test.tsx`
- Modify: `apps/quiz/e2e/s37-join.spec.ts`
- Modify: `apps/quiz/e2e/fixtures/real-stack.ts`

- [ ] Add a red `studentQuiz=real` journey covering invalid, expired/closed, and D-unreachable codes with distinct copy; prove an existing valid participant cookie goes directly to S-39 and anonymous resolve creates no participant/database timestamp. Run `node packages/api-client/scripts/run-real-screen.mjs quiz s37-join`; expected FAIL before real D/TLS/cookie assertions.
- [ ] Unit-test real `QuizAppProblemError` codes versus `TransportError`, case-insensitive code preservation, and returning/anonymous navigation. Never store participant identity in JS.
- [ ] Run `pnpm --filter @eduscope/quiz test -- src/screens/join src/client src/config && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs quiz s37-join`. Expected: PASS and `PASS real:s37-join`; resolve row-count delta 0 and returning cookie bypasses registration.
- [ ] Commit:

```bash
git add apps/quiz/src/screens/join apps/quiz/e2e/s37-join.spec.ts apps/quiz/e2e/fixtures/real-stack.ts
git commit -m "test(quiz): swap join to real service"
```

---

### Task E-44: S-38 Registration

**Files:**
- Modify: `apps/quiz/src/screens/registration/use-registration.ts`
- Modify: `apps/quiz/src/screens/registration/registration-screen.test.tsx`
- Modify: `apps/quiz/e2e/s38-registration.spec.ts`
- Modify: `apps/quiz/e2e/fixtures/real-stack.ts`

- [ ] Add a red real race: resolve an open session, close it before submit, and assert registration refusal/no participant. In a fresh session register the same valid ID twice and assert `created` then `rejoined`, the same participant id, one DB row, and a Secure/HttpOnly/SameSite=Lax/path cookie invisible to page JS. Expected focused run: FAIL before close/rejoin/cookie inspection.
- [ ] Unit-test server registration policy/field pointers and rejoin navigation; do not add roster/SSO/password logic.
- [ ] Run `pnpm --filter @eduscope/quiz test -- src/screens/registration && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs quiz s38-registration`. Expected: PASS and `PASS real:s38-registration`; closed row delta 0, rejoin row count 1.
- [ ] Commit:

```bash
git add apps/quiz/src/screens/registration apps/quiz/e2e/s38-registration.spec.ts apps/quiz/e2e/fixtures/real-stack.ts
git commit -m "test(quiz): verify real registration and rejoin"
```

---

### Task E-45: S-39 Play

**Files:**
- Modify: `apps/quiz/src/screens/live/use-submit-answer.ts`
- Modify: `apps/quiz/src/screens/live/quiz-session-screen.test.tsx`
- Modify: `apps/quiz/src/realtime/use-student-stream.test.tsx`
- Modify: `apps/quiz/e2e/s39-play.spec.ts`
- Modify: `apps/quiz/e2e/fixtures/real-stack.ts`

- [ ] Add red real answer-vs-close tests in both server orderings plus a lost HTTP reply after D commits. Assert the first server result is final, retry returns the stored option, one answer row exists, no offline queue/timer/confirm appears, and reconnect atomically replaces the snapshot. Expected focused run: FAIL before race/reply-loss controls.
- [ ] Unit-test submitting→locked only from REST stored response/event, option-id identity, offline disabled state, and snapshot suppression of live frames while buffering. Never auto-retry an ambiguous answer.
- [ ] Run `pnpm --filter @eduscope/quiz test -- src/screens/live src/realtime src/store && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs quiz s39-play`. Expected: PASS and `PASS real:s39-play`; each race stores one immutable answer.
- [ ] Commit:

```bash
git add apps/quiz/src/screens/live apps/quiz/src/realtime/use-student-stream.test.tsx apps/quiz/e2e/s39-play.spec.ts apps/quiz/e2e/fixtures/real-stack.ts
git commit -m "test(quiz): verify real locked answering"
```

---

### Task E-46: S-40 Own result

**Files:**
- Modify: `apps/quiz/src/screens/result/result-screen.test.tsx`
- Modify: `apps/quiz/src/store/quiz-store.test.ts`
- Modify: `apps/quiz/e2e/s40-result.spec.ts`

- [ ] Add a red real reconnect test: answer, disconnect before close, close while offline, reconnect, and assert self-contained question snapshot/selection/correctness plus rank `pending→current`; recursively scan frames/DOM for every other seeded identity. Expected focused run: FAIL before offline-close/rank/privacy assertions.
- [ ] Unit-test correct/incorrect/missed and current/pending results, result clearing on next open question, and no dependency on the previous question store.
- [ ] Run `pnpm --filter @eduscope/quiz test -- src/screens/result src/store && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs quiz s40-result`. Expected: PASS and `PASS real:s40-result`; privacy scan 0 and own rank equals B dense rank.
- [ ] Commit:

```bash
git add apps/quiz/src/screens/result apps/quiz/src/store/quiz-store.test.ts apps/quiz/e2e/s40-result.spec.ts
git commit -m "test(quiz): verify real private result"
```

---

### Task E-47: S-41 Session ended

**Files:**
- Modify: `apps/quiz/src/screens/ended/ended-screen.test.tsx`
- Modify: `apps/quiz/src/screens/ended/final-own-summary.tsx`
- Modify: `apps/quiz/src/screens/ended/no-participation-message.tsx`
- Modify: `apps/quiz/e2e/s41-ended.spec.ts`
- Modify: `apps/quiz/e2e/fixtures/real-stack.ts`

- [ ] Add a red real terminal/restart witness: close sessions for one participant with answers and one without, restart D against the same PostgreSQL DB, reconnect both, and assert deterministic participated/no-participation summaries, no action/link back to play, and no stale question reopen. Expected focused run: FAIL before D restart/dual-participant controls.
- [ ] Unit-test terminal precedence over question/result, invalid direct session, and reconnect announcement without making terminal state interactive.
- [ ] Run `pnpm --filter @eduscope/quiz test -- src/screens/ended src/store && pnpm --filter @eduscope/api-client test && node packages/api-client/scripts/run-real-screen.mjs quiz s41-ended`. Expected: PASS and `PASS real:s41-ended`; terminal summaries survive restart and DB row counts do not change.
- [ ] Commit:

```bash
git add apps/quiz/src/screens/ended apps/quiz/e2e/s41-ended.spec.ts apps/quiz/e2e/fixtures/real-stack.ts
git commit -m "test(quiz): verify real terminal summaries"
```

---

## Final Workstream E Verification Tasks

The next three tasks are the master plan's final E verification sequence. They are not replaceable by mock tests, in-process-only fakes, or screenshots without the named failure injection. Do not add any implementation task after E-50.

### Task E-48: S-10 real JPEG preview acceptance

**Files:**
- Modify: `apps/panel/src/screens/sources/use-preview.ts`
- Modify: `apps/panel/src/screens/sources/use-preview.test.ts`
- Modify: `apps/panel/src/screens/sources/preview-lightbox.tsx`
- Modify: `apps/panel/src/screens/sources/preview-lightbox.test.tsx`
- Modify: `packages/api-client/test/real/preview.test.ts`
- Modify: `apps/panel/e2e/s10-preview.spec.ts`
- Create: `scripts/bench/e48-preview-acceptance.mjs`
- Create: `docs/evidence/phase-4/workstream-e/e48/e48-template.md`

**Prerequisites:** documented A-16 CPU exception and JPEG hardware result; target board running real A+B; at least presentation, camera 1, and camera 2 online; an active local recording and, where provisioned, a meeting consumer.

- [ ] **Step 1: Add red media—not merely signaling—assertions**

The real Playwright case must require `preview=real`, tap every online tile, and for each source record first-image time, two different successful image responses, one-second refresh cadence, rendered dimensions ≤480×270, and stale recovery. It fails if it sees the mock sentinel, a partial/non-JPEG image, no refresh within 2 s, or polling after close.

Run locally against the typed test track: `node packages/api-client/scripts/run-real-screen.mjs panel s10-preview`

Expected before completion: FAIL on the first missing real moving track or target-only assertion.

- [ ] **Step 2: Complete peer/screen cleanup behavior**

Bind the latest authenticated JPEG to the existing image frame, show loading/stale/error/closed states, revoke superseded object URLs, and clear the timer and current URL on close. Opening a second tile stops the first poller before creating the next. Source-offline is shown as stale after 3 s while retaining the last successful frame.

- [ ] **Step 3: Run the target-board acceptance procedure**

Run:

```bash
EDUSCOPE_PANEL_URL=http://127.0.0.1 \
EDUSCOPE_E48_EVIDENCE_DIR=docs/evidence/phase-4/workstream-e/e48 \
node scripts/bench/e48-preview-acceptance.mjs
```

The runner performs, in order:

1. login and start/attach to a real recording;
2. open every online source and collect the media measurements above;
3. open source A then B and use browser stats/track ids to prove A is closed;
4. unplug one source, assert terminal offline/error in <10 seconds, reconnect it, and obtain new motion;
5. kill only the thumbnail consumer, assert terminal/restart/re-negotiate behavior;
6. query A/B status before/after and prove recording, live, and meeting consumer ids/states were untouched;
7. scan browser logs/network for JPEG polling and direct component networking (both zero).

Expected: prints `PASS E-48 real WebRTC acceptance`, exits 0, and writes a dated evidence JSON/Markdown containing measurements/process ids only—no token, stream key, camera credential, frame image, or participant data.

- [ ] **Step 4: Run regressions and commit E-48**

Run: `pnpm --filter @eduscope/api-client test -- test/real/preview.test.ts test/mock/preview.test.ts && pnpm --filter @eduscope/panel test -- src/screens/sources && pnpm --filter @eduscope/panel build && git diff --check`

Expected: PASS; real and mock preview suites are independently green and dated E-48 evidence says PASS.

```bash
git add packages/api-client/test/real/preview.test.ts apps/panel/src/screens/sources apps/panel/e2e/s10-preview.spec.ts scripts/bench/e48-preview-acceptance.mjs docs/evidence/phase-4/workstream-e/e48
git commit -m "test(panel): accept real webrtc previews"
```

Stop if the target cannot meet visible motion <1 second; do not lower the threshold or substitute the E-15 mock checkpoint.

---

### Task E-49: S-42 Projector overlay

**Files:**
- Modify: `services/pipeline-manager/pyproject.toml`
- Modify: `services/pipeline-manager/src/pipeline_manager/pipelines/projector.py`
- Modify: `services/pipeline-manager/src/pipeline_manager/consumers/projector.py`
- Modify: `services/pipeline-manager/src/pipeline_manager/api/routes.py`
- Create: `services/pipeline-manager/src/pipeline_manager/overlays/__init__.py`
- Create: `services/pipeline-manager/src/pipeline_manager/overlays/question.py`
- Create: `services/pipeline-manager/src/pipeline_manager/resources/projector/LiberationSans-Regular.ttf`
- Create: `services/pipeline-manager/src/pipeline_manager/resources/projector/LICENSE-liberation.txt`
- Modify: `services/pipeline-manager/tests/pipelines/test_projector.py`
- Modify: `services/pipeline-manager/tests/consumers/test_projector.py`
- Create: `services/pipeline-manager/tests/overlays/test_question.py`
- Modify: `services/core-api/src/modules/recording/pm/types.ts`
- Modify: `services/core-api/src/modules/quiz/projector.ts`
- Modify: `services/core-api/test/quiz/publication.test.ts`
- Create: `services/core-api/test/integration/projector-real-stack.test.ts`
- Create: `scripts/bench/e49-projector-acceptance.mjs`
- Create: `docs/evidence/phase-4/workstream-e/e49/e49-template.md`

**Produces:** one canonical internal payload—the current B shape—accepted by A; deterministic 1920×1080 question/options/join-code/QR rendering; publish-before-project proof; no leaderboard/PII fields; same-child mode switching/restart.

- [ ] **Step 1: Pin the current mismatch with failing cross-boundary tests**

Send the exact current `PmProjectorRequest` from B to A's `ProjectorModeBody` and assert it parses. It must initially fail with 422 because A expects snake_case/pre-rendered paths. Add renderer tests for 2/3/4 options, 500-character prompt wrapping, QR decoding back to `joinUrl`, join-code text, 1920×1080 output, deterministic pixels, atomic file publication, and rejection of `leaderboard`, participant/name/student id, score, or response fields.

Run:

```bash
cd services/pipeline-manager
pytest -q tests/overlays/test_question.py tests/pipelines/test_projector.py tests/consumers/test_projector.py
```

Expected: FAIL on B payload parsing and missing complete rendered card/options.

- [ ] **Step 2: Reconcile the internal payload and renderer**

Make A accept this strict shape, matching B without a parallel DTO:

```python
class ProjectorOption(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    label: Literal["A", "B", "C", "D"]
    text: str = Field(min_length=1, max_length=300)

class QuestionOverlay(BaseModel):
    model_config = ConfigDict(extra="forbid")
    publicationId: str
    prompt: str = Field(min_length=1, max_length=500)
    options: list[ProjectorOption] = Field(min_length=2, max_length=4)
    correctOptionId: str | None = None
    joinUrl: str
    joinCode: str
```

Make the dependency/build edits mechanical and exact:

```toml
[project]
# Preserve the existing five dependencies, then add:
dependencies = [
  # ...existing FastAPI/Pydantic/PyYAML/Uvicorn entries...
  "Pillow>=10,<12",
  "qrcode>=8,<9",
]

[project.optional-dependencies]
dev = [
  # ...existing dev entries, with Pillow removed to avoid duplication...
  "zxing-cpp>=2.3,<3",
]

[tool.hatch.build]
include = [
  "src/pipeline_manager/**/*.py",
  "src/pipeline_manager/resources/**/*.json",
  "src/pipeline_manager/resources/projector/*",
]
```

Vendor the already-installed Liberation Sans font and its license only after checking the exact inputs:

```bash
sha256sum /usr/share/fonts/liberation/LiberationSans-Regular.ttf /usr/share/licenses/ttf-liberation/LICENSE
# Expected:
# baccc64becc3eb7d104b7c84d99f5314a0a1f896e2b3ea6c2f22fc08d2003bee  /usr/share/fonts/liberation/LiberationSans-Regular.ttf
# 93fed46019c38bbe566b479d22148e2e8a1e85ada614accb0211c37b2c61c19b  /usr/share/licenses/ttf-liberation/LICENSE
mkdir -p services/pipeline-manager/src/pipeline_manager/resources/projector
cp /usr/share/fonts/liberation/LiberationSans-Regular.ttf services/pipeline-manager/src/pipeline_manager/resources/projector/LiberationSans-Regular.ttf
cp /usr/share/licenses/ttf-liberation/LICENSE services/pipeline-manager/src/pipeline_manager/resources/projector/LICENSE-liberation.txt
```

If either input or digest differs, stop for dependency/license review rather than substituting an untracked system font. Application code must not shell to `qrencode`. Resolve the packaged font with `importlib.resources`; `render_question_card(payload,runtime_dir)` writes a unique same-directory temporary PNG, fsyncs, then `os.replace`s a publication-id path. Render prompt/options on the left, QR and human join code on the right, with no participant/leaderboard region. The projector worker changes one `gdkpixbufoverlay.location` and the selector pad; it never rebuilds the pipeline or changes PGID. Delete superseded generated cards through an explicit bounded cleanup owned by the consumer.

Narrow B's internal `PmProjectorRequest` question-mode `joinUrl` and `joinCode` fields from `string | null` to `string`. In both initial-send and re-project paths, load the fresh session projection and require non-null join values before calling A; a missing value raises the existing projector-failed alert and leaves/returns the display in passthrough. Do not synthesize a URL or loosen A's model to nullable fields. This keeps the one strict A/B DTO honest while changing no public v1 shape.

- [ ] **Step 3: Prove real A+B+D ordering and payload parity**

`projector-real-stack.test.ts` starts real D, real B, and an A FastAPI process with only child/display IO faked. It creates a session/question, delays D's publish ack, and asserts zero A projector call before ack. Release ack, assert A returns 202, decodes the QR to D's join URL, and produces one card. Close/withdraw and assert passthrough. Send the four forbidden privacy fields directly and assert 422. Kill A's projector child and assert its display-class restart while B's recording remains live.

Run: `pnpm --filter @eduscope/core-api test -- test/integration/projector-real-stack.test.ts test/quiz/publication.test.ts`

Expected: PASS; D ack timestamp precedes A call, B/A payload parses without translation drift, and privacy rejection count is four.

- [ ] **Step 4: Run the physical HDMI acceptance**

Run:

```bash
EDUSCOPE_PANEL_URL=http://127.0.0.1 \
EDUSCOPE_E49_EVIDENCE_DIR=docs/evidence/phase-4/workstream-e/e49 \
node scripts/bench/e49-projector-acceptance.mjs
```

The procedure publishes only after a delayed real D ack; records HDMI #1 in slides mode; checks the question, all options, join code, and phone-decodable QR; kills/restarts only projector; closes/withdraws back to slides; recursively scans A input/render metadata for leaderboard and PII; and records that no QR appears before the first publication (QO-1 exclusion). Expected: `PASS E-49 projector acceptance`, one restarted projector PGID, unchanged record/live/meeting ids, and dated evidence without question text, QR image, credential, or participant data.

- [ ] **Step 5: Run regressions and commit E-49**

Run:

```bash
cd services/pipeline-manager
pytest -q tests/overlays tests/pipelines/test_projector.py tests/consumers/test_projector.py
cd ../..
pnpm --filter @eduscope/core-api test -- test/quiz test/integration/projector-real-stack.test.ts
pnpm --filter @eduscope/api-client test
git diff --check
```

Expected: all PASS; no public contract/schema diff; dated E-49 evidence PASS.

```bash
git add services/pipeline-manager/pyproject.toml services/pipeline-manager/src/pipeline_manager/pipelines/projector.py services/pipeline-manager/src/pipeline_manager/consumers/projector.py services/pipeline-manager/src/pipeline_manager/api/routes.py services/pipeline-manager/src/pipeline_manager/overlays services/pipeline-manager/src/pipeline_manager/resources/projector services/pipeline-manager/tests services/core-api/src/modules/recording/pm/types.ts services/core-api/src/modules/quiz/projector.ts services/core-api/test/quiz/publication.test.ts services/core-api/test/integration/projector-real-stack.test.ts scripts/bench/e49-projector-acceptance.mjs docs/evidence/phase-4/workstream-e/e49
git commit -m "feat(projector): render real quiz overlays"
```

Stop on any payload mismatch, pre-ack projector switch, undecodable QR, or privacy field. Do not create a new public event/endpoint or pre-publication QR behavior.

---

### Task E-50: All-real gate

**Files:**
- Create: `deploy/runtime/config.production.json.template`
- Create: `packages/api-client/test/mixed/production-config.test.ts`
- Modify: `apps/panel/playwright.config.ts`
- Modify: `apps/quiz/playwright.config.ts`
- Create: `scripts/gate-workstream-e.mjs`
- Modify: `package.json`
- Modify: `tools/eslint-rules/no-direct-network.js`
- Create: `docs/evidence/phase-4/workstream-e/e50/e50-template.md`

**Produces:** production `{default:"real",overrides:{}}`; named mock/real Playwright projects; exact contract/domain/direct-network audits; one repeatable E gate with dated evidence.

- [ ] **Step 1: Add red production and coverage assertions**

The config template must parse after deploy token substitution and equal:

```json
{
  "apiBaseUrl": "/api/v1",
  "quizBaseUrl": "@QUIZ_PUBLIC_ORIGIN@",
  "environment": "production",
  "adapters": { "default": "real", "overrides": {} }
}
```

Tests reject every production override, omitted domain, build-time adapter env reference, direct app `fetch|WebSocket|RTCPeerConnection`, real adapter `NotImplementedError`, and mock removal. Audit totals must be 85 REST operations overall (78 panel + four server-only + three student), 22 panel events, five preview messages, four sync messages, and four student events, with exactly one contract owner and exactly one client-domain mapping where applicable.

Run: `pnpm --filter @eduscope/api-client test -- test/mixed/production-config.test.ts`

Expected: FAIL before the production template/project/gate exists.

- [ ] **Step 2: Define independent Playwright projects**

Panel and quiz configs each expose `mock` and `real` projects. `mock` runs the existing scenario suite with demo config and no backend. `real` requires the E real-stack/target URLs, intercepts only `/config.json`, asserts `{default:'real',overrides:{}}`, and fails if the scenario overlay/hotspot exists. E-48/E-49 target-only tests are included by evidence reference plus a lightweight gate check that the dated evidence hashes match committed files; they are not rerun against a simulator.

- [ ] **Step 3: Implement the gate runner with fixed phase order**

`scripts/gate-workstream-e.mjs` uses `spawn` with `shell:false`, stops on first non-zero phase, terminates children in reverse order, and prints one phase result. It runs:

1. `node scripts/check-workstream-e-prereqs.mjs`;
2. shared tests and exact ownership/count audit;
3. api-client typecheck + full mock tests + full real contract/parity tests;
4. panel/quiz typecheck and unit tests;
5. panel mock Playwright with no servers;
6. quiz mock Playwright with no servers;
7. start the real B+D/TLS stack once, then all panel real S-01…S-41 specs in master order;
8. all quiz real S-37…S-41 specs;
9. production config parse and zero-override assertion;
10. `pnpm lint`, a source scan for forbidden networking/build-time flags/`NotImplementedError`, and `git diff --check`;
11. verify committed E-48/E-49 dated evidence files/hashes and all E KEEP witnesses;
12. write the dated E-50 summary from machine outputs only.

Add root script: `"gate:e": "node scripts/gate-workstream-e.mjs"`.

- [ ] **Step 4: Execute the all-real acceptance**

Run:

```bash
EDUSCOPE_E50_EVIDENCE_DIR=docs/evidence/phase-4/workstream-e/e50 \
pnpm gate:e
```

Expected final output:

```text
PASS prerequisites
PASS contract ownership and client-domain coverage
PASS mock adapters without servers
PASS real adapters against B+D
PASS panel unit and mock Playwright
PASS quiz unit and mock Playwright
PASS panel real Playwright S-01..S-41
PASS quiz real Playwright S-37..S-41
PASS E-48 WebRTC evidence
PASS E-49 projector evidence
PASS production config and no-direct-network audit
PASS Workstream E all-real gate
```

The evidence records date/commit, Node/browser/PostgreSQL versions, config hash/redacted URLs, operation/event/domain counts, per-screen pass names, mock-independent result, direct-network violations 0, remaining `NotImplementedError` operations 0, E-48/E-49 evidence hashes, and each KEEP witness. It contains no token, password, stream key, camera credential, participant PII, question/answer text, or media frame.

- [ ] **Step 5: Final scope/ledger audit**

Run:

```bash
rg -n '^### Task E-' docs/plans/integration/workstream-e-real-adapters-and-screen-swap.md
git diff -- contracts packages/shared/src/schemas/generated packages/shared/src/schemas/quiz-generated
git status --short
git diff --check
```

Expected: E-01..E-50 exactly once and in order; no public contract/generated-schema diff; only E-50 files and dated evidence uncommitted. Confirm KEEP witnesses: B-15 E-12, B-23 E-31, B-27/B-28 E-34, B-31 E-30, B-32 E-32, B-33 E-33, B-39 E-42, B-43 E-39, B-44 E-40, B-50 E-17, B-53 E-37, B-56 E-36, B-59 E-20, and B-60 E-19.

- [ ] **Step 6: Commit E-50 and stop Workstream E**

```bash
git add deploy/runtime/config.production.json.template packages/api-client/test/mixed/production-config.test.ts apps/panel/playwright.config.ts apps/quiz/playwright.config.ts scripts/gate-workstream-e.mjs package.json tools/eslint-rules/no-direct-network.js docs/evidence/phase-4/workstream-e/e50
git commit -m "test(integration): gate all-real screen flows"
```

Stop. Do not begin Workstream F, alter deployment/device files beyond the production runtime template, or add a post-E-50 cleanup task in this plan.

---

## Scope and Coverage Audit

- E-01..E-50 appear exactly once and in master order; no task, domain, contract owner, or KEEP assignment is added/dropped/reassigned.
- E-01..E-06 are the six adapter-foundation tasks. E-07..E-47 are the ordered panel/student screen swaps. E-48 real WebRTC, E-49 projector overlay, and E-50 all-real gate are the final master verification sequence.
- E owns zero public contract elements. The plan consumes 78 panel operations, three student operations, 22 panel events, five preview messages, and four student events; the four quiz-sync operations remain browser-excluded.
- Mock regression is explicit in every task through the api-client suite and independently executable in E-06/E-50.
- The master plan was updated in this planning run for upstream gate evidence, the stale E-44→E-49 QO-1 reference, and the real A/B projector payload mismatch. E-49 resolves the internal interface without changing public v1.
- D-02b, QO-1 pre-publication QR, D-10 room hardware, DIO-1 editing, and retention-period decisions remain excluded exactly as the master requires.
