# Implementation Plan: Send SMS and WhatsApp through Brevo with the monthly SMS cap

**Branch**: `392-sms-whatsapp` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)

## Summary

Extend the notifications module of `libs/domain`: the Brevo client gains its SMS and WhatsApp calls; a pure routing function turns a type, the person's muted channels and what the recipient has (an address, a verified phone, the garage's `whatsapp` switch) into the outside rows to write; the service writes `sms` and `whatsapp` rows beside `email`; the worker sends them, takes the month's SMS from SMS_COUNTER in one atomic statement, and falls back SMS → WhatsApp → e-mail through one `fail` path. A phone config (switch, allowlist, senders, template ids) mirrors the e-mail config.

## Technical Context

- **Language/Version**: TypeScript 5.9 (`package.json`), Node 24 (`.nvmrc`); NestJS 12 ESM (`libs/domain` Jest runs with `--experimental-vm-modules`).
- **Primary Dependencies**: Prisma 7.10.0 with `@prisma/adapter-pg`, BullMQ and ioredis (already in `notifications.module.ts`), `fetch` for Brevo (no SDK, as in `brevo.ts`). No new dependency.
- **Storage**: PostgreSQL: tables `sms_counter` (primary key account, month) and `garage_feature` (primary key garage, key), migration `20261005120000_sms_whatsapp`.
- **Testing**: Jest from `jest.preset.cjs`; unit specs for the routing, the month and the config; the Brevo adapter against the recorded mock (`brevo-mock.testing.ts`); `*.integration.spec.ts` for the worker against PostgreSQL, Redis and the mock (constitution II). No Playwright: no screen and no reminder job yet.
- **Target Platform**: the worker (`apps/worker`) sends; the API (`apps/api`) builds the rows and saves preferences.
- **Constraints**: the SMS count is taken before the Brevo call so concurrent sends cannot pass the cap, and given back when the SMS fails (FR-003); the month is Europe/Bucharest, read with `Intl` as `quiet-hours.ts` does.

## Constitution Check

- **I. No bloated code**: no reset job and no Redis cache for the count (a month-keyed row needs neither); no channel-adapter interface (two methods on the existing Brevo client); the garage switch is one table read, no garage-features service.
- **II. Tests first, real services**: unit for the pure parts, integration against PostgreSQL, Redis and the Brevo mock for the worker.
- **VII. Lifecycle**: draft PR #73 opened at start.

## Project Structure

### Documentation (this feature)

```
specs/392-sms-whatsapp/
├── spec.md  plan.md  tasks.md  design.md  auto-run.md  notion-sync.md
```

### Source Code (repository root)

```
libs/domain/prisma/schema/notifications.prisma      # + SmsCounter
libs/domain/prisma/schema/garages.prisma            # + GarageFeature
libs/domain/prisma/schema/auth.prisma               # back-relation
libs/domain/prisma/migrations/20261005120000_sms_whatsapp/migration.sql
libs/domain/src/notifications/brevo.ts              # sendSms, sendWhatsApp
libs/domain/src/notifications/phone-config.ts       # PHONE_* config, allowlist
libs/domain/src/notifications/sms-counter.ts        # month, take, give back
libs/domain/src/notifications/routing.ts            # outside channels per recipient
libs/domain/src/notifications/notifications.service.ts   # sms/whatsapp rows, fallback chain
libs/domain/src/notifications/notifications.processor.ts # phone sends
libs/domain/src/notifications/preferences.ts        # staff WhatsApp off until chosen
libs/domain/src/notifications/preferences.service.ts# SMS for drivers only
libs/domain/src/notifications/templates/due-itp.ts  # SMS and WhatsApp texts
apps/worker/src/main.ts, .env.example               # phone config
```

## Complexity Tracking

None.
