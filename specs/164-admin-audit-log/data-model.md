# Data Model: ST-164 admin actions in the audit history

No table, column, enum or migration changes. The story writes two new kinds of row into the existing `activity_log` table and reads it back in a test.

## Written: `activity_log` (existing)

`libs/domain/prisma/schema/audit.prisma:25-52`; written only through `AuditService.record` (`libs/domain/src/audit/audit.service.ts:36-59`), append-only for the application user (390-FR-011).

| Column | `POST admin/live/test` (FR-002) | `POST admin/notifications/test` (FR-003) |
| --- | --- | --- |
| `action` | `create` | `create` |
| `kind` | `live.test` | `notification.test` |
| `subject_type` | `account` | `account` |
| `subject_id` | the target account (`body.accountId`) | the calling admin |
| `old_value` | NULL (`Prisma.DbNull`) | NULL |
| `new_value` | `{ "accountId": "<uuid>" }` | `{ "accountIds": ["<uuid>", …] }` |
| `actor_id` | the admin's account | the admin's account |
| `actor_role` | `admin` | `admin` |
| `actor_name` | the admin's first name, looked up by the writer in the same transaction | same |
| `via_assistant` | `false` (no grant) | `false` |
| `garage_id`, `car_id`, `job_id`, `field`, `text` | NULL | NULL |
| `is_key_change`, `internal` | `false` | `false` |
| `at` | `clock_timestamp()` at the insert | same |

Transaction shape:

- live test: entry and `outbox_event` row in the controller's one transaction; a thrown 404 (unknown target) or 400 (bad body, refused before the handler) writes nothing.
- test message: entry in its own transaction, committed before the first `notification` row; a 400 `unknown_recipient` is thrown before it; a failed send afterwards leaves it.

## Read: `activity_log` by `actor_id` (the guard, FR-004)

`SELECT count(*) FROM activity_log WHERE actor_id = $1`, before and after each route call (index `activity_log_actor_id_at_idx`, `audit.prisma:50`). Changing route: the difference is at least 1. `GET`: 0.

## Touched by the guard's setup

`news_send` (`libs/domain/prisma/schema/notifications.prisma:100-107`, `month` primary key): cleared in `beforeAll` so `POST admin/news` answers 202 on every run of the suite, not 409 after the first.

## Unchanged entities

Verification file and garage entries (ST-207), the audit read endpoint (ST-391), the `AuditEntry` port shape (`audit.port.ts:4-23`).
