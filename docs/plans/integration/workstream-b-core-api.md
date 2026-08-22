# Workstream B — core-api Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the localhost Fastify/TypeScript core-api that owns all device-side state, persists it crash-safely in SQLite/Drizzle, implements the 78 B-owned v1 REST operations and 22 panel events, brokers preview signaling, and acts as the outbound AI/quiz client.

**Architecture:** One Fastify 5 process binds `127.0.0.1:5000`. Feature plugins share a single `better-sqlite3`/Drizzle connection, per-machine serial executors, a typed in-process domain bus, and one pipeline-manager SSE bridge; long-running media, copy, merge, probe, and upload work stays outside transactions. Public payloads are parsed with the existing `@eduscope/shared` v1 zod schemas, while pipeline-manager, AI, quiz-sync, helper, filesystem, and clock boundaries are injected so every task is testable without hardware or future workstreams.

**Tech Stack:** Node.js 22 LTS, TypeScript strict ESM, Fastify 5, Zod 3, SQLite WAL via `better-sqlite3`, Drizzle ORM/Kit, Vitest 3, Argon2id, JWT access tokens plus opaque rotating refresh tokens, Pino, WebSocket/SSE, ffmpeg/ffprobe argv workers, ExcelJS.

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

### Workstream-specific gates and fixed decisions

- Contract baseline is exactly `contracts/openapi.yaml`, `contracts/quiz-app.yaml`, and `contracts/events.md`, all v1.0.0. Generated zod under `packages/shared/src/schemas/generated/` is never hand-edited.
- Do not execute B until the Workstream A hardware gate accepts A-15/A-16 evidence and the A-03 catalog correction. Planning and fake-backed tests do not waive that dependency.
- Before B-24 or B-38 executes, the master-plan **WORKSTREAM B GATE FLAG — pipeline-manager encoder-profile ingress drift (2026-08-18)** must be acknowledged and the A-owned internal correction must be present. B sends `{videoBitrateBps, fps, gop, rateControl, audioBitrateBps}` on record/live starts; passthrough pipelines ignore the profile by design.
- B-18 implements only the pluggable queue plus the local placeholder adapter. The institute payload remains the D-02b boundary and is not inferred.
- Upload is immediate with no time-window state. Retention uses 14 days, uploaded-oldest-first pressure deletion, never deletes unuploaded media, refuses starts at critical pressure, and gracefully stops at the 4 GiB floor.
- Panel WS authentication uses only `Sec-WebSocket-Protocol`; query-string tokens are rejected. Quiz-sync uses the provisioned static bearer and `x-eduscope-contract: 1.0`.
- No frontend adapter is implemented in this workstream. B-38 runs the existing shared/mock regressions; Workstream E owns the real `packages/api-client` adapter.
- All subprocesses use executable-plus-argv APIs (`spawn`/`execFile`) with `shell: false`. Tests include a forbidden-pattern scan for `sudo`, `execSync`, `shell: true`, `killall`, `pkill`, and command-string interpolation.

### Repository and test conventions

- Run commands from repository root unless a step says otherwise.
- Every task follows red → green → contract regression → commit. Expected `PASS` means exit code 0, every named assertion green, and no unhandled rejection/open-handle warning.
- Use temporary directories and injected fakes in tests. No test writes `/var/lib`, `/media`, `/run`, or a real block device.
- `/run/eduscope/helper.sock` is a production default, never a test bind target. Helper unit tests inject an in-memory transport; the POSIX framing test binds an AF_UNIX socket below a temp directory and is explicitly skipped on Windows with the reason `AF_UNIX filesystem socket coverage runs on Linux`.
- Use ISO-8601 UTC instants with explicit `+00:00`, ULIDs from `ulidx`, integer milliseconds/bytes, and typed JSON columns validated by zod before insert and after select.
- Drizzle queries are parameterized; JSON columns use explicit `$type<...>()`; multi-row state changes are transactions; partial unique indexes are emitted in committed SQL and exercised against real SQLite.
- Each future commit stages only the files listed by its task plus generated lockfile changes caused by that task.

## File and Responsibility Map

| Path | Responsibility |
|---|---|
| `services/core-api/src/app.ts`, `server.ts`, `config.ts` | Composition root, localhost listener, validated process configuration, lifecycle ordering. |
| `services/core-api/src/contracts/*` | Route metadata, v1 version checks, zod request/response helpers, Problem mapping; no duplicate schemas. |
| `services/core-api/src/db/*`, `migrations/*` | SQLite connection/PRAGMAs, Drizzle schema, serial write funnel, migrations/seeds. |
| `services/core-api/src/lib/*` | Clock/ULID seams, typed domain bus, serial executor, argv worker, cursor helper, helper-socket client, secret store. |
| `services/core-api/src/modules/auth/*`, `users/*` | AuthSession/JWT/refresh/password lifecycle and admin user/import surface. |
| `services/core-api/src/modules/recording/*`, `channels/*`, `sources/*` | Machines 1a/1c/5a, pipeline-manager bridge, recovery, segment ledger. |
| `services/core-api/src/modules/library/*`, `export/*` | Machine 1b, authenticated media, USB discovery/copy jobs, retention deletion entry point. |
| `services/core-api/src/modules/uploads/*` | Machines 3a/3b, durable scheduler and D-02b-safe adapter interface. |
| `services/core-api/src/modules/storage/*`, `device/*`, `firmware/*` | Machine 5b projections, volumes, health, alerts, power, updater orchestration. |
| `services/core-api/src/modules/settings/*`, `relay/*` | Typed source/channel/network/encoder/stream-target settings and secret-safe relay rendering. |
| `services/core-api/src/modules/ai/*`, `quiz/*` | Machines 2a–2d/4a/4d, internal AI clients, projector ordering, quiz-sync client/read models. |
| `services/core-api/src/modules/ws/*` | Authenticated panel event fan-out, snapshots/scoping/backpressure, preview signaling broker. |
| `services/core-api/src/modules/observability/*` | Curated product logs, audit mirror, query and CSV export. |
| `services/core-api/test/fakes/*` | Exact fake pipeline-manager, AI services, quiz-service, helper socket, block devices, clock, files and workers. |
| `services/core-api/test/contract/*` | v1 version/operation/event ownership and per-route success/Problem shape tests. |
| `services/core-api/test/integration/*`, `scripts/gate-core-api.mjs` | Cross-module restart flows and the final B-38 executable gate. |

### Composition-root lifecycle ownership

`buildApp()` owns one `LifecycleRegistry`. Migrations and seeds finish before any component starts. Components register a start callback and an idempotent stop callback as their owning task lands; `app.close()` stops them in reverse registration order, then closes SQLite last. `server.ts` maps `SIGTERM` and `SIGINT` to the same once-only `app.close()` promise and sets a non-zero exit code if teardown fails.

| Task | Component wired in `src/app.ts` | Graceful-stop obligation |
|---|---|---|
| B-04 | Pipeline-manager SSE bridge | Abort its SSE/reconnect waits; do not issue a PM consumer stop. |
| B-13 | Artifact executor | Stop accepting domain events, abort the argv worker, and leave durable work recoverable on restart. |
| B-16 | USB export executor | Stop accepting jobs, abort an active copy, remove only its partial target, and persist the interrupted job honestly. |
| B-17/B-18 | Upload scheduler plus injected adapter | Inject the adapter before starting the scheduler; stop intake, persist the latest acknowledged checkpoint, then abort transfer. |
| B-19/B-21/B-29/B-37 | Probe, health, countdown, and rotation timers | Cancel timers and clock waits. |
| B-34 | Quiz-sync client | Persist the last acknowledged watermark, then close heartbeat/socket work. |
| B-35/B-36 | Panel WS hub and preview broker | Stop upgrades, close active sockets/peer negotiations, and reject new work. |
| B-38 | Whole service | Prove reverse-order teardown, SQLite-last, PM recording survival/adoption, upload resume, and zero open handles. |

---

### Task B-01: Service skeleton and contract harness

**Files:**
- Create: `services/core-api/package.json`
- Create: `services/core-api/tsconfig.json`
- Create: `services/core-api/vitest.config.ts`
- Create: `services/core-api/src/config.ts`
- Create: `services/core-api/src/contracts/problem.ts`
- Create: `services/core-api/src/contracts/validate.ts`
- Create: `services/core-api/src/lib/clock.ts`
- Create: `services/core-api/src/lib/ids.ts`
- Create: `services/core-api/src/lifecycle.ts`
- Create: `services/core-api/src/app.ts`
- Create: `services/core-api/src/server.ts`
- Create: `services/core-api/test/fakes/clock.ts`
- Create: `services/core-api/test/unit/clock.test.ts`
- Create: `services/core-api/test/unit/config.test.ts`
- Create: `services/core-api/test/unit/lifecycle.test.ts`
- Create: `services/core-api/test/contract/harness.ts`
- Create: `services/core-api/test/contract/version.test.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml` (generated by `pnpm install`)

**Interfaces:**
- Produces: `loadConfig(env): CoreConfig`; `Clock`; `IdGenerator`; `LifecycleRegistry`; `buildApp(deps?): Promise<FastifyInstance>`; `ProblemError`; `parseBody(schema, value)`; `assertV1Contracts()`.
- Consumes: `@eduscope/shared` zod schemas and constants; the three repository contract files.

- [ ] **Step 1: Add the failing boot/config/version tests**

`config.test.ts` must prove default host/port are `127.0.0.1:5000`, non-loopback host is rejected, production secrets shorter than 32 characters are rejected, and test paths may point at a temp directory. `clock.test.ts` proves fixed wall time, deterministic timer advancement, and deterministic monotonically ordered ULIDs. `lifecycle.test.ts` proves starts run in registration order, stops run once in reverse order, a partial-start failure stops only components that started, a second shutdown awaits the same promise, and DB close is registered first so it runs last. `version.test.ts` must read both YAML files, assert `info.version: 1.0.0`, assert events contains `Contract **v1.0.0**`, parse one `zEventEnvelope`, and assert `PANEL_OPERATION_IDS.length === 78`, `SERVER_SIDE_ONLY_OPERATION_IDS.length === 4`, and `PANEL_EVENT_NAMES.length === 22`.

- [ ] **Step 2: Run the tests to verify the service is absent**

Run: `pnpm --filter @eduscope/core-api test -- test/unit/config.test.ts test/unit/clock.test.ts test/unit/lifecycle.test.ts test/contract/version.test.ts`

Expected: FAIL because workspace package `@eduscope/core-api` does not exist.

- [ ] **Step 3: Add the mechanical service configuration**

Use this package shape (the install command writes exact resolved versions to `pnpm-lock.yaml`):

```json
{
  "name": "@eduscope/core-api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.13" },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:contract": "vitest run test/contract",
    "gate": "pnpm typecheck && pnpm test"
  },
  "dependencies": {
    "@eduscope/shared": "workspace:*",
    "@fastify/jwt": "^9",
    "@fastify/multipart": "^9",
    "@fastify/websocket": "^11",
    "argon2": "^0.44",
    "better-sqlite3": "^12",
    "drizzle-orm": "^0.44",
    "exceljs": "^4.4",
    "fastify": "^5",
    "libsodium-wrappers": "^0.7",
    "ulidx": "^2.4",
    "ws": "^8",
    "zod": "^3.23"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6",
    "@types/libsodium-wrappers": "^0.7",
    "@types/node": "^22.9",
    "@types/ws": "^8.5",
    "drizzle-kit": "^0.31",
    "tsx": "^4.20",
    "typescript": "^5.6",
    "vitest": "^3"
  }
}
```

Add `services/core-api` as the third explicit workspace glob. `tsconfig.json` extends `../../tsconfig.base.json`, sets `rootDir` to `.`, `noEmit: true`, `types: ["node"]`, and includes `src`, `test`, and `vitest.config.ts`. `vitest.config.ts` uses Node, includes `test/**/*.test.ts`, and enables `restoreMocks`, `clearMocks`, and a 10-second default timeout.

`CoreConfig` must include localhost host/port, DB path, recordings root, runtime dir, provisioning path, helper socket, pipeline-manager base URL `http://127.0.0.1:8091`, internal bearer, JWT key, secretbox key, and test-injectable access/refresh TTLs. `Clock` owns `now()`, cancellable sleeps/timers, and deterministic test advancement; `IdGenerator.next(now)` is the only ULID creation boundary. `LifecycleRegistry` starts in registration order and stops once in reverse order. `buildApp()` accepts injected `{clock, ids}` defaults, owns that registry, installs one error handler that converts `ProblemError` and `ZodError` to `application/problem+json`, registers public `GET /healthz → {status:"ok",contractVersion:"1.0.0"}`, and attaches registry shutdown to Fastify `onClose`. `server.ts` loads config, builds the app, awaits lifecycle startup, listens only on the validated host, and installs once-only `SIGTERM`/`SIGINT` handlers that await `app.close()`.

Use these stable seams; later tasks consume them instead of calling `Date.now()`, `setTimeout()`, or `ulid()` directly:

```ts
export interface Cancel { cancel(): void; }
export interface Clock {
  now(): Date;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  every(ms: number, run: () => void): Cancel;
}
export interface IdGenerator { next(now: Date): string; }
export interface LifecycleComponent {
  readonly name: string;
  start(): Promise<void>;
  stop(reason: 'shutdown' | 'startup-failed'): Promise<void>;
}
```

- [ ] **Step 4: Install and prove the slice green**

Run: `pnpm install`

Expected: PASS; lockfile records the new workspace and dependencies.

Run: `pnpm --filter @eduscope/core-api typecheck`

Expected: PASS with no diagnostics.

Run: `pnpm --filter @eduscope/core-api test -- test/unit/config.test.ts test/unit/clock.test.ts test/unit/lifecycle.test.ts test/contract/version.test.ts`

Expected: PASS; clock/ULID and idempotent reverse teardown are deterministic, and 78/4/22 counts plus all v1 version assertions are green.

Run: `pnpm --filter @eduscope/shared test`

Expected: PASS; generated contract layer remains unchanged.

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml services/core-api
git commit -m "feat(core-api): add v1 service skeleton"
```

---

### Task B-02: SQLite/Drizzle foundation

**Files:**
- Create: `services/core-api/drizzle.config.ts`
- Create: `services/core-api/src/db/schema.ts`
- Create: `services/core-api/src/db/client.ts`
- Create: `services/core-api/src/db/migrate.ts`
- Create: `services/core-api/src/db/writer.ts`
- Create: `services/core-api/src/db/seeds.ts`
- Create: `services/core-api/migrations/0001_base.sql`
- Create: `services/core-api/migrations/meta/_journal.json`
- Create: `services/core-api/test/db/migrations.test.ts`
- Create: `services/core-api/test/db/invariants.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: `openDatabase(path): CoreDatabase`; `migrate(db)`; `seed(db, now)`; `SerialWriter.run<T>(label, fn): Promise<T>`; Drizzle table exports.
- Consumes: `CoreConfig.dbPath`, B-01 `Clock`/`IdGenerator`, shared entity types, shared layout catalog.

- [ ] **Step 1: Write real-SQLite failing tests**

Use a temp DB and inject B-01's fake clock/ids. Assert PRAGMAs are `journal_mode=wal`, `foreign_keys=1`, `synchronous=1` (`NORMAL`), `busy_timeout=5000`; migrations can be called twice; seed counts are 5 source roles, 7 layout presets, 3 channel configs, 4 physical-input skeletons/bindings, one retention policy, and one device-default encoding profile. Race two writes for each of four constraints and prove exactly one contender loses: a second non-terminal `lecture_sessions.device_id`, a second showing publication per quiz session, a second mounted recordings volume, and a second upload job per recording. Also prove direct duplicate inserts fail for `quiz_session_projections.lecture_session_id`, `storage_volumes.uuid`, upload parts, and answer projections.

- [ ] **Step 2: Run the DB tests to verify they fail**

Run: `pnpm --filter @eduscope/core-api test -- test/db/migrations.test.ts test/db/invariants.test.ts`

Expected: FAIL because `openDatabase`, migrations, and tables do not exist.

- [ ] **Step 3: Implement the complete base schema and serial writer**

Create every table named by `core-api.md` §3.2: `users`, `auth_sessions`, `user_import_batches`, `lecture_sessions`, `recordings`, `recording_segments`, `recording_files`, `export_jobs`, `upload_jobs`, `upload_file_parts`, `retention_policy`, `device_health`, `storage_volumes`, `network_configs`, `source_roles`, `physical_inputs`, `source_bindings`, `audio_controls`, `encoding_profiles`, `layout_presets`, `channel_configs`, `stream_targets`, `firmware_updates`, `transcript_segments`, `slide_captures`, `question_sets`, `questions`, `question_options`, `question_publications`, `quiz_session_projections`, `answer_projections`, `log_entries`, `system_alerts`, and `audit_log_entries`. Use snake_case SQL columns, contract enum CHECKs, foreign keys, and the indexes listed in design §3.2. Store booleans as integer boolean mode, byte/duration values as integer bigint mode, and JSON as text with typed Drizzle columns plus zod validation at repository boundaries.

The committed SQL must contain these load-bearing constraints verbatim in effect:

```sql
CREATE UNIQUE INDEX one_active_session ON lecture_sessions(device_id)
WHERE state IN ('starting','recording','paused','stopping','finalizing');
CREATE UNIQUE INDEX one_showing_publication ON question_publications(quiz_session_id)
WHERE is_showing = 1;
CREATE UNIQUE INDEX one_recordings_volume ON storage_volumes(role)
WHERE role = 'recordings' AND state = 'mounted';
CREATE UNIQUE INDEX one_upload_job_per_recording ON upload_jobs(recording_id);
CREATE UNIQUE INDEX one_part_per_file ON upload_file_parts(upload_job_id, recording_file_id);
CREATE UNIQUE INDEX one_answer_projection ON answer_projections(publication_id, student_id_number);
CREATE UNIQUE INDEX one_quiz_projection_per_lecture ON quiz_session_projections(lecture_session_id);
CREATE UNIQUE INDEX one_storage_volume_per_uuid ON storage_volumes(uuid);
```

`SerialWriter` is the only asynchronous write entry point:

```ts
export class SerialWriter {
  #tail: Promise<void> = Promise.resolve();

  run<T>(label: string, work: () => T): Promise<T> {
    const result = this.#tail.then(() => work(), () => work());
    this.#tail = result.then(() => undefined, () => undefined);
    return result.catch((error: unknown) => {
      throw new Error(`database write failed: ${label}`, { cause: error });
    });
  }
}
```

Migrations run before route registration/listen and abort startup on failure. `app.ts` passes `clock.now()` into `seed`, uses `IdGenerator` wherever seeds need ids, and registers DB close first in B-01's lifecycle so it executes last. Long work must never execute inside `db.transaction()`.

- [ ] **Step 4: Run DB, type, and contract regressions**

Run: `pnpm --filter @eduscope/core-api test -- test/db/migrations.test.ts test/db/invariants.test.ts`

Expected: PASS; second migration run is a no-op, all four named races reject exactly one contender, and the two additional design-level unique keys reject direct duplicates.

Run: `pnpm --filter @eduscope/core-api typecheck`

Expected: PASS.

Run: `pnpm --filter @eduscope/core-api test:contract`

Expected: PASS; v1 remains 1.0.0.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): add sqlite drizzle foundation"
```

---

### Task B-03: Auth/session routes

**Files:**
- Create: `services/core-api/src/modules/auth/passwords.ts`
- Create: `services/core-api/src/modules/auth/tokens.ts`
- Create: `services/core-api/src/modules/auth/service.ts`
- Create: `services/core-api/src/modules/auth/guard.ts`
- Create: `services/core-api/src/modules/auth/routes.ts`
- Create: `services/core-api/test/auth/auth.test.ts`
- Create: `services/core-api/test/contract/auth.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: `AuthContext { userId, authSessionId, role, mustResetPassword }`; `requireAuth`; five operationIds: `login`, `refreshToken`, `logout`, `getMe`, `changePassword`.
- Consumes: users/auth_sessions tables, `SerialWriter`, Argon2id, Fastify JWT, shared auth zod schemas.

- [ ] **Step 1: Write failing auth lifecycle and contract tests**

Cover local/institute-source-with-local-hash login, invalid credentials, `auth.account-disabled`, Argon2id verification, 10-minute access claims `{sub,role,sid}` only, hashed opaque refresh tokens, one-time rotation, logout revocation, forced-reset allowlist (`me`, change-password, logout only), CG-12 password composition, disabled/deleted-user revocation after restart, and every declared success/Problem schema.

- [ ] **Step 2: Prove the tests fail before routes exist**

Run: `pnpm --filter @eduscope/core-api test -- test/auth/auth.test.ts test/contract/auth.contract.test.ts`

Expected: FAIL with 404 for `/api/v1/auth/login`.

- [ ] **Step 3: Implement the minimal persistent auth service**

Hash passwords with Argon2id; hash refresh tokens with SHA-256 before storage; rotate by transactionally revoking the prior session/token and issuing a replacement; load `AuthSession` and `User` on every authenticated request. `logout` is idempotent. Never select `password_hash` in user response queries. Convert all errors to contract `Problem` codes and add `config.operationId` metadata to each route.

- [ ] **Step 4: Run focused, full-core, and mock contract tests**

Run: `pnpm --filter @eduscope/core-api test -- test/auth/auth.test.ts test/contract/auth.contract.test.ts`

Expected: PASS; restart fixture preserves valid sessions and revocations.

Run: `pnpm --filter @eduscope/api-client test -- gate-contract-coverage.test.ts`

Expected: PASS; mock still implements all 78 operations.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): implement persistent auth sessions"
```

---

### Task B-04: Domain bus and pipeline-manager bridge

**Files:**
- Create: `services/core-api/src/lib/domain-bus.ts`
- Create: `services/core-api/src/lib/reconnect.ts`
- Create: `services/core-api/src/modules/recording/pm/types.ts`
- Create: `services/core-api/src/modules/recording/pm/client.ts`
- Create: `services/core-api/src/modules/recording/pm/sse.ts`
- Create: `services/core-api/src/modules/recording/pm/dispatcher.ts`
- Create: `services/core-api/test/fakes/pipeline-manager.ts`
- Create: `services/core-api/test/recording/pm-bridge.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: `DomainBus.publish(event)`/`subscribe(type, listener)`; `PipelineManagerClient`; one `PipelineManagerBridge.start()/stop()`; typed `PmStatus` and `PmEvent` unions matching current A code.
- Consumes: current A routes `/status`, `/sources`, `/events`, publisher/binding/consumer/audio/LED/thumbnail endpoints and shared internal bearer.

- [ ] **Step 1: Write failing reconnect/resync/duplicate tests**

The fake must expose A's exact current shapes and record calls. Prove one SSE connection, monotonically applied A `seq`, `Last-Event-ID` replay where available, forced `/status` read on initial connect and reconnect, duplicate event suppression, 1/3/8-second reconnect backoff with fake clock, bearer redaction, and clean shutdown.

- [ ] **Step 2: Run the bridge test and see missing imports**

Run: `pnpm --filter @eduscope/core-api test -- test/recording/pm-bridge.test.ts`

Expected: FAIL because the bus/client/bridge are undefined.

- [ ] **Step 3: Implement typed HTTP/SSE wrappers and dispatcher**

Use Node `fetch` plus a line-buffered SSE parser; no generic HTTP client abstraction beyond this internal boundary. The dispatcher publishes internal typed events, never public WS payloads directly. On any parse error or reconnect it marks projections unknown, reads `/status`, then resumes deltas. Keep credentials out of diagnostics by logging only route, status, event name, and redacted ids.

- [ ] **Step 4: Verify restart convergence and regressions**

Run: `pnpm --filter @eduscope/core-api test -- test/recording/pm-bridge.test.ts`

Expected: PASS; killing/restarting the fake causes exactly one resync and no duplicate domain transition.

Run: `pnpm --filter @eduscope/core-api test:contract`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): bridge pipeline manager events"
```

---

### Task B-05: Recording start/read executor

**Files:**
- Create: `services/core-api/src/lib/serial-executor.ts`
- Create: `services/core-api/src/modules/recording/guards.ts`
- Create: `services/core-api/src/modules/recording/machine.ts`
- Create: `services/core-api/src/modules/recording/executor.ts`
- Create: `services/core-api/src/modules/recording/routes.ts`
- Create: `services/core-api/src/modules/recording/snapshots.ts`
- Create: `services/core-api/test/recording/start.test.ts`
- Create: `services/core-api/test/contract/recording-start.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: machine-1a `RecordingExecutor.enqueue(command)` as the only lecture-session state writer; `getRecordingState`, `startRecording`; `recording.state` payloads.
- Consumes: `PipelineManagerClient`, provisioning/storage/channel reads, DB writer, DomainBus, `TIMERS['T-START-CONFIRM']`.

- [ ] **Step 1: Write failing R-01..R-07 tests**

Test every Class-A guard creates no session, successful start creates session+recording in one transaction, title uses provisioning pattern, source/channel snapshots are immutable, PM gets deterministic segment-0 paths, 202 matches `zCommandAccepted`, state remains `starting` until matching PM confirmation, confirm opens segment 0 and emits contract-valid `recording.state`, timeout/failure maps to R-06 or R-07, and a required unplugged source never creates a phantom row. Include **KEEP B-03** restart persistence.

- [ ] **Step 2: Run the focused tests and verify 404/undefined executor**

Run: `pnpm --filter @eduscope/core-api test -- test/recording/start.test.ts test/contract/recording-start.contract.test.ts`

Expected: FAIL because recording routes are not registered.

- [ ] **Step 3: Implement the minimal R-01..R-07 slice**

Use a dedicated `SerialExecutor<RecordingCommand>`. Route handlers run synchronous guards, enqueue accepted commands, and return immediately; only executor/PM-event handlers write machine state. Generate paths as `<recordingsRoot>/sessions/<sessionId>/seg-000.ts` or per-layout output key, never parse filenames. Emit through `DomainBus` only after the DB transaction commits.

- [ ] **Step 4: Verify contract deadline and persistence**

Run: `pnpm --filter @eduscope/core-api test -- test/recording/start.test.ts test/contract/recording-start.contract.test.ts`

Expected: PASS; 202 precedes confirmation and timeout resolves within fake 5 seconds.

Run: `pnpm --filter @eduscope/api-client test -- gate-contract-coverage.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): execute recording start state"
```

---

### Task B-06: Pause/resume/stop and segment ledger

**Files:**
- Create: `services/core-api/src/modules/recording/segments.ts`
- Create: `services/core-api/src/modules/recording/recovery.ts`
- Create: `services/core-api/test/recording/lifecycle.test.ts`
- Create: `services/core-api/test/contract/recording-commands.contract.test.ts`
- Modify: `services/core-api/src/modules/recording/machine.ts`
- Modify: `services/core-api/src/modules/recording/executor.ts`
- Modify: `services/core-api/src/modules/recording/routes.ts`

**Interfaces:**
- Produces: `pauseRecording`, `resumeRecording`, `stopRecording`; segment open/close helpers; `recording.segment` events.
- Consumes: B-05 executor/session rows and PM `eos`/failure events.

- [ ] **Step 1: Write failing R-08..R-15 and SEG-1..SEG-7 tests**

Assert owner/admin guards, idempotent repeated commands, pause calls exact consumer with `{mode:'eos',timeoutMs:5000}`, timeout marks truncated, resume uses `seg-NNN` and 3-second confirmation, stop uses 8000 ms, indices are contiguous and ordered only by `index`, separate-files creates one file row per output per segment, durations sum without pause gaps, channels remain running while paused, and restart while paused remains resumable. Cover **KEEP B-07/B-10**.

- [ ] **Step 2: Run tests to expose missing transitions**

Run: `pnpm --filter @eduscope/core-api test -- test/recording/lifecycle.test.ts test/contract/recording-commands.contract.test.ts`

Expected: FAIL because pause/resume/stop are 404 or unsupported commands.

- [ ] **Step 3: Implement transitions and segment transactions**

Open exactly one segment on each confirmed entry to `recording`; close exactly one on each departure. PM EOS and timer callbacks re-enter the same serial executor. Stop disarms AI/quiz through domain commands but does not call their route handlers. Persist end reason/state before public events.

- [ ] **Step 4: Verify lifecycle and contract events**

Run: `pnpm --filter @eduscope/core-api test -- test/recording/lifecycle.test.ts test/contract/recording-commands.contract.test.ts`

Expected: PASS; pause/resume/stop yields split, ordered files and valid events.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): persist recording segments"
```

---

### Task B-07: Recorder lock, takeover, and boot recovery

**Files:**
- Create: `services/core-api/src/modules/recording/authority.ts`
- Create: `services/core-api/src/modules/recording/boot-recovery.ts`
- Create: `services/core-api/test/recording/authority.test.ts`
- Create: `services/core-api/test/recording/boot-recovery.test.ts`
- Create: `services/core-api/test/contract/takeover.contract.test.ts`
- Modify: `services/core-api/src/modules/recording/routes.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: `takeoverRecording`; `runBootRecovery(firstPmStatus)`; immediate takeover session revocation.
- Consumes: B-03 auth sessions, B-05/B-06 state/segments, PM status/adoption data, BR-1..BR-9.

- [ ] **Step 1: Write failing authority and BR decision-table tests**

Cover user A lock, user B refusal, admin takeover preserving original owner while setting takeover fields/display name and revoking displaced AuthSession, and all BR-1..BR-9 rows with fake boot/heartbeat times. Require recovery after first PM snapshot and within 20 seconds. Include **KEEP B-15**.

- [ ] **Step 2: Run and observe missing takeover/recovery**

Run: `pnpm --filter @eduscope/core-api test -- test/recording/authority.test.ts test/recording/boot-recovery.test.ts test/contract/takeover.contract.test.ts`

Expected: FAIL because takeover route and boot pass do not exist.

- [ ] **Step 3: Implement server authority and idempotent recovery**

Recovery commands enter the recording executor; never mutate state from startup code. BR-1 adopts without opening a segment; BR-2 closes the crashed segment then opens a recovery start; BR-3/5/6 finalize; BR-4 stays paused; BR-7 re-enters artifact work; BR-8 refuses resume; BR-9 preserves newest and finalizes extras.

- [ ] **Step 4: Verify restart behavior**

Run: `pnpm --filter @eduscope/core-api test -- test/recording/authority.test.ts test/recording/boot-recovery.test.ts test/contract/takeover.contract.test.ts`

Expected: PASS; every BR row produces exactly one expected state/event sequence.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): recover and take over recordings"
```

---

### Task B-08: Channel runtime machine

**Files:**
- Create: `services/core-api/src/modules/channels/machine.ts`
- Create: `services/core-api/src/modules/channels/runtime-routes.ts`
- Create: `services/core-api/test/channels/runtime.test.ts`
- Create: `services/core-api/test/contract/channel-runtime.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: machine-1c executor; `enableChannel`, `disableChannel`; `channel.state` events.
- Consumes: PM live/meeting start/stop, session/channel config, authority checks, CH-01..CH-10.

- [ ] **Step 1: Write failing channel transition tests**

Test local cannot be toggled, idle enable returns `session.not-active`, streaming preflight ordering, meeting direct start, six-second confirm failure, isolated stop/restart, owner/admin guard, three-attempt restart budget, and paused recording leaving configured channels on. Contract-parse every runtime state.

- [ ] **Step 2: Run the tests to verify missing routes**

Run: `pnpm --filter @eduscope/core-api test -- test/channels/runtime.test.ts test/contract/channel-runtime.contract.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement the serial machine-1c executor**

Keep one runtime record per meeting/streaming channel in memory plus activation history in the active session row. Enable/disable only the addressed PM consumer. Streaming activates relay targets before PM live start; disable removes targets after PM exit. Publish events only from state transitions.

- [ ] **Step 4: Verify isolation**

Run: `pnpm --filter @eduscope/core-api test -- test/channels/runtime.test.ts test/contract/channel-runtime.contract.test.ts`

Expected: PASS; killing meeting changes only meeting state while recording remains `recording`.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): manage channel runtimes"
```

---

### Task B-09: Source/telemetry projection

**Files:**
- Create: `services/core-api/src/modules/sources/status.ts`
- Create: `services/core-api/src/modules/sources/telemetry.ts`
- Create: `services/core-api/src/modules/sources/routes.ts`
- Create: `services/core-api/test/sources/projection.test.ts`
- Create: `services/core-api/test/contract/sources-status.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: `SourceProjection.observePmEvent()/snapshot()`; `getSourcesStatus`; `sources.status` and `audio.levels` events.
- Consumes: PM publisher/status/audio events, binding/input rows, `T-SOURCE-*` and `T-HEALTH-STALE`.

- [ ] **Step 1: Write failing HL-01..HL-09 and telemetry tests**

Use a fake monotonic clock to prove unbound, 3-second healthy debounce, 2-second degraded threshold, 10-second offline threshold, 6-second stale→unknown, rebind→unknown/reprobe, and stale never retains the last healthy value. Prove audio RMS is clamped to 0–1, coalesced to ≤10 Hz, and the PM level subscription is absent with zero panel subscribers.

- [ ] **Step 2: Run and observe missing projection**

Run: `pnpm --filter @eduscope/core-api test -- test/sources/projection.test.ts test/contract/sources-status.contract.test.ts`

Expected: FAIL because `/api/v1/sources/status` is unregistered.

- [ ] **Step 3: Implement one in-memory projection with persisted input presence**

Reduce all PM status/deltas through one function, persist `physical_inputs.presence_state` after a transition, and publish the same snapshot used by REST. Use one cancellable timer per role; never poll when an event can resolve the timer.

- [ ] **Step 4: Verify REST/WS convergence**

Run: `pnpm --filter @eduscope/core-api test -- test/sources/projection.test.ts test/contract/sources-status.contract.test.ts`

Expected: PASS; unplug/replug converges REST and emitted events and stale reads `unknown`.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): project source health telemetry"
```

---

### Task B-10: Channel/layout configuration

**Files:**
- Create: `services/core-api/src/modules/settings/channel-routes.ts`
- Create: `services/core-api/src/modules/settings/layouts.ts`
- Create: `services/core-api/test/settings/channels.test.ts`
- Create: `services/core-api/test/contract/channel-settings.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: `listChannels`, `updateChannelConfig`, `listLayoutPresets`; `resolveLayout(channelId,presetId,ratios)`.
- Consumes: seeded channel/layout rows and `packages/shared/src/constants/layout-presets.json` projection.

- [ ] **Step 1: Write failing seed/read/validation tests**

Assert exactly local/meeting/streaming; exact v1 allowed preset matrix; local always-on cannot change; parametric ratios are both present and positive; required roles are bound/enabled; stream targets apply only to streaming; invalid combinations return named Problems.

- [ ] **Step 2: Run and verify the settings routes are absent**

Run: `pnpm --filter @eduscope/core-api test -- test/settings/channels.test.ts test/contract/channel-settings.contract.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement table-backed settings and shared-catalog projection**

Do not copy geometry into TypeScript constants. Seed migration owns the DB rows, while a freshness test compares them field-for-field with the shared catalog. Updating config never changes a running channel; runtime commands use a snapshot when enabled.

- [ ] **Step 4: Verify v1 catalog parity**

Run: `pnpm --filter @eduscope/core-api test -- test/settings/channels.test.ts test/contract/channel-settings.contract.test.ts`

Expected: PASS; meeting rejects `pc-only` and all success responses parse.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): configure channels and layouts"
```

---

### Task B-11: Source/input/binding configuration

**Files:**
- Create: `services/core-api/src/lib/secret-store.ts`
- Create: `services/core-api/src/modules/settings/source-routes.ts`
- Create: `services/core-api/src/modules/settings/bindings.ts`
- Create: `services/core-api/test/settings/sources.test.ts`
- Create: `services/core-api/test/contract/source-settings.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: `listSourceRoles`, `listPhysicalInputs`, `updatePhysicalInput`, `listSourceBindings`, `updateSourceBinding`; encrypted `SecretStore.put/get/delete`.
- Consumes: source/input/binding tables; PM `PUT /publishers/{id}/binding`; B-09 reprojection.

- [ ] **Step 1: Write failing configuration and secrecy tests**

Cover five seeded roles, four input skeletons, unique physical-input binding, permanent `mic-room` refusal, admin-only mutation, camera address edited once, credentials encrypted outside SQLite and absent from response/log/audit, PM publisher-id mapping (`presentation→usb`, `lecturer-camera→rtsp`, `students-camera→rtsp2`, `mic-lecturer→audio`), PM 202 failure rollback, and HL-09 unknown→reprobe.

- [ ] **Step 2: Run and verify missing source routes**

Run: `pnpm --filter @eduscope/core-api test -- test/settings/sources.test.ts test/contract/source-settings.contract.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement atomic settings plus internal binding push**

Encrypt secret values with libsodium secretbox using the provisioned key and a random nonce; store only a secret reference on `physical_inputs`. Write input/binding rows and audit in one transaction, then push the fully resolved binding to A outside the transaction. If A refuses, record `lastProbeError`, publish unknown/offline honestly, and keep one canonical config copy.

- [ ] **Step 4: Verify A call and no secret leakage**

Run: `pnpm --filter @eduscope/core-api test -- test/settings/sources.test.ts test/contract/source-settings.contract.test.ts`

Expected: PASS; fake A sees one binding call and all serialized/logged/DB fixtures lack the password.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): configure source bindings"
```

---

### Task B-12: Audio controls

**Files:**
- Create: `services/core-api/src/modules/settings/audio-routes.ts`
- Create: `services/core-api/test/settings/audio.test.ts`
- Create: `services/core-api/test/contract/audio.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: `listAudioControls`, `updateAudioControl`; `audio.control` resolution event.
- Consumes: audio rows, owner/admin authority, PM `PUT /audio/controls/mic-lecturer` readback.

- [ ] **Step 1: Write failing requested-vs-applied tests**

Assert only `mic-lecturer` is mutable, 0–100 gain, owner-or-admin while non-terminal and admin otherwise, 202 acceptance, requested row enters pending, actual PM `appliedGain/appliedMuted` replaces requested values only on success, and injected ALSA failure emits `appliedState:'failed'` with lastError.

- [ ] **Step 2: Run and observe missing endpoints**

Run: `pnpm --filter @eduscope/core-api test -- test/settings/audio.test.ts test/contract/audio.contract.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement async apply/readback**

Return `CommandAccepted`, enqueue the PM call, persist actual readback, and publish a zod-parsed `audio.control`. Never echo optimistic state as applied.

- [ ] **Step 4: Verify success/failure event honesty**

Run: `pnpm --filter @eduscope/core-api test -- test/settings/audio.test.ts test/contract/audio.contract.test.ts`

Expected: PASS; injected failure leaves prior applied gain/mute intact and marks failed.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): apply audio controls"
```

---

### Task B-13: Artifact/merge worker

**Files:**
- Create: `services/core-api/src/lib/argv-worker.ts`
- Create: `services/core-api/src/modules/library/artifact-machine.ts`
- Create: `services/core-api/src/modules/library/merge-worker.ts`
- Create: `services/core-api/test/fakes/media-tools.ts`
- Create: `services/core-api/test/library/artifact.test.ts`
- Create: `services/core-api/test/contract/recording-artifact.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: machine-1b `ArtifactExecutor`; `ArgvWorker.run(executable,args,options)`; `recording.artifact` events; `artifact.ready` domain event for B-17.
- Consumes: B-06 finalized segment/file rows, ffprobe/ffmpeg argv tools, RA-01..RA-05/RA-07.

- [ ] **Step 1: Write failing merge/idempotency/watchdog tests**

Cover one-segment remux, multi-segment concat per streamKey, separate-files independent outputs, truncated/crash segments included, zero-byte failed files excluded but retained, TS capture preserved, MP4 derived rows, checksum-based re-entry, watchdog `max(5min,3×recordedDuration)`, retries at 30s/5min, failure retains inputs and creates no upload job. Include **KEEP B-23**.

- [ ] **Step 2: Run and verify missing artifact executor**

Run: `pnpm --filter @eduscope/core-api test -- test/library/artifact.test.ts test/contract/recording-artifact.contract.test.ts`

Expected: FAIL because artifact machine/worker are undefined.

- [ ] **Step 3: Implement supervised argv-only media work**

`ArgvWorker` must call `spawn(executable,args,{shell:false})`, capture bounded stderr, support AbortSignal, and expose progress/exit without blocking the event loop. Build concat manifests as data files under the recording's temp directory, never command strings. Persist `running` before spawn and the outcome in a short post-process transaction. In `app.ts`, instantiate one `ArtifactExecutor`, subscribe it directly to B-06's finalized-recording domain event, and register it with the lifecycle; B-14 only calls the same instance for manual retry and does not own this wiring.

- [ ] **Step 4: Verify playable deliverables and failure path**

Run: `pnpm --filter @eduscope/core-api test -- test/library/artifact.test.ts test/contract/recording-artifact.contract.test.ts`

Expected: PASS; fake ffprobe marks outputs playable and failed merge creates no upload row.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): finalize recording artifacts"
```

---

### Task B-14: Library reads/delete/retry

**Files:**
- Create: `services/core-api/src/lib/cursor.ts`
- Create: `services/core-api/src/modules/library/queries.ts`
- Create: `services/core-api/src/modules/library/delete.ts`
- Create: `services/core-api/src/modules/library/routes.ts`
- Create: `services/core-api/test/library/routes.test.ts`
- Create: `services/core-api/test/contract/library.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: `listRecordings`, `getRecording`, `deleteRecording`, `retryMergeRecording`; opaque keyset cursor; audited RA-06 deletion.
- Consumes: recording/file/upload rows, B-13 artifact executor, auth actor.

- [ ] **Step 1: Write failing ownership/filter/race tests**

Lecturer lists only own non-deleted rows regardless of supplied `ownerUserId`; admin filters by owner/q/state/includeDeleted; cursor is `(startedAt,id)` keyset; detail has ordered segments/files; delete is admin-only, removes only DB-addressed paths under recordings root, races safely with upload/export, keeps LectureSession, cancels upload, and records actor; retry only accepts failed merge. Include **KEEP B-31/B-33**.

- [ ] **Step 2: Run and observe absent library routes**

Run: `pnpm --filter @eduscope/core-api test -- test/library/routes.test.ts test/contract/library.contract.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement parameterized keyset reads and deletion executor**

Decode/validate cursors strictly; select explicit columns; use Drizzle predicates, not SQL strings. Resolve every file path with `path.resolve` and require it to stay below the active recordings mount. Perform file removal outside the transaction, then persist the terminal rows/audit; idempotent repeat returns the current terminal state.

- [ ] **Step 4: Verify role scoping and races**

Run: `pnpm --filter @eduscope/core-api test -- test/library/routes.test.ts test/contract/library.contract.test.ts`

Expected: PASS; lecturer cross-owner attempts are 403/404 and admin delete is audited.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): expose recording library"
```

---

### Task B-15: Authenticated media Range route

**Files:**
- Create: `services/core-api/src/modules/library/media-route.ts`
- Create: `services/core-api/test/library/media.test.ts`
- Create: `services/core-api/test/contract/media.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: `getRecordingMedia` with 200/206, Range and optional attachment disposition.
- Consumes: B-14 owner/admin lookup, active storage mount resolver, Node file streams.

- [ ] **Step 1: Write failing 200/206/authz/path tests**

Cover no Range, bounded/open/suffix Range, 416 invalid/unsatisfiable, HEAD-like metadata where Fastify supplies it, download filename sanitization, missing file, lecturer cross-owner denial, deleted file, symlink/path traversal outside mount, and contract content types/headers.

- [ ] **Step 2: Run and verify media is 404**

Run: `pnpm --filter @eduscope/core-api test -- test/library/media.test.ts test/contract/media.contract.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement streaming without buffering**

Open the resolved file after authorization, derive exact byte bounds, set `Accept-Ranges`, `Content-Length`, and `Content-Range`, and pipe `createReadStream({start,end})`. Never expose the physical path in headers or Problems.

- [ ] **Step 4: Verify partial content**

Run: `pnpm --filter @eduscope/core-api test -- test/library/media.test.ts test/contract/media.contract.test.ts`

Expected: PASS; authorized `Range: bytes=2-5` returns 206 and exactly four bytes.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): stream authorized recording media"
```

---

### Task B-16: USB export lifecycle

**Files:**
- Create: `services/core-api/src/modules/export/udev.ts`
- Create: `services/core-api/src/modules/export/subscriptions.ts`
- Create: `services/core-api/src/modules/export/worker.ts`
- Create: `services/core-api/src/modules/export/routes.ts`
- Create: `services/core-api/test/fakes/block-devices.ts`
- Create: `services/core-api/test/export/export.test.ts`
- Create: `services/core-api/test/contract/export.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: `BlockDeviceMonitor`; `ScopedSubscriptionRegistry`; four export operations; `export.job`, `usb.volumes` events.
- Consumes: B-14 files, auth session id, injected `udevadm`/`lsblk` argv runner and copy streams.

- [ ] **Step 1: Write failing target/progress/scope/race tests**

Inject two drives; exclude system/recordings volumes; require user-selected target; recheck capacity at create; expand all requested recording files; progress uses copied bytes and emits at ≥5%; fsync before complete; cancel/pull removes partial target files and never sources; scoped events reach only the requesting AuthSession with 120-second REST-refreshed TTL. Include **KEEP B-32**.

- [ ] **Step 2: Run and observe missing export routes**

Run: `pnpm --filter @eduscope/core-api test -- test/export/export.test.ts test/contract/export.contract.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement hotplug snapshot and streamed copy worker**

Use `spawn('udevadm',['monitor','--subsystem-match=block','--property'],{shell:false})` and `execFile('lsblk',['--json','--bytes','--output',...])` through injected argv seams; parse only structured output. Copy one file at a time with AbortSignal and real byte counters. Persist each transition before publishing its event.

- [ ] **Step 4: Verify honest failure and event privacy**

Run: `pnpm --filter @eduscope/core-api test -- test/export/export.test.ts test/contract/export.contract.test.ts`

Expected: PASS; USB pull fails the job and no other AuthSession sees the job/volume event.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): export recordings to selected usb"
```

---

### Task B-17: Upload queue state and API

**Files:**
- Create: `services/core-api/src/modules/uploads/machine.ts`
- Create: `services/core-api/src/modules/uploads/parts.ts`
- Create: `services/core-api/src/modules/uploads/scheduler.ts`
- Create: `services/core-api/src/modules/uploads/routes.ts`
- Create: `services/core-api/test/uploads/queue.test.ts`
- Create: `services/core-api/test/contract/uploads.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: machine-3a/3b executor; `UploadScheduler.wake()`; `listUploadJobs`, `getUploadJob`, `requeueUploadJob`; `upload.job`, `upload.part`.
- Consumes: B-13 `artifact.ready`, B-14 deletion, adapter interface supplied by B-18.

- [ ] **Step 1: Write failing U-01..U-10/UP-01..UP-05 tests**

Prove exactly one immediate job per ready recording, no job before merge success, one job/one part concurrency, one part per uploadable file, progress ≥5%, typed failure classes, connectivity consumes no attempt, server backoff `30s,2m,8m,30m,2h,6h,6h,6h` with ±20% injected jitter, permanent dead-letter after 2, server dead-letter after 8, missing part immediate dead-letter, 24-hour offline alert, delete→cancel, and guarded manual requeue. Include **KEEP B-27/B-28**.

- [ ] **Step 2: Run and verify queue code is absent**

Run: `pnpm --filter @eduscope/core-api test -- test/uploads/queue.test.ts test/contract/uploads.contract.test.ts`

Expected: FAIL with missing scheduler/routes.

- [ ] **Step 3: Implement DB-driven scheduler and state reducers**

The scheduler wakes every 5 seconds and on row changes, selects one due queued job, and delegates transfer outside transactions. Persist structural `failureClass`; never parse `lastError`. `requeue` resets terminal retry fields and records actor/time but does not create a second job. In `app.ts`, register the scheduler lifecycle with an injected transfer adapter when one is supplied; until B-18 supplies the production placeholder adapter, the scheduler remains dormant while routes and fake-injected tests remain runnable.

- [ ] **Step 4: Verify restart-safe backoff**

Run: `pnpm --filter @eduscope/core-api test -- test/uploads/queue.test.ts test/contract/uploads.contract.test.ts`

Expected: PASS; restarting at each transition resumes from rows without duplicate jobs/parts.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): persist upload queue state"
```

---

### Task B-18: Pluggable placeholder upload adapter

**Files:**
- Create: `services/core-api/src/modules/uploads/adapters/types.ts`
- Create: `services/core-api/src/modules/uploads/adapters/placeholder.ts`
- Create: `services/core-api/test/fakes/upload-fixture-server.ts`
- Create: `services/core-api/test/uploads/placeholder-adapter.test.ts`
- Modify: `services/core-api/src/modules/uploads/scheduler.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: `UploadAdapter`, `UploadFailure`, `ResumeCheckpoint`, `PlaceholderUploadAdapter`.
- Consumes: B-17 jobs/parts, file streams, local fixture HTTP API only.

- [ ] **Step 1: Write failing adapter/resume/cleanup tests**

Exercise create lecture, multiple parts, mid-part disconnect, durable byte offset/token, process restart, resume without duplicate remote lecture, complete manifest, partial-remote delete before retry, checksum mismatch, and structural connectivity/server/permanent errors. Assert requests contain no institute-specific field.

- [ ] **Step 2: Run and verify the adapter is missing**

Run: `pnpm --filter @eduscope/core-api test -- test/uploads/placeholder-adapter.test.ts`

Expected: FAIL because adapter modules do not exist.

- [ ] **Step 3: Implement the D-02b-safe mechanical interface**

```ts
export type UploadFailureClass = 'connectivity' | 'server' | 'permanent';
export interface UploadFailure { readonly class: UploadFailureClass; readonly detail: string; }
export interface ResumeCheckpoint { readonly offset: number; readonly token: string | null; }
export interface UploadAdapter {
  readonly id: 'placeholder';
  readonly capabilities: { readonly resume: true };
  createLecture(metadata: UploadMetadata): Promise<{ remoteLectureId: string }>;
  uploadPart(input: {
    remoteLectureId: string;
    part: UploadFilePart;
    stream: NodeJS.ReadableStream;
    checkpoint: ResumeCheckpoint;
    onCheckpoint(next: ResumeCheckpoint): Promise<void>;
  }): Promise<{ remoteFileId: string; checkpoint: ResumeCheckpoint }>;
  completeLecture(remoteLectureId: string, manifest: readonly PartManifest[]): Promise<void>;
  deleteLecture(remoteLectureId: string): Promise<void>;
}
```

Use TLS verification for non-loopback URLs; B-18 tests only the loopback fixture. Persist each checkpoint before reading the next chunk. In `app.ts`, construct `PlaceholderUploadAdapter`, inject it into the B-17 scheduler registration, and only then let lifecycle startup begin scheduler polling. This is not institute-wire acceptance.

- [ ] **Step 4: Verify network-cut restart completion**

Run: `pnpm --filter @eduscope/core-api test -- test/uploads/placeholder-adapter.test.ts`

Expected: PASS; the fixture sees one lecture, each byte once after resume, all parts, and one completion.

Run: `pnpm --filter @eduscope/core-api test:contract`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): add resumable upload adapter"
```

---

### Task B-19: Retention and storage pressure

**Files:**
- Create: `services/core-api/src/modules/storage/probe.ts`
- Create: `services/core-api/src/modules/storage/retention.ts`
- Create: `services/core-api/src/modules/storage/routes.ts`
- Create: `services/core-api/test/storage/retention.test.ts`
- Create: `services/core-api/test/contract/storage-overview.contract.test.ts`
- Modify: `services/core-api/src/modules/recording/guards.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: machine-5b `StorageProbe`; `RetentionSweep`; `getStorageOverview`; storage domain events and `storage.status`.
- Consumes: B-14 deletion, B-17 upload outcome, active-recording state.

- [ ] **Step 1: Write failing HL-10..HL-14/RET-1..RET-6 tests**

Test 10-second recording/60-second idle probe cadence, 5% hysteresis, fail-closed unknown probe, 14-day eligibility, upload-success requirement, uploaded-oldest-first pressure deletion, never-unuploaded, foreign-file ignore, event-driven and 15-minute sweep, 4 GiB floor graceful stop, critical start refusal, and policy values mirrored in REST/event text. Include **KEEP B-53**.

- [ ] **Step 2: Run and verify missing storage overview**

Run: `pnpm --filter @eduscope/core-api test -- test/storage/retention.test.ts test/contract/storage-overview.contract.test.ts`

Expected: FAIL with missing probe/route.

- [ ] **Step 3: Implement DB-driven retention and pressure reducer**

Inject `statfs`; do not shell to `df`. Compute candidates only from rows, call the B-14 deletion executor for every deletion, and re-probe after each batch. Publish full policy with each status. Floor breach enters B-06 stop through the recording executor.

- [ ] **Step 4: Verify destructive boundaries in temp fixtures**

Run: `pnpm --filter @eduscope/core-api test -- test/storage/retention.test.ts test/contract/storage-overview.contract.test.ts`

Expected: PASS; uploaded oldest is deleted, stray and unuploaded files remain, and critical start returns contract Problem.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): enforce storage retention policy"
```

---

### Task B-20: Volume register/format

**Files:**
- Create: `services/core-api/src/lib/helper-client.ts`
- Create: `services/core-api/src/modules/storage/volume-routes.ts`
- Create: `services/core-api/test/fakes/helper-server.ts`
- Create: `services/core-api/test/storage/volumes.test.ts`
- Create: `services/core-api/test/contract/storage-volumes.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: fixed-union `HelperClient.request(verb,args,requestId)` over injected `HelperTransport`; `registerStorageVolume`, `formatStorageVolume`.
- Consumes: `CoreConfig.helperSocket`, injected helper transport/fixture, current block-device resolver, recording guard.

- [ ] **Step 1: Write failing helper/volume safety tests**

Reject unknown verbs, extra args, non-current devnodes, duplicate UUID, wrong confirm text, non-admin, non-terminal recording, helper timeout/failure, and path-like metacharacters. Register uses `volume.mount {uuid}`; format uses only `volume.unmount`, `volume.format {devNode,fs:'ext4',label}`, `volume.mount {uuid}` and records by UUID. Route tests use an in-memory `HelperTransport`. In the same file, a guarded POSIX-only framing test creates `helper-server.ts` with an injected socket path below the test temp directory; `it.skipIf(process.platform === 'win32')` records the global reason and no test references the production path.

- [ ] **Step 2: Run and verify missing helper client**

Run: `pnpm --filter @eduscope/core-api test -- test/storage/volumes.test.ts test/contract/storage-volumes.contract.test.ts`

Expected: FAIL because helper client/routes do not exist.

- [ ] **Step 3: Implement one-request-per-connection JSON client**

Validate verb/args with a closed zod discriminated union. The production `UnixHelperTransport` connects to the injected `CoreConfig.helperSocket` (whose default is `/run/eduscope/helper.sock`), writes `{verb,args,requestId}\n`, reads one bounded line, validates `{ok,detail}`, and closes. `HelperClient` itself depends only on `HelperTransport.request(line, signal)`, so Windows/unit tests do not create AF_UNIX sockets. No shell, sudo, generic exec, or caller-supplied executable exists.

- [ ] **Step 4: Verify only allowlisted calls occur**

Run: `pnpm --filter @eduscope/core-api test -- test/storage/volumes.test.ts test/contract/storage-volumes.contract.test.ts`

Expected: PASS; fake helper ledger contains only exact fixed verbs/argv-like data, Windows reports only the named POSIX framing skip, and no test binds or connects to `/run/eduscope/helper.sock`.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): register and format storage volumes"
```

---

### Task B-21: Provisioning, health, and alerts

**Files:**
- Create: `services/core-api/src/modules/device/provisioning.ts`
- Create: `services/core-api/src/modules/device/health.ts`
- Create: `services/core-api/src/modules/device/alerts.ts`
- Create: `services/core-api/src/modules/device/routes.ts`
- Create: `services/core-api/test/device/device.test.ts`
- Create: `services/core-api/test/contract/device.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: `ProvisioningReader`; `HealthAggregator`; `AlertStore`; `getProvisioning`, `getDeviceHealth`, `listAlerts`, `acknowledgeAlert`; `device.health`, `system.alert`.
- Consumes: deploy-owned JSON, B-04 PM status, B-19 storage, helper `smart.read`, injected NTP reader.

- [ ] **Step 1: Write failing read-only/health/alert tests**

Prove mtime-invalidated provisioning read per use, secrets omitted, incomplete provisioning causes named guard failure, PM stale publishers are unknown, capture watchdog/disk/NTP fields aggregate, change+60-second health emits, alert raise/clear deduplicates, acknowledge records actor but does not clear an active condition, and 30-second re-evaluation re-raises.

- [ ] **Step 2: Run and verify missing device routes**

Run: `pnpm --filter @eduscope/core-api test -- test/device/device.test.ts test/contract/device.contract.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement projections and alert store**

Read provisioning with `fs.readFile` and zod; never write it. Invoke `smart.read` through B-20 and inject NTP parsing rather than shell strings. Persist one device-health snapshot. Every raise/clear also publishes a domain event and later B-37 product log hook.

- [ ] **Step 4: Verify acknowledgement semantics**

Run: `pnpm --filter @eduscope/core-api test -- test/device/device.test.ts test/contract/device.contract.test.ts`

Expected: PASS; active acknowledged alert remains active and re-evaluates.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): expose provisioning health alerts"
```

---

### Task B-22: Guarded power-off

**Files:**
- Create: `services/core-api/src/modules/device/power.ts`
- Create: `services/core-api/test/device/power.test.ts`
- Create: `services/core-api/test/contract/power.contract.test.ts`
- Modify: `services/core-api/src/modules/device/routes.ts`

**Interfaces:**
- Produces: `powerOffDevice` only; no resolving event.
- Consumes: fresh B-07 recording authority check and B-20 helper.

- [ ] **Step 1: Write failing idle/race/refusal tests**

Test admin-only, non-terminal refusal `poweroff.refused` plus alert, a race where recording starts between route entry and guard (helper must not run), idle 202 `CommandAccepted`, exactly one `system.poweroff {}`, helper failure Problem, and no invented completion event. Include **KEEP B-50**.

- [ ] **Step 2: Run and verify route absence**

Run: `pnpm --filter @eduscope/core-api test -- test/device/power.test.ts test/contract/power.contract.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement guarded helper call**

Serialize the final state check with the recording executor, mint `CommandAccepted`, invoke helper only after acceptance, and log failure without emitting a completion event.

- [ ] **Step 4: Verify recording race is closed**

Run: `pnpm --filter @eduscope/core-api test -- test/device/power.test.ts test/contract/power.contract.test.ts`

Expected: PASS; helper ledger stays empty in every refusal/race case.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): guard device power off"
```

---

### Task B-23: Network settings apply

**Files:**
- Create: `services/core-api/src/modules/settings/network-routes.ts`
- Create: `services/core-api/test/settings/network.test.ts`
- Create: `services/core-api/test/contract/network.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: `listNetworkConfigs`, `updateNetworkConfig`.
- Consumes: network rows and helper `net.apply`.

- [ ] **Step 1: Write failing wired-only/apply/readback tests**

Validate known wired interface, DHCP/static mutual fields, IPv4/prefix/gateway/DNS consistency, admin-only, 202 pending, helper exact args, success `appliedAt`, failure `lastApplyError` plus alert, and prior config retained on failure. Assert no frontend build command/path exists.

- [ ] **Step 2: Run and verify missing routes**

Run: `pnpm --filter @eduscope/core-api test -- test/settings/network.test.ts test/contract/network.contract.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement async apply and row readback**

Persist requested config/pending marker, call helper outside the transaction, then persist applied/error result and publish alert on failure. Invalid gateways never reach helper.

- [ ] **Step 4: Verify honest row state**

Run: `pnpm --filter @eduscope/core-api test -- test/settings/network.test.ts test/contract/network.contract.test.ts`

Expected: PASS; helper success/failure is visible on the next GET.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): apply network settings"
```

---

### Task B-24: Encoder settings and capabilities

**Execution gate:** Do not start this task until the master-plan Workstream B encoder-ingress flag is acknowledged and the A-owned internal correction is green.

**Files:**
- Create: `services/core-api/src/modules/settings/encoder-routes.ts`
- Create: `services/core-api/test/settings/encoder.test.ts`
- Create: `services/core-api/test/contract/encoder.contract.test.ts`
- Modify: `services/core-api/src/modules/recording/pm/types.ts`
- Modify: `services/core-api/src/modules/recording/pm/client.ts`
- Modify: `services/core-api/src/modules/recording/executor.ts`
- Modify: `services/core-api/src/modules/channels/machine.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: `getEncoderSettings`, `updateEncoderSettings`; `resolveEffectiveProfile(channelId)`; PM `EffectiveEncodeProfile` boundary object.
- Consumes: probed A capabilities/effective default and per-channel profile rows.

- [ ] **Step 1: Write failing capability/DR-14/PM consumption tests**

Prove unsupported values are absent/rejected; GET without `channelId` returns device default, with channel returns override or inherited default; update absent/null `channelId` writes default, non-null writes only that channel; bitrate 2000–8000 Kbps; and bitrate plus framerate updates convert Kbps→Bps and reach the next PM live-start profile while local record retains its default. The corrected A fake must show that those values select the resulting live pipeline encoder properties; passthrough record receives no active override effect. This is B's boundary verification for **KEEP B-56**; A-03/A-16 retain hardware-output ownership.

- [ ] **Step 2: Run and verify missing encoder routes/ingress**

Run: `pnpm --filter @eduscope/core-api test -- test/settings/encoder.test.ts test/contract/encoder.contract.test.ts`

Expected: FAIL until both B routes and the acknowledged A correction exist.

- [ ] **Step 3: Implement table-backed effective-profile resolution**

Validate updates against the last probed capability set, store public units, and convert at the PM boundary:

```ts
export interface EffectiveEncodeProfile {
  videoBitrateBps: number;
  fps: number;
  gop: number;
  rateControl: 'cbr' | 'vbr';
  audioBitrateBps: number;
}
```

Record/live executors resolve the channel snapshot immediately before PM start. Do not send codec/container because the pipeline kind fixes them.

- [ ] **Step 4: Verify affected/unaffected channels**

Run: `pnpm --filter @eduscope/core-api test -- test/settings/encoder.test.ts test/contract/encoder.contract.test.ts`

Expected: PASS; fake A captures changed bitrate/framerate in the resulting streaming encoder properties and unchanged local values, satisfying B's **KEEP B-56** assignment.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): apply effective encoder profiles"
```

---

### Task B-25: Stream-target CRUD and relay reload

**Files:**
- Create: `services/core-api/src/modules/settings/stream-target-routes.ts`
- Create: `services/core-api/src/modules/relay/config.ts`
- Create: `services/core-api/test/settings/stream-targets.test.ts`
- Create: `services/core-api/test/contract/stream-targets.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: four stream-target operations; deterministic redacted relay template/digest.
- Consumes: B-11 SecretStore, B-20 helper `relay.reload`, B-08 streaming state.

- [ ] **Step 1: Write failing platform/secret/reload tests**

Cover YouTube/Facebook/custom RTMP validation, write-only stream key, `hasStreamKey` only in responses, no secret in DB/log/audit/template snapshot, stable sorted digest, reload only on effective change, and edits during active stream update next-run config without stopping recording/current live consumer. For every enable/disable/delete combination, assert the enabled target-id set equals the relay renderer's pushed-upstream target-id set exactly—no disabled, deleted, implicit, or duplicate target. This is B's configuration-boundary verification for **KEEP B-59**; A-05/A-16 retain hardware-push ownership.

- [ ] **Step 2: Run and verify CRUD absence**

Run: `pnpm --filter @eduscope/core-api test -- test/settings/stream-targets.test.ts test/contract/stream-targets.contract.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement secret-safe CRUD and reload**

Store ingest metadata in SQLite and keys in SecretStore. Render the relay input from enabled target ids in channel order, hash it, and invoke `relay.reload {configDigest}`; helper/deploy layer owns the privileged file operation.

- [ ] **Step 4: Verify no mid-stream restart**

Run: `pnpm --filter @eduscope/core-api test -- test/settings/stream-targets.test.ts test/contract/stream-targets.contract.test.ts`

Expected: PASS; PM ledger contains no stop call after target edit and the relay renderer's pushed-upstream target set is exactly the enabled set, satisfying B's **KEEP B-59** assignment.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): manage stream relay targets"
```

---

### Task B-26: Firmware lifecycle

**Files:**
- Create: `services/core-api/src/modules/firmware/machine.ts`
- Create: `services/core-api/src/modules/firmware/routes.ts`
- Create: `services/core-api/test/firmware/firmware.test.ts`
- Create: `services/core-api/test/contract/firmware.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: `getFirmwareState`, `checkFirmware`, `applyFirmware`; `firmware.state`.
- Consumes: recording guard, helper `firmware.check/apply/rollback`, DB snapshot seam.

- [ ] **Step 1: Write failing state/signature/rollback tests**

Cover idle→checking→available/no-update/failure, applying refusal during non-terminal recording, signed fixture verification result from helper, DB backup before apply, apply→done, bad signature→failed, failed boot→rolled-back, idempotent check, and every event payload state.

- [ ] **Step 2: Run and verify firmware routes absent**

Run: `pnpm --filter @eduscope/core-api test -- test/firmware/firmware.test.ts test/contract/firmware.contract.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement linear lifecycle orchestration**

Core-api orchestrates only fixed helper verbs and persists state before/after each call; signature verification and A/B slot mechanics remain helper/deploy-owned. Snapshot DB to a configured system-volume path with an injected file operation before `apply`.

- [ ] **Step 4: Verify rollback projection**

Run: `pnpm --filter @eduscope/core-api test -- test/firmware/firmware.test.ts test/contract/firmware.contract.test.ts`

Expected: PASS; failed-boot fixture ends `rolled-back` and event parses.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): orchestrate firmware lifecycle"
```

---

### Task B-27: User CRUD and authorization matrix

**Files:**
- Create: `services/core-api/src/modules/users/service.ts`
- Create: `services/core-api/src/modules/users/routes.ts`
- Create: `services/core-api/test/users/users.test.ts`
- Create: `services/core-api/test/users/authorization-matrix.test.ts`
- Create: `services/core-api/test/contract/users.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: `listUsers`, `createUser`, `updateUser`, `deleteUser`; centralized operation/role/owner matrix.
- Consumes: B-03 auth/session revocation, users/audit rows.

- [ ] **Step 1: Write failing CRUD and complete role-matrix tests**

Exercise admin-only list/create/update/delete, paging/q/role filters, unique username across sources, no hash selection, created users forced reset, last enabled admin guard, self-delete/self-disable guard, soft/tombstone delete preserving recordings, and prompt revocation after disable/delete. Generate one test row per B-owned operation from contract `x-required-role` plus owner rules. Include **KEEP B-43**.

- [ ] **Step 2: Run and verify user routes absent**

Run: `pnpm --filter @eduscope/core-api test -- test/users/users.test.ts test/users/authorization-matrix.test.ts test/contract/users.contract.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement explicit authorization policy and CRUD**

Represent policy as a typed map keyed by `PanelOperationId`; no handler relies on frontend visibility. Hash initial passwords, set `mustResetPassword`, write audit in the same transaction, then revoke affected sessions.

- [ ] **Step 4: Verify matrix and session invalidation**

Run: `pnpm --filter @eduscope/core-api test -- test/users/users.test.ts test/users/authorization-matrix.test.ts test/contract/users.contract.test.ts`

Expected: PASS; lecturer has no admin success path and disabled user's next request fails.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): manage users and authorization"
```

---

### Task B-28: Excel user import

**Files:**
- Create: `services/core-api/src/modules/users/import.ts`
- Create: `services/core-api/test/fixtures/users/valid.xlsx`
- Create: `services/core-api/test/fixtures/users/invalid-null.xlsx`
- Create: `services/core-api/test/fixtures/users/duplicate.xlsx`
- Create: `services/core-api/test/users/import.test.ts`
- Create: `services/core-api/test/contract/user-import.contract.test.ts`
- Modify: `services/core-api/src/modules/users/routes.ts`

**Interfaces:**
- Produces: `importUsers`; parsed `UserImportBatch` result.
- Consumes: ExcelJS in-memory workbook, B-27 user service.

- [ ] **Step 1: Write failing multipart/all-or-nothing tests**

Cover required `.xlsx` part and size limit, exact columns `username,displayName,role,password,source,externalId`, null cells, invalid role/source, in-file duplicate, existing username, mixed validity writes zero users, valid batch writes all users/import provenance, forced reset, plaintext never reaches disk/log/DB, and per-row rejection schema. Include **KEEP B-44**.

- [ ] **Step 2: Run and verify import route absent**

Run: `pnpm --filter @eduscope/core-api test -- test/users/import.test.ts test/contract/user-import.contract.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement bounded in-memory validation then one transaction**

Read multipart into a bounded Buffer, parse with ExcelJS, validate every row and all uniqueness before hashing/inserting. On any rejection persist only a rejected batch record; on clean input insert users plus applied batch atomically. Discard Buffer references after response.

- [ ] **Step 4: Verify accepted login/reset**

Run: `pnpm --filter @eduscope/core-api test -- test/users/import.test.ts test/contract/user-import.contract.test.ts`

Expected: PASS; accepted fixture user can log in but only access reset allowlist.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): import users from excel"
```

---

### Task B-29: AI capture ingest and countdown

**Files:**
- Create: `services/core-api/src/modules/ai/clients.ts`
- Create: `services/core-api/src/modules/ai/ingest.ts`
- Create: `services/core-api/src/modules/ai/countdown.ts`
- Create: `services/core-api/src/modules/ai/routes.ts`
- Create: `services/core-api/test/fakes/ai-services.ts`
- Create: `services/core-api/test/ai/countdown.test.ts`
- Create: `services/core-api/test/contract/ai-countdown.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: internal STT/slide/question clients; append-only transcript/slide ingest; machine-2a; `getAiCountdown`, `setAiInterval`, `generateNow`; `ai.countdown`.
- Consumes: B-05/B-06 session transitions, approved AI internal contracts/ports 7101–7103.

- [ ] **Step 1: Write failing ingest/countdown/degrade tests**

Fake exact STT/slide HTTP+SSE contracts. Prove session start/pause/resume/stop calls and resume anchor equals recordedDurationMs; append-only offsets; snapshot consumer path; interval only 10/15/20/30 default 20; local nextAt ticking; manual generation resets countdown; pause holds remaining time; LLM failure holds/degrades while record continues; probe recovery resumes; 15-second resync. Contract-parse events.

- [ ] **Step 2: Run and verify AI routes absent**

Run: `pnpm --filter @eduscope/core-api test -- test/ai/countdown.test.ts test/contract/ai-countdown.contract.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement injected clients, durable ingest, and one timer**

Clients use localhost bearer, one SSE connection each, `/status` resync, and typed zod internal fixtures. Countdown stores absolute `nextAt` and held remaining milliseconds; never writes per-second rows or emits per-second events. Feature-disabled/null endpoint state is unavailable and starts no AI session.

- [ ] **Step 4: Verify AI failure isolation**

Run: `pnpm --filter @eduscope/core-api test -- test/ai/countdown.test.ts test/contract/ai-countdown.contract.test.ts`

Expected: PASS; LLM down changes only AI state and active recording remains live.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): ingest ai capture and countdown"
```

---

### Task B-30: Question-set generation lifecycle

**Files:**
- Create: `services/core-api/src/modules/ai/generation.ts`
- Create: `services/core-api/src/modules/ai/question-sets.ts`
- Create: `services/core-api/test/ai/generation.test.ts`
- Create: `services/core-api/test/contract/question-sets.contract.test.ts`
- Modify: `services/core-api/src/modules/ai/routes.ts`

**Interfaces:**
- Produces: machine-2b; `listQuestionSets`, `getQuestionSet`; `ai.set`.
- Consumes: B-29 transcript/slides/question client and LLM timers/retries.

- [ ] **Step 1: Write failing Q-10..Q-16 tests**

Cover input window from previous successful `toOffsetMs`, selected slides, requested/generating/ready/failed, outer 45-second timeout, 10s/30s two retries, typed timeout/unreachable/invalid-payload classification, mixed valid/invalid survivor persistence, option ULID minting, prompt/model provenance, zero survivors failure, prior generated draft supersession, and lecturer-authored survival.

- [ ] **Step 2: Run and verify generation modules absent**

Run: `pnpm --filter @eduscope/core-api test -- test/ai/generation.test.ts test/contract/question-sets.contract.test.ts`

Expected: FAIL with missing generation service/routes.

- [ ] **Step 3: Implement machine-2b in the AI serial executor**

Persist the requested set before HTTP; call question-service outside transaction; validate the response again; persist all survivor questions/options and set result in one transaction; emit after commit. Never lose unconsumed transcript/slides on failure.

- [ ] **Step 4: Verify mixed batch and restart**

Run: `pnpm --filter @eduscope/core-api test -- test/ai/generation.test.ts test/contract/question-sets.contract.test.ts`

Expected: PASS; mixed batch emits correct survivor count/provenance and restart retains it.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): generate question sets"
```

---

### Task B-31: Question authoring lifecycle

**Files:**
- Create: `services/core-api/src/modules/ai/questions.ts`
- Create: `services/core-api/src/modules/ai/question-routes.ts`
- Create: `services/core-api/test/ai/questions.test.ts`
- Create: `services/core-api/test/contract/questions.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: machine-2c; `listQuestions`, `createQuestion`, `editQuestion`, `discardQuestion`; `ai.question`.
- Consumes: question/option/audit/log tables, B-30 session/set state.

- [ ] **Step 1: Write failing MCQ/state/audit tests**

Test 2–4 identified options, one correct id belonging to question, labels/positions, lecturer-authored null set id, generated edit sets `edited`, session owner/admin guard, sent/closed immutability, discard only draft, list by session/state, and exactly one AuditLogEntry plus one Session LogEntry per add/edit/discard. Preserve lecturer-authored questions across later sets.

- [ ] **Step 2: Run and verify question routes absent**

Run: `pnpm --filter @eduscope/core-api test -- test/ai/questions.test.ts test/contract/questions.contract.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement atomic question+option mutations**

Mint all ULIDs server-side. For edits, replace option rows and correct id in one transaction only while draft; write audit/log in the same transaction and emit after commit.

- [ ] **Step 4: Verify immutable sent question**

Run: `pnpm --filter @eduscope/core-api test -- test/ai/questions.test.ts test/contract/questions.contract.test.ts`

Expected: PASS; sent edit is a named conflict and creates no changed row/event.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): author auditable questions"
```

---

### Task B-32: Publication and projector orchestration

**Files:**
- Create: `services/core-api/src/modules/quiz/projector.ts`
- Create: `services/core-api/src/modules/quiz/publication-routes.ts`
- Create: `services/core-api/test/fakes/quiz-service.ts`
- Create: `services/core-api/test/quiz/publication.test.ts`
- Create: `services/core-api/test/contract/publication.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: machine-2d; `sendToProjector`, `listPublications`, `closePublication`, `setProjector`; `quiz.publication`.
- Consumes: B-31 question, fake D REST ops, PM projector route, 5-second ack/2-second retry.

- [ ] **Step 1: Write failing Q-30..Q-36/publish-before-project tests**

Assert send creates publishing row and 202, closes prior publication, calls fake D publish with correctOptionId, waits for 201 before PM question mode, enforces one `isShowing`, timeout retries once then failed while PM remains passthrough, close carries authoritative `closedAt`, close idempotency, projector withdraw/re-show never reopens acceptance, and PM payload includes question+QR but no leaderboard/response data.

- [ ] **Step 2: Run and verify publication routes absent**

Run: `pnpm --filter @eduscope/core-api test -- test/quiz/publication.test.ts test/contract/publication.contract.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement ordered publication executor**

Use one quiz serial executor. Persist publishing, close previous locally/remotely, publish to D, then in one transaction mark open/showing and question sent; only afterward call PM projector. On PM failure keep publication open but projectorState not-shown/failed reason; on D failure never call PM.

- [ ] **Step 4: Verify timeout leaves slides visible**

Run: `pnpm --filter @eduscope/core-api test -- test/quiz/publication.test.ts test/contract/publication.contract.test.ts`

Expected: PASS; fake PM has zero question-mode calls on D timeout.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): publish questions before projection"
```

---

### Task B-33: Quiz projection reads

**Files:**
- Create: `services/core-api/src/modules/quiz/session.ts`
- Create: `services/core-api/src/modules/quiz/responses.ts`
- Create: `services/core-api/src/modules/quiz/leaderboard.ts`
- Create: `services/core-api/src/modules/quiz/routes.ts`
- Create: `services/core-api/test/quiz/projections.test.ts`
- Create: `services/core-api/test/contract/quiz-projections.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: machine-4a/4d projections; `getQuizSession`, `listPublicationResponses`, `getLeaderboard`; `quiz.session`, `quiz.responses`.
- Consumes: fake D participant/answer/heartbeat stream; answer projection rows.

- [ ] **Step 1: Write failing Z-01..Z-06/Z-30..Z-33/read-model tests**

Cover absent/requesting/open/failed/closed, 8-second create with two retries, joined count coalesced ≤1/s, answer upsert replace-never-edit keyed by publication+student, durable max seq, 15-second stale and 60-second failed, recovery replay, response PII scoped to current device session, and leaderboard score `correct*10`, accuracy `correct/answered` (0 when none), dense rank, never stored. Recording remains untouched.

- [ ] **Step 2: Run and verify quiz read routes absent**

Run: `pnpm --filter @eduscope/core-api test -- test/quiz/projections.test.ts test/contract/quiz-projections.contract.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement projections and derived leaderboard**

Persist quiz session projection and watermark with answer batches transactionally. Mark stale without altering rows. Compute leaderboard in a parameterized aggregate query and serialize only contracted fields.

- [ ] **Step 4: Verify ≤1-second update and stale marker**

Run: `pnpm --filter @eduscope/core-api test -- test/quiz/projections.test.ts test/contract/quiz-projections.contract.test.ts`

Expected: PASS; fake batch updates reads/events within fake one second, then stale flips without deleting data.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): project quiz responses and ranks"
```

---

### Task B-34: Device-side quiz-sync client

**Files:**
- Create: `services/core-api/src/modules/quiz/sync/rest.ts`
- Create: `services/core-api/src/modules/quiz/sync/stream.ts`
- Create: `services/core-api/src/modules/quiz/sync/replay.ts`
- Create: `services/core-api/test/quiz/sync.test.ts`
- Create: `services/core-api/test/contract/sync-hello.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: outbound quiz-sync REST client and WS stream; B-owned `sync.hello` emission.
- Consumes: provisioned base URL/static bearer, B-33 durable watermark, `zQuizSyncClientMessage`/`zQuizSyncServerMessage`.

- [ ] **Step 1: Write failing auth/header/reconnect/replay tests**

Fake D captures `Authorization: Bearer`, `x-eduscope-contract: 1.0`, device/session scope, hello `{deviceId,quizSessionId,answerWatermark}`, 5-second heartbeats, one active stream, reconnect backoff, answer seq ordering, duplicate replay idempotency, participant batches, wrong-session rejection, and restart from persisted watermark. Contract-test only B-owned `sync.hello`; server messages remain D-owned.

- [ ] **Step 2: Run and verify sync client absent**

Run: `pnpm --filter @eduscope/core-api test -- test/quiz/sync.test.ts test/contract/sync-hello.contract.test.ts`

Expected: FAIL because sync modules do not exist.

- [ ] **Step 3: Implement device-initiated REST/WS wrappers**

Resolve credentials per connect, never log them, validate every frame before dispatch, send hello first, then heartbeat. Commit each answer batch and watermark together before acknowledging it locally. Reject any frame outside the active device/session scope.

- [ ] **Step 4: Verify crash replay exactly once**

Run: `pnpm --filter @eduscope/core-api test -- test/quiz/sync.test.ts test/contract/sync-hello.contract.test.ts`

Expected: PASS; after restart hello uses stored max seq and projections contain no duplicates.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): sync quiz projections by watermark"
```

---

### Task B-35: WS hub, auth, replay, and scoped subscriptions

**Files:**
- Create: `services/core-api/src/modules/ws/subscriptions.ts`
- Create: `services/core-api/src/modules/ws/backpressure.ts`
- Create: `services/core-api/src/modules/ws/panel-hub.ts`
- Create: `services/core-api/test/ws/panel-hub.test.ts`
- Create: `services/core-api/test/contract/panel-events.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: authenticated `GET /api/v1/ws`; `PanelHub.publish`; initial snapshot; per-connection `seq`; scoped stream routing.
- Consumes: AuthSession guard, DomainBus, B-16 scoped registry, snapshots from B-05..B-34, `zEventEnvelope`.

- [ ] **Step 1: Write failing auth/snapshot/seq/scope/backpressure tests**

Use raw access JWT as the sole `Sec-WebSocket-Protocol` value; reject missing/bad/revoked/reset-locked token and any `?token=` query. Assert initial snapshot order and completeness: recording, three channels, every configured source role, storage, health, countdown, current set if any, open publication, quiz session, uncleared alerts; then live deltas. Prove per-connection monotonic seq, reconnect full snapshot, serialization once per event, admin/panel audience, `export.job` requesting-session only, `usb.volumes` export-flow sessions only, `log.entry` log-flow sessions only, 120-second scope expiry, audio subscriber reference count, and close at >256 queued events or >1 MiB.

- [ ] **Step 2: Run and verify WS endpoint absent**

Run: `pnpm --filter @eduscope/core-api test -- test/ws/panel-hub.test.ts test/contract/panel-events.contract.test.ts`

Expected: FAIL because `/api/v1/ws` does not upgrade.

- [ ] **Step 3: Implement fan-out-only WS hub**

Register `@fastify/websocket`, authenticate before accepting, validate every outgoing envelope with `zEventEnvelope`, serialize once, then apply audience/scope routing. The hub never writes domain state. Drop slow sockets; clients recover by full snapshot, not server replay. Panel clients send no frames; receiving one closes with policy violation.

- [ ] **Step 4: Verify all 22 event union members**

Run: `pnpm --filter @eduscope/core-api test -- test/ws/panel-hub.test.ts test/contract/panel-events.contract.test.ts`

Expected: PASS; every `PANEL_EVENT_NAMES` member serializes and private streams never cross sessions.

Run: `pnpm --filter @eduscope/api-client test -- event-coverage.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): stream scoped panel events"
```

---

### Task B-36: Preview signaling broker

**Files:**
- Create: `services/core-api/src/modules/ws/preview.ts`
- Create: `services/core-api/test/ws/preview.test.ts`
- Create: `services/core-api/test/contract/preview.contract.test.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: authenticated `GET /api/v1/ws/preview`; five contracted message variants/brokering.
- Consumes: B-09 source status, PM thumbnail offer/ICE/close endpoints, shared preview zod schemas.

- [ ] **Step 1: Write failing negotiation tests**

Test same subprotocol auth, client `offer/ice/close`, server `answer/ice/error`, zod rejection, one negotiation per connection, second offer closes first, role offline/unbound errors, PM busy/internal mapping, ICE correlation, client/socket/source teardown, <1-second fake offer→answer, and recording/other consumers untouched.

- [ ] **Step 2: Run and verify preview endpoint absent**

Run: `pnpm --filter @eduscope/core-api test -- test/ws/preview.test.ts test/contract/preview.contract.test.ts`

Expected: FAIL because preview socket does not upgrade.

- [ ] **Step 3: Implement one-connection/one-negotiation broker**

Validate role status before forwarding. Map PM current endpoints: start preview capability, offer with negotiationId/roleId/sdp, forward ICE, and DELETE negotiation on close/replacement. Keep media entirely in A; B forwards only signaling data.

- [ ] **Step 4: Verify all five schema variants and isolation**

Run: `pnpm --filter @eduscope/core-api test -- test/ws/preview.test.ts test/contract/preview.contract.test.ts`

Expected: PASS; source-offline is terminal and recording state/call ledger is unchanged.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): broker preview signaling"
```

---

### Task B-37: Product logs and CSV

**Files:**
- Create: `services/core-api/src/modules/observability/store.ts`
- Create: `services/core-api/src/modules/observability/audit.ts`
- Create: `services/core-api/src/modules/observability/routes.ts`
- Create: `services/core-api/test/observability/logs.test.ts`
- Create: `services/core-api/test/contract/logs.contract.test.ts`
- Modify: `services/core-api/src/config.ts`
- Modify: `services/core-api/src/app.ts`

**Interfaces:**
- Produces: `LogStore.write/query/rotate`; `AuditWriter`; `queryLogs`, `exportLogsCsv`; `log.entry`.
- Consumes: log/audit tables, B-35 scoped registry, domain failure hooks.

- [ ] **Step 1: Write failing log/filter/rotation/scope/CSV tests**

Require positive deployment values `EDUSCOPE_CORE_LOG_MAX_ROWS` and `EDUSCOPE_CORE_LOG_MAX_AGE_DAYS` (no product-visible setting). Test append-only writes, oldest-first row/age rotation with injected small limits, level/category/q/from/to/session cursor filters, explicit selected columns, RFC 4180 CSV escaping and stable header, admin-only REST, 120-second live-tail scope, every user-visible machine failure mirrored once, secrets absent, and AI attribution `service:'ai'` with `context.subservice` in `stt|slide|question`.

- [ ] **Step 2: Run and verify observability routes absent**

Run: `pnpm --filter @eduscope/core-api test -- test/observability/logs.test.ts test/contract/logs.contract.test.ts`

Expected: FAIL with 404 or missing required config.

- [ ] **Step 3: Implement curated logs separately from Pino**

Pino remains stdout/journald operational logging. `LogStore.write()` inserts a curated row then publishes `log.entry`; audit writes remain in owning domain transactions, with a helper that redacts secret fields from before/after. CSV streams rows rather than buffering all history.

- [ ] **Step 4: Verify filtering, rotation, and privacy**

Run: `pnpm --filter @eduscope/core-api test -- test/observability/logs.test.ts test/contract/logs.contract.test.ts`

Expected: PASS; rotated rows disappear oldest-first, CSV round-trips quoted values, and unsubscribed sessions see no live rows.

- [ ] **Step 5: Commit**

```bash
git add services/core-api
git commit -m "feat(core-api): store and export product logs"
```

---

### Task B-38: Core-api gate

This is the final Workstream B verification task from the master plan. Do not start it until A's hardware gate and the Workstream B encoder-ingress gate flag are closed and B-01..B-37 are green.

**Files:**
- Create: `services/core-api/test/contract/operations.test.ts`
- Create: `services/core-api/test/contract/events.test.ts`
- Create: `services/core-api/test/integration/fixture-stack.ts`
- Create: `services/core-api/test/integration/device-smoke.test.ts`
- Create: `services/core-api/test/integration/evidence/b38-template.md`
- Create: `services/core-api/scripts/gate-core-api.mjs`
- Modify: `services/core-api/package.json`

**Interfaces:**
- Produces: one repeatable gate command and an evidence record proving exact ownership plus the master bench flow.
- Consumes: complete B implementation, current A fake/current internal fixtures, C/D/helper/upload/USB fakes, v1 contracts, existing shared/mock regression suites.

- [ ] **Step 1: Write the exact ownership gate and make it fail on omission/excess**

`operations.test.ts` must parse all `operationId`s from `contracts/openapi.yaml`, remove exactly the four `SERVER_SIDE_ONLY_OPERATION_IDS`, assert the remainder is exactly 78, introspect Fastify route metadata, and assert each B operation appears once with the contract method/path and no invented public route other than `/healthz` and two WS upgrades. For every operation, execute at least one declared success and every declared Problem status/code fixture, parsing bodies with shared zod.

`events.test.ts` must assert exactly 22 panel names, exercise every payload union member, exactly five preview variants (`offer`, `answer`, bidirectional `ice` counted once, `close`, `error`), and exactly one B-owned sync message (`sync.hello`). It must fail on missing or extra ownership.

- [ ] **Step 2: Run the new gate tests before wiring the fixture flow**

Run: `pnpm --filter @eduscope/core-api test -- test/contract/operations.test.ts test/contract/events.test.ts`

Expected: FAIL until any missing route fixture/Problem/event producer is corrected; do not weaken counts or exclude a B-owned item.

- [ ] **Step 3: Build the executable fixture stack and smoke procedure**

`fixture-stack.ts` starts loopback-only fake pipeline-manager, STT/slide/question services, quiz-service REST+WS, helper socket, placeholder upload server, fake USB monitor, and core-api with a temp DB/recordings root. `device-smoke.test.ts` drives this single flow over real HTTP/WS:

1. Seed admin and lecturer; login as lecturer, call `getMe`, rotate refresh once.
2. Open panel WS with the access token subprotocol; record the complete initial snapshot and seq values.
3. Start recording; assert HTTP 202 precedes `recording.state{starting}` and fake PM confirmation precedes `{recording}`.
4. Send `SIGTERM` while the fake PM record remains active; assert new HTTP/WS work is rejected, sockets/timers/SSE close, no PM stop command is sent, lifecycle stops in reverse order, and SQLite closes last. Restart core-api against the same DB; assert BR-1 adopts the still-running PM record and WS reconnect gets a coherent snapshot.
5. Pause, resume, and stop; assert two finalized segments, one logical recording, channels isolated, and all resolving events arrive within configured fake deadlines.
6. Fake ffprobe/ffmpeg completes merge; assert library owner scope, authenticated 206 media read, and ready artifact.
7. Insert two USB targets; export to the selected one, observe scoped real-byte progress, and complete.
8. Let placeholder upload disconnect mid-part, persist its acknowledged checkpoint, then invoke the same graceful shutdown; restart core-api, resume the durable offset, complete all parts, and observe queued→uploading→done without duplicate bytes.
9. Reconnect WS; assert full snapshot, monotonic new seq, no duplicate upload/answer projection, and private export/log events absent from another AuthSession.
10. Log out; assert the token/session can no longer use REST or either socket.

The test writes command timestamps, HTTP statuses, event sequence, ids, segment paths/sizes, upload offsets, and PASS/FAIL rows to a temp evidence object; the committed template lists those immutable fields and never contains fabricated PASS data.

- [ ] **Step 4: Add the mechanical gate runner**

`gate-core-api.mjs` must run subprocesses with `shell:false` and stop on the first non-zero exit:

```js
import { spawnSync } from 'node:child_process';

const steps = [
  ['pnpm', ['--filter', '@eduscope/core-api', 'typecheck']],
  ['pnpm', ['--filter', '@eduscope/core-api', 'test']],
  ['pnpm', ['--filter', '@eduscope/shared', 'test']],
  ['pnpm', ['--filter', '@eduscope/api-client', 'test']],
];

for (const [command, args] of steps) {
  const result = spawnSync(command, args, { cwd: new URL('../../..', import.meta.url), stdio: 'inherit', shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
```

Add `"gate:core-api": "node scripts/gate-core-api.mjs"` to the service package scripts. If Windows execution cannot resolve `pnpm` directly, the implementation uses `pnpm.cmd` only when `process.platform === 'win32'`; it must not enable `shell:true`.

- [ ] **Step 5: Run the complete automated Workstream B gate**

Run: `pnpm --filter @eduscope/core-api gate:core-api`

Expected: PASS; core-api typecheck and all tests exit 0; ownership output reports exactly `78 REST / 22 panel events / 5 preview variants / 1 sync.hello`; shared and api-client suites are green; no open handles remain.

- [ ] **Step 6: Run the explicit HTTP/WS evidence procedure**

Start the fixture stack:

```bash
pnpm --filter @eduscope/core-api exec tsx test/integration/fixture-stack.ts
```

Expected: prints only loopback URLs, fixture ids, and `fixture-stack ready`; no credentials are printed.

From a second terminal, prove liveness and a named refusal with curl:

```bash
curl --fail --silent http://127.0.0.1:5000/healthz
curl --silent --header 'Content-Type: application/json' --data '{"username":"gate-lecturer","password":"GatePassphrase1!"}' http://127.0.0.1:5000/api/v1/auth/login
curl --silent --header 'Content-Type: application/json' --data '{}' http://127.0.0.1:5000/api/v1/recording/start
```

Expected: health is `200` with contractVersion `1.0.0`; login is 200 with no password/secret fields; unauthenticated start is a declared 401 Problem. Then run the authenticated HTTP/WS smoke client, which performs the complete flow and writes the evidence record:

```bash
pnpm --filter @eduscope/core-api test -- test/integration/device-smoke.test.ts
```

Expected: PASS; evidence contains login→record→graceful stop/adopt→pause/resume→stop→library/export/upload→graceful stop/resume, reverse lifecycle order with SQLite last, no PM stop during core-api shutdown, ordered WS seq, 206 media proof, and zero unhandled contract elements/open handles.

- [ ] **Step 7: Run the forbidden-pattern and repository-diff checks**

Run: `rg -n "sudo|execSync|shell:\s*true|killall|pkill|create_subprocess_shell" services/core-api/src`

Expected: no matches.

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: only B-38 files are uncommitted for this task; no contract, mock, or unrelated source drift.

- [ ] **Step 8: Commit and stop Workstream B**

```bash
git add services/core-api
git commit -m "test(core-api): gate v1 device workflow"
```

Stop. Do not begin Workstream C, D, E, F, or real-adapter implementation in this plan.

---

## Self-Review

### Master-scope coverage

- B-01..B-38 appear exactly once and in master order; no master task is added, dropped, split, or reassigned.
- Contract ownership remains exactly 78 B-hosted REST operations, 22 B-emitted panel events, five preview variants brokered by B, and B-owned `sync.hello`; four quiz-sync server operations and student surfaces remain D-owned.
- KEEP coverage is preserved at its master task: B-03 (B-05), B-07/B-10 (B-06), B-15 (B-07), B-23 (B-13), B-31/B-33 (B-14), B-32 (B-16), B-27/B-28 (B-17), B-53 (B-19), B-50 (B-22), B-56 (B-24), B-59 (B-25), B-43 (B-27), B-44 (B-28).
- B-18 remains placeholder-only at D-02b; no institute payload or production acceptance is claimed.
- The master-plan encoder-ingress contradiction was updated and gate-flagged in the same run; B-24 consumes the exact corrected internal interface and does not hide the A dependency.

### Placeholder scan

The plan contains no deferred implementation marker, unspecified error handling, generic “write tests” step, or reference to an undefined neighboring interface. Evidence templates intentionally begin unrun; they may not contain a blank or fabricated PASS.

### Type/interface consistency

- Public request/response/event types always come from `@eduscope/shared`; internal fakes use the same typed boundary interfaces as production clients.
- Only `RecordingExecutor`, channel machine, artifact machine, upload machine, AI/quiz executor, and device reducers write their owned state; routes and WS hub do not.
- Public encoder units are Kbps; the PM boundary alone converts to Bps. File metadata is row-based; no filename parsing appears. Every async command returns acceptance before its resolving event.
