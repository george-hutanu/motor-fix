# Data model: Audit history writer

## activity_log (Prisma `ActivityLog`, file `libs/domain/prisma/schema/audit.prisma`)

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id | uuid | no | PK, `uuid()` |
| at | timestamptz(6) | no | default `clock_timestamp()`; microseconds keep one transaction's entries in write order |
| action | `audit_action` enum: create, update, delete, open | no | |
| subject_type | text | no | lower snake case, e.g. `garage_price`, `job` |
| subject_id | uuid | no | |
| field | text | yes | null for a whole-subject create/delete and for `open` |
| old_value | jsonb | yes | |
| new_value | jsonb | yes | |
| actor_id | uuid | yes | no FK: the entry outlives the account; null for system |
| actor_role | `audit_actor_role` enum: driver, owner, receptionist, mechanic, admin, system | no | account role `garage` → `owner` |
| actor_name | text | no | first name; "MotorFix" for system; may be empty |
| via_assistant | boolean | no | default false; true when `assistant_grant_id` is set |
| assistant_grant_id | uuid | yes | no FK yet (assistant grants arrive with EP-16) |
| garage_id, car_id, job_id | uuid | yes | no FK (garage exists, car/job tables do not yet) |
| is_key_change | boolean | no | default false; set by the writer only |
| internal | boolean | no | default false |
| kind | text | yes | optional |
| text | text | yes | optional reason or note |

Indexes: `(garage_id, at)`, `(car_id, at)`, `(job_id, at)`, `(actor_id, at)`.

Triggers: `activity_log_append_only` (BEFORE UPDATE OR DELETE, row) and `activity_log_no_truncate` (BEFORE TRUNCATE, statement), both `EXECUTE FUNCTION activity_log_refuse()`, which raises.

No state transitions: an entry is written once.

## Key changes (writer table)

`quote.from_bani`, `quote.to_bani`, `job.final_price_bani`, `job.status`, `job.eta_at`, `booking.starts_at`, `booking.mechanic_id`.
