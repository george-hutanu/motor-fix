# Implementation Plan: Set up push notifications

**Branch**: `196-push-notifications` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/196-push-notifications/spec.md`

## Summary

Push becomes a real channel of the notifications pipeline built by ST-194/195/197/392. A `push_subscription` table holds each browser that allowed push; four signed-in routes save, delete and test it and hand the browser the server's public key. Routing writes a push row when the person has a device, the worker sends it to every device with the Web Push protocol (VAPID, through the `web-push` package), deletes devices that are gone and falls back to e-mail; a failed e-mail falls back to push. The web app gets one panel (driver and admin Setări, garage home) that drives Angular's `SwPush`; Angular's own service worker shows the push and opens its link. Research: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json`), Node 24 (`.nvmrc`)

**Primary Dependencies**: NestJS 12.1.2, Prisma 7.10.0, bullmq 6.3.11, Angular 22.2.1 with `@angular/service-worker` 22.2.1 (`package.json`); new: `web-push` 3.6.7 (MPL-2.0) and `@types/web-push` 3.6.4 (R1)

**Storage**: PostgreSQL, new table `push_subscription` (migration `libs/domain/prisma/migrations/20261005170000_push_subscription`); the `notification_channel` enum already has `push`

**Testing**: Jest 30.5.2 from `jest.preset.cjs`; unit specs colocated; `*.integration.spec.ts` against real PostgreSQL and Redis; the push service replaced by a recording HTTP server started in the test, reached by the real `web-push` client with real keys (R4); web specs with a fake `SwPush`; Playwright 1.63.0 for the panel at 320 px

**Target Platform**: Railway (`apps/api`, `apps/worker`), the installable web app (`apps/web`, ngsw)

**Project Type**: web service + web app (Nx monorepo)

**Performance Goals**: a push not held for quiet hours reaches the push service within 60 s (SC-001); per-device request timeout 10 s

**Constraints**: permission asked only after a tap (context.md Constraints); one push row whatever the device count (ST-196 scenario 7); retries 1/5/15/60/240 min (ST-194); iPhone push only from an installed app, iOS 16.4+; push off when `VAPID_*` are unset (FR-018); no personal data in logs

**Scale/Scope**: launch volume; a handful of devices per person

## Constitution Check

- [x] **I. No Bloat**: one table, one config reader, one thin sender class over `web-push`, one panel, one browser service. No custom service worker: ngsw already shows pushes and handles the tap (R2). The `EMAIL_FALLBACK` seam is replaced by the real e-mail → push rule, so it disappears instead of gaining an implementation (R5). One new dependency, justified in R1 / Complexity Tracking.
- [x] **II. Test Discipline**: red tests first for every FR (tasks.md maps them); API and processor specs against real PostgreSQL and Redis; Playwright for the panel.
- [x] **III. The Given Stack**: NestJS, PostgreSQL, Redis, Angular + Cockpit/Spartan components; `web-push` is a server-side MPL-2.0 package (no licence key).
- [x] **IV. One Repository, One Toolchain**: code in `libs/domain`, `libs/contracts`, `libs/i18n`, `apps/web`; generated client regenerated from `apps/api/openapi.json`.
- [x] **V. Rules Live in One Place**: DTOs in `libs/contracts` validated at the edge; routing and fallback stay in `routing.ts` / `NotificationsService`; the device's owner checked on the server.
- [x] **VI. PostgreSQL Is the Truth**: devices and rows in PostgreSQL before any job. Saving a device is delivery data, not a domain change anyone is told about live: no outbox event and no audit (Build brief › Data).
- [x] **Notion choices**: A18 (Web Push, Brevo) — the brief's open question "VAPID through Brevo or direct" answered direct (R1; Brevo has no browser Web Push API), recorded as a decision for the owner; A19 installable web app.

## Design

### Server (`libs/domain/src/notifications`)

- `push-config.ts`: `pushConfig(source)` → `PushConfig | null` (`publicKey`, `privateKey`, `subject`); all three unset → `null`; some set, or a subject that is not `mailto:`/`https:` → throws at boot.
- `push.ts`: `PushSender` wraps `web-push` `sendNotification` with the VAPID details, TTL 86 400 s, `Urgency` `high`/`normal`, 10 s timeout; answers `'sent' | 'gone' | 'retry' | 'refused'` per device (404/410 gone; network, 429, 5xx retry; any other status refused). `pushPayload(text, icon)` builds ngsw's `{ notification: { title, body, icon, data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url } } } } }`.
- `push-subscriptions.service.ts` + `push-subscriptions.controller.ts`: `GET /push-subscriptions/key`, `POST /push-subscriptions`, `DELETE /push-subscriptions/:id`, `POST /push-subscriptions/test` (contracts in [contracts/push-subscriptions.md](./contracts/push-subscriptions.md)). Save upserts by endpoint in one transaction: same account → keys and label replaced, same id; other account → its row deleted and a new one created.
- `routing.ts`: `Reach` gains `push`; `SentChannel` gains `'push'`. Push not muted and reachable → `push`; not reachable → `email` for a driver type whose channels include e-mail, nothing for a staff type (its own e-mail entry decides).
- `notifications.service.ts`: constructor's `EMAIL_FALLBACK` slot becomes `PUSH_CONFIG` (`PushConfig | null`). `build` counts the account's devices when push is configured; `pushRow` = `phoneRow` (held at night unless urgent, never grouped). `NEXT` gains `email: 'push'` and `push: 'email'`; `fail` skips the fallback for an e-mail or push row that is itself a fallback; `fallBack(row, 'push')` also needs configured push and a device. `sendPushTest(accountId)` notifies `PUSH_TEST`.
- `notifications.processor.ts`: `sendPush(row)` — no config → `push_off`; template error → `template_failed`; no device → `no_device`; then every device in parallel: `sent` stamps the device's `lastSuccessAt`, `gone` deletes it. Any `sent` → row `sent`; else a `retry` with attempts left → throw (BullMQ backoff); else fail with the first reason, falling back.
- `catalogue.ts`: `TEST_MESSAGE` channels `['email', 'push']`; new `PUSH_TEST: ['direct', ['push'], null, 'transactional']`. Templates: push text on `TEST_MESSAGE`, new `PUSH_TEST` (bell + push).
- `notifications.module.ts`: `push?: PushConfig | null` option (default `null`, so existing callers are unchanged); API registers the controller and service; worker provides `PushSender` when configured.
- `auth/sign-in.service.ts`: `signOutEverywhere` deletes the account's `push_subscription` rows in its transaction.
- `apps/api/src/app.module.ts`, `apps/worker/src/main.ts`: `push: pushConfig(process.env)`; `.env.example` documents `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and `npx web-push generate-vapid-keys`.

### Web (`apps/web/src/app/dashboard`)

- `push-support.ts`: `pushSupport(env)` → `'ios-hint' | 'unsupported' | 'supported'` from the user agent, touch points, standalone display mode and `PushManager` (FR-021).
- `push-device.ts` (`PushDevice`, root): reads the key once, `enable()` (permission prompt via `SwPush.requestSubscription`, then save), `disable()` (delete + unsubscribe), `test()`, `refresh()` on frame start (FR-017), `forget()` before sign-out (FR-016); a `state` signal: `unavailable | ios-hint | unsupported | blocked | off | on | busy` plus an error flag.
- `push-panel.ts` (`mf-push-panel`): the Cockpit card of design.md, one column, full-width buttons under 390 px.
- `push-view.ts`: the placeholder view plus the panel; `views.ts` marks driver and admin `settings` and the garage home `push: true`, and `dashboardRoutes` uses `PushView` for them (FR-006).
- `frame.ts`: `refresh()` in `ngOnInit`; `forget()` before both sign-outs.
- Texts in `libs/i18n/src/shell/{ro,en}.json` under `shell.push.*`.

## Project Structure

### Documentation (this feature)

```text
specs/196-push-notifications/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/push-subscriptions.md
├── spec.md  design.md  context.md  tasks.md
```

### Source Code (repository root)

```text
libs/contracts/src/push-subscriptions.dto.ts
libs/domain/prisma/schema/notifications.prisma        # PushSubscription
libs/domain/prisma/schema/auth.prisma                 # Account.pushSubscriptions
libs/domain/prisma/migrations/20261005170000_push_subscription/
libs/domain/src/notifications/{push-config,push,push-subscriptions.service,push-subscriptions.controller}.ts
libs/domain/src/notifications/{routing,catalogue,notifications.service,notifications.processor,notifications.module}.ts
libs/domain/src/notifications/templates/{test-message,push-test,registry}.ts
libs/domain/src/auth/sign-in.service.ts
apps/api/src/app.module.ts  apps/worker/src/main.ts  apps/api/openapi.json  .env.example
libs/data-access/src/lib/**                           # regenerated
apps/web/src/app/dashboard/{push-support,push-device,push-panel,push-view,views,frame}.ts
libs/i18n/src/shell/{ro,en}.json
apps/web-e2e/src/push.spec.ts
```

**Structure Decision**: everything inside the existing notifications module and dashboard folder; no new lib.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| New dependency `web-push` | Web Push needs RFC 8291 payload encryption (ECDH + HKDF + aes128gcm) and an RFC 8292 VAPID JWT per request | Hand-writing both is ~200 lines of crypto to own and test; Brevo has no browser Web Push API (R1) |
