---
capability: platform
updated: 2026-10-07
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
  - 696-lifecycle-script
  - 703-idle-watch-gate
  - 705-auto-skill-split
  - 432-mutation-floors
  - 725-lifecycle-gate-feature-dir
  - 693-notion-agent-tools
  - 610-dependabot-exemption
  - 678-measurable-sizing
  - 745-notion-api-limits
  - 750-ci-speed
  - 766-cloud-rest-fallback
  - 767-cloud-qa-merge
  - 602-watcher-counts-qa-runs
  - 677-zoneless-level-at
  - 628-tester-dispatch-cleanup
  - 675-size-not-trivial
  - 676-level-point-nonnumeric
  - 539-public-web-url-boot
  - 472-validation-failed-code
  - 481-watch-done-threshold
  - 775-level-at-parity
  - 783-api-test-boot-helper
  - 784-impossible-level-date
  - 815-specs-private-repo
  - 813-fable-to-opus
  - 457-diff-audit-tsconfig-imports
  - 728-active-feature-padded-fallback
  - 746-validate-archived-fr-assigned
  - 846-conflict-detect
  - 760-e2e-sign-up-limit
  - 691-author-skills-card
  - 437-diff-audit-origin-main
  - 849-work-timeline-row
  - 768-cloud-compose-pull
  - 845-archived-delta-adds
  - 706-packet-web-relap
  - 854-precompact-pr-signal
  - 850-dispatch-test-timeouts
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

### 481-FR-001 — A worktree MUST be stale when its phase is neither done nor blocked, its holder is neither `live` nor `owner`, and its last activity is older than its phase's threshold: planning 30, tests 45, development 45, review 30, qa 30, merging 30 minutes by default; the done phase MUST have a threshold too, 30 minutes by default, its grace period (FR-002); each is overridable with `--stale <phase>=<minutes>`, `done` included.

_From 481-watch-done-threshold._

### 481-FR-002 — Each stale worktree MUST get exactly one fix, the first that applies of `merge` (PR ready, checks passed, `agent-review` success on the head, the tree clean and at the PR head), `fix-ci` (a check on its open PR failed), `rerun-qa` (PR ready, checks passed, no `agent-review` result on the head), `resume` (anything else, an `agent-review` failure included); a done worktree whose PR is merged, whose tree is clean, whose `HEAD` is the PR's merged head, whose holder is not live and whose last activity is older than the done threshold MUST get `remove-worktree`; inside the threshold its verdict MUST be done with no fix and a reason naming its quiet minutes and the threshold; every other worktree gets none.

_From 481-watch-done-threshold._

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

### 854-FR-001 — The hook MUST NOT read the spec's `**Status**:` line; 854-FR-002 and 854-FR-003 are the only conditions under which it skips the Compaction block for an active feature with an `auto-run.md`.

_From 854-precompact-pr-signal._

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

### 691-FR-005 — `.claude/agents/task-runner.md` (:21-24) MUST say that `/speckit-auto`'s Preflight and phase 1 and the author skills read the card, and that the reviewers (`spec-reviewer`, `code-reviewer`) and the PR tester read the full `.specify/memory/constitution.md` themselves.

_From 691-author-skills-card._

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

### 706-FR-008 — `.claude/agents/pr-tester.md` MUST tell the tester to build the packet right after the run's artifact is in its folder and, in the review, to read it before the report, the screenshots, the spec or the diff (the spec's first read, to list the flows, comes before the run); to read the diff per changed file (or group of related files) with a targeted `git diff origin/<base>...<headRefOid> -- <paths>` drawn from the packet's "Changed files", never as one whole-PR diff file; to open only the screenshots the packet names; and MUST keep `model: opus`, the full constitution review, the verdict rules and `post.mjs` posting unchanged. The packet MUST write no whole-PR diff file and no "Review diff" section. (Replaces 698-FR-007 on "cut".)

_From 706-packet-web-relap._

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

### 704-FR-008 — `npm run test:harness`, `node .claude/scripts/harness-eval.mjs --check` and `node .claude/scripts/doctor.mjs` MUST pass on the branch; a harness spec MUST fail if a phase 2–8 dispatch line names a model other than that phase skill's pin.

_From 704-auto-phase-model-pins._

### 704-FR-009 — A phase agent the Agent tool cannot start on its pinned model (a tool error) MUST NOT stop the run: the phase runs inline on the run's model and the run log records the pin miss.

_From 704-auto-phase-model-pins._

### 696-FR-001 — `lifecycle.mjs open --title <t>` MUST, in this order: make the empty start commit when the branch has no commit ahead of `origin/main`; push with upstream to the feature branch; when the branch has no open PR, open a draft from the PR template with `planning`, the title's type label (`breaking` when the title has `!`) and `scope: <scope>`; then run the Notion `start` and `pr <n>` events.

_From 696-lifecycle-script._

### 696-FR-002 — `lifecycle.mjs ready --body-file <f>` MUST, in this order: file the unfiled `deferred.md` bullets with the Notion `debt` event; commit and push the feature records when they changed; run `pr-body-check.ts` and stop on failure; `gh pr edit --body-file`; `gh pr ready`; the Notion `qa` event; commit and push the `qa` line; write `handoff.md`.

_From 696-lifecycle-script._

### 696-FR-003 — `lifecycle.mjs merge` MUST run the merge gate on `gh pr merge <n> --merge` and refuse exactly when it refuses; otherwise merge, then run the Notion `finish` event, post one finish comment on the merged PR, restore `notion-sync.md` and delete `handoff.md`.

_From 696-lifecycle-script._

### 696-FR-004 — Every step MUST print exactly one JSON line on stdout: `ok`, the step, what it did, and on a stop `stopped` (the command or check) and `fix`.

_From 696-lifecycle-script._

### 696-FR-005 — When the Notion CLI exits 3, the step MUST stop and list the connector events left and the `--notion-done` rerun that completes the step.

_From 696-lifecycle-script._

### 696-FR-006 — Every git and gh command MUST first pass the Bash gates registered in `.claude/settings.json`, judged on that command's text, with the merge gate's test-only state variables removed from their environment.

_From 696-lifecycle-script._

### 696-FR-007 — No step MAY push from `main`, push to `main`, or force-push.

_From 696-lifecycle-script._

### 696-FR-008 — gh MUST run as george-hutanu: the caller's `GH_TOKEN`, else `gh auth token -u george-hutanu`; when that fails or prints nothing, the step MUST stop before any git or gh call.

_From 696-lifecycle-script._

### 705-FR-007 — `speckit-auto`'s `hand-off.md` and `tail.md` (the lines listing the ready and merge commands) and `speckit-git-commit/SKILL.md` (the first-commit recipe) name one `lifecycle.mjs` call per step instead of the recipe.

_From 705-auto-skill-split._

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

### 705-FR-001 — SKILL.md holds the frontmatter, User Input, Goal, Autonomy Contract, the run-order table with a reference-file column, Size, Run state, Hard Stops, Notifying, the Final Report envelope and the Agent Execution Rules deltas. Nothing else.

_From 705-auto-skill-split._

### 705-FR-002 — Every other section moves, unchanged in substance, to one of these files beside it: `preflight.md`, `phases-plan.md` (1–8), `phases-build.md` (9–12), `phases-close.md` (13–17), `commit-protocol.md`, `hand-off.md`, `tail.md` and `report.md`.

_From 705-auto-skill-split._

### 705-FR-003 — No rule is dropped, loosened or duplicated. `layout.spec.mjs` enforces this.

_From 705-auto-skill-split._

### 705-FR-004 — The harness specs that read speckit-auto keep their meaning and read the file that now holds their phrases: `tail-handoff-wiring`, `task-runner`, `agent-replies`, and `lifecycle-wiring` once #141 merges.

_From 705-auto-skill-split._

### 705-FR-005 — The stale text is corrected:

_From 705-auto-skill-split._

### 705-FR-006 — The report measures bytes with `wc -c`:

_From 705-auto-skill-split._

### 432-FR-001 — Each Angular project (`web`, `ui-cockpit`, `i18n`, `overlays`, `media`) MUST pass its unmutated test run under the mutation tool and report a score from the Mutation workflow.

_From 432-mutation-floors._

### 432-FR-002 — A spec that runs in the Node environment inside a browser-environment project MUST report its coverage to the mutation tool, so its project is not stopped for missing coverage.

_From 432-mutation-floors._

### 432-FR-003 — The test run MUST no longer fail with Angular's "Argument needs to be an object literal that is statically analyzable" (error 1010) when a module-level constant read by a component decorator is mutated. Only a constant whose sole use is compile-time component metadata (for example `styles`) is silenced, on its line, with the mutator and the reason.

_From 432-mutation-floors._

### 432-FR-004 — The mutation script MUST skip a project with no specs (`worker`) with a line saying so, without failing the run.

_From 432-mutation-floors._

### 432-FR-005 — Every surviving and uncovered mutant in `contracts`, `mcp` and `api` MUST be killed by a test or silenced on its line with `// Stryker disable next-line <mutator>: <reason>`.

_From 432-mutation-floors._

### 432-FR-006 — `contracts` MUST score at least its existing floor of 95.

_From 432-mutation-floors._

### 432-FR-007 — Each project's `thresholds.break` MUST be set to its measured score minus five, rounded down, never below 0 and never lower than its current value.

_From 432-mutation-floors._

### 432-FR-008 — `api` and `domain` MUST keep one test runner at a time (`concurrency: 1` in `apps/api/stryker.config.json` and `libs/domain/stryker.config.json`, already set by ST-431; unchanged here).

_From 432-mutation-floors._

### 432-FR-009 — The Mutation workflow's `timeout-minutes` MUST be set from the measured durations, with the derivation stated next to it.

_From 432-mutation-floors._

### 432-FR-010 — Every score and duration used for a floor or the limit MUST come from a Mutation workflow run on GitHub, never a local run; the run is linked in the PR.

_From 432-mutation-floors._

### 432-FR-011 — The survivors left in `domain`, `scripts` and the five Angular projects MUST each be filed as a tracked follow-up with its measured survivor count.

_From 432-mutation-floors._

### 432-FR-012 — The Mutation workflow MUST accept a dispatch input that runs without the incremental results of earlier runs, so a full measurement can be taken on demand; the nightly run stays incremental.

_From 432-mutation-floors._

### 725-FR-001 — The gate MUST resolve a branch's feature folder in one place: `.specify/feature.json`'s `feature_directory` when it is a path to a folder that exists, then `specs/<branch>` when it exists, then the `specs/` folder whose numeric prefix equals the branch's, compared as numbers, and whose slug equals the branch's slug.

_From 725-lifecycle-gate-feature-dir._

### 725-FR-002 — `prLinked` MUST read `notion-sync.md` from the resolved folder.

_From 725-lifecycle-gate-feature-dir._

### 725-FR-003 — `handedOff` MUST read `handoff.md` from the resolved folder.

_From 725-lifecycle-gate-feature-dir._

### 693-FR-001 — Both agents carry the current server's read tools: `org-researcher` lists `notion-search`, `notion-fetch`, `notion-get-comments`, `notion-query-data-sources` and `notion-get-tool-access`; `spec-reviewer` lists `notion-search`, `notion-fetch` and `notion-get-comments`. Today's id, `fd62790a-b7ca-480e-9cf5-9073c1192ba8`, is on both lists when this merges.

_From 693-notion-agent-tools._

### 693-FR-002 — No Notion write tool (a name starting `notion-create`, `notion-update`, `notion-move`, `notion-duplicate`, `notion-delete` or `notion-upload`, which covers `notion-create-comment`; the read tool `notion-get-comments` stays allowed), nor a whole-server grant (`mcp__<id>` or `mcp__<id>__*`), ever appears in either agent's tools or, for a Notion server, in `permissions.allow`.

_From 693-notion-agent-tools._

### 693-FR-003 — `.claude/scripts/notion-agent-tools.mjs` owns the list, with three commands: `check` (exit 1, one line per finding, when a Notion agent lists a server another lacks, a read tool outside its set, lacks one of its set for a listed server, or lists a write tool or whole-server grant, and when `.claude/settings.json` `permissions.allow` lacks a server the agents list or allows a Notion write tool or grant; exit 0 otherwise); `add <server-id or mcp__<id>__notion-* name>` (adds each agent its own read set and the union to `permissions.allow`; idempotent; refuses any other name); `detect` (reads the newest 20 transcripts under `~/.claude/projects/<project slug>/`, main checkout's slug first, collects `mcp__<id>__notion-*` names from their deferred tool lists only, exits 1 naming each id the agents lack, 0 when none is or with a note when no transcript exists).

_From 693-notion-agent-tools._

### 693-FR-004 — `doctor.mjs` runs `detect` and reports a missing id as a `warn` result, never a failure; a `check` finding (lists out of step, a write tool) is a `fail`.

_From 693-notion-agent-tools._

### 693-FR-005 — `org-researcher` and `spec-reviewer` check for a Notion tool first and, when none is present, report `[UNAVAILABLE: notion — no Notion tool in this agent; run node .claude/scripts/notion-agent-tools.mjs detect, then add <id>]`; the researcher writes it to `context.md` and its reply, the reviewer to its report and continues without Notion. `/speckit-context` and speckit-auto phase 3 tell the caller to run `detect` then `add` on that line.

_From 693-notion-agent-tools._

### 693-FR-006 — Harness specs cover the script (`check`, `add`, `detect` on fixture agent files and fixture transcripts) under vitest; the existing `.claude/agents/agent-replies.spec.mjs` and `npm run test:harness` stay green.

_From 693-notion-agent-tools._

### 610-FR-001 — `isDependabot` MUST also require every commit's committer login to be `web-flow` or `dependabot[bot]` and its signature to be verified; a commit with no committer data is not Dependabot's.

_From 610-dependabot-exemption._

### 610-FR-002 — Both gates MUST read the committers from the REST pulls commits API for a PR whose author is Dependabot, matched to the PR's commits by sha. In the merge gate a failed read refuses the merge with a retry; in the Stop gate (fail open) it leaves the commits without committer data, so the PR is not exempt.

_From 610-dependabot-exemption._

### 610-FR-003 — The merge gate MUST give an exempt Dependabot PR with a failing check its own refusal: it names the failing checks, never asks for the PR tester, says a pushed commit takes the exemption away, and points at `@dependabot rebase` / `@dependabot recreate` or closing it for a PR of one's own.

_From 610-dependabot-exemption._

### 678-FR-001 — Each session ledger MUST record, for every write, the level of the active feature and the phase from the run state at that moment, and MUST bucket the tokens consumed since the previous write under that (level, phase) pair, so a promotion mid-run splits the run's cost between the two levels, at the granularity of Stop writes (a turn lands whole in the level current at its Stop), rather than rewriting it.

_From 678-measurable-sizing._

### 678-FR-002 — The ledger MUST include the usage of every subagent transcript beside the session's transcript (the `subagents/` folder of the session), counting a streamed message once per `message.id`, attributing it to the agent type its meta file names (`unknown` when the file is missing), reading each file incrementally from its own byte offset, and including those tokens in the session's total and in the (level, phase) buckets.

_From 678-measurable-sizing._

### 678-FR-003 — `node .claude/scripts/telemetry.mjs --by-level` MUST print, per level, the token totals and, beside them, the tokens spent by subagents (absolute counts); under each level the totals per phase; and per feature its level and total; it MUST report tokens from ledgers that carry no level under "unknown level" and exit 0 when there are none at all. It MUST also list the features marked `too heavy` (FR-009).

_From 678-measurable-sizing._

### 678-FR-004 — The Stop hook MUST keep every failure path exiting 0 and MUST keep recording counts and token totals only — no prompts, message text or file contents, from the subagent transcripts either.

_From 678-measurable-sizing._

### 678-FR-005 — A check command on `level.mjs` MUST evaluate four tripwires for the active feature: (a) the count of functional requirements in `spec.md` above a threshold (more than 5, see Assumptions); (b) a `[NEEDS CLARIFICATION]` marker in `spec.md`; (c) a file under the contracts library, a Prisma schema or a migration in the branch's diff against `origin/main`; (d) files in more than one Nx project in that diff. Any tripped wire MUST raise the recorded level to at least 2; no wire MUST ever lower a level or touch a level already at 2 or 3.

_From 678-measurable-sizing._

### 678-FR-006 — Every promotion of a feature with a directory MUST append one line to its `auto-run.md` naming the old level, the new level and the fact that caused it (the count, the marker, the file or the projects), creating the file when it does not exist; a check that trips nothing MUST write nothing; the same promotion MUST NOT be logged twice.

_From 678-measurable-sizing._

### 678-FR-007 — `/speckit-auto` MUST run the check after the specify, clarify and tasks phases (the pre-ready check, FR-009, is the net for diff facts that appear during implementation); from a promotion on, it MUST run the phases the new level owes that have not run yet before continuing, in the run order they would have had.

_From 678-measurable-sizing._

### 678-FR-008 — A wire that cannot be evaluated (no remote, no diff) MUST report itself as not checked and MUST neither promote nor refuse on its own.

_From 678-measurable-sizing._

### 678-FR-009 — The ready step MUST run the check before publishing the PR body. A level 0 or 1 feature whose diff trips a wire MUST be promoted, the PR MUST stay a draft, and the step MUST exit non-zero naming the owed phases and the artifacts the level owes that are missing from the feature directory; a rerun once they exist MUST proceed. A level 2 feature whose diff against `origin/main` is exactly one file outside the contract, schema and migration paths MUST be recorded as `too heavy` in the ledger with the feature and the file, with no refusal and no level change. A level 3 feature is neither promoted nor marked by the ready step.

_From 678-measurable-sizing._

### 678-FR-010 — Nothing in this feature MUST read the level to decide whether tests run or which gates fire; the red-first, spec-drift and lifecycle gates MUST be left untouched.

_From 678-measurable-sizing._

### 678-FR-011 — `level.mjs suggest` given a story id (`ST-<n>`) or a Notion story URL MUST, before any classifier, Jev or model call, read the story's Issue type, Labels, Design, Design boards, Story points when present, and whether each Build brief section has content, and MUST print the level with the facts it used, or `unsure` with the reason and the facts read.

_From 678-measurable-sizing._

### 678-FR-012 — The sizing rules MUST be: the free word classifier runs on the story's text first; a Bug with no Design boards and every Build brief section filled is level 1 with no Jev or model call, unless the classifier answered 2 or more, which stands; a story with Design boards, an empty or missing Build brief section, or Story points above the threshold is never below 2; any other combination is `unsure` and continues with today's path on the story's text. Labels and Design are read and printed as facts but decide nothing. A rule MUST only ever raise the answer above what the text path would give, never lower it.

_From 678-measurable-sizing._

### 678-FR-013 — When Notion cannot be read (no token, network failure, page not found), `suggest` MUST print one line saying so and why, then behave as `suggest "<text>"` does today, exit 0. `--set` MUST keep writing only a confident answer.

_From 678-measurable-sizing._

### 678-FR-014 — The `speckit-size`, `speckit-auto` and `speckit-review` skill texts MUST describe the new check points, the promotion log line, the pre-ready refusal and `suggest` with a story id, in the lines that describe sizing and ready only.

_From 678-measurable-sizing._

### 678-FR-015 — Each tripwire MUST have one harness test that promotes a level 1 feature and one that leaves it alone; a test MUST show no wire lowers a level 3; the pre-ready refusal, the `too heavy` mark, the ledger's subagent and level buckets, the `--by-level` report and each `suggest` rule and its fallback MUST each have a harness test. `npm run test:harness`, `node .claude/scripts/harness-eval.mjs --check` and `node .claude/scripts/doctor.mjs` MUST pass, the latter after the hook edit is blessed.

_From 678-measurable-sizing._

### 678-FR-016 — The change MUST stay in the harness (`.claude/`, `.specify/`), with no file under `apps/` or `libs/`.

_From 678-measurable-sizing._

### 745-FR-001 — The client MUST pace its outgoing requests with a shared token bucket so that the sustained rate is at most 3 requests per second per client, allowing a burst up to the bucket's capacity of 3, independent of any 429 answer; the clock (`now`) is injectable.

_From 745-notion-api-limits._

### 745-FR-002 — The client MUST retry an answer of 429, 502, 503, 504, or 409 with code `conflict_error`, honouring a numeric `Retry-After` when present (raising at once when it exceeds `NOTION_SYNC_MAX_WAIT_S`, as today) and otherwise waiting `500 ms · 2^attempt · (1 + random())` clamped to `NOTION_SYNC_MAX_WAIT_S`, with `random` injectable; `NOTION_SYNC_MAX_RETRIES` caps the attempts.

_From 745-notion-api-limits._

### 745-FR-003 — The client MUST retry a timeout or network error on `GET` under the same caps, and MUST NOT retry one on `POST`, `PATCH` or `DELETE`.

_From 745-notion-api-limits._

### 745-FR-004 — `writeProp` MUST split a `title` or `rich_text` value into objects of at most 2,000 Unicode code points, at most 100 objects per array, and MUST raise a `NotionError` for a text that cannot fit; the same splitter is exported for comments.

_From 745-notion-api-limits._

### 745-FR-005 — `notion-sync` MUST post a comment body over 2,000 code points as `rich_text` objects produced by the shared splitter, and MAY keep posting a body of at most 2,000 code points as `markdown`.

_From 745-notion-api-limits._

### 745-FR-006 — `writeProp` MUST raise a `NotionError` for a relation of more than 100 ids, never truncating it.

_From 745-notion-api-limits._

### 745-FR-007 — The client MUST expose a block-children append helper that sends at most 100 children per request, in order, and MUST refuse locally, with a `NotionError` and no call, any request whose UTF-8 JSON body exceeds 500 × 1024 bytes.

_From 745-notion-api-limits._

### 745-FR-008 — `query()` MUST send `page_size: 100` on every page request unless the caller supplies its own `page_size`; the block-children read in `level.mjs` MUST keep sending `page_size=100`.

_From 745-notion-api-limits._

### 750-FR-001 — The end-to-end suite on CI MUST run its tests in parallel across the runner's cores, and every test in the suite MUST still run on every non-docs PR that affects `web`.

_From 750-ci-speed._

### 750-FR-002 — A non-docs PR push MUST create fewer runner jobs than today's 14, and every check that CI performs today (Biome, typecheck, unit, integration, e2e, build, harness, contract check, dependency audit, Docker build of web and api, compose stack) MUST still run and MUST still fail CI OK when it fails.

_From 750-ci-speed._

### 750-FR-003 — A failing check inside a shared job MUST be identifiable by name from the job's failed log, and the other checks of that job MUST still run and report.

_From 750-ci-speed._

### 750-FR-004 — A non-docs PR push MUST install dependencies fewer times than today's seven.

_From 750-ci-speed._

### 750-FR-005 — PR Docker builds MUST reuse a layer cache written by builds on `main`, and a change to the build's inputs (lockfile, Dockerfile, base image) MUST invalidate the affected layers.

_From 750-ci-speed._

### 750-FR-006 — Of several releases waiting for their checks on `main`, only the newest MUST run its checks; a release whose checks have started MUST run to the end and MUST never be cancelled; production MUST deploy only after staging passed for the same commit.

_From 750-ci-speed._

### 750-FR-007 — The semantics the merge gate relies on MUST be unchanged: CI OK fails when any check fails, is skipped-aware for docs-only PRs, and a PR with a failing, pending or missing check is never merged.

_From 750-ci-speed._

### 750-FR-008 — The documentation MUST describe the new layout: AGENTS.md's PR CI bullet lists the jobs as they are, and `docs/speed-and-cost-plan.md` records this change with the measured baseline and the measured result.

_From 750-ci-speed._

### 750-FR-009 — A docs-only PR MUST keep running only the change detector and CI OK.

_From 750-ci-speed._

### 750-FR-010 — On PR CI, an end-to-end test that passes only on retry MUST fail the E2E job; a run against a deployed address keeps today's retry tolerance.

_From 750-ci-speed._

### 766-FR-001 — With `CLAUDE_CODE_REMOTE=true`, `gh pr list|view|create|edit|ready|comment|checks` and `gh label create`, as the lifecycle scripts call them, MUST be answered through `gh api` REST calls with gh's output shape (`--json` fields, `--jq`/`-q`, the URL that `pr create` prints, gh's exit codes); any other gh command MUST run unchanged. Without it, gh MUST be called exactly as before.

_From 766-cloud-rest-fallback._

### 766-FR-002 — `lifecycle.mjs` MUST route its gh calls through FR-001 while still putting the original `gh …` command to the Bash gates first.

_From 766-cloud-rest-fallback._

### 766-FR-003 — `pr-lifecycle-gate.mjs` and `notion-sync.mjs` MUST read and write the PR through FR-001.

_From 766-cloud-rest-fallback._

### 766-FR-004 — `node .claude/scripts/gh.mjs <gh args>` MUST run one gh command through FR-001 (stdout, stderr and exit code passed through), and `pr checks --watch` MUST poll until no check is pending.

_From 766-cloud-rest-fallback._

### 766-FR-005 — `scripts/cloud-setup.sh` MUST put a Node 24 first on PATH and persist it for the session (one marked line in `~/.bashrc`, and in `CLAUDE_ENV_FILE` when set), reusing an installed Node 24 before installing one, and MUST install the chromium revision the installed `playwright-core` pins when it is missing; AGENTS.md "Cloud sessions" MUST say so and name `gh.mjs`.

_From 766-cloud-rest-fallback._

### 767-FR-001 — `.github/workflows/pr-qa.yml` MUST also run on `pull_request` (`ready_for_review`, `synchronize`, `reopened`) for non-draft PRs whose head is in this repository, with one concurrency group per PR that cancels older runs; `workflow_dispatch` stays.

_From 767-cloud-qa-merge._

### 767-FR-002 — The workflow MUST set `agent-review` on the tested head with its own `GITHUB_TOKEN` (`statuses: write`): pending at start, success only when the run passed with no blocking findings, failure otherwise.

_From 767-cloud-qa-merge._

### 767-FR-003 — With `CLAUDE_CODE_REMOTE=true`, `dispatch.mjs` MUST NOT call `workflow_dispatch`; it MUST read the PR over REST and find the `pull_request` run for the head SHA over REST.

_From 767-cloud-qa-merge._

### 767-FR-004 — With `CLAUDE_CODE_REMOTE=true`, `post.mjs` MUST NOT write the `agent-review` status: only the workflow sets it.

_From 767-cloud-qa-merge._

### 767-FR-005 — With `CLAUDE_CODE_REMOTE=true`, `lifecycle.mjs merge` MUST merge with `gh api -X PUT repos/{owner}/{repo}/pulls/<n>/merge -f merge_method=merge` and read and comment over REST, and `merge-gate.mjs` MUST read the PR over REST and apply the unchanged rule (agent-review success and every other check green); harness-eval cases MUST cover the cloud merge command.

_From 767-cloud-qa-merge._

### 767-FR-006 — AGENTS.md "Cloud sessions" MUST say QA starts by itself on ready or push and sets `agent-review`, and the merge goes over REST.

_From 767-cloud-qa-merge._

### 602-FR-001 — The watcher MUST read the `pr-qa.yml` runs from GitHub with one call per pass and keep those whose status is not `completed`, each with the PR number parsed from its run name.

_From 602-watcher-counts-qa-runs._

### 602-FR-002 — A worktree row whose PR has an Actions run in flight MUST be held (`live`), unless the row has a hand-off note whose recorded QA run tests the PR's head, which keeps its `waiting` verdict.

_From 602-watcher-counts-qa-runs._

### 602-FR-003 — The report's QA run count, its header and the dispatch plan's QA budget MUST count laptop runs and Actions runs in flight together.

_From 602-watcher-counts-qa-runs._

### 602-FR-004 — When the run list cannot be read, the watcher MUST count no Actions runs and otherwise behave as before.

_From 602-watcher-counts-qa-runs._

### 677-FR-001 — The JS pending-level reader MUST report no waiting level when `level_at` is a string without a time-zone designator (`Z` or `±hh:mm`), regardless of the machine's time zone.

_From 677-zoneless-level-at._

### 677-FR-002 — The Python pending-level reader MUST report no waiting level for the same input, so the two readers agree on every machine.

_From 677-zoneless-level-at._

### 784-FR-003 — A `level_at` of the one shape both readers parse alike (`YYYY-MM-DDTHH:MM`, optional seconds with an optional 3- or 6-digit fraction, then `Z` or `±hh:mm`) on a day its written month has MUST keep its current freshness behaviour in both readers; any other shape, or a day the month does not have, is no waiting level in both.

_From 784-impossible-level-date._

### 677-FR-004 — The Python-vs-JS parity test MUST include a fresh, zone-less `level_at` among its compared states, and both helpers MUST produce the same `feature.json` for it (the pointer alone, no level).

_From 677-zoneless-level-at._

### 628-FR-001 — Clearing `--out` before a lap MUST remove `run.log` and `observations.json` along with the report, the screenshots, the logs and `ci-run.json` it removes today, and MUST keep any other file.

_From 628-tester-dispatch-cleanup._

### 628-FR-002 — After a lap, whether its download succeeded or failed, no download folder MUST remain in `--out`, and the folder MUST be removed by exactly one cleanup step in the code.

_From 628-tester-dispatch-cleanup._

### 675-FR-001 — `NOT_TRIVIAL` in `.claude/scripts/level.mjs` MUST include remove, delete, drop, disable, page, screen, folder, directory, workflow and deploy, so a description with a trivial word and one of them is `unsure`.

_From 675-size-not-trivial._

### 675-FR-002 — The rename rule's `CODE_NAME` MUST name only what the code alone reads: helper, variable, function, method, constant (`const`), class.

_From 675-size-not-trivial._

### 675-FR-003 — The six descriptions from the story MUST classify as `unsure`; every existing `classifyLevel` expectation MUST hold.

_From 675-size-not-trivial._

### 676-FR-001 — `point` MUST print the level line only when `parseLevel(state.level)` is not null, and MUST print the default-level line otherwise, exiting 0. This is how `resolveLevel` already reads the level.

_From 676-level-point-nonnumeric._

### 676-FR-002 — A valid level written as a numeric string (`"1"`) MUST print as that level, the same way `resolveLevel` reads it.

_From 676-level-point-nonnumeric._

### 539-FR-003 — Reading `PUBLIC_WEB_URL` for the web server MUST throw an error naming the variable, without its value, when it is set but not an absolute URL, and return nothing when it is unset.

_From 539-public-web-url-boot._

### 472-FR-001 — A class-validator failure on `GET /api/v1/audit-history` from a signed-in caller MUST answer 400 with `code: validation_failed` through the production app setup.

_From 472-validation-failed-code._

### 472-FR-002 — A class-validator failure on `POST /api/v1/auth/roles/switch` from a signed-in caller MUST answer 400 with `code: validation_failed` through the production app setup.

_From 472-validation-failed-code._

### 481-FR-003 — Within the done threshold, a `claude agent` lock whose session runs, and a claim, MUST count as a live holder of a done worktree, as they do for every other phase (464-FR-003).

_From 481-watch-done-threshold._

### 481-FR-004 — `--gate` and `--fix` MUST follow FR-002: neither fires for nor removes a done worktree inside its grace period.

_From 481-watch-done-threshold._

### 775-FR-001 — Both readers of the waiting level MUST treat a stamp whose hour is outside `00`–`23` as no waiting level, in every stamp shape they accept (with or without seconds and a fraction, with `Z` or an offset).

_From 775-level-at-parity._

### 775-FR-002 — The two readers MUST give the same answer (the waiting level, or none, at the same `now`) for an hour-24 stamp, for every valid shape (`Z` or an offset, with or without seconds and a 3- or 6-digit fraction) and for every stamp both already refuse (no zone, minute 60, second 60, offset `+24:00` or `+23:60`, a trailing newline), and the harness specs that hold the two readers together MUST assert each of them so a later divergence fails the suite.

_From 775-level-at-parity._

### 783-FR-001 — `apps/api` MUST have one test-only boot helper: a handle created at module scope whose `start()` boots the API for an integration spec as production configures it (the test environment values the suites use today, the shared database turn taken, the in-process file store started, the configuration read and checked from those values, the application module compiled, the production app setup applied, the app started) and returns the started app, and whose `stop()` tears down whatever `start()` reached.

_From 783-api-test-boot-helper._

### 783-FR-002 — `stop()` MUST be safe to call whatever stage `start()` reached, including when it threw or never ran: it MUST attempt every close of what was opened (the app if it was created, the store if it started), in the order app, store, and MUST release the database turn in a `finally`; when a close throws, the remaining closes and the release still run and the first error is rethrown. A second `stop()` after the first is harmless, and a `stop()` that runs while `start()` is still in progress makes `start()` give back whatever it reaches and reject.

_From 783-api-test-boot-helper._

### 783-FR-005 — The helper MUST be covered by its own spec that proves FR-002 for a boot that throws at each stage and for a teardown whose close throws, making those stages fail with `jest.spyOn` in the spec, not through parameters of the helper.

_From 783-api-test-boot-helper._

### 784-FR-001 — Both readers of the waiting level MUST treat a stamp whose written day the written month does not have (29 February in a common year, 30 February, 31 in a 30-day month) as no waiting level, in every stamp shape they accept (with or without seconds and a fraction, with `Z` or an offset); the written year, month and day decide, not the instant the stamp parses to.

_From 784-impossible-level-date._

### 784-FR-002 — The two readers MUST give the same answer (the waiting level, or none, at the same `now`) for every stamp in acceptance scenarios 1–3, and the harness specs that hold the two readers together MUST assert each of them so a later divergence fails the suite; the JavaScript reader's answers MUST also be asserted on their own, without Python.

_From 784-impossible-level-date._

### 815-FR-001 — motor-fix MUST NOT track `specs/` (`.gitignore` names `/specs/`); `specs/` in every checkout is a clone of george-hutanu/motor-fix-specs on `trunk`, not a submodule.

_From 815-specs-private-repo._

### 815-FR-002 — `.claude/scripts/specs-repo.mjs ensure` MUST clone the private repository into `specs/` when it is missing or empty, adopt a non-repository `specs/` without losing a local file or change, and fast-forward an existing clone; `--soft` never fails (npm `prepare`, SessionStart).

_From 815-specs-private-repo._

### 815-FR-003 — `specs-repo.mjs commit "<msg>" [-- <paths>]` MUST commit the named paths (all by default) in `specs/` and push them to `trunk`, rebasing on a newer `trunk` and retrying when a push is refused.

_From 815-specs-private-repo._

### 815-FR-004 — `lifecycle.mjs ready` MUST commit the feature records and the qa line through the specs repository, and `merge` MUST read the finish lines from it and commit them there.

_From 815-specs-private-repo._

### 815-FR-005 — The lifecycle gate MUST refuse to stop while the specs clone has commits not pushed to `trunk`.

_From 815-specs-private-repo._

### 815-FR-006 — The PR tester's packet MUST read the feature's `tasks.md`, `spec.md` and lap reports from the private repository's `trunk`.

_From 815-specs-private-repo._

### 815-FR-007 — The bash guard MUST keep refusing a push to `main` and MUST allow a push to the specs repository's `trunk`.

_From 815-specs-private-repo._

### 813-FR-001 — `.claude/scripts/fable.mjs off` MUST write `env.ANTHROPIC_DEFAULT_FABLE_MODEL = "claude-opus-5-5"` into the main checkout's `.claude/settings.local.json` (resolved through `git rev-parse --git-common-dir`) and create or update `.claude/settings.local.json` in every desktop-app worktree under `.claude/worktrees/`, preserving every other key; `.worktrees/*` is not touched. A file it cannot parse stops it before any write; a file it cannot write stops it, naming the files already written.

_From 813-fable-to-opus._

### 813-FR-002 — `fable.mjs on` MUST remove that key from the same files, preserving every other key, and drop an `env` object it leaves empty.

_From 813-fable-to-opus._

### 813-FR-003 — `fable.mjs status` MUST print whether Fable or Opus is in force.

_From 813-fable-to-opus._

### 813-FR-004 — The model router MUST return `opus` wherever it would return `fable` when `ANTHROPIC_DEFAULT_FABLE_MODEL` is set or the main checkout's settings hold it, on both the mechanical large band and the Jev path.

_From 813-fable-to-opus._

### 457-FR-001 — The `import-extension` rule MUST take a changed `.ts`/`.tsx` file's resolution from the nearest `tsconfig.json` in its directory or an ancestor up to the repo root, merging `compilerOptions` along its relative `extends` chain (the child's value wins; JSONC comments and trailing commas allowed): `nodenext`/`node16` in `moduleResolution`, or in `module` when `moduleResolution` is unset, requires a literal extension on relative imports (`.js`, `.mjs` or `.cjs`, and also `.ts`, `.mts`, `.cts` or `.tsx` when `allowImportingTsExtensions` or `rewriteRelativeImportExtensions` is true); `bundler` forbids `.js`; anything else, or no tsconfig, is not judged.

_From 457-diff-audit-tsconfig-imports._

### 457-FR-002 — The rule MUST NOT depend on the file's path beyond locating that tsconfig.

_From 457-diff-audit-tsconfig-imports._

### 728-FR-001 — `activeFeature`'s branch step MUST take `specs/<branch>` when it exists, else the one `specs/` folder whose number equals the branch's number (leading zeros ignored) and whose slug equals the branch's slug.

_From 728-active-feature-padded-fallback._

### 728-FR-002 — The PR lifecycle gate's `featureDir` MUST use that same lookup from `.claude/scripts/lib/feature.mjs`, with its own branch, not a copy of it.

_From 728-active-feature-padded-fallback._

### 746-FR-001 — `validateFeature` MUST count a declared requirement as assigned when any capability holds `<feature number>-<id>` among its requirements or its retired ones.

_From 746-validate-archived-fr-assigned._

### 746-FR-002 — `validateFeature` MUST still warn `delta-unassigned` for a declared requirement that no Adds or Modifies names and no capability holds under the feature's number.

_From 746-validate-archived-fr-assigned._

### 846-FR-001 — The CI wait MUST read the PR's mergeable state before its first checks poll and on every later poll of the checks or the run, and MUST end at once with a distinct exit code (3, see Assumptions), documented in the script's header beside 0, 1 and 2, printing exactly `conflict: merge origin/main` and nothing else, when that state is CONFLICTING.

_From 846-conflict-detect._

### 846-FR-002 — The CI wait MUST treat UNKNOWN as "not yet known": it keeps polling under the existing limits (`SPECKIT_CI_NO_CHECKS_MIN`, `SPECKIT_CI_WAIT_MIN`) and never maps UNKNOWN to a conflict or to mergeable.

_From 846-conflict-detect._

### 846-FR-003 — The CI wait MUST keep its current behaviour for MERGEABLE PRs: exit 0 with only what did not pass and the run's conclusion, exit 1 at a limit, exit 2 on a gh failure, and a failure to read the mergeable state is a gh failure.

_From 846-conflict-detect._

### 846-FR-004 — In a cloud session the CI wait MUST read the mergeable state through the REST fallback, which MUST keep mapping REST `true`/`false`/`null` to MERGEABLE/CONFLICTING/UNKNOWN.

_From 846-conflict-detect._

### 846-FR-005 — The watcher MUST show a `conflict` verdict with the fix `merge-main` for every open, ready PR whose mergeable state is CONFLICTING and whose worktree no live agent or owner holds, before the `waiting`, `merge`, `tail`, `fix-ci`, `rerun-qa` and `resume` rules and without a quiet threshold; held rows stay `ok`, and draft, merged and closed PRs are judged as today.

_From 846-conflict-detect._

### 846-FR-006 — `merge-main` MUST be dispatched like `tail`: the dispatch plan admits `conflict` rows beside `stale` ones and the board's header counts them; it takes a QA place in the dispatch plan, counts toward the agent cap, is claimed on the worktree before dispatch, runs as `task-runner` on the default model (it may resolve code conflicts), and its instructions in `speckit-watch` tell it to merge `origin/main` into the branch (never a rebase, never a forced push), run the affected tests, push, dispatch the new head's QA run with `--no-wait`, and end; a merge it cannot finish, or tests that stay red, set the task to Blocked with the reason, never leaving the merge in progress.

_From 846-conflict-detect._

### 846-FR-007 — `watch.mjs --gate` MUST exit 2 and print one line per unclaimed `conflict` row in the dispatch plan (stateless: it fires on every pass until the row is claimed, within the QA cap), so a ready PR that turns CONFLICTING between passes wakes the orchestrator; with no conflict row the gate's answer MUST be unchanged.

_From 846-conflict-detect._

### 846-FR-008 — The watcher MUST read each PR's mergeable state from the one `gh pr list` it already runs per pass, on the laptop, never one request per PR; in a cloud session the list may carry none, and the state then reads UNKNOWN (see Assumptions).

_From 846-conflict-detect._

### 846-FR-009 — `speckit-auto/tail.md` MUST say what the session does when the wait ends on the conflict exit code (merge `origin/main` on the branch or dispatch `merge-main`, then a new QA run and a new wait; it is not a Hard Stop), and `speckit-watch/SKILL.md` MUST list `merge-main` in its fix table and `conflict` among the board's verdicts.

_From 846-conflict-detect._

### 846-FR-010 — Every behaviour above MUST be covered by harness specs written before the code (`ci-wait.spec.mjs`, `watch.spec.mjs`, `watch.adversary.spec.mjs`, `gh-rest` mapping, and `watch-schedule-wiring.spec.mjs` where the wait's documented endings change), run by `npm run test:harness`.

_From 846-conflict-detect._

### 760-FR-001 — Before a run that starts its servers locally, the end-to-end suite MUST delete every sign-up count key (`auth:signup:address:*`) in the Redis at `REDIS_URL`, and nothing else.

_From 760-e2e-sign-up-limit._

### 760-FR-002 — A run against `BASE_URL`, or without `REDIS_URL`, MUST clear nothing.

_From 760-e2e-sign-up-limit._

### 760-FR-003 — The sign-up count keys MUST keep the prefix the suite clears, `auth:signup:address:`.

_From 760-e2e-sign-up-limit._

### 691-FR-001 — The load step of each of the eight author skills — `speckit-specify` (SKILL.md:153), `speckit-clarify` (:74), `speckit-plan` (:63), `speckit-checklist` (:95), `speckit-tasks` (:72), `speckit-analyze` (:128), `speckit-implement` (:103), and `speckit-converge` (:105, the same defect in another `/speckit-auto` phase) — MUST name `.specify/memory/constitution-card.md` and MUST NOT name `.specify/memory/constitution.md` as the file to load.

_From 691-author-skills-card._

### 691-FR-002 — A load line MAY add one fallback, in exactly these words: "Open a principle's section in `.specify/memory/constitution.md` only when a decision turns on its exact wording." It may share the load line. No other line in an author skill MAY name the full file except the forms FR-003 lists.

_From 691-author-skills-card._

### 691-FR-003 — The existing pointer lines `Full text: \`.specify/memory/constitution.md\`.` in `speckit-plan`, `speckit-tasks`, `speckit-implement` (and `speckit-tests`) and the "Constitution Authority" paragraphs of `speckit-analyze` (:67) and `speckit-converge` (:91) MUST stay as they are; they are references, not loads.

_From 691-author-skills-card._

### 691-FR-004 — `speckit-specify`'s batch-read rule (:399, "Read the template, the constitution, and any repo files you need in one batch before writing") MUST name the card in place of the constitution.

_From 691-author-skills-card._

### 691-FR-006 — `.claude/agents/spec-reviewer.md`, `.claude/agents/code-reviewer.md` and `.claude/agents/pr-tester.md` MUST keep every line that reads `.specify/memory/constitution.md`; this feature changes none of them.

_From 691-author-skills-card._

### 691-FR-007 — `.claude/scripts/constitution-card.spec.mjs` MUST gain a test over the eight author skills' `SKILL.md` files that fails, naming the skill and the line, when a skill does not name `.specify/memory/constitution-card.md`, or when any line naming `.specify/memory/constitution.md` is not one of the allowed forms: the pointer line `Full text: \`.specify/memory/constitution.md\`.`, a line opening `**Constitution Authority**`, or a line holding the FR-002 fallback sentence verbatim **and** naming `.specify/memory/constitution-card.md` (so the fallback cannot ride on a line that loads the full file). Its existing tests (principles, version, size) MUST stay unchanged. It runs with `npx vitest run -c .claude/vitest.config.ts constitution-card`.

_From 691-author-skills-card._

### 691-FR-008 — The change MUST be the smallest that satisfies FR-001 to FR-007: no new script, helper, configuration or wording beyond the load lines, the batch-read rule, the runner's line and the one test (Principle I).

_From 691-author-skills-card._

### 437-FR-001 — diff-audit MUST take its base as `git merge-base HEAD origin/main`, and only when that ref is absent fall back to `git merge-base HEAD main`.

_From 437-diff-audit-origin-main._

### 849-FR-001 — Each status event `start`, `implement`, `qa`, `finish`, `blocked` and `unblock` that notion-sync runs for a story MUST upsert that story's Work timeline row: query the data source by `Key` = `ST-<n>`, update the first match, else create a row with Task (title) and Key both `ST-<n>`. `review` and every non-status event (`pr`, `debt`, `ready`, `log`, `check`) MUST NOT touch the Work timeline.

_From 849-work-timeline-row._

### 849-FR-002 — The step MUST write State and dates as mapped: `start` → In progress, Started = now only when empty; `implement` → In progress (Started as `start`); `qa` → QA, QA from = now only when empty; `finish` → Merged, Merged at = now; `blocked` → Blocked; `unblock` → QA when the row has QA from, else In progress. No other state (in particular `Queued`) is ever written.

_From 849-work-timeline-row._

### 849-FR-003 — With every write the step MUST set the row's page icon to the state's emoji (🔨 In progress, 🧪 QA, ✅ Merged, ⛔ Blocked; ⏳ Queued is never written), its `When` to the range Started (now when empty) → Merged at for a Merged row, else now + 2h, and `Took` to `"<total> total · build <b> · QA <q>"` once Merged, `"build <b> · in QA <q>"` in QA, `"<d> so far"` otherwise, with durations as `0m`, `<m>m` under an hour, else `<h>h<mm>`; `Took` is omitted when there is no Started. The same step MUST also write the timing onto the story page it already updates (stories data source): `Work` (the same range as `When`), `Started`, `QA from`, `Merged at` (each when set) and `Took`, so the story and the row agree. A date is read from the story first, else from the row.

_From 849-work-timeline-row._

### 849-FR-004 — The step MUST set `PR` to the story's PR URL when the event knows it (the story's `PR` property, else `--pr <n>` as the repository's PR URL) and omit it otherwise, and MUST set the `Ticket` relation (to the stories data source `326eee3c-abec-41d9-9f96-eb3bd545a802`) to the story's own page; it MUST never send the `Session` property (to the row or the story), nor any property the mapping does not name, so what the owner set by hand is kept.

_From 849-work-timeline-row._

### 849-FR-005 — The Work timeline write MUST fail open: any error (request, HTTP status, body) is caught inside `.claude/scripts/lib/work-timeline.mjs` (which holds the data source id `3706e923-2faa-42bc-aab2-8a2d5ab5d9d3` and the Notion version `2025-09-03` as constants and is called from notion-sync's status event after the story's own writes), logged as one line in `specs/<feature>/notion-sync.md` through the event's existing log, and never thrown, never changes the event's output or exit code, and never queues a PENDING replay line. A successful write logs one line with the row's change.

_From 849-work-timeline-row._

### 768-FR-001 — `scripts/cloud-setup.sh` MUST skip `docker compose pull postgres redis` when every image `docker compose config --images postgres redis` names is present locally (`docker image inspect`), and say so.

_From 768-cloud-compose-pull._

### 768-FR-002 — When an image is missing, or the compose file's images cannot be read, it MUST pull postgres and redis, and a failed pull MUST fail the script.

_From 768-cloud-compose-pull._

### 845-FR-001 — `validateFeature` MUST NOT report `delta-adds-existing` for a feature whose `spec.md` status line (`**Status**: Archived`, optionally followed by a date) marks it archived.

_From 845-archived-delta-adds._

### 845-FR-002 — For any other feature, `delta-adds-existing` MUST stay an ERROR, and every other rule MUST fire for archived and unarchived features alike.

_From 845-archived-delta-adds._

### 854-FR-002 — The hook MUST exit 0 and leave `auto-run.md` unchanged when the current branch is not the feature's branch, that is when `branchFeatureDir(repo, branch)` does not name the active feature's directory; a detached HEAD counts as not on it.

_From 854-precompact-pr-signal._

### 854-FR-003 — The hook MUST exit 0 and leave `auto-run.md` unchanged when the feature branch's PR state reads `MERGED`, read with `gh pr view <branch> --json state` through `ghSync` (`.claude/scripts/lib/gh-rest.mjs`) with a fixed 3 s timeout.

_From 854-precompact-pr-signal._

### 854-FR-004 — Any failure to read the PR state (no `gh`, no PR for the branch, a timeout, unparsable output) MUST result in the block being written.

_From 854-precompact-pr-signal._

### 854-FR-005 — The hook MUST NOT read the PR state when 854-FR-002 already decided to skip.

_From 854-precompact-pr-signal._
### 850-FR-001 — `dispatch.mjs` MUST read how many times it looks for the run from `PR_QA_POLL_TRIES` (a positive integer), defaulting to 36 when unset or invalid, in both the dispatched (laptop) and the pull_request (cloud) wait, and its "appeared within N s" message MUST use that count.

_From 850-dispatch-test-timeouts._

## Retired

- `421-FR-013` — superseded by `422-FR-009` (2026-10-04)
- `421-FR-021` — superseded by `422-FR-010` (2026-10-04)
- `421-FR-028` — superseded by `516-FR-001` (2026-10-04)
- `421-FR-029` — superseded by `516-FR-002` (2026-10-04)
- `421-FR-030` — superseded by `516-FR-003` (2026-10-04)
- `421-FR-034` — superseded by `516-FR-004` (2026-10-04)

- `464-FR-011` — superseded by `703-FR-009` (2026-10-05)

- `704-FR-007` — removed by 705-auto-skill-split (2026-10-06): (it fenced ST-697's own edit of SKILL.md to the dispatch lines; that change has merged
- `696-FR-009` — superseded by `705-FR-007` (2026-10-06)

- `464-FR-005` — superseded by `481-FR-001` (2026-10-07)
- `464-FR-006` — superseded by `481-FR-002` (2026-10-07)

- `677-FR-003` — superseded by `784-FR-003` (2026-10-07)

- `673-FR-005` — superseded by `691-FR-005` (2026-10-07)

- `698-FR-007` — superseded by `706-FR-008` (2026-10-07)

- `623-FR-001` — superseded by `854-FR-001` (2026-10-07)
