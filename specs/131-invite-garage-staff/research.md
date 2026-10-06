# Research: invite a mechanic or receptionist

No NEEDS CLARIFICATION was left in Technical Context; the decisions below are the ones the code had to settle, each read from the repository.

## Where the invite lives
- Decision: a `StaffInvite` model in `garages.prisma`, in a new `libs/domain/src/garages/` NestJS module (`GaragesModule.register({ webUrl, email }, notifications)`), registered in `apps/api/src/app.module.ts` next to `PasswordResetModule`.
- Rationale: `context.md` Constraints: module `garages` owns STAFF_INVITE; the service needs `NotificationsService` (STAFF_JOINED), and `NotificationsModule.register` imports the `AuthModule`, so the auth module cannot hold it.
- Alternatives: routes in the auth module (circular import); the `account_token` table (its `account_id` is required and the invitee may have no account).
- Evidence: `libs/domain/src/notifications/notifications.module.ts:104-106` (`imports: [auth]`); `libs/domain/src/auth/password-reset.module.ts:11-13`; `libs/domain/prisma/schema/auth.prisma` (`AccountToken.accountId String`, not optional).

## Token, hash and expiry
- Decision: `newToken()` / `hashToken()` from `email-confirmation.ts` (32 random bytes, base64url, SHA-256 kept); `TOKEN_SHAPE` (`/^[A-Za-z0-9_-]{43}$/`) moved there from `password-reset.service.ts` and shared; expiry 7 days from send or resend; resend writes a new hash on the same row, which voids the old link.
- Rationale: FR-001, FR-005; the same helpers the two link features use (Principle I).
- Evidence: `libs/domain/src/auth/email-confirmation.ts:9-16`; `libs/domain/src/auth/password-reset.service.ts:34`.

## `expired` is derived
- Decision: status enum `sent | accepted | revoked`; a `sent` row with `expiresAt <= now` reads as expired (`invite_expired` on check, not counted as open at send, resendable).
- Rationale: spec Clarifications (no sweep job).
- Evidence: `specs/131-invite-garage-staff/spec.md` FR-001, FR-005.

## Sending the e-mail
- Decision: the API renders `STAFF_INVITE` with `render('STAFF_INVITE', 'email', language, { garage, link, name })` and sends it within the request through its own `Brevo` instance built from the `EmailConfig` the API already holds (`emailConfig(env.APP_ENV, process.env)` in `app.module.ts`), after `blockedReason(config, email)`; a blocked or refused send leaves the invite `sent` and answers `{ emailSent: false, link }`. Language: the owner's account language (FR-004).
- Rationale: `notify` loops over account ids and reads the address from `account` inside `build`, so an address without an account cannot be queued; the spec asks for the send in the request with an honest answer. In CI the e2e job points `BREVO_API_URL` at the test mailbox and allowlists `@example.test`, so the e2e reads the link as `password-reset.spec.ts` does.
- Alternatives: queueing through `notify` when an account exists (two paths); a `notification.email` column (another module's schema for one message).
- Evidence: `libs/domain/src/notifications/notifications.service.ts:112-128, 338-350`; `libs/domain/src/notifications/brevo.ts:42-58`; `libs/domain/src/notifications/email-config.ts:38-68`; `.github/workflows/ci.yml:131-138`; `apps/web-e2e/src/password-reset.spec.ts:10-35`.

## Templates
- Decision: `templates/staff.ts` with `STAFF_INVITE` (audience `any`; values `garage: text`, `name: text`, `link: link`; e-mail only, button "Acceptă invitația") and `STAFF_JOINED` (audience `garage`; value `name: text`; bell and e-mail, button `app`), both in `registry.ts`. No role word in STAFF_JOINED's text: a template cannot translate a value.
- Rationale: `catalogue.ts` already lists both kinds; `template-check` renders every registered template in both languages with its `example`.
- Evidence: `libs/domain/src/notifications/catalogue.ts:117-118`; `libs/domain/src/notifications/templates/registry.ts`; `libs/domain/src/notifications/templates.ts:80-81` (`app` built in).

## Who may send, resend, revoke
- Decision: in the service: `actor.role === 'garage' && actor.garageId === garageId` passes; `actor.garageId === garageId` with another role answers 403 `forbidden`; everything else 404. No `@Requires`.
- Rationale: FR-002 distinguishes 403 (the garage's own staff) from 404 (anyone else); `requireCapability` answers 404 for both.
- Evidence: `libs/domain/src/auth/policy.ts:44-54`; `libs/domain/src/auth/actor.guard.ts:86-94` (`garageId` from the membership or the mechanic row).

## Refusals at send
- Decision: 409 `invite_open` (a `sent`, unexpired invite for the address; the body carries `inviteId` so the dialog can offer "Trimite din nou"), 409 `already_in_team` (the address's account already holds the invited kind here, or owns this garage), 404 `feature_off` (mechanic kind while `garage_feature('team_mechanics').enabled = false`); the send takes `pg_advisory_xact_lock(hashtext('invite:' + garageId + ':' + email))` so two sends at once cannot both pass.
- Evidence: `libs/domain/src/auth/email-confirmation.service.ts:79`; `libs/domain/src/notifications/notifications.service.ts:293-297` (feature read; a missing row is on); `libs/domain/prisma/schema/garages.prisma` (`GarageFeature`).

## Accepting
- Decision: `POST /api/v1/invites/accept { token }` with a session. In one transaction: `updateMany({ where: { id, status: 'sent' }, data: { status: 'accepted' } })` (count 0 → `invite_invalid`); refusals (owner of this garage; receptionist invite while receptionist elsewhere; `team_mechanics` off → the row is not changed: the status update comes after the checks); `AccountsService.grantRole(tx, by, accountId, kind)`; mechanic: `mechanic.upsert` by `accountId` (create with the invite's permissions, or update `garageId` + permissions — the move); receptionist: `garageMember.create({ role: 'receptionist' })` unless already there; audit `invite_accepted`; outbox `invite.accepted` (audience the garage) and, on a move, `mechanic.updated` (audience both garages). After the commit: `notify({ kind: 'STAFF_JOINED', recipients: [ownerAccountId], garageId, params: { name }, eventId: inviteId })`; then `SignInService.switchRole(presented(req), kind)` and `keep(res, issued)` answer the `SessionDto`.
- Rationale: FR-007 to FR-010; `grantRole` already audits the role; `switchRole` sets `lastRole` and renews the family, so a refresh keeps the new role; the live update on `garage:{id}` is the relay's publication of the outbox rows.
- Alternatives: a bare `signAccessToken` (leaves `lastRole`); a Redis publish from the API (the outbox already reaches the hub through the worker).
- Evidence: `libs/domain/src/auth/accounts.service.ts:137-158`; `libs/domain/src/auth/sign-in.service.ts:134-146`; `libs/domain/src/auth/auth.controller.ts:49-63, 177-178`; `libs/domain/src/events/event.port.ts:24-36`; `libs/domain/src/events/audience.ts`; `libs/domain/prisma/schema/garages.prisma` (`Mechanic.accountId @unique`, `GarageMember @@unique([accountId, role])`).

## Audience for garage events
- Decision: add `{ type: 'garage'; garageIds: readonly string[] }` to `LiveSubject`, mapped to `garage:{id}` per garage.
- Rationale: no existing subject yields only a garage's channel; `verification` adds `admin`.
- Evidence: `libs/domain/src/events/audience.ts:1-16, 23-66`; `libs/domain/src/events/garage-access.ts` (owners, receptionists and mechanics of the garage hear `garage:{id}`).

## No `on_profile` column
- Decision: none. The spec's "on_profile true" is met by the mechanic row existing; the story that lets a mechanic hide adds the flag.
- Rationale: Principle I (a column no code reads); `Mechanic` has no such field today.
- Evidence: `libs/domain/prisma/schema/garages.prisma` (`Mechanic`).

## Web: dialog and acceptance page
- Decision: the dialog is an overlays task (`Overlays.open(InviteStaff, { shape: 'dialog', title })`, `taskSave` for the form; a bottom sheet on a phone by the library's rule) opened from a button in the frame shown when `session.current()?.role === 'garage'` and `capabilities` holds `garage.team`; its texts in the `garage` area (`i18n.enter('garage')`, today `{}`); the done state shows "Copiază linkul" (`navigator.clipboard.writeText`) when `emailSent` is false. The acceptance page `public/invite.ts` is `<mf-home />` plus a panel: it calls `check`, shows the garage and the role, and "Acceptă": signed in → `session.acceptInvite(token)` then `router.navigateByUrl(me.landing)`; signed out → `SignInDialog.join({ name, email })`, which opens the sign-up task with both fields filled in and resolves `'signed-up'` (accept at once) or `'signed-in'` (show "Acceptă" again). An invalid or expired link shows one message.
- Rationale: FR-011, FR-012 and the spec Clarifications; the reset-password page and the sign-in dialog already carry the shape.
- Evidence: `apps/web/src/app/public/reset-password.ts`; `apps/web/src/app/sign-in/sign-in-dialog.ts:47-60, 79-106`; `apps/web/src/app/sign-in/sign-up.ts:167-175` (`email` from `task.data`, `name` empty today); `apps/web/src/app/dashboard/session.ts:191-217` (`switchRole` consumes a `SessionDto`); `apps/web/src/app/dashboard/frame.ts:116-126`; `libs/overlays/src/index.ts`.

## Landing after acceptance
- Decision: the answer's role is `mechanic` or `receptionist`; `landingFor` gives `/app/garage` for both, and `areaGuard('garage')` admits them, so `navigateByUrl(me.landing)` opens the existing garage frame.
- Evidence: `libs/domain/src/auth/policy.ts:36-40`; `apps/web/src/app/dashboard/area.guard.ts`.
