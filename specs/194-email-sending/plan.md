# Implementation Plan: Set up e-mail sending

**Branch**: `194-email-sending` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/194-email-sending/spec.md`

## Summary

A `notifications` module in `libs/domain`: the type catalogue in code, a NOTIFICATION table, a service that writes the rows and queues send jobs on a BullMQ `notifications` queue, and a processor the worker runs that sends through Brevo with retries, grouping and quiet hours. The API gains the admin test endpoint and the Brevo webhook. Research: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package-lock.json`), Node 24 (`.nvmrc`, `package.json` engines)

**Primary Dependencies**: NestJS 12.1.2, Prisma 7.10.0 with `@prisma/adapter-pg`, ioredis 6.0.0 (`package-lock.json`); new: `bullmq` 6.3.11 (R1)

**Storage**: PostgreSQL (new table `notification`, column `account.email_bounced_at`; migration under `libs/domain/prisma/migrations/`); Redis for the queue and the live publish only

**Testing**: Jest 30.5.2 from `jest.preset.cjs`; unit specs colocated; `*.integration.spec.ts` against real PostgreSQL and Redis (constitution II); Brevo replaced by a recorded mock HTTP server started in the test (story Tests: "contract … against a recorded mock")

**Target Platform**: Railway, EU region (A16); `apps/api` and `apps/worker`

**Project Type**: web service (Nx monorepo)

**Performance Goals**: an urgent, ungrouped message accepted by Brevo within 60 s (SC-001); queue concurrency 10; Brevo timeout 10 s

**Constraints**: S10 open → `EMAIL_SENDING=off` by default (context.md Constraints); no personal data in logs (Security, context.md line 28); Europe/Bucharest quiet hours across DST

**Scale/Scope**: launch volume; one queue, three job names (`send`, `flush`, and quiet-hours releases reuse `send`)

## Constitution Check

- [x] **I. No Bloat**: one module, no SDK (R3), no date library (R5). One new dependency, BullMQ, justified in R1. The e-mail fallback is a seam with no implementation yet → Complexity Tracking.
- [x] **II. Test Discipline**: red tests first; unit specs for catalogue, quiet hours, config, messages, backoff; integration specs for the service, processor, controller and webhook against real PostgreSQL and Redis.
- [x] **III. The Given Stack**: NestJS, PostgreSQL, Redis only.
- [x] **IV. One Repository, One Toolchain**: code in `libs/domain` and the existing `api`/`worker` apps; Redis is the only broker.
- [x] **V. Rules Live in One Place**: one service is the only way to send (the test endpoint and the account e-mail call it); the DTO lives in `libs/contracts` and feeds OpenAPI; admin check on the server.
- [x] **VI. PostgreSQL Is the Truth**: rows before jobs (R2); grouping state in PostgreSQL (R6). Sending is not a state change with an outbox event (the live publish goes straight to Redis, per the brief).
- [x] **Notion choices**: A9 BullMQ confirmed (R1); A18 Brevo decided; S10 open → production off by configuration, not assumed.

## Project Structure

### Documentation (this feature)

```text
specs/194-email-sending/
├── plan.md  research.md  data-model.md  quickstart.md  contracts/notifications.md
├── context.md  design.md  auto-run.md  notion-sync.md
└── tasks.md (next phase)
```

### Source Code (repository root)

```text
libs/domain/prisma/schema/notifications.prisma          # Notification model + enums (file exists, empty)
libs/domain/prisma/schema/auth.prisma                   # Account.emailBouncedAt, notifications relation
libs/domain/prisma/migrations/20261004180000_notifications/migration.sql   (new)
libs/domain/src/notifications/                           (new)
├── catalogue.ts            # NOTIFICATION_TYPES, channel choice
├── quiet-hours.ts          # isQuiet, nextMorning (Europe/Bucharest)
├── email-config.ts         # emailConfig(appEnv, env), allows(address)
├── messages.ts             # ro/en subject + text for TEST_MESSAGE, ACCOUNT_EMAIL, generic, grouped count
├── brevo.ts                # sendEmail, checkKey, BrevoError (retryable or not)
├── notifications.service.ts# notify, sendAccountEmail: rows, live publish, jobs
├── notifications.processor.ts # send / flush handlers, retry schedule, fallback
├── notifications.controller.ts # POST admin/notifications/test
├── brevo-webhook.controller.ts # POST webhooks/brevo
├── notifications.module.ts # register (api) / registerWorker (worker)
└── *.spec.ts, *.integration.spec.ts, brevo-mock.testing.ts
libs/domain/src/index.ts                                 # exports the module and service
libs/contracts/src/notifications.dto.ts  (new) + index.ts
apps/api/src/app.module.ts                               # registers NotificationsModule (api)
apps/worker/src/main.ts                                  # registers NotificationsModule (worker)
.env.example                                             # the six variables
package.json, package-lock.json                          # bullmq
apps/api/openapi.json, libs/data-access (generated)      # the two new routes
```

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| E-mail fallback seam with a no-op default (`EMAIL_FALLBACK` provider) | Build brief scenario 6: "the fallback hook runs; ST-196 plugs push into it"; feature rule 13 | Leaving it out makes scenario 6 untestable and moves a change into this module's retry path in ST-196; one provider and one call site is the smallest form |
| New dependency `bullmq` | delayed jobs, attempts with custom backoff, concurrency (FR-008/009/010/017) | hand-written Redis queue is far beyond 20 lines; A9 names BullMQ |
