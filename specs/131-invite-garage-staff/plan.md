# Implementation Plan: Invite a mechanic or receptionist to the garage

**Branch**: `131-invite-garage-staff` | **Date**: 2026-10-06 | **Spec**: specs/131-invite-garage-staff/spec.md

## Summary

One new table, `staff_invite`, in the garages module (its first NestJS module, `libs/domain/src/garages/`), holding one row per garage and invited address with the invite's kind, the three permissions, the SHA-256 of a single-use token and a 7-day expiry; `expired` is derived, never written. Five REST calls: the owner sends, resends and revokes under `/api/v1/garages/:garageId/invites`; anyone opens a link through the public `POST /api/v1/invites/check`, and a signed-in account accepts through `POST /api/v1/invites/accept`, whose answer is a session in the invited role, issued through the existing role switch. The STAFF_INVITE e-mail is rendered with the notifications templates and sent to the invited address within the request, through the API's own `Brevo` client, because the notifications queue addresses accounts only and the invitee may have none; the answer says whether it went out and carries the link only when it did not. Accepting grants the role through `AccountsService.grantRole`, creates or moves the mechanic row or creates the receptionist membership, audits, records `invite.accepted` (and `mechanic.updated` on a move) in the outbox with the garages as audience, then notifies the owner with STAFF_JOINED through `NotificationsService.notify`. The web app adds the "Invită în echipă" task to the garage frame (owner only) and the acceptance page at `/{lang}/invite/:token`, modelled on the reset-password page: Home with the sign-in/sign-up dialog over it, the invited name and e-mail filled in.

## Technical Context

**Language/Version**: TypeScript 6.0.3, Node 24 (`.nvmrc`), Angular 22.2.1 standalone + signals (`apps/web`), NestJS 12.1.2 ESM (`libs/domain`, `apps/api`) — all from the root `package.json` and `package-lock.json`
**Primary Dependencies**: existing only — Prisma 7.10.0 (`libs/domain/prisma/schema/garages.prisma`, migrations under `libs/domain/prisma/migrations/`), class-validator 0.15.1 + class-transformer 0.5.1 (`libs/contracts`), @nestjs/swagger 12.0.2 (OpenAPI), ng-openapi-gen 1.1.0 (`libs/data-access`, target `generate`), @spartan-ng/brain 1.5.0 + `@motor-fix/ui-cockpit` helm, `@motor-fix/overlays` (`Overlays.open`, `taskSave`), `@motor-fix/i18n`; the notifications module's `Brevo` client (`libs/domain/src/notifications/brevo.ts`, plain `fetch`) and `render` (`templates.ts`)
**Storage**: PostgreSQL — new `staff_invite`; existing `mechanic` (update on a move), `garage_member`, `account_role`, `activity_log`, `outbox_event`, `notification`; Redis only through the existing live channel and the notifications queue (nothing new in Redis)
**Testing**: Jest 30.5.2 from `jest.preset.cjs` (`*.integration.spec.ts` against PostgreSQL + Redis, `JEST_SUITE`), supertest 7.3.1 for the API, `BrevoMock` (`libs/domain/src/notifications/brevo-mock.testing.ts`) for the send, Playwright 1.63.0 in `apps/web-e2e` (nodenext: `.js` on relative imports) with the test mailbox (`apps/web-e2e/mailbox.mjs`, `BREVO_API_URL=http://127.0.0.1:3025/v3` in `.github/workflows/ci.yml`)
**Target Platform**: API on Railway; web SSR + browser
**Project Type**: Nx monorepo, web application (`apps/web`, `apps/api`, libs)
**Performance Goals**: none specific; the send waits for Brevo within the request (its client times out at 10 s)
**Constraints** (`context.md`): module `garages` owns STAFF_INVITE; `notifications` the messages; `audit` the history; events `invite.sent`, `invite.accepted`, `invite.revoked`, `mechanic.updated` (all already in `libs/contracts/src/events.ts`); the invite cannot be turned off; every message in the person's language; no new dependency
**Scale/Scope**: one table, one migration, one NestJS module (service, controller, module), two DTO files, two templates, one web task, one public page, one e2e flow

## Constitution Check

- [x] **I. No Bloat**: no `on_profile`, `phone`, `move_pending` or `mechanic_id` column (deferred in the spec; a mechanic row is "on the profile" until the hiding story adds the flag); no sweep job (`expired` is derived); one invite row per address, resent in place; the token helpers (`newToken`, `hashToken`), `AccountsService.grantRole`, `SignInService.switchRole`, `keep`, `AuditService`, the outbox, `render` and `Brevo` are reused, not copied. The one new module is the garages module the architecture names, and it exists because the service needs `NotificationsService`, which imports the `AuthModule` (the same reason `PasswordResetModule` is apart).
- [x] **II. Test Discipline**: `/speckit-tests` writes the API integration specs (every "may not" of SC-003, resend/revoke, move, feature off, audit and outbox), the template and DTO unit specs, the web unit specs and the e2e flow before the code.
- [x] **III. The Given Stack**: Angular + Spartan/helm, NestJS, PostgreSQL, Redis; no new front-end dependency.
- [x] **IV. One Repository, One Toolchain**: everything in `libs/domain`, `libs/contracts`, `apps/api`, `apps/web`, `apps/web-e2e`; Biome, root Jest.
- [x] **V. Rules Live in One Place**: DTOs in `libs/contracts` validated at the edge, OpenAPI from the decorators, the web calls the generated client; who may send is decided in the service (403 for the garage's own staff, 404 for everyone else, FR-002), not in a decorator that answers 404 for both.
- [x] **VI. PostgreSQL Is the Truth**: the invite, its status and the role live in PostgreSQL; `invite.*` and `mechanic.updated` go to `outbox_event` in the change's transaction; the live update on `garage:{garageId}` is the relay's publication of those events.
- [x] **Notion choices**: 7-day validity, one open invite per address, error codes, the dialog on the frame and the acceptance page over Home are the Build brief's *proposed* choices recorded in `spec.md` Assumptions; no T1–T10 item is touched.

## Project Structure

### Documentation (this feature)

```text
specs/131-invite-garage-staff/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/staff-invites.md
└── tasks.md              # /speckit-tasks
```

### Source Code (repository root)

```text
libs/domain/prisma/schema/garages.prisma                   StaffInvite, StaffInviteKind, StaffInviteStatus; Garage.invites
libs/domain/prisma/migrations/20261006120000_staff_invite/ CREATE TYPE ×2, CREATE TABLE staff_invite (new)
libs/domain/src/auth/email-confirmation.ts                 export TOKEN_SHAPE (moved from password-reset.service.ts)
libs/domain/src/auth/auth.controller.ts                    export `presented` (the refresh cookie the accept answer renews)
libs/domain/src/garages/staff-invite.service.ts            send, resend, revoke, check, accept (new)
libs/domain/src/garages/staff-invite.controller.ts         GarageInvitesController, InvitesController (new)
libs/domain/src/garages/garages.module.ts                  GaragesModule.register({ webUrl, email }, notifications) (new)
libs/domain/src/events/audience.ts                         LiveSubject += { type: 'garage'; garageIds }
libs/domain/src/notifications/templates/staff.ts           STAFF_INVITE, STAFF_JOINED (new)
libs/domain/src/notifications/templates/registry.ts        register both
libs/domain/src/index.ts                                   export GaragesModule
libs/contracts/src/staff-invite.dto.ts                     StaffInviteDto, StaffInviteSentDto, InviteTokenDto, InviteViewDto (new)
libs/contracts/src/index.ts                                export it
apps/api/src/app.module.ts                                 GaragesModule.register({ webUrl: email.webUrl, email }, notifications)
apps/api/src/public-routes.integration.spec.ts             + POST /api/v1/invites/check
apps/api/openapi.json, libs/data-access/src/lib            regenerated (npx nx run api:openapi; npx nx run data-access:generate)
apps/web/src/app/dashboard/frame.ts                        "Invită în echipă" button, owner only (capability garage.team)
apps/web/src/app/dashboard/invite-staff.ts                 the dialog task (new)
apps/web/src/app/dashboard/session.ts                      acceptInvite(token)
apps/web/src/app/sign-in/sign-in.ts                        AuthData += name; Answer += 'signed-up'
apps/web/src/app/sign-in/sign-up.ts                        name filled in; closes 'signed-up'
apps/web/src/app/sign-in/sign-in-dialog.ts                 join({ name, email }) → 'signed-in' | 'signed-up' | null
apps/web/src/app/public/invite.ts                          the acceptance page over Home (new)
apps/web/src/app/app.routes.ts                             :lang/invite/:token
libs/i18n/src/garage/{ro,en}.json                          the dialog's texts (first entries of the garage area)
libs/i18n/src/public/{ro,en}.json                          the acceptance page's texts
libs/i18n/src/shell/{ro,en}.json                           the frame's button label
apps/web-e2e/src/staff-invite.spec.ts                      owner → mailbox link → new account → garage dashboard as mechanic (new)
```

**Structure Decision**: the Nx layout AGENTS.md fixes. The garages module is created by this story because it is the first to need it (AGENTS.md: a lib or module is created by the story that first needs it); the web pieces follow the reset-password split (a task under `sign-in/` or `dashboard/`, a public page under `public/`).

## Complexity Tracking

| Choice | Why | Simpler option rejected |
| --- | --- | --- |
| A `GaragesModule` apart from the `AuthModule` | The service needs `NotificationsService` (STAFF_JOINED), and the notifications module imports the `AuthModule`; the architecture names `garages` as the invite's owner | Routes in the auth module (circular import); a second global module (nothing else needs its service) |
| The invite e-mail sent by the API through `Brevo`, not `notify` | `notify` writes `notification` rows keyed by `account_id` and reads the address from the account; the invitee may have no account. One path for every invitee, and `emailSent` is honest | Queue when an account exists, send directly otherwise (two paths); a nullable `account_id` plus an `email` column on `notification` (a schema change in another module for one message) |
| A `check` call besides `accept` | FR-006: the page names the garage and the role before any sign-in, and shows the invalid/expired message without a session | Only `accept` (the page would have to sign the person in to learn the link is dead) |
| Accept answers 204; the web then calls the role switch | FR-007: the session switches to the invited role; `switchRole` already renews the family, sets `lastRole` and answers a `SessionDto`, and keeping it a separate call lets a failed switch be retried without accepting again | Accept answering the role switch's `SessionDto` (couples the two, so a switch failure looks like a failed accept); a bare access token (would leave `lastRole` behind) |
