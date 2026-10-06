# Quickstart: proving ST-198

Prerequisites: `docker compose up -d` (PostgreSQL, Redis), `DATABASE_URL` and `REDIS_URL` from `.env.example`. Heavy commands go through `scripts/heavy.sh`.

## Unit (no services)

```sh
scripts/heavy.sh npx jest libs/domain/src/notifications/staff-lists.spec.ts libs/domain/src/notifications/preferences.spec.ts libs/domain/src/notifications/catalogue.spec.ts > /tmp/mf-unit.log 2>&1; echo "exit $?"; tail -n 20 /tmp/mf-unit.log
scripts/heavy.sh npx jest apps/web/src/app/dashboard/notification-settings.spec.ts apps/web/src/app/dashboard/views.spec.ts > /tmp/mf-web.log 2>&1; echo "exit $?"; tail -n 20 /tmp/mf-web.log
```

Expected: the four role lists of FR-004/005 (SC-003: `day_sheets` off removes 2, `can_answer_quotes` adds 2); locks of FR-006; the panel renders skeleton → rows, reverts and toasts on a failed save, re-reads on the two live events.

## API (PostgreSQL + Redis)

```sh
scripts/heavy.sh env JEST_SUITE=integration npx nx test domain --testPathPattern 'preferences\.(api|pipeline)\.integration' > /tmp/mf-int.log 2>&1; echo "exit $?"; tail -n 40 /tmp/mf-int.log
```

Expected: `GET` carries `staff` per the contract; SC-001 (owner mutes all: 3 `in_app` rows, 0 outside across REQUEST_RECEIVED and two REQUEST_REMINDERs); SC-002 (receptionist's mute leaves the owner's rows); SC-004 (the 6 refusals leave rows and `activity_log` unchanged); FR-010 (DOCUMENT_DUE goes by the channels left on).

## Contract and client

```sh
scripts/heavy.sh npx nx run data-access:generate   # builds api, writes apps/api/openapi.json, regenerates libs/data-access
git status --short apps/api/openapi.json libs/data-access   # committed together with the DTO change
```

## End to end

```sh
scripts/heavy.sh npx nx e2e web-e2e --grep "notification settings" > /tmp/mf-e2e.log 2>&1; echo "exit $?"; tail -n 30 /tmp/mf-e2e.log
```

Expected (SC-005): as `service@example.test`, `/app/garage/settings` shows the push panel then the Notificări panel; REQUEST_RECEIVED's E-mail and Push switched off survive a reload; the WhatsApp switch is disabled with "Adaugă un număr de telefon verificat"; at 320 px nothing scrolls sideways. The PR QA sweep covers 320/390 px, tablet, desktop, light/dark, ro/en.

Whole-repo checks before ready: `npm run typecheck`, `npm run lint`, `npm run test:unit` (through `scripts/heavy.sh`).
