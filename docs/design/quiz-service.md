# quiz-service — Service Design (Phase-3, prompt 11)

> Phase-3 design artifact. The **campus-hosted student quiz platform** decided
> by ADR-021 (A-16: separate Next.js app on a campus web server under a public
> domain, QR join, basic login now / university SSO later, leaderboard
> panel-only) and ADR-012 (D-21: self-registration, leaderboard keyed on
> student ID). It implements, as the **server**, the student REST surface
> ([contracts/quiz-app.yaml](../../contracts/quiz-app.yaml)), the student
> realtime stream ([contracts/events.md](../../contracts/events.md) §5,
> CG-22…CG-25), and the device↔quiz-server sync contract (events.md §4 + the
> `quiz-sync` paths of [openapi.yaml](../../contracts/openapi.yaml)); the only
> client of the sync surface is core-api module M8
> ([core-api.md](core-api.md) §10).
>
> Trust boundary (domain model §8): this service lives in a **different
> network zone** than the device. Every device connection is device-initiated
> (the public zone can never dial into the campus LAN). Device-side copies of
> its data are projections; **authority for QuizSession, StudentIdentity,
> QuizParticipant and Answer is here** (single-writer table, state-machines
> §0.2: machines 4b and 4c are quiz-service's).
>
> Contract v0.6 is implemented unchanged; temptations are flagged in §10.
> Ends at a **STOP gate** (§11).

---

## 0. Stack & deployment shape

| Concern | Choice | Why |
|---|---|---|
| App | **Next.js (App Router) + a custom Node server** in one process: Next handles the student pages; the custom server (Fastify with `@fastify/nextjs`-style handoff) owns `/api/student/v1/*`, `/api/device/v1/*` and both WS upgrades | A-16 says "Next.js app"; API routes alone cannot host WebSockets — a custom server keeps **one deployable** on the campus box while giving the WS + REST surfaces a real server framework. Shares `packages/shared` zod schemas and the DM-10 leaderboard formula (it is TypeScript — literal code sharing, not a re-implementation) |
| DB | **PostgreSQL 16** | Unlike the appliance (ADR-001's single-writer SQLite), this zone has genuinely concurrent writers (~200 phones answering in a burst) and a normal server to run on. Postgres gives `ON CONFLICT` idempotency, row locks for the per-session sequence, and boring campus-IT operability. *Flagged §10 (Q-1) as the mirror of D-03 for this zone — needs a tech-lead sign-off* |
| ORM | Drizzle (same as core-api — one team, one query idiom) | |
| Process | one Node process behind the campus reverse proxy (TLS terminates there); systemd or the campus PaaS | §7 shows one process is ample for lecture-hall scale |
| Sessions | `eduscope_participant` opaque cookie (Secure, HttpOnly, SameSite=Lax, Path=/api/student/v1) → `participant_sessions` rows | quiz-app.yaml security scheme; SQ-D-2 (no browser-readable credential, ever) |

Zones & flows (all arrows are who-dials-whom):

```
student phone ──HTTPS/WSS──▶ quiz-service (public campus domain)
device (campus LAN) ──HTTPS──▶ quiz-service  /api/device/v1/*   (mint/close/publish/close-pub)
device (campus LAN) ──WSS───▶ quiz-service  /api/device/v1/stream (answers/participants back)
quiz-service ──────X──────▶ device          (never; no inbound path to the LAN)
```

---

## 1. Data model (quiz-service's own DB — single writer here)

Implements domain model §8.5–§8.9 plus the sync bookkeeping the contract
demands. ULIDs as `text` PKs (generatable offline on both sides, INV-G-2);
instants `timestamptz` (UTC, INV-G-3).

| Table | Key columns | Constraints / notes |
|---|---|---|
| `devices` | `device_id` PK, `credential_hash`, `hall_display_name`, `enabled`, `created_at` | provisioned device credentials (§6.2); DM-P5 auth home |
| `quiz_sessions` | domain §8.5: `id`, `lecture_session_id`, `device_id`, `hall_display_name`, `join_code`, `join_url`, `state open\|closed`, `opened_at`, `closed_at`, **`next_answer_seq bigint`** | **partial UNIQUE(`lecture_session_id`) WHERE state='open'** (INV-QZ-1); UNIQUE(`join_code`) WHERE state='open' — code uniqueness across concurrent rooms (DM-15); `next_answer_seq` is the §5 watermark counter |
| `students` | §8.6 StudentIdentity: `id`, `student_id_number`, `full_name`, `auth_method self-registered\|sso`, `sso_subject`, `credential_ref`, timestamps | UNIQUE(`student_id_number`) (INV-SI-1 — the leaderboard key, ADR-012) |
| `participants` | §8.7: `id`, `quiz_session_id`, `student_id`, `joined_at`, `last_seen_at`, `connection_state` | UNIQUE(`quiz_session_id`,`student_id`) (INV-QP-1 — rejoin never duplicates) |
| `participant_sessions` | `token_hash` PK, `participant_id`, `student_id`, `issued_at`, `expires_at` | the cookie's server side; token is 256-bit random, stored hashed |
| `publications` | replicated §8.8 subset: `id` (device-minted ULID), `quiz_session_id`, `question_id`, `prompt`, `options jsonb [{id,label,text}]`, `correct_option_id`, `published_at`, `closed_at`, `close_reason`, `state open\|closed` | idempotent upsert on `id` (contract: "Idempotent on publicationId"); `correct_option_id` **never serialized to any student payload before close** — enforced by the read-model serializers (§4) |
| `answers` | §8.9: `id`, `publication_id`, `student_id`, `selected_option_id`, `is_correct`, `points_awarded`, `response_time_ms`, `submitted_at`, **`seq bigint`** | **UNIQUE(`publication_id`,`student_id`)** (INV-AN-1 — the one locked attempt, in SQL); UNIQUE(`quiz_session_id`,`seq`); `is_correct`/`points_awarded` evaluated **at insert** (Z-22, INV-Q-4) |

Deliberately absent: any leaderboard table (INV-LB-1 — derived), any device
inbox/queue (the `answers.seq` **is** the replay log — §5.2), any roster
(D-21: format validation only in v0).

**Sequencing.** `seq` is minted per quiz session inside the answer-insert
transaction: `UPDATE quiz_sessions SET next_answer_seq = next_answer_seq + 1
… RETURNING`, then insert the answer with it. Monotonic per session (the
events.md §4 requirement: "minted by quiz-service, monotonic per quiz
session — the replay watermark, not an id"). A gapless guarantee is not
required — only monotonicity — so a rolled-back insert wasting a value is
harmless.

---

## 2. Student REST surface (quiz-app.yaml, v0.6 — server side)

Three operations, implemented exactly as contracted:

| Op | Implementation |
|---|---|
| `resolveJoinCode` | Case-insensitive lookup (`upper(joinCode)` — codes minted uppercase §6.1); public + **rate-limited** (§7.2); never creates anything (INV-QP-1); `participantState: returning` iff a valid cookie maps to a participant of *this* session; returns the const `RegistrationPolicy` (`^[A-Z]{2}[0-9]{7,8}$`, hint, maxLengths — SQO-1) |
| `registerParticipant` | Validates format only (D-21 — no roster). One transaction: upsert `students` by `student_id_number` (update `full_name` on rejoin — last writer wins on their own name), insert-or-return `participants` (`ON CONFLICT DO NOTHING` + select ⇒ `outcome: created\|rejoined`), mint `participant_sessions` token, `Set-Cookie`. `409 quiz.session-closed` on a closed session; field-pointer `422`s per the contract |
| `submitAnswer` | The hot path — §5.1 |

Named problems come from the closed `QuizAppProblemCode` enum only; every
response is validated against the shared zod mirrors in CI (the same
schema-lock the panel uses).

---

## 3. Student realtime stream (events.md §5 — `GET /api/student/v1/stream`)

- Upgrade authenticated **only** by the participant cookie (SQ-D-2: never a
  query param). Cookie → `participant_sessions` → participant; failure ⇒ 401
  before upgrade.
- **Atomic connect snapshot (CG-22)**, emitted in exactly the §5.1 order from
  one consistent DB read (single transaction snapshot): student
  `quiz.session` → `quiz.participant{online}` → `quiz.question`
  (`open`/`closed`/`none`, with `ownAnswerOptionId` — CG-23) → own
  `quiz.result` when applicable → only then live deltas. The client replaces
  its state wholesale; a reconnect can never flash a stale question (SQ-D-5).
- Per-connection monotonic `seq`; server→student only; commands via REST.
- Live deltas: on publish → `quiz.question{open}` to the session's
  connections; on close → `quiz.question{closed}` then per-participant
  `quiz.result` (own result, own rank, `rankState` — CG-24; rank computed
  per §8); on session close → the participation-discriminated terminal
  student `quiz.session` (CG-25). `quiz.participant` reflects only the
  cookie-holder's own connection state.
- Connection registry: in-memory `quizSessionId → Set<socket>` (single
  process, §0). `participants.connection_state` + `last_seen_at` updated on
  open/close/ping with a 10 s debounce (Z-12/Z-13/Z-14) and feed the
  coalesced `sync.participants` counts (§5.3).

---

## 4. Publication read-model discipline

One serializer module produces every student-facing payload. Its rules are the
privacy/ordering invariants, enforced in one place:

- `correct_option_id` appears **only** in `quiz.result` / post-close payloads
  (students never see correctness before close — openapi `PublicationPush`
  note).
- No payload ever contains another participant's identity, answer, or a
  leaderboard list (INV-SI-2, QZ-6; the terminal summary carries the current
  participant only — CG-25).
- `ownAnswerOptionId` is the **option id**, never an answer-row id (CG-23).

---

## 5. Answer ingestion & the device sync contract

### 5.1 `submitAnswer` — the hot path (Z-20…Z-26)

One transaction per submit:

1. Cookie → participant; load the publication row.
2. **`G-PUBLICATION-OPEN`**: quiz-service **receive time** `< closed_at`
   (or `closed_at IS NULL`). Client timestamps are never consulted; there is
   no grace window (SM-Q-6, INV-QPUB-4). Late ⇒ `409 question.closed`.
3. Validate `selectedOptionId ∈ options` ⇒ else `422 answer.invalid-option`.
4. Evaluate **now**: `is_correct = (selected == correct_option_id)`,
   `points_awarded = is_correct ? 10 : 0` (INT-2, stored so a later formula
   change never rewrites history — INV-AN-3),
   `response_time_ms = receiveAt − published_at`.
5. Mint `seq` (§1) and `INSERT … ON CONFLICT (publication_id, student_id) DO
   NOTHING`. Conflict ⇒ re-select the stored row and return
   `{outcome: "already-accepted", selectedOptionId: stored}` — the retried tap
   is the *same* answer (Z-24, INV-AN-1); the first tap is final.
6. Post-commit: hand the answer to the device-stream batcher (§5.3) and emit
   nothing to the student yet (their `quiz.result` comes at close).

### 5.2 Device stream (`GET /api/device/v1/stream`, events.md §4) — replay by watermark

- Device connects (device credential, §6.2) and sends
  `sync.hello{deviceId, quizSessionId, answerWatermark}` — the highest `seq`
  core-api has durably stored.
- Server replies with a replay: `SELECT … FROM answers WHERE quiz_session_id=?
  AND seq > watermark ORDER BY seq`, batched into `sync.answers` frames
  (≤ 200 rows per frame). **The answers table is the outbox** — no second
  queue to drift (INV-AP-1's replace-never-edit on the device side pairs with
  an immutable source here). Replay then seamlessly continues as live flow.
- Live flow: the batcher coalesces new answers per session and flushes
  ≤ 1/s (events.md §4 cadence) as
  `sync.answers{quizSessionId, answers:[{seq, answerId, publicationId,
  studentIdNumber, studentDisplayName, selectedOptionId, isCorrect,
  responseTimeMs, submittedAt}]}`.
- `sync.participants{joinedCount, onlineCount}` coalesced ≤ 1/s on
  join/leave/connection changes (Z-11…Z-14).
- `sync.heartbeat{at}` every `T-QUIZ-HEARTBEAT` (5 s) both ways; the server
  drops a connection silent > 20 s (the device reconnects and re-hellos —
  idempotent by watermark).
- One active device stream per quiz session; a new `hello` for the same
  session supersedes the old socket (device restarted — the stale socket is
  closed server-side).

### 5.3 Resilience when the device link drops mid-quiz

The governing rule: **students are never blocked by device-link state**;
answer authority lives where the write happens (domain §8.9 rationale), and
the device catches up by replay (Z-30…Z-33 device-side).

| Scenario | quiz-service behavior | Recovery |
|---|---|---|
| Link drops, publication open | Keep accepting answers (`closed_at` is local); keep batching — batches accumulate as unsent `seq` ranges (no buffering needed; the table is the log) | On reconnect, `sync.hello` watermark ⇒ replay everything missed. Device panel meanwhile shows `stale` (its machine 4d) |
| Close instruction arrives late | `closedAt` in the close call is **authoritative on both sides** (INV-QPUB-4): the publication is closed retroactively at that instant; answers accepted in the gap with `receiveAt > closedAt` are… **impossible** — acceptance always compared against `closed_at`, which was NULL during the gap, so they were validly accepted before the close arrived. This is the contracted semantic: the window closes when the *instruction lands* for future submits, and `closedAt` back-dates the record, not the acceptances (openapi: "a late answer is rejected against this closedAt even if the instruction arrived late" applies to answers arriving *after* the instruction) | Device receives all accepted answers by replay; results are consistent because `isCorrect` was evaluated per-answer at submit |
| Publish retry (Q-32 → operator retry) | `POST /device/v1/publications` idempotent on `publicationId` — a duplicate push upserts, never double-opens | ack (201) is `G-PUBLISH-ACK`; the device only then projects (DM-9) |
| Device gone for the rest of the lecture | Session stays open; students can answer the open publication until session close | **Hygiene default (flagged §10 Q-2):** sessions auto-close after 6 h of device silence, so an orphaned session can't accept joins forever; students then see the terminal summary |
| quiz-service restarts mid-quiz | All state is in Postgres; student WSs and the device WS reconnect (T-WS-RECONNECT); atomic snapshots (§3) and watermark replay (§5.2) make reconvergence total | — |
| Session closed (`quizSyncCloseSession`, Z-05/INV-QZ-2) | Close any open publication (`close_reason=session-ended`), emit final `quiz.result` + terminal student `quiz.session` per §3, stop accepting joins/answers (`409/503` per contract) | idempotent (204 on repeat) |

### 5.4 Device sync REST (openapi `quiz-sync` tag — server side)

| Op | Implementation |
|---|---|
| `quizSyncCreateSession` | Idempotent on `lectureSessionId` (partial unique index): an existing open session returns 201 with the stored row. Mints `join_code` (6-char uppercase, collision-checked against open sessions) and `join_url` (`https://<public-domain>/j/<code>` — quiz-service owns its URL namespace, DM-15) |
| `quizSyncCloseSession` | idempotent close (§5.3 last row) |
| `quizSyncPublish` | upsert publication (carries `correctOptionId` server-to-server — Z-22 evaluation basis); closes the previous open publication of the session (`close_reason=next-question` — mirror of INV-QPUB-2 so both sides agree even if the device's close call races); fan-out `quiz.question{open}` (§3); 201 = the ack the device's `T-PUBLISH-ACK` waits on |
| `quizSyncClosePublication` | set `closed_at` (authoritative — INV-QPUB-4), `close_reason`; fan-out `quiz.question{closed}` + per-participant `quiz.result`; idempotent 204 |

---

## 6. Identity & auth

### 6.1 Participants — basic login now, SSO seam (ADR-012 / ADR-021)

v0 flow: QR → `resolveJoinCode` → registration form (name + student ID,
`^[A-Z]{2}[0-9]{7,8}$` — format-validated only, D-21) → cookie. Rejoin from
the same browser is cookie-automatic; from a new device, re-registering the
same student ID **rejoins** the same identity (INV-QP-1) — self-asserted, an
accepted classroom-leaderboard tradeoff (ADR-012).

The **SSO seam** is a provider interface, not scattered conditionals:

```ts
interface IdentityProvider {
  id: "self-registration" | "university-sso";
  // Resolve a verified identity for this join, or hand back a redirect.
  resolve(req): Promise<{ studentIdNumber: string; fullName: string }
                        | { redirect: URL }>;
}
```

- v0 ships `self-registration` (resolve = validate the posted form).
- The later `university-sso` provider (OIDC against the university IdP) maps
  `sso_subject → student_id_number` **onto the same `students` rows**
  (`auth_method` flips, history and leaderboard keys survive — the ADR-012
  "cheap direction"). Registration routes live under one module so the swap
  touches nothing in quiz/session/answer code. Roster import, if D-02b ever
  exposes enrollment, becomes a third provider plus a `student_enrollments`
  table — additive.

### 6.2 Device credentials (DM-P5 — scheme open, default taken)

Per-device **static bearer token**, minted by the deploy flow when
`quizServerBaseUrl` is provisioned, stored hashed in `devices`, sent as
`Authorization: Bearer` on every `/api/device/v1/*` call and the stream
upgrade. Scope checks: a device may only touch quiz sessions whose
`device_id` is its own. Revocation = disable the row. The signed-request
(HMAC) upgrade path is the prompt-12 decision (core-api.md flag F-3); the
interface here is a verifier function, so swapping schemes is contained.

---

## 7. Lecture-hall scale (~200 concurrent phones)

### 7.1 Load model (per session; campus box may host several concurrent sessions)

| Moment | Load | Design answer |
|---|---|---|
| Join burst (first 5 min) | ~200 registrations over minutes → < 5 tx/s | trivial |
| Publish fan-out | 200 WS frames instantly | one serialized payload, 200 socket writes — sub-10 ms on one core |
| Answer burst | ~200 submits in 5–15 s ⇒ 15–40 tx/s peak | §5.1 is one indexed transaction; Postgres yawns. No queueing tier needed |
| Close fan-out | 200 × (`quiz.question{closed}` + personalized `quiz.result`) | result payloads share the rank computation (§8: one query, then per-socket personalization) |
| Device stream | ≤ 1 frame/s per session | negligible |
| Steady WS | 200 sockets × heartbeats | Node handles tens of thousands; 5 sessions ⇒ ~1000 sockets, fine in one process |

Headroom conclusion: a single Node process + small Postgres serves an order of
magnitude beyond the target. No horizontal scaling in V1; if the fleet grows,
the in-memory socket registry (§3) is the only thing pinning us to one
process — swap it for Postgres LISTEN/NOTIFY or Redis pub/sub then (noted,
not built).

### 7.2 Abuse controls (public surface)

- `resolveJoinCode`: per-IP token bucket (e.g. 10/min) + per-code miss
  throttling (`x-rate-limited: true` in the contract).
- `registerParticipant`: per-IP and per-session caps (e.g. 5 registrations/min
  /IP, session cap 1000 participants).
- `submitAnswer`: per-participant natural cap (idempotent single answer);
  per-IP sanity cap.
- Payload size limits and same-origin CORS for the app pages; the API is
  cookie-authenticated (SameSite=Lax) so cross-site POSTs don't ride along.

---

## 8. Scoring, ranks & the leaderboard boundary

- **One formula, one home**: `packages/shared` exports the DM-10 scoring/rank
  module (`points = 10 × correct`; dense ranking, ties share a rank; accuracy
  = correct/answered, 0 when answered = 0; response time never scores —
  INT-2). quiz-service imports it for `ownRank`/`runningScore`/final
  summaries; core-api imports the same code for the panel leaderboard
  (INV-LB-2 — a student's own rank always equals the panel's row).
- Rank computation on demand (close / connect snapshot / session end): one
  aggregate over `answers` for the session (counts per student) → shared
  formula → dense ranks; ~200 rows, milliseconds; never stored (INV-LB-1).
  `rankState: pending` is emitted when a result is sent before the close-time
  aggregate settles (CG-24), then a follow-up `quiz.result` upgrades it to
  `current`.
- **Boundary (leaderboard rules)**: the class list (name + student ID +
  scores) exists in exactly two read models — the device sync stream
  (`sync.answers`, feeding the **panel-only** LP-17 leaderboard) and nothing
  else. Students receive own-result/own-rank only (INT-4, QZ-6); the
  projector consumer is on the device side and never receives leaderboard
  data at all (INV-QZ-3/INV-LB-3/INV-QPUB-5 — structurally true here because
  no projector-facing payload exists in this service).
- PII scope: the device receives participant identities only for **its own**
  sessions (DM-14) — enforced by the device-scope check (§6.2). Device-side
  retention of that projection is DM-P2 (open PM ruling, tracked in
  core-api).

---

## 9. Operations on the campus web server

- **Config** (env/secret-managed): `DATABASE_URL`, `PUBLIC_ORIGIN` (join-URL
  base), cookie secret, rate-limit knobs. No device addresses anywhere — the
  LAN is unroutable from here by construction.
- **TLS** at the campus reverse proxy; HSTS; the cookie is Secure so plain
  HTTP never carries it.
- **Migrations**: Drizzle SQL files, applied on deploy before the new process
  serves (same discipline as core-api §3.3).
- **Observability**: pino → journald/campus log stack; per-session metrics
  (joins, answers/s, device-link state) on a `/metrics` endpoint
  (Prometheus-style) for campus IT; errors carry `quizSessionId` for
  cross-zone correlation with the device's `LogEntry(service=quiz-sync)`.
- **Data retention**: quiz sessions, participants and answers persist
  server-side; V1 ships a retention job defaulting to **purge sessions +
  answers 180 days after close** (flagged §10 Q-3 — a PM/institute data-
  protection call, the server-side sibling of DM-P1/DM-P2).
- **Two deploy targets** (device + campus) is the accepted ADR-021 trade-off;
  the quiz app versions independently of the device firmware — the contract
  (v0.6) is the compatibility line, and the device sends its contract version
  in a header (`x-eduscope-contract: 0.6`) so mismatches log loudly (flag §10
  Q-4).

---

## 10. Contract-change temptations — flagged, NOT applied (prompt 12 input)

| # | Temptation | Why it arose | Recommendation |
|---|---|---|---|
| Q-1 | Pin the quiz-zone DB engine | §0 picks Postgres; no ADR covers this zone | Record as a new ADR (mirror of ADR-001); no contract impact |
| Q-2 | Session auto-close after prolonged device silence | §5.3 orphaned-session hygiene; contract has no such close reason | Reuse `closeReason=session-ended`; PM to bless the 6 h default at prompt 12 |
| Q-3 | Server-side retention of answers/PII | §9; contracts are silent on quiz-zone retention | PM + institute ruling alongside DM-P1/DM-P2 |
| Q-4 | Contract-version header on device sync calls | §9 mismatch detection | Additive, header-only; propose at prompt 12 |
| Q-5 | `sync.hello` carries no participant watermark | Participants are replayed as *counts* (idempotent), so none is needed — but a future per-participant projection would want one | Leave closed; note for the D-02b/roster era |
| Q-6 | DM-P5 auth scheme (static bearer vs signed) | §6.2 takes static bearer | Decide at prompt 12 (same flag as core-api F-3) |
| Q-7 | `RegisterParticipantResponse` lacks the participant's stored `fullName` | A rejoining student who mistyped their name elsewhere sees no canonical echo | Cosmetic; leave closed for v0 |

---

## 11. Open questions & STOP gate

Defaults taken (cheap to change now):

1. **Postgres** for the quiz zone (§0) — confirm with campus IT what they
   operate happily; MySQL would also serve, SQLite would not (concurrency).
2. **Custom-server Next.js** (one process) vs Next app + separate API sidecar
   — one deployable wins until campus ops say otherwise.
3. **Join-code shape**: 6-char uppercase alphanumeric (no 0/O/1/I), unique
   among open sessions — fits `joinCode maxLength 8`.
4. **6 h orphaned-session auto-close** (§5.3, flag Q-2).
5. **180-day server-side retention** (§9, flag Q-3).
6. **Late-close semantics** (§5.3 row 2): answers accepted while the close
   instruction was in flight remain accepted (evaluated-at-submit); `closedAt`
   governs everything after the instruction lands. This is my reading of
   INV-QPUB-4 + SM-Q-6 together — **reviewer confirmation requested**, since
   the alternative (retroactively voiding gap answers) is implementable but
   punishes students for infrastructure latency.

> **STOP — Phase-3 gate.** Review by the architect (and PM for flags
> Q-2/Q-3), alongside [core-api.md](core-api.md) §10 (the sync client) and
> the §13 coverage table there. Focus: the outbox-free watermark replay
> (§5.2), the late-close semantics (§5.3 / default 6), the SSO seam (§6.1),
> the device-credential default (§6.2), and the scale/abuse posture (§7).
