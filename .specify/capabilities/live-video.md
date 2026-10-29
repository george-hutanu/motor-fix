---
capability: live-video
updated: 2026-10-29
features:
  - 1250-live-video-provider
  - 333-media-storage
  - 1251-live-recording
---

# Capability: Live video

Live video from the workshop to the job's driver: the provider behind its port, the live session on a job, the publish and view credentials, the refusals and the stops. Filled by `/speckit-archive` from each feature's Spec Delta; nothing is built yet.

## Requirements

### 1251-FR-001 — The port `LiveVideoProvider`'s one recording delete, `deleteRecording(ref)` (333-FR-018), MUST delete every recording the provider holds for a live recording's reference, which is the session's live input id (`provider_input_id`, the reference a live MEDIA_ITEM carries in `provider_ref`, FR-003): the `cloudflare` adapter lists the live input's videos (`GET /live_inputs/{ref}/videos`) and deletes each (`DELETE /{videoUid}`), a 404 on the list or on a video counting as deleted and an empty list as success, so a second call is a no-op; any other failure throws so the caller keeps its own row; each call times out after 5 seconds and carries the child span and the duration histogram (operation `delete_recording`) as the port's other calls do. `fake` records the call and `none` is a no-op, as ST-333 built them. No second operation is added.

_From 1251-live-recording._

### 1250-FR-002 — The API MUST offer `POST /api/v1/jobs/:id/live` (start), for the job's mechanic (the mechanic row of the job belonging to the caller's account) and the owner of the job's garage. It MUST, in one transaction after the provider's input is created: insert the LIVE_SESSION in `live` (FR-007) with `started_by` the actor, `started_at` now and `provider_input_id`; record one audit entry (action `create`, subject type `live_session`, subject id the session, garage id and job id, the actor and their role); and write one event `live.started` `{ liveSessionId, jobId }` to the job's audience (the driver's account, the garage, the job's mechanic; the `job` audience the stage events use). It answers 201 with `{ liveSessionId, startedAt, publish: { url, expiresAt, constraints: { audio: false, video: { maxHeight: 720, maxBitrateKbps: 1500 } } } }`; `expiresAt` is 2 minutes after the start, the window in which the sender must begin publishing. No microphone is asked for and no audio is published by a client honouring the constraints; the provider cannot refuse an audio track at ingest (a known limit, Assumptions).

_From 1250-live-video-provider._

### 1250-FR-003 — The API MUST offer `POST /api/v1/live-sessions/:id/view-token` (view), for the job's driver (the account of the job's booking request), the owner of the job's garage and the job's mechanic. For a session in `live` it answers 200 with `{ url, expiresAt }`: `url` the provider's low-latency HLS manifest for the session's input (`https://customer-<code>.cloudflarestream.com/<token>/manifest/video.m3u8?protocol=llhls` on Cloudflare), `<token>` a JSON web token the API signs itself with RS256 (`node:crypto`, the configured signing key, no new dependency) whose `sub` is the provider input id, `kid` the signing key id and `exp` 5 minutes ahead, carrying no account, name, plate or job id; `expiresAt` is that `exp`. A session not in `live` MUST answer 409 `live_ended`. No credential, row or event is written for a view; the view is not audited (it is counted, FR-009).

_From 1250-live-video-provider._

### 1250-FR-004 — Start and view MUST answer 404 to anyone without the right: another garage's staff, a receptionist of the garage, a mechanic of the garage who is not the job's mechanic, another driver, an admin, and everyone when the job's garage has `live_media` off (a switched-off feature is hidden everywhere; the check is `featureOn(garageId, 'live_media')`, 398-FR-007). With `live_media` off both operations answer 404 before any other check. A start on a job that already has a `live` session MUST answer 409 `live_already_on` with the message "<first name> <last name> transmite deja" / "<first name> <last name> is already live" built from the starter's account name (first name alone when there is no last name); a start on a `done` or `cancelled` job MUST answer 409 `job_closed`. A call without a session is 401 `sign_in_required`. Every refusal is checked before the provider is called and writes nothing; the only input a refused start creates is the race loser's, closed before the answer (FR-005).

_From 1250-live-video-provider._

### 1250-FR-005 — When the provider is `none`, or its create-input call fails or exceeds 5 seconds, the start MUST answer 503 `live_unavailable` with the message "Transmisia live nu e disponibilă acum. Poți trimite fotografii și clipuri." / "Live is not available now. You can send photos and clips.", and MUST leave no LIVE_SESSION row, audit entry or event behind; when the input was created but the session's transaction fails, the API MUST try once to close that input before answering, and log the failure to close with the input id. The provider's error, URL or any secret MUST never appear in the answer.

_From 1250-live-video-provider._

### 1251-FR-007 — Every end of a `live` session MUST go through one stop routine, inside the caller's transaction: set `stopped_at` now and `stop_reason`; record one audit entry (action `update`, subject type `live_session`, field `status`, old `live`, new `stopped`, garage id and job id, the actor and role: the sender for `sender`, role `system` and name "MotorFix" for `job_closed`, `feature_off` and `idle`); write the event `live.stopped` `{ liveSessionId, jobId, reason, keep }` to the job's audience (the driver's account, the garage, the job's mechanic); then, when `keep_recording` is true, register the recording per FR-003 (its `media.added` `{ mediaId, jobId, kind: 'live' }` to the same audience, after `live.stopped`, and its system audit entry) and set `recording_media_id`; all in the transaction. The system stops of ST-1250 (every `live` session of a job in the transaction that moves it to `done` or `cancelled`, `moveJob`; every `live` session of a garage in the transaction that switches its `live_media` off, `GarageFeaturesService.set`) MUST use this routine with `job_closed` and `feature_off`; with no `live` session they write nothing extra. A system stop makes no provider call: the worker deletes a discarded recording from the event (FR-013).

_From 1251-live-recording._

### 1251-FR-002 — LIVE_SESSION MUST live in its own Prisma schema file, `libs/domain/prisma/schema/live.prisma`, with: `id` (uuid), `job_id`, `garage_id`, `started_by` (account), `started_at`, `stopped_at` (null while live), `stop_reason` (null, `job_closed`, `feature_off`, `sender`; title 2 adds `idle`), `provider` (`cloudflare` | `fake`), `provider_input_id`, `keep_recording` (boolean, not null, default true: the sender's choice, on until changed) and `recording_media_id` (null, or the MEDIA_ITEM the stop registered, set only when the session stopped with `keep_recording` true); a session is `live` when `stopped_at` is null. One live session per job MUST be enforced by the database: a partial unique index on `job_id` where `stopped_at IS NULL`, with its migration. PostgreSQL is the truth (Principle VI): no copy of a session's state or keep value lives in Valkey.

_From 1251-live-recording._

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

### 1251-FR-005 — The API MUST offer `POST /api/v1/live-sessions/:id/stop` with body `{ keep?: boolean }` (the stop), for the same people as FR-004. In one transaction under the session's row lock it MUST: when `keep` is given and differs from the row, apply it as FR-004 does (row and audit entry); then run the stop routine of FR-007 with `stop_reason` `sender` and the actor as the audit's actor. It answers 200 `{ liveSessionId, stoppedAt, keep, seconds, recordingMediaId }`, `seconds` the whole seconds from `started_at` to `stopped_at` (rounded down) and `recordingMediaId` null when discarded. When `keep_recording` is false, the API MUST call `deleteRecording(provider_input_id)` once, after the transaction committed and before answering; a failure or timeout of that call MUST not change the answer: it is logged as one warning line with the session id and input id (never the provider's message), counted (FR-009), and left to title 2's worker (FR-013), which reads `keep: false` on `live.stopped`. No provider call is made for a kept recording.

_From 1251-live-recording._

### 1251-FR-006 — Stop and the keep change MUST answer 404 to anyone without the right: the job's driver, a receptionist of the garage, a mechanic of the garage who is not the job's mechanic, another garage's staff, another driver, an admin, and everyone when the job's garage has `live_media` off (checked first, `featureOn(garageId, 'live_media')`, 398-FR-007). A session not in `live` MUST answer 409 `live_ended` with "Transmisia live s-a încheiat" / "The live stream has ended" (ST-1250's words). A call without a session is 401 `sign_in_required`. Every refusal writes nothing and calls the provider for nothing; two stops racing on one session yield one 200 and one 409 under the row lock.

_From 1251-live-recording._

### 1251-FR-008 — The two operations' request and answer DTOs and the refusal codes MUST come from the contracts library, validated at the edge (`keep` a boolean, nothing else accepted); the `live.stopped` payload type gains `keep` and `media.added` gains its `{ mediaId, jobId, kind }` payload there; `apps/api/openapi.json` MUST carry both operations and `libs/data-access` MUST be regenerated (`npx nx run data-access:generate`), never edited by hand. Neither route is public: both run under the app-wide actor guard.

_From 1251-live-recording._

### 1251-FR-009 — Observability MUST ship in the same PR: the counter `motorfix_live_recordings_total{outcome}` (`discarded`, `discard_failed`; a kept recording is counted by ST-333's `motorfix_media_items_total`), the outcome `stopped` added to `motorfix_live_sessions_total{outcome}`, the operation `delete_recording` (already ST-333's) on the existing histogram `motorfix_live_provider_duration_seconds{provider,operation}` and its child span (operation, host and status; never the URL query, body or a secret, 876-FR-004); one warning log line per refused stop or keep change and per failed delete carrying ids only (session id, job id, garage id, input id, the refusal code); the live panel of the api dashboard (`infra/observability/grafana/dashboards`, uid `motorfix-api`) extended with the recordings counter; no new alert rule: a failed delete raises the API's warning count and a provider failure its 5xx rate, which `api-error-rate` already alerts on, so the total stays at 50 rules; and `infra/observability/inventory.json` updated: the endpoint entry `live-sessions` names the two new routes, the stop's writes and the discard's provider call, with `node scripts/observability-inventory.ts` passing.

_From 1251-live-recording._

### 1251-FR-010 — Tests MUST exist before the code (Principle II), in Jest on real PostgreSQL and Valkey for the API: the stop with keep on by the mechanic and by the owner (session columns, media row with `seconds`, `sender_id` null, `provider_ref`, `sent_at`, `purge_after` 90 days on, the two audit entries, `live.stopped` then `media.added` in one transaction, the answer); the stop with `{ keep: false }` (no media row, no `media.added`, `keep: false` in the event, one `deleteRecording` call with the input id after the commit, through a provider stub by `overrideProvider`); a failing and a hanging delete (200 all the same, the warning and the counter); the keep change by both roles, its audit entry, and no write on an unchanged value; the stop without `keep` honouring the row's value; 404 for the driver, a receptionist, another mechanic, another garage, another driver, an admin and `live_media` off, for both operations; 409 `live_ended` on a stopped session for both; two simultaneous stops yielding one 200 and one 409; the system stops on `done`, `cancelled` and `live_media` off registering the recording when `keep_recording` is on and not when off, with `keep` in the event and no provider call; `seconds` rounded down and 0 under one second (fake clock); the Cloudflare adapter's `deleteRecording` against a stubbed HTTP server (list the input's videos, delete each, success on an empty list and on a 404, failure on another non-2xx, the 5 s cut); the metrics and the inventory check. Every test file carries its `// @traces 1251-FR-<n>` line.

_From 1251-live-recording._

## Retired

- `1250-FR-001` — superseded by `333-FR-018` (2026-10-29)
- `333-FR-018` — superseded by `1251-FR-001` (2026-10-29)
- `1250-FR-007` — superseded by `1251-FR-002` (2026-10-29)
- `1250-FR-006` — superseded by `1251-FR-007` (2026-10-29)
