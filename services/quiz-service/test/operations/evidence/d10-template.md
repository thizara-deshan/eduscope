# D-10 evidence — campus packaging and operations gate

Copy this file to `d10-<YYYYMMDD>.md` and fill every field from the actual
local run of `pnpm --filter @eduscope/quiz-service build` and
`pnpm --filter @eduscope/quiz-service test -- test/operations`, plus the
staging run of `pnpm --filter @eduscope/quiz-service smoke:staging` and the
`deploy/campus/README.md` ordered procedure. An unrun row stays
`NOT RUN — gate failed` — never leave it blank and never mark the task
complete with a blank or invented PASS. This evidence must contain no device
bearer, cookie/participant token, database URL, or raw secret value — paths,
versions, ids, and pass/fail outcomes only.

## Identity

| Field | Value |
|---|---|
| Date | NOT RUN — gate failed |
| Commit SHA | NOT RUN — gate failed |
| Campus hostname | NOT RUN — gate failed |
| Public origin | NOT RUN — gate failed |
| TLS certificate path / expiry | NOT RUN — gate failed |
| PostgreSQL host / version | NOT RUN — gate failed |
| Node version | NOT RUN — gate failed |
| pnpm version | NOT RUN — gate failed |
| Service user uid/gid (`eduscope-quiz`) | NOT RUN — gate failed |
| Backup directory | NOT RUN — gate failed |
| Firewall owner | NOT RUN — gate failed |

## Local template/unit checks (`test/operations`)

| Check | Result |
|---|---|
| `systemd-analyze verify` (or structural-only note if unavailable) | NOT RUN — gate failed |
| `nginx -t` on a rendered config (or structural-only note if unavailable) | NOT RUN — gate failed |
| Renderer resolves all three tokens exactly once; rejects missing/invalid/unresolved input | NOT RUN — gate failed |
| Unit: no `sudo`, no shell, `eduscope-quiz` user/group, migration before start | NOT RUN — gate failed |
| Backup: failure exit code propagates; empty dump rejected; existing output refused | NOT RUN — gate failed |
| Restore: wrong/missing confirmation refused; non-empty database refused without `--allow-nonempty` | NOT RUN — gate failed |
| `pnpm --filter @eduscope/quiz-service build` produces `apps/quiz/.next/BUILD_ID` | NOT RUN — gate failed |

## Staging build and rollout

| Step | Result |
|---|---|
| Dependencies installed with frozen lockfile; shared/quiz-service/quiz builds pass | NOT RUN — gate failed |
| `/etc/eduscope/quiz-service.env` written mode 0600 | NOT RUN — gate failed |
| Nginx config rendered; `nginx -t` passed | NOT RUN — gate failed |
| Migrations run twice (idempotent) | NOT RUN — gate failed |
| Device bearer provisioned via stdin (never argv/evidence) | NOT RUN — gate failed |
| Unit + Nginx installed/enabled | NOT RUN — gate failed |
| `ss -ltnp` confirms Node bound to `127.0.0.1:7300` only | NOT RUN — gate failed |

## Staging smoke (`smoke:staging`)

| Assertion | Result |
|---|---|
| `/j/CODE` reachable over HTTPS | NOT RUN — gate failed |
| Direct `http://host:7300` unreachable externally | NOT RUN — gate failed |
| Wrong bearer rejected with 401 | NOT RUN — gate failed |
| Device create/publish/close authenticate with `x-eduscope-contract:1.0` | NOT RUN — gate failed |
| Student resolve/register/cookie succeed over HTTPS | NOT RUN — gate failed |
| Student WS snapshot/delta delivered over WSS | NOT RUN — gate failed |
| Student answer accepted; private result delivered over WSS after close | NOT RUN — gate failed |
| Service restart mid-open-quiz; both WS clients reconnect with authoritative state | NOT RUN — gate failed |

## Backup/restore verification

| Field | Value |
|---|---|
| Backup produced; size (bytes) | NOT RUN — gate failed |
| Backup SHA-256 | NOT RUN — gate failed |
| Verification database created (name) | NOT RUN — gate failed |
| Restore into verification database succeeded | NOT RUN — gate failed |
| Schema/row counts match source | NOT RUN — gate failed |
| Verification database deleted via DBA procedure | NOT RUN — gate failed |

## Commands and exit codes

```text
NOT RUN — gate failed
```

## PASS/FAIL per phase

| Phase | Result |
|---|---|
| Local template/unit tests (`test/operations`) | NOT RUN — gate failed |
| `pnpm --filter @eduscope/quiz-service build` | NOT RUN — gate failed |
| Staging smoke (`smoke:staging`) | NOT RUN — gate failed |
| Backup/restore verification | NOT RUN — gate failed |
| Overall D-10 gate | NOT RUN — gate failed |
