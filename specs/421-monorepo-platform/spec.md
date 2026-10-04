# Feature Specification: Monorepo, staging and production, and the release pipeline

**Feature Branch**: `421-monorepo-platform`

**Created**: 2026-10-03

**Status**: Archived (2026-10-04)

**Input**: User description: "ST-421 — The Nx monorepo, staging and production on Railway, and the release pipeline (EP-1 Foundations, slice 1, first story). Notion story: https://app.notion.com/p/3ee607bff0d2815a8fede068cbfbad58."

**Sources**: the Notion story ST-421 (acceptance criteria and Build brief, read 2026-10-03; the story has no comments), its epic [Foundations (EP-1)](https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707), and `.specify/memory/constitution.md` v1.1.0. The Build brief wins where it and the story's acceptance criteria differ.

This story builds the platform every other story ships through. Its users are the build team, not drivers or garages. The tools it names (Nx, Railway, GitHub Actions) are the requirement itself: the constitution (Principles III and IV) fixes the stack and the story fixes the host.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A developer builds and checks the whole repository from a fresh clone (Priority: P1)

A developer clones the repository, installs, and runs typecheck, lint, tests and build. Every app and lib passes. The harness keeps its own test run.

**Why this priority**: every other story starts from this workspace. Nothing else can be built until it exists.

**Independent Test**: on a fresh clone, run install, `typecheck`, `lint`, `test`, `build` and `test:harness`; all succeed.

**Acceptance Scenarios**:

1. **Given** a fresh clone, **When** the developer runs `npm ci`, then `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`, **Then** all four apps (`web`, `api`, `worker`, `mcp`) and every lib pass, and `npm run test:harness` still runs the harness specs on their own.
2. **Given** the repository, **When** anyone looks for lint or format configuration, **Then** there is one root Biome configuration and no ESLint or Prettier file anywhere.

---

### User Story 2 - A developer runs the walking skeleton locally (Priority: P1)

A developer starts the local database and cache, starts the apps, and opens the skeleton page. The page shows that the API reached PostgreSQL and Redis.

**Why this priority**: the skeleton proves that the browser, the API, the database and the cache are wired together. Every later story extends this path.

**Independent Test**: start the local containers and the apps, open the web app, and read the status line.

**Acceptance Scenarios**:

1. **Given** the local containers (PostgreSQL with PostGIS, and Redis) are up and `api`, `worker` and `web` are served, **When** the developer opens the web app's root page, **Then** it shows the name MotorFix, the version `dev`, and "PostgreSQL: ok · Redis: ok".
2. **Given** the skeleton page, **When** it loads, **Then** it gets the status through the client generated from the API's OpenAPI document, not through a hand-written request.

---

### User Story 3 - Operations can tell whether each process is alive and ready (Priority: P1)

Railway and the later monitoring story need two checks per process: one that answers while the process runs, and one that answers only when the process can reach its dependencies.

**Why this priority**: the deploy rule (scenario US5-1) and the rollback (US5-3) depend on the ready check.

**Independent Test**: call both checks with the database and cache up, then with each one stopped.

**Acceptance Scenarios**:

1. **Given** `api`, `worker`, `web` or `mcp`, **When** `GET /health/live` is called, **Then** it answers 200 with `{"status":"ok"}` while the process runs, without touching PostgreSQL or Redis.
2. **Given** `api` or `worker`, **When** `GET /health/ready` is called and PostgreSQL (`SELECT 1`) and Redis (`PING`) both answer within 2 seconds, **Then** it answers 200 with `{"status":"ok","checks":{"postgres":"ok","redis":"ok"},"version":"<sha>"}`.
3. **Given** `api` or `worker`, **When** `GET /health/ready` is called and PostgreSQL or Redis fails or takes longer than 2 seconds, **Then** it answers 503 with the same shape: `"status":"error"`, the failing part marked `"error"` in `checks`, and `version`.
4. **Given** the `web` server, **When** `GET /health/ready` is called, **Then** it answers 200 once it can render.

---

### User Story 4 - Every pull request is checked before it can merge (Priority: P1)

**Why this priority**: the checks keep `main` green while several agents build stories in parallel.

**Independent Test**: open a pull request with a lint error, and one with a contract change but without the regenerated client; both fail.

**Acceptance Scenarios**:

1. **Given** a pull request, **When** CI runs, **Then** typecheck, lint, unit and API tests, the contract check and the build of the affected projects must all pass before it can merge into `main`.
2. **Given** a change to a request or response type whose OpenAPI document and generated client were not regenerated, **When** CI runs, **Then** the contract check fails and names the files that differ.

---

### User Story 5 - A merge reaches staging, and only a proven build reaches production (Priority: P2)

**Why this priority**: it delivers the "deployed" half of the story. It depends on the owner's Railway project, so it is verified once the accounts exist (see Assumptions).

**Independent Test**: merge a change, watch it deploy to staging and pass end to end, then approve production.

**Acceptance Scenarios**:

1. **Given** a merge into `main`, **When** the pipeline runs, **Then** it builds one image per app tagged with the commit SHA, migrates the staging database, deploys staging, waits until `/health/ready` answers 200, and runs the end-to-end suite against staging.
2. **Given** commit X passed end to end on staging, **When** a required reviewer approves the `production` environment, **Then** the same images (same digest) are deployed to production after the production migrations. A commit that has not passed on staging can never reach production, and no branch can be deployed straight to production.
3. **Given** a production deploy whose new copies do not answer 200 on `/health/ready` within 5 minutes, **Then** traffic stays on the previous deployment, the previous images are restored, and the run is marked failed.
4. **Given** the skeleton page on staging, **When** it loads, **Then** it shows the deployed commit SHA and "PostgreSQL: ok · Redis: ok".
5. **Given** the Railway project, **Then** every staging and production service runs in the EU region, and PostgreSQL and Redis come from Railway's templates.

---

### User Story 6 - Secrets and environment rules hold everywhere (Priority: P2)

**Why this priority**: a leaked key or a test switch in production is a launch blocker. The rules are cheap to set now and costly to retrofit.

**Independent Test**: start an app with a variable missing; start with `APP_ENV=production` and check the seed and the docs page.

**Acceptance Scenarios**:

1. **Given** the repository, **Then** it holds no secret: `.env.example` lists every variable name with no value, and the local `.env` is ignored by git.
2. **Given** a required variable is missing at start, **When** an app starts, **Then** it stops at once and logs the variable's name, never its value.
3. **Given** `APP_ENV=production`, **Then** the seed refuses to run and the API documentation page is not served.

---

### User Story 7 - The database is migrated and seeded the same way everywhere (Priority: P3)

**Acceptance Scenarios**:

1. **Given** the seed command run twice on local or staging, **Then** the second run changes nothing.
2. **When** the build team starts the "Reset staging" workflow by hand, **Then** the staging database is emptied, migrated and seeded again; the workflow has no production target.

### Edge Cases

- PostgreSQL or Redis is down: `/health/ready` answers 503 and names the part; calls that need the database answer 503 with code `service_unavailable`. Emptying Redis loses nothing.
- A migration fails on staging: the pipeline stops before the deploy; production is untouched.
- A migration fails on production: the pre-deploy step aborts the deploy, the previous deployment keeps serving, and the run is marked failed.
- The end-to-end run fails on staging: nothing is promoted; staging keeps that build until the next merge.
- GitHub Actions or Railway is down: nothing is deployed and the running system is unaffected. The build lead can deploy an image that already passed on staging with the Railway command-line tool, staging first.
- An unknown error in the API: it answers problem details with code `internal_error` and no stack trace.
- A path outside `/api/` and `/health/` on the API: 404 problem details with code `not_found`.
- A deploy fails after some services already went live on the new images: every service this run touched is put back on its previous image.
- A request body with an unknown field: refused.

## Requirements *(mandatory)*

### Functional Requirements

**Workspace**

- **FR-001**: The repository MUST be one Nx workspace holding the apps `web`, `api`, `worker`, `mcp` and `web-e2e`, and the libs `contracts`, `domain` and `data-access`. No other lib is created by this story.
- **FR-002**: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run e2e` MUST run the matching target across every project; `npm run test:harness` MUST keep running the harness specs alone.
- **FR-003**: Biome MUST be the only linter and formatter, from the root configuration; Jest MUST run from the root configuration; Playwright MUST run in `web-e2e`. The harness folders (`.claude/`, `.specify/`, `.worktrees/`) MUST stay outside Nx, Jest and the product Biome scope.
- **FR-004**: TypeScript MUST run in strict mode everywhere. The Node version MUST be written once in `.nvmrc` and repeated only in `engines` and the Dockerfiles.
- **FR-005**: Imports MUST go one way: apps import libs, libs never import apps, and `web` never imports `domain`.

**API conventions**

- **FR-006**: The API MUST serve its routes under `/api/v1`, and the health checks outside it at `/health/live` and `/health/ready`.
- **FR-007**: The API MUST validate every request body against its DTO from `contracts`, refuse unknown fields, and transform input to the DTO types.
- **FR-008**: Errors MUST be returned (Notion A28, proposed; confirmed in the plan) as RFC 9457 problem details (`application/problem+json`) with a stable `code`; an unknown error MUST answer 500 with code `internal_error` and no stack trace.
- **FR-009**: Every response MUST carry an `X-Request-Id`, taken from the request when it is 1–128 letters, digits, `_`, `.` or `-`, and created otherwise; every log line written during a request MUST carry it.
- **FR-010**: Logs MUST be JSON lines on standard output with no e-mail address, phone number, number plate or message text.
- **FR-011**: Every process MUST run with `TZ=UTC`.

**Health**

- **FR-012**: `api`, `worker`, `web` and `mcp` MUST answer `GET /health/live` with 200 `{"status":"ok"}` without touching PostgreSQL or Redis.
- **FR-013**: `api` and `worker` MUST answer `GET /health/ready` as in US3 scenarios 2 and 3, with a 2-second limit per check and the deployed commit SHA as `version`.
- **FR-014**: The `web` server MUST answer `GET /health/ready` with 200 `{"status":"ok"}` from the process that renders; answering is the check.

**Contract**

- **FR-015**: The OpenAPI document MUST be generated from the API controllers and the `contracts` DTOs, with the health endpoints under the tag `health`, and committed.
- **FR-016**: The Angular client in `data-access` MUST be generated from that document and committed; no request or response type is written by hand in `web`.
- **FR-017**: A contract check MUST regenerate the document and the client and fail, naming the differing files, when either differs from what is committed.
- **FR-018**: The API documentation page `/api/docs` MUST be served only when `APP_ENV` is not `production`.

**Skeleton page**

- **FR-019**: The web app's root page MUST show "MotorFix", the deployed version (`dev` locally, the commit SHA when deployed), and "PostgreSQL: ok · Redis: ok" (or the failing part; "unknown" for both, and "version unknown", when the API does not answer). The page is server-rendered: during server rendering it calls the API's `/health/ready` through the generated client at `API_INTERNAL_URL`, and the browser reuses that result without a second call.
- **FR-020**: The `web` server MUST forward `/api/` requests to the `api` service without buffering the response, close the upstream request when the browser goes away, and close the browser's response when the API breaks off. It answers its own `/health/*` and forwards none of it.

**Configuration and secrets**

- **FR-021**: One configuration module MUST read and check the environment at start; a missing required variable MUST stop the process and log the variable's name only. Required: `api` and `worker` — `APP_ENV`, `DATABASE_URL`, `REDIS_URL`; `web` — `APP_ENV`, `API_INTERNAL_URL`, `PUBLIC_WEB_URL`; `mcp` — `APP_ENV`. With defaults: `PORT` (set by Railway; a fixed port per app locally) and `RELEASE_SHA` (`dev`).
- **FR-022**: The repository MUST hold no secret value: `.env.example` lists every variable name with no value, and `.env` is ignored by git.
- **FR-023**: `APP_ENV` MUST accept only `development`, `test`, `staging` and `production`.

**Database**

- **FR-024**: Prisma (Notion A6, proposed; confirmed in the plan) MUST manage the schema, one schema file per module in `domain`, with empty files for `auth`, `notifications`, `audit` and `events`. The first migration MUST create no product table.
- **FR-025**: The seed MUST be one command, idempotent, and MUST refuse to run when `APP_ENV` is `production`.
- **FR-026**: Local development MUST start PostgreSQL with PostGIS and Redis with one `docker compose up`.

**Pipeline and environments**

- **FR-027**: On every pull request CI MUST run install, typecheck, lint, unit and API tests against real PostgreSQL and Redis, the contract check, the build of the affected projects, and a dependency audit of the production dependencies that fails on high and critical findings (the build tooling is kept current by the dependency-update pull requests instead).
- **FR-028**: On every merge into `main` the pipeline MUST run every check on every project, build one image per app tagged with the commit SHA, push it to GitHub's container registry, migrate and deploy staging, wait for `/health/ready`, run the end-to-end suite against staging, and stop for approval of the `production` environment. The staging wait for `/health/ready` is limited to 5 minutes; on expiry the run fails and nothing is promoted. Migrations run as `prisma migrate deploy` in the `api` pre-deploy command and MUST be backwards compatible, because the previous images may be restored.
- **FR-029**: After approval the pipeline MUST deploy the same image digests to production after the production migrations, wait for `/health/ready`, and restore the previous images and fail the run if the check does not pass within 5 minutes.
- **FR-030**: Staging deploys MUST run one at a time, in commit order. When a newer commit passes staging, the production approval waiting for an older commit MUST be cancelled, so only the latest proven commit can be approved. There MUST be no path that deploys a branch or an unproven commit to production.
- **FR-031**: A "Reset staging" workflow, started by hand, MUST empty, migrate and seed the staging database and MUST have no production target.
- **FR-032**: One root Dockerfile MUST build a production image for each app, selected by a build argument; the `mcp` image is built but not deployed.
- **FR-033**: Automatic dependency-update pull requests MUST be switched on.
- **FR-034**: The by-hand checks of the pipeline (a lint error blocks a merge; a stale client fails the contract check; a broken migration stops the run before staging; production does not deploy without approval; a failing production health check restores the previous images) MUST be listed in `quickstart.md`, with a place to record the date and result of each.

### Key Entities

- **Environment**: `development`, `test`, `staging` or `production`, named by `APP_ENV`; decides which switches, pages and commands exist.
- **Release**: one commit SHA, its four images, and the environments it has reached. Promotion moves a release from staging to production; it never rebuilds.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033, FR-034

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a fresh clone, the five root commands (`typecheck`, `lint`, `test`, `build`, `test:harness`) all succeed with no manual step beyond `npm ci` and `docker compose up`.
- **SC-002**: The ready check reports a stopped database or cache within 2 seconds of being called (from the Build brief).
- **SC-003**: A pull request with a lint error, a type error, a failing test or a stale generated client cannot merge, in 4 out of 4 tries.
- **SC-004**: Production receives only images that passed on staging for the same commit; this is checked by hand once, and the result is written down.
- **SC-005**: A failed production health check restores the previous images within 5 minutes (from the Build brief, marked proposed there).

## Clarifications

### Session 2026-10-03

- Q: Which web addresses do staging and production use? → A: Railway's own `up.railway.app` addresses until the owner names the domains (Build brief, Open). (autonomous default)
- Q: How does the skeleton page reach the API's PostgreSQL and Redis status, and does `web` forward `/health/`? → A: `web` forwards `/api/` only (Notion) and keeps its own `/health/*`; the server-rendered page calls the API's `/health/ready` through the generated client at `API_INTERNAL_URL`. (autonomous, recommended; context.md contradiction)
- Q: When commit Y passes staging while X awaits production approval, is X's approval still valid? → A: No: staging runs one at a time in commit order, and a newer commit passing staging cancels the older pending production approval. (autonomous, recommended)
- Q: How long does the pipeline wait for staging's `/health/ready`? → A: 5 minutes, as for production; on expiry the run fails and nothing is promoted. (autonomous, recommended)
- Q: Which variables are required per app, and which have defaults? → A: As listed in FR-021; `RELEASE_SHA` defaults to `dev`, `PORT` to a fixed local port. (autonomous, recommended; Build brief, Secrets)
- Q: Does `mcp` answer the health checks? → A: `/health/live` only; no ready check until ST-365 gives it dependencies (Principle I). (autonomous, recommended)

## Assumptions

- The owner's Railway project (EU region, billing) and the GitHub repository settings (branch protection, the `production` environment with its required reviewer, the Railway tokens as environment secrets) are set up by the owner or the build lead. This run cannot create accounts or enter tokens, so it writes the pipeline and the Railway configuration and verifies them locally. US5 and scenarios FR-028 to FR-031 are verified on the first real merge, by hand, and written down. (autonomous default)
- The required reviewer of the `production` environment is the build lead (Build brief, marked proposed). (autonomous default)
- The container registry is GitHub's (`ghcr.io`) (Build brief, proposed). (autonomous default)
- The client generator is ng-openapi-gen (Build brief, proposed). (autonomous default)
- The OpenAPI document is written to `apps/api/openapi.json` (Build brief, proposed path). (autonomous default)
- Nx Cloud is not connected (Build brief, proposed). (autonomous default)
- The test-only admin switches of A33 do not exist yet; no story has built one. FR-018 and FR-025 are the production-only rules this story can prove. (autonomous default)
- The `mcp` app only starts and answers `/health/live`; it gets no Railway service until ST-365. (Build brief)
- PWA set-up, object storage, monitoring, the CDN and custom domains are out of scope (Build brief, Out of scope).
