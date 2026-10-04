# Research — 194-email-sending

## R1 Queue: BullMQ on the existing Redis
- Decision: BullMQ 6.3.11 (`bullmq`, MIT) for the `notifications` queue: delayed jobs (quiet hours, grouping window), attempts with a custom backoff (1/5/15/60/240 min), concurrency 10.
- Rationale: Architecture decision A9 proposes "Background work with BullMQ in a separate worker process" (context.md, Open Decisions); this plan confirms it. Redis is already the only broker (constitution IV). Writing delayed jobs, retries and locking on raw ioredis would be well over the 20 lines Principle I allows before a dependency.
- Alternatives: a PostgreSQL polling table (more code, a second scheduler later for ST-200 reminders); BullMQ's PostgreSQL backend (new in v6; the Architecture names Redis for queues).
- Evidence: `node_modules/bullmq/package.json` (version 6.3.11, ioredis optional peer ">=5.0.0"; repo has ioredis 6.0.0 in `package-lock.json`); `dist/esm/interfaces/redis-options.d.ts` (`url` option); `dist/esm/types/backoff-strategy.d.ts` (`(attemptsMade, type, err, job) => number`); `dist/esm/interfaces/worker-options.d.ts:29,136` (`concurrency`, `settings.backoffStrategy`); `dist/esm/classes/errors/unrecoverable-error.d.ts`.

## R2 Rows before jobs
- Decision: `NotificationsService.notify()` writes every NOTIFICATION row in PostgreSQL first, then queues one `send` job per `email` row (or one `flush` job per grouping window). The worker only sends.
- Rationale: constitution VI ("nothing in Redis is the only copy"); context.md Constraints: a direct send bypasses the outbox and Redis "can be emptied". A lost job leaves a `queued` row, visible and replayable.
- Alternatives: a `build` job that writes rows in the worker (a direct send would vanish with Redis).
- Evidence: `.specify/memory/constitution.md:199-206`; context.md "Constraints" line 27.

## R3 Brevo transactional e-mail
- Decision: `fetch` (Node 24 built-in) to `POST {BREVO_API_URL}/smtp/email` with header `api-key`, body `{ sender, to: [{ email, name }], subject, textContent }`, `AbortSignal.timeout(10_000)`; the 201 answer's `messageId` is stored. Start-up check: `GET {BREVO_API_URL}/account` (401 → refused key). No SDK.
- Rationale: two calls; the SDK adds a dependency for them (Principle I).
- Alternatives: `@getbrevo/brevo` SDK.
- Evidence: decision A18 (context.md Decisions); `.nvmrc` = 24.

## R4 Webhook authentication
- Decision: `Authorization: Bearer <BREVO_WEBHOOK_SECRET>`, compared with `crypto.timingSafeEqual`; without a configured secret every call is refused.
- Rationale: Brevo transactional webhooks are configured with an `auth` object of type bearer (or basic) and do not sign the body; context.md Gaps records that Notion is silent, so this is the plan's choice.
- Alternatives: secret in the URL path (ends up in access logs).
- Evidence: context.md Gaps line 56.

## R5 Quiet hours and the clock change
- Decision: `Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', hourCycle: 'h23', … })` reads the local hour; the next 08:00 is found by building the UTC instant for the local date at 08:00 with the zone's offset at that instant (offset read from `Intl` `timeZoneName: 'longOffset'`). No date library.
- Rationale: ~20 lines; the repo has no date library (`package.json`).
- Evidence: `package.json` dependencies list.

## R6 Grouping window in PostgreSQL
- Decision: inside one transaction holding `pg_advisory_xact_lock(hashtext(kind || account_id))`, the window is open when an `email` row of the same kind and account with `group_leader_id IS NULL` was created in the last 5 minutes and is not quiet-held; the new row then gets `group_leader_id` = that leader and a `flush` job with job id `flush-<leaderId>` delayed to the leader's `created_at + 5 min` (BullMQ ignores a second add with the same id).
- Rationale: PostgreSQL holds the state (VI); the lock keeps two concurrent builds from both becoming leaders.
- Evidence: `libs/domain/src/auth/serial-db.testing.ts` (advisory locks already used).

## R7 Live event wire format
- Decision: publish on `live:events` the JSON `{ audience: ['account:<id>'], event: { kind: 'notification.created', id, at } }` through the API's/worker's ioredis connection.
- Rationale: that is ST-253's hub format (`git show origin/253-live-connection:libs/domain/src/events/live.hub.ts`, `LIVE_CHANNEL = 'live:events'`, `publish(event, audience)`); ST-253 is not merged, so the constant is local until it lands (follow-up: reuse `LIVE_CHANNEL`).

## R8 Admin-only endpoint
- Decision: `@Requires('admin.settings')` on the test endpoint; `requireCapability` already answers 404 for any other role and the guard 401 without a session.
- Evidence: `libs/domain/src/auth/policy.ts:45-52`; `libs/domain/src/auth/capabilities.ts` (only admin holds `admin.settings`).

## R9 Configuration
- Decision: `EMAIL_SENDING` (`on`|`off`, default `off`), `EMAIL_ALLOWLIST`, `EMAIL_FROM`, `BREVO_API_KEY`, `BREVO_API_URL`, `BREVO_WEBHOOK_SECRET`, parsed by one `emailConfig(appEnv, source)` function in the notifications module; listed in `.env.example`.
- Evidence: `libs/contracts/src/env.ts` (`readEnv` requires; these are optional with defaults), `.env.example`.
