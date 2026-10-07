# Quickstart: ST-164 admin actions in the audit history

How to prove the feature works. Shapes in [data-model.md](./data-model.md) and [contracts/admin-audit-entries.md](./contracts/admin-audit-entries.md); decisions in [research.md](./research.md).

## Prerequisites

- `docker compose up -d` (PostgreSQL + PostGIS, Redis), `DATABASE_URL` and `REDIS_URL` from `.env.example`; the pre-commit hook starts the worktree's own services by itself.
- No OpenAPI or client regeneration: the routes do not change.

## Specs

| Scenario | Spec | Expect |
| --- | --- | --- |
| live test leaves one entry with the admin as actor, the target as subject, `kind live.test`, `newValue { accountId }`; 404 and 400 leave none | `libs/domain/src/events/live.api.integration.spec.ts` | one `activity_log` row per 202 |
| test message leaves one entry with the admin as actor and subject, `kind notification.test`, `newValue { accountIds }`; it exists before the first `notification` row; a failed send keeps it; a failed entry queues nothing; 400 leaves none | `libs/domain/src/notifications/notifications.service.integration.spec.ts`, `notifications.api.integration.spec.ts` | |
| the guard: every `admin/*` route from the OpenAPI document, one case each; changing routes raise the admin's count, `GET` leaves it; no route named today | `apps/api/src/admin-audit.integration.spec.ts` (new) | 4 cases green: overview, live test, news, notifications test |
| non-admins still get 404 on every `admin/*` route | `apps/api/src/admin-routes.integration.spec.ts` (existing) | unchanged |
| a service that writes without the writer is named | `libs/domain/src/audit/audit-coverage.spec.ts` (existing) | `sendTestMessage` now audits; the excuse list is unchanged |
| rollback leaves no entry; the entries reach `admin_actions` | `verification.service.integration.spec.ts`, `audit-history.api.integration.spec.ts` (existing) | unchanged |

## Run

```sh
scripts/heavy.sh npx jest libs/domain/src/audit > /tmp/164-unit.log 2>&1; echo "exit $?"; tail -n 40 /tmp/164-unit.log
scripts/heavy.sh npx jest libs/domain/src/events/live.api.integration.spec.ts libs/domain/src/notifications/notifications.service.integration.spec.ts libs/domain/src/notifications/notifications.api.integration.spec.ts apps/api/src/admin-audit.integration.spec.ts apps/api/src/admin-routes.integration.spec.ts > /tmp/164-int.log 2>&1; echo "exit $?"; tail -n 40 /tmp/164-int.log
npm run lint && npm run typecheck
```

A failed run: `grep -nE '✕|●|FAIL|Error' /tmp/164-*.log | head -n 40`.

## By hand

1. `scripts/heavy.sh npx nx serve api`; sign in as the seeded admin (`admin@example.test`) and take its bearer token.
2. `curl -X POST -H "Authorization: Bearer <admin>" -H 'Content-Type: application/json' -d '{"accountId":"<admin id>"}' localhost:3000/api/v1/admin/live/test` → 202.
3. `curl -H "Authorization: Bearer <admin>" 'localhost:3000/api/v1/audit-history?area=admin_actions'` → the newest entry: `kind live.test`, `actorRole admin`, the admin's first name, `newValue { accountId }`.
4. Same with `POST /api/v1/admin/notifications/test` and `{"accountIds":["<admin id>"]}` → an entry `kind notification.test`.
5. Add a `@Post()` under an `admin/*` controller without `audit.record` and run the guard spec: one failing case named after the new route.
