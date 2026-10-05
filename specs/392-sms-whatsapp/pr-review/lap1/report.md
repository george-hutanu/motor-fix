**Agent review: success** — PR #73 at `6b3c8f3`, lap 1

Blocking: 0 (blocker 0, high 0) · medium 4 · low 2. Booted: postgres, redis, api, web, worker.
- No Docker on this machine: private PostgreSQL and Redis on free ports, no object store.
- No changed GET endpoint without path parameters.

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | medium | api readiness: storage down |  |  |
| 2 | medium | worker readiness: storage down |  |  |
| 3 | medium | Fallback rows skip the quiet-hours hold (FR-004) |  | fallBack() creates the next row as `status: 'queued'` and calls `this.queue(send(written.id))` without the `!type.urgent && isQuiet(at)` check that phoneRow()/emailRow() apply, so the WhatsApp (and WhatsApp -> e-mail) fallback goes out at night. FR-004: 'The quiet-hours rule ... MUST hold an SMS or WhatsApp of a type that is not urgent until 08:00'. Not in deferred.md (its LOW names only the garage switch and the verified-phone check). Fix: hold the fallback like phoneRow() (held + sendAfter = nextMorning) and add an integration case. |
| 4 | medium | Fallback rows skip the quiet-hours hold (FR-004) | libs/domain/src/notifications/notifications.service.ts:200-221 | fallBack() creates the next row as `status: 'queued'` and calls `this.queue(send(written.id))` without the `!type.urgent && isQuiet(at)` check that phoneRow()/emailRow() apply, so the WhatsApp (and WhatsApp -> e-mail) fallback goes out at night. FR-004: 'The quiet-hours rule ... MUST hold an SMS or WhatsApp of a type that is not urgent until 08:00'. Not in deferred.md (its LOW names only the garage switch and the verified-phone check). Fix: hold the fallback like phoneRow() (held + sendAfter = nextMorning) and add an integration case. |
| 5 | low | openapi.json does not declare the new 422 channel_not_allowed on PUT /api/v1/notification-preferences |  | Only `@ApiOkResponse({ type: NotificationPreferencesDto })` is declared, so the published contract and the generated client do not show the 422 (nor the pre-existing 400). An @ApiUnprocessableEntityResponse would document FR-009 for the ST-198 picker. |
| 6 | low | openapi.json does not declare the new 422 channel_not_allowed on PUT /api/v1/notification-preferences | libs/domain/src/notifications/preferences.controller.ts:26 | Only `@ApiOkResponse({ type: NotificationPreferencesDto })` is declared, so the published contract and the generated client do not show the 422 (nor the pre-existing 400). An @ApiUnprocessableEntityResponse would document FR-009 for the ST-198 picker. |

### Reproduction
1. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
2. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
3. Driver chose SMS for DUE_ITP (not urgent); the SMS is queued at 20:00 Europe/Bucharest → Brevo SMS answers 503 on every attempt; RETRY_MINUTES [1,5,15,60,240] runs out about 01:21 → fail(..., true) -> fallBack(row, 'whatsapp') writes status 'queued' and queues send(id) with no delay
4. Driver chose SMS for DUE_ITP (not urgent); the SMS is queued at 20:00 Europe/Bucharest → Brevo SMS answers 503 on every attempt; RETRY_MINUTES [1,5,15,60,240] runs out about 01:21 → fail(..., true) -> fallBack(row, 'whatsapp') writes status 'queued' and queues send(id) with no delay
5. PUT /api/v1/notification-preferences as a staff role with channel sms -> 422 channel_not_allowed (seen in the booted run) → apps/api/openapi.json lists only 200 for this operation
6. PUT /api/v1/notification-preferences as a staff role with channel sms -> 422 channel_not_allowed (seen in the booted run) → apps/api/openapi.json lists only 200 for this operation

Screenshots: 32, one per route × viewport × scheme × language.
