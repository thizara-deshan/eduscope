# Eduscope WS Event Catalog — Contract v0

> Contract **v0.6.0** — the realtime half of [openapi.yaml](openapi.yaml) and
> [quiz-app.yaml](quiz-app.yaml).
> Successor of state-machines.md §10; that section now defers here (see its
> catalog note). Payload schemas are the zod definitions in
> [`packages/shared/src/schemas/events.ts`](../packages/shared/src/schemas/events.ts)
> — both the Phase-2 mock adapter and the Phase-4 backend validate against
> them. Emitters cite transition ids from
> [state-machines.md](../docs/design/state-machines.md); shapes that depend on
> an open decision carry `[D-xx]`.

## CHANGELOG

| Version | Date | Change |
|---|---|---|
| 0.6.0 | 2026-08-11 | §5 defines the participant-cookie-authenticated student WS and atomic connect snapshot (CG-22); student `quiz.question` becomes state-discriminated and names `ownAnswerOptionId` (CG-23); `quiz.result` gains its question snapshot, selected option and rank freshness (CG-24); student `quiz.session` becomes a participation-discriminated terminal summary (CG-25). Wave 7 S-39…S-41 wireframe-gate answers; see [contract-amendments.md](../docs/design/contract-amendments.md). |
| 0.5.0 | 2026-08-09 | §2.18 `UploadJobPayload` gains `failureClass` (CG-20), mirroring the openapi `UploadJob.failureClass` so S-35 can tell an offline stall from a server failure live, not only on a REST snapshot. §1 records the implicit scoped-subscription semantic (CG-3): calling a flow's REST entry marks the AuthSession subscribed to its scoped stream — no WS client→server message. Wave 5 (S-35/S-23) wireframe-gate answers; see [contract-amendments.md](../docs/design/contract-amendments.md). |
| 0.4.0 | 2026-08-08 | §2.15 `QuizSessionPayload` gains `syncState` (CG-19), mirroring `QuizSessionProjection.syncState` so the joined-count staleness is knowable live and not only on REST snapshot. Wave 4 (S-20) wireframe-gate answer; see [contract-amendments.md](../docs/design/contract-amendments.md). |
| 0.3.0 | 2026-08-05 | §2.1 `RecordingStatePayload` gains `takeoverAt` + `takeoverByDisplayName` (CG-14). §2.10 `system.alert` emitter list gains R-22 (CG-17). Both Wave 2 (S-06/S-12) wireframe-gate answers; see [contract-amendments.md](../docs/design/contract-amendments.md). |
| 0.1.0 | 2026-07-30 | Initial contract. Adopts state-machines §10 verbatim, plus four additions that §10 lacked but screens require: `audio.control` (INV-AC-1), `export.job` + `usb.volumes` (LP-10/LP-11, B-38 session scoping), `firmware.state` (AD-5). `ai.batch_ready` from earlier sketches is **superseded** by `ai.set` (state `ready` *is* batch-ready) per state-machines §10. Defines the WebRTC preview-signaling envelope (A-17) and the device↔quiz-server sync contract (DM-P5). |

---

## 1. Transport & envelope

**Endpoint.** `GET /api/v1/ws` (upgrade), authenticated with the same bearer
token as REST (`?token=` or `Sec-WebSocket-Protocol`; Phase-3 hardening
decides which — the token is short-lived either way, PF-17).

**Direction.** Server→client **only** on this channel — clients send no WS
messages; commands go over REST (target-architecture §2.1). The two
exceptions each get their own socket: preview signaling (§3) and the
device↔quiz-server sync stream (§4).

**Envelope.** Every event is:

```jsonc
{ "event": "recording.state", "at": "2026-07-30T09:00:00+00:00", "seq": 41, "payload": { /* per-event schema */ } }
```

`seq` is per-connection and monotonic. A gap forces a **full resync** — the
client re-requests the subscribe snapshot; there is no partial patching
(state-machines §5.5).

**On subscribe** the server immediately emits the current snapshot:
`recording.state`, `channel.state` ×3, `sources.status` ×role,
`storage.status`, `device.health`, `ai.countdown`, `ai.set` (current),
open `quiz.publication` + `quiz.session`, and every uncleared `system.alert`.
This is the same data as the REST snapshot mirrors (`/recording/state`,
`/sources/status`, …), so a client may render from either and then follow
events.

**Reconnect.** Backoff `T-WS-RECONNECT` (0.5→10 s, unlimited). Disconnected
longer than `T-WS-STALE` (10 s) ⇒ the panel dims live regions; the red/amber
recording frame is kept with a "panel offline" marker (state-machines §5.5).
Commands are never queued and replayed.

**Scoping.** Most events broadcast to every authenticated panel/admin client.
Exceptions, scoped to specific connections:

| Event | Scope | Why |
|---|---|---|
| `export.job`, `usb.volumes` | the AuthSession that requested the export / has the export flow open | B-38's `io.emit` broadcast bug |
| `log.entry` | connections that subscribed to the live log view (AD-7 open) | volume |
| `audio.levels` | panel connections only | telemetry volume (§6 budget) |

**How a session becomes subscribed (CG-3, v0.5).** Clients send no WS messages,
so there is no explicit subscribe frame. Instead, **calling a scoped stream's
REST entry marks the calling `AuthSession` subscribed for a TTL**, refreshed by
continued reads and expiring on TTL or session end: `GET /exports/targets`
subscribes to `usb.volumes`; `createExport`/`GET /exports/{id}` subscribe to
`export.job` for that job; `GET /logs` subscribes to `log.entry`. This gives the
scoped streams a defined trigger without a new endpoint or a client→server
message (S-23 EXP-D-4; the same mechanism S-34's live tail reuses).

**Secrets never appear in any event** — stream keys, upload credentials, RTSP
passwords (INV-ST-1, INV-UJ-5, PF-17, B-59).

---

## 2. core-api → panel/admin events

Zod: `PanelServerEvent` (discriminated union over `event`).

### 2.1 `recording.state`

| | |
|---|---|
| Direction | core-api → panel, admin |
| Payload | `RecordingStatePayload` — `state` (incl. `idle`), `startReason`, `sessionId`, `title`, `ownerUserId`, `ownerDisplayName`, `startedAt`, `recordedDurationMs`, `segmentIndex/Count`, `pauseCount`, `takeoverBy`, `takeoverAt`, `takeoverByDisplayName` (v0.3, CG-14 — set by R-21 alongside `takeoverBy`, S06-D-4), `errorCode/Message`, `adopted?` |
| Emitter | Machine 1a: R-01, R-03 (re-broadcast for the locked view), R-05…R-22; boot recovery BR-1…BR-9 |
| Frequency | On transition + on subscribe. The timer ticks **locally** from `startedAt`/`recordedDurationMs` — no per-second events (INV-G-7) |
| Consumers | Panel frame/notch/TimerCard (LP-4), locked view (LP-6), admin header |

### 2.2 `recording.segment`

| | |
|---|---|
| Direction | core-api → panel, admin |
| Payload | `RecordingSegmentPayload` — `sessionId`, `recordingId`, `segmentId`, `index`, `state`, `endReason`, `durationMs` |
| Emitter | SEG-1 bookkeeping: R-05 (open), R-08/R-09/R-12/R-13/R-16 (close) |
| Frequency | On segment open/close — ≤ 2 per pause cycle |
| Consumers | Panel pause indicator detail; AD-9 diagnostics |

### 2.3 `recording.artifact`

| | |
|---|---|
| Direction | core-api → panel library, admin AD-9 |
| Payload | `RecordingArtifactPayload` — `recordingId`, `sessionId`, `state`, `mergeState`, `durationMs`, `totalBytes`, `deleteReason` |
| Emitter | Machine 1b: RA-01…RA-07; retention sweep RET-1/RET-3 (via RA-06) |
| Frequency | On transition (≤ ~6 per lecture) |
| Consumers | Library badges (LP-10): "Preparing…" (`merging`), failed-with-retry, deletion removal |

### 2.4 `channel.state`

| | |
|---|---|
| Direction | core-api → panel, admin |
| Payload | `ChannelStatePayload` — `channelId`, `state`, `presetId`, `ratioA/B`, `reason` |
| Emitter | Machine 1c: CH-01…CH-10 |
| Frequency | On transition + on subscribe |
| Consumers | ChannelCard switches (LP-7), "still streaming while paused" indicator (SM-Q-4), AD-8 |

### 2.5 `sources.status`

| | |
|---|---|
| Direction | core-api (projecting pipeline-manager) → panel, admin |
| Payload | `SourcesStatusPayload` — `roleId`, `state`, `detail`, `since`, `inputId` |
| Emitter | Machine 5a: HL-01…HL-09 |
| Frequency | On transition + on subscribe; transitions are debounced by T-SOURCE-DEBOUNCE/-DEGRADE/-OFFLINE, so steady state is silent |
| Consumers | Source tiles + panel-bar dots (LP-8), Admin network page probe feedback (AD-2) |

### 2.6 `audio.levels` — throttled

| | |
|---|---|
| Direction | core-api (from pipeline-manager) → panel only |
| Payload | `AudioLevelsPayload` — `roleId`, `rms` 0–1 |
| Emitter | Live audio path telemetry — **no state machine**; telemetry, never rows (INV-AC-2, INV-G-7) |
| Frequency | **Throttled to ≤ 10 Hz** while any panel is connected; suppressed entirely when no panel subscribes (§6 budget: the kiosk browser shares the board with the pipelines) |
| Consumers | Mic level meter (LP-9) |

### 2.7 `audio.control` *(v0 addition)*

| | |
|---|---|
| Direction | core-api → panel, admin |
| Payload | `AudioControlPayload` — `roleId`, `gain`, `muted`, `appliedState`, `lastError` |
| Emitter | Resolution of `PUT /audio/controls/{roleId}` after pipeline-manager applies (or fails to apply) the mixer change; also on boot re-apply |
| Frequency | On change (user-driven) |
| Consumers | Mic gain/mute UI + Room Controls master mute (LP-9, LP-14) — shows **actual** applied state, never assumed success (INV-AC-1, B-55/B-12) |

### 2.8 `storage.status`

| | |
|---|---|
| Direction | core-api → panel, admin |
| Payload | `StorageStatusPayload` — `pressure`, `freeBytes`, `totalBytes`, `policy` (full `RetentionPolicy` so warning text quotes real values — INV-RP-1) `[D-15]` |
| Emitter | Machine 5b: HL-10…HL-14; R-20 |
| Frequency | On transition + every 60 s |
| Consumers | Dashboard storage warning (LP-12), AD-4 |

### 2.9 `device.health`

| | |
|---|---|
| Direction | core-api → admin, panel |
| Payload | `DeviceHealthPayload` — `captureCardState`, `publisherStates`, `ntpSynced`, `clockOffsetMs`, `diskHealth`, `lastBootAt` |
| Emitter | Machine 5c: HL-20…HL-23; pipeline-manager telemetry ingestion |
| Frequency | On change + every 60 s |
| Consumers | AD-4 (SMART), AD-10 (NTP line), Hardware alerts context |

### 2.10 `system.alert`

| | |
|---|---|
| Direction | core-api → panel, admin |
| Payload | `SystemAlert` (full row incl. `clearedAt`/`clearedReason`) |
| Emitter | Every raising/clearing transition: R-02/R-04/R-06/R-07/R-09/R-13/R-16/R-18/R-19/R-20/R-22 (v0.3, CG-17 — licenses the `poweroff.refused` alert S-03's banner host and S-12 already render, S12-D-3), RA-04, CH-03/CH-06/CH-09, Q-05, Q-32, Z-03/Z-06, Z-32, U-07/U-08, HL-04…HL-23; re-evaluated per T-ALERT-REEVALUATE (30 s — INV-SA-1) |
| Frequency | On raise/clear; alerts affecting recording reach the panel within 5 s (INV-SA-3, G-1) |
| Consumers | Panel alert surfaces (LP-4/LP-12 banners, recovery banner J-4), admin alert list |

### 2.11 `log.entry`

| | |
|---|---|
| Direction | core-api → admin (AD-7 live view subscribers only) |
| Payload | `LogEntry` |
| Emitter | Every state-machine failure a user can observe (INV-LE-2) and INFO/WARN traffic from all services (PF-15) |
| Frequency | On write — bounded by log policy, not per-frame telemetry |
| Consumers | SystemLogs admin page live tail (AD-7) |

### 2.12 `ai.countdown`

| | |
|---|---|
| Direction | core-api → panel |
| Payload | `AiCountdownPayload` — `state`, `remainingMs`, `nextAt`, `intervalMinutes` |
| Emitter | Machine 2a: Q-01…Q-10 |
| Frequency | On transition + every **T-COUNTDOWN-RESYNC (15 s)**; the panel renders the ticking mm:ss locally from `nextAt` — countdown ticks are never events per second (INV-G-7) |
| Consumers | AI central countdown display, interval select, Generate Now button state (LP-16) |

### 2.13 `ai.set` — supersedes `ai.batch_ready`

| | |
|---|---|
| Direction | core-api → panel |
| Payload | `AiSetPayload` — `setId`, `sessionId`, `state`, `trigger`, `count`, `error`, `attempt` |
| Emitter | Machine 2b: Q-11…Q-17 |
| Frequency | On transition (≤ ~4 per generation cycle) |
| Consumers | Green "A new set is ready" banner (`state=ready` **is** batch-ready), generating/failed studio states with retry (LP-16, J-2) |

### 2.14 `ai.question`

| | |
|---|---|
| Direction | core-api → panel |
| Payload | `AiQuestionPayload` — `questionId`, `setId` (null = lecturer-authored), `state`, `provenance`, `edited` |
| Emitter | Machine 2c: Q-18…Q-23 (create/edit/discard/send/close, incl. supersession from Q-16) |
| Frequency | On transition; a new ready batch emits ×N drafts |
| Consumers | Review modal cards, "Yours" chip, discard/edit feedback (LP-16) |

### 2.15 `quiz.session`

| | |
|---|---|
| Direction | core-api → panel, projector consumer |
| Payload | `QuizSessionPayload` — `state` (projection: absent/requesting/open/closed/failed), `quizSessionId`, `joinUrl`, `joinCode`, `joinedCount`, `syncState` (v0.4, CG-19: `synced`/`stale`/`failed` — mirrors `QuizSessionProjection.syncState` so the joined-count staleness is knowable live, not only on REST snapshot; Machine 4d Z-30) |
| Emitter | Machine 4a: Z-01…Z-06; joined-count updates from `sync.participants` (§4); `syncState` from Machine 4d (Z-30) |
| Frequency | On transition + on joined-count change + on `syncState` change (coalesced to ≤ 1/s) |
| Consumers | Join QR + joined count card (QZ-2, S-20), "quiz unavailable" notice (LP-18); S-20's stale-count marker reads `syncState` (CG-19); the projector consumer renders the QR overlay (PF-11) |

### 2.16 `quiz.publication`

| | |
|---|---|
| Direction | core-api → panel, projector consumer |
| Payload | `QuizPublicationPayload` — `publicationId`, `questionId`, `state`, `isShowing`, `projectorState`, `syncState`, `closeReason` |
| Emitter | Machine 2d: Q-30…Q-36; machine 4d: Z-30/Z-31 (`syncState`) |
| Frequency | On transition |
| Consumers | "Now showing" badge (exactly one — INV-QPUB-1), publish-failed retry state (INV-QPUB-3), stale marker (QZ-7); projector consumer switches slides ↔ question (A-22). **The projector consumer never receives leaderboard data** (INV-QZ-3, INV-LB-3) |

### 2.17 `quiz.responses`

| | |
|---|---|
| Direction | core-api → panel (LP-17) |
| Payload | `QuizResponsesPayload` — `publicationId`, `deltas[{studentIdNumber, displayName, selectedOptionId, isCorrect, responseTimeMs, submittedAt}]`, `syncedAt`, `stale` |
| Emitter | Ingestion of `sync.answers` batches (§4); Z-30/Z-31 flips `stale` |
| Frequency | On answer batch from the quiz server (quiz-service batches ≤ 1/s per session) + on stale/recover |
| Consumers | Insights response/correct/incorrect chips, per-student drill-down, live leaderboard recompute (LP-17 — derived client-side with the shared DM-10 formula) |

### 2.18 `upload.job`

| | |
|---|---|
| Direction | core-api → admin AD-9, panel library |
| Payload | `UploadJobPayload` — `jobId`, `recordingId`, `state`, `attempt`, `failureClass` (CG-20 — `connectivity`/`server`/`permanent`/null, mirrors `UploadJob.failureClass`; null unless `state ∈ {failed, dead-letter}`), `nextAttemptAt`, `progressPct`, `lastError`, `blockedBy` `[D-02b]` |
| Emitter | Machine 3a: U-01…U-10 |
| Frequency | On transition + progress steps ≥ 5 % |
| Consumers | AD-9 queue rows (waiting/uploading/done/failed/dead-letter + retry history), library upload badge (LP-10) |

### 2.19 `upload.part`

| | |
|---|---|
| Direction | core-api → admin AD-9 |
| Payload | `UploadPartPayload` — `partId`, `jobId`, `streamKey`, `state`, `bytesSent/Total` `[D-02b]` |
| Emitter | Machine 3b: UP-01…UP-05 |
| Frequency | On transition + progress steps ≥ 5 % |
| Consumers | AD-9 per-file expansion |

### 2.20 `export.job` *(v0 addition)*

| | |
|---|---|
| Direction | core-api → **the requesting AuthSession only** (B-38 fix) |
| Payload | `ExportJobPayload` — `jobId`, `state`, `bytesCopied`, `bytesTotal`, `error` |
| Emitter | ExportJob lifecycle (queued→copying→completed/failed/cancelled — linear entity lifecycle, domain model §6.5; no §1–6 machine exists and none is needed) |
| Frequency | On transition + progress steps ≥ 5 % — **real transfer bytes**, never free-space arithmetic (INV-EX-1) |
| Consumers | Library export progress UI (LP-10/LP-11) |

### 2.21 `usb.volumes` *(v0 addition)*

| | |
|---|---|
| Direction | core-api → sessions with the export flow open |
| Payload | `UsbVolumesPayload` — `volumes: UsbVolume[]` (system + recordings volumes never listed — INV-EX-2) |
| Emitter | udev hotplug detection (LP-11); transient hardware presence is events + snapshots, never rows (domain model §10) |
| Frequency | On insert/remove |
| Consumers | Export target picker (LP-11 — the user picks; never "the first drive", B-38) |

### 2.22 `firmware.state` *(v0 addition)*

| | |
|---|---|
| Direction | core-api → admin |
| Payload | `FirmwareUpdate` (full read view) |
| Emitter | FirmwareUpdate lifecycle idle→checking→downloading→verifying→applying→done / failed / rolled-back (linear entity lifecycle, domain model §4.13; AD-5) |
| Frequency | On state change |
| Consumers | Firmware admin page progress + rollback outcome (AD-5) |

---

## 3. WebRTC preview signaling (A-17) — separate socket

Source-tile previews are **WebRTC streams**, negotiated on a dedicated socket
so the event channel stays strictly one-way (target-architecture §2.1).

**Endpoint.** `GET /api/v1/ws/preview` (same auth as §1).
**Zod.** `PreviewClientMessage` / `PreviewServerMessage`.
**Budget.** Preview visible < 1 s from tap (INT-8); the thumbnails consumer on
pipeline-manager serves the media (`POST /consumers/thumbnails/start|stop`,
target-architecture §2.2 — internal, not part of this contract).

Envelope (no `seq` — negotiation is correlated by `negotiationId`, minted by
the client per lightbox open):

| Message | Direction | Fields | Notes |
|---|---|---|---|
| `offer` | client → server | `negotiationId`, `roleId`, `sdp` | One negotiation per open preview. Rejected for roles not `online` (machine 5a) |
| `answer` | server → client | `negotiationId`, `sdp` | |
| `ice` | both | `negotiationId`, `candidate`, `sdpMid`, `sdpMLineIndex` | Trickle ICE both ways |
| `close` | client → server | `negotiationId` | Closing the lightbox; server tears the peer down. Server may also drop unilaterally (source went offline) — client sees `error` |
| `error` | server → client | `negotiationId`, `code` (`source-offline` \| `source-unbound` \| `busy` \| `internal`), `message` | Terminal per negotiation |

Rules:
- ≤ 1 active negotiation per panel connection (one lightbox at a time); a new
  `offer` implicitly closes the previous negotiation.
- Preview death never affects recording — publishers/consumers are untouched
  (INV-CC-2 spirit; the thumbnails consumer is its own consumer).
- Media is device-LAN only; no TURN in V1 (panel and device share the kiosk).

---

## 4. Device ↔ quiz-server sync contract (A-16, QZ-7, DM-P5) `[D-21]`

Cross-zone and unreliable by construction: the device sits on the campus LAN,
the quiz server is public, students may be on mobile data. **Every connection
is device-initiated** — the public zone can never dial into the LAN.

Two halves:

1. **Outbound REST** (device → quiz-service), defined in
   [openapi.yaml](openapi.yaml) under the `quiz-sync` tag: mint session
   (Z-01), close session (Z-05), publish question (Q-30/Q-31 — the 201 ack
   **is** `G-PUBLISH-ACK`, deadline T-PUBLISH-ACK 5 s), close publication
   (Q-33/34/35, carrying the authoritative `closedAt` — INV-QPUB-4).
2. **Outbound WS stream** (device connects to
   `wss://{quizServerBaseUrl}/api/device/v1/stream`), carrying answers and
   participant counts **back** to the device. Zod:
   `QuizSyncClientMessage` / `QuizSyncServerMessage`.

Auth: provisioned device credential (bearer). The scheme (static token vs
signed) is an open item under **DM-P5**.

| Message | Direction | Fields | Emitter / frequency | Consumer |
|---|---|---|---|---|
| `sync.hello` | device → quiz | `deviceId`, `quizSessionId`, `answerWatermark` | On (re)connect. Watermark = highest `seq` durably stored device-side | quiz-service starts replay **above** the watermark — idempotent recovery after any gap (Z-31/Z-33); projection rows are replaced, never edited (INV-AP-1) |
| `sync.answers` | quiz → device | `quizSessionId`, `answers[{seq, answerId, publicationId, studentIdNumber, studentDisplayName, selectedOptionId, isCorrect, responseTimeMs, submittedAt}]` | On answer batch (quiz-service coalesces ≤ 1/s per session); Z-22 is the origin | core-api writes `AnswerProjection` rows and emits `quiz.responses` (§2.17) |
| `sync.participants` | quiz → device | `quizSessionId`, `joinedCount`, `onlineCount` | On join/leave, coalesced ≤ 1/s (Z-11…Z-14) | core-api updates the projection and emits `quiz.session` joined count |
| `sync.heartbeat` | both | `at` | Every **T-QUIZ-HEARTBEAT (5 s)** | Machine 4d liveness: silence > T-QUIZ-SYNC-STALE (15 s) ⇒ `stale` (Z-30); > T-QUIZ-SYNC-FAIL (60 s) ⇒ `failed` (Z-32). Recording untouched (QZ-7) |

Notes:
- `seq` is minted by quiz-service, monotonic **per quiz session** — it is the
  replay watermark, not an id (ids stay ULIDs, INV-G-2).
- `isCorrect`/`pointsAwarded` are evaluated by quiz-service **at submit time**
  (Z-22) against the pushed `correctOptionId`; a later question edit cannot
  rewrite results (INV-Q-4).
- Student-facing events (`quiz.question`, `quiz.result`, `quiz.participant`,
  student `quiz.session`) are emitted by quiz-service over the student channel
  defined in §5. Their payload schemas are in `events.ts`
  (`StudentServerEvent`) so apps/quiz shares the same types. Student REST is
  quiz-service-owned and defined in [quiz-app.yaml](quiz-app.yaml) (CG-1).

---

## 5. Quiz-service → student realtime contract (CG-22…CG-25)

**Endpoint.** `GET /api/student/v1/stream` (upgrade), hosted by the quiz-service.
The upgrade is authenticated only by the same `eduscope_participant` Secure,
HttpOnly, SameSite=Lax cookie defined in [quiz-app.yaml](quiz-app.yaml). A
participant id or credential is never accepted in a query parameter, frame, or
browser-readable store (SQ-D-2).

**Direction and envelope.** Server→student only. Commands use REST. Every frame
uses the shared event envelope:

```jsonc
{ "event": "quiz.question", "at": "2026-08-11T09:00:00+00:00", "seq": 4, "payload": { /* below */ } }
```

`seq` is per connection and monotonic. Clients never queue an answer while
offline. Reconnect uses `T-WS-RECONNECT` (0.5, 1, 2, 4, 8 s, capped at 10 s,
unlimited).

### 5.1 Atomic full snapshot on every connect (CG-22)

Before any live delta, the quiz-service emits one uninterrupted snapshot in
this exact order:

1. exactly one student `quiz.session`;
2. exactly one `quiz.participant` connection state;
3. exactly one `quiz.question` (`open`, `closed`, or `none`);
4. the current participant's `quiz.result` when a current own result applies;
5. only then, live deltas.

The client replaces its entire student quiz state atomically after the snapshot
is complete; it never merges the new question/result into stale in-memory
state. A reconnect therefore cannot flash the prior question or retain a result
that the server did not include (SQ-D-5, INV-AP-1).

### 5.2 `quiz.question` (CG-23 — breaking)

State-discriminated payload:

- `state: open | closed`: `publicationId`, `prompt`, `options` (2–4 entries of
  `{id,label,text}`), and `ownAnswerOptionId: Ulid | null`;
- `state: none`: no publication, prompt, options, or own-answer fields.

`ownAnswerOptionId` is the selected **option id**, never an answer-row id.

### 5.3 `quiz.result` (CG-24 — additive)

Own-result payload only: `publicationId`,
`question:{prompt,options[{id,label,text}]}`, `selectedOptionId: Ulid | null`
(`null` means missed), `isCorrect: boolean | null`, `correctOptionId`,
`pointsAwarded`, `runningScore`, `ownRank: integer | null`, and
`rankState: pending | current`. It contains no other participant identity or
leaderboard list and is self-contained after cold connect/reload (SQ-D-6).

### 5.4 `quiz.participant`

Payload: `connectionState: online | offline`. It describes only the
cookie-authenticated participant.

### 5.5 Student `quiz.session` (CG-25 — breaking)

State-discriminated payload:

- `state: open`: participation is absent; final fields are absent or null;
- `state: closed, participationState: participated`: `finalScore` and
  `finalRank` are non-null, and `answeredCount > 0`;
- `state: closed, participationState: none`: `answeredCount: 0`,
  `finalScore: 0`, `finalRank: null`.

The terminal payload contains only the current participant's summary.

---

## 6. Frequency budget (panel on the same board — PRD §6)

| Class | Events | Steady-state rate |
|---|---|---|
| Telemetry | `audio.levels` | ≤ 10 Hz, panel-subscribed only |
| Periodic resync | `storage.status`, `device.health` (60 s), `ai.countdown` (15 s) | < 0.1 Hz combined |
| Progress | `upload.job/part`, `export.job` (≥ 5 % steps) | bursty, bounded |
| Transitions | everything else | event-driven, silent at steady state |

No polling anywhere a WS event exists (target-architecture §6).

---

## 7. Screen ↔ surface cross-check (PRD journeys J-1…J-5)

Both directions of the rule: every endpoint has a screen; every screen need
has an endpoint/event.

| Screen / journey need | REST | Events |
|---|---|---|
| Login, forced reset (LP-1/2, J-1/J-5) | `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`, `/auth/change-password` | — |
| One-tap record, pause/resume/stop, refusals (LP-3/4/5, J-1) | `/recording/state`, `/recording/start\|pause\|resume\|stop` | `recording.state`, `recording.segment`, `system.alert` |
| Lock & takeover (LP-6) | `/recording/takeover` | `recording.state` (owner + takeoverBy) |
| Channels + layouts (LP-7/15, AD-1) | `/channels`, `/channels/{id}` (PUT/enable/disable), `/layouts` | `channel.state` |
| Source tiles + previews (LP-8, INT-8) | `/sources/roles`, `/sources/status` | `sources.status`; §3 signaling |
| Mic control (LP-9) + master mute (LP-14) | `/audio/controls`, `/audio/controls/{roleId}` | `audio.levels`, `audio.control` |
| Library: list/play/download/delete (LP-10) | `/recordings`, `/recordings/{id}`, `…/files/{fileId}/media`, `DELETE /recordings/{id}` | `recording.artifact`, `upload.job` (badge) |
| USB export (LP-10/11, INT-1) | `/exports/targets`, `/exports`, `/exports/{id}`, `…/cancel` | `usb.volumes`, `export.job` |
| Storage warning (LP-12) | `/storage` (policy text source) | `storage.status`, `system.alert` |
| Power off (LP-13) | `/device/power-off` (R-22 refusal) | `system.alert` |
| AI studio (LP-16, J-2) | `/ai/countdown`, `/ai/interval`, `/ai/generate-now`, `/ai/question-sets`, `/ai/questions` (+create/edit/discard), `…/send-to-projector`, `/ai/publications`, `…/close`, `/ai/projector` | `ai.countdown`, `ai.set`, `ai.question`, `quiz.publication` |
| Insights + leaderboard (LP-17) | `/ai/publications`, `/quiz/publications/{id}/responses`, `/quiz/leaderboard` | `quiz.responses` |
| AI-degraded mode (LP-18) | `/ai/countdown` (`unavailable`), `/quiz/session` (`absent`/`failed`) | `ai.countdown{degraded}`, `system.alert` |
| Join QR + joined count (QZ-2, J-3) | `/quiz/session` | `quiz.session` |
| Network + camera IPs (AD-2) | `/settings/network`, `/settings/network/{id}`, `/sources/inputs`, `/sources/inputs/{id}`, `/sources/bindings`, `/sources/bindings/{roleId}` | `sources.status`, `system.alert` |
| Encoder (AD-3) | `/settings/encoder` (GET/PUT with capabilities) | — |
| Local storage, swap/format (AD-4, J-5) | `/storage`, `/storage/volumes`, `…/format`, `/health` | `storage.status`, `device.health`, `system.alert` |
| Firmware (AD-5) | `/firmware`, `/firmware/check`, `/firmware/apply` | `firmware.state` |
| Users + Excel import (AD-6, J-5) | `/users` (list/create), `/users/{id}` (patch/delete), `/users/import` | — |
| System logs (AD-7) | `/logs`, `/logs/export` (CSV) | `log.entry` |
| Streaming config (AD-8) | `/settings/stream-targets` (CRUD), `/channels/streaming` | `channel.state` |
| Upload queue (AD-9) | `/uploads`, `/uploads/{id}`, `…/requeue` | `upload.job`, `upload.part` |
| Device identity read-only (AD-10) | `/provisioning`, `/health` | `device.health` |
| Alerts (panel + admin) | `/alerts`, `/alerts/{id}/acknowledge` | `system.alert` |
| Crash-recovery banner (J-4) | — (arrives via events on reconnect) | `recording.state{startReason:recovery}`, `system.alert{session.recovered}` |
| Projector consumer (PF-11, A-22) | — (internal consumer; driven by core-api) | `quiz.session`, `quiz.publication` |
| Student app (QZ-1…6, J-3) | quiz-service-owned REST (open item) | `StudentServerEvent` schemas (§4 note) |

---

## 8. Open items & contract decisions taken in v0 (review these)

| # | Item | Decision taken / question |
|---|---|---|
| C-1 | **No upload-job cancel endpoint.** The brief's "upload queue (list/retry/cancel)" conflicts with machine 3: `cancelled` is reachable only via recording deletion (U-10), and AD-9 specifies re-enqueue, not cancel. v0 ships list + detail + requeue only; cancelling an upload = deleting the recording. Reverse if PM wants a standalone cancel (it would need a new U-xx transition). |
| C-2 | **Four events added beyond state-machines §10** (`audio.control`, `export.job`, `usb.volumes`, `firmware.state`) — §10 has been patched to point here. ExportJob and FirmwareUpdate deliberately have no state-machine doc section; their entity enums are linear lifecycles. |
| C-3 | **AuditLogEntry has no query endpoint.** No PRD screen lists audit entries (AD-7 is LogEntry). State-machines §8 says set dispositions are "visible only in the audit log (AD-7)" — v0 resolves this by requiring every audited action to also write a Session-category `LogEntry` (INV-SA-2 pattern). If a dedicated audit browser is wanted, add `GET /audit` in v0.2. |
| C-4 | **Channel enable/disable only during an active session** (409 `session.not-active` otherwise); idle-state switches write `enabledByDefault` via `PUT /channels/{id}`. Matches machine 1c scope; flag if the panel should treat idle toggles as commands instead. |
| C-5 | **Network apply is 202 + row-readback** (`appliedAt`/`lastApplyError`) + `system.alert` on failure — no dedicated `network.apply` event, keeping §10's closed catalog small. |
| C-6 | **Student-app REST surface applied in v0.6 (CG-1).** Join-code resolution, self-registration/rejoin, answer submission, the participant cookie, registration policy, and named problems are quiz-service-owned and defined in `contracts/quiz-app.yaml`. Student realtime payloads and atomic reconnect are §5 here. |
| C-7 | **Quiz-sync auth scheme** (static bearer vs signed requests) left open under DM-P5; the paths assume `deviceAuth` bearer. |
| C-8 | **WS auth transport** (`?token=` vs subprotocol) is a Phase-3 hardening pick; both are representable without a contract bump. |
| C-9 | **`GET /recording/state` + REST snapshot mirrors** exist alongside the WS on-subscribe snapshot so screens can cold-render and the mock adapter is REST-testable. They are read-only mirrors, not second truths (SM-R-1: same single writer). |
| C-10 | **Retention policy is read-only in v0** (embedded in `/storage` and `storage.status`). No PRD screen edits it; if [D-15] closes with admin-editable thresholds, add `PUT /settings/retention` in v0.2. |
