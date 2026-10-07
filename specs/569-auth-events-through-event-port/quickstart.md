# Quickstart: Auth events through the event port

How to prove the feature against real PostgreSQL and Redis. Entities in [data-model.md](./data-model.md); design in [plan.md](./plan.md).

## Prerequisites

- Docker running; `DATABASE_URL` and `REDIS_URL` from `.env.example` (`docker compose up -d`, or the pre-commit hook's `scripts/test-services.ts` services).
- Heavy commands through `scripts/heavy.sh`.

## Run

```sh
# The catalogue (unit, fast)
npx jest libs/contracts/src/events.spec.ts > /tmp/569-events.log 2>&1; echo "exit $?"; tail -n 20 /tmp/569-events.log

# The two flows (integration, real PostgreSQL and Redis)
scripts/heavy.sh npx jest libs/domain/src/auth/password-reset.api.integration.spec.ts libs/domain/src/auth/sign-out-everywhere.api.integration.spec.ts > /tmp/569-auth.log 2>&1; echo "exit $?"; tail -n 40 /tmp/569-auth.log
grep -nE '✕|●|FAIL|Error' /tmp/569-auth.log | head -n 40   # only when it failed
```

## Expected outcomes

| Scenario (spec) | Check |
| --- | --- |
| US1 S1: completed reset | 200 with the `Issued` body; exactly one recorded event `{ audience: { accountId, type: 'account' }, kind: 'account.password_reset', payload: { accountId }, subjectId: accountId }` |
| US1 S2: the same link saved twice at once | one 200 and one 410 `token_expired`; one event |
| US1 S3: refused resets (used, expired, unknown link; weak password; maintenance for a non-admin) | the existing 4xx/503 answers; no event, no audit entry, old password still signs in |
| US1 S4: `EVENT_PORT` throws | 500; `accountToken.usedAt` still null; old password still signs in; refresh tokens still present; audit count unchanged; no `session.revoked` published |
| US2 S1: both flows | one `session.revoked` message on `live:events` for `[account:<id>]` after each |
| US2 S2: publisher fails | `warn('session.revoked not sent: …')` logged; answer unchanged (200 / 204) |
| SC-003 | every pre-existing assertion of both specs still passes |

Then the full affected set before the PR goes ready: `scripts/heavy.sh npx nx affected -t typecheck lint test` into a log, read the exit code and the tail.
