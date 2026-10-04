# Implementation Plan: Monorepo, staging and production, and the release pipeline

**Branch**: `421-monorepo-platform` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/421-monorepo-platform/spec.md`

## Summary

Turn the harness-only repository into one Nx workspace with the apps `web` (Angular SSR), `api` and `worker` (NestJS), `mcp` (a bare Node process for now), `web-e2e` (Playwright), and the libs `contracts`, `domain` and `data-access`. The walking skeleton is one path: the server-rendered root page calls the API's `/health/ready` through the client generated from the API's OpenAPI document, and the API checks PostgreSQL (`SELECT 1` through Prisma) and Redis (`PING`). Around it: the API conventions every later story inherits (prefix, validation, problem details, request id, JSON logs, env check), one root Dockerfile that builds an image per app, GitHub Actions for pull requests and for releases, and a small deploy script that points the Railway services at the image digests. Details and evidence are in [research.md](./research.md).

## Technical Context

Versions are the current releases on npm on 2026-10-04 (`npm view <pkg> version`) and their peer ranges. There is no workspace yet, so no lockfile or `nx.json` to cite. Notion fixes no version: "current long-term-support release when the build starts" (context.md, Decisions).

**Language/Version**: TypeScript 6.0.x. TS 7.0.2 is `latest`, but `@angular/compiler-cli@22.2.1` peers `typescript: '>=6.0 <6.1'`. Node 24 LTS (`v24.21.0` "Krypton", nodejs.org/dist/index.json; `@angular/core@22.2.1` engines `^22.22.3 || ^24.15.0 || >=26.0.0`), written once in `.nvmrc`.

**Primary Dependencies**: Nx 23.2.1 (`@nx/angular`, `@nx/nest`, `@nx/node`, `@nx/js`, `@nx/jest`, `@nx/playwright`, `@nx/webpack`, all 23.2.1). Angular 22.2.1 with `@angular/ssr` 22.2.1 (zoneless, standalone; `@nx/angular@23.2.1` peers `@angular/build >=20 <23`). NestJS 12.1.2 (`@nestjs/core`, `common`, `platform-express`, `testing`) and `@nestjs/swagger` 12.0.2. Prisma 7.10.0 (`prisma`, `@prisma/client`, `@prisma/adapter-pg`; 8.0.0 is still an rc) with `pg` 8.23.1. `ioredis` 6.0.0. `class-validator` 0.15.1 and `class-transformer` 0.5.1. `ng-openapi-gen` 1.1.0. PrimeNG is NOT installed here: no screen uses it until ST-50 (Principle I).

**Storage**: PostgreSQL (Railway template, PostGIS-capable) through Prisma. Redis through ioredis. No product table in this story.

**Testing**: Jest 30.5.2 from the root `jest.config.ts` (`@nx/jest` peers `jest ^29 || ^30`, `ts-jest ^29`; `jest-preset-angular` 17.0.1 peers Angular `>=20 <23`, `jest ^30`). API tests use `@nestjs/testing` and `supertest` 7.3.1 against real PostgreSQL and Redis. Playwright 1.63.0 in `apps/web-e2e`. The harness keeps vitest (`npm run test:harness`).

**Target Platform**: Linux containers on Railway (EU region), built by GitHub Actions; local development on macOS.

**Project Type**: web application in an Nx monorepo (SSR web, REST API, worker, MCP stub).

**Performance Goals**: the ready check answers within 2 s per dependency (FR-013). Nothing else is measured in this story.

**Constraints**: EU region (A16, A25). Secrets only in Railway and GitHub environments (FR-022). Backwards-compatible migrations (FR-028). `TZ=UTC` (FR-011). `web` never imports `domain` (FR-005).

**Scale/Scope**: staging 1 copy per app; production `web` 2, `api` 2, `worker` 1 (Build brief).

**Local environment found**: no Docker, Podman, PostgreSQL or Redis on this machine (`which` returned nothing; Homebrew is present). `docker-compose.yml` is still written for the team (FR-026). For this run, PostgreSQL 17 and Redis are installed with Homebrew so that the API tests run against real servers; CI uses service containers. See research.md R9.

## Constitution Check

- [x] **I. No Bloat**: no lib, package or service beyond what a requirement names. PrimeNG, BullMQ, `libs/i18n`, `libs/ui-cockpit` and the like wait for their stories. `mcp` is a ~15-line `node:http` server, not a Nest app. The web server's `/api/` forward uses `node:http` (about 20 lines), not `http-proxy-middleware`. JSON logs use Nest's `ConsoleLogger({ json: true })` rather than pino. One root Dockerfile with an `APP` build argument, not four. Generator output is stripped. Two items that look like bloat are in Complexity Tracking.
- [x] **II. Test Discipline**: specs colocated; health and convention tests run against real PostgreSQL and Redis (Homebrew locally, service containers in CI); the skeleton page is covered by Playwright.
- [x] **III. The Given Stack**: Angular, NestJS, PostgreSQL, Redis. PrimeNG arrives with the theme (ST-50); nothing substitutes for it.
- [x] **IV. One Repository, One Toolchain**: one Nx workspace with exactly `web`, `api`, `worker`, `mcp` (+ `web-e2e`, the Playwright project the constitution names); Biome only (generators run with `--linter none`, eslint files deleted); Jest from the root config.
- [x] **V. Rules Live in One Place**: the health checks live in `libs/domain` and serve `api` and `worker`; the DTOs live in `libs/contracts`; the client is generated into `libs/data-access`; the contract check runs in CI.
- [x] **VI. PostgreSQL Is the Truth**: Redis is only pinged. No state change, so no outbox in this story.
- [x] **Notion choices**: Prisma (A6), problem details (A28, lower-snake-case codes A42), GitHub Actions and ghcr.io (Technology stack), ng-openapi-gen and `apps/api/openapi.json` (ST-421 Build brief) are Proposed in Notion and confirmed here; each cites its source in research.md. T1 hosting is decided (Railway, A16 and A25). No other T item is touched.

Post-design re-check (after Phase 1): unchanged. All gates pass.

## Project Structure

### Documentation (this feature)

```text
specs/421-monorepo-platform/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/health.md
├── context.md · design.md · notion-sync.md · auto-run.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

Everything below is `(new)` except the root files marked `(edit)`. The tree before this story is `AGENTS.md`, `biome.json`, `package.json`, `package-lock.json`, `.husky/`, `.claude/`, `.specify/`, `specs/` (listing, 2026-10-04).

```text
package.json (edit)            # scripts: typecheck, lint, test, build, e2e, test:harness; engines
biome.json (edit)              # files.includes: drop src/test placeholders; exclude generated client
nx.json · tsconfig.base.json · jest.config.ts · jest.preset.js
.nvmrc · .env.example · .gitignore (edit) · docker-compose.yml · Dockerfile · .dockerignore
.github/
├── workflows/ci.yml           # pull requests and merges: checks
├── workflows/release.yml      # merge to main: images → staging → e2e → approval → production
├── workflows/reset-staging.yml
└── dependabot.yml
scripts/railway-deploy.mjs     # point services at image digests, deploy, wait, restore on failure
apps/
├── web/                       # Angular SSR: src/app/app.ts (+ spec), src/server.ts (health, /api forward)
├── web-e2e/                   # Playwright: src/skeleton.spec.ts
├── api/                       # src/main.ts, src/app.module.ts, src/bootstrap.ts (conventions), openapi.json
├── worker/                    # src/main.ts, src/worker.module.ts (health only)
└── mcp/                       # src/main.ts (health/live only)
libs/
├── contracts/                 # src/env.ts (APP_ENV, readEnv), src/health.dto.ts, src/problem.ts
├── domain/                    # src/health/ (module, service, controller), src/prisma.service.ts,
│                              # prisma/schema/{schema,auth,notifications,audit,events}.prisma,
│                              # prisma.config.ts, prisma/seed.ts
└── data-access/               # generated by ng-openapi-gen; never edited
```

**Structure Decision**: the four apps and three libs of the Build brief's workspace table, nothing else. The API conventions live in `apps/api/src/bootstrap.ts`, the one place both `main.ts` and the API tests call, so the tests exercise the real set-up.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Empty Prisma schema files for `auth`, `notifications`, `audit`, `events` | The Build brief and the EP-1 execution plan require them so that parallel agents edit different files | Letting each story create its file: the brief names this story as owner, and four empty files cost nothing to read |
| `scripts/railway-deploy.mjs` (~100 lines of GraphQL calls) | Railway's CLI cannot deploy a prebuilt image by digest (research.md R7), and the promotion rule needs the same digest on staging and production | Letting Railway build from Git per environment: it rebuilds per environment, so production would not run the image proven on staging |
