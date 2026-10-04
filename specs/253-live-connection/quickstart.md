# Quickstart: 253-live-connection

1. `docker compose up -d`, seed the accounts (`libs/domain/src/seed.ts`), `npx nx run api:serve`, `npx nx run web:serve`.
2. Sign in as `sofer@example.test` at http://localhost:4200: the driver dashboard; DevTools shows one pending `GET /api/v1/live` whose first message is `hello`.
3. As `admin@example.test`, `POST /api/v1/admin/live/test` with the driver's account id: the toast "Actualizare de test în direct" shows on the driver's tab within 2 s.
4. Tests: `scripts/heavy.sh npx jest libs/domain/src/events apps/web/src/app/dashboard --maxWorkers=2`; `scripts/heavy.sh npx nx run web-e2e:e2e -- --grep live`.
