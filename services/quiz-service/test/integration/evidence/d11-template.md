# D-11 evidence — exact D ownership and happy-flow workstream gate

Copy this file to `d11-<YYYYMMDD>.md` and fill every field from the actual
run of `pnpm --filter @eduscope/quiz-service gate:d`, plus a re-run of
`test/integration/device-sync.test.ts`, `load:200`, `test/operations`, and
`test/integration/happy-flow.test.ts`. An unrun row stays
`NOT RUN — gate failed` — never leave it blank and never mark the task
complete with a blank or invented PASS. This evidence must contain no device
bearer, cookie/participant token, student name/id, question prompt, option
text, or answer choice — ids, counts, and pass/fail outcomes only.

## Identity

| Field | Value |
|---|---|
| Date | NOT RUN — gate failed |
| Commit SHA | NOT RUN — gate failed |
| PostgreSQL version (`postgres:16-alpine`, Testcontainers) | NOT RUN — gate failed |
| Node version | NOT RUN — gate failed |

## Prior final-verification evidence (immutable, linked not repeated)

| Task | Evidence path | SHA-256 |
|---|---|---|
| D-08 (real B + real D DR-22 recovery) | `services/quiz-service/test/integration/evidence/d08-<YYYYMMDD>.md` | NOT RUN — gate failed |
| D-09 (abuse controls + 200-client load) | `services/quiz-service/test/load/evidence/d09-<YYYYMMDD>.md` | NOT RUN — gate failed |
| D-10 (campus packaging and operations) | `services/quiz-service/test/operations/evidence/d10-<YYYYMMDD>.md` | NOT RUN — gate failed |

## Exact ownership counts (`test/contract/ownership.test.ts`)

| Surface | Expected | Observed |
|---|---|---|
| REST operations (openapi.yaml quiz-sync + quiz-app.yaml student) | 7 | NOT RUN — gate failed |
| Student server event names | 4 | NOT RUN — gate failed |
| D-owned device server message names | 3 | NOT RUN — gate failed |
| Overlap with `PANEL_OPERATION_IDS` (must be zero) | 0 | NOT RUN — gate failed |
| Route surface outside the seven REST routes (`/healthz`, two WS upgrades, Next fallback only) | closed | NOT RUN — gate failed |

## Happy-flow gate (`test/integration/happy-flow.test.ts`)

| Assertion | Result |
|---|---|
| 1. Cross-device session/publication access denied | NOT RUN — gate failed |
| 2. Idempotent create; mismatched contract header logs exactly once | NOT RUN — gate failed |
| 3. Case-insensitive read-only resolve; three registrations plus one rejoin; cookie flags | NOT RUN — gate failed |
| 4. Ordered snapshots (session, participant, question) on connect; device hello/participant/heartbeat | NOT RUN — gate failed |
| 5. No correctness before close; correct/incorrect/retry/both race orders | NOT RUN — gate failed |
| 6. Private results/ranks on close; device replay rows; publish-after-close ordering | NOT RUN — gate failed |
| 7. Device disconnect/reconnect from stored watermark; authoritative/projected rows match | NOT RUN — gate failed |
| 8. Student disconnect/reconnect after close; wholesale snapshot has no stale question/result | NOT RUN — gate failed |
| 9. Double session close; participated/none terminal variants; further register/answer are contracted Problems | NOT RUN — gate failed |
| 10. Restart against the same PostgreSQL database; terminal state survives; no duplicate rows | NOT RUN — gate failed |
| Recursive privacy scan (no correctness pre-close, no cross-participant leak, no projector payload in D) | NOT RUN — gate failed |

## Commands and exit codes

```text
NOT RUN — gate failed
```

## PASS/FAIL per phase

| Phase | Result |
|---|---|
| `@eduscope/shared` test | NOT RUN — gate failed |
| `@eduscope/quiz-service` typecheck | NOT RUN — gate failed |
| `@eduscope/quiz-service` test (full suite, includes ownership + happy-flow) | NOT RUN — gate failed |
| `@eduscope/core-api` quiz/sync-hello regression | NOT RUN — gate failed |
| `@eduscope/api-client` test (mock/contract-honesty regression) | NOT RUN — gate failed |
| `@eduscope/quiz` test (student app regression) | NOT RUN — gate failed |
| Overall `gate:d` | NOT RUN — gate failed |
| Reviewer acknowledgement of the Workstream D master-plan gate flag (shared student envelope + shared DM-10 rank helper) | NOT RUN — gate failed |
| Overall D-11 gate | NOT RUN — gate failed |
