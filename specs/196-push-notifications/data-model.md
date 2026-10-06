# Data model

`push_subscription`: id uuid pk, account_id uuid fk account (cascade), endpoint text unique, p256dh text, auth text, label text (<= 100), created_at, updated_at, last_success_at null. Index on account_id.
`notification_channel` already has `push`. No outbox event, no audit (a device is delivery data).
