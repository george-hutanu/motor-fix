# Tasks: Invite a mechanic or receptionist to the garage

**Input**: `specs/131-invite-garage-staff/` (spec.md, plan.md, data-model.md, contracts/staff-invites.md, research.md, design.md)
**Tests**: required, written first and failing (Constitution II). API specs needing PostgreSQL/Redis are `*.integration.spec.ts`; specs are colocated; one Playwright flow in `apps/web-e2e`.
**Format**: `- [ ] Tnnn [P] [USn] Description with path (FRs)`. FRs are named here only, never in source.
**Deferred (not tasked)**: phone/WhatsApp invites, the pending move, the Team page, `on_profile`.

## Phase 1: Setup

- [X] T001 Add `StaffInvite`, `StaffInviteKind`, `StaffInviteStatus` and `Garage.invites` to `libs/domain/prisma/schema/garages.prisma` per data-model.md (`tokenHash` unique, index `(garageId, email)`, permissions default false, `expiresAt` timestamptz(3)); write migration `libs/domain/prisma/migrations/20261006120000_staff_invite/migration.sql` (new) (FR-001)
- [X] T002 [P] Write DTOs `StaffInviteDto` (name 2..80 trimmed, email max 254 trimmed, kind, three booleans default false), `StaffInviteSentDto`, `InviteTokenDto` (1..256), `InviteViewDto` in `libs/contracts/src/staff-invite.dto.ts` (new); export from `libs/contracts/src/index.ts`; add a DTO unit spec `libs/contracts/src/staff-invite.dto.spec.ts` (new) first (FR-001, FR-014)

## Phase 2: Foundational (blocks all stories)

- [X] T003 [P] Move `TOKEN_SHAPE` export to `libs/domain/src/auth/email-confirmation.ts` (import it in `libs/domain/src/auth/password-reset.service.ts`) and export `presented` from `libs/domain/src/auth/auth.controller.ts` (FR-006, FR-007) — not needed: the token is looked up by its hash (an unknown shape finds nothing) and accept answers 204, the web then switching the role, so neither export was made
- [X] T004 [P] Add `{ type: 'garage'; garageIds }` to `LiveSubject` in `libs/domain/src/events/audience.ts` with its unit spec in the colocated `audience` spec (FR-009, FR-010)
- [X] T005 [P] Write the failing template spec `libs/domain/src/notifications/templates/staff.spec.ts` (new), then add STAFF_INVITE and STAFF_JOINED in `libs/domain/src/notifications/templates/staff.ts` (new), registered in `libs/domain/src/notifications/templates/registry.ts`; Romanian and English, typed text escaped (FR-004, FR-009, FR-013)
- [X] T006 Scaffold `libs/domain/src/garages/garages.module.ts` (new, `GaragesModule.register({ webUrl, email }, notifications)`), export from `libs/domain/src/index.ts`, register in `apps/api/src/app.module.ts` (FR-014)

## Phase 3: User Story 1 - Owner invites by e-mail (P1)

**Independent test**: owner sends an invite; row stored, one STAFF_INVITE e-mail sent.

- [X] T007 [US1] Write failing `libs/domain/src/garages/staff-invite.api.integration.spec.ts` (new; one file holds T007, T012, T018, T020): 201 stored with kind and permissions, e-mail via `BrevoMock`, `emailSent:false` returns `link`, 403 receptionist/mechanic, 404 other owner, 409 `invite_open` and `already_in_team`, 400 validation, audit `invite_sent` without e-mail, outbox `invite.sent` (FR-001..004, FR-010; SC-001, SC-003, SC-006)
- [X] T008 [US1] Implement `send` in `libs/domain/src/garages/staff-invite.service.ts` (new) and `POST /api/v1/garages/:garageId/invites` in `libs/domain/src/garages/staff-invite.controller.ts` (new); owner decided in the service; transaction for row, audit and outbox, then Brevo send outside it (FR-001..004, FR-010)
- [X] T009 [P] [US1] Regenerate `apps/api/openapi.json` (`npx nx run api:openapi`) and `libs/data-access/src/lib` (`npx nx run data-access:generate`) (FR-014)
- [X] T010 [P] [US1] Write failing `apps/web/src/app/dashboard/invite-staff.spec.ts` (new) and `apps/web/src/app/dashboard/frame.invite.spec.ts` (new): button for owner only, permission ticks only for mechanic, field problems before send, "Nu am putut trimite invitația" with "Copiază linkul" (FR-011, FR-013)
- [X] T011 [US1] Implement the dialog task `apps/web/src/app/dashboard/invite-staff.ts` (new), the owner-only "Invită în echipă" button in `apps/web/src/app/dashboard/frame.ts`, texts in `libs/i18n/src/garage/{ro,en}.json` and `libs/i18n/src/shell/{ro,en}.json`; 320 px safe per design.md (FR-011, FR-013; SC-007)

## Phase 4: User Story 2 - Invitee accepts (P1)

**Independent test**: open a valid link signed out and signed in, accept; role, mechanic row, status, owner notification.

- [X] T012 [US2] Write failing `libs/domain/src/garages/staff-invite.accept.integration.spec.ts` (new): check answers view/`invite_expired`/`invite_invalid`; accept grants role keeping others, creates or moves the mechanic row, creates receptionist membership, 401 signed out, 410 for the owner or another garage's receptionist, concurrent accepts one wins, session in the invited role, STAFF_JOINED to the owner, audit `invite_accepted`, outbox `invite.accepted` and `mechanic.updated` on a move, role never taken from the body (FR-006..010; SC-003, SC-005, SC-006)
- [X] T013 [US2] Implement `check` and `accept` in `libs/domain/src/garages/staff-invite.service.ts` (`AccountsService.grantRole`, `SignInService.switchRole`, `NotificationsService.notify`) and `InvitesController` (`POST /api/v1/invites/check` public, `/accept`) in `libs/domain/src/garages/staff-invite.controller.ts` (FR-006..010)
- [X] T014 [P] [US2] Add `POST /api/v1/invites/check` to `apps/api/src/public-routes.integration.spec.ts`; regenerate `apps/api/openapi.json` and `libs/data-access/src/lib` (FR-006, FR-014)
- [X] T015 [P] [US2] Write failing web specs `apps/web/src/app/public/invite.spec.ts` (new), `apps/web/src/app/sign-in/sign-in-dialog.spec.ts` and `apps/web/src/app/dashboard/session.spec.ts`: page texts, signed out offers sign-in/sign-up with name and e-mail filled, sign-up accepts in the same flow, signed in accepts only on "Acceptă", invalid/expired message, markup-safe names (FR-012, FR-013)
- [X] T016 [US2] Implement `apps/web/src/app/public/invite.ts` (new), route `:lang/invite/:token` in `apps/web/src/app/app.routes.ts`, accept through `InvitesService.invitesControllerAccept` then `Session.switchRole(kind)` (no Session method needed), `AuthData.name` and `'signed-up'` in `apps/web/src/app/sign-in/sign-in.ts`, `sign-up.ts` and `sign-in-dialog.ts` (`join({ name, email })`), texts in `libs/i18n/src/public/{ro,en}.json` (FR-012, FR-013; SC-007)
- [X] T017 [US2] Write and pass the e2e flow `apps/web-e2e/src/staff-invite.spec.ts` (new): owner sends, mailbox link, new account accepts, lands on the garage dashboard as mechanic, the used link then reads invalid; the owner's live update is covered by the API integration spec (FR-011, FR-012, FR-009; SC-001, SC-002)

## Phase 5: User Story 3 - Resend and revoke (P2)

**Independent test**: resend and revoke through the API, then open each old link.

- [X] T018 [US3] Write failing `libs/domain/src/garages/staff-invite.resend-revoke.integration.spec.ts` (new): resend voids the old token, restarts the 7-day expiry (also when expired), revoke stops the link, 409 `invite_invalid` for accepted/revoked, 403/404 as send, audit `invite_resent`/`invite_revoked`, outbox `invite.revoked` (FR-002, FR-005, FR-010; SC-004, SC-006)
- [X] T019 [US3] Implement `resend` and `revoke` in `libs/domain/src/garages/staff-invite.service.ts` and the two routes in `libs/domain/src/garages/staff-invite.controller.ts`; regenerate `apps/api/openapi.json` and `libs/data-access/src/lib` (FR-005, FR-010)

## Phase 6: User Story 4 - Feature off (P2)

**Independent test**: `team_mechanics` off; send and open with each kind.

- [X] T020 [US4] Write failing `libs/domain/src/garages/staff-invite.feature.integration.spec.ts` (new): mechanic send 404 `feature_off`, receptionist still sent, check and accept of a mechanic invite 404 `feature_off`, missing row is on (FR-003, FR-006, FR-008; SC-003)
- [X] T021 [US4] Implement the `team_mechanics` check in `libs/domain/src/garages/staff-invite.service.ts` (send, check, accept) (FR-003, FR-006, FR-008)

## Phase 7: Cross-cutting

- [X] T022 Run `npm run typecheck`, `npm run lint`, the affected unit and integration suites, `node .claude/scripts/trace-matrix.mjs` and `npx nx run api:openapi` drift check; fix what is red (FR-014; SC-007)

## Dependencies

T001, T002 -> T003..T006 -> US1 (T007 -> T008 -> T009; T010 -> T011) -> US2 (T012 -> T013 -> T014; T015 -> T016 -> T017) -> US3, US4 (independent of each other, both extend the service) -> T022.
Parallel: T001/T002; T003..T005; T009/T010; T014/T015.

## Strategy

MVP is US1 plus US2 (one flow, SC-002). US3 and US4 add to the same service afterwards. Tests are written and seen failing before each implementation task.
