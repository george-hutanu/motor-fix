---
capability: live-video
updated: 2026-10-29
features:
  - 1250-live-video-provider
  - 333-media-storage
  - 1251-live-recording
  - 1252-live-viewers
---

# Capability: Live video

Live video from the workshop to the job's driver: the provider behind its port, the live session on a job, the publish and view credentials, the refusals and the stops. Filled by `/speckit-archive` from each feature's Spec Delta; nothing is built yet.

## Requirements

### 1251-FR-001 — The port `LiveVideoProvider`'s one recording delete, `deleteRecording(ref)` (333-FR-018), MUST delete every recording the provider holds for a live recording's reference, which is the session's live input id (`provider_input_id`, the reference a live MEDIA_ITEM carries in `provider_ref`, FR-003): the `cloudflare` adapter lists the live input's videos (`GET /live_inputs/{ref}/videos`) and deletes each (`DELETE /{videoUid}`), a 404 on the list or on a video counting as deleted and an empty list as success, so a second call is a no-op; any other failure throws so the caller keeps its own row; each call times out after 5 seconds and carries the child span and the duration histogram (operation `delete_recording`) as the port's other calls do. `fake` records the call and `none` is a no-op, as ST-333 built them. No second operation is added.

_From 1251-live-recording._

### 1250-FR-002 — The API MUST offer `POST /api/v1/jobs/:id/live` (start), for the job's mechanic (the mechanic row of the job belonging to the caller's account) and the owner of the job's garage. It MUST, in one transaction after the provider's input is created: insert the LIVE_SESSION in `live` (FR-007) with `started_by` the actor, `started_at` now and `provider_input_id`; record one audit entry (action `create`, subject type `live_session`, subject id the session, garage id and job id, the actor and their role); and write one event `live.started` `{ liveSessionId, jobId }` to the job's audience (the driver's account, the garage, the job's mechanic; the `job` audience the stage events use). It answers 201 with `{ liveSessionId, startedAt, publish: { url, expiresAt, constraints: { audio: false, video: { maxHeight: 720, maxBitrateKbps: 1500 } } } }`; `expiresAt` is 2 minutes after the start, the window in which the sender must begin publishing. No microphone is asked for and no audio is published by a client honouring the constraints; the provider cannot refuse an audio track at ingest (a known limit, Assumptions).

_From 1250-live-video-provider._

### 1252-FR-002 — A view credential issued by `POST /api/v1/live-sessions/:id/view-token` (1250-FR-003) MUST, in one transaction that first takes `FOR UPDATE` on the session's row and checks the caller's rights and `stopped_at` on that row, using one `now` for every time below and for the credential's `expiresAt`: insert the caller's LIVE_VIEWER record with `first_viewed_at` and `last_viewed_at` now, or set `last_viewed_at` now on their existing one; set `viewed_by_driver_at` to now when the caller is the job's driver (role `driver`) and it is null; count the session's viewer records with `last_viewed_at + LIVE_VIEW_TOKEN_TTL_MS` (5 minutes) after now, the caller's included; set `peak_viewers` to the greater of its value and that count; and sign the link inside the same transaction. A refused view (404, 409 `live_ended`, 401, 503 `live_unavailable`) MUST write nothing: a signing failure rolls the writes back. The view stays unaudited and writes no event; its rights, its answer and its refusals are 1250-FR-003 and 1250-FR-004 unchanged. The lock is the session's row alone (no garage or job lock), so a view never waits on a stop or a start for more than that row.

_From 1252-live-viewers._

### 1250-FR-004 — Start and view MUST answer 404 to anyone without the right: another garage's staff, a receptionist of the garage, a mechanic of the garage who is not the job's mechanic, another driver, an admin, and everyone when the job's garage has `live_media` off (a switched-off feature is hidden everywhere; the check is `featureOn(garageId, 'live_media')`, 398-FR-007). With `live_media` off both operations answer 404 before any other check. A start on a job that already has a `live` session MUST answer 409 `live_already_on` with the message "<first name> <last name> transmite deja" / "<first name> <last name> is already live" built from the starter's account name (first name alone when there is no last name); a start on a `done` or `cancelled` job MUST answer 409 `job_closed`. A call without a session is 401 `sign_in_required`. Every refusal is checked before the provider is called and writes nothing; the only input a refused start creates is the race loser's, closed before the answer (FR-005).

_From 1250-live-video-provider._

### 1250-FR-005 — When the provider is `none`, or its create-input call fails or exceeds 5 seconds, the start MUST answer 503 `live_unavailable` with the message "Transmisia live nu e disponibilă acum. Poți trimite fotografii și clipuri." / "Live is not available now. You can send photos and clips.", and MUST leave no LIVE_SESSION row, audit entry or event behind; when the input was created but the session's transaction fails, the API MUST try once to close that input before answering, and log the failure to close with the input id. The provider's error, URL or any secret MUST never appear in the answer.

_From 1250-live-video-provider._

### 1251-FR-007 — Every end of a `live` session MUST go through one stop routine, inside the caller's transaction: set `stopped_at` now and `stop_reason`; record one audit entry (action `update`, subject type `live_session`, field `status`, old `live`, new `stopped`, garage id and job id, the actor and role: the sender for `sender`, role `system` and name "MotorFix" for `job_closed`, `feature_off` and `idle`); write the event `live.stopped` `{ liveSessionId, jobId, reason, keep }` to the job's audience (the driver's account, the garage, the job's mechanic); then, when `keep_recording` is true, register the recording per FR-003 (its `media.added` `{ mediaId, jobId, kind: 'live' }` to the same audience, after `live.stopped`, and its system audit entry) and set `recording_media_id`; all in the transaction. The system stops of ST-1250 (every `live` session of a job in the transaction that moves it to `done` or `cancelled`, `moveJob`; every `live` session of a garage in the transaction that switches its `live_media` off, `GarageFeaturesService.set`) MUST use this routine with `job_closed` and `feature_off`; with no `live` session they write nothing extra. A system stop makes no provider call: the worker deletes a discarded recording from the event (FR-013).

_From 1251-live-recording._

### 1252-FR-001 — LIVE_SESSION (`libs/domain/prisma/schema/live.prisma`) MUST gain `viewed_by_driver_at` (timestamp, null until the job's driver first takes a view credential) and `peak_viewers` (integer, not null, default 0, the highest number of distinct accounts holding an unexpired view credential at one moment), and the schema MUST gain LIVE_VIEWER (`live_viewer`): `live_session_id`, `account_id`, `first_viewed_at`, `last_viewed_at`, primary key (`live_session_id`, `account_id`), deleted with its session or its account (cascade on both); with its migration. PostgreSQL is the truth (Principle VI): no copy of a viewer or a count lives anywhere else.

_From 1252-live-viewers._

### 1250-FR-008 — The two operations' request and answer DTOs and the refusal codes MUST come from the contracts library, validated at the edge; `apps/api/openapi.json` MUST carry both operations and `libs/data-access` MUST be regenerated (`npx nx run data-access:generate`), never edited by hand. Neither route is public: both run under the app-wide actor guard.

_From 1250-live-video-provider._

### 1250-FR-009 — Observability MUST ship in the same PR: the counters `motorfix_live_sessions_total{outcome}` (`started`, `refused`, `provider_failed`, `unavailable`) and `motorfix_live_view_tokens_total{outcome}` (`issued`, `refused`, `ended`), the histogram `motorfix_live_provider_duration_seconds{provider,operation}`; one child span per provider call carrying the operation, host and status and never the token, URL query or body (876-FR-004); one warning log line per refused start and per provider failure carrying ids only (job id, session id, garage id, the refusal code); a panel on the api dashboard (`infra/observability/grafana`, uid `motorfix-api`) for the three instruments; no new alert rule: the provider failures fold into the existing `api-error-rate` rule so the total stays at 50 rules or fewer; and `infra/observability/inventory.json` entries for the outside service `cloudflare-stream` (its host, dashboard `motorfix-api`, alerts `api-error-rate`, `api-latency`) and for the two endpoints, with `node scripts/observability-inventory.ts` passing and the endpoint count updated.

_From 1250-live-video-provider._

### 1250-FR-010 — The load check the build owes MUST be an integration spec against the `fake` adapter on real PostgreSQL and Valkey: 20 starts at once on 20 different jobs of garages with `live_media` on, each by its job's mechanic, then 60 view credentials at once (three per session, the driver, the owner and the mechanic), all answered 201 or 200 and none with a 5xx, every session `live` exactly once. The same check against the real provider, with the EU data-processing agreement signed, is the owner's step (Assumptions) and is recorded in the finish comment, not run by the build.

_From 1250-live-video-provider._

### 1250-FR-011 — Tests MUST exist before the code (Principle II), in Jest on real PostgreSQL and Valkey for the API: the start by the job's mechanic and by the owner (row, credential constraints, audit entry and event in one transaction); 404 for a receptionist, another mechanic, another driver, another garage and `live_media` off, for both operations; 409 `live_already_on` with the starter's name and 409 `job_closed`; two simultaneous starts yielding one session and one 409; 503 `live_unavailable` for the `none` provider and for a failing create-input (test-local stubs through `overrideProvider`), each with no row left behind, and the Cloudflare adapter cutting a hanging call at 5 s; the view credential for the three roles, its token's signature verified with the public key, `sub`, `kid` and `exp`, and 409 `live_ended` after a stop; the system stop on `done`, on `cancelled` and on `live_media` off, each with `stopped_at`, `stop_reason`, the event and the system audit entry, and no extra write without a session; the load check of FR-010; the Cloudflare adapter's calls (create input with recording and signed URLs, close input, the manifest URL) against a stubbed HTTP server; the metrics and the inventory check. Every test file carries its `// @traces 1250-FR-<n>` line.

_From 1250-live-video-provider._

### 1250-FR-012 — No secret value, token or signing key MUST be committed, printed or logged; `.env.example` MUST list the five variables by name with no value and one comment naming where the owner sets them (Railway, the production and staging services). The owner's steps — creating the Cloudflare Stream account in the EU with a signed data-processing agreement, creating the signing key, setting the five secrets, and running the load check against the real provider — MUST be written in the PR's Notes and in the story's finish comment, named as the owner's steps the build does not wait for.

_From 1250-live-video-provider._

### 1251-FR-004 — The API MUST offer `PATCH /api/v1/live-sessions/:id/recording` with body `{ keep: boolean }` (the keep change), for the owner of the job's garage and the job's mechanic (ST-1250's right to start). Under the session's row lock (as FR-005, so a keep change racing a stop is ordered: the stop reads the value the change left, or the change finds the session stopped and answers 409), on a `live` session it MUST set `keep_recording` and, when the value changed, record one audit entry (action `update`, subject type `live_session`, subject id the session, field `keep_recording`, old and new value, garage id, job id, the actor and their role) in the same transaction; an unchanged value writes nothing. It answers 200 `{ keep }`. No event is written: the value matters only at the stop.

_From 1251-live-recording._

### 1252-FR-004 — The stop's answer (1251-FR-005) MUST gain `peakViewers` (integer) and `viewedByDriverAt` (ISO time or null), read from the row inside the stop's transaction; the DTO comes from the contracts library, `apps/api/openapi.json` carries the two fields and `libs/data-access` is regenerated (`npx nx run data-access:generate`), never edited by hand. The `live.stopped` payload is unchanged. A stop that is refused answers as 1251-FR-005 says today and carries neither field: the figures ride a successful stop only.

_From 1252-live-viewers._

### 1251-FR-006 — Stop and the keep change MUST answer 404 to anyone without the right: the job's driver, a receptionist of the garage, a mechanic of the garage who is not the job's mechanic, another garage's staff, another driver, an admin, and everyone when the job's garage has `live_media` off (checked first, `featureOn(garageId, 'live_media')`, 398-FR-007). A session not in `live` MUST answer 409 `live_ended` with "Transmisia live s-a încheiat" / "The live stream has ended" (ST-1250's words). A call without a session is 401 `sign_in_required`. Every refusal writes nothing and calls the provider for nothing; two stops racing on one session yield one 200 and one 409 under the row lock.

_From 1251-live-recording._

### 1251-FR-008 — The two operations' request and answer DTOs and the refusal codes MUST come from the contracts library, validated at the edge (`keep` a boolean, nothing else accepted); the `live.stopped` payload type gains `keep` and `media.added` gains its `{ mediaId, jobId, kind }` payload there; `apps/api/openapi.json` MUST carry both operations and `libs/data-access` MUST be regenerated (`npx nx run data-access:generate`), never edited by hand. Neither route is public: both run under the app-wide actor guard.

_From 1251-live-recording._

### 1251-FR-009 — Observability MUST ship in the same PR: the counter `motorfix_live_recordings_total{outcome}` (`discarded`, `discard_failed`; a kept recording is counted by ST-333's `motorfix_media_items_total`), the outcome `stopped` added to `motorfix_live_sessions_total{outcome}`, the operation `delete_recording` (already ST-333's) on the existing histogram `motorfix_live_provider_duration_seconds{provider,operation}` and its child span (operation, host and status; never the URL query, body or a secret, 876-FR-004); one warning log line per refused stop or keep change and per failed delete carrying ids only (session id, job id, garage id, input id, the refusal code); the live panel of the api dashboard (`infra/observability/grafana/dashboards`, uid `motorfix-api`) extended with the recordings counter; no new alert rule: a failed delete raises the API's warning count and a provider failure its 5xx rate, which `api-error-rate` already alerts on, so the total stays at 50 rules; and `infra/observability/inventory.json` updated: the endpoint entry `live-sessions` names the two new routes, the stop's writes and the discard's provider call, with `node scripts/observability-inventory.ts` passing.

_From 1251-live-recording._

### 1251-FR-010 — Tests MUST exist before the code (Principle II), in Jest on real PostgreSQL and Valkey for the API: the stop with keep on by the mechanic and by the owner (session columns, media row with `seconds`, `sender_id` null, `provider_ref`, `sent_at`, `purge_after` 90 days on, the two audit entries, `live.stopped` then `media.added` in one transaction, the answer); the stop with `{ keep: false }` (no media row, no `media.added`, `keep: false` in the event, one `deleteRecording` call with the input id after the commit, through a provider stub by `overrideProvider`); a failing and a hanging delete (200 all the same, the warning and the counter); the keep change by both roles, its audit entry, and no write on an unchanged value; the stop without `keep` honouring the row's value; 404 for the driver, a receptionist, another mechanic, another garage, another driver, an admin and `live_media` off, for both operations; 409 `live_ended` on a stopped session for both; two simultaneous stops yielding one 200 and one 409; the system stops on `done`, `cancelled` and `live_media` off registering the recording when `keep_recording` is on and not when off, with `keep` in the event and no provider call; `seconds` rounded down and 0 under one second (fake clock); the Cloudflare adapter's `deleteRecording` against a stubbed HTTP server (list the input's videos, delete each, success on an empty list and on a 404, failure on another non-2xx, the 5 s cut); the metrics and the inventory check. Every test file carries its `// @traces 1251-FR-<n>` line.

_From 1251-live-recording._

### 1251-FR-011 — The worker MUST stop a `live` session that has had no publisher for 10 minutes: once a minute it reads each `live` session's publisher state from the provider through a port operation `inputStatus(inputId)` (connected or not, and since when; the `fake` adapter answers from a test-settable table), and a session disconnected, or never connected, for 10 minutes straight is ended through the stop routine of FR-007 with `stop_reason` `idle` (added to the enum with its migration), actor `system`, keeping or discarding by its `keep_recording`; a reconnection within the 10 minutes resets the count. The check runs in the worker (`apps/worker`), is counted (`motorfix_live_idle_stops_total`, the check's duration on a histogram), logged with ids only, listed in `inventory.json` as the worker's job with its panel and an alert folded into an existing worker rule, and tested on real PostgreSQL with a fake clock: the stop at 10 minutes, the reset on reconnection, the never-published session, and keep on and off.

### 1251-FR-013 — The worker MUST delete at the provider the recording of every session that stopped with `keep: false`: a consumer of `live.stopped` (ST-1390's, extended, or its own when ST-1390 is not merged) calls `deleteRecording` for the session's `provider_input_id` with retries (three tries, a minute apart), counted in `motorfix_live_recordings_total{outcome}` (`discarded`, `discard_failed`) and logged with ids only; the same consumer counts a kept recording (`keep: true`) as a visible live media item once its stop committed (FR-003); it is idempotent, since the port's delete succeeds on nothing to delete, so a sender's discard the API already completed costs one empty call. Tested with a stubbed provider: the delete after a system stop, the retry on failure, the no-op after a completed discard.

### 1252-FR-003 — Whether anyone watches MUST have no effect on a session: no viewer count or its absence ends, pauses or changes a stream, the idle stop (1251-FR-011) keeps reading the publisher's state alone, and a session with a connected publisher and no viewer past the idle window stays `live`. A stop of a session nobody watched writes `peak_viewers` 0 and `viewed_by_driver_at` null and otherwise behaves as 1251-FR-007 and 1251-FR-005 say; a system stop writes nothing about viewers.

_From 1252-live-viewers._

### 1252-FR-005 — Observability: this story adds no endpoint, service, queue, outside call or metric: a view is counted by `motorfix_live_view_tokens_total{outcome="issued"}` already (1250-FR-009), and the viewer write rides the same route. The `live-sessions` endpoint entry of `infra/observability/inventory.json` MUST say that a view writes the viewer record, the driver's first view and the peak in one transaction, and `node scripts/observability-inventory.ts` MUST pass; no alert rule is added (the total stays at 50), and no log line gains a name or a token.

_From 1252-live-viewers._

### 1252-FR-006 — Tests MUST exist before the code (Principle II), in Jest on real PostgreSQL and Valkey for the API: the driver's first credential setting `viewed_by_driver_at` and his record; his second credential leaving `viewed_by_driver_at` and the count unchanged; the owner's and the mechanic's credentials leaving `viewed_by_driver_at` null; three distinct viewers within five minutes reaching `peak_viewers` 3 one at a time; a viewer whose last credential is older than five minutes (fake clock) not counted and the peak not falling; three simultaneous first credentials yielding `peak_viewers` 3; every refusal of 1250-FR-004, 409 `live_ended` and 503 `live_unavailable` (a provider whose signing throws) writing no viewer record and no peak; a viewer held at `last_viewed_at` + 5 min + 1 ms not counted; an account deletion removing its viewer rows; a connected publisher with no viewer past ten minutes left `live` by the idle check (the stand-in provider's table, fake clock); the stop answer carrying the two fields, 0 and null for a session nobody watched; the load check of 1250-FR-010 extended to read `peak_viewers` 3 on each of its 20 sessions; the migration applied; the inventory check. Every test file carries its `// @traces 1252-FR-<n>` line.

_From 1252-live-viewers._

## Retired

- `1250-FR-001` — superseded by `333-FR-018` (2026-10-29)
- `333-FR-018` — superseded by `1251-FR-001` (2026-10-29)
- `1250-FR-007` — superseded by `1251-FR-002` (2026-10-29)
- `1250-FR-006` — superseded by `1251-FR-007` (2026-10-29)
- `1251-FR-002` — superseded by `1252-FR-001` (2026-10-29)
- `1250-FR-003` — superseded by `1252-FR-002` (2026-10-29)
- `1251-FR-005` — superseded by `1252-FR-004` (2026-10-29)
