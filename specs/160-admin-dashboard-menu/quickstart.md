# Quickstart: ST-160 admin dashboard and menu

How to prove the feature works. Shapes in [data-model.md](./data-model.md) and [contracts/admin-overview.md](./contracts/admin-overview.md); decisions in [research.md](./research.md).

## Prerequisites

- `docker compose up -d` (PostgreSQL + PostGIS, Redis), `DATABASE_URL` and `REDIS_URL` from `.env.example`.
- After the controller and DTO exist: `npx nx run api:openapi && npx nx run data-access:generate` (rewrites `apps/api/openapi.json` and `libs/data-access/src/lib`; both are committed).
- Seed: `APP_ENV=development node libs/domain/src/seed.ts` (as `seed.integration.spec.ts` spawns it); `admin@example.test` / `parola-de-test`.

## Specs

| Scenario | Spec | Expect |
| --- | --- | --- |
| overview returns the waiting count; 0 when none | `libs/domain/src/garages/admin-overview.controller.spec.ts`, `verification.service.spec.ts` (`countWaiting`) | `{ garagesWaiting: n }`, only `submitted` and `in_review` counted |
| every `admin/*` route refuses the four other roles | `apps/api/src/admin-routes.integration.spec.ts` | 404 `not_found` for each route × role; at least the four known routes listed |
| signed out | `apps/api/src/public-routes.integration.spec.ts` (existing) | 401 `sign_in_required` for `admin/overview` |
| maintenance on | `admin-routes.integration.spec.ts` (MAINTENANCE overridden) | admin still gets 200 |
| view list: order, release mark, counter mark, unreleased address → Panou | `apps/web/src/app/dashboard/views.spec.ts` | `allowedViews` and `dashboardRoutes` drop unreleased views |
| `liveResource` without an id re-reads on every event of its kinds; `failed` true after a failed read until the next success | `apps/web/src/app/dashboard/live.spec.ts` | |
| store: skeleton on first read, count, hidden on failure, re-read on the three kinds and on resync, 300 ms burst | `apps/web/src/app/dashboard/admin-overview.spec.ts` | |
| frame: label "Administrator", header line (0 / 1 / 4 / 21 in ro, 0 / 1 / 4 in en), chip and aria-label on Service‑uri, Utilizatori/Raportate/Mărci/Asistent absent, driver frame unchanged | `apps/web/src/app/dashboard/frame.spec.ts` | |
| tab bar: `counts` chip, aria-label, no chip at 0 | `apps/web/src/app/dashboard/tab-bar.spec.ts` | |
| seed: two waiting files, second run changes nothing | `libs/domain/src/seed.integration.spec.ts` | 2 rows in `verification_file` after two runs |
| catalogue: plural groups complete, U+2011 | `libs/i18n` check spec (existing) | green |
| end to end: seeded admin sees the line with 2, three entries, the chip; driver at `/app/admin` lands on `/app/driver` | `apps/web-e2e/src/admin-dashboard.spec.ts`, `dashboards.spec.ts` | 390 px tab bar shows Panou, Service‑uri (2), Setări |

## Run

```sh
scripts/heavy.sh npx jest libs/domain/src/garages apps/web/src/app/dashboard libs/i18n > /tmp/160-unit.log 2>&1; echo "exit $?"; tail -n 40 /tmp/160-unit.log
scripts/heavy.sh npx jest apps/api/src/admin-routes.integration.spec.ts libs/domain/src/seed.integration.spec.ts > /tmp/160-int.log 2>&1; echo "exit $?"; tail -n 40 /tmp/160-int.log
scripts/heavy.sh npx nx e2e web-e2e -- --grep admin > /tmp/160-e2e.log 2>&1; echo "exit $?"; tail -n 40 /tmp/160-e2e.log
npm run lint && npm run typecheck
```

A failed run: `grep -nE '✕|●|FAIL|Error' /tmp/160-*.log | head -n 40`.

## By hand

1. `scripts/heavy.sh npx nx serve api` and `npx nx serve web`; sign in as `admin@example.test`.
2. `/app/admin`: eyebrow "ADMINISTRATOR", line "MotorFix · București · 2 service‑uri așteaptă verificarea", entries Panou, Service‑uri (2), Setări; switch to English: "… · 2 garages are waiting for verification".
3. `/app/admin/users` → stays on Panou. At 320 px nothing scrolls sideways; the line wraps.
4. `curl -H "Authorization: Bearer <driver token>" localhost:3000/api/v1/admin/overview` → 404 `not_found`.
5. Approve a waiting file (ST-207's screen) in another tab: the count drops to 1 without a reload; stop the API: the count and the chip disappear, the entries stay.
