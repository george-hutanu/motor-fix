# Data Model: Monorepo, staging and production, and the release pipeline

No product table. The only write is Prisma's own migration history (`_prisma_migrations`), created by the first `prisma migrate deploy`. The schema is split per module under `libs/domain/prisma/schema/`: `schema.prisma` (generator and datasource) plus empty `auth.prisma`, `notifications.prisma`, `audit.prisma` and `events.prisma` for the EP-1 lanes.

## Configuration (environment variables)

| Variable | Values | Required by | Default |
|---|---|---|---|
| `APP_ENV` | `development` · `test` · `staging` · `production` | all | none; any other value stops the start |
| `DATABASE_URL` | PostgreSQL URL (Railway reference to `postgres`) | api, worker | none |
| `REDIS_URL` | Redis URL (Railway reference to `redis`) | api, worker | none |
| `API_INTERNAL_URL` | the API's private address, e.g. `http://api.railway.internal:8080` | web | none |
| `PUBLIC_WEB_URL` | the web app's public address | web | none |
| `RELEASE_SHA` | commit SHA | all | `dev` |
| `PORT` | set by Railway | all | api 3000, web 4000 (SSR server; `nx serve` keeps 4200), worker 3001, mcp 3002 |
| `TZ` | `UTC` | all | set in the Dockerfile and the root scripts |

A missing required variable, or an `APP_ENV` outside the list, stops the process with one log line naming the variable (never its value).

## Environment rules

| Rule | development | test | staging | production |
|---|---|---|---|---|
| `/api/docs` served | yes | yes | yes | no |
| seed allowed | yes | yes | yes | no (exits non-zero) |
| test-only admin switches (A33) | none exist yet | | | never |

## Release

A commit SHA and its four image digests (`ghcr.io/<owner>/motor-fix-<app>@sha256:…`). States: built → on staging → staging proven (health + e2e green) → approved → on production, or failed at any step. Only the latest staging-proven commit can be approved (FR-030).
