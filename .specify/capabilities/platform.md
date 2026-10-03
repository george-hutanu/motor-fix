---
capability: platform
updated: 2026-10-03
features:
  - 421-monorepo-platform
---

# Capability: Platform

The monorepo, the API conventions every module inherits, the health checks, the generated API client, the environments and the release pipeline.

## Requirements

### 421-FR-001 — The repository is one Nx workspace holding the apps `web`, `api`, `worker`, `mcp` and `web-e2e`, the libs `contracts`, `domain` and `data-access`, and the `scripts` project for the release scripts and their tests. A new lib is created by the story that first needs it.

_From 421-monorepo-platform._

### 421-FR-002 — `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run e2e` MUST run the matching target across every project; `npm run test:harness` MUST keep running the harness specs alone.

_From 421-monorepo-platform._

### 421-FR-003 — Biome MUST be the only linter and formatter, from the root configuration; Jest MUST run from the root configuration; Playwright MUST run in `web-e2e`. The harness folders (`.claude/`, `.specify/`, `.worktrees/`) MUST stay outside Nx, Jest and the product Biome scope.

_From 421-monorepo-platform._

### 421-FR-004 — TypeScript MUST run in strict mode everywhere. The Node version MUST be written once in `.nvmrc` and repeated only in `engines` and the Dockerfiles.

_From 421-monorepo-platform._

### 421-FR-005 — Imports MUST go one way: apps import libs, libs never import apps, and `web` never imports `domain`.

_From 421-monorepo-platform._

### 421-FR-006 — The API MUST serve its routes under `/api/v1`, and the health checks outside it at `/health/live` and `/health/ready`.

_From 421-monorepo-platform._

### 421-FR-007 — The API MUST validate every request body against its DTO from `contracts`, refuse unknown fields, and transform input to the DTO types.

_From 421-monorepo-platform._

### 421-FR-008 — Errors MUST be returned (Notion A28, proposed; confirmed in the plan) as RFC 9457 problem details (`application/problem+json`) with a stable `code`; an unknown error MUST answer 500 with code `internal_error` and no stack trace.

_From 421-monorepo-platform._

### 421-FR-009 — Every response MUST carry an `X-Request-Id`, taken from the request when it is 1–128 letters, digits, `_`, `.` or `-`, and created otherwise; every log line written during a request MUST carry it.

_From 421-monorepo-platform._

### 421-FR-010 — Logs MUST be JSON lines on standard output with no e-mail address, phone number, number plate or message text.

_From 421-monorepo-platform._

### 421-FR-011 — Every process MUST run with `TZ=UTC`.

_From 421-monorepo-platform._

### 421-FR-012 — `api`, `worker`, `web` and `mcp` MUST answer `GET /health/live` with 200 `{"status":"ok"}` without touching PostgreSQL or Redis.

_From 421-monorepo-platform._

### 421-FR-013 — `api` and `worker` MUST answer `GET /health/ready` as in US3 scenarios 2 and 3, with a 2-second limit per check and the deployed commit SHA as `version`.

_From 421-monorepo-platform._

### 421-FR-014 — The `web` server MUST answer `GET /health/ready` with 200 `{"status":"ok"}` from the process that renders; answering is the check.

_From 421-monorepo-platform._

### 421-FR-015 — The OpenAPI document MUST be generated from the API controllers and the `contracts` DTOs, with the health endpoints under the tag `health`, and committed.

_From 421-monorepo-platform._

### 421-FR-016 — The Angular client in `data-access` MUST be generated from that document and committed; no request or response type is written by hand in `web`.

_From 421-monorepo-platform._

### 421-FR-017 — A contract check MUST regenerate the document and the client and fail, naming the differing files, when either differs from what is committed.

_From 421-monorepo-platform._

### 421-FR-018 — The API documentation page `/api/docs` MUST be served only when `APP_ENV` is not `production`.

_From 421-monorepo-platform._

### 421-FR-019 — The web app's root page MUST show "MotorFix", the deployed version (`dev` locally, the commit SHA when deployed), and "PostgreSQL: ok · Redis: ok" (or the failing part; "unknown" for both, and "version unknown", when the API does not answer). The page is server-rendered: during server rendering it calls the API's `/health/ready` through the generated client at `API_INTERNAL_URL`, and the browser reuses that result without a second call.

_From 421-monorepo-platform._

### 421-FR-020 — The `web` server MUST forward `/api/` requests to the `api` service without buffering the response, close the upstream request when the browser goes away, and close the browser's response when the API breaks off. It answers its own `/health/*` and forwards none of it.

_From 421-monorepo-platform._

### 421-FR-021 — One configuration module MUST read and check the environment at start; a missing required variable MUST stop the process and log the variable's name only. Required: `api` and `worker` — `APP_ENV`, `DATABASE_URL`, `REDIS_URL`; `web` — `APP_ENV`, `API_INTERNAL_URL`, `PUBLIC_WEB_URL`; `mcp` — `APP_ENV`. With defaults: `PORT` (set by Railway; a fixed port per app locally) and `RELEASE_SHA` (`dev`).

_From 421-monorepo-platform._

### 421-FR-022 — The repository MUST hold no secret value: `.env.example` lists every variable name with no value, and `.env` is ignored by git.

_From 421-monorepo-platform._

### 421-FR-023 — `APP_ENV` MUST accept only `development`, `test`, `staging` and `production`.

_From 421-monorepo-platform._

### 421-FR-024 — Prisma (Notion A6, proposed; confirmed in the plan) MUST manage the schema, one schema file per module in `domain`, with empty files for `auth`, `notifications`, `audit` and `events`. The first migration MUST create no product table.

_From 421-monorepo-platform._

### 421-FR-025 — The seed MUST be one command, idempotent, and MUST refuse to run when `APP_ENV` is `production`.

_From 421-monorepo-platform._

### 421-FR-026 — Local development MUST start PostgreSQL with PostGIS and Redis with one `docker compose up`.

_From 421-monorepo-platform._

### 421-FR-027 — On every pull request CI MUST run install, typecheck, lint, unit and API tests against real PostgreSQL and Redis, the contract check, the build of the affected projects, and a dependency audit of the production dependencies that fails on high and critical findings (the build tooling is kept current by the dependency-update pull requests instead).

_From 421-monorepo-platform._

### 421-FR-028 — On every merge into `main` the pipeline MUST run every check on every project, build one image per app tagged with the commit SHA, push it to GitHub's container registry, migrate and deploy staging, wait for `/health/ready`, run the end-to-end suite against staging, and stop for approval of the `production` environment. The staging wait for `/health/ready` is limited to 5 minutes; on expiry the run fails and nothing is promoted. Migrations run as `prisma migrate deploy` in the `api` pre-deploy command and MUST be backwards compatible, because the previous images may be restored.

_From 421-monorepo-platform._

### 421-FR-029 — After approval the pipeline MUST deploy the same image digests to production after the production migrations, wait for `/health/ready`, and restore the previous images and fail the run if the check does not pass within 5 minutes.

_From 421-monorepo-platform._

### 421-FR-030 — Staging deploys MUST run one at a time, in commit order. When a newer commit passes staging, the production approval waiting for an older commit MUST be cancelled, so only the latest proven commit can be approved. There MUST be no path that deploys a branch or an unproven commit to production.

_From 421-monorepo-platform._

### 421-FR-031 — A "Reset staging" workflow, started by hand, MUST empty, migrate and seed the staging database and MUST have no production target.

_From 421-monorepo-platform._

### 421-FR-032 — One root Dockerfile MUST build a production image for each app, selected by a build argument; the `mcp` image is built but not deployed.

_From 421-monorepo-platform._

### 421-FR-033 — Automatic dependency-update pull requests MUST be switched on.

_From 421-monorepo-platform._

### 421-FR-034 — The by-hand checks of the pipeline (a lint error blocks a merge; a stale client fails the contract check; a broken migration stops the run before staging; production does not deploy without approval; a failing production health check restores the previous images) MUST be listed in `quickstart.md`, with a place to record the date and result of each.

_From 421-monorepo-platform._

## Retired
