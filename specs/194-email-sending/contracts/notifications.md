# Contracts — 194-email-sending

## POST /api/v1/admin/notifications/test (bearer, admin)

Body `TestMessageDto`: `{ "accountIds": ["<uuid>", …] }` — 1 to 20 distinct UUIDs.

- 202 `{ "queued": <n> }`
- 400 `validation_failed` (shape) or `unknown_recipient` (an id that is not an existing, non-deleted account)
- 401 `sign_in_required` (no or bad token)
- 404 `not_found` (signed in, not admin)

## POST /api/v1/webhooks/brevo (Brevo transactional webhook)

Header `Authorization: Bearer <BREVO_WEBHOOK_SECRET>`. Body: Brevo's event JSON; only `event` and `message-id` are read; `email` is used to find the account.

- 204 always for an authenticated request (handled, ignored or unknown)
- 401 `sign_in_required` for a missing or wrong secret

## In-process entry points (`NotificationsService`)

- `notify({ type, recipients: accountId[], subjectId?, eventId, params? })` → queues one `build` job; throws on an unknown type.
- `sendAccountEmail({ accountId, purpose: 'email_check' | 'password_reset', link })` → queues one `build` job for ACCOUNT_EMAIL with a fresh event id.

## Redis publish

Channel `live:events`, message `{ "audience": ["account:<accountId>"], "event": { "kind": "notification.created", "id": "<notification id>", "at": "<ISO>" } }` — the wire format of the live hub (ST-253, PR #57).

## Environment

| Variable | Where | Meaning |
| --- | --- | --- |
| EMAIL_SENDING | api, worker | `on` or `off` (default `off`) |
| EMAIL_ALLOWLIST | worker | comma list of addresses and `@domain` entries; outside production only these get e-mail |
| EMAIL_FROM | worker | sender address, e.g. `MotorFix <noreply@…>` |
| BREVO_API_KEY | worker | required when EMAIL_SENDING=on |
| BREVO_API_URL | worker | default `https://api.brevo.com/v3`; tests point it at the recorded mock |
| BREVO_WEBHOOK_SECRET | api | required to accept the webhook; without it the webhook answers 401 |
