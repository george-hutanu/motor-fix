# Quickstart: proving ST-207

## Prerequisites

- `docker compose up -d` (PostgreSQL and Redis), `DATABASE_URL` and `REDIS_URL` from `.env.example`; or let the pre-commit hook start the worktree's own services.
- After the schema change: `npx prisma generate --config libs/domain/prisma.config.ts` and `npx prisma migrate deploy --config libs/domain/prisma.config.ts`.
- Heavy commands through `scripts/heavy.sh`.

## The specs (`/speckit-tests` writes them red first)

| Spec | Proves |
| --- | --- |
| `libs/contracts/src/garage-status.spec.ts` | SC-006: every (garage status, newest file) pair maps to one key; seven labels in `ro` and `en`; the suffix on the unpublished keys; `rejected` carries the reason |
| `libs/domain/src/garages/verification-config.spec.ts` | SC-005: `1`/`true` under `test` is on; `yes`, `0`, unset are off; on under `development`, `staging`, `production` is ignored |
| `libs/domain/src/garages/verification.service.integration.spec.ts` | SC-002: the 9 allowed transitions and every other ordered pair (409 naming status and author; the second open unchanged); SC-003: one audit entry and one outbox row per committed transition, none after a thrown transaction; two concurrent `decide` calls in two transactions: one commits, one 409; two concurrent submits: one row; `previousFileId` after a rejection; the garage stays `approved` after a reopened file's rejection; the switch approves as `system` ("MotorFix" in the history) |
| `libs/domain/src/garages/public-garages.api.integration.spec.ts` | SC-001: six non-public states answer 404 (`suspended` 410, same 404 body as an unknown slug); SC-004: the read right after an approval returns the garage |
| `libs/domain/src/garages/public-garages.scope.spec.ts` | FR-005: a `@Public()` handler's service method reading `garage` without `publicGarages()` fails the test by `File#method` (a fixture string proves the failure; the tree passes) |
| `libs/domain/src/events/audience.spec.ts` | the `published` verification subject adds `public:garage:{id}` and `public:search:{brandId}` |
| `apps/api/src/public-routes.integration.spec.ts` | the new route is the only addition to the public list |

## Run

```sh
scripts/heavy.sh npx jest libs/contracts/src/garage-status.spec.ts libs/domain/src/garages > /tmp/st207.log 2>&1; echo "exit $?"; tail -n 40 /tmp/st207.log
scripts/heavy.sh npx nx run-many -t typecheck lint -p contracts domain api data-access > /tmp/st207-check.log 2>&1; echo "exit $?"; tail -n 20 /tmp/st207-check.log
npx nx run api:openapi && npx nx run data-access:generate   # then commit the regenerated files
```

## By hand (optional)

With the API served (`npx nx serve api`): `curl -i localhost:3000/api/v1/garages/atelier-test` answers 404 `not_found` (seeded garages are `draft`); after `UPDATE garage SET status = 'approved' WHERE slug = 'atelier-test'` it answers 200 with id, name and slug; after `status = 'suspended'`, 410 `gone`.

## Left to later stories

The scope scan reads controllers only; the MCP server's tools join it when the assistant story adds them. The Playwright scenario (submit, not found, approve, found for its brand) lands with the search story.
