# Feature Context: Monorepo, staging and production, and the release pipeline

- **Feature**: 421-monorepo-platform
- **Anchor**: ST-421 "Set up the monorepo, staging and production on Railway, and the release pipeline" — https://app.notion.com/p/3ee607bff0d2815a8fede068cbfbad58 (epic EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707) | terms: Nx, Railway, health, OpenAPI, Prisma
- **Gathered**: 2026-10-04
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature n/a (the story has no Feature relation) | epic ok | architecture ok (Backend architecture read only through a search excerpt: its 94k-character fetch overflowed the tool limit) | decisions ok (root page only; "Open decisions" sub-page not opened, nothing in it points at this story)
- **Overall confidence**: high for the story, stack and environments; medium for Backend architecture

## Story

- **ST-421 Set up the monorepo, staging and production on Railway, and the release pipeline** — status In progress, priority Highest, role System, epic Foundations (EP-1), 8 points, labels backend / front end / outside service. Page last edited 2026-10-03T19:24.
- Scope per the story: five acceptance criteria. (1) One Nx monorepo with apps `web`, `api`, `worker`, `mcp` and shared libs, TypeScript everywhere, Biome, Jest and Playwright from the root. (2) Staging and production on Railway in an EU region, PostgreSQL and Redis from Railway's templates. (3) Every merge runs typecheck, lint, unit and API tests, and production needs a green staging pipeline first. (4) A walking skeleton live on staging: web loads, calls the API, the API reads PostgreSQL and Redis. (5) Secrets live in the environment, never in the repository.
- The Build brief (14 scenarios, "Current as of 2026-10-03") states that it wins over the criteria above it.
- Comments that moved scope: none. The story has no comments, resolved ones included.

## Decisions

- Hosting is Railway in an EU region, with PostgreSQL and Redis from Railway's templates — [Architecture decisions, A16 and A25, Given] (2026-10-03, confidence: high)
- Given stack: Angular (standalone, signals) with PrimeNG, NestJS, PostgreSQL, Redis. Everything else on the stack page is Proposed unless marked Given — [Technology stack; Architecture decisions A1] (2026-10-03, confidence: high)
- No version numbers are fixed anywhere: "use the current long-term-support release of each when the build starts". The Build brief repeats it for Node: written once in `.nvmrc`, `engines` and the Dockerfiles — [Technology stack, header callout; story Build brief, Rules] (2026-10-03, confidence: high)
- The test-only admin switches (manual approval, RAR check) exist only when `APP_ENV` is `development`, `test` or `staging`; the production build never loads them — [Architecture decisions A33, Given] (2026-10-03, confidence: high)
- The Build brief wins over the older story text; a `[NEEDS CLARIFICATION]` or an Open item stops only that item — [Architecture, "How to read a story"] (2026-10-03, confidence: high)

## Constraints

- Health sits outside the API prefix: `GET /health/live` and `GET /health/ready` on api, worker and web ("settled over GET /api/v1/health") — [Backend architecture, REST resources (search excerpt); story Build brief] (2026-10-03, confidence: medium)
- Migrations are `prisma migrate deploy` only, once per release, as the `api` service's pre-deploy command. Never `migrate dev` or `db push` on staging or production. They must be backwards compatible, because the previous images are restored on a failed health check. After each merge, `prisma migrate dev` on `main` proves that they apply in order — [story Build brief, Database; Security, performance and operations, Build and release; EP-1 execution plan] (2026-10-03, confidence: high)
- `web` is the Angular server: server rendering with hydration for public pages, client-side rendering for dashboards, and the browser files. It forwards `/api/` to `api` over Railway's private network without buffering, so server-sent events stream. Railway's health check on every app service is `/health/ready`, and a new deployment takes traffic only once it answers 200 — [story Build brief, Railway services; Technology stack, Rendering; Architecture decisions A10] (2026-10-03, confidence: high)
- Copies, staging / production: `web` 1 / 2, `api` 1 / 2 or more, `worker` 1 / 1 or more. `postgres` and `redis` are private-network only. `mcp` has an image and no service until ST-365 — [story Build brief, Railway services table] (2026-10-03, confidence: high)
- Variables this story creates: `APP_ENV`, `DATABASE_URL`, `REDIS_URL`, `PUBLIC_WEB_URL`, `API_INTERNAL_URL`, `RELEASE_SHA`, `PORT` (set by Railway). Values live in Railway per environment, with separate staging and production keys. The Railway tokens live in GitHub environment secrets — [story Build brief, Secrets and configuration] (2026-10-03, confidence: high)
- The EP-1 scaffold owns the Prisma schema split (`auth`, `notifications`, `audit`, `events`). It installs every package the epic already names, so later branches do not fight over `package.json` and the lockfile. Only lane B edits `app.routes.ts`. Branches and spec folders are named by ST number elsewhere — [EP-1 execution plan, "Where parallel agents will collide"] (2026-10-03T19:11, confidence: medium; the plan says it predates the re-plan, but ST-421 now replaces the scaffold step)
- Time is stored in UTC, and every rule runs in Europe/Bucharest in code, never from the server's clock — [story Build brief, API conventions; Architecture, "For build agents"] (2026-10-03, confidence: high)
- Later stories add jobs to this pipeline: axe ST-248, Lighthouse ST-249, source maps ST-251. ST-251 monitoring and the ADMIN_OUTAGE_ALERT read the health endpoints — [story Build brief, CI steps] (2026-10-03, confidence: high)

## Prior Art

- No sibling story is recorded as Done; EP-1 is In progress and ST-421 is first in slice 1. ST-422 (private file storage) follows it, and ST-430 (CDN and firewall) and ST-365 (`mcp` service) are later and out of scope. I could not query story statuses by ID, so this rests on the epic's own build order — [Foundations (EP-1), Build plan] (2026-10-03T19:24)

## Open Decisions

- Domains for staging and production (owner, tied to the e-mail sending domain S10): until named, Railway's `up.railway.app` addresses — blocks: `PUBLIC_WEB_URL` and the cookie and CORS set-up.
- Proposed, not Given — the plan must confirm each: Prisma (A6, TypeORM is the named alternative), BullMQ (A9), RFC 9457 errors (A28, with A42 lower snake case codes), GitHub Actions (Technology stack, "Proposed"), the GitHub container registry, ng-openapi-gen, `apps/api/openapi.json`, the 5-minute rollback window, `/api/docs` off in production, the dependency audit, one release at a time, and the `web` proxy for `/api/`.
- Outside the code, owner or build lead: the Railway EU project with billing, admin access for the build lead, GitHub branch protection, and the `production` environment with its required reviewer (the build lead is proposed). Without these, scenarios 8 to 10 and 14 cannot be shown.
- Not opened (the "Open decisions" sub-page): none was found that names ST-421 in the excerpts I read.

## Contradictions with spec.md

- **spec.md** (written 2026-10-03): "FR-020: The `web` server MUST forward `/api/` and `/health/` requests for the API to the `api` service" — **Notion**: `web` forwards `/api/` only. `web` answers its own `/health/live` and `/health/ready`, where ready is "200 once it can render". The skeleton page "calls `GET /health/ready` through the generated Angular client" and must show PostgreSQL and Redis, which only the API's ready check reports [story Build brief, scenarios 3 and 5; Railway services] (2026-10-03T19:24) — newer: same date, so a contradiction. spec.md also has FR-012 and FR-014 (web serves `/health/*`) next to FR-020 (web forwards `/health/*`). Notion does not say how the page reaches the API's checks.

## Proposed Clarifications (this command's proposals, not requirements)

- Which URL does the skeleton page's generated client call to get PostgreSQL and Redis status: an API route under `/api/v1`, or the API's `/health/ready` through a distinct forwarded path? Remove `/health/` from FR-020 or rename the forwarded path. — from the FR-020 contradiction
- Should the spec say that `web` is an Angular SSR server (public pages) and that the Dockerfile and `/health/ready` for `web` follow from it? It names only "the web server". — from Technology stack, Rendering, and A10
- Pin the Node, Angular, NestJS, PrimeNG and Prisma versions in the plan, as "current LTS at build start", and record the chosen numbers. Notion pins none. — from Technology stack header
- Add the rule that migrations are backwards compatible and run as the `api` pre-deploy command, plus the post-merge `prisma migrate dev` check, to the pipeline requirements. FR-028 and FR-029 only say "migrate". — from the Build brief, Database
- FR-024 (Prisma), FR-008 (A28) and FR-028 (ghcr.io) read as fixed. Notion marks all three Proposed; the spec's own Assumptions already mark ghcr.io proposed. Reword them as defaults the plan confirms, or accept them in `/speckit-clarify`. — from Architecture decisions A6 and A28
- Name the variables in FR-021 and FR-023 (`DATABASE_URL`, `REDIS_URL`, `PUBLIC_WEB_URL`, `API_INTERNAL_URL`, `RELEASE_SHA`, `PORT`). — from the Build brief, Secrets
- State the copy counts and the Railway health check (`/health/ready`) in US5. — from the Build brief, Railway services

## Gaps

- [NEEDS CLARIFICATION: how the skeleton page reaches the API's ready checks through `web` (see the contradiction)]
- Backend architecture's tables of constants, error codes and timers were not read, so the lower-snake-case `code` list (`internal_error`, `service_unavailable`) is not checked against it.
- The Railway region (for example Amsterdam) is not named in any page ("an EU region").
- The mock's link was recorded and not opened. The skeleton page is "Not designed, and not in the App Mock", so no design board exists for it.

## Sources

- ST-421 story — https://app.notion.com/p/3ee607bff0d2815a8fede068cbfbad58
- Foundations (EP-1) — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
- Foundations (EP-1) execution plan — https://app.notion.com/p/3ee607bff0d281fb9ea5e07f608c9b3d
- Architecture, "For build agents" — https://app.notion.com/p/3ee607bff0d2813d83d0c50d0addb0d6
- Technology stack — https://app.notion.com/p/3ee607bff0d2819ab8e3ee6926a249f2
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- System overview — https://app.notion.com/p/3ee607bff0d28161a43cc77282ccc8c1
- Security, performance and operations — https://app.notion.com/p/3ee607bff0d2810d852efa0a9346afd3
- Front end architecture — https://app.notion.com/p/3ee607bff0d2811688cde6508dfcd09a
- Backend architecture (excerpt only) — https://app.notion.com/p/3ee607bff0d281dfa162cd4b9983dd2e
- Decisions and ideas — https://app.notion.com/p/3ee607bff0d281df9485ce97dfa3332d
