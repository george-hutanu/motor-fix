# Data model: message preferences

## notification_preference (new)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| account_id | uuid FK → account, cascade | the person |
| garage_id | uuid FK → garage, cascade, nullable | set for a garage person's rows; empty for driver and admin rows |
| type | text | a catalogue type name (the catalogue lives in code, as for `notification.kind`) |
| channel | notification_channel | `email`, `push`, `sms` or `whatsapp` (never `in_app`) |
| enabled | boolean | |
| updated_at | timestamptz(3) | |

Index: (account_id, type) — the send-time read and the save both look rows up by person and type.

No unique constraint: a driver row is unique per (account, type) and a staff row per (account, garage, type, channel), and PostgreSQL treats empty garages as distinct in a unique index. Uniqueness is kept by the save, which holds `pg_advisory_xact_lock(hashtext('preferences:' || account_id))`, deletes the rows it replaces and creates the new ones in one transaction.

## Rules (code, `preferences.ts`)

- Driver type: a type whose catalogue `group` is set. One row; missing → channel `email` if allowed else the type's first channel, enabled unless NEWS.
- Other type: one row per channel; a missing channel row is enabled.
- Muted channels for a message = the type's channels minus the enabled chosen ones; `sendsEmail(type, muted)` (ST-194) still sends always-sent and transactional types.
