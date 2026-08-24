# D-09 evidence — abuse controls and 200-client load gate

Copy this file to `d09-<YYYYMMDD>.md` and fill every field from the actual
run of `pnpm --filter @eduscope/quiz-service test -- test/abuse/policies.test.ts`
and `pnpm --filter @eduscope/quiz-service load:200 -- --evidence <path>`. An
unrun row stays `NOT RUN — gate failed` — never leave it blank and never mark
the task complete with a blank or invented PASS. This evidence, and the JSON
it references, must contain no device bearer, cookie/participant token,
student name/id, question prompt, option text, or answer choice — ids and
counts only. The master supplies no numeric quiz latency SLA; timings are
recorded, not gated on.

## Identity

| Field | Value |
|---|---|
| Date | NOT RUN — gate failed |
| Commit SHA | NOT RUN — gate failed |
| Environment (`local` Testcontainers or staging base URL) | NOT RUN — gate failed |
| PostgreSQL version | NOT RUN — gate failed |
| Node version | NOT RUN — gate failed |

## Abuse policy assertions (`test/abuse/policies.test.ts`)

| Policy | Result |
|---|---|
| Resolve: 10/min/IP succeed, 11th is `quiz.unavailable` | NOT RUN — gate failed |
| Registration: 5/min/IP reach business logic, 6th is `quiz.unavailable` | NOT RUN — gate failed |
| Participant cap: 1000th accepted, 1001st rejected with no row created | NOT RUN — gate failed |
| Body ≤32 KiB reaches zod; body >32 KiB maps to `quiz.unavailable`, not a raw Fastify error | NOT RUN — gate failed |
| `Origin === PUBLIC_ORIGIN` gets credentialed CORS headers | NOT RUN — gate failed |
| Different/`null` Origin gets no allow-origin header; state-changing request refused | NOT RUN — gate failed |
| No bearer/cookie/body/pre-close answer found in captured logs | NOT RUN — gate failed |

## 200-client workload (`load:200`)

| Field | Value |
|---|---|
| Clients | NOT RUN — gate failed |
| Answers accepted | NOT RUN — gate failed |
| Duplicate answer/projection rows | NOT RUN — gate failed |
| Privacy leaks (own payload containing another test identity) | NOT RUN — gate failed |
| Device answer frame sizes (all ≤200) | NOT RUN — gate failed |
| Reconnected sockets (of 50 closed) with a stale prior question | NOT RUN — gate failed |
| Terminal `quiz.session` summaries received (of 200), `answeredCount:1` | NOT RUN — gate failed |

## Measured timings (ms, p50/p95/max)

| Phase | p50 | p95 | max |
|---|---|---|---|
| Resolve | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |
| Registration | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |
| WS connect-to-snapshot | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |
| Answer submit (HTTP) | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |
| Publish fan-out (device publish → last client sees open question) | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |
| Close-to-result (publication close → last client's private result) | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |
| Reconnect snapshot | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |

## Commands and exit codes

```text
NOT RUN — gate failed
```

## PASS/FAIL per phase

| Phase | Result |
|---|---|
| Abuse policy suite | NOT RUN — gate failed |
| 200-client load workload | NOT RUN — gate failed |
| Contract/mock regression (`test:contract`, `@eduscope/api-client`, `@eduscope/quiz`) | NOT RUN — gate failed |
| Overall D-09 gate | NOT RUN — gate failed |
