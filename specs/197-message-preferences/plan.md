# Implementation Plan: Store each person's message choices and check them before sending

**Branch**: `197-message-preferences` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)

## Summary

Add the NOTIFICATION_PREFERENCE table to the notifications module of `libs/domain`, a pure rule file that turns a person's rows into the defaults, the group states and the set of muted channels, a preferences service with `GET`/`PUT /api/v1/notification-preferences`, and one change to `NotificationsService.notify`: read the recipient's rows for the type before the transaction and pass the muted channels to the existing `sendsEmail(type, muted)` (194-FR-004), which already never mutes an always-sent or transactional type.

## Technical Context

- **Language/Version**: TypeScript 5.9 (`package.json`), Node 24 (`.nvmrc`); NestJS 12 ESM (`libs/domain` tests run Jest with `--experimental-vm-modules`).
- **Primary Dependencies**: Prisma 7.10.0 with `@prisma/adapter-pg` (`package.json`), class-validator / `@nestjs/swagger` DTOs in `libs/contracts`, ioredis for the live publish (already in the module). No new dependency.
- **Storage**: PostgreSQL (PostGIS 17 in `docker-compose.yml`): one new table `notification_preference`, migration `20261005090000_notification_preferences`.
- **Testing**: Jest from the root preset (`jest.preset.cjs`); unit spec for the rules, `*.integration.spec.ts` for the service and the HTTP routes against real PostgreSQL and Redis (constitution II). No Playwright: no screen.
- **Target Platform**: the API (`apps/api`) and the worker (`apps/worker`), both through `NotificationsModule`.
- **Project Type**: Nx monorepo, library change plus the generated client.
- **Performance Goals**: one extra indexed read per recipient per message (`notification_preference (account_id, type)`).
- **Constraints**: the read happens before the send transaction, so a failing read never aborts the transaction (FR-010); per-account serialisation by `pg_advisory_xact_lock`, the pattern `NotificationsService.build` already uses (FR-008).
- **Scale/Scope**: ≈80 catalogue types; a driver has ≤ 37 grouped rows.

## Constitution Check

- **I. No bloated code**: no repository layer, no new interface; the rules are plain functions next to the catalogue; the existing `sendsEmail` is reused rather than replaced. No push-subscription default until ST-196 brings subscriptions.
- **II. Tests first, real services**: rules unit-tested; store, pipeline and HTTP tested against PostgreSQL and Redis.
- **Audit [27]**: every change goes through `AuditPort.record` inside the save transaction; `audit-coverage.spec.ts` keeps it true.
- **VII. Lifecycle**: draft PR #68 opened at start.

## Project Structure

### Documentation (this feature)

```
specs/197-message-preferences/
├── spec.md  plan.md  data-model.md  tasks.md  context.md  design.md
├── contracts/notification-preferences.md
├── auto-run.md  notion-sync.md
```

### Source Code (repository root)

```
libs/domain/prisma/schema/notifications.prisma          # + NotificationPreference
libs/domain/prisma/schema/{auth,garages}.prisma         # back-relations
libs/domain/prisma/migrations/20261005090000_notification_preferences/migration.sql
libs/domain/src/notifications/preferences.ts            # groups, defaults, muted channels (pure)
libs/domain/src/notifications/preferences.service.ts    # read, save, audit, live publish
libs/domain/src/notifications/preferences.controller.ts # GET/PUT notification-preferences
libs/domain/src/notifications/notifications.service.ts  # muted channels before the transaction
libs/domain/src/notifications/notifications.module.ts   # registers the two
libs/contracts/src/notification-preferences.dto.ts      # DTOs
apps/api/openapi.json, libs/data-access/src/lib/**      # regenerated
```

## Complexity Tracking

None.
