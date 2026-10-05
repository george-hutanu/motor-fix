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
  - 450-pr-tester-env-gaps
  - 600-merge-gate-symlink
  - 623-precompact-flush
  - 659-merge-gate-carry-deadline
  - 673-story-tail-agents
  - 688-qa-wait-handoff
  - 698-tester-packet
  - 704-auto-phase-model-pins
  - 703-idle-watch-gate
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

### 703-FR-009 — The `/speckit-watch` skill MUST run the command with `--fix`, claim each item in the dispatch plan, and start one subagent per item that works in that worktree with that fix's instructions, dispatching only from a session on the main checkout (a worktree-isolated session reports the plan instead); a pass with nothing to fix MUST write and dispatch nothing; the skill MUST say how the orchestrating session keeps it scheduled (one background `watch.mjs --wait`, never a second; armed once two or more tasks or worktrees are active; never from a worktree session).

_From 703-idle-watch-gate._

### 464-FR-012 — `scripts/heavy.sh` MUST default to 4 slots, and AGENTS.md MUST state that up to 4 PR-tester (QA) runs may run at the same time and name the watcher and how to repeat it.

_From 464-agent-watch._

### 159-FR-011 — The API's problem filter MUST keep an exception's `errors` list of `{ field, code }` (both strings) on the problem it sends, and send none when the exception carries no valid list (one malformed entry drops the list); the problem-details shape MUST be one type in the contracts library.

_From 159-form-saving._

### 516-FR-005 — When the deploy script receives SIGINT or SIGTERM it MUST stop waiting, restore every service the run touched to its previous image (redeploying the ones already live on the new one), and exit non-zero.

_From 516-production-release-queue._

### 450-FR-001 — Without Docker, when a `minio` binary is on the PATH, the local plan MUST start MinIO on the lap's own API and console ports with its data inside the run directory and the apps' storage credentials, wait for it to answer, create the `motorfix` bucket (an existing bucket is fine), and stop it at teardown; the lap then reports storage booted.

_From 450-pr-tester-env-gaps._

### 450-FR-002 — When the plan has no object store and readiness fails only on `storage`, the review MUST carry that as a note and MUST NOT raise a finding; with an object store, or with any other check failing, readiness failure stays a blocking finding.

_From 450-pr-tester-env-gaps._

### 450-FR-003 — The tester MUST call every operation (GET, POST, PUT, PATCH, DELETE) of `apps/api/openapi.json` at the PR head that is new or different from the base, including operations with path parameters.

_From 450-pr-tester-env-gaps._

### 450-FR-004 — After migrating, the tester MUST run the PR's seed; a secured operation MUST be called with the access token of a seeded account signed in through the API: the role named by a path segment (`admin`, `garage`, `mechanic`, `receptionist`, `driver`), otherwise the driver. An operation under `/api/v1/auth/` also gets that account's refresh cookie.

_From 450-pr-tester-env-gaps._

### 450-FR-005 — A path parameter MUST be taken from the first item of the parent collection's GET (its `id`, or the field named like the parameter); a request body MUST be built from the operation's JSON schema: every required field, from its `example`, `default`, first `enum` value, `format` or type, honouring `minLength`, `minimum` and `minItems`; a required query parameter likewise.

_From 450-pr-tester-env-gaps._

### 450-FR-006 — Operations whose path names a sign-out MUST be called last; an answer of 500 or more MUST be a high finding; every call MUST be listed in the notes with its answer; every changed operation that could not be called MUST be listed by method and path with the reason; the note "No changed GET endpoint without path parameters" MUST be gone.

_From 450-pr-tester-env-gaps._

### 450-FR-007 — On SIGINT, SIGTERM or SIGHUP the run MUST write `report.json` and `report.md` with a blocker finding naming the signal and the phase it was in, then tear down.

_From 450-pr-tester-env-gaps._

### 450-FR-008 — `post.mjs --missing "<reason>" --pr <n> --sha <sha>` MUST post a failure verdict whose summary and blocker finding carry the reason, so `agent-review` on the head is failure.

_From 450-pr-tester-env-gaps._

### 450-FR-009 — A local lap's run directory MUST carry its process id; before a local lap boots, every PR-tester run directory and compose project whose process is gone MUST have its PostgreSQL, Redis and MinIO stopped, its compose project removed with volumes, its directory deleted, and `git worktree prune` run. A run whose process is alive MUST be left alone.

_From 450-pr-tester-env-gaps._

### 450-FR-010 — A sweep route MAY be written `path[@role][:status]`; with a status, an answer of that status MUST NOT raise a load, HTTP or console finding for that page, and any other status MUST raise a load finding.

_From 450-pr-tester-env-gaps._

### 450-FR-011 — A route with `@role` MUST be opened with a real session of that role's seeded account: signed in through the API for each browser context, its refresh cookie set on the web origin.

_From 450-pr-tester-env-gaps._

### 450-FR-012 — The PR QA workflow's routes check MUST accept `@` and `:` in routes and still refuse anything else outside paths.

_From 450-pr-tester-env-gaps._

### 450-FR-013 — `--tests` MUST run the affected unit tests with `--skip-nx-cache`, so they never come from the Nx cache.

_From 450-pr-tester-env-gaps._

### 450-FR-014 — The pr-tester agent definition MUST describe the storage note, running a `--local` lap in the background, posting `--missing` when a lap left no report, the route syntax and the endpoint calls.

_From 450-pr-tester-env-gaps._

### 600-FR-001 — The harness MUST offer one entry-point check that compares the real path of `process.argv[1]` with the real path of the calling module, and answers false (never throws) when either cannot be resolved.

_From 600-merge-gate-symlink._

### 600-FR-002 — Every hook in `.claude/hooks/` that runs only as the entry point MUST use that check; no hook may compare `process.argv[1]` with its module URL directly.

_From 600-merge-gate-symlink._

### 600-FR-003 — The merge gate started through a symlinked path MUST refuse a merge it refuses through the real path (exit 2).

_From 600-merge-gate-symlink._

### 623-FR-001 — The hook MUST NOT write to `auto-run.md` when the active feature's `spec.md` has a `**Status**:` line whose value begins with `Archived`, and MUST exit 0.

_From 623-precompact-flush._

### 623-FR-002 — The hook MUST still append its Compaction block for a feature whose status is not Archived.

_From 623-precompact-flush._

### 623-FR-003 — Each uncommitted entry in the block MUST keep the full porcelain line, both status columns included, for the first entry as for every other.

_From 623-precompact-flush._

### 659-FR-001 — The merge gate MUST refuse the merge (exit 2) when its GitHub reads do not finish within an overall deadline, and the refusal MUST say so.

_From 659-merge-gate-carry-deadline._

### 659-FR-002 — The merge gate MUST refuse the merge (exit 2) when reading the PR fails.

_From 659-merge-gate-carry-deadline._

### 659-FR-003 — The overall deadline MUST be shorter than `run-hook.mjs`'s limit for the gate, which MUST be shorter than the hook timeout declared for it in `.claude/settings.json`.

_From 659-merge-gate-carry-deadline._

### 659-FR-004 — `run-hook.mjs` MUST stop a fail-closed gate that outlives the gate's registered limit and refuse (exit 2); a fail-closed gate killed by a signal MUST refuse, not pass.

_From 659-merge-gate-carry-deadline._

### 659-FR-005 — Verifying a carry MUST read the statuses of the named commit, the commits between and head concurrently once the compare is known, and MUST read head's statuses at most once per gate run.

_From 659-merge-gate-carry-deadline._

### 673-FR-001 — `.claude/agents/task-runner.md` MUST pin `model: opus`, MUST NOT carry a `tools:` allowlist, and its `disallowedTools` MUST deny the artifact comment and data, browser, Chrome, simulator, visualize and session-management tools while denying none of Bash, Read, Edit, Write, Grep, Glob, Skill, Agent, ToolSearch, Monitor, TaskStop, EnterWorktree, PushNotification, Artifact (the design check's mock read), the WebStorm inspections (harden) or any Notion tool.

_From 673-story-tail-agents._

### 673-FR-002 — The story dispatch and the tail dispatch in `speckit-auto`, and step 4 of `speckit-watch` (resume, tail, rerun-qa, fix-ci, merge), MUST name `subagent_type: task-runner` and no story, tail or watch dispatch MUST name `general-purpose`; `merge` MUST keep `model: "sonnet"`; AGENTS.md MUST name the definition for the story and tail agents.

_From 673-story-tail-agents._

### 673-FR-003 — No dispatch template in `speckit-auto` or `speckit-watch`, and no agent definition, MUST tell an agent to follow or read AGENTS.md or CLAUDE.local.md, or list either among the files to read; `task-runner.md` MUST say they are in context and give the delta command.

_From 673-story-tail-agents._

### 673-FR-004 — `.specify/memory/constitution-card.md` MUST name every principle of `constitution.md` (numeral and title, in order) and its version, in at most 3,000 bytes; a harness spec MUST fail when they drift.

_From 673-story-tail-agents._

### 673-FR-005 — `speckit-auto`'s Preflight and phase 1 MUST read the card instead of the full constitution; `spec-reviewer`, `code-reviewer` and `pr-tester` MUST keep reading `constitution.md`.

_From 673-story-tail-agents._

### 673-FR-006 — The definition MUST carry the AGENTS.md reply envelope verbatim and a cap of at most 10 lines.

_From 673-story-tail-agents._

### 688-FR-001 — `dispatch.mjs <pr> --no-wait` MUST dispatch the PR QA workflow for the PR's head, find the run by its nonce, print one hand-off line (`- QA run: <id> · head <sha> · lap <n> · <url>`) and exit 0 without watching the run or downloading anything; exit 2 when no run appears.

_From 688-qa-wait-handoff._

### 688-FR-002 — `dispatch.mjs <pr> --run <id>` MUST dispatch nothing, read that run's conclusion, download its artifact into `--out` and judge the report exactly as a dispatched lap does (exit 0 success, 1 failure, 2 unusable, including a report about another head than the PR's).

_From 688-qa-wait-handoff._

### 688-FR-003 — The hand-off line MUST have one parser, shared by the watcher, that reads the run id and the head, and nothing from a note without the line.

_From 688-qa-wait-handoff._

### 688-FR-004 — `watch.mjs` MUST give a handed-off ready PR whose recorded QA run is about its current head the verdict `waiting` and no fix while CI is pending or has no checks, or the run is not completed, and its head has no `agent-review` success; the reason names what it waits for. A PR with no checks, or a run whose state cannot be read, waits only until the qa quiet threshold, then FR-006 applies.

_From 688-qa-wait-handoff._

### 688-FR-005 — `watch.mjs` MUST offer `tail` for such a PR once CI has finished and the run has completed, when no agent holds the worktree, without the phase's quiet threshold.

_From 688-qa-wait-handoff._

### 688-FR-006 — A handed-off ready PR with no run recorded, or one about an older head, MUST keep today's rule: `tail` once quiet past the threshold.

_From 688-qa-wait-handoff._

### 688-FR-007 — The hand-off (speckit-auto) MUST write the QA flows, dispatch the run with `--no-wait`, record its line in `handoff.md`, and end with `NEXT: tail #<n> after QA run <id>`; it starts no wait.

_From 688-qa-wait-handoff._

### 688-FR-008 — The session that receives that NEXT (or the owner-run story itself) MUST wait with one background command until CI and the QA run have finished, printing only what did not pass, then claim the worktree and dispatch the tail.

_From 688-qa-wait-handoff._

### 688-FR-009 — The tail MUST start the pr-tester on the finished run (`RUN`), never dispatch and wait itself; with no run for the PR's head it dispatches one with `--no-wait` and ends; an unusable run is dispatched again once per head without counting a lap, and a second one is posted `--missing` and blocks the run; after a fix it MUST push, count the lap with `run-state.mjs repair`, dispatch a run for the new head with `--no-wait`, rewrite the note's `QA run:` line and end with the same NEXT.

_From 688-qa-wait-handoff._

### 688-FR-010 — The pr-tester given `RUN` MUST skip writing flows and dispatching, download that run with `--run`, read the flows file that was sent, and raise a `high` "flow not run" finding for each flow from its own list (the spec's scenarios and the diff) that file does not drive.

_From 688-qa-wait-handoff._

### 688-FR-011 — `merge-gate.mjs`, `pr-lifecycle-gate.mjs`, `carry.mjs`, the repair cap and their eval cases MUST stay unchanged.

_From 688-qa-wait-handoff._

### 688-FR-012 — AGENTS.md lifecycle steps 4–6, speckit-pr-test and the speckit-watch `tail` row MUST describe the dispatch, end, resume loop.

_From 688-qa-wait-handoff._

### 698-FR-001 — A packet script under `.claude/scripts/pr-test/` MUST write `packet.md` into a given artifact folder holding `report.json`, containing: the PR number, title, branch, head and base; one line per changed file with additions and deletions (from `gh pr view --json files`), capped at 100 files with the rest counted, and exact totals; the report's verdict, summary and notes; and every blocker and high finding with severity, title, where and evidence, plus the medium and low findings by title.

_From 698-tester-packet._

### 698-FR-002 — The packet MUST list the FR ids touched by the change: the FR ids on the `tasks.md` lines that name a changed file's path, each with its text from `spec.md`, both read at the PR's head through the GitHub contents API; a line names a file when it contains the file's repo-relative path, and an id range `FR-a–FR-b` counts as every id in it; when the feature directory or either file is missing, or no task names a changed file, the section says which.

_From 698-tester-packet._

### 698-FR-003 — The packet MUST include the previous lap's findings, each marked new, persisting or resolved against the current report by the key `mergeFindings` already uses (`kind|title|route`). The source is the newest `specs/<feature>/pr-review/lap<n>/report.json` at the PR's head (a failing lap's report, committed with its fix, holding the tester's findings `post.mjs` folded in); when there is none, the baseline run's own `report.json` (the workflow's findings only, which the packet says) if that run tested this same PR; another PR's run never gives the previous lap.

_From 698-tester-packet._

### 698-FR-004 — The script MUST choose the baseline run as: an explicit baseline (a run id or a folder) when given; otherwise the newest finished PR QA run of the same PR at a different head than the one under review; otherwise the newest finished PR QA run whose tested commit is an ancestor of the PR's base branch; otherwise none. A finished run is one with conclusion `success` or `failure`, created before the run under review, whose artifact downloads with a `report.json`; any other candidate is skipped. It MUST name the chosen run (id, PR, commit, lap) or the reason there is none.

_From 698-tester-packet._

### 698-FR-005 — The packet MUST compare the screenshots of the run with the baseline's by content hash and list, per file name, the changed, new and removed screenshots, with the unchanged ones counted; it MUST name, as the screenshots to look at, the changed and new ones plus every screenshot a current finding cites, and every screenshot when there is no baseline; when none of the PR's changed files is a web file (the prefixes `findings.mjs`'s `touchesWeb` uses), it MUST name only the cited ones. Only image files count as screenshots.

_From 698-tester-packet._

### 698-FR-006 — The script MUST exit 2, writing nothing, when the folder has no `report.json`; a failing `gh` call or baseline download MUST NOT fail it: the affected section is marked unavailable with the reason and the script exits 0.

_From 698-tester-packet._

### 698-FR-007 — `.claude/agents/pr-tester.md` MUST tell the tester to build the packet right after the run's artifact is in its folder and, in the review, to read it before the report, the screenshots, the spec or the diff (the spec's first read, to list the flows, comes before the run); to open only the screenshots the packet names; and MUST keep `model: opus`, the full constitution review, the verdict rules and `post.mjs` posting unchanged.

_From 698-tester-packet._

### 698-FR-008 — `.claude/skills/speckit-pr-test/SKILL.md` MUST describe the packet step in its Test step.

_From 698-tester-packet._

### 698-FR-009 — The merge gate, its eval cases and `carry.mjs` MUST keep their behaviour: `merge-gate.mjs`, `.claude/evals/cases/merge-gate.json` and `carry.mjs` are not changed by this feature.

_From 698-tester-packet._

### 704-FR-001 — Under `/speckit-auto`, each of phases 2 (specify), 5 (plan), 6 (checklist) and 7 (tasks) MUST run as its own dispatched agent with its `model` set to the pin in that phase's skill frontmatter (a fixed list: those are the phase 2–8 skills whose pin differs from Opus).

_From 704-auto-phase-model-pins._

### 704-FR-002 — A phase whose skill pin equals the run's model (clarify and analyze on an Opus run) MUST stay inline; phases 9–14, the review fixes and the PR tester MUST stay on Opus regardless of any pin.

_From 704-auto-phase-model-pins._

### 704-FR-003 — A dispatched phase agent MUST produce the same artifacts, run the same spec-kit hooks and answer the same gates as the inline phase does today (the "Gate override" rules of `/speckit-auto` phases 2–8), and MUST open its reply with the four `STATUS:/PR:/NEXT:/FILES:` lines of AGENTS.md "Agent replies"; the run MUST treat a `failure` or `blocked` status as the inline phase's failure, never as a pass, and a `partial` one as a pass only when FILES names the phase's artifact and what failed is a Notion or mock write. A failed phase agent is not retried.

_From 704-auto-phase-model-pins._

### 704-FR-004 — The dispatch MUST be proven by one measured trial: a story run through `/speckit-auto` whose transcript shows every assistant turn of the dispatched phases served by the pinned model, recorded in the feature's run log with the transcript's path and the per-phase model list.

_From 704-auto-phase-model-pins._

### 704-FR-005 — The feature MUST record, in the run log, the cost of one story run before the change and one after, read from transcripts: per model, the count of assistant turns and the input, output, cache-creation and cache-read token totals; every measure that was not measurable MUST be named with its reason, and no estimate MAY stand in for a measurement.

_From 704-auto-phase-model-pins._

### 704-FR-006 — The `model:` line of every `speckit-*` skill MUST be unchanged, and the ST-467 mapping spec MUST stay green.

_From 704-auto-phase-model-pins._

### 704-FR-007 — Within `.claude/skills/speckit-auto/SKILL.md` the change MUST be confined to the phase 2–8 dispatch lines and the lines that describe the dispatch; the Hand-off, The wait and The tail sections and the lines listing the open, ready and merge commands MUST be identical to `origin/main`.

_From 704-auto-phase-model-pins._

### 704-FR-008 — `npm run test:harness`, `node .claude/scripts/harness-eval.mjs --check` and `node .claude/scripts/doctor.mjs` MUST pass on the branch; a harness spec MUST fail if a phase 2–8 dispatch line names a model other than that phase skill's pin.

_From 704-auto-phase-model-pins._

### 704-FR-009 — A phase agent the Agent tool cannot start on its pinned model (a tool error) MUST NOT stop the run: the phase runs inline on the run's model and the run log records the pin miss.

_From 704-auto-phase-model-pins._

### 703-FR-001 — `watch.mjs --gate` MUST run the same scan as the table, read-only (no fix applied, no claim written), and exit 0 with no output on stdout or stderr when the pass would do nothing: an empty dispatch plan and nothing the no-agent fixes would act on.

_From 703-idle-watch-gate._

### 703-FR-002 — When the pass would do something, `--gate` MUST exit 2 and print one line per item: each dispatch-plan entry and each no-agent action (dead holder, worktree removal, review carry, orphan lock, prune), naming the fix and the worktree or path.

_From 703-idle-watch-gate._

### 703-FR-003 — The gate MUST fire exactly when `--fix --json` on the same state would produce a non-empty plan or a non-empty action list; its verdict uses the table's detection unchanged and accepts the same `--stale` thresholds.

_From 703-idle-watch-gate._

### 703-FR-004 — An error MUST exit 1: a usage error, no git repository (no rows), or a scan that throws; `--gate` combined with `--fix`, `--json` or `--wait` MUST be a usage error. An unreachable `gh` is not an error: it leaves PRs unknown, the full pass dispatches nothing for them, and the gate is silent for them too.

_From 703-idle-watch-gate._

### 703-FR-005 — `watch.mjs --wait` MUST sleep its interval (default 15 minutes, `--every <minutes>`), then run the gate, and repeat while another full interval fits in its limit (default 110 minutes, `--for <minutes>`); it ends when the gate fires (exit 2 with the gate's lines), errors (exit 1), or no further interval fits, when it MUST exit 0 printing `watch: idle for <n> min; re-arm the wait`. It never sleeps past its limit. `--wait` accepts only `--every`, `--for` and `--stale`; a limit shorter than the interval, a non-positive number, or any other flag is a usage error.

_From 703-idle-watch-gate._

### 703-FR-006 — Only one wait MUST hold the repository at a time: a wait records its process in the git common directory, a second wait while that process lives MUST exit 0 at once printing `watch: a wait is already armed (pid <pid>)`, and a record whose process is gone (no such process, or its command line is not a `watch.mjs --wait`) MUST be taken over; the wait MUST remove its own record when it ends.

_From 703-idle-watch-gate._

### 703-FR-007 — `speckit-watch/SKILL.md` MUST describe arming the wait as a background command within the background limit, what each ending means keyed on the printed line, not the exit code alone (exit 2: run a full pass, then re-arm; `re-arm the wait`: re-arm; `already armed`: nothing; exit 1: report the error), that an existing `/speckit-watch` cron job is deleted once the wait is armed, and that a pass with nothing to do ends in one line; it MUST NOT instruct `CronCreate` for the watch.

_From 703-idle-watch-gate._

### 703-FR-008 — The AGENTS.md watch bullet MUST describe the wait instead of the cron string, and the session-start reminder MUST tell the session to arm the watch wait, naming neither `CronList` nor a cron string, and MUST print nothing when a live wait already holds the record.

_From 703-idle-watch-gate._

## Retired

- `421-FR-013` — superseded by `422-FR-009` (2026-10-04)
- `421-FR-021` — superseded by `422-FR-010` (2026-10-04)
- `421-FR-028` — superseded by `516-FR-001` (2026-10-04)
- `421-FR-029` — superseded by `516-FR-002` (2026-10-04)
- `421-FR-030` — superseded by `516-FR-003` (2026-10-04)
- `421-FR-034` — superseded by `516-FR-004` (2026-10-04)

- `464-FR-011` — superseded by `703-FR-009` (2026-10-05)
