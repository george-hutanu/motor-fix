---
capability: live-video
updated: 2026-10-29
features:
  - 1250-live-video-provider
  - 333-media-storage
---

# Capability: Live video

Live video from the workshop to the job's driver: the provider behind its port, the live session on a job, the publish and view credentials, the refusals and the stops. Filled by `/speckit-archive` from each feature's Spec Delta; nothing is built yet.

## Requirements

### 333-FR-018 — The live video port `LiveVideoProvider` (1250-FR-001) MUST gain a fourth operation, `deleteRecording(providerRef)`, which removes a kept recording at the provider: the `cloudflare` adapter deletes the video (a 404 from the provider counts as deleted), `fake` records the call for the tests, `none` is a no-op; it times out after 5 seconds like the other three. The purge (FR-014) and the removal (FR-012) are its callers.

_From 333-media-storage._

### 1250-FR-002 — The API MUST offer `POST /api/v1/jobs/:id/live` (start), for the job's mechanic (the mechanic row of the job belonging to the caller's account) and the owner of the job's garage. It MUST, in one transaction after the provider's input is created: insert the LIVE_SESSION in `live` (FR-007) with `started_by` the actor, `started_at` now and `provider_input_id`; record one audit entry (action `create`, subject type `live_session`, subject id the session, garage id and job id, the actor and their role); and write one event `live.started` `{ liveSessionId, jobId }` to the job's audience (the driver's account, the garage, the job's mechanic; the `job` audience the stage events use). It answers 201 with `{ liveSessionId, startedAt, publish: { url, expiresAt, constraints: { audio: false, video: { maxHeight: 720, maxBitrateKbps: 1500 } } } }`; `expiresAt` is 2 minutes after the start, the window in which the sender must begin publishing. No microphone is asked for and no audio is published by a client honouring the constraints; the provider cannot refuse an audio track at ingest (a known limit, Assumptions).

_From 1250-live-video-provider._

### 1250-FR-003 — The API MUST offer `POST /api/v1/live-sessions/:id/view-token` (view), for the job's driver (the account of the job's booking request), the owner of the job's garage and the job's mechanic. For a session in `live` it answers 200 with `{ url, expiresAt }`: `url` the provider's low-latency HLS manifest for the session's input (`https://customer-<code>.cloudflarestream.com/<token>/manifest/video.m3u8?protocol=llhls` on Cloudflare), `<token>` a JSON web token the API signs itself with RS256 (`node:crypto`, the configured signing key, no new dependency) whose `sub` is the provider input id, `kid` the signing key id and `exp` 5 minutes ahead, carrying no account, name, plate or job id; `expiresAt` is that `exp`. A session not in `live` MUST answer 409 `live_ended`. No credential, row or event is written for a view; the view is not audited (it is counted, FR-009).

_From 1250-live-video-provider._

### 1250-FR-004 — Start and view MUST answer 404 to anyone without the right: another garage's staff, a receptionist of the garage, a mechanic of the garage who is not the job's mechanic, another driver, an admin, and everyone when the job's garage has `live_media` off (a switched-off feature is hidden everywhere; the check is `featureOn(garageId, 'live_media')`, 398-FR-007). With `live_media` off both operations answer 404 before any other check. A start on a job that already has a `live` session MUST answer 409 `live_already_on` with the message "<first name> <last name> transmite deja" / "<first name> <last name> is already live" built from the starter's account name (first name alone when there is no last name); a start on a `done` or `cancelled` job MUST answer 409 `job_closed`. A call without a session is 401 `sign_in_required`. Every refusal is checked before the provider is called and writes nothing; the only input a refused start creates is the race loser's, closed before the answer (FR-005).

_From 1250-live-video-provider._

### 1250-FR-005 — When the provider is `none`, or its create-input call fails or exceeds 5 seconds, the start MUST answer 503 `live_unavailable` with the message "Transmisia live nu e disponibilă acum. Poți trimite fotografii și clipuri." / "Live is not available now. You can send photos and clips.", and MUST leave no LIVE_SESSION row, audit entry or event behind; when the input was created but the session's transaction fails, the API MUST try once to close that input before answering, and log the failure to close with the input id. The provider's error, URL or any secret MUST never appear in the answer.

_From 1250-live-video-provider._

### 1250-FR-006 — The system MUST stop every `live` session of a job in the same transaction that moves the job to `done` or `cancelled` (`moveJob`, `libs/domain/src/workshop/transitions.ts`), with `stop_reason` `job_closed`, and every `live` session of a garage's jobs in the same transaction that switches its `live_media` off (`GarageFeaturesService.set`), with `stop_reason` `feature_off`: setting `stopped_at` now, writing one event `live.stopped` `{ liveSessionId, jobId, reason }` per session to the job's audience, and one audit entry per session (action `update`, subject type `live_session`, field `status`, old `live`, new `stopped`, actor role `system`, name "MotorFix", garage id and job id). With no `live` session the move and the switch write nothing extra. The sender's own stop, keep or discard and the idle stop are ST-1251's; closing the provider's input is title 2 of the Split.

_From 1250-live-video-provider._

### 1250-FR-007 — LIVE_SESSION MUST live in its own Prisma schema file, `libs/domain/prisma/schema/live.prisma` (EP-14 build plan, Lane B), with: `id` (uuid), `job_id`, `garage_id`, `started_by` (account), `started_at`, `stopped_at` (null while live), `stop_reason` (null, `job_closed`, `feature_off`; ST-1251 adds the sender's reasons), `provider` (`cloudflare` | `fake`) and `provider_input_id`; a session is `live` when `stopped_at` is null. One live session per job MUST be enforced by the database: a partial unique index on `job_id` where `stopped_at IS NULL`, with its migration. PostgreSQL is the truth (Principle VI): no copy of a session's state lives in Valkey.

_From 1250-live-video-provider._

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

## Retired

- `1250-FR-001` — superseded by `333-FR-018` (2026-10-29)
