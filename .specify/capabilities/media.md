---
capability: media
updated: 2026-10-29
features:
  - 333-media-storage
---

# Capability: Media

Photos, clips and kept recordings on a job: the media item and its states, the signed upload and completion, the conversions and thumbnails on the `media` queue, the scoped list and file addresses, the removal function and the nightly purge with its cleanup steps. Filled by `/speckit-archive` from each feature's Spec Delta; nothing is built yet (ST-333 is the first feature).

## Requirements

### 333-FR-001 — The system MUST keep a MEDIA_ITEM per sent photo, clip or kept recording, in its own schema file (`libs/domain/prisma/schema/media.prisma`, as live.prisma is to live video), with: `id` (uuid), `job_id`, `garage_id` (copied from the job for scoped reads), `sender_id` (an account; null for a kept recording), `kind` (`photo`, `clip`, `live`), `status` (`processing`, `visible`, `failed`, `removed`, `purged`), `caption` (optional, at most 140 characters), `content_type` and `size_bytes` of the original as declared, `original_key`, `file_key` and `thumbnail_key` (storage keys, null until written), `provider_ref` (the provider's recording id, for a recording kept at the provider), `seconds` (clips and recordings), `sent_at`, `uploaded_at` (null until the confirm succeeds), `purge_after`, `removed_at`, `purged_at`, `created_at`, `updated_at`; indexed by `(job_id, sent_at)` and by `(status, purge_after)`. The status moves `processing` → `visible` or `failed`; `visible` → `removed`; `visible`, `failed` or `removed` → `purged`; no other move.

_From 333-media-storage._

### 333-FR-003 — `POST /api/v1/jobs/:id/media/uploads` with `{ kind, contentType, sizeBytes, checksum, seconds?, caption? }` (`checksum` the CRC32 the signed PUT is checked against, as for garage photos; research R4) MUST, for the job's mechanic (the mechanic row of the job belonging to the caller's account) or the owner of the job's garage, while `live_media` is on for the garage (398-FR-007) and the job is `in_work`, `paused` or `done` with `handed_over_at` null: check the declared type and size against the kind's purpose (422 `file_type_not_allowed` or `file_too_large`, 422-FR-002) and, for a clip, `seconds` at most 60 (422 `clip_too_long`); create the item in `processing` with `sent_at` now and `purge_after` = `sent_at` + MEDIA_RETENTION_DAYS; and answer 201 with the media id and a signed upload address valid 15 minutes. The item's `original_key` is the storage key the address was signed for.

_From 333-media-storage._

### 333-FR-004 — The upload request MUST refuse: 404 when the caller is a driver who is not the job's, a member of another garage or a MotorFix admin, or when the job does not exist, or when `live_media` is off for the garage; 403 `forbidden` to a receptionist of the garage, a mechanic of the garage who is not the job's mechanic, and the job's own driver; 409 `job_handed_over` when `handed_over_at` is set; 409 `job_not_in_work` when the job is `to_do` or `cancelled`; 503 `storage_unavailable` when storage cannot be reached or the address cannot be signed (no item is created). The checks run in that order: right, then switch, then state, then storage.

_From 333-media-storage._

### 333-FR-005 — `POST /api/v1/media/:id/complete` MUST, for the item's sender only (404 to anyone else), confirm the upload through storage (409 `file_missing` when the object is absent, the item kept `processing`; 422 `file_type_mismatch` or `file_too_large` when the bytes fail, the object deleted and the item `failed`), record the final key as `original_key` and `uploaded_at` now, enqueue one conversion job on the `media` queue keyed by the media id, and answer 200 with the item; a complete of an item whose `uploaded_at` is set answers 200 with the item and enqueues nothing; a complete of an item that is `failed` with `uploaded_at` null (its bytes were refused earlier, or the 24-hour rule failed it) answers 409 `invalid_state` and enqueues nothing.

_From 333-media-storage._

### 333-FR-006 — The worker's `media` queue MUST process a photo with sharp as the garage photos are processed (110-FR-010): the original decoded (HEIC through the worker's decoder, 1191-FR-005), a JPEG copy of at most 2048 px on the long side with all metadata stripped (location included), and a JPEG thumbnail of at most 480 px on the long side, written to the item's `file_key` and `thumbnail_key` under the item's purpose and job.

_From 333-media-storage._

### 333-FR-007 — The worker MUST process a clip with ffmpeg: the real length measured first (over 61 seconds → `failed` without converting); the output an MP4 with H.264 video, the shorter side scaled to at most 720 px without upscaling, no audio stream whatever the input carried, `faststart` for progressive playback; and a JPEG thumbnail of at most 480 px on the long side from the frame at 1 second (or the first frame of a shorter clip). The conversion runs with 2 tries and a 10-minute limit per try; the worker image and CI MUST carry ffmpeg (the one new runtime dependency of this story, pinned in the worker's Dockerfile and installed in the CI jobs that run the worker's tests).

_From 333-media-storage._

### 333-FR-008 — When the worker finishes an item it MUST, in one transaction: set `visible`, write `file_key` and `thumbnail_key` (and `seconds` measured for a clip), record `media.added` (`mediaId`, `jobId`, `kind`) with the job audience so it reaches `job:{jobId}` and `garage:{garageId}` (as the live session events do), and write one audit entry (action `create`, subject type `media_item`, subject id the item, garage id and job id, the actor the sender or `system` for a recording, kind `media.added`). When the last try fails it MUST set `failed` and record no event; a `failed` item keeps its original until the purge.

_From 333-media-storage._

### 333-FR-009 — `GET /api/v1/jobs/:id/media` MUST answer, to the job's driver (the account of the job's booking request), the owner of the job's garage and the job's mechanic, the job's items ordered by `sent_at` ascending, each with id, kind, status, caption, seconds, `sentAt`, `removedAt`, `senderId` and whether a thumbnail exists; `purged` items are never listed; `processing` and `failed` items are listed to garage staff with the right and never to the driver; a `removed` item is listed to everyone with the right with its `removedAt`. The refusals are by role only, whatever the `live_media` switch: 404 to a driver who is not the job's, a member of another garage, a MotorFix admin, or for a missing job; 403 to a receptionist or a mechanic of the garage who is not the job's mechanic. No paging: a job's items are listed whole.

_From 333-media-storage._

### 333-FR-010 — `GET /api/v1/media/:id/file?variant=file|thumbnail` (default `file`) MUST answer, to the three roles of FR-009 with the same refusals, 200 with a signed download address valid 5 minutes (422-FR-006) for a `visible` item: the converted file or the thumbnail from storage, or, for a recording kept at the provider, the provider's signed playback address valid 5 minutes (thumbnail: 404); any item not `visible` answers 404. The address is signed without checking the object exists. The bucket is private: no public address, no CDN caching of a media file.

_From 333-media-storage._

### 333-FR-011 — `registerRecording(jobId, file, seconds)` on the media pipeline (the `media` module's service, exported from the domain library) MUST create a `live` item with no sender, `sent_at` now and `purge_after` from the retention setting: when `file` is a storage key, the item starts `processing` and the worker converts it as a clip (FR-007, the 60-second limit not applied) to `visible` (FR-008); when `file` is a provider reference, the item is written `visible` at once with `provider_ref`, no thumbnail, `media.added` and its audit entry in the same transaction. It runs regardless of the `live_media` switch and the job's state (the recording was made while both allowed it). Tested with a fake file; ST-334 is its caller.

_From 333-media-storage._

### 333-FR-012 — `removeItem(mediaId, actor)` on the media service MUST, for a `visible` item: delete the converted file, the thumbnail and the original from storage (or the recording at the provider) at once, then set `removed` with `removed_at` and write one audit entry (action `update`, field `status`, old `visible`, new `removed`, the actor given) in one transaction; an item not `visible` refuses with 409 `invalid_state`; a failing storage or provider delete leaves the item `visible` and unchanged, writes no audit entry and surfaces the error to the caller. No route calls it in this story (ST-340 adds the action).

_From 333-media-storage._

### 333-FR-013 — A nightly `media-retention` job MUST run at 03:00 Europe/Bucharest as one repeatable queue job under a fixed scheduler id (the pattern of `retention.module.ts`) and execute an ordered list of cleanup steps registered by name; each step runs in its own try, a step's error is logged and counted and the next step still runs; this story registers one step, the media purge, and ST-411 adds the zip step. `MEDIA_RETENTION_DAYS` (default 90) is read from the environment through the contracts library's configuration, declared in `.env.example`.

_From 333-media-storage._

### 333-FR-014 — The media purge step MUST select every item in `visible`, `failed` or `removed` whose `purge_after` has passed, delete its original, converted file and thumbnail from storage (and a provider-held recording at the provider, through the port operation of FR-018), set `purged` with `purged_at`, and write one audit entry per job (actor `system`, action `delete`, subject type `job`, subject id the job, garage id and job id, kind `media.purged`, text "{n} fișiere șterse după {days} de zile" with the items purged for that job and the retention days of the run); each item is handled in its own transaction (selected `FOR UPDATE SKIP LOCKED`, files deleted, then `purged` written and committed) so a second run, or an overlapping worker, skips or finds nothing; a key already missing in storage counts as deleted. An item still `processing` with `uploaded_at` null 24 hours after `sent_at`, or with `uploaded_at` more than 24 hours past, MUST be set `failed` by the same step (amended in review: an uploaded item whose conversion never finished was otherwise never purged). A storage or provider delete that fails (including `deleteRecording`) rolls that item back, leaves it unpurged for the next night and is logged.

_From 333-media-storage._

### 333-FR-015 — Every refusal code of FR-003 to FR-012 (`file_type_not_allowed`, `file_too_large`, `clip_too_long`, `file_type_mismatch`, `file_missing`, `job_handed_over`, `job_not_in_work`, `storage_unavailable`, `invalid_state`, `forbidden`, `not_found`), the request and answer DTOs (kind, status, the item, the upload answer, the file answer) and the limits (2048 px, 480 px, 720p, 60 seconds, 100 MB, 15 and 5 minutes) MUST come from the contracts library, validated at the edge; `apps/api/openapi.json` MUST carry the four operations, the generated client (`npx nx run data-access:generate`) MUST include them, and every route needs a session (none is `@Public()`).

_From 333-media-storage._

### 333-FR-016 — Observability MUST ship in the same PR: the `media` queue and the `media-retention` queue observed as the others are; counters `motorfix_media_items_total{kind,outcome}` (`visible`, `failed`, `refused`), `motorfix_media_purged_total{kind}` and `motorfix_media_retention_step_failures_total{step}`; a histogram `motorfix_media_conversion_seconds{kind}`; the four endpoints, the two queues, the ffmpeg conversion and the provider delete listed in `infra/observability/inventory.json` with a panel and the alerts, as arms of the existing `worker-jobs-failed` rule (amended in review: the free tier caps alert rules at 50): any `media` job failed for good, and no `media-retention` run completed in 26 hours.

_From 333-media-storage._

### 333-FR-017 — Tests MUST exist before the code (Principle II), in Jest on real PostgreSQL and Valkey for the API (every role of FR-004 and FR-009 with its code; the type, size and seconds limits; the `live_media` and handover refusals; 503 with storage down; the complete's four outcomes and its idempotence; the list's visibility per state and role; the file address per variant and state; the state moves of FR-001, every forbidden move refused), Jest for the worker (a real JPEG, PNG, HEIC and WebP processed to 2048/480 px with no metadata; a clip generated by ffmpeg in the test with a sound track comes out H.264 720p with no audio stream and a thumbnail; the 61-second refusal; `failed` after two tries; `media.added` written only when visible, with its audit entry), Jest for `registerRecording` with a fake storage-held file and a provider reference, Jest for `removeItem`, and Jest with a fake clock for the purge (items on two jobs, one audit entry per job, the future item untouched, the provider recording deleted through the fake adapter, idempotent on a second run, the stuck `processing` item failed, a step failure not stopping the next step). No Playwright flow on its own (the brief: covered by #67 and #68). Every test file carries one whole-line `// @traces` comment naming the `333-FR-<n>` ids it proves.

_From 333-media-storage._

## Retired
