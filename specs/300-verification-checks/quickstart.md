# Quickstart: proving ST-300

## Prerequisites

- `docker compose up -d` (PostgreSQL and Redis), `DATABASE_URL` and `REDIS_URL` from `.env.example`; or let the pre-commit hook start the worktree's own services.
- After the schema change: `npx prisma generate --config libs/domain/prisma.config.ts` and `npx prisma migrate deploy --config libs/domain/prisma.config.ts`.
- Heavy commands through `scripts/heavy.sh`.

## The specs (`/speckit-tests` writes them red first)

| Spec | Proves |
| --- | --- |
| `libs/contracts/src/verification-checks.spec.ts` | FR-008: the four lamps; FR-009 / SC-003: the four exact Romanian texts and their English, "Autorizație RAR verificată" alone, severity order (`failed` before `warning`), `rar` before any other kind, then the kinds' order, the capital first letter, the detail as typed, a missing kind as `not_run`; the DTO refuses a 201-character detail and an unknown result |
| `libs/domain/src/garages/verification.service.integration.spec.ts` | FR-001 / SC-001: 8 rows after `submit`, one per kind, `not_run`, `automatic = false`; still 8 after `resend` with a recorded result kept; no audit entry per row; none after a thrown transaction |
| `libs/domain/src/garages/verification-checks.service.integration.spec.ts` | FR-003 / SC-002: `rar = ok` sets result, detail, `recordedBy`, `recordedAt`; one audit entry (`verification_check_recorded`, old `not_run`, new `ok`) and one `verification.check_recorded` outbox row (`fileId`, `kind`, `result`, audience `admin`), none after a thrown transaction; FR-004: `activities = ok` with `[mechanics, brakes]` writes `garage.rar_activities` in the same save, an omitted list leaves it, the audit entry carries both lists; two saves: the second wins, both logged; FR-010: 422 unknown kind, 400 missing detail / 201 characters / unknown code, 409 `verification_file_decided` on `approved`, `rejected`, `more_requested`, accepted again after `reopen`; 404 unknown and malformed id; FR-011: a non-admin actor is 404 |
| `apps/api/src/verification-checks.api.integration.spec.ts` | the route end to end: 200 with `check`, `summary.ro/en` and `rarActivities`; 400 from the pipe on a malformed body; 404 for `driver`, `garage`, `receptionist`, `mechanic`; 409 and 422 as problem details |
| `apps/api/src/admin-routes.integration.spec.ts` | the route is listed under `/api/v1/admin/` (its non-admin sweep covers it) |

## Run

```sh
scripts/heavy.sh npx jest libs/contracts/src/verification-checks.spec.ts libs/domain/src/garages/verification apps/api/src/verification-checks > /tmp/st300.log 2>&1; echo "exit $?"; tail -n 40 /tmp/st300.log
scripts/heavy.sh npx nx run-many -t typecheck lint -p contracts domain api data-access > /tmp/st300-check.log 2>&1; echo "exit $?"; tail -n 20 /tmp/st300-check.log
scripts/heavy.sh npx nx run data-access:generate   # writes apps/api/openapi.json and the client; commit both (scripts/contract-check.sh is CI's check)
```

## By hand (optional)

With the API served (`npx nx serve api`) and an admin's bearer token: `curl -i -X PUT localhost:3000/api/v1/admin/verification-files/<file id>/checks/rar -H 'Content-Type: application/json' -H 'Authorization: Bearer …' -d '{"result":"ok","detail":"Autorizație găsită în registru"}'` answers 200 with the check and `"summary":{"ro":"Autorizație RAR verificată",…}`; the same on `…/checks/foo` answers 422; after the file is approved, 409 "Dosarul e deja decis". `SELECT kind, result FROM verification_check WHERE file_id = '<file id>'` shows 8 rows.

## Left to later stories

The queue and file screens (lamps and summary from `lamp()` and `checkSummary()`), the three check forms that call `record()`, the documents part of the summary (needs the legal-document table: `deferred.md`), the lawyer's RAR activity list (T12), and the first automatic look-up (which brings back `evidence`).
