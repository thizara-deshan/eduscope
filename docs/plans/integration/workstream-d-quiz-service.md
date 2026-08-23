# Workstream D — Quiz Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the campus-hosted quiz service that serves the existing student Next.js app, owns the seven v1 student/device REST operations and seven D-owned realtime message types, persists authoritative quiz state in PostgreSQL 16, reconnects core-api by durable answer watermark, and proves a 200-student lecture-hall load.

**Architecture:** One Fastify 5 custom Node process binds loopback behind the campus TLS proxy, hands non-API requests to the existing `apps/quiz` Next App Router build, and owns both student and device WebSocket upgrades. PostgreSQL is authoritative for sessions, identities, participants, publications, and answers; an in-process per-session serial executor orders mutation/fan-out boundaries, while the answers table itself is the immutable device replay log. `core-api` remains the device-side projection writer, and `packages/api-client` remains the only future frontend networking boundary; Workstream E, not D, swaps the existing mock clients to real transport.

**Tech Stack:** Node.js >=22.13, TypeScript 5.6, Fastify 5, Next.js 14, PostgreSQL 16, Drizzle ORM 0.44, postgres.js, Zod 3.23, `@fastify/cookie`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/websocket`, Argon2id, Vitest 3, Testcontainers PostgreSQL, and the existing `@eduscope/shared` v1 schemas.

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

### Workstream D fixed decisions and boundaries

- Workstream D is exactly D-01 through D-11 in master order. D-08, D-09, D-10, and D-11 are the final verification tasks and remain last.
- D owns exactly four `openapi.yaml` quiz-sync server operations, three `quiz-app.yaml` student operations, four student server event names, and the server-emitted directions of `sync.answers`, `sync.participants`, and `sync.heartbeat`. B continues to own the client-emitted `sync.hello`; B's client heartbeat is a regression consumer of the shared bidirectional heartbeat shape, not a second ownership row.
- The service uses PostgreSQL 16 and one Fastify/Next custom-server process. TLS terminates at the campus Nginx proxy; the Node listener remains `127.0.0.1:7300` in production.
- Every device connection is device-initiated. The quiz service never stores or calls a device address and never dials into the campus LAN.
- Device auth is the ratified per-device static bearer. Only an Argon2id hash is stored. A bearer scopes every REST/WS action to sessions owned by its `deviceId`; the optional `x-eduscope-contract` value is logged on mismatch and never hard-rejected in v1.
- Student auth is only the opaque `eduscope_participant` cookie with `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/api/student/v1`. No participant credential appears in a URL, JSON body/response, browser-readable store, or log.
- Self-registration validates `^[A-Z]{2}[0-9]{7,8}$` only. No roster, institute adapter, email verification, SSO, or student password is introduced.
- Join codes are six characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, uppercase, case-insensitive on resolve, and unique among open sessions. Collision handling retries generation inside the create-session transaction; it never widens the contracted eight-character maximum.
- One locked answer is enforced by PostgreSQL `UNIQUE(publication_id,student_id)`. Correctness and `pointsAwarded` are stored at acceptance; client timestamps and response speed never affect scoring.
- Answer sequence numbers are monotonic per quiz session, may contain gaps after a losing concurrent/idempotent insert, and are never treated as ids. Replay is `seq > answerWatermark ORDER BY seq`, at most 200 answers per frame.
- Student publish/close/session fan-out and WS snapshots share a per-session serial executor. This is what makes the snapshot atomic relative to live deltas in the approved one-process design; there is no Redis, LISTEN/NOTIFY, second outbox, or horizontal-scaling layer in v1.
- `resolveJoinCode` uses 10 requests/minute/IP; registration uses 5 requests/minute/IP and a hard 1,000-participant session cap, exactly the Phase-3 abuse defaults. Request bodies are capped at 32 KiB. Answer submission relies on the participant/publication unique constraint rather than an unspecified NAT-hostile IP limit.
- The master deliberately assigns no orphan-session auto-close or quiz PII retention job. The Phase-3 6-hour/180-day suggestions remain contract-silent/unratified and are not implemented by D-01..D-11. D-10 supplies backup/restore operations, not a retention policy.
- D does not implement a real `packages/api-client` quiz adapter or modify `apps/quiz` networking. The existing mock and all app tests remain green; Workstream E owns the real adapter/screen swap.
- The Workstream D master-plan gate flag is binding: D-06 must add the shared student wire envelope and literal shared DM-10 rank helper, then move current B ranking onto it. No contract file or generated schema is changed.
- Current-tree prerequisite: B-34 and its fake quiz-service fixtures exist, but a reusable real-D test peer does not (D-08 creates it), and the B-38/C-10 gate artifacts/evidence are absent. Under the master A→B→C→D order, no D implementation task starts until reviewers acknowledge the D gate flag and the existing B/C gates are green.

### Repository and test conventions

- Run TypeScript commands from the repository root unless a step explicitly changes directory. PostgreSQL tests use `postgres:16-alpine` through Testcontainers; Docker unavailability is an environmental failure, never a reason to substitute SQLite.
- Public request/response/event payloads are parsed at ingress and before egress with `@eduscope/shared`. Hand-authored D DTOs may narrow internal rows but may not duplicate public enums.
- Tests inject `Clock`, `IdGenerator`, `JoinCodeGenerator`, and process/network seams. Production uses real UTC time, ULIDs, cryptographic randomness, and real sockets.
- Every task begins with a focused red test, ends with its focused tests plus contract regression green, and ends with exactly one commit. Do not combine adjacent master tasks into one commit.
- Evidence templates commit field names and procedures only. Unexecuted evidence says `NOT RUN — gate failed`; no fabricated pass result enters Git.

---

## File and Responsibility Map

| Area | Files | Responsibility |
|---|---|---|
| Workspace/package | `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `services/quiz-service/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts}` | Add the service to the monorepo; pin scripts/dependencies and build/test boundaries. |
| Composition/config | `services/quiz-service/src/{app,server,config}.ts`, `src/lib/{clock,ids,session-serial}.ts` | Compose Fastify, Next handoff, limits, lifecycle, injected seams, and per-session ordering. |
| Credential hashing | `services/quiz-service/src/device/credentials.ts` | Argon2id hash/verify for deploy-provisioned static device bearers; raw values never persist. |
| PostgreSQL | `src/db/{client,schema,migrate,migrate-cli}.ts`, `migrations/0001_quiz.sql`, `test/helpers/postgres.ts` | Drizzle schema, real PostgreSQL pool, checksum migrations, authoritative tables and constraints. |
| Device REST/auth | `src/device/{auth,session-routes,publication-routes}.ts` | Static-bearer scope, session mint/close, publication publish/close, version mismatch logging. |
| Student identity/REST | `src/student/{cookies,identity,join,registration,answers}.ts` | Resolve without mutation, self-register/rejoin, secure cookie, single-attempt answer transaction. |
| Student realtime | `src/student/{stream,snapshot,serializers}.ts` | Cookie-authenticated WS, atomic snapshot order, private result/terminal fan-out, reconnect replacement. |
| Shared rank/wire correction | `packages/shared/src/{schemas/events,quiz-scoring,index}.ts`, shared tests, `services/core-api/src/modules/quiz/leaderboard.ts` | Contract-valid `{at,seq}` student frames and one B/D DM-10 ranking implementation. |
| Device realtime | `src/device/{stream,replay,batchers}.ts` | Hello validation, replay, live answer/count batches, heartbeat/liveness, one socket per session. |
| Two-backend gate | `services/core-api/test/peers/quiz-sync-peer.ts`, `services/quiz-service/test/integration/device-sync.test.ts` | Run real B+D and prove stale/fail/replay convergence. |
| Abuse/load gate | `test/abuse/policies.test.ts`, `test/load/{join-answer-ws,report}.ts`, evidence template | Exact limits and a measured 200-client join/WS/answer/result burst. |
| Campus operations | `deploy/campus/*`, `services/quiz-service/scripts/*` | Rendered Nginx/systemd config, migration, device provisioning, backup/restore, staging smoke. |
| Final gate | `test/contract/ownership.test.ts`, `test/integration/happy-flow.test.ts`, `scripts/gate-quiz-service.mjs`, evidence template | Exact ownership counts plus one repeatable D workstream gate. |

---

### Task D-01: Service and PostgreSQL foundation

**Files:**
- Create: `services/quiz-service/package.json`
- Create: `services/quiz-service/tsconfig.json`
- Create: `services/quiz-service/tsconfig.build.json`
- Create: `services/quiz-service/vitest.config.ts`
- Create: `services/quiz-service/src/config.ts`
- Create: `services/quiz-service/src/app.ts`
- Create: `services/quiz-service/src/server.ts`
- Create: `services/quiz-service/src/lib/clock.ts`
- Create: `services/quiz-service/src/lib/ids.ts`
- Create: `services/quiz-service/src/lib/session-serial.ts`
- Create: `services/quiz-service/src/device/credentials.ts`
- Create: `services/quiz-service/src/db/client.ts`
- Create: `services/quiz-service/src/db/schema.ts`
- Create: `services/quiz-service/src/db/migrate.ts`
- Create: `services/quiz-service/src/db/migrate-cli.ts`
- Create: `services/quiz-service/migrations/0001_quiz.sql`
- Create: `services/quiz-service/test/helpers/postgres.ts`
- Create: `services/quiz-service/test/helpers/tls-proxy.ts`
- Create: `services/quiz-service/test/fixtures/tls/localhost-cert.pem`
- Create: `services/quiz-service/test/fixtures/tls/localhost-key.pem`
- Create: `services/quiz-service/test/foundation/config.test.ts`
- Create: `services/quiz-service/test/foundation/credentials.test.ts`
- Create: `services/quiz-service/test/foundation/migrations.test.ts`
- Create: `services/quiz-service/test/foundation/server.test.ts`
- Create: `services/quiz-service/test/contract/v1-load.test.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `QuizConfig`; `buildApp(options) -> Promise<FastifyInstance>`; `openDatabase(url) -> {db,sql,close}`; Drizzle table exports; `migrate(sql,migrationsDir)`; `SessionSerial.run<T>(quizSessionId, work) -> Promise<T>`; `hashDeviceCredential`/`verifyDeviceCredential`; public `GET /healthz`.
- Consumes: `contracts/openapi.yaml`/`quiz-app.yaml` version `1.0.0`; `zQuizSyncClientMessage`, `zQuizSyncServerMessage`, `zStudentServerEvent`; PostgreSQL 16; the existing `apps/quiz` directory for production Next handoff.

- [ ] **Step 1: Add the contract/foundation tests first**

`v1-load.test.ts` must read both YAML files, assert `info.version: 1.0.0`, assert the four server-only and three student operation ids exactly, parse one valid client/server/student event with existing shared schemas, and fail if a contract file is mutated locally. `config.test.ts` covers loopback production bind, HTTPS `PUBLIC_ORIGIN`, 32-byte production cookie secret, positive port/session TTL, and rejection of credentials embedded in logs. `server.test.ts` binds D on a random loopback port, fronts it with a Node HTTPS reverse proxy using the committed localhost-only test certificate, forwards `X-Forwarded-Proto/For`, and proves `/healthz` plus the injected Next page handler through TLS while the Node port remains loopback-only. `migrations.test.ts` uses PostgreSQL 16 and proves:

- migration run twice records one checksum row and leaves the schema unchanged;
- one open session per `lecture_session_id`, one open session per `join_code`, one open publication per quiz session, one participant per session/student, one answer per publication/student, and one `(quiz_session_id,seq)`;
- two concurrent `UPDATE quiz_sessions SET next_answer_seq=next_answer_seq+1 RETURNING next_answer_seq` transactions return distinct increasing values;
- two hashes of the same 32-byte token differ, both verify, a wrong token fails, and only hashes—never raw device tokens—appear in `devices`.

- [ ] **Step 2: Run the focused tests and verify red**

Run:

```bash
pnpm --filter @eduscope/quiz-service test -- test/foundation test/contract/v1-load.test.ts
```

Expected: FAIL because the workspace package and foundation files do not exist.

- [ ] **Step 3: Add the workspace/package configuration exactly**

Append `services/quiz-service` to `pnpm-workspace.yaml`. Create `package.json` with these scripts and dependency boundaries, then run `pnpm install --lockfile-only` so the lock change belongs to D-01:

```json
{
  "name": "@eduscope/quiz-service",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.13" },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/src/server.js",
    "migrate": "tsx src/db/migrate-cli.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:contract": "vitest run test/contract",
    "gate": "pnpm typecheck && pnpm test"
  },
  "dependencies": {
    "@eduscope/shared": "workspace:*",
    "@fastify/cookie": "^11",
    "@fastify/cors": "^10",
    "@fastify/rate-limit": "^10",
    "@fastify/websocket": "^11",
    "argon2": "^0.44",
    "drizzle-orm": "^0.44",
    "fastify": "^5",
    "next": "^14.2.18",
    "postgres": "^3.4",
    "ulidx": "^2.4",
    "ws": "^8",
    "zod": "^3.23"
  },
  "devDependencies": {
    "@testcontainers/postgresql": "^10",
    "@types/node": "^22.9",
    "@types/ws": "^8.5",
    "drizzle-kit": "^0.31",
    "tsx": "^4.20",
    "typescript": "^5.6",
    "vitest": "^3",
    "yaml": "^2.6"
  }
}
```

Create the TypeScript/test configs exactly:

```json
// tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true, "types": ["node"] },
  "include": ["src", "test", "vitest.config.ts"]
}
```

```json
// tsconfig.build.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "outDir": "dist" },
  "include": ["src"],
  "exclude": ["test"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    hookTimeout: 60_000,
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
```

- [ ] **Step 4: Add the complete initial migration**

Create `migrations/0001_quiz.sql` with the complete v1 schema below. Do not add leaderboard, roster, device-inbox, retention, or auto-close tables.

```sql
CREATE TABLE devices (
  device_id text PRIMARY KEY,
  credential_hash text NOT NULL,
  hall_display_name varchar(128) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL
);

CREATE TABLE quiz_sessions (
  id text PRIMARY KEY,
  lecture_session_id text NOT NULL,
  device_id text NOT NULL REFERENCES devices(device_id),
  hall_display_name varchar(128) NOT NULL,
  join_code varchar(8) NOT NULL,
  join_url varchar(256) NOT NULL,
  state varchar(16) NOT NULL CHECK (state IN ('open','closed')),
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  next_answer_seq bigint NOT NULL DEFAULT 0 CHECK (next_answer_seq >= 0)
);
CREATE UNIQUE INDEX one_open_quiz_session_per_lecture
  ON quiz_sessions(lecture_session_id) WHERE state='open';
CREATE UNIQUE INDEX one_open_quiz_session_per_join_code
  ON quiz_sessions(join_code) WHERE state='open';
CREATE INDEX quiz_sessions_device_idx ON quiz_sessions(device_id);

CREATE TABLE students (
  id text PRIMARY KEY,
  student_id_number varchar(32) NOT NULL UNIQUE,
  full_name varchar(128) NOT NULL,
  auth_method varchar(32) NOT NULL CHECK (auth_method IN ('self-registered','sso')),
  sso_subject varchar(128),
  credential_ref varchar(128),
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL
);

CREATE TABLE participants (
  id text PRIMARY KEY,
  quiz_session_id text NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES students(id),
  joined_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  connection_state varchar(16) NOT NULL CHECK (connection_state IN ('online','offline')),
  UNIQUE (quiz_session_id, student_id)
);
CREATE INDEX participants_session_idx ON participants(quiz_session_id);

CREATE TABLE participant_sessions (
  token_hash text PRIMARY KEY,
  participant_id text NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES students(id),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX participant_sessions_participant_idx ON participant_sessions(participant_id);

CREATE TABLE publications (
  id text PRIMARY KEY,
  quiz_session_id text NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  question_id text NOT NULL,
  prompt text NOT NULL,
  options jsonb NOT NULL,
  correct_option_id text NOT NULL,
  state varchar(16) NOT NULL CHECK (state IN ('open','closed')),
  published_at timestamptz NOT NULL,
  closed_at timestamptz,
  close_reason varchar(32) CHECK (close_reason IN ('next-question','session-ended','lecturer-closed'))
);
CREATE UNIQUE INDEX one_open_publication_per_quiz_session
  ON publications(quiz_session_id) WHERE state='open';
CREATE INDEX publications_session_time_idx ON publications(quiz_session_id,published_at DESC);

CREATE TABLE answers (
  id text PRIMARY KEY,
  quiz_session_id text NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  publication_id text NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES students(id),
  selected_option_id text NOT NULL,
  is_correct boolean NOT NULL,
  points_awarded integer NOT NULL CHECK (points_awarded IN (0,10)),
  response_time_ms integer NOT NULL CHECK (response_time_ms >= 0),
  submitted_at timestamptz NOT NULL,
  seq bigint NOT NULL CHECK (seq > 0),
  UNIQUE (publication_id, student_id),
  UNIQUE (quiz_session_id, seq)
);
CREATE INDEX answers_replay_idx ON answers(quiz_session_id,seq);
```

Mirror every table/index in `src/db/schema.ts`; JSON options are typed as `Array<{id:string;label:'A'|'B'|'C'|'D';text:string}>`. `src/db/migrate.ts` creates `quiz_schema_migrations(name,checksum,applied_at)`, obtains one transaction-scoped advisory lock, applies sorted `.sql` files once, and rejects a checksum change to an already-applied migration.

- [ ] **Step 5: Implement config, database lifecycle, and the custom-server seam**

`QuizConfig` contains `nodeEnv`, `host`, `port`, `databaseUrl`, `publicOrigin`, `cookieSecret`, `participantSessionTtlSec`, `nextAppDir`, and `logLevel`. Production rejects a non-loopback host, a non-HTTPS public origin, and cookie secrets shorter than 32 characters. Defaults are `127.0.0.1:7300`, `86400` seconds, and `../../apps/quiz` resolved from the service directory.

`device/credentials.ts` contains only `argon2.hash(token,{type:argon2.argon2id})` and `argon2.verify(hash,token)`. It rejects tokens shorter than 32 characters before hashing and never logs/caches either argument.

`buildApp` opens/migrates the injected database, decorates `db`, `sql`, `clock`, `ids`, and `sessionSerial`, constructs Fastify with `trustProxy:'127.0.0.1'` (only the loopback Nginx proxy may supply student IPs), registers a public `/healthz` returning `{status:'ok',contractVersion:'1.0.0'}`, caps bodies at 32 KiB, and accepts an optional `pageHandler(req,res)` seam. Production `server.ts` prepares `next({dev:false,dir:config.nextAppDir})`, passes `nextApp.getRequestHandler()` as that seam, and hijacks only the Fastify not-found handler after API/WS routes. Fastify shutdown closes sockets before postgres.js; `SIGTERM` and `SIGINT` share one idempotent shutdown promise.

- [ ] **Step 6: Run the D-01 tests**

Run:

```bash
pnpm --filter @eduscope/quiz-service typecheck
pnpm --filter @eduscope/quiz-service test -- test/foundation test/contract/v1-load.test.ts
```

Expected: PASS; Testcontainers reports PostgreSQL 16, the migration count remains one after the second run, every partial unique test is rejected with SQLSTATE `23505`, concurrent sequence results are distinct/ordered, `/healthz` is 200, and the test page handler proves the server can sit behind an HTTPS proxy without binding publicly.

- [ ] **Step 7: Commit D-01**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml services/quiz-service
git commit -m "feat(quiz-service): add postgres service foundation"
```

---

### Task D-02: Device quiz-session sync REST

**Files:**
- Create: `services/quiz-service/src/contracts/problem.ts`
- Create: `services/quiz-service/src/device/auth.ts`
- Create: `services/quiz-service/src/device/session-routes.ts`
- Create: `services/quiz-service/test/device/auth.test.ts`
- Create: `services/quiz-service/test/device/sessions.test.ts`
- Create: `services/quiz-service/test/contract/device-sessions.contract.test.ts`
- Modify: `services/quiz-service/src/app.ts`

**Interfaces:**
- Produces: `authenticateDevice(request) -> DevicePrincipal`; `registerDeviceSessionRoutes(app)`; D-owned `quizSyncCreateSession` and `quizSyncCloseSession`.
- Consumes: D-01 `hashDeviceCredential`/`verifyDeviceCredential`; `zQuizSessionCreateRequest`, `zQuizSessionCreateResponse`, `zProblem`; injected `JoinCodeGenerator.next() -> string`; `SessionSerial`.

- [ ] **Step 1: Write failing auth/session/contract tests**

Cover missing/wrong/disabled bearer; scope mismatch; Argon2 hash verification; secret absence from response/logs; optional contract header absent/matching/mismatching; create success; same-lecture idempotency; generated-code collision retry; cross-device lecture collision; body validation; close; repeated close; close of another device's session; and closing an open publication with `session-ended`. The contract test parses every 201/Problem body and asserts operation metadata exactly matches:

```text
POST /device/v1/quiz-sessions                         quizSyncCreateSession
POST /device/v1/quiz-sessions/:quizSessionId/close    quizSyncCloseSession
```

- [ ] **Step 2: Run and verify red**

Run:

```bash
pnpm --filter @eduscope/quiz-service test -- test/device/sessions.test.ts test/device/auth.test.ts test/contract/device-sessions.contract.test.ts
```

Expected: FAIL with unregistered routes/modules.

- [ ] **Step 3: Implement the exact device-auth boundary**

Use `Authorization: Bearer <token>` only. Load enabled devices and verify their Argon2id hashes without logging the header/token/hash. Return a generic 401 `application/problem+json` body `{status:401,code:'not-authorized',title:'Device authentication failed'}` for every missing/invalid/disabled credential. Attach only `{deviceId,hallDisplayName}` to the request. `x-eduscope-contract !== undefined && !== '1.0'` writes one warning containing device id, method, path, received value, and expected `1.0`; it continues normally.

- [ ] **Step 4: Implement create/close under the session serial boundary**

Create validates with the shared request schema, requires `body.deviceId === principal.deviceId`, then runs under `SessionSerial.run(lectureSessionId, ...)`:

1. Select an existing open session by `lectureSessionId`; return its stored response only if its `deviceId` matches.
2. Generate a six-character code and attempt the insert. Retry only SQLSTATE `23505` from `one_open_quiz_session_per_join_code`, at most 16 candidates; any other uniqueness conflict re-selects the idempotent row or returns `409 conflict`.
3. Mint a ULID and `joinUrl = new URL('/j/'+joinCode, PUBLIC_ORIGIN).toString()`.
4. Return status 201 even for the idempotent replay, matching the contract.

Close locks/scopes the session, updates any open publication to `closed`, `closed_at=clock.now()`, `close_reason='session-ended'`, then closes the session in the same transaction. A repeat returns 204 without changing the original timestamps. D-06 later attaches fan-out to the existing post-commit domain notification seam; D-02 tests assert the database transition now.

- [ ] **Step 5: Run focused and shared regressions**

Run:

```bash
pnpm --filter @eduscope/quiz-service test -- test/device test/contract/device-sessions.contract.test.ts
pnpm --filter @eduscope/shared test
```

Expected: PASS; duplicate creates return the same id/code/url, collision injection consumes the next code, two closes are 204, mismatch header produces exactly one warning, and no captured output contains the bearer.

- [ ] **Step 6: Commit D-02**

```bash
git add services/quiz-service
git commit -m "feat(quiz-service): sync device quiz sessions"
```

---

### Task D-03: Device publication sync REST

**Files:**
- Create: `services/quiz-service/src/device/publication-routes.ts`
- Create: `services/quiz-service/test/device/publications.test.ts`
- Create: `services/quiz-service/test/contract/device-publications.contract.test.ts`
- Modify: `services/quiz-service/src/app.ts`
- Modify: `services/quiz-service/src/device/session-routes.ts`

**Interfaces:**
- Produces: D-owned `quizSyncPublish`, `quizSyncClosePublication`; post-commit domain notifications `publication.opened`, `publication.closed`, `session.closed` containing ids only.
- Consumes: `zPublicationPush`, `zPublicationCloseRequest`, `zProblem`; device principal/session scope; `SessionSerial`.

- [ ] **Step 1: Write failing publish/close/contract tests**

Test valid 201, invalid option count/label/id, correct option not in options, session closed, wrong-device session, identical replay, changed replay upsert, close previous on next publish, exactly one open publication, path/body id mismatch, explicit close, repeated close preserving first close values, and the close-vs-next-publish serialization. Assert no open-question projection/notification contains `correctOptionId`, `isCorrect`, another participant, or leaderboard data. Parse both declared Problem responses with `zProblem`.

- [ ] **Step 2: Run and verify red**

Run:

```bash
pnpm --filter @eduscope/quiz-service test -- test/device/publications.test.ts test/contract/device-publications.contract.test.ts
```

Expected: FAIL with 404 for both operations.

- [ ] **Step 3: Implement publish as one ordered transaction**

Within `SessionSerial.run(quizSessionId, ...)`, validate the shared payload plus the invariant `correctOptionId` belongs to `options`, lock/scoped-load the open quiz session, and transactionally:

1. Close any different open publication using `closed_at = incoming.publishedAt`, `close_reason='next-question'`.
2. Insert the incoming row. On the same `publicationId`, update the replicated question fields without reopening a closed row; a conflicting session/device returns 409.
3. Commit before emitting ids-only `publication.closed` then `publication.opened` notifications.

The 201 body is empty because the contract declares no response schema. Correctness remains stored in the server-only row and is never passed to the open-question serializer.

- [ ] **Step 4: Implement authoritative idempotent close**

Require path id equals `body.publicationId`, lock and scope through the parent session/device, then set `state='closed'`, `closed_at=body.closedAt`, and `close_reason=body.closeReason` only when currently open. Repeats return 204 and preserve the first authoritative close. Emit `publication.closed` only for the transition, after commit. D-05 uses this same `SessionSerial` key, making answer/close ordering deterministic.

- [ ] **Step 5: Run focused and contract regressions**

Run:

```bash
pnpm --filter @eduscope/quiz-service test -- test/device test/contract/device-publications.contract.test.ts
pnpm --filter @eduscope/core-api test -- test/quiz/publication.test.ts
```

Expected: PASS; the current B client payloads are accepted unchanged, the next publication closes the prior one, repeats are idempotent, and an open-question serialization audit contains no correctness field.

- [ ] **Step 6: Commit D-03**

```bash
git add services/quiz-service
git commit -m "feat(quiz-service): sync question publications"
```

---

### Task D-04: Join resolution and participant registration

**Files:**
- Create: `services/quiz-service/src/student/cookies.ts`
- Create: `services/quiz-service/src/student/identity.ts`
- Create: `services/quiz-service/src/student/join.ts`
- Create: `services/quiz-service/src/student/registration.ts`
- Create: `services/quiz-service/test/student/join.test.ts`
- Create: `services/quiz-service/test/student/registration.test.ts`
- Create: `services/quiz-service/test/contract/student-registration.contract.test.ts`
- Modify: `services/quiz-service/src/app.ts`

**Interfaces:**
- Produces: D-owned `resolveJoinCode`, `registerParticipant`; `IdentityProvider`; `issueParticipantCookie`, `resolveParticipantCookie`; post-commit `participant.joined` notification.
- Consumes: `zResolveJoinCodeResponse`, `zRegisterParticipantRequest`, `zRegisterParticipantResponse`, `zQuizAppProblem`; D-02 sessions; injected crypto/clock/id seams.

- [ ] **Step 1: Write failing join/registration/cookie/Problem tests**

Cover lowercase/mixed-case resolution; open/closed/not-found; anonymous/returning cookie; resolve makes zero inserts/updates; 10/minute/IP resolution limit; valid 9- and 10-character student ids; lowercase/malformed id; blank/whitespace name; 128-character name boundary; first registration; same-browser and new-cookie rejoin; same student id updates only that student's display name; session closed; 1,000-participant cap; concurrent duplicate registration; cookie attributes; invalid/expired/tampered cookie; and field pointers `/fullName` and `/studentIdNumber`. Every success and every declared 404/409/422/503 body must parse with shared quiz-app zod.

- [ ] **Step 2: Run and verify red**

Run:

```bash
pnpm --filter @eduscope/quiz-service test -- test/student/join.test.ts test/student/registration.test.ts test/contract/student-registration.contract.test.ts
```

Expected: FAIL because the student routes are not registered.

- [ ] **Step 3: Implement the identity and cookie seams**

Use this exact provider boundary; v1 ships only `SelfRegistrationIdentityProvider`:

```ts
export interface ResolvedIdentity {
  studentIdNumber: string;
  fullName: string;
}

export interface IdentityProvider {
  readonly id: 'self-registration' | 'university-sso';
  resolve(input: unknown): Promise<ResolvedIdentity | { redirect: URL }>;
}
```

`SelfRegistrationIdentityProvider.resolve` parses `zRegisterParticipantRequest`, trims the full name, and maps issues to the two closed quiz-app Problem codes with the exact field pointers. It does no roster/API lookup.

Register `@fastify/cookie` with `cookieSecret`. Generate 32 random bytes as base64url; store only `sha256(token)` and set exactly:

```ts
reply.setCookie('eduscope_participant', token, {
  secure: true,
  httpOnly: true,
  sameSite: 'lax',
  path: '/api/student/v1',
  maxAge: config.participantSessionTtlSec,
});
```

Cookie resolution hashes the value, loads its unexpired row plus participant/student/session, and otherwise behaves as anonymous for join resolution or 401 before the student WS/answer surface. The raw token never enters structured logs.

- [ ] **Step 4: Implement resolve without writes and idempotent registration**

`GET /api/student/v1/join-codes/:joinCode` uppercases the path value, uses the exact registration policy constants from `zRegistrationPolicy`, and determines `returning` only when the valid cookie belongs to that resolved session. Configure its route rate limit as `{max:10,timeWindow:60_000,keyGenerator:req.ip}` and map exhaustion to `503 quiz.unavailable`; no participant/session/student timestamp is updated by resolve.

Registration runs under `SessionSerial.run(quizSessionId, ...)` and one DB transaction. A missing/unknown session maps to `503 quiz.unavailable` because the closed quiz-app Problem catalog declares no registration 404; a known closed session maps to `409 quiz.session-closed`:

1. Lock/load the session and reject closed/missing.
2. Reject count >=1,000 with `503 quiz.unavailable`.
3. Upsert `students` by `student_id_number`, setting `full_name` and `last_seen_at` on rejoin while preserving the same id/history.
4. Insert `participants`; on `(quiz_session_id,student_id)` conflict re-select the stored row and set `outcome:'rejoined'`.
5. Insert the hashed participant-session token with the configured expiry.
6. Commit, set the cookie, emit `participant.joined` only for a new participant, and return the shared response.

Configure registration to 5 requests/minute/IP. Concurrent requests for the same student return one participant id, one `created`, and one `rejoined` without leaking a SQL error.

- [ ] **Step 5: Run focused, contract, and mock honesty tests**

Run:

```bash
pnpm --filter @eduscope/quiz-service test -- test/student/join.test.ts test/student/registration.test.ts test/contract/student-registration.contract.test.ts
pnpm --filter @eduscope/shared test -- quiz-rest-coverage.test.ts
pnpm --filter @eduscope/api-client test -- student-quiz-v0-6.test.ts
```

Expected: PASS; resolution changes no database row, registration/rejoin returns the same participant, cookie flags match the contract, rate/cap failures are contracted Problems, and the mock remains unchanged/green.

- [ ] **Step 6: Commit D-04**

```bash
git add services/quiz-service
git commit -m "feat(quiz-service): register quiz participants"
```

---

### Task D-05: Answer ingestion and scoring

**Files:**
- Create: `services/quiz-service/src/student/answers.ts`
- Create: `services/quiz-service/test/student/answers.test.ts`
- Create: `services/quiz-service/test/contract/student-answers.contract.test.ts`
- Modify: `services/quiz-service/src/app.ts`
- Modify: `services/quiz-service/src/device/publication-routes.ts`

**Interfaces:**
- Produces: D-owned `submitAnswer`; immutable answer rows/sequence; post-commit `answer.accepted` notification with the stored answer id/seq.
- Consumes: participant cookie principal; `zSubmitAnswerRequest`, `zSubmitAnswerResponse`, `zQuizAppProblem`; D-03 publication close; `SessionSerial`.

- [ ] **Step 1: Write failing answer/score/race/contract tests**

Test unauthenticated cookie; cookie scoped to another quiz session; valid option; invalid ULID/option; publication closed; session closed; accepted response; same-option retry; different-option retry returns the first stored option; simulated reply loss then retry; correctness/0-or-10 points stored at submit; response time from server receive time; negative clock skew clamped to zero; two/20 concurrent submissions; strictly increasing per-session seq across publications; allowed seq gaps on losing duplicates; answer-before-close; close-before-answer; and no student result emitted at acceptance. Parse 200/409/422/503 with quiz-app schemas.

- [ ] **Step 2: Run and verify red**

Run:

```bash
pnpm --filter @eduscope/quiz-service test -- test/student/answers.test.ts test/contract/student-answers.contract.test.ts
```

Expected: FAIL with 404 for `submitAnswer`.

- [ ] **Step 3: Implement the single-attempt transaction**

After cookie auth, parse the shared body and identify the participant's quiz session. Enter `SessionSerial.run(quizSessionId, ...)`, record `receiveAt = clock.now()` inside that ordered section, and transactionally:

1. Lock the publication row and load its session. A missing publication or one outside the cookie participant's session maps to `409 question.closed` (the closed answer Problem catalog deliberately exposes no publication lookup); reject a closed quiz session or closed publication with the same code before allocating a sequence.
2. Parse the stored JSON options and reject a selected id not present with `422 answer.invalid-option`.
3. Re-select an existing `(publicationId,studentId)` answer first; if present, return `already-accepted` with its stored option without incrementing the session counter.
4. Increment `next_answer_seq` with `UPDATE ... RETURNING`; calculate `isCorrect`, `pointsAwarded = isCorrect ? 10 : 0`, and `responseTimeMs = max(0, receiveAt-publishedAt)`.
5. Insert the answer. Keep the SQL unique constraint as the final concurrent guard; on `23505`, re-select and return the stored answer.
6. Commit before emitting `answer.accepted`. Return only `{outcome,selectedOptionId}`.

Both answer and D-03 close operations use the same session serial key. The operation that enters the ordered section first wins; a close never retroactively deletes/rewrites an accepted answer, and an answer that enters after close receives `409 question.closed`.

- [ ] **Step 4: Prove idempotency under real concurrent PostgreSQL clients**

Use 20 separate HTTP requests and at least four postgres.js connections. Assert exactly one answer row, one accepted option, one immutable correctness value, and no unhandled `23505`. Repeat the test with the response intentionally discarded before retry. Confirm `sync` notification contains the stored `seq` but the REST response does not expose it.

- [ ] **Step 5: Run focused and B payload regressions**

Run:

```bash
pnpm --filter @eduscope/quiz-service test -- test/student/answers.test.ts test/contract/student-answers.contract.test.ts
pnpm --filter @eduscope/core-api test -- test/quiz/projections.test.ts test/quiz/sync.test.ts
```

Expected: PASS; all concurrent callers converge on the first option, both race orders are deterministic, stored points are 0/10, and current B still parses the answer projection shape D-07 will emit.

- [ ] **Step 6: Commit D-05**

```bash
git add services/quiz-service
git commit -m "feat(quiz-service): ingest locked quiz answers"
```

---

### Task D-06: Student realtime snapshot and fan-out

**Files:**
- Create: `packages/shared/src/quiz-scoring.ts`
- Create: `packages/shared/test/quiz-scoring.test.ts`
- Create: `packages/shared/test/student-event-envelope.test.ts`
- Create: `services/quiz-service/src/student/serializers.ts`
- Create: `services/quiz-service/src/student/snapshot.ts`
- Create: `services/quiz-service/src/student/stream.ts`
- Create: `services/quiz-service/test/student/stream.test.ts`
- Create: `services/quiz-service/test/student/privacy.test.ts`
- Create: `services/quiz-service/test/contract/student-events.contract.test.ts`
- Modify: `packages/shared/src/schemas/events.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `services/core-api/src/modules/quiz/leaderboard.ts`
- Modify: `services/core-api/test/quiz/projections.test.ts`
- Modify: `services/quiz-service/src/app.ts`
- Modify: `services/quiz-service/src/device/session-routes.ts`
- Modify: `services/quiz-service/src/device/publication-routes.ts`
- Modify: `services/quiz-service/src/student/registration.ts`

**Interfaces:**
- Produces: `zStudentEventEnvelope`/`StudentEventEnvelope`; `scoreQuizParticipants(inputs) -> ScoredQuizParticipant[]`; cookie-authenticated `GET /api/student/v1/stream`; `StudentStreamHub` fan-out API.
- Consumes: all D-02..D-05 post-commit notifications/rows; `zStudentServerEvent`; participant cookie; `SessionSerial`.

- [ ] **Step 1: Write the shared correction tests required by the master gate flag**

`student-event-envelope.test.ts` asserts each of the four student event variants requires an ISO instant with offset and a non-negative integer `seq`; missing/negative/fractional sequence or missing-offset time fails. `quiz-scoring.test.ts` asserts points `correct*10`, accuracy 0 for no answers, rounded average response, deterministic student-id ordering within a point tie, and dense ranks `1,1,2`.

Extend B's projection test so one fixture is passed through B's `getLeaderboard` and the shared helper, with deep-equal entries. This is the executable INV-LB-2 parity witness.

- [ ] **Step 2: Run the gate-correction tests and verify red**

Run:

```bash
pnpm --filter @eduscope/shared test -- student-event-envelope.test.ts quiz-scoring.test.ts
pnpm --filter @eduscope/core-api test -- test/quiz/projections.test.ts
```

Expected: FAIL because the shared envelope/helper exports do not exist and B still uses its private ranking loop.

- [ ] **Step 3: Add the exact shared wire envelope and rank helper**

Add beside the existing student schemas:

```ts
export const zStudentEventEnvelope = zStudentServerEvent.and(
  z.object({
    at: z.string().datetime({ offset: true }),
    seq: z.number().int().nonnegative(),
  }),
);
export type StudentEventEnvelope = z.infer<typeof zStudentEventEnvelope>;
```

Create the helper with this public API and algorithm:

```ts
export interface QuizScoreInput {
  studentIdNumber: string;
  displayName: string;
  answered: number;
  correct: number;
  responseMsTotal: number;
}

export interface ScoredQuizParticipant extends QuizScoreInput {
  points: number;
  accuracy: number;
  avgResponseMs: number;
  rank: number;
}

export function scoreQuizParticipants(
  inputs: readonly QuizScoreInput[],
): ScoredQuizParticipant[] {
  const sorted = inputs.map((row) => ({
    ...row,
    points: row.correct * 10,
    accuracy: row.answered === 0 ? 0 : row.correct / row.answered,
    avgResponseMs: row.answered === 0 ? 0 : Math.round(row.responseMsTotal / row.answered),
    rank: 0,
  })).sort((a, b) => b.points - a.points || a.studentIdNumber.localeCompare(b.studentIdNumber));
  let rank = 0;
  let priorPoints: number | null = null;
  return sorted.map((row) => {
    if (priorPoints === null || priorPoints !== row.points) rank += 1;
    priorPoints = row.points;
    return { ...row, rank };
  });
}
```

Export both from `packages/shared/src/index.ts`. Replace only B's private map/sort/rank block with `scoreQuizParticipants([...byStudent.values()])`; preserve B's public response and stale/computedAt logic.

- [ ] **Step 4: Write failing student WS snapshot/fan-out/privacy tests**

Using raw `ws`, assert cookie-only upgrade auth; no query/body credential; exact cold-connect order `quiz.session`, `quiz.participant{online}`, `quiz.question`, optional `quiz.result`; contiguous per-connection seq starting at 0; current open/closed/none variants; own selected option id; publish delta; close ordering (`quiz.question{closed}` before personalized `quiz.result`); missed result; both `rankState` union shapes parse in contract fixtures while the synchronous live close path emits `current`; session terminal participated/none variants; one student's payload never contains another's id/name/answer/rank; no open payload contains `correctOptionId`; reconnect replaces old socket and snapshot wholesale; old socket close cannot mark the new one offline; and a publish/close racing connect is represented either in the snapshot or a later delta, never omitted/stale.

- [ ] **Step 5: Run the student stream tests and verify red**

Run:

```bash
pnpm --filter @eduscope/quiz-service test -- test/student/stream.test.ts test/student/privacy.test.ts test/contract/student-events.contract.test.ts
```

Expected: FAIL because `/api/student/v1/stream` and serializers are absent.

- [ ] **Step 6: Implement one serializer and the atomic snapshot**

`serializers.ts` is the sole student-facing row mapper. It emits open/closed questions with only publication id, prompt, options, and that participant's selected option id; result payloads include the contracted correct option only after close. Aggregate all accepted answers for the session, call `scoreQuizParticipants`, and select only the current student's row/rank. A student with no answer gets the contracted missed result for a closed current publication and terminal `participationState:'none'` when answered count is zero.

`snapshot.ts` performs one repeatable-read transaction for the cookie principal and returns un-enveloped `StudentServerEvent[]` in the exact §5.1 order. It never writes connection state; the hub owns that transition.

- [ ] **Step 7: Implement the hub and wire all post-commit transitions**

`StudentStreamHub.attach` runs under the session serial key, obtains the snapshot, supersedes any existing socket for that participant, registers the new socket, sends every snapshot frame through `zStudentEventEnvelope`, then marks the participant online. Each connection owns its own `seq` counter and serial socket-write queue. On close/ping timeout, mark offline only if the registry still points at that socket; debounce DB `last_seen_at` writes to at most one/10 seconds.

Within the same session serial boundary after DB commit:

- publication open broadcasts one `quiz.question{open}`;
- publication close broadcasts `quiz.question{closed}`, then sends one private `quiz.result` per participant;
- session close first completes any publication-close result fan-out, then sends each private terminal `quiz.session`;
- registration/connection changes feed D-07's participant-count seam but student `quiz.participant` remains own-only;
- answer acceptance sends no student event.

Validate every outgoing frame; a serializer/schema failure logs ids only and closes the affected socket rather than emitting an uncontracted payload.

- [ ] **Step 8: Run D-06 and cross-workstream parity regressions**

Run:

```bash
pnpm --filter @eduscope/shared test
pnpm --filter @eduscope/core-api test -- test/quiz/projections.test.ts
pnpm --filter @eduscope/quiz-service test -- test/student test/contract/student-events.contract.test.ts
pnpm --filter @eduscope/api-client test
pnpm --filter @eduscope/quiz test
```

Expected: PASS; all four event variants validate only inside `{at,seq}` envelopes, cold/reconnect snapshots are atomic, privacy scans find no cross-participant data, B and D produce identical dense ranks, and mock/app suites remain green.

- [ ] **Step 9: Commit D-06**

```bash
git add packages/shared services/core-api/src/modules/quiz/leaderboard.ts services/core-api/test/quiz/projections.test.ts services/quiz-service
git commit -m "feat(quiz-service): stream private student quiz state"
```

---

### Task D-07: Device answer and participant stream

**Files:**
- Create: `services/quiz-service/src/device/replay.ts`
- Create: `services/quiz-service/src/device/batchers.ts`
- Create: `services/quiz-service/src/device/stream.ts`
- Create: `services/quiz-service/test/device/replay.test.ts`
- Create: `services/quiz-service/test/device/stream.test.ts`
- Create: `services/quiz-service/test/contract/device-stream.contract.test.ts`
- Modify: `services/quiz-service/src/app.ts`
- Modify: `services/quiz-service/src/student/answers.ts`
- Modify: `services/quiz-service/src/student/registration.ts`
- Modify: `services/quiz-service/src/student/stream.ts`

**Interfaces:**
- Produces: cookie-independent device-authenticated `GET /api/device/v1/stream`; D-owned `sync.answers`, `sync.participants`, `sync.heartbeat`; `DeviceStreamHub.enqueueAnswer/markParticipantCounts`.
- Consumes: B-owned `sync.hello` and client heartbeat; answer replay rows; device principal/session scope; `SessionSerial`; timers `5s` heartbeat, `20s` server drop, `1s` coalescing.

- [ ] **Step 1: Write failing hello/replay/live/liveness/contract tests**

Cover missing/wrong bearer at upgrade; non-hello first frame; invalid hello; auth `deviceId` mismatch; wrong-device session; watermark 0/middle/max; ordered replay split 200/200/remainder; no rows at/below watermark; live answer coalescing; participant count coalescing; joined vs online counts; heartbeat every 5 seconds; inbound heartbeat refreshing liveness; silent client closed after >20 seconds; second hello/socket superseding the first; old socket cannot receive live frames; restart/reconnect; and schema validation of exactly the three server message names. Capture the current B client hello/heartbeat and parse them without changing B.

- [ ] **Step 2: Run and verify red**

Run:

```bash
pnpm --filter @eduscope/quiz-service test -- test/device/replay.test.ts test/device/stream.test.ts test/contract/device-stream.contract.test.ts
```

Expected: FAIL because the device stream route/hub do not exist.

- [ ] **Step 3: Implement replay directly from authoritative answers**

`replayAnswers(db,quizSessionId,watermark)` joins answers→students, selects `seq > watermark ORDER BY seq`, maps exactly:

```ts
{
  seq, answerId, publicationId,
  studentIdNumber, studentDisplayName,
  selectedOptionId, isCorrect, responseTimeMs, submittedAt
}
```

and yields chunks of at most 200. It never writes an outbox/replay marker and never includes `pointsAwarded`, cookie tokens, or identities outside that quiz session.

- [ ] **Step 4: Implement the device hub and batchers**

Authenticate bearer during upgrade, but do not bind a session until the first parsed frame is `sync.hello`. Within `SessionSerial.run(quizSessionId, ...)`, verify device/session scope, send all replay chunks, supersede the previous socket, then register this socket for live flow; answers accepted during replay wait behind the same serial boundary and therefore cannot fall between replay and registration.

Maintain per-session in-memory pending answer ids and dirty participant counts. Flush at most once per 1,000 ms; split answer arrays at 200. If no socket exists, discard pending memory because PostgreSQL remains the replay log. Send server heartbeat every 5,000 ms, record any valid client heartbeat as liveness, and policy-close a socket silent for more than 20,000 ms. Every outgoing message passes `zQuizSyncServerMessage` before serialization.

Registration changes joined count; student attach/detach changes online count. Compute both from PostgreSQL after the 10-second last-seen debounce does not affect the immediate in-memory registry truth. D-05 acceptance enqueues only after commit.

- [ ] **Step 5: Prove disconnect/reconnect and no-gap behavior**

Disconnect the device after watermark 2, accept answers 3–207 with no socket, reconnect with 2, and assert frames contain 3–202 then 203–207 in order. Accept answer 208 while replay is attaching and assert it appears either in replay or exactly one live batch. Reconnect with 208 and assert no answer frame. Confirm participants/heartbeat restore independently.

- [ ] **Step 6: Run focused plus current B client regressions**

Run:

```bash
pnpm --filter @eduscope/quiz-service test -- test/device test/contract/device-stream.contract.test.ts
pnpm --filter @eduscope/core-api test -- test/quiz/sync.test.ts test/contract/sync-hello.contract.test.ts
```

Expected: PASS; every replay row above the watermark is ordered exactly once on that connection, frames contain at most 200 answers, live/count updates are coalesced to one flush/second, heartbeat/drop/supersede behavior is deterministic, and current B emits a valid hello first.

- [ ] **Step 7: Commit D-07**

```bash
git add services/quiz-service
git commit -m "feat(quiz-service): replay device quiz projections"
```

---

### Task D-08: DR-22 two-backend integration gate

This is the first final verification task from the master plan. It adds no public surface and must not start until D-01..D-07 are green and current B-34 tests pass.

**Files:**
- Create: `services/core-api/test/peers/quiz-sync-peer.ts`
- Create: `services/quiz-service/test/integration/device-sync.test.ts`
- Create: `services/quiz-service/test/integration/evidence/d08-template.md`
- Modify: `services/quiz-service/vitest.config.ts`

**Interfaces:**
- Produces: `startCoreQuizSyncPeer(options)` test-only peer; dated D-08 convergence evidence.
- Consumes: real B `QuizSessionMachine`, `QuizSyncStream`, answer projection DB/watermark, and REST client; real D REST/WS/Postgres; only B's existing PM/AI/hardware fakes.

- [ ] **Step 1: Extract a reusable B quiz-sync test peer without changing production**

Move the repeated setup from current `services/core-api/test/quiz/sync.test.ts` into `test/peers/quiz-sync-peer.ts`. The exported peer must:

- create a temporary B SQLite DB/provisioning file with a caller-supplied real D base URL, device id, and bearer;
- start current fake pipeline-manager and AI services only;
- build/start real core-api and seed one lecturer/storage volume;
- expose `startRecordingAndConfirm`, `publishQuestion`, `advanceClock`, `snapshotQuizSession`, `listAnswerProjections`, `watermark`, and `close`;
- never fake D REST/WS and never change any B production source.

Keep current B tests consuming the peer so extraction itself is proven behavior-preserving.

- [ ] **Step 2: Write the failing real B+D integration test**

Start PostgreSQL 16, real D on a random loopback port, and the B peer using a provisioned bearer hash. Drive:

1. B recording start creates the D quiz session and B opens `sync.hello{watermark:0}`.
2. Register three real student participants, open three student sockets, publish through B, and submit two answers.
3. Wait for B projections/watermark 2 and exact joined count 3.
4. Put D's device-stream test gate offline and terminate the active device socket. Advance B 20 seconds; assert B session/publication are `stale`, rows remain, and recording is still `recording`.
5. Submit two more student answers while B is disconnected; both REST calls succeed and D seq reaches 4.
6. Advance B to 65 seconds since last activity; assert `failed`, `quiz.sync-stale` alert, projector/publication data retained, recording untouched.
7. Re-enable the D stream, advance B's reconnect backoff, and wait for a new hello with watermark 2.
8. Assert replay contains seq 3/4, B watermark becomes 4, stale/alert clears, participants restore, and a heartbeat returns sync activity.
9. Deep-compare D authoritative answers with B projections field-by-field after removing D-only `studentId`, `pointsAwarded`, `quizSessionId`, and `seq`; assert no duplicate `(publicationId,studentIdNumber)`.

- [ ] **Step 3: Run once and verify the intended red boundary**

Run:

```bash
pnpm --filter @eduscope/quiz-service test -- test/integration/device-sync.test.ts
```

Expected: FAIL until the B peer and D test-only stream fault gate are wired; it must not pass against `FakeQuizService`.

- [ ] **Step 4: Wire only test seams and make the full loop green**

The D `buildApp` option may accept `deviceUpgradeAllowed?: () => boolean`; production omits it and always allows authenticated upgrades. The B peer uses existing injected fake clock/PM/AI seams. Do not add a production admin/fault endpoint, sleep in the test, or shorten contract timers in source.

- [ ] **Step 5: Execute the DR-22 gate and record evidence**

Run:

```bash
pnpm --filter @eduscope/core-api test -- test/quiz/sync.test.ts test/contract/sync-hello.contract.test.ts
pnpm --filter @eduscope/quiz-service test -- test/integration/device-sync.test.ts
```

Expected: both commands PASS. D-08 output/evidence records commit, PostgreSQL version, ids, hello watermarks `[0,2]`, link cuts at 20/65 seconds, B state transitions `synced→stale→failed→synced`, D/B row counts/hashes, joined/online counts, heartbeat recovery, and `recordingState:'recording'` throughout. It contains no bearer, student name/id, prompt, or answer text.

- [ ] **Step 6: Commit D-08**

```bash
git add services/core-api/test services/quiz-service
git commit -m "test(quiz-service): verify two-backend sync recovery"
```

---

### Task D-09: Abuse controls and 200-client load gate

This is the second final verification task from the master plan. It measures the ratified capacity without inventing a latency SLA.

**Files:**
- Create: `services/quiz-service/test/abuse/policies.test.ts`
- Create: `services/quiz-service/test/load/join-answer-ws.ts`
- Create: `services/quiz-service/test/load/report.ts`
- Create: `services/quiz-service/test/load/evidence/d09-template.md`
- Modify: `services/quiz-service/src/app.ts`
- Modify: `services/quiz-service/src/student/join.ts`
- Modify: `services/quiz-service/src/student/registration.ts`
- Modify: `services/quiz-service/package.json`

**Interfaces:**
- Produces: `pnpm --filter @eduscope/quiz-service load:200`; JSON evidence with p50/p95/max timings and correctness assertions.
- Consumes: complete D student/device surfaces; PostgreSQL 16; 200 independent cookie jars/WS clients.

- [ ] **Step 1: Write failing abuse-policy tests**

Use injected Fastify rate-limit time and IPs to assert:

- resolve requests 1–10/min/IP succeed according to session existence; request 11 is `503 quiz.unavailable`, parses with `zQuizAppProblem`, and carries no uncontracted body;
- registration requests 1–5/min/IP reach business logic; request 6 is the same contracted 503;
- one open session accepts participant 1,000 and rejects 1,001 with contracted 503 without creating a row;
- JSON bodies of 32 KiB or less reach zod; larger bodies are mapped to contracted `503 quiz.unavailable` on public student routes rather than leaking Fastify internals;
- `Origin === PUBLIC_ORIGIN` gets credentialed CORS headers; a different/`null` origin gets no allow-origin header and state-changing requests are refused;
- error/log captures contain no bearer, cookie, full request body, correct answer before close, or cross-session PII.

- [ ] **Step 2: Run the abuse suite and verify red**

Run:

```bash
pnpm --filter @eduscope/quiz-service test -- test/abuse/policies.test.ts
```

Expected: FAIL until final body-limit/CORS/rate-error mappings and route configurations are complete.

- [ ] **Step 3: Finish the bounded public-surface configuration**

Register `@fastify/cors` with `origin: config.publicOrigin`, `credentials:true`, and methods `GET,POST,OPTIONS`. A student POST pre-handler allows an absent `Origin` for non-browser contract clients, accepts the exact configured origin, and returns contracted `503 quiz.unavailable` for any other present origin including `null`; device server-to-server routes are outside this check. Keep the D-04 route-specific rate values; do not apply one global IP bucket that would punish 200 students behind campus NAT. Install a body-too-large handler that maps public student endpoints to `{status:503,code:'quiz.unavailable',title:'Quiz service unavailable'}` and closes unread input. Preserve normal Fastify errors only on internal health/non-contract paths.

- [ ] **Step 4: Implement the exact 200-client workload**

Add `"load:200":"tsx test/load/join-answer-ws.ts"`. The script starts PostgreSQL 16 and D on loopback unless `QUIZ_LOAD_BASE_URL`/`QUIZ_LOAD_DATABASE_URL` point at staging, then:

1. Provision one device, create one quiz session, and resolve its join code.
2. Register 200 unique valid-format ids `IT0000001` through `IT0000200`, each with its own cookie jar and a distinct RFC 2544 test address in `X-Forwarded-For` (`198.18.0.1`…`198.18.0.200`); because the test reaches D from loopback, the production `trustProxy:'127.0.0.1'` rule accepts these exactly as Nginx would. Record registration latency.
3. Open 200 cookie-authenticated student WS connections; wait until every socket receives the complete ordered atomic snapshot; record connect-to-snapshot latency.
4. Open the device stream, send hello, publish a four-option question, and require all 200 sockets to receive the open question.
5. Release a barrier so all 200 clients submit once in a burst; immediately retry 20 chosen clients with the opposite option and require `already-accepted` with the original stored option.
6. Require one D answer row/student, 200 distinct seq values, device answer frames of at most 200 items, and no duplicate projection key.
7. Close the publication; require every socket to receive closed-question then exactly one private result. Compare each own score/rank to the shared helper and prove no payload contains another test identity.
8. Close 50 sockets, reconnect them, and require replacement snapshots with current closed question/result and no stale prior question.
9. Close the session and require 200 terminal own summaries, with answered count 1, before cleanup.

Compute p50/p95/max for resolve, registration, snapshot, answer HTTP, publish fan-out, close-to-result, and reconnect snapshot. Record these values; fail only on functional/capacity errors because the master supplies no numeric quiz latency threshold.

- [ ] **Step 5: Run abuse and 200-client gates**

Run:

```bash
pnpm --filter @eduscope/quiz-service test -- test/abuse/policies.test.ts
pnpm --filter @eduscope/quiz-service load:200 -- --evidence services/quiz-service/test/load/evidence/d09-local.json
```

Expected: PASS; summary prints `clients=200 answers=200 duplicateRows=0 privacyLeaks=0` plus measured p50/p95/max for every phase. The evidence JSON records environment/commit/PostgreSQL version, timings, frame sizes, row/count/hash assertions, and no student names/ids, cookie, bearer, prompt, option text, or answer choice.

- [ ] **Step 6: Run contract/mock regressions after abuse wiring**

Run:

```bash
pnpm --filter @eduscope/quiz-service test:contract
pnpm --filter @eduscope/api-client test
pnpm --filter @eduscope/quiz test
```

Expected: PASS; exact v1 Problems/events remain unchanged and the mock/student app suites are independent and green.

- [ ] **Step 7: Commit D-09**

```bash
git add services/quiz-service
git commit -m "test(quiz-service): gate 200 concurrent students"
```

---

### Task D-10: Campus packaging and operations gate

This is the third final verification task from the master plan. Source templates may contain named render tokens; a rendered staging config may contain none. P-3 supplies the actual campus hostname/certificate/database facts at deployment time.

**Files:**
- Create: `deploy/campus/eduscope-quiz.service`
- Create: `deploy/campus/nginx-quiz.conf`
- Create: `deploy/campus/quiz-service.env.example`
- Create: `deploy/campus/render-config.mjs`
- Create: `deploy/campus/README.md`
- Create: `services/quiz-service/scripts/provision-device.ts`
- Create: `services/quiz-service/scripts/backup.ts`
- Create: `services/quiz-service/scripts/restore.ts`
- Create: `services/quiz-service/test/operations/templates.test.ts`
- Create: `services/quiz-service/test/operations/backup.test.ts`
- Create: `services/quiz-service/test/operations/staging-smoke.ts`
- Create: `services/quiz-service/test/operations/evidence/d10-template.md`
- Modify: `services/quiz-service/package.json`

**Interfaces:**
- Produces: one hardened campus systemd service, one HTTPS/WSS Nginx proxy, argv-only migrate/provision/backup/restore/smoke commands, and staging evidence.
- Consumes: rendered `QUIZ_PUBLIC_HOST`, certificate/key paths, `DATABASE_URL`, cookie secret, backup directory, device id/hall/bearer supplied outside Git.

- [ ] **Step 1: Write failing template/argv tests**

Validate the unit with `systemd-analyze verify` when available plus a structural parser on every platform; validate Nginx with `nginx -t -c <rendered>` when available plus structural assertions. Tests require loopback proxying, WS headers, HTTPS redirect, HSTS, body cap, no secrets in templates, no `sudo`, no `shell:true`, no device address, production env validation, migration before start, backup command failure propagation, restore refusal without the exact confirmation text, and renderer failure when any required value/render token is absent.

- [ ] **Step 2: Run and verify red**

Run:

```bash
pnpm --filter @eduscope/quiz-service test -- test/operations/templates.test.ts test/operations/backup.test.ts
```

Expected: FAIL because campus artifacts/scripts do not exist.

- [ ] **Step 3: Add the complete systemd unit**

Create `deploy/campus/eduscope-quiz.service` exactly with these security/lifecycle boundaries:

```ini
[Unit]
Description=Eduscope campus quiz service
Wants=network-online.target
After=network-online.target postgresql.service

[Service]
Type=simple
User=eduscope-quiz
Group=eduscope-quiz
WorkingDirectory=/opt/eduscope/current
EnvironmentFile=/etc/eduscope/quiz-service.env
ExecStartPre=/usr/bin/node /opt/eduscope/current/services/quiz-service/dist/src/db/migrate-cli.js
ExecStart=/usr/bin/node /opt/eduscope/current/services/quiz-service/dist/src/server.js
Restart=on-failure
RestartSec=3
TimeoutStopSec=30
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=/opt/eduscope/current/apps/quiz/.next/cache
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
```

PostgreSQL owns domain data and journald owns logs. The sole writable application path is Next's pre-created `.next/cache`; the deployment creates it, sets owner/group `eduscope-quiz`, and leaves every other release path read-only. `MemoryDenyWriteExecute` is deliberately absent because Node/V8 requires JIT executable memory.

- [ ] **Step 4: Add the complete Nginx template and renderer**

`nginx-quiz.conf` contains named tokens `@@QUIZ_PUBLIC_HOST@@`, `@@TLS_CERTIFICATE@@`, and `@@TLS_CERTIFICATE_KEY@@`, an HTTP→HTTPS redirect server, and this HTTPS location:

```nginx
map $http_upgrade $connection_upgrade {
  default upgrade;
  '' close;
}

server {
  listen 80;
  server_name @@QUIZ_PUBLIC_HOST@@;
  return 308 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name @@QUIZ_PUBLIC_HOST@@;
  ssl_certificate @@TLS_CERTIFICATE@@;
  ssl_certificate_key @@TLS_CERTIFICATE_KEY@@;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  client_max_body_size 32k;

  location / {
    proxy_pass http://127.0.0.1:7300;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 75s;
  }
}
```

Create `render-config.mjs` exactly as this atomic, non-shell renderer:

```js
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

function flags(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error('flags must be --name value pairs');
    result.set(key.slice(2), value);
  }
  return result;
}

const args = flags(process.argv.slice(2));
const required = ['input', 'output', 'host', 'certificate', 'certificate-key'];
for (const name of required) if (!args.get(name)) throw new Error(`missing --${name}`);
const host = args.get('host');
if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host)) {
  throw new Error('invalid public host');
}
for (const name of ['certificate', 'certificate-key']) {
  if (/[\r\n\0]/.test(args.get(name))) throw new Error(`invalid --${name}`);
}

let rendered = await readFile(resolve(args.get('input')), 'utf8');
const replacements = new Map([
  ['@@QUIZ_PUBLIC_HOST@@', host],
  ['@@TLS_CERTIFICATE@@', args.get('certificate')],
  ['@@TLS_CERTIFICATE_KEY@@', args.get('certificate-key')],
]);
for (const [token, value] of replacements) {
  if (rendered.split(token).length !== 2) throw new Error(`expected exactly one ${token}`);
  rendered = rendered.replace(token, value);
}
if (/@@[A-Z0-9_]+@@/.test(rendered)) throw new Error('unresolved render token');

const output = resolve(args.get('output'));
await mkdir(dirname(output), { recursive: true });
const temporary = `${output}.${randomUUID()}.tmp`;
await writeFile(temporary, rendered, { mode: 0o644, flag: 'wx' });
await rename(temporary, output);
```

It never reads/prints the cookie secret or database URL.

- [ ] **Step 5: Add exact env and argv-only operations wrappers**

`quiz-service.env.example` names, but does not fill secrets:

```dotenv
NODE_ENV=production
QUIZ_HOST=127.0.0.1
QUIZ_PORT=7300
DATABASE_URL=
PUBLIC_ORIGIN=
QUIZ_COOKIE_SECRET=
QUIZ_PARTICIPANT_SESSION_TTL_SEC=86400
QUIZ_NEXT_APP_DIR=/opt/eduscope/current/apps/quiz
QUIZ_LOG_LEVEL=info
```

Add these exact package scripts:

```json
{
  "provision:device": "tsx scripts/provision-device.ts",
  "backup": "tsx scripts/backup.ts",
  "restore": "tsx scripts/restore.ts",
  "smoke:staging": "tsx test/operations/staging-smoke.ts"
}
```

`provision-device.ts` is the complete stdin-only credential wrapper:

```ts
import { readFileSync } from 'node:fs';
import { zUlid } from '@eduscope/shared';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/client.js';
import { devices } from '../src/db/schema.js';
import { hashDeviceCredential } from '../src/device/credentials.js';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (!key?.startsWith('--') || value === undefined) throw new Error('flags must be --name value pairs');
  args.set(key.slice(2), value);
}
const deviceId = zUlid.parse(args.get('device-id'));
const hallDisplayName = args.get('hall-display-name')?.trim();
if (!hallDisplayName || hallDisplayName.length > 128) throw new Error('invalid hall display name');
const bearer = readFileSync(0, 'utf8').trim();
if (bearer.length < 32) throw new Error('device bearer must contain at least 32 characters');

const config = loadConfig(process.env);
const database = openDatabase(config.databaseUrl);
try {
  const credentialHash = await hashDeviceCredential(bearer);
  const createdAt = new Date().toISOString();
  await database.db.insert(devices).values({ deviceId, credentialHash, hallDisplayName, enabled: true, createdAt })
    .onConflictDoUpdate({ target: devices.deviceId, set: { credentialHash, hallDisplayName, enabled: true } });
  process.stdout.write(`${deviceId}\n`);
} finally {
  await database.close();
}
```

`backup.ts` is the complete fail-closed backup wrapper:

```ts
import { chmodSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const outIndex = process.argv.indexOf('--output');
const output = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
const databaseUrl = process.env.DATABASE_URL;
if (!output || !databaseUrl) throw new Error('require --output and DATABASE_URL');
const target = resolve(output);
if (existsSync(target)) throw new Error('backup output already exists');
const result = spawnSync('pg_dump', ['--format=custom', '--no-owner', '--file', target, databaseUrl], {
  shell: false,
  stdio: ['ignore', 'inherit', 'inherit'],
});
if (result.status !== 0) process.exit(result.status ?? 1);
chmodSync(target, 0o600);
if (statSync(target).size === 0) throw new Error('pg_dump produced an empty backup');
process.stdout.write(`${target}\n`);
```

`restore.ts` is the complete confirmation/non-empty guard:

```ts
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';

const valueAfter = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const input = valueAfter('--input');
const confirm = valueAfter('--confirm');
const allowNonempty = process.argv.includes('--allow-nonempty');
const databaseUrl = process.env.DATABASE_URL;
if (!input || !databaseUrl || confirm !== 'RESTORE-EDUSCOPE-QUIZ') throw new Error('restore confirmation/input/database missing');
const source = resolve(input);
if (!existsSync(source)) throw new Error('backup input does not exist');

const sql = postgres(databaseUrl, { max: 1 });
try {
  const rows = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM pg_catalog.pg_tables
    WHERE schemaname='public' AND tablename <> 'quiz_schema_migrations'
  `;
  if ((rows[0]?.count ?? 0) > 0 && !allowNonempty) throw new Error('target database is not empty');
} finally {
  await sql.end();
}
const result = spawnSync('pg_restore', [
  '--exit-on-error', '--clean', '--if-exists', '--no-owner', '--dbname', databaseUrl, source,
], { shell: false, stdio: ['ignore', 'inherit', 'inherit'] });
if (result.status !== 0) process.exit(result.status ?? 1);
```

None of the wrappers print the URL or bearer; unit tests inject the executable seam and assert the exact argv/status behavior.

- [ ] **Step 6: Write the executable campus staging procedure**

`deploy/campus/README.md` must give these ordered, copyable actions with actual P-3 values supplied at run time:

1. Record hostname, public origin, certificate paths/expiry, PostgreSQL host/version, Node/pnpm paths, service user uid/gid, backup directory, and firewall owner in D-10 evidence. Any missing fact stops the gate.
2. Install dependencies with the frozen lock, run shared/quiz-service builds, and run `pnpm --filter @eduscope/quiz build`; verify `.next/BUILD_ID` exists.
3. Create the database/role by campus DBA procedure, write `/etc/eduscope/quiz-service.env` mode 0600, render Nginx, run `nginx -t`, and run migrations twice.
4. Provision the staging device bearer through stdin; put the same raw value in the device's secret provisioning channel, never in evidence/shell history.
5. Install/enable the unit and Nginx, then verify the Node socket is loopback-only with `ss -ltnp`.
6. Run the external smoke, restart the service mid-open quiz, reconnect both WS clients, and prove PostgreSQL state survives.
7. Produce a backup, verify nonzero size/SHA-256, restore into a new empty verification database, run D schema/count queries, then delete only that explicitly named verification database via the DBA procedure.

- [ ] **Step 7: Run template/unit checks and the staging smoke**

Local validation:

```bash
pnpm --filter @eduscope/quiz-service build
pnpm --filter @eduscope/quiz-service test -- test/operations
```

Expected: PASS; compiled migrate/server scripts exist, render tokens resolve exactly, unit/proxy checks pass or explicitly report the unavailable local binary while structural checks remain green, and wrappers prove `shell:false`/failure propagation.

On the staging campus host:

```bash
pnpm --filter @eduscope/quiz-service smoke:staging -- --origin "$QUIZ_PUBLIC_ORIGIN" --join-code "$QUIZ_GATE_JOIN_CODE" --device-id "$QUIZ_GATE_DEVICE_ID"
```

The smoke reads bearer from stdin, not the command line. Expected: external `/j/CODE` returns the Next page over HTTPS; device create/publish/close calls authenticate with `x-eduscope-contract:1.0`; student resolve/register cookie/WS/answer/result succeeds over HTTPS/WSS; service restart reconnects with authoritative state; direct `http://host:7300` is unreachable externally; wrong bearer is 401; backup/restore verification matches table counts.

- [ ] **Step 8: Commit D-10**

```bash
git add deploy/campus services/quiz-service
git commit -m "ops(quiz-service): package campus deployment"
```

---

### Task D-11: Quiz workstream gate

This is the final Workstream D verification task from the master plan. Stop after its commit; do not begin Workstream E.

**Files:**
- Create: `services/quiz-service/test/contract/ownership.test.ts`
- Create: `services/quiz-service/test/integration/happy-flow.test.ts`
- Create: `services/quiz-service/scripts/gate-quiz-service.mjs`
- Create: `services/quiz-service/test/integration/evidence/d11-template.md`
- Modify: `services/quiz-service/package.json`

**Interfaces:**
- Produces: one `gate:d` command and evidence proving exact D ownership/happy flow plus references to D-08/D-09/D-10 evidence.
- Consumes: complete D implementation; v1 contracts; shared/core-api/api-client/quiz regressions; PostgreSQL 16; committed evidence templates.

- [ ] **Step 1: Write the exact ownership gate and make omission/excess fail**

Parse both OpenAPI YAML documents and current Fastify route metadata. Assert exactly these seven REST operations, methods, and paths, once each:

```text
quizSyncCreateSession       POST /device/v1/quiz-sessions
quizSyncCloseSession        POST /device/v1/quiz-sessions/:quizSessionId/close
quizSyncPublish             POST /device/v1/publications
quizSyncClosePublication    POST /device/v1/publications/:publicationId/close
resolveJoinCode             GET  /api/student/v1/join-codes/:joinCode
registerParticipant         POST /api/student/v1/quiz-sessions/:quizSessionId/participants
submitAnswer                POST /api/student/v1/publications/:publicationId/answers
```

Allow only `/healthz`, the two contracted WS upgrade paths, and the Next not-found handoff outside those REST routes. Assert exactly four student event names and exactly three D-owned device server message names; execute every union member through its shared schema. Fail on an extra operation/message, ownership duplication with `PANEL_OPERATION_IDS`, or missing Problem success/error fixture. The Step 7 repository-diff check, not a mutable test fixture, enforces that `contracts/` stayed unchanged.

- [ ] **Step 2: Run ownership test and verify red until the gate is wired**

Run:

```bash
pnpm --filter @eduscope/quiz-service test -- test/contract/ownership.test.ts
```

Expected: FAIL before route metadata/fixture enumeration is complete; never weaken the `7 REST / 4 student / 3 device-server` counts.

- [ ] **Step 3: Build the executable happy-flow gate**

`happy-flow.test.ts` starts PostgreSQL 16 and real D, then drives with real HTTP/WS:

1. Provision two devices; prove one cannot access the other's session/publication.
2. Device A creates a session twice and gets the same id/code/url; a mismatched contract header logs once but succeeds.
3. Resolve uppercase/lowercase without writes; register three students including a rejoin; verify cookie flags and joined count.
4. Connect three student sockets and the device socket; validate ordered snapshots and hello/participant/heartbeat frames.
5. Publish question 1; verify no correctness before close. Submit correct, incorrect, retry-with-different-option, and answer/close both race orders.
6. Close question 1; validate private results/ranks and device replay rows. Publish question 2 and prove prior close ordering.
7. Disconnect device, accept answers, reconnect from stored watermark, and compare authoritative/projected values.
8. Disconnect/reconnect one student after close; verify wholesale snapshot with no stale question/result.
9. Close the quiz session twice; verify participated/no-participation terminal variants and that further register/answer calls return contracted Problems.
10. Restart D against the same PostgreSQL database; reconnect and verify terminal state survives with no duplicate answer/participant.

Recursively scan every student frame: open frames have no correct answer; no frame contains another participant's identity/answer/rank; no projector payload exists in D at all.

- [ ] **Step 4: Add the mechanical gate runner exactly**

Create `gate-quiz-service.mjs` with `shell:false` and Windows-safe `pnpm.cmd` selection:

```js
import { spawnSync } from 'node:child_process';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const steps = [
  ['--filter', '@eduscope/shared', 'test'],
  ['--filter', '@eduscope/quiz-service', 'typecheck'],
  ['--filter', '@eduscope/quiz-service', 'test'],
  ['--filter', '@eduscope/core-api', 'test', '--', 'test/quiz', 'test/contract/sync-hello.contract.test.ts'],
  ['--filter', '@eduscope/api-client', 'test'],
  ['--filter', '@eduscope/quiz', 'test'],
];

for (const args of steps) {
  const result = spawnSync(pnpm, args, {
    cwd: new URL('../../..', import.meta.url),
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
```

Add `"gate:d":"node scripts/gate-quiz-service.mjs"`. D-09's `load:200` stays a separate explicit evidence command because it writes a report and may target staging.

- [ ] **Step 5: Run the complete automated D gate**

Run:

```bash
pnpm --filter @eduscope/quiz-service gate:d
```

Expected: PASS; output reports exactly `7 REST / 4 student events / 3 device-server messages`, all D unit/contract/integration tests pass against PostgreSQL 16, current B sync tests pass, shared rank/wire tests pass, mock/api-client and quiz-app tests stay green, and Vitest reports no open handles.

- [ ] **Step 6: Re-run and attach the four final verification witnesses**

Run:

```bash
pnpm --filter @eduscope/quiz-service test -- test/integration/device-sync.test.ts
pnpm --filter @eduscope/quiz-service load:200 -- --evidence services/quiz-service/test/load/evidence/d09-gate.json
pnpm --filter @eduscope/quiz-service test -- test/operations
pnpm --filter @eduscope/quiz-service test -- test/integration/happy-flow.test.ts
```

Expected: all PASS. `d11-template.md` links immutable D-08/D-09/D-10 evidence paths/hashes and records D-11 commit, PostgreSQL/Node versions, exact ownership counts, happy-flow assertions, privacy scan count 0, 200-client count 200, duplicate count 0, staging HTTPS/WSS/restart/backup verdicts, and reviewer acknowledgement of the Workstream D master gate flag. No credential, PII, prompt, option text, or answer choice is recorded.

- [ ] **Step 7: Run forbidden-pattern, diff, and scope checks**

Run:

```bash
rg -n "sudo|execSync|shell:\s*true|child_process|fetch\(|new WebSocket" services/quiz-service/src apps/quiz/src apps/quiz/app
```

Expected: no `sudo`, `execSync`, or `shell:true`. `child_process` is absent from runtime `src`; deploy scripts alone use `spawnSync` with `shell:false`. `fetch`/`WebSocket` remain absent from quiz components/app source; future real networking remains an api-client/Workstream E responsibility.

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only D-11 files are uncommitted for this task; `contracts/` and mock sources are unchanged.

- [ ] **Step 8: Commit D-11 and stop Workstream D**

```bash
git add services/quiz-service
git commit -m "test(quiz-service): gate v1 campus quiz flow"
```

Stop. Do not implement the real frontend adapter, move E screens to real, create F bring-up artifacts, or alter contract v1 in this plan.

---

## Self-Review

### Master-scope coverage

- D-01..D-11 appear exactly once and in master order. No task was added, dropped, split, reordered, or reassigned.
- The final four tasks are exactly the master verification sequence: D-08 real B+D DR-22 recovery, D-09 abuse/200 clients, D-10 campus HTTPS/WSS/Postgres operations, and D-11 exact ownership/happy-flow gate.
- Contract ownership stays exactly four quiz-sync REST operations, three student REST operations, four student event names, and three D-owned device-server messages. B retains `sync.hello`; no panel operation/event owner moves.
- Workstream D has no KEEP item in the master KEEP ledger, so none is invented. Mock/api-client/quiz-app regression remains explicit in D-04, D-06, D-09, and D-11.
- The master was updated in this run for the missing shared student envelope and shared rank implementation. D-06 resolves both without changing public shapes/ownership. The existing B-38/C-10 prerequisite gates remain external blockers, not new D work.
- Unratified orphan auto-close and quiz PII retention remain absent. No roster/SSO/institute payload, horizontal-scaling layer, real frontend adapter, or projector/leaderboard path was added.

### Placeholder scan

The plan contains no deferred implementation marker, generic error-handling instruction, unspecified test request, or reference to an undefined neighboring interface. Deployment render tokens are fully named inputs with a renderer/test; evidence templates use the explicit unrun state required above and never fabricated results.

### Type and interface consistency

- REST shapes come from generated/shared zod; student wire frames use the new shared envelope; device frames use existing shared sync unions.
- `SessionSerial` orders create/publish/close/answer/snapshot/replay attachment for one quiz session. PostgreSQL remains the state authority and answer replay log; route/hub code does not create second truth.
- D and current B both call `scoreQuizParticipants`; dense ties are `1,1,2`, points are `correct*10`, accuracy excludes missed questions, and response time never scores.
- Student open-question payloads exclude correctness; result/terminal payloads are private; device answer batches contain only the contracted minimal session-scoped projection.
- D-08's B peer uses real B production modules and real D, D-09 uses 200 independent cookie/WS clients, D-10 terminates TLS only at Nginx, and D-11 rechecks exact ownership plus all upstream/mock regressions.
