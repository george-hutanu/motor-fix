---
capability: platform
updated: 2026-10-05
features:
  - 421-monorepo-platform
  - 422-private-file-storage
  - 431-mutation-testing
  - 464-agent-watch
  - 159-form-saving
  - 516-production-release-queue
  - 600-merge-gate-symlink
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

### 422-FR-009 — `api` and `worker` MUST answer `GET /health/ready` with `checks` for `postgres`, `redis` and `storage` (the bucket answers; the storage check gives up after 2 seconds on its own too), each limited to 2 seconds and run in parallel, the deployed commit SHA as `version`, 200 when all are `ok` and 503 naming each failed check otherwise.

_From 422-private-file-storage._

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

### 422-FR-010 — One configuration module MUST read and check the environment at start; a missing required variable MUST stop the process and log the variable's name only, never a value. Required: `api` and `worker` — `APP_ENV`, `DATABASE_URL`, `REDIS_URL`, `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`; `web` — `APP_ENV`, `API_INTERNAL_URL`, `PUBLIC_WEB_URL`; `mcp` — `APP_ENV`. With defaults: `PORT` (set by Railway; a fixed port per app locally) and `RELEASE_SHA` (`dev`). The storage keys MUST NOT be sent to the browser.

_From 422-private-file-storage._

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

### 516-FR-001 — On every merge into `main` the pipeline MUST run every check on every project, build one image per app tagged with the commit SHA, push it to GitHub's container registry, migrate and deploy staging, wait for `/health/ready`, run the end-to-end suite against staging, and then promote to production with no manual approval. The staging wait for `/health/ready` is limited to 5 minutes; on expiry the run fails and nothing is promoted. Migrations run as `prisma migrate deploy` in the `api` pre-deploy command and MUST be backwards compatible, because the previous images may be restored.

_From 516-production-release-queue._

### 516-FR-002 — Once staging and its end-to-end suite pass, the pipeline MUST deploy the same image digests to production after the production migrations, wait for `/health/ready`, and restore the previous images and fail the run if the check does not pass within 5 minutes.

_From 516-production-release-queue._

### 516-FR-003 — Staging deploys and production deploys MUST each run one at a time, in commit order, and a deploy already running MUST NOT be cancelled by a newer commit: the newer one waits, and of several waiting only the latest proven commit runs next. There MUST be no path that deploys a branch or an unproven commit to production.

_From 516-production-release-queue._

### 421-FR-031 — A "Reset staging" workflow, started by hand, MUST empty, migrate and seed the staging database and MUST have no production target.

_From 421-monorepo-platform._

### 421-FR-032 — One root Dockerfile MUST build a production image for each app, selected by a build argument; the `mcp` image is built but not deployed.

_From 421-monorepo-platform._

### 421-FR-033 — Automatic dependency-update pull requests MUST be switched on.

_From 421-monorepo-platform._

### 516-FR-004 — The by-hand checks of the pipeline (a lint error blocks a merge; a stale client fails the contract check; a broken migration stops the run before staging; production deploys only after staging and its end-to-end suite pass; a production deploy is not cancelled by a newer merge; a failing production health check restores the previous images) MUST be listed in `specs/421-monorepo-platform/quickstart.md`, with a place to record the date and result of each.

_From 516-production-release-queue._

### 431-FR-001 — Every project with a Jest configuration (`apps/api`, `apps/worker`, `apps/web`, `apps/mcp`, `libs/contracts`, `libs/domain`, `libs/media`, `scripts`) MUST have its own `stryker.config.json` with a `thresholds.break` floor and an Nx `test:mutation` target.

_From 431-mutation-testing._

### 431-FR-002 — A project's mutation run MUST mutate only that project's non-test, non-generated TypeScript source and MUST run that project's own Jest configuration, with the same runtime options as its `test` target.

_From 431-mutation-testing._

### 431-FR-003 — A mutation run MUST report a mutation score and MUST exit non-zero when the score is below the project's `thresholds.break`.

_From 431-mutation-testing._

### 431-FR-004 — A mutation run for a project with no spec files MUST report that and exit zero without starting Stryker; such a project's floor is 0.

_From 431-mutation-testing._

### 431-FR-005 — Projects whose tests need PostgreSQL and Redis MUST reach them through the same `DATABASE_URL` / `REDIS_URL` as `npm test`.

_From 431-mutation-testing._

### 431-FR-006 — The root MUST provide `npm run test:mutation` (every project) and `npm run test:mutation:affected` (only projects affected relative to `main`), both through Nx.

_From 431-mutation-testing._

### 431-FR-007 — A standalone CI workflow, not the pull-request workflow, MUST run every project's mutation target (or the projects named when it is started by hand) nightly on `main` and on demand, one project at a time, in incremental mode with the incremental files cached between runs, against PostgreSQL and Redis service containers like the test step's; it MUST write one score line per project into the job summary and upload the reports as an artifact.

_From 431-mutation-testing._

### 431-FR-008 — The mutation workflow MUST fail when any project is below its floor or the job exceeds its time limit; each project's run MUST start by printing the project's name, so the failing or cut-off project is named in the output.

_From 431-mutation-testing._

### 431-FR-009 — A project's `thresholds.break` MUST start at 5 points below a measured score, rounded down, where one exists, and at 0 otherwise (no spec files, or not yet measured); `low` and `high` MUST be 60 and 80.

_From 431-mutation-testing._

### 431-FR-010 — Every project's `stryker.config.json` MUST be within what `config-protection.mjs` guards, and a harness eval case MUST show that lowering a `thresholds.break` is refused.

_From 431-mutation-testing._

### 431-FR-011 — The `mutation-runner` subagent and `/speckit-harden` MUST invoke the Nx targets and name this repository's projects, not the `npm -w apps/server` / `apps/scanner` form.

_From 431-mutation-testing._

### 431-FR-012 — Stryker's working files and reports MUST stay out of git.

_From 431-mutation-testing._

### 464-FR-001 — The watch command MUST list every worktree of the repository except PR-tester scratch worktrees and records whose directory is gone, each with path, branch, feature, phase, holder, last activity time and source, PR number, PR state, verdict and fix; `--json` MUST print the same rows plus the live QA runs and the dispatch plan.

_From 464-agent-watch._

### 464-FR-002 — Phase MUST be one of planning, tests, development, review, qa, merging, blocked, done, decided in this order: PR merged or closed → done; run-state `status` `blocked` → blocked; PR ready with every check passed and `agent-review` success on its head → merging; PR ready with an `agent-review` result on its head or a live QA run for it → qa; PR ready → review; run-state `status` `done` → done; run-state `phase` by this table — size, constitution, specify, context, clarify, plan, checklist, tasks, analyze → planning; tests → tests; implement, converge, harden → development; refresh, review, agent-context, retro, archive, hand-off → review; pr-test, qa → qa; merge → merging; any other value falls through — then the feature's artifacts (no `spec.md`, `plan.md` or `tasks.md` → planning; open tasks → development; every task done → review); no feature → development. Checks are the PR's status rollup without `agent-review`.

_From 464-agent-watch._

### 464-FR-003 — Holder MUST be `owner` for the main worktree; `live` when the worktree's lock names a pid whose process is a running `claude` process (for a `claude agent` lock, which carries the pid of the session that started the subagent, only while the worktree's last activity is within its phase threshold), when its lock names no pid (a lock set by hand), when a PR-tester run for its PR is running, or when it carries a claim younger than its phase's threshold; `dead` when the lock names a pid that is not running `claude`; `none` when it has no lock.

_From 464-agent-watch._

### 464-FR-004 — Last activity MUST be the newest of the branch head's commit time, the modification time of each file `git status` reports changed or untracked, and run-state's `updated`, with the source of the newest named.

_From 464-agent-watch._

### 464-FR-005 — A worktree MUST be stale when its phase is neither done nor blocked, its holder is neither `live` nor `owner`, and its last activity is older than its phase's threshold: planning 30, tests 45, development 45, review 30, qa 30, merging 30 minutes by default, each overridable with `--stale <phase>=<minutes>`.

_From 464-agent-watch._

### 464-FR-006 — Each stale worktree MUST get exactly one fix, the first that applies of `merge` (PR ready, checks passed, `agent-review` success on the head, the tree clean and at the PR head), `fix-ci` (a check on its open PR failed), `rerun-qa` (PR ready, checks passed, no `agent-review` result on the head), `resume` (anything else, an `agent-review` failure included); a done worktree whose PR is merged, whose tree is clean, whose `HEAD` is the PR's merged head and whose holder is not live MUST get `remove-worktree`; every other worktree gets none.

_From 464-agent-watch._

### 464-FR-007 — `--fix` MUST release the lock of every worktree whose holder is `dead` (and, just before removing it, the quiet subagent lock of a `remove-worktree` row), remove every worktree whose fix is `remove-worktree` without forcing, and prune records whose directory is gone; it MUST NOT delete a branch, force anything, or touch the main worktree or a tree with uncommitted changes, and MUST print each action taken.

_From 464-agent-watch._

### 464-FR-008 — The dispatch plan MUST contain the stale worktrees whose fix needs an agent, oldest activity first, with at most 4 QA runs (`rerun-qa`) live at once counting the live PR-tester runs and the live `rerun-qa` claims whose PR has no live run yet, and at most 2 other agent fixes live at once counting the watcher's own live claims.

_From 464-agent-watch._

### 464-FR-009 — `claim <path> <fix>` MUST write the claim to `<path>/.specify/.cache/watch-claim.json` (ignored by git), and a claim MUST count as a live holder only until it is older than that worktree's phase threshold.

_From 464-agent-watch._

### 464-FR-010 — Without `gh`, or when it fails, the command MUST still print every row, mark PR state unknown, and put nothing in the dispatch plan.

_From 464-agent-watch._

### 464-FR-011 — The `/speckit-watch` skill MUST run the command with `--fix`, claim each item in the dispatch plan, and start one subagent per item that works in that worktree with that fix's instructions, dispatching only from a session on the main checkout (a worktree-isolated session reports the plan instead); a pass with nothing to fix MUST write and dispatch nothing; the skill MUST say how the orchestrating session keeps it scheduled (CronList first, never a second job; every 15 minutes once two or more tasks or worktrees are active; never from a worktree session).

_From 464-agent-watch._

### 464-FR-012 — `scripts/heavy.sh` MUST default to 4 slots, and AGENTS.md MUST state that up to 4 PR-tester (QA) runs may run at the same time and name the watcher and how to repeat it.

_From 464-agent-watch._

### 159-FR-011 — The API's problem filter MUST keep an exception's `errors` list of `{ field, code }` (both strings) on the problem it sends, and send none when the exception carries no valid list (one malformed entry drops the list); the problem-details shape MUST be one type in the contracts library.

_From 159-form-saving._

### 516-FR-005 — When the deploy script receives SIGINT or SIGTERM it MUST stop waiting, restore every service the run touched to its previous image (redeploying the ones already live on the new one), and exit non-zero.

_From 516-production-release-queue._

### 600-FR-001 — The harness MUST offer one entry-point check that compares the real path of `process.argv[1]` with the real path of the calling module, and answers false (never throws) when either cannot be resolved.

_From 600-merge-gate-symlink._

### 600-FR-002 — Every hook in `.claude/hooks/` that runs only as the entry point MUST use that check; no hook may compare `process.argv[1]` with its module URL directly.

_From 600-merge-gate-symlink._

### 600-FR-003 — The merge gate started through a symlinked path MUST refuse a merge it refuses through the real path (exit 2).

_From 600-merge-gate-symlink._

## Retired

- `421-FR-013` — superseded by `422-FR-009` (2026-10-04)
- `421-FR-021` — superseded by `422-FR-010` (2026-10-04)
- `421-FR-028` — superseded by `516-FR-001` (2026-10-04)
- `421-FR-029` — superseded by `516-FR-002` (2026-10-04)
- `421-FR-030` — superseded by `516-FR-003` (2026-10-04)
- `421-FR-034` — superseded by `516-FR-004` (2026-10-04)
