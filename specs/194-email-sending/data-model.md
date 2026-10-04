# Data model — 194-email-sending

## NOTIFICATION (new table `notification`, module `notifications`)

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| account_id | uuid → account.id, cascade | the recipient |
| kind | text | a catalogue type (TEST_MESSAGE, ACCOUNT_EMAIL, QUOTE_RECEIVED, …); text, not an enum: the catalogue lives in code |
| subject_id | uuid, null | what it is about; null for TEST_MESSAGE |
| channel | enum `notification_channel` (in_app, email, push, sms, whatsapp) | |
| status | enum `notification_status` (queued, held, sent, failed) | in_app rows are created `sent` |
| event_id | text | idempotency; the outbox event id, or a fresh id for direct sends and the test message |
| params | jsonb, default {} | values the message needs (ACCOUNT_EMAIL: purpose, link) |
| send_after | timestamptz, null | a `held` send: when it goes (08:00 after quiet hours, or its grouping window's end) |
| group_leader_id | uuid → notification.id, null | a row `held` in another row's grouping window; it goes with that window's `flush` |
| sent_at | timestamptz, null | |
| read_at | timestamptz, null | set by the bell (ST-199) |
| fallback_of | uuid → notification.id, null | set by a fallback channel (ST-196) |
| failure | text, null | `bounced`, `not_allowed`, `sending_off`, `no_address`, `account_deleted`, `provider_<status>`, `provider_unreachable` |
| provider_message_id | text, null, indexed | Brevo's `messageId`, read by the bounce webhook |
| created_at | timestamptz default now() | |

Unique: (kind, account_id, channel, event_id). Index: (account_id, created_at) for the bell; (kind, account_id, channel, created_at) for the grouping window.

State: `queued` → `sent` | `failed`; `held` → `queued` at send_after (released by the delayed job) → `sent` | `failed`.

## ACCOUNT (exists) — gains

| Column | Type | Notes |
| --- | --- | --- |
| email_bounced_at | timestamptz, null | set by a hard bounce, with an audit entry by `system`; Setări reads it later. Notification rows themselves are delivery records and write no audit entry |

## Not tables

- `NOTIFICATION_TYPES` (code): see FR-001.
- BullMQ `notifications` queue in Redis: jobs `send` and `flush` (a quiet-hours release reuses `send`). The rows are written before the job, so a lost job leaves a `queued` or `held` row behind.
