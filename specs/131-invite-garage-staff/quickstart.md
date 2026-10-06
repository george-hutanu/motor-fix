# Quickstart: invite a mechanic or receptionist

```bash
# PostgreSQL and Redis running; .env from .env.example with DATABASE_URL, REDIS_URL,
# AUTH_TOKEN_SECRET, PUBLIC_WEB_URL=http://localhost:4200
npx prisma migrate deploy --config libs/domain/prisma.config.ts
npx nx run domain:seed                       # service@example.test owns atelier-test
# the invite e-mail lands in the test mailbox when these are set (as in CI):
#   EMAIL_SENDING=on EMAIL_ALLOWLIST=@example.test EMAIL_FROM='MotorFix <noreply@example.test>'
#   BREVO_API_KEY=e2e-mailbox-key BREVO_API_URL=http://127.0.0.1:3025/v3
npx nx run web-e2e:mailbox & npx nx run api:serve & npx nx run web:serve
```

## Scenarios

1. **Send** (US1): sign in at http://localhost:4200/ro as `service@example.test`; on the garage frame press "Invită în echipă"; name "Elena Stan", e-mail `elena@example.test`, kind mecanic, ticks unticked; "Trimite invitația". Expect the dialog's sent state; `GET http://127.0.0.1:3025/messages?to=elena@example.test` holds one e-mail with a `/ro/invite/<43 chars>` link; `staff_invite` holds one row, status `sent`, all permissions false, `expires_at` 7 days ahead; `activity_log` has `invite_sent`; `outbox_event` has `invite.sent`.
2. **E-mail refused** (US1 scenario 4): with `EMAIL_SENDING=off`, send again to another address: the dialog shows "Nu am putut trimite invitația" with "Copiază linkul"; the copied link opens the acceptance page.
3. **Second open invite** (US1 scenario 3): send to `elena@example.test` again: "o invitație este deja deschisă" with "Trimite din nou"; pressing it sends a new link and the first link now answers `invite_invalid`.
4. **Accept, new account** (US2): open the link in a private window: "Atelier Test te invită să te alături echipei ca mecanic." and the public-profile line; "Acceptă" opens sign-up with name and e-mail filled in; create the account (terms ticked). Expect the garage dashboard, `GET /api/v1/me` → `role: mechanic`, `garageId` = atelier-test; the owner's open dashboard receives the live update; the owner's bell shows STAFF_JOINED.
5. **Accept, existing driver** (US2 scenario 2): invite `sofer@example.test`, open the link signed out, sign in from it, press "Acceptă": roles are `driver` and `mechanic`, the frame offers both chips.
6. **Move** (US2 scenario 6): as the owner of `service-dobre` (`doua-roluri@example.test`) invite `mecanic@example.test`; accept signed in as the mechanic: the `mechanic` row now points at service-dobre with the new permissions; `mechanic.updated` is in the outbox with both garages in its audience.
7. **Revoke and stale links** (US3): revoke through the API (`POST /api/v1/garages/<id>/invites/<id>/revoke`, bearer owner): the link shows "Invitația nu mai este valabilă. Cere service-ului una nouă."; an accepted link shows the same; a row with `expires_at` set in the past answers `invite_expired` and shows the same.
8. **Feature off** (US4): `INSERT INTO garage_feature VALUES (<atelier-test>, 'team_mechanics', false)`: the dialog offers receptionist only; a mechanic send answers 404 `feature_off`; a mechanic link sent before answers 404 `feature_off` on check and accept.
9. **Who may not** (SC-003): `receptie@example.test` and `mecanic@example.test` get 403 on send; `doua-roluri@example.test` (another garage's owner) gets 404 for atelier-test.

## Tests

```bash
scripts/heavy.sh npx jest libs/domain/src/garages libs/domain/src/notifications/templates libs/contracts/src/staff-invite --maxWorkers=2   # PostgreSQL + Redis
scripts/heavy.sh npx jest apps/web/src/app/dashboard/invite-staff apps/web/src/app/public/invite apps/web/src/app/sign-in --maxWorkers=2
scripts/heavy.sh npx nx run web-e2e:e2e -- --grep "staff invite"
```

Contracts: `contracts/staff-invites.md`. Model: `data-model.md`.
