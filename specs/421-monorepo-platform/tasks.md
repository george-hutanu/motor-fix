# Tasks: Monorepo, staging and production, and the release pipeline

**Input**: plan.md, spec.md, research.md, data-model.md, contracts/health.md, quickstart.md, context.md
**Tests**: required (constitution II, red-first). Test tasks precede the code they cover and must fail first.

Paths are `(new)` unless they exist today: `package.json`, `biome.json`, `.gitignore`.

## Phase 1: Setup (workspace)

- [X] T001 Install PostgreSQL 17 and Redis with Homebrew and start them, for the real-server tests on this machine (research R9; not committed)
- [X] T002 Add Nx and the toolchain to the root: `nx.json`, `tsconfig.base.json` (strict), `jest.config.ts`, `jest.preset.js`, `.nvmrc` (24), `engines` in `package.json`; dev dependencies at the versions in plan.md (FR-001, FR-003, FR-004)
- [X] T003 Generate the projects with `--linter none` and strip generator output to the skeleton: `apps/web` (Angular SSR, Jest), `apps/web-e2e` (Playwright), `apps/api`, `apps/worker` (NestJS), `apps/mcp` (Node), `libs/contracts`, `libs/domain` (Node), `libs/data-access` (Angular); delete any eslint/prettier file a generator writes (FR-001, FR-003)
- [X] T004 Root scripts in `package.json`: `typecheck`, `lint`, `test`, `build`, `e2e` run the Nx target on every project; `test:harness` unchanged; `TZ=UTC` for test runs (FR-002, FR-011)
- [X] T005 [P] `biome.json`: `files.includes` covers apps and libs, excludes `libs/data-access/src/lib` (generated) and `libs/domain/src/generated`; `.gitignore`: `dist/`, `.nx/`, `.env`, `libs/domain/src/generated/`, Playwright output (FR-003, FR-022)
- [X] T006 [P] `docker-compose.yml` with `postgis/postgis:17-3.5` and `redis:7`; `.env.example` with every variable of data-model.md and no values (FR-022, FR-026)
- [X] T007 Enforce import direction in `biome.json`: an `overrides` entry for `apps/web/**` and `libs/data-access/**` with `style/noRestrictedImports` forbidding `@motor-fix/domain`; libs cannot import apps because apps have no import alias (FR-005)

## Phase 2: Foundational (blocking)

- [X] T008 [P] Test: `libs/contracts/src/env.spec.ts` — `readEnv` returns values and defaults (`RELEASE_SHA`=`dev`), exits with the missing variable's name only, rejects an `APP_ENV` outside the four values (FR-021, FR-023)
- [X] T009 [P] `libs/contracts/src/env.ts` — `APP_ENVS`, `readEnv(required)` per data-model.md (FR-021, FR-023)
- [X] T010 [P] `libs/contracts/src/health.dto.ts` — `HealthReadyDto`, `HealthLiveDto` with Swagger decorators (contracts/health.md)
- [X] T011 Prisma in `libs/domain`: `prisma.config.ts`, `prisma/schema/schema.prisma` (generator `prisma-client`, output `src/generated/prisma`, datasource postgresql), empty `auth.prisma`, `notifications.prisma`, `audit.prisma`, `events.prisma`; `src/prisma.service.ts` with `@prisma/adapter-pg`; `postinstall` runs `prisma generate` (FR-024)

## Phase 3: US3 Health checks (P1)

**Independent test**: both checks with services up, then with each pointed at a dead port.

- [X] T012 [P] [US3] Test: `libs/domain/src/health/health.controller.spec.ts` against real PostgreSQL and Redis — live 200 with no dependency reachable; ready 200 with checks and version; 503 naming `redis` when Redis is unreachable and `postgres` when PostgreSQL is; answers within 2 s of a hanging dependency (FR-012, FR-013, SC-002)
- [X] T013 [US3] `libs/domain/src/health/{health.service,health.controller,health.module}.ts` (research R4) (FR-012, FR-013)
- [X] T014 [P] [US3] Test: `apps/mcp/src/main.spec.ts` — `/health/live` 200 `{"status":"ok"}` (FR-012)
- [X] T015 [P] [US3] `apps/mcp/src/main.ts` — `node:http` server, `readEnv(['APP_ENV'])` (FR-012, FR-021)
- [X] T016 [US3] `apps/worker/src/main.ts`, `apps/worker/src/worker.module.ts` — Nest app importing `HealthModule`, env check (FR-012, FR-013, FR-021)

## Phase 4: US6 + API conventions (P1/P2)

- [X] T017 [US6] Test: `apps/api/src/bootstrap.spec.ts` against real services — health outside `/api/v1`; unknown route → 404 problem+json `not_found`; unknown body field → 400 `validation_failed`; thrown error → 500 `internal_error` with no stack; `X-Request-Id` echoed and created; log lines are JSON with `requestId`; `/api/docs` 404 when `APP_ENV=production` and 200 otherwise (FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-018)
- [X] T018 [US6] `apps/api/src/bootstrap.ts` — `configureApp` (research R3); `apps/api/src/app.module.ts`; `apps/api/src/main.ts` with `readEnv` (FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-018, FR-021)
- [X] T019 [P] [US6] Test: `libs/domain/prisma/seed.spec.ts` — refuses `APP_ENV=production` with a non-zero exit; two runs succeed and leave the database unchanged (FR-025)
- [X] T020 [US6] `libs/domain/prisma/seed.ts`; seed command in `prisma.config.ts`; `api:seed` target (FR-025)

## Phase 5: US4 Contract (P1)

- [X] T021 [US4] `api:openapi` target writing `apps/api/openapi.json` from `configureApp` without listening (research R5) (FR-015)
- [X] T022 [US4] `data-access:generate` target (ng-openapi-gen) writing `libs/data-access/src/lib`; commit both outputs (FR-016)
- [X] T023 [US4] `scripts/contract-check.sh` — regenerate both, `git diff --exit-code --name-only` on the two paths, print the differing files (FR-017)

## Phase 6: US2 Walking skeleton (P1)

- [X] T024 [P] [US2] Test: `apps/web/src/app/app.spec.ts` — renders "MotorFix", the version, and "PostgreSQL: ok · Redis: ok" / "Redis: error" from a `HealthReadyDto` held in `TransferState` (FR-019)
- [X] T025 [P] [US2] Test: `apps/web/src/server.spec.ts` — `/health/live` and `/health/ready` 200 from web itself; `/api/v1/x` forwarded to a stub upstream with path, method, body and streaming preserved; `/health/ready` not forwarded (FR-014, FR-020)
- [X] T026 [US2] `apps/web/src/app/app.ts` (+ template), `app.config.server.ts` (rootUrl from `API_INTERNAL_URL`) (FR-019)
- [X] T027 [US2] `apps/web/src/server.ts` — health routes, `/api/` forward with `node:http`, env check (FR-014, FR-020, FR-021)
- [X] T028 [US2] Test: `apps/web-e2e/src/skeleton.spec.ts` — open `/`, see "MotorFix", the version from `RELEASE_SHA`, and "PostgreSQL: ok · Redis: ok"; `BASE_URL` selects local or staging (US2-1, US5-4)

## Phase 7: US1 Fresh clone (P1)

- [ ] T029 [US1] Run the five root commands on a clean install; fix until green (SC-001, US1-1)

## Phase 8: US5 + US7 Pipeline and environments (P2/P3)

- [X] T030 [P] [US5] `Dockerfile` (multi-stage, `ARG APP`, Node 24 from `.nvmrc`, `TZ=UTC`, non-root) and `.dockerignore`; the api image carries the Prisma CLI and schema for the pre-deploy command (FR-032, FR-011)
- [X] T031 [P] [US5] Test: `scripts/railway-deploy.spec.ts` — against a stub GraphQL server: sets image digest, region `europe-west4-drams3a`, replicas, health path and timeout, api pre-deploy; deploys; SUCCESS exits 0; FAILED or 5-minute timeout restores the previous image and exits 1 (FR-028, FR-029, US5-5)
- [X] T032 [US5] `scripts/railway-deploy.ts` (research R7) (FR-028, FR-029)
- [X] T033 [P] [US4] `.github/workflows/ci.yml` — pull request and push checks with PostgreSQL/Redis service containers, contract check, `npm audit --audit-level=high` (FR-027)
- [X] T034 [US5] `.github/workflows/release.yml` — images to ghcr by SHA, staging deploy (concurrency `release-staging`), e2e on staging, production job in environment `production` (concurrency `release-production`, cancel-in-progress) with the same digests (FR-028, FR-029, FR-030)
- [X] T035 [P] [US7] `.github/workflows/reset-staging.yml` — `workflow_dispatch`, environment `staging` only (FR-031)
- [X] T036 [P] [US5] `.github/dependabot.yml` — npm and github-actions, weekly (FR-033)
- [X] T037 [US5] `quickstart.md` by-hand checks table with date/result columns (FR-034)

## Phase 9: Polish

- [X] T038 `AGENTS.md` — replace "Not scaffolded yet" and the placeholder-script note with the real commands (AGENTS.md asks for it)

## FR → test

| FR | Test |
|---|---|
| FR-001, FR-002, FR-003, FR-004 | T029 (root commands on a clean install) |
| FR-005 | `npm run lint` (Biome `noRestrictedImports`), checked once with a deliberate bad import |
| FR-006–FR-010, FR-018 | `apps/api/src/bootstrap.spec.ts` |
| FR-011 | `apps/api/src/bootstrap.spec.ts` (process TZ) |
| FR-012, FR-013 | `libs/domain/src/health/health.controller.spec.ts`, `apps/mcp/src/main.spec.ts` |
| FR-014, FR-020 | `apps/web/src/server.spec.ts` |
| FR-015–FR-017 | CI contract check (T023, run in T029) |
| FR-019 | `apps/web/src/app/app.spec.ts`, `apps/web-e2e/src/skeleton.spec.ts` |
| FR-021, FR-023 | `libs/contracts/src/env.spec.ts` |
| FR-022, FR-024, FR-026, FR-032, FR-033, FR-034 | inspection (files exist, no values) |
| FR-025 | `libs/domain/prisma/seed.spec.ts` |
| FR-027–FR-031 | `scripts/railway-deploy.spec.ts`; workflows by hand on first merge (FR-034) |

## Dependencies

Phase 1 → Phase 2 → (Phase 3 ∥ Phase 4) → Phase 5 (needs `configureApp`) → Phase 6 (needs the client) → Phase 7 → Phase 8 → Phase 9.

## Commit slices

1. `build(workspace): …` — Phase 1 (no behaviour)
2. `feat(api): …` — Phases 2–4 with their tests
3. `feat(web): …` — Phases 5–6
4. `ci(release): …` — Phase 8
5. `docs: …` — Phase 9 and the spec artifacts
