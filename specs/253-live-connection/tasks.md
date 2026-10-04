# Tasks: Set up the real-time connection to open dashboards

**Input**: spec.md, plan.md, data-model.md, contracts/live.md, research.md, context.md, design.md
**Tests**: required (constitution II, Build brief "Tests"); written first by `/speckit-tests`.

## Phase 1: Setup

- [X] T001 [P] `libs/contracts/src/live.dto.ts` (new): `LiveTestDto` (`accountId` uuid), the wire type `LiveMessage` (`kind`, `id`, `at`, optional `reason`), `LIVE_BYE_REASONS` = `expired` | `evicted` | `shutdown`; export from `libs/contracts/src/index.ts` (FR-005, FR-008, FR-012)
- [X] T002 [P] `libs/domain/src/auth/access-token.ts`: `verifyAccessToken` also returns `expiresAt` (ms from `exp`) (FR-008)

## Phase 2: Foundational

- [X] T003 `libs/domain/src/events/live.hub.ts` (new): `LiveHub` — `open(res, { accountId, channels, expiresAt })` writes `hello`; per-connection 25 s silence heartbeat (`: ping`); `bye` `expired` at `expiresAt`; 11th stream of an account → oldest `bye` `evicted`; `deliver(raw)` parses a fan-out message, drops malformed ones, writes once to each local connection whose channels meet the audience; `publish(event, audience)` to Redis `live:events`; `shutdown` → `bye` `shutdown` to all; client close releases timers (FR-003, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011)

## Phase 3: User Story 1 — the signed-in stream (P1)

Independent test: open the stream per role through HTTP against PostgreSQL and Redis; read `hello`, the headers, 401 and 403.

- [X] T004 [US1] `libs/domain/src/events/live.controller.ts` (new): `GET live` under `ActorGuard`, SSE headers, channels from the Actor (`account:`, `system`, `garage:` when `garageId`, `mechanic:` via one `mechanic` lookup for the mechanic role, `admin` for the admin role), `expiresAt` from the request's token (FR-001, FR-002, FR-004)
- [X] T005 [US1] `libs/domain/src/events/events.module.ts` (new): `EventsModule.register({ redisUrl })` — `LiveHub` with a publisher and a subscriber ioredis connection (errors logged, never thrown), the controller, shutdown; `libs/domain/src/auth/auth.module.ts` `global: true`; export from `libs/domain/src/index.ts`; register in `apps/api/src/app.module.ts` (FR-006, FR-010, FR-011)

## Phase 4: User Story 2 — the admin test update (P1)

Independent test: two Nest apps on one Redis; an admin's test reaches each stream of the target once; 401/404/503.

- [X] T006 [US2] `POST admin/live/test` in `libs/domain/src/events/live.controller.ts`: admin role only (404 otherwise), unknown account 404, `live.test` with a fresh event id to `account:<id>`, 202; Redis failure → 503 `live_unavailable` (FR-012)
- [X] T007 [US2] Regenerate `apps/api/openapi.json` and `libs/data-access` (`npx nx run data-access:generate`) (FR-012)
- [X] T008 [US2] `apps/web/src/app/dashboard/live.ts` (new): `Live` — one stream per tab, browser only; `fetch('/api/v1/live')` with `Authorization`, `Accept: text/event-stream`, `ngsw-bypass`; SSE block parser; `events` stream of `LiveMessage`; `close()` aborts (FR-013)
- [X] T009 [US2] `apps/web/src/app/dashboard/frame.ts`: open `Live` on init, close on destroy and at sign-out; `hlm-toaster` in the template; `toast` with `shell.live.test` on `live.test`; texts in `libs/i18n/src/shell/ro.json` / `en.json` ("Actualizare de test în direct" / "Live test update") (FR-013, FR-015)

## Phase 5: User Story 3 — a healthy connection (P2)

- [X] T010 [US3] `apps/web/src/app/dashboard/live.ts`: after `bye` `expired` or `shutdown` → `session.renew()` then reopen within 3 s; not after `evicted`, sign-out or a failed renewal (FR-014)

## Phase 6: Polish

- [ ] T011 `apps/web-e2e/src/live.spec.ts` (new): driver and garage dashboards in two contexts, the admin's test to each, both toasts within 2 s, no reload (SC-001, FR-015)

## Dependencies

T001, T002 → T003 → T004, T005 → T006 → T007; T001 → T008 → T009 → T010; T006 + T009 → T011.

## FR → test (filled by `/speckit-tests`)

| FR | Test |
| --- | --- |
| FR-001 | `live.api.integration.spec.ts` "opens a server-sent events stream…", "never takes the token from the address"; `live.spec.ts` "opens the stream with the access token in the Authorization header…" |
| FR-002 | `live.api.integration.spec.ts` "answers 401 and opens no stream…", "answers 403 to a suspended account"; adversary "refusals" block |
| FR-003 | `live.hub.spec.ts` "greets a new stream with hello…"; integration "…greets it with hello" |
| FR-004 | integration "reaches the dashboard of each role and nobody else"; adversary "audiences" block (role in use, two garages, mechanic channel) |
| FR-005 | `live.hub.spec.ts` "writes each message as an event line and one data line"; adversary hub "newline injection", "extra fields" |
| FR-006 | `live.hub.spec.ts` audience and "once" tests; integration "the fan-out across API copies" |
| FR-007 | `live.hub.spec.ts` "sends a comment line after 25 seconds…", "counts the 25 seconds from the last message sent" |
| FR-008 | `live.hub.spec.ts` "says bye with reason expired…"; integration "says bye with reason expired when the access token expires"; `access-token.spec.ts` "tells when the token expires" |
| FR-009 | `live.hub.spec.ts` "closes the oldest stream of an account when an eleventh opens"; adversary "stream cap over HTTP" |
| FR-010 | `live.hub.spec.ts` "releases a stream whose client went away", "says bye with reason shutdown…"; integration "says bye with reason shutdown when the copy shuts down" |
| FR-011 | `live.hub.spec.ts` malformed-message table; integration "keeps a stream open after a malformed fan-out message", "a copy whose Redis does not answer"; adversary "Redis going away and coming back" |
| FR-012 | integration "the admin test update" block (202, 401, 404 roles, 404 unknown, 400 bodies, 503) |
| FR-013 | `live.spec.ts` "opens one stream per tab…", "opens nothing while the page is rendered on the server", "aborts the stream when closed…"; `frame.spec.ts` "opens the live connection when the dashboard starts…", "closes the live connection at sign-out" |
| FR-014 | `live.spec.ts` "renews the token and reconnects within 3 seconds after bye %s", "does not reconnect after bye evicted", "does not reconnect when the renewal fails"; adversary "reconnecting" block |
| FR-015 | `frame.spec.ts` "shows the test toast on a live test update for a %s", "shows the test toast in English"; e2e `live.spec.ts` |
