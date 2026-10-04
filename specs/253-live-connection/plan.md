# Implementation Plan: Set up the real-time connection to open dashboards

**Branch**: `253-live-connection` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/253-live-connection/spec.md`; context `context.md`; design `design.md` (no screens, shared toast).

## Summary

A signed-in server-sent events stream, `GET /api/v1/live`, in a new `events`
module of `libs/domain`: the ActorGuard signs it in, a `LiveHub` keeps the API
copy's open streams in memory with their channel keys, heartbeat, expiry and
the 10-stream cap, and one Redis subscriber on `live:events` forwards each
published event to the local streams in its audience. An admin-only
`POST /api/v1/admin/live/test` publishes `live.test` to one account. In the web
app the dashboard frame opens one stream per tab through a fetch-based reader
(the token stays in the `Authorization` header), reconnects once after `bye`
`expired`/`shutdown`, and shows the shared toast on `live.test`.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json`)
**Primary Dependencies**: NestJS 12.1.2, ioredis 6.0.0 (already used by `libs/domain/src/auth/auth.module.ts`), Angular 22.2.1, `@spartan-ng/brain` 1.5.0 sonner via `HlmToaster`/`toast` (`libs/ui-cockpit/src/lib/helm/toaster.ts`). No new dependency.
**Storage**: none written. Reads ACCOUNT / ACCOUNT_ROLE / GARAGE_MEMBER / MECHANIC through the existing ActorGuard plus one `mechanic` lookup; Redis pub/sub only (fan-out, Constitution VI).
**Testing**: Jest 30.5.2 from the root config; API tests as `*.integration.spec.ts` against real PostgreSQL and Redis (`JEST_SUITE`, `jest.preset.cjs`); Playwright 1.63.0 in `apps/web-e2e` with the seeded accounts (`apps/web-e2e/src/accounts.ts`).
**Target Platform**: API on Node (Railway, one copy today); web app Angular SSR with the edge proxy that already pipes SSE unbuffered (`apps/web/src/server/edge.ts:6-7`).
**Project Type**: Nx monorepo — `apps/api`, `apps/web`, `libs/domain`, `libs/contracts`, `libs/data-access` (generated), `libs/i18n`.
**Performance Goals**: under 2 s from publish to screen (Build brief).
**Constraints**: token never in the URL; no personal data on the wire; heartbeat 25 s; reconnect within 3 s; cap 10 streams per account per copy; streams survive a Redis outage.
**Scale/Scope**: one stream per open dashboard tab.

## Constitution Check

- [x] **I. No Bloat**: no new dependency (fetch + a ~30-line SSE line parser instead of an SSE client library; ioredis already present). One service (`LiveHub`) and two small controllers; no publish interface layer (ST-257 adds the outbox). The web reader is a file in the web app, not a new Nx lib — see Complexity Tracking.
- [x] **II. Test Discipline**: red tests first; hub unit tests with fake timers colocated; API integration tests on real PostgreSQL and Redis, two Nest apps on one Redis for the fan-out; Playwright for the two-context toast flow.
- [x] **III. The Given Stack**: SSE (A8), NestJS, Redis, Angular, the kit's Spartan toast.
- [x] **IV. One Repository**: `libs/domain/src/events` (module named by the Build brief); Redis is the only broker.
- [x] **V. Rules Live in One Place**: the test body DTO and the wire message type live in `libs/contracts`; `openapi.json` and the generated client are regenerated; the channel rule is server-side only; trust on the server (guard + admin check).
- [x] **VI. PostgreSQL Is the Truth**: no state change in this story (opening a stream is not a change); Redis only fans out. The test event is published straight to Redis, as the Build brief says; ST-257 moves publishing behind the outbox.
- [x] **Notion choices**: server-sent events A8 (Decided 2026-10-03); "proposed" brief values (path, `hello`, `live:events`, heartbeat, cap, 3 s) taken as written.

## Project Structure

### Documentation (this feature)

```text
specs/253-live-connection/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md, tasks.md
├── contracts/live.md
├── context.md, design.md, notion-sync.md, auto-run.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
libs/contracts/src/live.dto.ts                 (new) LiveTestDto, LiveMessage type, LIVE_REASONS
libs/contracts/src/index.ts                    export it
libs/domain/src/events/live.hub.ts             (new) connections, channels, heartbeat, expiry, cap, fan-out, shutdown
libs/domain/src/events/live.hub.spec.ts        (new) unit, fake timers
libs/domain/src/events/live.controller.ts      (new) GET /live, POST /admin/live/test
libs/domain/src/events/events.module.ts        (new) EventsModule.register({ redisUrl }) (the token secret comes from the global AUTH_OPTIONS)
libs/domain/src/events/live.api.integration.spec.ts (new) real PostgreSQL + Redis, two copies
libs/domain/src/auth/access-token.ts           verifyAccessToken also returns expiresAt
libs/domain/src/auth/auth.module.ts            global: true (the guard and Prisma for every module)
libs/domain/src/index.ts                       export EventsModule
apps/api/src/app.module.ts                     register EventsModule
apps/api/openapi.json, libs/data-access/**     regenerated
apps/web/src/app/dashboard/live.ts             (new) one stream per tab, SSE reader, reconnect
apps/web/src/app/dashboard/live.spec.ts        (new)
apps/web/src/app/dashboard/frame.ts            open/close the stream, HlmToaster, toast on live.test
apps/web/src/app/dashboard/frame.spec.ts       toast + lifecycle
libs/i18n/src/shell/{ro,en}.json               shell.live.test
apps/web-e2e/src/live.spec.ts                  (new) two contexts, admin test event, toasts within 2 s
```

**Structure Decision**: backend in `libs/domain/src/events` (the `events`
module the Build brief names, which already holds `event.port.ts`); the
browser side in the dashboard folder of `apps/web`, its only consumer.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Build brief names an "Angular `live` library"; built as `apps/web/src/app/dashboard/live.ts` | The web app is the only consumer; a new Nx lib adds project.json, jest, tsconfig and stryker configs for one file (Principle I) | — (this is the simpler alternative; it becomes a lib the day a second app needs it) |
| `AuthModule` becomes `global` | The events module's controllers need `ActorGuard` and `PRISMA`; registering `AuthModule` a second time would open a second Prisma client and Redis connection | Moving the live controllers into AuthModule (the audit precedent) puts the events module's code in auth's module and keeps growing it |
