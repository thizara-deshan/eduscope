# D-08 evidence — DR-22 two-backend (real B + real D) sync recovery gate

Copy this file to `d08-<YYYYMMDD>.md` and fill every field from the actual
run of `pnpm --filter @eduscope/quiz-service test -- test/integration/device-sync.test.ts`.
An unrun row stays `NOT RUN — gate failed` — never leave it blank and never
mark the task complete with a blank or invented PASS. This evidence must
contain no device bearer, student name/id, question prompt, option text, or
answer choice — ids and counts only.

## Identity

| Field | Value |
|---|---|
| Date | NOT RUN — gate failed |
| Commit SHA | NOT RUN — gate failed |
| PostgreSQL version (`postgres:16-alpine`, Testcontainers) | NOT RUN — gate failed |
| Device id (B provisioning `deviceId`) | NOT RUN — gate failed |
| Lecture session id | NOT RUN — gate failed |
| Quiz session id | NOT RUN — gate failed |

## sync.hello watermarks

| Event | answerWatermark |
|---|---|
| Initial hello (recording start) | NOT RUN — gate failed |
| Post-recovery hello (after reconnect) | NOT RUN — gate failed |

Expected: `[0, 2]`.

## Link-cut timeline

| Field | Value |
|---|---|
| Device-stream test gate closed at (B clock offset, s) | NOT RUN — gate failed |
| B syncState → `stale` observed after (s since last activity) | NOT RUN — gate failed |
| B syncState → `failed` observed after (s since last activity) | NOT RUN — gate failed |
| `quiz.sync-stale` alert raised? | NOT RUN — gate failed |
| Gate reopened / device socket reconnected at (B clock offset, s) | NOT RUN — gate failed |

Expected: stale after the 20s cut, failed after the 65s cut (both past the
contract's `T-QUIZ-SYNC-STALE`/`T-QUIZ-SYNC-FAIL` thresholds).

## B session/publication state transitions

| Field | Value |
|---|---|
| syncState sequence | NOT RUN — gate failed |
| `quizSessionProjections`/`questionPublications` rows retained across the outage? | NOT RUN — gate failed |
| `recordingState` throughout (lecture session `state`) | NOT RUN — gate failed |

Expected syncState sequence: `synced → stale → failed → synced`. Expected
`recordingState`: `recording`, unchanged for the entire run (QZ-7).

## Answers submitted while the device stream was down

| Field | Value |
|---|---|
| D `next_answer_seq` before the outage | NOT RUN — gate failed |
| Answers accepted by D while disconnected (REST 200s) | NOT RUN — gate failed |
| D `next_answer_seq` after those answers | NOT RUN — gate failed |
| B `lastAnswerSeq` immediately before reconnect | NOT RUN — gate failed |
| B `lastAnswerSeq` immediately after reconnect | NOT RUN — gate failed |
| Replay frame seq set delivered on reconnect | NOT RUN — gate failed |

Expected: D's watermark advances to 4 while B is disconnected; the replay on
reconnect carries exactly seq 3 and 4; B's watermark becomes 4.

## Participants / heartbeat

| Field | Value |
|---|---|
| Joined count (registration) | NOT RUN — gate failed |
| Online count restored after reconnect? | NOT RUN — gate failed |
| First post-reconnect heartbeat observed? | NOT RUN — gate failed |

## D/B row parity (field-by-field, D-only `studentId`/`pointsAwarded`/`quizSessionId`/`seq` excluded)

| Field | Value |
|---|---|
| D authoritative answer row count | NOT RUN — gate failed |
| B `answer_projections` row count | NOT RUN — gate failed |
| Row counts equal? | NOT RUN — gate failed |
| Every D row deep-equal to its matching B row (by answerId)? | NOT RUN — gate failed |
| Duplicate `(publicationId, studentIdNumber)` rows on either side? (must be none) | NOT RUN — gate failed |

## Commands and exit codes

```text
NOT RUN — gate failed
```

## PASS/FAIL per phase

| Phase | Result |
|---|---|
| Peer extraction regression (`test/quiz/sync.test.ts`, `test/contract/sync-hello.contract.test.ts`) | NOT RUN — gate failed |
| D-08 real B + real D integration test | NOT RUN — gate failed |
| Overall D-08 gate | NOT RUN — gate failed |
