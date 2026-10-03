# Research: Monorepo, staging and production, and the release pipeline

## R1 Versions

- **Decision**: Node 24 LTS; TypeScript ~6.0; Nx 23.2.1; Angular 22.2.1 with `@angular/ssr`; NestJS 12; Prisma 7.10.0; Jest 30 with `jest-preset-angular` 17 and `ts-jest` 29; Playwright 1.63.
- **Rationale**: the current release of each, constrained by peers. TypeScript 7.0.2 is excluded by Angular's peer range.
- **Alternatives**: TS 7 (rejected: `@angular/compiler-cli@22.2.1` peers `>=6.0 <6.1`); Prisma 8 (rejected: `latest` dist-tag is `8.0.0-rc.19`, a release candidate; `@prisma/client` latest is 7.10.0).
- **Evidence**: `npm view` output 2026-10-04 (auto-run.md, phase 5); nodejs.org/dist/index.json (v24.21.0, lts "Krypton").

## R2 Workspace bootstrap

- **Decision**: add Nx to the existing repository (`nx init` equivalent: `nx.json`, `tsconfig.base.json`, root `jest.config.ts` and `jest.preset.js` written by hand), then generate apps and libs with `@nx/angular:application` (`--ssr --bundler=esbuild --unitTestRunner=jest --e2eTestRunner=playwright --linter=none --style=css`), `@nx/nest:application` (`--linter=none --unitTestRunner=jest`) for `api` and `worker`, `@nx/node:application` for `mcp` (no framework), `@nx/js:library` for `contracts` and `domain`, `@nx/angular:library` for `data-access`. Generator output is stripped to what the skeleton uses; any eslint file or dependency a generator adds is removed.
- **Rationale**: generators give the Nx-supported build targets (webpack for Nest, which needs decorator metadata; `@angular/build` for Angular SSR) and inferred `test`/`e2e` targets.
- **Alternatives**: `create-nx-workspace` in a new folder and moving the harness in (rejected: rewrites tracked root files); hand-writing every project (rejected: more config to maintain).
- **Evidence**: `@nx/nest@23.2.1` dependencies include `@nx/eslint` (npm view) — it installs but stays unconfigured.

## R3 API conventions

- **Decision**: `apps/api/src/bootstrap.ts` exports `configureApp(app)`: `setGlobalPrefix('api/v1', { exclude: ['health/*path'] })`, `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` with an `exceptionFactory` mapping to `validation_failed`, a global exception filter writing RFC 9457 bodies, a request-id middleware backed by `AsyncLocalStorage`, and a logger that extends Nest's `ConsoleLogger` with `json: true` and adds `requestId` to each line. `/api/docs` mounted only when `APP_ENV !== 'production'`.
- **Rationale**: the tests call the same `configureApp`, so they prove the real set-up. Built-ins cover JSON logs; the request id needs about 20 lines, which is below the bar for a dependency (Principle I).
- **Alternatives**: `nestjs-pino` (rejected: two new dependencies for what `ConsoleLogger` + `AsyncLocalStorage` do); Nest's default exception shape (rejected: A28 problem details).
- **Evidence**: Notion A28 and A42 (context.md, Open Decisions: proposed, confirmed here); the exact `ConsoleLogger` hook is read from `node_modules/@nestjs/common` during implementation (rule: installed types before deciding).

## R4 Health checks

- **Decision**: `libs/domain/src/health/` holds `HealthService` (Prisma `$queryRaw\`SELECT 1\`` and ioredis `ping()`, run in parallel, each raced against a 2 s timer), `HealthController` (`GET health/live`, `GET health/ready` → 503 with the same DTO on failure) and `HealthModule`, imported by `api` and `worker`. The Redis client is created with `lazyConnect`, `maxRetriesPerRequest: 1` and `enableOfflineQueue: false`, so a down Redis fails fast instead of queueing.
- **Rationale**: one rule, two apps (Principle V). The client options are what makes "fails within 2 s" true rather than relying on the timer alone.
- **Alternatives**: `@nestjs/terminus` (rejected: a dependency and a response shape that differs from the brief's).
- **Evidence**: ST-421 Build brief scenarios 4–5.

## R5 Contract and generated client

- **Decision**: `nx run api:openapi` builds the document with `SwaggerModule.createDocument` from the same `configureApp`, without listening and without a database, and writes `apps/api/openapi.json` (sorted keys, stable). `nx run data-access:generate` runs `ng-openapi-gen --input apps/api/openapi.json --output libs/data-access/src/lib`. CI runs both and `git diff --exit-code` on the two paths; the step prints the differing files.
- **Rationale**: the document must be producible in CI without services. The DTO is a class in `libs/contracts`; the Swagger CLI plugin reads its types.
- **Alternatives**: openapi-generator (rejected: needs Java); a hand-written client (forbidden, Principle V).
- **Evidence**: Build brief, "OpenAPI document and generated client" (proposed tool and path, confirmed here).

## R6 Web server

- **Decision**: `apps/web/src/server.ts` (the Angular SSR Express server) answers `/health/live` and `/health/ready` itself, forwards `/api/*` to `API_INTERNAL_URL` with `node:http`/`node:https` request piping (no buffering, so server-sent events stream later), then hands everything else to the Angular engine. The root component injects the generated health service. On the server, it calls the API at `API_INTERNAL_URL` (the `ApiConfiguration.rootUrl` is set in `app.config.server.ts`) and stores the result in `TransferState`. In the browser, it reads that value and makes no call.
- **Rationale**: FR-019 and FR-020 as clarified. Twenty lines of piping replace a proxy dependency (Principle I).
- **Alternatives**: `http-proxy-middleware` (rejected, Principle I); the browser calling `/api/v1/...` (rejected: there is no API route for status, and inventing one duplicates `/health/ready`).
- **Evidence**: spec Clarifications Q1; context.md Constraints (web forwards `/api/` only).

## R7 Images and Railway deploy

- **Decision**: one root `Dockerfile`, multi-stage, `ARG APP`: build with `nx build $APP`, run `node dist/apps/$APP/...` on `node:24-slim` with `TZ=UTC` and a non-root user. Images go to `ghcr.io/<owner>/motor-fix-<app>:<sha>`. `scripts/railway-deploy.mjs <environment> <sha>` calls Railway's public GraphQL API (`https://backboard.railway.com/graphql/v2`, `Authorization: Bearer $RAILWAY_API_TOKEN`). For `web`, `api` and `worker` it runs `serviceInstanceUpdate` with `source.image` set to the digest, `region: "europe-west4-drams3a"`, `numReplicas` per environment, `healthcheckPath: "/health/ready"` and `healthcheckTimeout: 300`, plus `preDeployCommand: ["npx prisma migrate deploy"]` for `api`. It then runs `serviceInstanceDeployV2` and polls `deployment(id) { status }` until SUCCESS, or until FAILED/CRASHED/REMOVED/SKIPPED or 5 minutes pass. On failure it sets `source.image` back to the previous digest it read first and exits non-zero. Railway keeps traffic on the previous deployment by itself when a health check fails.
- **Rationale**: the same digest moves from staging to production; settings live in code, not in a dashboard; the region is pinned by every deploy (scenario 14).
- **Alternatives**: `railway up` (rejected: it uploads and builds source; the CLI has no image deploy); config-as-code `railway.json` (rejected: read from the repository for repo-sourced services, not image-sourced ones).
- **Evidence**: Railway GraphQL schema introspection and docs.railway.com (guides/manage-services, reference/healthchecks, guides/pre-deploy-command, reference/deployment-regions, guides/services), research agent report 2026-10-04. Unconfirmed in the docs: digest references in `source.image` (tags are shown), and `preDeployCommand` on image services. Both are checked by hand on the first staging deploy; the fallback is the `:<sha>` tag, which is immutable by convention.
- **Owner setup** (spec Assumptions): Railway Pro plan (private registry credentials need it), a workspace token as `RAILWAY_API_TOKEN` in the GitHub `staging` and `production` environments, the service and environment ids as environment variables, and ghcr credentials (a classic personal access token) on each service.

## R8 Workflows

- **Decision**:
  - `ci.yml` runs on pull_request and on push to `main`. Steps: `npm ci` with the cache, then `nx affected -t typecheck test build` (base `origin/main`; all projects on `main`), `biome ci`, the contract check, and `npm audit --audit-level=high`. PostgreSQL (`postgis/postgis:17-3.5`) and Redis (`redis:7`) run as service containers.
  - `release.yml` runs on push to `main` with `concurrency: release-staging` (cancel-in-progress false). Steps: `needs` the checks, builds and pushes 4 images, deploys staging, waits for health, then runs Playwright with `BASE_URL` set to the staging URL.
  - A `production` job (environment `production` with its required reviewer) runs in a second concurrency group, `release-production`, with cancel-in-progress true. A newer commit's job cancels the older one that is still waiting for approval (FR-030). Production gets the same digests from the staging job's outputs.
  - `reset-staging.yml` is `workflow_dispatch` only, environment `staging` hard-coded. It runs `prisma migrate reset --force` against the staging `DATABASE_URL` secret, then the seed.
  - `dependabot.yml` covers npm and github-actions, weekly.
- **Rationale**: GitHub's concurrency groups give the promotion rule without custom state.
- **Alternatives**: one workflow with a manual `workflow_dispatch` for production (rejected: it could be pointed at any ref).
- **Evidence**: Build brief, CI steps table; Technology stack (GitHub Actions, proposed).

## R9 Local services

- **Decision**: `docker-compose.yml` with `postgis/postgis:17-3.5` and `redis:7` is the documented local path. This machine has no Docker, so this run installs `postgresql@17` and `redis` with Homebrew and starts them as Homebrew services, so the API tests run against real servers.
- **Rationale**: constitution II forbids mocking either; CI and the team use containers.
- **Alternatives**: testcontainers (rejected: needs Docker as well); PGlite (rejected: not the real server).
- **Evidence**: `which docker podman colima postgres redis-server` found none; `/opt/homebrew/bin/brew` exists (phase 5).

## R10 Seed and migrations

- **Decision**: `libs/domain/prisma.config.ts` names `prisma/schema` (folder) and `prisma/migrations`, with the seed command `node prisma/seed.ts` (Node 24 strips types natively, so no `tsx`). The seed exits 1 with "seed refused: APP_ENV=production" in production and otherwise runs the module seeds; there are none yet, so a second run trivially changes nothing. No migration file is committed: with no model, `prisma migrate dev` has nothing to write, and `migrate deploy` creates `_prisma_migrations` on first run. The Prisma 7 `prisma-client` generator outputs into `libs/domain/src/generated/prisma` (git-ignored, generated at `postinstall`) and connects with `@prisma/adapter-pg`.
- **Rationale**: FR-024, FR-025 with nothing invented.
- **Evidence**: Build brief, Database; the Prisma 7 config and generator API are read from the installed package during implementation.
