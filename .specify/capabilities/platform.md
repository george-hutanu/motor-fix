---
capability: platform
updated: 2026-10-18
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
  - 499-trace-matrix-delta-ids
  - 884-railway-egress
  - 891-lifecycle-story-override
  - 893-folder-rules
  - 960-traces-id-form
  - 962-gate-fail-closed
  - 974-stop-test-stack-on-merge
  - 976-integration-specs-under-load
  - 977-worktree-cleanup
  - 887-precompact-fr-wording
  - 1016-mcp-staging
  - 1018-notion-docs-to-specs
  - 1026-diataxis-docs
  - 1035-main-checkout-guard
  - 1037-remove-notion
  - 1119-drop-tracker-import
  - 251-monitoring-backups
  - 1167-constitution-e2e-on-demand
  - 1159-mutation-shards
  - 1170-integration-on-demand
  - 1168-chief-mods
  - 1171-qa-latency
  - 1201-static-cache-headers
  - 1182-cache-service
  - 1230-qa-harness-laps
  - 1175-valkey
  - 1200-transfer-cache-origin
  - 1169-prefetch-intent
  - 1176-replace-object-store
  - 1323-rest-not-graphql
  - 1324-retire-debt-and-ready
  - 1344-no-mutation-wait
  - 430-cdn-waf
  - 1019-staging-mcp-connect
  - 1174-postgres-18-pitr
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

### 421-FR-008 — Errors MUST be returned (Build brief A28, proposed; confirmed in the plan) as RFC 9457 problem details (`application/problem+json`) with a stable `code`; an unknown error MUST answer 500 with code `internal_error` and no stack trace.

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

### 1200-FR-006 — The hand-rolled carries of Home's tiles (`TILES`) and the garage profile (`profileKey`) MUST be removed once the cache covers them, the pages issuing the same reads in the browser as on the server: Home opened without a server render reads the tiles in the browser; the profile's server answer is used once; a gone profile (404, 410) keeps its status and gone state; Home's health checks stay a hand-written carry (`HEALTH`): the server reads `/health/ready` (a 503 report included) and hands it over, and every Home of the visit shows it, one opened in the browser after a redirect or a language change included; the browser never asks `/health/ready` itself, since on the page's origin the web server answers its own (421-FR-014) with the status alone; with nothing handed over they show "unknown". Home keeps showing "MotorFix", the deployed version (`dev` locally, the commit SHA when deployed) and "PostgreSQL: ok · Redis: ok" (or the failing part; "unknown" for both, and "version unknown", when the API does not answer), as 421-FR-019 required.

_From 1200-transfer-cache-origin._

### 421-FR-020 — The `web` server MUST forward `/api/` requests to the `api` service without buffering the response, close the upstream request when the browser goes away, and close the browser's response when the API breaks off. It answers its own `/health/*` and forwards none of it.

_From 421-monorepo-platform._

### 422-FR-010 — One configuration module MUST read and check the environment at start; a missing required variable MUST stop the process and log the variable's name only, never a value. Required: `api` and `worker` — `APP_ENV`, `DATABASE_URL`, `REDIS_URL`, `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`; `web` — `APP_ENV`, `API_INTERNAL_URL`, `PUBLIC_WEB_URL`; `mcp` — `APP_ENV`. With defaults: `PORT` (set by Railway; a fixed port per app locally) and `RELEASE_SHA` (`dev`). The storage keys MUST NOT be sent to the browser.

_From 422-private-file-storage._

### 421-FR-022 — The repository MUST hold no secret value: `.env.example` lists every variable name with no value, and `.env` is ignored by git.

_From 421-monorepo-platform._

### 421-FR-023 — `APP_ENV` MUST accept only `development`, `test`, `staging` and `production`.

_From 421-monorepo-platform._

### 421-FR-024 — Prisma (Build brief A6, proposed; confirmed in the plan) MUST manage the schema, one schema file per module in `domain`, with empty files for `auth`, `notifications`, `audit` and `events`. The first migration MUST create no product table.

_From 421-monorepo-platform._

### 421-FR-025 — The seed MUST be one command, idempotent, and MUST refuse to run when `APP_ENV` is `production`.

_From 421-monorepo-platform._

### 1175-FR-001 — Every store the repository starts MUST be Valkey 9 from the `valkey/valkey:9` image: `docker-compose.yml` service `redis`, the `redis` service of the integration job and the mutation workflow, the PR QA boot (through the PR's compose file), `scripts/backup/restore-drill.sh`; the service names `redis`, the environment names `REDIS_URL` and `REDIS_PORT`, the `redis://` scheme and the port 6379 stay as they are, and `scripts/cloud-setup.sh` and `scripts/test-services.ts` go on starting or pulling the service by that name.

_From 1175-valkey._

### 421-FR-027 — On every pull request CI MUST run install, typecheck, lint, unit tests, the contract check, the build of the affected projects, and a dependency audit of the production dependencies that fails on high and critical findings (the build tooling is kept current by the dependency-update pull requests instead). The API tests against real PostgreSQL and Redis (the integration suite) run on demand and before every release (1170-FR-002, 1170-FR-004).

_From 421-monorepo-platform; modified by 1170-integration-on-demand._

### 000-FR-001 — (replaces 516-FR-001) On every merge into `main` the pipeline MUST run every check on every project, build one image per app and the `keycloak` image tagged with the commit SHA, push them to GitHub's container registry, migrate and deploy staging — `api`, `worker`, `web`, `keycloak`, `mcp`, each waited for at its own health path (FR-004), a service whose Railway id is unset skipped with a notice (FR-007) — run the end-to-end suite's `@core` flows against staging (the whole suite runs there on demand only), and then promote to production with no manual approval. The staging wait is limited to 5 minutes per service; on expiry the run fails, the previous images are restored and nothing is promoted. Migrations run as `prisma migrate deploy` in the `api` pre-deploy command and MUST be backwards compatible, because the previous images may be restored.

_From 1016-mcp-staging._

### 000-FR-014 — (replaces 516-FR-002) Once staging and its `@core` end-to-end flows pass, the pipeline MUST deploy the same `web`, `api` and `worker` image digests to production after the production migrations, wait for `/health/ready`, and restore the previous images and fail the run if the check does not pass within 5 minutes. The production job MUST NOT deploy, reference or promote `mcp` or `keycloak`: its variables and the deploy script's production service list stay `web`, `api`, `worker` only (owner decision: staging only; production is a later task).

_From 1016-mcp-staging._

### 516-FR-003 — Staging deploys and production deploys MUST each run one at a time, in commit order, and a deploy already running MUST NOT be cancelled by a newer commit: the newer one waits, and of several waiting only the latest proven commit runs next. There MUST be no path that deploys a branch or an unproven commit to production.

_From 516-production-release-queue._

### 421-FR-031 — A "Reset staging" workflow, started by hand, MUST empty, migrate and seed the staging database and MUST have no production target.

_From 421-monorepo-platform._

### 000-FR-002 — (replaces 421-FR-032) One root Dockerfile MUST build a production image for each app, selected by a build argument; the `mcp` image is deployed to staging only. A second Dockerfile, `infra/keycloak/Dockerfile`, MUST build the `keycloak` image: the public image `quay.io/keycloak/keycloak:26.8`, one `COPY` of `infra/keycloak/realm-motorfix-assistants.json` into Keycloak's import folder, the start command `start --import-realm --features=cimd,resource-indicators --proxy-headers=xforwarded --http-enabled=true` and the JVM heap cap (FR-006); the `images` job builds and pushes it like the others and hands its digest to the staging job next to the `mcp` digest.

_From 1016-mcp-staging._

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

### 1159-FR-014 — The workflow MUST run on the cron `0 2 */3 * *` and on `workflow_dispatch` with inputs `projects`, `full` and `shards`; it MUST NOT run on pull requests.

_From 1159-mutation-shards._

### 1159-FR-019 — Each job MUST print its project (and shard) name first, so a failing or cut-off job is named in its output (kept from 431-FR-008).

_From 1159-mutation-shards._

### 431-FR-009 — A project's `thresholds.break` MUST start at 5 points below a measured score, rounded down, where one exists, and at 0 otherwise (no spec files, or not yet measured); `low` and `high` MUST be 60 and 80.

_From 431-mutation-testing._

### 431-FR-010 — Every project's `stryker.config.json` MUST be within what `config-protection.mjs` guards, and a harness eval case MUST show that lowering a `thresholds.break` is refused.

_From 431-mutation-testing._

### 1344-FR-004 — The `mutation-runner` agent MUST remain, its description saying it is invoked only by an explicit mutation review and naming no lifecycle command; the `test-adversary` description MUST NOT place it "before the mutation run".

_From 1344-no-mutation-wait._

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

### 977-FR-010 — The watch MUST report the fix `remove` (replacing `remove-worktree`) for every worktree that is not the main checkout, that nobody holds, and whose newest PR is merged or closed and quiet past the done threshold, or that has no PR and no activity for 7 days; an uncommitted change MUST no longer withhold the fix, while a head with commits on no remote MUST (no fix, reason "unpushed commits"). `--fix` and `/speckit-watch` MUST apply `remove` as a safe fix through the shared removal, admitting the no-PR rows; a refusal or failure is printed as a failed action with its reason and never stops the pass.

_From 977-worktree-cleanup._

_From 977-worktree-cleanup._

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

### 450-FR-001 — Without Docker, when the binary of the object store `docker-compose.yml` names is on the PATH, the local plan MUST start that store on the lap's own ports with its data inside the run directory and the apps' storage credentials, wait until its `motorfix` bucket exists, and stop it at teardown; the lap then reports storage booted.

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

### 450-FR-009 — A local lap's run directory MUST carry its process id; before a local lap boots, every PR-tester run directory and compose project whose process is gone MUST have its PostgreSQL, Redis and object store stopped, its compose project removed with volumes, its directory deleted, and `git worktree prune` run. A run whose process is alive MUST be left alone.

_From 450-pr-tester-env-gaps._

### 450-FR-010 — A sweep route MAY be written `path[@role][:status]`; with a status, an answer of that status MUST NOT raise a load, HTTP or console finding for that page, and any other status MUST raise a load finding.

_From 450-pr-tester-env-gaps._

### 450-FR-011 — A route with `@role` MUST be opened with a real session of that role's seeded account: signed in through the API for each browser context, its refresh cookie set on the web origin.

_From 450-pr-tester-env-gaps._

### 1230-FR-002 — A route MAY carry a query string: the PR QA workflow's routes check MUST accept `?`, `=`, `&` and `%` after the path, the sweep MUST open the route with its query, and the screenshot name MUST slug the full route so two routes differing only by query do not share a file. (Item 2; modifies 450-FR-012.)

_From 1230-qa-harness-laps._

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

### 887-FR-001 — The pre-compact hook MUST append its Compaction block to the active feature's `auto-run.md` whenever neither 854-FR-002 (HEAD is not on the feature's branch, a detached HEAD included) nor 854-FR-003 (the feature branch's PR reads `MERGED`) skips it, whatever the spec's `**Status**:` line says.

_From 887-precompact-fr-wording._

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

### 673-FR-001 — `.claude/agents/task-runner.md` MUST pin `model: opus`, MUST NOT carry a `tools:` allowlist, and its `disallowedTools` MUST deny the artifact comment and data, browser, Chrome, simulator, visualize and session-management tools while denying none of Bash, Read, Edit, Write, Grep, Glob, Skill, Agent, ToolSearch, Monitor, TaskStop, EnterWorktree, PushNotification, Artifact (the design check's mock read) or the WebStorm inspections (harden).

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

### 704-FR-003 — A dispatched phase agent MUST produce the same artifacts, run the same spec-kit hooks and answer the same gates as the inline phase does today (the "Gate override" rules of `/speckit-auto` phases 2–8), and MUST open its reply with the four `STATUS:/PR:/NEXT:/FILES:` lines of AGENTS.md "Agent replies"; the run MUST treat a `failure` or `blocked` status as the inline phase's failure, never as a pass, and a `partial` one as a pass only when FILES names the phase's artifact and what failed is a tracker or mock write. A failed phase agent is not retried.

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

### 696-FR-001 — `lifecycle.mjs open --title <t>` MUST, in this order: make the empty start commit when the branch has no commit ahead of `origin/main`; push with upstream to the feature branch; when the branch has no open PR, open a draft from the PR template with `planning`, the title's type label (`breaking` when the title has `!`) and `scope: <scope>`; then run the tracker `start` and `pr <n>` events.

_From 696-lifecycle-script._

### 1324-FR-012 — `lifecycle.mjs ready --body-file <f>` MUST, in this order: commit and push the feature records when they changed; run `pr-body-check.ts` and stop on failure; `gh pr edit --body-file`; `gh pr ready`; the tracker `qa` event; commit and push the `qa` line; write `handoff.md` (no `deferred.md` filing and no `Deferred:` line).

_From 1324-retire-debt-and-ready._

### 696-FR-003 — `lifecycle.mjs merge` MUST run the merge gate on `gh pr merge <n> --merge` and refuse exactly when it refuses; otherwise merge, then run the tracker `finish` event, post one finish comment on the merged PR, restore `tracker-sync.md` and delete `handoff.md`.

_From 696-lifecycle-script._

### 696-FR-004 — Every step MUST print exactly one JSON line on stdout: `ok`, the step, what it did, and on a stop `stopped` (the command or check) and `fix`.

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

### 725-FR-003 — `handedOff` MUST read `handoff.md` from the resolved folder.

_From 725-lifecycle-gate-feature-dir._

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

### 678-FR-012 — The sizing rules MUST be: the free word classifier runs on the story's text first; a Bug with no Design boards and every Build brief section filled is level 1 with no Jev or model call, unless the classifier answered 2 or more, which stands; a story with Design boards, an empty or missing Build brief section, or Story points above the threshold is never below 2; any other combination is `unsure` and continues with today's path on the story's text. Labels and Design are read and printed as facts but decide nothing. A rule MUST only ever raise the answer above what the text path would give, never lower it.

_From 678-measurable-sizing._

### 678-FR-014 — The `speckit-size`, `speckit-auto` and `speckit-review` skill texts MUST describe the new check points, the promotion log line, the pre-ready refusal and `suggest` with a story id, in the lines that describe sizing and ready only.

_From 678-measurable-sizing._

### 678-FR-015 — Each tripwire MUST have one harness test that promotes a level 1 feature and one that leaves it alone; a test MUST show no wire lowers a level 3; the pre-ready refusal, the `too heavy` mark, the ledger's subagent and level buckets, the `--by-level` report and each `suggest` rule and its fallback MUST each have a harness test. `npm run test:harness`, `node .claude/scripts/harness-eval.mjs --check` and `node .claude/scripts/doctor.mjs` MUST pass, the latter after the hook edit is blessed.

_From 678-measurable-sizing._

### 678-FR-016 — The change MUST stay in the harness (`.claude/`, `.specify/`), with no file under `apps/` or `libs/`.

_From 678-measurable-sizing._

### 750-FR-001 — The end-to-end suite on CI MUST run its tests in parallel across the runner's cores; it runs on demand (`workflow_dispatch`, which runs every test in the suite), not on every PR, and its core flows (tagged `@core`) MUST run against staging before every release.

_From 750-ci-speed; modified by 1167-constitution-e2e-on-demand._

### 750-FR-002 — A non-docs PR push MUST create fewer runner jobs than today's 14, and every check that CI performs today (Biome, typecheck, unit, build, harness, contract check, dependency audit, Docker build of web and api, compose stack) MUST still run and MUST still fail CI OK when it fails; the end-to-end suite (750-FR-001) and the integration suite (1170-FR-002) run on demand.

_From 750-ci-speed; modified by 1167-constitution-e2e-on-demand, 1170-integration-on-demand._

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

### 766-FR-003 — `pr-lifecycle-gate.mjs` and `tracker-sync.mjs` MUST read and write the PR through FR-001.

_From 766-cloud-rest-fallback._

### 766-FR-004 — `node .claude/scripts/gh.mjs <gh args>` MUST run one gh command through FR-001 (stdout, stderr and exit code passed through), and `pr checks --watch` MUST poll until no check is pending.

_From 766-cloud-rest-fallback._

### 766-FR-005 — `scripts/cloud-setup.sh` MUST put a Node 26 first on PATH and persist it for the session (one marked line in `~/.bashrc`, and in `CLAUDE_ENV_FILE` when set), reusing an installed Node 26 before installing one, and MUST install the chromium revision the installed `playwright-core` pins when it is missing; AGENTS.md "Cloud sessions" MUST say so and name `gh.mjs`.

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

### 1018-FR-002 — In every motor-fix checkout and worktree the specs clone MUST live at `<checkout>/.motor-fix-specs/`, ignored by git (`.gitignore` entries `/.motor-fix-specs/` and `/specs`, no trailing slash, so the link itself is ignored) and by Docker (`.dockerignore`), and `<checkout>/specs` MUST be a relative symlink (target `.motor-fix-specs/specs` or `.motor-fix-specs`, never an absolute path) that makes `specs/<NNN-slug>/...` resolve unchanged: to `.motor-fix-specs/specs` when the clone's own checked-out trunk has a top-level `specs/` directory (its layout), to `.motor-fix-specs` otherwise, so a clone not yet brought onto a moved `origin/trunk` keeps resolving (FR-003). `specs-repo.mjs` MUST export the clone's location and the docs location for other scripts.

_From 1018-notion-docs-to-specs._

### 815-FR-002 — `.claude/scripts/specs-repo.mjs ensure` MUST clone the private repository into `specs/` when it is missing or empty, adopt a non-repository `specs/` without losing a local file or change, and fast-forward an existing clone; `--soft` never fails (npm `prepare`, SessionStart).

_From 815-specs-private-repo._

### 815-FR-003 — `specs-repo.mjs commit "<msg>" [-- <paths>]` MUST commit the named paths (all by default) in `specs/` and push them to `trunk`, rebasing on a newer `trunk` and retrying when a push is refused.

_From 815-specs-private-repo._

### 815-FR-004 — `lifecycle.mjs ready` MUST commit the feature records and the qa line through the specs repository, and `merge` MUST read the finish lines from it and commit them there.

_From 815-specs-private-repo._

### 1018-FR-005 — Every script and hook that reads the clone's own git state or its trunk paths — the identity hook's clone check, the lifecycle gate's unpushed-specs refusal, `lifecycle.mjs` (its specs commit paths and diff), `worktree-remove.mjs`'s specs backup and the QA packet's report lookup on trunk — MUST resolve the clone through the location `specs-repo.mjs` exports and MUST work in both layouts, taking feature paths relative to `specs/` as today.

_From 1018-notion-docs-to-specs._

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

### 849-FR-002 — The step MUST write State and dates as mapped: `start` → In progress, Started = now only when empty; `implement` → In progress (Started as `start`); `qa` → QA, QA from = now only when empty; `finish` → Merged, Merged at = now; `blocked` → Blocked; `unblock` → QA when the row has QA from, else In progress. No other state (in particular `Queued`) is ever written.

_From 849-work-timeline-row._

### 849-FR-003 — With every write the step MUST set the row's page icon to the state's emoji (🔨 In progress, 🧪 QA, ✅ Merged, ⛔ Blocked; ⏳ Queued is never written), its `When` to the range Started (now when empty) → Merged at for a Merged row, else now + 2h, and `Took` to `"<total> total · build <b> · QA <q>"` once Merged, `"build <b> · in QA <q>"` in QA, `"<d> so far"` otherwise, with durations as `0m`, `<m>m` under an hour, else `<h>h<mm>`; `Took` is omitted when there is no Started. The same step MUST also write the timing onto the story page it already updates (stories data source): `Work` (the same range as `When`), `Started`, `QA from`, `Merged at` (each when set) and `Took`, so the story and the row agree. A date is read from the story first, else from the row.

_From 849-work-timeline-row._

### 849-FR-004 — The step MUST set `PR` to the story's PR URL when the event knows it (the story's `PR` property, else `--pr <n>` as the repository's PR URL) and omit it otherwise, and MUST set the `Ticket` relation (to the stories data source `326eee3c-abec-41d9-9f96-eb3bd545a802`) to the story's own page; it MUST never send the `Session` property (to the row or the story), nor any property the mapping does not name, so what the owner set by hand is kept.

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

### 499-FR-001 — `trace-matrix.mjs` MUST collect a feature's requirements only from plain `FR-XXX` ids in its spec.md, never from an id prefixed by a number and a hyphen (`NNN-FR-XXX`, or a shorter ST id such as `81-`).

_From 499-trace-matrix-delta-ids._

### 884-FR-001 — The web server MUST compress its own responses — the static files it serves (scripts, stylesheets, fonts) and the server-rendered HTML — for a client whose `Accept-Encoding` includes an encoding the server produces (gzip at least), MUST name the encoding and carry `Vary: Accept-Encoding` on the response and MUST send the uncompressed bytes to a client that accepts none. The one-year public cache header on content-hashed static files MUST stay as it is today.

_From 884-railway-egress._

### 884-FR-002 — Compression MUST NOT apply to the `/api/` proxy: a server-sent event stream relayed through the web server MUST reach the browser as the API sends it, unbuffered and with the API's own headers, and a proxied answer MUST NOT be re-encoded by the web server.

_From 884-railway-egress._

### 884-FR-003 — No compressed response MUST be larger than its raw body (already compressed types are passed through), and a `304 Not Modified` answer MUST stay bodiless.

_From 884-railway-egress._

### 884-FR-004 — When the end-to-end suite targets a deployed address (`BASE_URL` set), each worker MUST fetch each content-hashed asset of the deployment (`<name>-<8 letters or digits>.js|css|woff2`) from the deployment and, once a successful answer is cached, MUST answer later requests for it within that worker and that run from memory with the deployment's status, `content-type` and decoded body (no `content-encoding`, `content-length` or `transfer-encoding` replayed).

_From 884-railway-egress._

### 884-FR-005 — Only successful answers to hashed-asset requests MUST be cached; pages, API calls, uploads and any resource without a content hash MUST reach the deployment as today, and a test's own route stubs MUST take precedence over the cache.

_From 884-railway-egress._

### 884-FR-006 — The suite run with no deployed address (local and PR CI) MUST be unchanged: same tests, same workers, same retry and flake rules, no cache.

_From 884-railway-egress._

### 884-FR-007 — Every test that ran against staging before this change MUST still run there; the change MUST NOT drop, skip or filter any test.

_From 884-railway-egress._

### 884-FR-008 — The pull request MUST state the before figures (GB per staging end-to-end run and GB/day, with the measurement window) and the projected after figures with their arithmetic; the finish on the merged PR and the story's issue MUST record the GB sent by staging `web` during the first completed staging E2E run whose deployed digest includes the merge (read from Railway's metrics API at the finish, values never printed) and the resulting GB/day, or say "not measured" when it cannot be read.

_From 884-railway-egress._

### 884-FR-009 — The compression behaviour (FR-001 to FR-003) and the asset cache (FR-004 to FR-006) MUST each have failing-first automated tests beside the code they exercise, in line with Constitution II.

_From 884-railway-egress._
### 891-FR-001 — `lifecycle.mjs` MUST resolve the story for `open`, `ready` and `merge` in this order: `--story ST-<n>`, the `: ST-<n> ` of the title (`open`'s `--title`; the PR's title for `ready` and `merge`), `.specify/feature.json`'s `story` when its `story_for` names the current `feature_directory` (both compared as `featureKey`s, as `level_for` is), then `ST-<folder number>`. The title is read with the existing `: ST-<n> ` pattern.

_From 891-lifecycle-story-override._

### 891-FR-002 — `merge` MUST read the PR title and settle the story before the merge call, so a refusal (FR-003) comes before any irreversible step.

_From 891-lifecycle-story-override._

### 891-FR-003 — When any two explicit sources (flag, title, honoured feature.json) name different stories (compared by number, so `ST-0660` and `ST-660` agree), the step MUST stop with exit 1 before any side effect (no push, no `gh pr ready`, no merge, no tracker event, no feature.json write) with a message naming both sources and their values and the fix (`--story` or fixing the title). The folder number never causes a refusal.

_From 891-lifecycle-story-override._

### 891-FR-004 — `open`, `ready` and `merge` MUST accept `--story ST-<n>`; a value not matching `ST-<digits>` is a usage error (exit 64). A step given `--story` MUST, once the story is settled, record `story` and `story_for` (= `feature_directory`) in `.specify/feature.json` so later steps read it; a recorded `story` whose `story_for` names another feature is ignored, so repointing feature.json never carries it over.

_From 891-lifecycle-story-override._

### 891-FR-005 — A harness spec (`lifecycle.spec.mjs`) MUST cover a branch whose folder number is not the story's: the title wins over the folder, `--story` is recorded and read back, a `story_for` naming another feature is ignored, a disagreement refuses before the merge call (and `ready`), leading zeros agree, and a malformed `--story` exits 64.

_From 891-lifecycle-story-override._

### 893-FR-001 — The structure check MUST report every flat-submodule violation (rule 1) in the checked tree, as defined in Definitions, naming the file, the group key and the suggested subfolder.

_From 893-folder-rules._

### 893-FR-002 — The structure check MUST report every folder-component violation (rule 2) in `apps/web/src`, naming the file and the reason (inline template or styles, wrong folder or file name, wrong template or style path).

_From 893-folder-rules._

### 893-FR-003 — The structure check MUST NOT read `libs/ui-cockpit/`, `libs/data-access/`, `libs/domain/src/generated/` or `apps/web-e2e/`, and MUST only consider files tracked by git.

_From 893-folder-rules._

### 893-FR-004 — The structure check MUST exit non-zero when it finds a violation not listed in the baseline, or a baseline entry that no longer matches a violation, and exit zero otherwise.

_From 893-folder-rules._

### 893-FR-005 — The repository MUST carry a baseline, one entry per file and rule, listing only the violations that remain when this feature merges: those in a file an open pull request still edits, left for the change that follows it.

_From 893-folder-rules._

### 893-FR-006 — The baseline MUST only shrink. The config-protection ratchet MUST refuse an edit that raises its entry count, as it does for `.specify/trace-baseline.json`. The check, given a base ref (`--base <ref>`: `origin/<base_ref>` in PR CI, `origin/main` in pre-commit), MUST fail when the baseline holds an entry absent from that ref's baseline. A base ref with no baseline file, or no base ref (a push to `main`), skips that comparison.

_From 893-folder-rules._

### 893-FR-007 — The structure check MUST run in CI's Checks job as its own step, and in the pre-commit hook.

_From 893-folder-rules._

### 893-FR-008 — The Nx `@nx/angular:component` generator defaults MUST set `inlineTemplate: false` and `inlineStyle: false`, keeping `style: css`; AGENTS.md MUST give the `--path <area>/<name>/<name>` form that puts the component in its own folder (Clarification Q6).

_From 893-folder-rules._

### 893-FR-009 — AGENTS.md MUST carry a "Folder structure" section stating both rules, the definitions a reader needs to apply them, the out-of-scope paths, the baseline and how to run the check.

_From 893-folder-rules._

### 893-FR-010 — The constitution MUST state the folder rules under Principle IV with the structure check named in its Enforcement section, at the next minor version, and the constitution card MUST match.

_From 893-folder-rules._

### 893-FR-011 — The speckit plan template, tasks template and implement skill MUST name the layout so planned file paths follow it.

_From 893-folder-rules._

### 893-FR-012 — Tests MUST show: a flat module fails, an inline template fails, a misplaced component fails, a baselined entry passes, a stale baseline entry fails, and a grown baseline is refused. One test MUST run the rule 1 grouping over the `libs/domain/src/notifications/` listing as it stood before the move and find exactly the groups bell, brevo, news, preferences and push; another MUST show the checked tree holds no violation outside the baseline.

_From 893-folder-rules._

### 893-FR-013 — This feature MUST move every file that violates a rule into place (the owner, 2026-10-08: backfill in the same PR), taking the work ST-894 and ST-895 planned, and change no behaviour while doing it: imports and paths follow the files, inline templates and styles move to the component's `.html` and `.css` unchanged, and the affected projects' typecheck, tests, lint and build stay green. A file an open pull request edits stays in the baseline until that pull request merges.

_From 893-folder-rules._

### 1018-FR-018 — The traceability grammar MUST accept a feature number of three or more digits wherever it reads a feature folder (`NNN-slug`) or a feature-qualified requirement id (`<feature>-FR-NNN`): the `// @traces` line (`^\s*// @traces( \d{3,}-FR-\d{3})+\s*$`), the trace matrix, the capability specs and their Spec Delta, status, impact and retro evidence; the requirement number stays three digits, and a longer feature number is read whole, never as its last three digits.

_From 1018-notion-docs-to-specs._

### 960-FR-002 — The amendment MUST be versioned 1.11.0 (MINOR), with its Sync Impact Report first in the header, every earlier report (1.10.0 down to 1.0.0, 1.8.3 included) kept, and the Governance footer's version and Last Amended date updated.

_From 960-traces-id-form._

### 960-FR-003 — Every file that pins the constitution's version MUST say 1.11.0: the constitution card (whose Principle II line names the exception) and the private workflow notes' version line, which MUST NOT grow past its baseline; the card's drift test MUST pass.

_From 960-traces-id-form._

### 960-FR-004 — The traceability matrix MUST read a requirement id from a test file only when it sits on a conforming `// @traces` line, every id on such a line counted; it MUST report the same set of tagged ids on the current tree as before the change.

_From 960-traces-id-form._

### 960-FR-005 — The removal ratchet MUST read ids with the same line grammar as the matrix (one shared parser): an id removed from a conforming line is refused as today; an id in any other form is neither protected nor counted. Each tool keeps the set of files it reads today (the matrix walks `apps`, `libs`, `e2e`, `scripts`; the ratchet judges any test file it is handed).

_From 960-traces-id-form._

### 960-FR-006 — Every skill, agent definition, hook comment and gate message that today forbids `@traces` or any requirement id in source MUST state the exception (or stop stating the rule), and a gate message MUST NOT cite a constitution version (it cites the principle, so a later amendment cannot leave it stale).

_From 960-traces-id-form._

### 960-FR-007 — The existing tagged tests MUST all conform after the change; the one line carrying a non-requirement id is brought to the allowed form.

_From 960-traces-id-form._

### 960-FR-008 — Pre-commit traceability MUST stay non-blocking; only its explanatory comment changes.

_From 960-traces-id-form._

### 962-FR-001 — The hook wrapper MUST exit 2 when any registry entry marked `fail_closed` (all seven today) runs a script whose exit code is neither 0 nor 2 and that was not stopped by a timeout or a signal.

_From 962-gate-fail-closed._

### 962-FR-002 — That refusal MUST write one stderr line naming the entry id, the exit code the gate produced, that the gate has therefore not approved the request, the gate's script (`.claude/hooks/<script>`, the fix an agent can make) and `SPECKIT_DISABLED_HOOKS=<id>` as the way to disable the gate by id; the gate's own stdout, then its stderr, MUST be forwarded before it.

_From 962-gate-fail-closed._

### 962-FR-003 — A `fail_closed` entry whose script exits 0 or 2 MUST behave as today: output forwarded, exit code passed through.

_From 962-gate-fail-closed._

### 962-FR-004 — An entry not marked `fail_closed` MUST keep its script's exit code and output unchanged, whatever the code.

_From 962-gate-fail-closed._

### 962-FR-005 — Under `SPECKIT_HOOKS_DRY_RUN` the crash refusal MUST be written to stderr prefixed `DRY RUN —` and the wrapper MUST exit 0, as the stdin and timeout refusals do; for a fail-closed crash this line replaces the generic "would have blocked" report, which stays for exit 2 and for advisory hooks.

_From 962-gate-fail-closed._

### 962-FR-006 — `.claude/evals/cases/` MUST hold a case that, in a fixture repository, replaces a fail-closed gate's script with one that cannot load and expects exit 2 with the refusal on stderr, and a case that runs an advisory hook exiting 1 and expects exit 1; `.claude/evals/baseline.json`'s pass rate MUST not fall.

_From 962-gate-fail-closed._

### 962-FR-007 — `.claude/hooks/run-hook.spec.mjs` MUST cover FR-001 to FR-005 with specs written before the wrapper change (red first).

_From 962-gate-fail-closed._

### 962-FR-008 — The change touches only `.claude/hooks/run-hook.mjs` (code and header comment), its spec, the eval cases and the `fail_closed` sentence of `.claude/hooks/registry.json`'s `_comment`, which today names only the stdin refusal; no product code, no new environment variable, no registry field.

_From 962-gate-fail-closed._

### 974-FR-001 — Once the PR is merged, the lifecycle merge step MUST stop the test stack of the worktree that carries the PR's head branch (the current checkout when none does), before the tracker finish, keeping its volumes, and MUST name the stack in its result (`test_stack`).

_From 974-stop-test-stack-on-merge._

### 974-FR-002 — An absent, failing or hanging Docker (each call bounded by a 60 s timeout) MUST never fail the merge step, the tracker finish that follows it, or the sweep: the failure is one logged line and the step goes on; a `down` that fails for one stack does not stop the sweep reaching the others, and an unavailable `gh` skips only the PR-based judgements.

_From 974-stop-test-stack-on-merge._

### 977-FR-007 — `scripts/test-services.ts down` MUST accept `--volumes`, which removes the stack's volumes as well as its containers and network; without it, volumes are kept as today.

_From 977-worktree-cleanup._

### 974-FR-004 — `scripts/test-services.ts` MUST offer `sweep`, which stops every `mf-test-*` stack whose compose working directory no longer exists (volumes removed) or whose worktree's newest PR is merged or closed (volumes kept), leaves every other stack untouched, and prints one line naming what it stopped (or that nothing was).

_From 974-stop-test-stack-on-merge._

### 974-FR-005 — Every stack name used by the merge step, `down` and `sweep` MUST come from `composeProject` in `scripts/test-services.ts`; no other code derives the name.

_From 974-stop-test-stack-on-merge._

### 974-FR-006 — Each `/speckit-watch` pass MUST run the sweep as one of its safe fixes and include its result line in the pass output; a sweep failure never stops the pass.

_From 974-stop-test-stack-on-merge._

### 974-FR-007 — AGENTS.md's description of `scripts/test-services.ts` MUST say when the stack is stopped (merge, sweep, `down`).

_From 974-stop-test-stack-on-merge._

### 976-FR-001 — Every `libs/domain` integration spec MUST run its tests and hooks under an explicit 30-second limit, set once for `*.integration.spec.ts` files, so database setup and bulk work no longer fail on Jest's default 5-second limit on a loaded machine; unit specs keep the default, and a test or hook that still exceeds the limit fails with Jest's message naming it.

_From 976-integration-specs-under-load._

### 976-FR-002 — No `libs/domain` integration spec MUST sleep a fixed wall-clock interval and then assert that asynchronous work (a queued job, a published live message, a queue worker, an outbox relay, an e-mail) has finished. Each such wait is replaced by waiting for the asserted condition up to a deadline, or by faked time advanced past the window where no real I/O is awaited inside it.

_From 976-integration-specs-under-load._

### 976-FR-003 — A spec that proves an absence (nothing sent, not yet drained, no second message) MUST keep a proof at least as strong as before: faked time advanced past the window, or the sibling event that shows the window closed. Shortening the window or dropping the check is not a fix.

_From 976-integration-specs-under-load._

### 976-FR-004 — Each assertion that bounds elapsed real time (`Date.now() - started` under a fixed number) MUST be replaced by a proof of the same property that does not depend on machine speed, or measured under faked time; the property proved MUST be stated in the spec's description text so a reviewer can compare it with the bound it replaces.

_From 976-integration-specs-under-load._

### 976-FR-005 — No assertion is weakened, no test is skipped or deleted, and every spec that ran before still runs; each spec file MUST keep the same number of tests, and each replaced wait or bound MUST prove the same property or a stronger one.

_From 976-integration-specs-under-load._

### 976-FR-006 — CI behaviour MUST be unchanged: the same specs run with the same worker settings in the same jobs (the integration specs in the on-demand and release "Integration tests" job, 1170-FR-002); any worker-count change applies only to a by-hand run under `scripts/heavy.sh`, MUST stay above 1 worker, and is made only when the reproduction shows it is needed.

_From 976-integration-specs-under-load; modified by 1170-integration-on-demand._

### 976-FR-007 — One shared test helper in `libs/domain` MUST provide the wait-until-condition-or-deadline, with the condition's name and the deadline in its failure; every wait this change adds or replaces uses it, including the polling loops that gave up within two seconds. Loops that already wait 10 seconds or more are not load failures and stay.

_From 976-integration-specs-under-load._

### 976-FR-008 — The failure MUST be reproduced before the fix and shown gone after it: a repeatable procedure (a script or a documented command in the feature folder) puts the machine under artificial CPU load and runs the domain integration suite with the pre-commit's settings; its before and after results (which specs failed, how many runs) are recorded in the feature folder.

_From 976-integration-specs-under-load._

### 976-FR-009 — A spec that counts the outbox rows a request wrote (`cars/my-cars/cars/cars.api`, `garages/staff-invite/staff-invite.api`, `garages/garage-brands/garage-brands.api` and `.write.adversary`) MUST select them by a mark taken from the outbox itself before the request (the highest id), not by comparing the row's `created_at`, which the application stamps from the host clock, with a time read from the database clock; never by a sleep.

_From 976-integration-specs-under-load._

### 977-FR-001 — Worktree removal MUST be one shared implementation, `.claude/scripts/worktree-remove.mjs`, exposing an exported function and a CLI (`node .claude/scripts/worktree-remove.mjs <path>`), used by the lifecycle merge step, the watch and the tail; no other code removes a worktree.

_From 977-worktree-cleanup._

### 977-FR-002 — Before any side effect, the removal MUST refuse, with a reason and nothing changed: the main checkout; a worktree whose newest PR is open or whose PR state cannot be read; a worktree whose head has a commit on no remote (`git rev-list HEAD --not --remotes` non-empty); a worktree whose path contains the process's working directory; a worktree locked by hand (a lock naming no process), or by a live session unless the caller admits it (only the CLI does). A worktree with no PR MUST be refused unless the caller passes the option that admits it; the CLI never passes it.

_From 977-worktree-cleanup._

### 977-FR-004 — The removal MUST save the worktree's uncommitted product changes, tracked and untracked but not ignored, as `<worktree name>-<HHMMSS>.product.patch` in the same folder, a patch that applies on the branch's head; a clean tree writes no file and the result says so.

_From 977-worktree-cleanup._

### 977-FR-005 — A backup that fails (the specs push and the specs patch both fail, or the product patch cannot be written) MUST refuse the removal with the reason, leaving the worktree, its branch and its stack as they were.

_From 977-worktree-cleanup._

### 977-FR-006 — After the backup, the removal MUST take the worktree's test stack down with its volumes through `scripts/test-services.ts` (its `composeProject`, `down --volumes`, run with the worktree as working directory) and MUST also remove any leftover volume labelled with that compose project; Docker unavailable or a failing down MUST never block the removal and MUST be reported in the result's `test_stack`.

_From 977-worktree-cleanup._

### 977-FR-008 — The removal MUST then run `git worktree remove --force --force <path>`, `git branch -D <branch>` and `git worktree prune`, in that order, and MUST return (the function) and print (the CLI, one line on stdout) one JSON result `{path, removed, reason?, backup: {specs, product}, test_stack}`; the CLI exits 0 when removed, 1 when refused or failed, 2 with its usage on stderr when not given exactly one path. A failing step MUST stop the sequence, return `removed: false` with the reason, the backup and `test_stack` already made, and never retry or undo the backup.

_From 977-worktree-cleanup._

### 977-FR-009 — The lifecycle merge step MUST, as its very last step after the finish comment and the `handoff.md` deletion, remove the merged branch's worktree when that worktree is not the checkout the step runs in and no live session holds it (its lock names a process that is still running, however long idle); otherwise it removes nothing and reports `worktree: {removed: false, reason}`. A removal failure MUST never fail the merge step.

_From 977-worktree-cleanup._

### 977-FR-011 — The tail MUST remove its own worktree as its last action: it leaves the worktree (`ExitWorktree`, folder kept) and runs the removal CLI from the main checkout against the worktree's path, after the merge step has reported it did not remove it; `tail.md` describes this step.

_From 977-worktree-cleanup._

### 977-FR-012 — AGENTS.md (Parallel work) MUST state in one or two lines that a worktree is backed up and removed once its PR merges or closes and that inactive ones are swept, and the `speckit-watch` skill MUST describe the `remove` fix and what it refuses.

_From 977-worktree-cleanup._

### 977-FR-013 — Tests MUST exist before the implementation and MUST cover every refusal in FR-002 and FR-005 (each shown to make no changing call), the backup fallbacks of FR-003 and FR-004, the `test_stack` reporting of FR-006, the merge step's own-checkout and held cases (FR-009), and the watch's `remove` rows and refused actions (FR-010).

_From 977-worktree-cleanup._

### 000-FR-003 — The deploy script MUST take its service list per environment: staging `api`, `worker`, `web`, `keycloak`, `mcp` in that order; production `api`, `worker`, `web`. Each service reads `RAILWAY_SERVICE_<NAME>` and `IMAGE_<NAME>` as today, with one replica for `keycloak` and `mcp` on staging.

_From 1016-mcp-staging._

### 000-FR-004 — The health check path MUST be a property of each service: `/health/ready` for `api`, `worker`, `web`; `/health/live` for `mcp`; `/realms/master` for `keycloak` (Railway refuses a path with a `.` or a `-`; Keycloak opens its port only after the realm import), checked on the service's public port. The health timeout, the region and the restore on failure or cancel stay as they are (516-FR-001, 516-FR-005).

_From 1016-mcp-staging; path modified by 1021-keycloak-health-path and 1022-keycloak-health-hyphen._

### 000-FR-006 — The Keycloak image MUST cap the JVM heap through Keycloak's own heap variable set in the Dockerfile, without a per-service setting; the value is chosen in the plan with headroom for the realm import, and a test asserts the Dockerfile sets it.

_From 1016-mcp-staging._

### 000-FR-007 — When `RAILWAY_SERVICE_MCP` or `RAILWAY_SERVICE_KEYCLOAK` is empty on staging, the deploy script MUST skip that service alone, print one GitHub workflow notice naming the variable and that the service was not deployed, deploy every other service and exit 0. A set id with a missing `IMAGE_<NAME>` MUST fail naming the variable, as for every service today.

_From 1016-mcp-staging._

### 000-FR-008 — `infra/keycloak/README.md`'s Railway section MUST describe what the release does (the image, the health paths, the skip) and what the owner does once by hand: create the two services and set their ids on the GitHub staging environment, create Keycloak's own database and role in the staging PostgreSQL, and set, per service, every variable this feature needs — `api` and `mcp`: `MCP_URL`, `ASSISTANT_ISSUER`, `ASSISTANT_TRUSTED_DOMAINS`, `ASSISTANT_BROKER_CLIENT_ID`, `ASSISTANT_BROKER_CLIENT_SECRET`, `ASSISTANT_BROKER_REDIRECT_URI`; `mcp`: `DATABASE_URL` (the staging PostgreSQL, as `api`), `APP_ENV` and the three `OTEL_EXPORTER_OTLP_*` variables as on the other services; `keycloak`: the realm placeholders of the README's table without `ASSISTANT_ALLOW_HTTP`, `KC_DB=postgres`, `KC_DB_URL`, `KC_DB_USERNAME`, `KC_DB_PASSWORD`, `KC_HOSTNAME`, `KC_BOOTSTRAP_ADMIN_USERNAME`, `KC_BOOTSTRAP_ADMIN_PASSWORD` (removed after the first sign-in) — each marked as a secret the owner generates without printing, an address, or a name to copy; and the live connection check (Claude and ChatGPT, one read tool each) recorded on ST-1016 and ST-365.

_From 1016-mcp-staging._

### 000-FR-009 — No file, script, workflow or log of this feature MUST hold, print or read a secret value, a Railway service or environment id or a staging address (the project id `release.yml` already holds for `railway ssh` stays); only variable names appear (881-FR-012, 421-FR-022). `.env.example` already lists every variable name used here and gains none.

_From 1016-mcp-staging._

### 000-FR-013 — The deploy script's specs MUST cover the per-environment lists, the health path per service, the skip with its notice and the unchanged production list; the inventory script's spec MUST cover discovery across several service lists; the gauge's probe, its two values and its log line MUST be covered by the MCP server's colocated specs; the Keycloak Dockerfile MUST build in CI's Docker build job or an equivalent check so a broken `COPY` fails a PR.

_From 1016-mcp-staging._

### 1026-FR-004 — The specs repo root MUST hold exactly: `README.md` (the map for people: what each folder is, how to add a page), `llms.txt` (the agents' entry), `AGENTS.md` (how agents read and write the repo: where each kind goes, the front-matter rule, the lint, `llms.txt --write`, relative links, no Notion URLs), `.gitignore`, `.github/` (issue forms and the lint workflow), `scripts/` (the lint and its tests), `docs/`, `specs/` (every `NNN-slug` feature folder, unchanged) and `tracker/` (a README only, reserved for ST-1017's import, which writes `tracker/<KEY>/` for oversize issue bodies and files).

_From 1026-diataxis-docs._

### 1018-FR-003 — `specs-repo.mjs ensure` MUST migrate an existing old-layout clone at `<checkout>/specs/` in place and without data loss: rename it to `.motor-fix-specs/` and link `specs` to the clone root first (so `specs/<NNN-slug>` resolves after every step), then, when trunk has moved, bring it onto the moved trunk so that modified tracked files follow their renamed paths and unpushed commits stay ahead of trunk, sweep any `NNN-*` folder an unpushed commit added at the clone root into `specs/` as one commit, move every untracked or ignored file left at an old root feature path to `specs/<feature>/`, and only then repoint the symlink to `.motor-fix-specs/specs`. A step that fails MUST stop the migration with a non-zero exit naming the step; a failed rebase MUST be aborted, leaving the old-layout clone at `.motor-fix-specs/` linked at its root and every file where it was. A second run with nothing to do MUST change nothing. Two `ensure` runs in one checkout MUST serialise on an exclusive lock file in the checkout; the second waits, then finds nothing to do. `commit` MUST run the same migration first when trunk has moved since the clone was last brought up to date; `status` MUST never write and reports `layout: pending` instead.

_From 1018-notion-docs-to-specs._

### 1018-FR-004 — `ensure` MUST refuse, naming both paths, when `specs` exists as a real folder or a foreign symlink beside an existing `.motor-fix-specs/`, and MUST still adopt a plain `specs/` folder that is not a clone (as it does today) into the new location.

_From 1018-notion-docs-to-specs._

### 1018-FR-006 — `specs-repo.mjs migrate-trunk` MUST perform the trunk move as a separate, owner-run step: `--dry-run` MUST list every folder it would move and every file it would add and push nothing; the real run MUST require an explicit confirmation flag, refuse before any change when trunk has already moved or the clone is dirty or unpushed, refuse in both modes, naming it, any root entry that is neither an `NNN-*` folder nor on the keep list (`.github/`, `.gitignore`, `README.md`), move every feature folder with `git mv`, add the README and `docs/README.md`, commit and push to trunk, and print the next step (run the export). The commit is made on a temporary local branch and trunk is updated by the push alone; a failed push leaves the remote unchanged, deletes the temporary branch, exits non-zero naming the step, and leaves the clone as it was, so the command can be run again.

_From 1018-notion-docs-to-specs._

### 1026-FR-026 — No documentation content MAY land in motor-fix (public): its harness specs MUST use synthetic fixtures, and the one-off migration script that produced the organised result MUST live in `specs/1026-diataxis-docs/` as the feature's record, not under `.claude/scripts/`.

_From 1026-diataxis-docs._

### 1037-FR-005 — `/speckit-context` MUST write the story's issue, its comments, its epic's issue and the epic's other issues (`gh`, read only) to `specs/<feature>/story.md` before the `org-researcher` runs, and the researcher MUST read the tracker from that file only; `spec-reviewer` reads the issue with `gh issue view`.

_From 1037-remove-notion._

### 1037-FR-015 — A new epic's build plan MUST be written by `speckit-tracker-sync` (its `plan` step) under `docs/reference/build-plans/`, with `llms.txt` regenerated, in one specs-repo commit.

_From 1037-remove-notion._

### 1026-FR-023 — AGENTS.md, CLAUDE.local.md and the constitution MUST name the specs repo's `docs/` by its Diátaxis areas and `llms.txt` as the agents' entry wherever they named `docs/`, `docs/execution-plans/` or the export; CLAUDE.local.md MUST NOT grow past `.specify/context-baseline.json`; the constitution change MUST be a patch bump (v1.11.2 → v1.11.3) with a Sync Impact Report naming the lines, no rule added, removed or reworded, and the constitution card updated so `constitution-card.spec.mjs` passes.

_From 1026-diataxis-docs._

### 1026-FR-018 — After the reorganisation, `docs/index.json` MUST keep the shape `{ "exported": <ISO date of the frozen export>, "files": { "<notionId>": "<newPath>" } }`, MUST hold every Notion id the frozen export's `index.json` held, each mapped to the page's new relative path (the first page when a page was split, chosen so that a feature id maps to its feature page), or to `null` for a skipped pointer page, so ST-1017's import keeps resolving a story's Feature link; the lint MUST check that every non-null path resolves.

_From 1026-diataxis-docs._

### 1026-FR-001 — The organised documentation MUST be produced from the frozen Notion export (142 pages with `title`, `notion_id`, `notion_url`, `last_edited` front matter and its `index.json`), the design mock read once through the Artifact tool, and, for this migration only, one read of the Notion API for the 10 lost heading-level-4 texts and for the story/epic keys behind tracker URLs; nothing else; the raw export MUST never be committed or pushed to any repository, and the only thing pushed to the specs repo MUST be the organised result.

_From 1026-diataxis-docs._

### 1026-FR-002 — The specs repo (george-hutanu/motor-fix-specs, `trunk`) MUST be the only documentation source for motor-fix once this feature is merged: no motor-fix skill, agent, instruction file or constitution line MAY name the Notion space or a Notion page as a place to read documentation. The Notion tracker (stories, their comments, epics, build timelines) stays where ST-1017 leaves it and is out of this feature's scope.

_From 1026-diataxis-docs._

### 1026-FR-003 — Every exported page's body content MUST be present in the organised `docs/` (merged, split or moved, never dropped), the 10 heading-level-4 blocks the export lost MUST be recovered into their pages, and the 3 pointer pages the export skipped MUST be accounted for in the migration record (where each went, or why it has no page). A page that duplicates another page's content as a linked view (the 9 `untitled` area-view pages) is not dropped content: it counts as present through the page it duplicates, and the record names that page. A migration record in the feature folder MUST list, per Notion page id, its new path or paths and any content decision taken.

_From 1026-diataxis-docs._

### 1026-FR-005 — `docs/` MUST hold four Diátaxis folders, `tutorials/`, `how-to/`, `reference/` and `explanation/`, plus `index.json` (FR-018) and nothing else at its level. Each page's front-matter `kind` MUST equal the folder it sits under.

_From 1026-diataxis-docs._

### 1026-FR-006 — `docs/reference/` MUST hold: `features/<area>/mf-<nn>-<slug>.md` (lower-case file name; the `id` stays `MF-nn`), one file per feature page (59, one per MF-nn row of the export's features table), grouped by product area; the glossary; the sample world; the data model split into one file per section; the technology stack; the sequence diagrams; `build-plans/` holding each epic's execution plan as one file; the page layout guide; the delivery roadmap; and `design/` (FR-013).

_From 1026-diataxis-docs._

### 1026-FR-007 — `docs/explanation/` MUST hold the product overview, the architecture views, the ideas, the gaps, and `decisions/` holding one ADR file per decision: architecture A01–A44, to-decide T01–T12, owner decisions OD-01–OD-27, the review-round decisions by their ids (R1–R4, F, S, R6-T, U, V, W, X, Y), a defaults-applied page, a still-open page, and `index.md` listing every decision with its id, title and status.

_From 1026-diataxis-docs._

### 1026-FR-008 — Content the export holds that teaches a path end to end (onboarding, running the stack, a first story) MUST land under `tutorials/`, and task-shaped content (how to run QA, how to file a decision, how to add a page) under `how-to/`; where the export holds no such content, the pages the story names are written fresh from motor-fix's own instructions: tutorials "start on the project" and "your first story end to end"; how-tos "run a story through spec-kit", "release", "set a secret", "add observability", "run the tracker import" and "write a doc". A how-to or tutorial names a secret or environment variable by its name only, never by a value.

_From 1026-diataxis-docs._

### 1026-FR-009 — `llms.txt` MUST hold one line per Markdown page under `docs/` (design board HTML files and `index.json` excepted) in the form `<relative path>: <summary>`, where the summary is the page's front-matter `summary`, grouped under one heading per Diátaxis folder, and nothing else; it MUST be generated from the pages (FR-016), never written by hand.

_From 1026-diataxis-docs._

### 1026-FR-010 — Every Markdown page under `docs/` MUST open with YAML front matter holding exactly these fields: `id` (stable, unique across the repo, never changed once published: `MF-07`, `A12`, `OD-03`, `board-mobile-home`, or a slug for a page with no existing id), `title`, `kind` (`tutorial`, `how-to`, `reference` or `explanation`), `summary` (one sentence), `status` (`current`, `superseded` or `draft`), `updated` (ISO date `YYYY-MM-DD`; the export's `last_edited` on migration), `related` (a list of ids, possibly empty) and `supersedes` (an id or empty). No `notion_id` or `notion_url` field survives.

_From 1026-diataxis-docs._

### 1026-FR-011 — Every page MUST cover one topic and stay small ("small" is measured as at most 400 lines): a page longer than 400 lines MUST be split by section into pages that reference each other in `related` (the data model, the decisions page and the overview are the known cases). Diagrams MUST be Mermaid blocks or plain text, never images, except an image the export downloaded that has no text equivalent, which stays next to its page.

_From 1026-diataxis-docs._

### 1026-FR-012 — Every link in a page MUST be a relative path that resolves to a file in the repo (an optional `#heading` anchor included), or an external URL that is not a Notion URL. No `notion.so`, `notion.site` or `app.notion.com` URL MAY remain anywhere in the repo outside `specs/` feature folders. A story or epic pointer (`ST-<n>`, `EP-<n>`) MUST link to the matching GitHub issue of george-hutanu/motor-fix-specs when one exists and MUST stay as plain key text otherwise.

_From 1026-diataxis-docs._

### 1026-FR-013 — `docs/reference/design/` MUST hold the design mock "MotorFix — App Mock" (artifact `EoPWH9MHmuY5Jfw7vTWTHr`, v22) as files: `canvas.json`, the 35 board HTML files unchanged, one Markdown page per board (front matter as FR-010, `kind: reference`, the canvas page it belongs to — Desktop, Dashboards, Mobile, Copy 5 variants, Earlier directions —, a prose description of what the board shows and its states, and a relative link to its HTML file; the canvas page is stated in the body, since FR-010's eight front-matter fields are fixed) and `index.md` listing every board by canvas page with the mock version and the artifact URL labelled as the live view. A machine-readable board list (`index.json` in that folder: board id, title, canvas page, Markdown path, HTML path) MUST exist for ST-1017's import.

_From 1026-diataxis-docs._

### 1026-FR-014 — Every Design and Design-boards reference in the documentation MUST point at the board's Markdown page in the repo copy; the artifact URL MAY appear only as the secondary live-view link on the design index and on `speckit-design-check`'s `Checked` line.

_From 1026-diataxis-docs._

### 1026-FR-015 — The specs repo MUST hold `scripts/docs-lint.mjs`, a Node script with no dependencies outside Node's standard library, that exits non-zero, printing one line per finding with the file path and the defect, when: a Markdown page under `docs/` lacks front matter or a required field, or holds an invalid `kind`, `status` or `updated` (`YYYY-MM-DD` only), an `id` another page also carries, or a `related`/`supersedes` id no page carries; a relative link (image links included) does not resolve to a file, or its anchor to a heading in that file (anchors follow GitHub's heading-slug rule); a Notion URL appears in any file outside `specs/`; `llms.txt` lacks a page, names a page that does not exist, or carries a summary that differs from the page's; or a board named in the design index has no HTML or Markdown file. It MUST exit zero and print nothing else when none is found.

_From 1026-diataxis-docs._

### 1026-FR-016 — `docs-lint.mjs --write` MUST regenerate `llms.txt` from the pages' front matter (FR-009) and exit zero; a plain run right after MUST pass. The lint MUST have `node:test` tests under `scripts/` covering each finding kind, the clean case and `--write`, runnable with `node --test scripts/*.test.mjs`.

_From 1026-diataxis-docs._

### 1026-FR-017 — The specs repo MUST hold a GitHub workflow that runs the lint's tests and the lint on every push and pull request to `trunk`, so a defect shows as a failed check; it MUST need no secret.

_From 1026-diataxis-docs._

### 1026-FR-019 — This feature MUST NOT push to the `1017-github-project-tracker` branch or edit `.claude/scripts/tracker/import.mjs` on `main`; instead it MUST leave in `specs/1026-diataxis-docs/` a proposed patch for the import (emit the Design link to the repo copy from the design index; a check that no issue body links an old docs path or a Notion URL) and a one-paragraph note of the final import pass Chief runs after the merge.

_From 1026-diataxis-docs._

### 1037-FR-016 — `speckit-design-check` MUST read the story's Design and Design boards pointers from its issue and resolve them to `docs/reference/design/`.

_From 1037-remove-notion._

### 1026-FR-024 — `.claude/scripts/notion-export.mjs`, `.claude/scripts/notion-export/` (the render module and its fixtures), `notion-export.spec.mjs`, `notion-export.adversary.spec.mjs`, `notion-export-download.adversary.spec.mjs` and `render.spec.mjs` MUST be removed from motor-fix, together with every line, npm script, permission entry or instruction that names them; the harness spec that fails when the Notion space is named as a documentation source MUST drop its `(fallback until docs/ exists)` exemption and keep failing on the space's name in the rewired files (this feature's records excepted).

_From 1026-diataxis-docs._

### 1026-FR-025 — `specs-repo.mjs commit` MUST accept, besides `docs/…` and the feature folders, the root entries `README.md`, `llms.txt`, `AGENTS.md`, `.gitignore`, `scripts/…`, `.github/…` and `tracker/…`, and MUST keep refusing any other root path and any path that normalises outside the clone; `migrate-trunk`'s keep list is unchanged (the move already happened), but its README templates and hints stop naming `notion-export`.

_From 1026-diataxis-docs._

### 1026-FR-027 — Each rewiring in FR-020 to FR-025 MUST have a harness spec (vitest, `npm run test:harness`) written before the change that fails on the previous wording or behaviour and passes after; `node .claude/scripts/doctor.mjs` MUST pass on the branch.

_From 1026-diataxis-docs._

### 1035-FR-001 — A `PreToolUse` gate, `.claude/hooks/main-checkout-gate.mjs`, MUST refuse (exit 2) an `Edit`, `Write`, `MultiEdit` or `NotebookEdit` whose target path is tracked by git (`git ls-files --error-unmatch`) in the main checkout. The main checkout is judged from the target, not the session: the target's real path (symlinks resolved, nearest existing directory) lies in a repository whose `--git-dir` is the `--git-common-dir` of the session's checkout (`CLAUDE_PROJECT_DIR`, else the working directory). So a worktree session editing the main checkout's file by absolute path is refused too, and the specs clone (its own repository) is not. The refusal is one stderr message naming the file, stating that the main checkout holds no edits to tracked files and every change rides a PR from a worktree, and naming `SPECKIT_ALLOW_MAIN_EDIT=1`.

_From 1035-main-checkout-guard._

### 1035-FR-002 — The gate MUST let through (exit 0): any edit in a worktree (its git dir differs from the common dir); a path git does not track (`.work/`, `.claude/settings.local.json`, a new file; ignored paths are untracked, one `ls-files` decides); a path in another repository, the specs clone included; a payload with no path; and an edit it would refuse when `SPECKIT_ALLOW_MAIN_EDIT` is exactly `1` (any other value does not override), in which case it prints one stderr line that the override is in force. In a cloud session (`CLAUDE_CODE_REMOTE=true`) with `HEAD` not on `main`, it lets the edit through.

_From 1035-main-checkout-guard._

### 1035-FR-003 — The gate MUST fail open on git: git missing or failing, a path in no repository, or an unexpected error in its own code exits 0 and refuses nothing; it MUST finish in under 2 seconds on a cold run (three `git` calls at most on the laptop, four in a cloud session where `HEAD` is also read). A truncated or unparseable payload is refused by `run-hook.mjs` like every refusing gate (`fail_closed: true`).

_From 1035-main-checkout-guard._

### 1035-FR-004 — The gate MUST be registered in `.claude/hooks/registry.json` (id `pre:edit:main-checkout`, `PreToolUse`, matcher `Edit|Write|MultiEdit|NotebookEdit`, profiles `standard` and `strict`, `fail_closed: true`, its fingerprint blessed) and wired in `.claude/settings.json` through `run-hook.mjs pre:edit:main-checkout`, like the existing pre-edit gates; `node .claude/scripts/doctor.mjs` MUST be green afterwards.

_From 1035-main-checkout-guard._

### 1035-FR-005 — `.claude/scripts/watch.mjs` MUST judge the main checkout on every pass: `dirty: <files>` when tracked files are modified, staged or deleted (untracked excluded); otherwise `behind` when `HEAD` is on `main` and a strict ancestor of `origin/main` (the reason naming the count); else `ok` (a main checkout off `main` or diverged is not judged further). The watch does not fetch: every worktree shares the main checkout's refs, so `origin/main` moves whenever any checkout fetches or pushes. `behind` and `dirty` rows show the fix line `git -C <main> merge --ff-only origin/main`; the board, `--json` and the `--gate` lines carry it, so a `--wait` wakes the session for it.

_From 1035-main-checkout-guard._

### 1035-FR-006 — `--fix` MUST apply the fast-forward as a safe fix, `ff-main`, only for a clean `behind` main checkout, running exactly `git merge --ff-only origin/main` in it and recording the action; a dirty checkout is shown and never changed; a failure is a failed action with git's message.

_From 1035-main-checkout-guard._

### 1035-FR-007 — The session-start watch reminder (`.claude/hooks/session-watch-reminder.mjs`) MUST, when it runs in the main checkout, print one line when that checkout is behind or dirty (the same judgement as FR-005, naming the files or the count and the fix command), whether or not it also prints the arm-the-watch line; it MUST still print nothing in a worktree, stay under its timeout and always exit 0.

_From 1035-main-checkout-guard._

### 1035-FR-008 — AGENTS.md lifecycle step 7 MUST say in one line that after the merge the main checkout is fast-forwarded (`git -C <main> merge --ff-only origin/main`, by the orchestrating session, which `/speckit-watch`'s `ff-main` safe fix does when the watch reports `behind`); the `speckit-watch` skill MUST describe the main row's `behind`/`dirty` states and the `ff-main` safe fix in place of "the main worktree is shown, never fixed".

_From 1035-main-checkout-guard._

### 1035-FR-009 — The constitution MUST be amended to 1.12.0 (MINOR) with a rule that the main checkout holds no edits to tracked files, every change rides a PR from a worktree, and the orchestrating session fast-forwards the main checkout after each merge; its Sync Impact Report MUST record the bump, the source (ST-1035) and every file touched; the Enforcement table MUST gain a row naming `main-checkout-gate.mjs` (PreToolUse) and the watch's report; `.specify/memory/constitution-card.md` MUST carry the version and the rule in one line; CLAUDE.local.md MUST carry the version line and a gates-table row for the gate without growing past `.specify/context-baseline.json` (`context-audit.mjs` green), and `constitution-card.spec.mjs` MUST pass.

_From 1035-main-checkout-guard._

### 1035-FR-010 — Tests MUST exist before the implementation and MUST cover: every refusal and pass of FR-001 to FR-003 (tracked, untracked, ignored, worktree, a worktree session editing main by absolute path, specs clone, override, no path, git failure, cloud session) in a vitest spec `.claude/hooks/main-checkout-gate.spec.mjs`; at least two `.claude/evals/cases` entries (a tracked file refused with exit 2 and stderr naming the gate; an untracked file let through); the main row's three verdicts, the fix line and the `ff-main` safe fix (FR-005, FR-006) in `watch.spec.mjs`; the reminder's line (FR-007) in `session-watch-reminder.spec.mjs`.

_From 1035-main-checkout-guard._

### 1037-FR-001 — `.claude/scripts/notion-sync.mjs`, `notion-status.mjs`, `notion-ready.mjs`, `notion-agent-tools.mjs`, `lib/work-timeline.mjs`, their specs, the `speckit-notion-sync` and `notion-ready` skills and doctor's agent-tools check MUST be deleted.

_From 1037-remove-notion._

### 1037-FR-004 — No `.claude/agents/*.md` tools list and no `.claude/settings.json` permission or server entry MAY name an old-tracker server or tool; no allow entry is added.

_From 1037-remove-notion._

### 1037-FR-006 — `level.mjs suggest` given `ST-<n>` or a URL MUST size the text it was given (no tracker read).

_From 1037-remove-notion._

### 251-FR-012 — A scheduled workflow MUST run every day at 03:00 UTC and on `workflow_dispatch`, one job per environment (`staging`, `production`), each in its GitHub environment. An environment whose `RAILWAY_SERVICE_POSTGRES` variable is unset MUST be skipped with a notice and MUST NOT fail the run; one whose variable is set but whose backup settings (`BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_GPG_PASSPHRASE`) are incomplete MUST fail naming the missing setting. A failed run is the backup alert at launch.

_From 251-monitoring-backups._

### 251-FR-013 — The dump MUST run inside the environment's PostgreSQL service over `railway ssh` (the service's own tools, PostgreSQL 18): one transaction-consistent snapshot that produces the dump in PostgreSQL's custom format and a manifest (JSON: environment, UTC timestamp, database server version, the encrypted object's size (`dump_size_bytes`, which the drill checks before it downloads), and the row count of every table in `public` taken in the same snapshot). Both MUST be streamed back to the runner, the dump encrypted with symmetric AES-256 (`gpg`) under the passphrase secret before it touches the runner's disk, and uploaded to the S3-compatible bucket as `<environment>/<timestamp>.dump.gpg` and `<environment>/<timestamp>.manifest.json`. The run's log MUST never print the passphrase, the keys, the database URL or the dump.

_From 251-monitoring-backups._

### 251-FR-014 — After a successful upload the job MUST delete that environment's objects older than 30 days and MUST NOT delete anything when the upload failed; the retention is one constant in the script.

_From 251-monitoring-backups._

### 251-FR-015 — A restore drill script MUST, given a backup key (default: the environment's newest), download and decrypt it, restore it into a fresh throwaway PostgreSQL of the manifest's major version (`ghcr.io/george-hutanu/motor-fix-postgres:<major>`, PostGIS available; `DRILL_IMAGE` overrides) (removing a leftover one first), compare every table's row count with the manifest and fail on any difference naming the table, boot the API against it with the compose Redis and object storage and require `GET /health/ready` 200, print the duration of each step and the total, and tear the database down. A workflow MUST run it on `workflow_dispatch` and on the first day of every quarter on staging's newest backup; its failure is the alert.

_From 251-monitoring-backups._

### 251-FR-016 — The drill MUST time each step in the order download, decrypt, restore, compare, build, boot and print the total; it MUST be run once during this story on staging's backup, and the specs repo MUST gain a runbook (`docs/how-to/`) with the backup and restore steps, the secret and variable names, the measured time of each step, the recovery time and the data-loss window against the targets (back within 4 h; at most 15 min of data lost, met by point-in-time recovery, whose drill measures it), the on-call and admin-list steps and the source-map check of FR-010.

_From 251-monitoring-backups._

### 251-FR-017 — The runner-side logic (settings check, object naming, retention selection, manifest comparison, step timing) MUST live in the `scripts` project with Jest specs, and the two workflows MUST be checked by a spec for their triggers, environments and that no secret is echoed.

_From 251-monitoring-backups._

### 1159-FR-001 — A plan step MUST compute the workflow's job matrix: one entry per Nx project with a `test:mutation` target, and for a project listed in `scripts/mutation-shards.json`, one entry per named shard plus one `rest` entry instead.

_From 1159-mutation-shards._

### 1159-FR-002 — `scripts/mutation-shards.json` MUST map a project to named shards, each a list of that project's source folders (`x` for `x` and everything under it, `x/*` for the files directly in `x`, `*` for the files directly in `src`); a shard name is lower-case letters, digits and `-`, and a folder is a plain path (no `..`, trailing slash or glob characters); the plan MUST fail naming any folder that does not exist, any folder listed in two shards of a project, any shard named `rest`, and any shard whose job id equals another job's.

_From 1159-mutation-shards._

### 1159-FR-003 — The `rest` shard of a sharded project MUST cover every mutated source file of the project that no named shard's folders contain, so that the shards of a project together contain each of its mutated files exactly once.

_From 1159-mutation-shards._

### 1159-FR-004 — A shard job MUST mutate only its shard's files and MUST run only the spec files inside its shard's folders (for `rest`, the spec files outside every named shard's folders).

_From 1159-mutation-shards._

### 1159-FR-005 — Each matrix entry MUST carry its own job timeout, and each job's timeout MUST be at most 360 minutes and written beside the measured run time it derives from (measured time plus at least 30 %, or a figure marked provisional until the first full run measures it).

_From 1159-mutation-shards._

### 1159-FR-006 — Each job MUST have its own incremental-cache key and upload its own report, both named by project (and shard); with `full` set, no earlier results are restored.

_From 1159-mutation-shards._

### 1159-FR-007 — A summary job MUST run after every matrix job, even when some failed, and MUST write one line per project into the job summary with the combined score (killed or timed-out mutants over valid mutants, summed over shards, as a percentage rounded to two decimals; `n/a` when the shards hold no valid mutant), the floor and the shards that ran.

_From 1159-mutation-shards._

### 1159-FR-008 — The summary job MUST fail when a project whose shards all ran has a combined score under the floor read from that project's `stryker.config.json` `thresholds.break`, and when any matrix job did not succeed; it MUST NOT fail on a project whose shards did not all run only because of the partial score, nor on a project with no score (`n/a`) because of its floor. A planned job that left no `score.json` fails the summary naming the job.

_From 1159-mutation-shards._

### 1159-FR-009 — A sharded job MUST disable Stryker's own break threshold; an unsharded job MUST keep it. No `thresholds.break`, `low` or `high` in any `stryker.config.json` MAY be lowered by this change.

_From 1159-mutation-shards._

### 1159-FR-010 — The matrix job MUST set `max-parallel` to 5.

_From 1159-mutation-shards._

### 1159-FR-011 — Every matrix job MUST have its own PostgreSQL (the repository's image, `ghcr.io/george-hutanu/motor-fix-postgres:18`) and Redis service containers and migrate its database before mutating; integration specs MUST stay in the mutation run; Stryker's concurrency MUST be 1 for each project whose `src` holds an `*.integration.spec.ts`.

_From 1159-mutation-shards._

### 1159-FR-012 — Stryker's initial test run timeout MUST be longer than its 5-minute default for every project, set in one place (30 minutes, in `scripts/mutation.ts`).

_From 1159-mutation-shards._

### 1159-FR-013 — The scripts project's mutation run MUST run its specs in the checked-out repository (no copied sandbox), so specs that read git see the repository; its working files and results MUST stay out of git.

_From 1159-mutation-shards._

### 1159-FR-015 — The plan MUST honour `projects` (comma-separated, empty = all) and `shards` (comma-separated `project:shard`, empty = all shards of the selected projects), and MUST fail naming an unknown project, a project without a mutation target or an unknown shard.

_From 1159-mutation-shards._

### 1159-FR-016 — The script that reads a project's Jest options MUST ignore only a missing-file error and MUST raise every other error (ST-968).

_From 1159-mutation-shards._

### 1159-FR-017 — `scripts/mutation-setup.spec.ts` MUST leave the process working directory as it found it (ST-967).

_From 1159-mutation-shards._

### 1159-FR-018 — The PR CI paragraph of `AGENTS.md`, the `speckit-harden` skill and the `mutation-runner` agent MUST say that mutation runs in the Mutation workflow (every 3 days and on demand, sharded, one job per project or shard) and never locally, and MUST NOT describe a local run (ST-711).

_From 1159-mutation-shards._

### 1170-FR-001 — A pull request's CI runs the unit suite only (`JEST_SUITE=unit`) in a job named "Unit tests" that has no PostgreSQL or Redis service containers; a failing unit test still fails `CI OK`.

_From 1170-integration-on-demand._

### 1170-FR-002 — An "Integration tests" job runs the integration suite (`JEST_SUITE=integration`) on a GitHub runner with the repository's own PostgreSQL 18 + PostGIS 3.6 image (`ghcr.io/george-hutanu/motor-fix-postgres:18`, `pg_stat_statements` preloaded by the image, no `ALTER SYSTEM` step) and Redis service containers and the migrations applied. It runs when CI is run by hand (`gh workflow run ci.yml --ref <branch>`, which runs every job on every project) and when a caller of the workflow asks for it (`workflow_call` input `integration: true`); it never runs on `pull_request`.

_From 1170-integration-on-demand._

### 1170-FR-003 — `CI OK` needs the integration job and counts it skipped as passed, as it does the E2E job; the merge gate is unchanged (a skipped check is green; a later skip never hides an on-demand run's failure, as for E2E).

_From 1170-integration-on-demand._

### 1170-FR-004 — A release (merge to `main`) runs the integration suite before anything is built or deployed: `release.yml`'s `checks` job calls `ci.yml` with `integration: true`, so `images`, `staging` and `production` wait for it and a failure stops the release.

_From 1170-integration-on-demand._

### 1170-FR-005 — `.husky/pre-commit` starts no Docker stack and runs the affected `test` targets with `JEST_SUITE=unit`, set by the hook itself whatever the environment holds; the old refusal of a commit with `JEST_SUITE` set goes.

_From 1170-integration-on-demand._

### 1170-FR-006 — `scripts/test-services.ts` (`<base>`, `down`, `sweep`) stays, for running the integration suite by hand; its header and its no-Docker message describe the manual run, not the hook.

_From 1170-integration-on-demand._

### 1168-FR-001 — The repository MUST hold one plugin at `.claude/plugins/motorfix-chief/` with a manifest, a hooks file naming one register module, and one module file per part (part 3 excepted: it shares Chief Control's one `prompt.submit` hook in `chief-control.js`, amended in the build), enabled through an in-repo marketplace entry in `.claude/settings.json`; `claude plugin validate .claude/plugins/motorfix-chief` MUST pass, and the plugin MUST carry no code or package from outside this repo.

_From 1168-chief-mods._

### 1168-FR-002 — The mod MUST keep a ledger in persistent machine-wide storage, one row per PR with holder agent id, worktree, QA run id, lap count and head sha, filled from Agent dispatches and from `dispatch.mjs` and `ci-wait.mjs` Bash calls, and MUST present the same rows after a compaction and after a restart of the session.

_From 1168-chief-mods._

### 1168-FR-003 — In the orchestrating session (cwd equal to the main checkout) the mod MUST, every 15 minutes from its own timer, check whether two or more worktrees are active and, if so, run `node .claude/scripts/watch.mjs --gate` with a 10-minute timeout, never overlapping itself; gate exit 2 MUST wake the session with one `/speckit-watch` prompt carrying the gate's lines, exit 0 MUST do nothing, exit 1 or a timeout MUST show one toast. A worker session MUST run no gate.

_From 1168-chief-mods._

### 1168-FR-004 — When a `ci-wait.mjs <n> --run <id>` call (CI and the QA run both waited for) exits 0 and lists no check that did not pass and no QA run other than `success` (a background call's notification is checked by asking `ci-wait.mjs` again; amended in the build), the mod MUST offer the tail of PR #n as one prompt or one button, once per head sha; a `ci-wait.mjs` call without `--run` offers nothing.

_From 1168-chief-mods._

### 1168-FR-005 — The mod MUST put the ledger's rows into the model's context with the first message after a compaction, and the ledger MUST be the only source of that block.

_From 1168-chief-mods._

### 1168-FR-006 — A `tool.call` hook on the `Agent` tool (the only event whose deny text reaches the model) MUST deny an Agent call for a `task-runner` whose prompt names a PR or worktree held in the ledger by a live agent, and the denial text MUST name the holder and the PR. A row records the session that dispatched its holder: in that session a holder `$.agent.list()` no longer shows live MUST not block; a row owned by another session holds until that session frees it or the row is older than 110 minutes (the watch window).

_From 1168-chief-mods._

### 1168-FR-007 — An Agent call for `general-purpose` whose prompt describes a story run (`/speckit-auto`), a tail, or a `/speckit-watch` fix MUST be denied with a line saying `task-runner` is required; every other agent type MUST pass unchanged.

_From 1168-chief-mods._

### 1168-FR-008 — *(conditional)* If a spike shows that a message arriving from a helper identifies the parent runner that awaits it, the mod MUST forward that message to that runner, mark it consumed and note the forward in the ledger; if the spike shows it cannot, the part MUST be dropped, the spike's evidence recorded in `specs/1168-chief-mods/research.md` and the drop named in the PR's Notes, and nothing MUST simulate the forward. The spike's result is this requirement's acceptance.

_From 1168-chief-mods._

### 1168-FR-009 — On a desktop or terminal surface the mod MUST draw a pane and an above-prompt band with one row per PR (stage, lap `k/10`, CI state, holder, age) and the buttons Status, Watch pass, Fast-forward main and Tail ready PRs; each button MUST run only the repo command named for it (`status.mjs`, one `watch.mjs` pass, `git -C <main> merge --ff-only origin/main`, a tail offer per ready, finished, unheld PR), and Fast-forward main MUST never push.

_From 1168-chief-mods._

### 1168-FR-010 — The orchestrating session MUST record its session id under a `chief` store key at start and remove it at end. In a worker session bound to a PR, the mod MUST send that session one line `#<n> <old stage> → <new stage> <sha7>` at the end of a turn in which the PR's stage changed, and nothing when it did not; no `chief` key or an undelivered send is "not reachable": logged once and not retried in that turn.

_From 1168-chief-mods._

### 1168-FR-011 — The mod MUST show one warning when any rate-limit window reported by `session.measure` first reaches 80 % (once per window kind and reset time), offering `node .claude/scripts/fable.mjs off`, and MUST run it only when the offer is accepted.

_From 1168-chief-mods._

### 1168-FR-012 — The mod MUST show an owner command as one chained command in a code element with a Copy button whose press copies exactly that text, and MUST hold the card until the owner answers Done; a dismissed card is recorded as not done.

_From 1168-chief-mods._

### 1168-FR-013 — The mod MUST render a `ci-wait.mjs` result as one pill per check (name, state; one "green" pill for empty output), render nothing for the `PR QA: cancel` notice, and fold an Agent result that opens with the four-line reply block to its STATUS, PR and NEXT lines, leaving the text the model receives unchanged; every other result keeps its default rendering.

_From 1168-chief-mods._

### 1168-FR-014 — The mod MUST register no `tool.check` handler, MUST never call the session's permission authorization, and the change MUST edit no `permissions` block in any settings file.

_From 1168-chief-mods._

### 1168-FR-015 — Every one of the 16 gates in `.claude/hooks/registry.json` MUST remain a settings hook invoked through `run-hook.mjs` after the change, with its script and fingerprint unchanged; the mod MUST register no handler that replaces a gate's decision.

_From 1168-chief-mods._

### 1168-FR-016 — `node .claude/scripts/doctor.mjs` MUST fail on an edit to any mod file (every file under `.claude/plugins/motorfix-chief/` except `*.test.ts`, plus the marketplace manifest) whose fingerprint was not re-recorded, and `--bless-hooks` MUST record the mod files like the gate scripts.

_From 1168-chief-mods._

### 1168-FR-017 — On a surface other than desktop or terminal, or when `CLAUDE_CODE_REMOTE=true`, the mod MUST draw nothing and MUST still register every non-drawing part.

_From 1168-chief-mods._

### 1168-FR-018 — Every subprocess the mod starts MUST be given as an argument list, never a shell string, and MUST be one of this repo's scripts, the fast-forward merge named in FR-009, or the read-only `git rev-parse` that decides the session's role (R10, amended in the build); the mod MUST issue no `git push`.

_From 1168-chief-mods._

### 1168-FR-019 — The plugin's tests (`*.test.ts`, run by `claude plugin test`) and `claude plugin validate` MUST run in CI's Harness step (`.github/workflows/ci.yml`) and locally through the harness npm script; if the Claude CLI cannot be installed on the GitHub runner, the same tests MUST run under the existing vitest harness and the PR's Notes MUST say why.

_From 1168-chief-mods._

### 1168-FR-020 — A dispatch prompt that names several PRs or worktrees MUST be denied when any one of them is held by a live agent, and the denial MUST name each held PR; two dispatches arriving together in one session MUST resolve to one holder, the second reading the first's row and being denied (the guard writes the row before it lets the first call through; across sessions the store is not atomic, so the 110-minute row rule of FR-006 is the bound). A lap is the count of QA runs dispatched for the PR (`dispatch.mjs` `lap <n>` line), starting at 0 and capped at 10; it is not reset by a new head.

_From 1168-chief-mods._

### 1168-FR-021 — An owner card MUST be raised from an `AskUserQuestion` call by Chief whose question carries a command block; a card with no command block, or any `AskUserQuestion` from a worker session, MUST pass unchanged.

_From 1168-chief-mods._

### 1168-FR-022 — The board's columns MUST take these values: stage from the ledger's stage field; lap `k/10`; CI state one of `pass`, `fail`, `pending`, `none`; holder an agent id or `none`; age the time since the row's last update in whole minutes under two hours, then whole hours.

_From 1168-chief-mods._

### 1168-FR-023 — The block put into context after a compaction MUST list one line per ledger row (PR, holder, worktree, QA run, lap, head) and, for an empty ledger, one line saying so.

_From 1168-chief-mods._

### 1171-FR-001 — `ci-wait.mjs <n> --run <id>` waits for that QA run only (and still ends with exit 3 on a PR that conflicts with `main`); it no longer waits for CI first. `ci-wait.mjs <n>` without `--run` waits for CI, as today. A run that finishes before CI therefore ends the wait before CI does.

_From 1171-qa-latency._

### 1171-FR-002 — The tail starts on a finished QA run whatever CI's state. It reviews the run, and fixes a check that has already failed in the same lap; a pending check does not hold the review. After a passing lap with CI still pending it ends with `NEXT: merge #<n> after CI`; the session then holds `ci-wait.mjs <n>` in the background and, when it reports green, claims and dispatches the `merge` fix at once (a failing check: `fix-ci`).

_From 1171-qa-latency._

### 1171-FR-003 — `watch.mjs` shows a handed-off ready PR `waiting` only while its recorded QA run (testing its head) has not completed; once it has, the row is `stale` with the `tail` fix, whatever CI's state. A ready PR whose head already has `agent-review` success and whose CI is still pending is `waiting` for CI, with no fix.

_From 1171-qa-latency._

### 1171-FR-004 — A ready PR nobody holds whose head has `agent-review` success and every check passing gets the `merge` fix at once, without the quiet threshold. The `merge` fix and the tail's merge are one procedure: tail.md steps 5–6.

_From 1171-qa-latency._

### 1171-FR-005 — `.claude/scripts/merge-main.mjs` merges `origin/main` into the current branch (or finishes a merge already in progress) and resolves, without a person, the conflicts on:

_From 1171-qa-latency._

### 1171-FR-006 — The tail's step 1, the `merge-main` fix and the `merge` fix merge `origin/main` with `merge-main.mjs`, never a bare `git merge` that leaves those paths to a person.

_From 1171-qa-latency._

### 1171-FR-007 — `.claude/scripts/pr-test/precheck.mjs --flows <file> [--spec <spec.md>]` checks a flows file before it is dispatched, with no browser: the module loads and its default export is a function; it names no `networkidle` wait; and every acceptance scenario of the spec (`US<k> scenario <m>`, from each user story's numbered Acceptance Scenarios) is named in the file, either by a flow or by a `// not a flow: US<k> scenario <m> — <reason>` line. It prints one line per problem and exits 1 on any. `dispatch.mjs --flows` runs it and dispatches nothing while it fails, so the story's agent meets the problems before ready and every lap after.

_From 1171-qa-latency._

### 1171-FR-008 — An accessibility or console finding that the baseline run of `main` reported with the same key (kind, title, route) is marked pre-existing and capped at medium, as layout findings already are; one with a different title (another element count, another rule) stays the PR's.

_From 1171-qa-latency._

### 1171-FR-009 — `.claude/scripts/pr-test/latency.mjs <n>…` prints, per PR, the time from ready to the PR tester's first review, the number of laps (the tester's reviews), and the median of each over the PRs given.

_From 1171-qa-latency._

### 1201-FR-001 — The web server MUST answer a static file whose name carries the build's content hash — a base name ending in a dash and exactly eight characters from letters, digits, `_` and `-`, at least one of them a capital letter or a digit, before the extension (the forms the production build writes: `main-VFV36B5U.js` for entry files and media, `chunk-C0-vUTPR.js` for lazy chunks) — with `Cache-Control: public, max-age=31536000, immutable`.

_From 1201-static-cache-headers._

### 1201-FR-002 — The web server MUST answer every other static file it serves — today including `ngsw-worker.js`, `ngsw.json`, `manifest.webmanifest`, `index.csr.html`, `favicon.ico` and the files under `/icons/`, none of which carries a hash — with a `Cache-Control` value of exactly `no-cache`, MUST NOT mark it `immutable` or give it a positive `max-age`, and MUST send an `ETag` so a client can revalidate it.

_From 1201-static-cache-headers._

### 1201-FR-003 — A conditional request for an unchanged static file carrying its current `ETag` MUST be answered `304 Not Modified`.

_From 1201-static-cache-headers._

### 1201-FR-004 — The rest of the static file behaviour MUST stay as it is: no directory index, no redirect, source maps answered `404` with an empty body, and a missing file passed on to the next handler.

_From 1201-static-cache-headers._

### 1201-FR-005 — The web app MUST reload the page once for each unrecoverable state the service worker reports, when the service worker updates source says it is enabled; when it says it is disabled (on the server and in development), the app MUST NOT subscribe to those reports.

_From 1201-static-cache-headers._

### 1201-FR-006 — The PR QA run MUST request `/ngsw-worker.js` from the booted PR head and report a check that passes only when the answer is `200` and its `Cache-Control` contains `no-cache` and carries neither `immutable` nor a positive `max-age`; any other answer (no header, a non-200) MUST be a blocking finding.

_From 1201-static-cache-headers._

### 1201-FR-007 — FR-001 to FR-005 MUST each have failing-first automated tests beside the code they exercise (Constitution II).

_From 1201-static-cache-headers._

### 1182-FR-001 — The API MUST have one cache service that any read goes through with a key, a read function, a soft lifetime and a set of tags, and that answers from Redis when it holds a fresh entry, otherwise from the read function, storing the answer; key names carry a version (`v1`) so a change of shape bumps it and no older shape is read back. Every soft lifetime it stores is multiplied by a factor drawn evenly from 0.9 to 1.1 (jitter), so entries written together do not expire together; the hard expiry follows the jittered soft one.

_From 1182-cache-service._

### 1182-FR-002 — An entry MUST carry a soft expiry inside the value and a hard expiry 10 minutes after it. Before the soft expiry it is fresh. Between the two it is stale: a read answers from it at once and starts one refresh behind it, and no second refresh starts while that one runs. After the hard expiry the entry is gone.

_From 1182-cache-service._

### 1182-FR-003 — Concurrent reads of one missing or stale key MUST cause one read function call: within an instance, every caller waits on the one call in flight; across instances, a per-key lock held for at most 3 seconds lets one instance read while the others wait for the stored value (serving stale when they hold one; otherwise polling the key every 50 ms while the lock exists), and a waiter that sees no value once the lock is gone tries the lock once more and reads if it wins, else reads the database itself. A lock that outlives its holder MUST NOT block reads for longer than those 3 seconds.

_From 1182-cache-service._

### 1182-FR-004 — A not-found verdict for a slug no garage holds and an empty result list MUST be remembered for 60 seconds (jittered; soft and hard expiry alike, so a verdict is never served stale), so a repeated read in that window answers the same verdict without a database read; the unknown slug's entry carries no tag. A verdict about a garage that exists (a draft's 404, a suspended garage's 410) is not cached, so its approval or restore shows on the next read.

_From 1182-cache-service._

### 1182-FR-005 — Every stored entry MUST be added to each of its tags, and a purge of a tag MUST remove every entry it names and the tag itself; a purge wins over a read or refresh that began before it (that read's store is refused, so no older answer is left behind). A purge Redis refuses throws to its caller.

_From 1182-cache-service._

### 1182-FR-006 — Each purge MUST hand its tag to one purge hook with no behaviour today, the seam the CDN story (ST-430) fills; the purge succeeds whether or not the hook does anything. No CDN call is made in this story.

_From 1182-cache-service._

### 1182-FR-009 — Every visitor read route whose answer depends only on its path and query — today the profile, the brand Home answer, the popular tiles, the brand search, the job types and the public holidays — MUST answer `200` with exactly `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400`. A visitor route that depends on a header or token (the listing photo and document reads), and a route whose own story names a stricter policy (`no-store` on the search, the places lookup and the platform status; `no-cache` on the event streams) keep theirs. Problem answers (4xx, 5xx) carry no public cache header. The six routes are an allowlist, marked on the route and applied in one place; no other `@Public()` route gains the public policy. A visitor answer served through the cache service also carries `Cache-Tag` naming its entry's tags (comma-separated), the tag the CDN purge (ST-430) names.

_From 1182-cache-service._

### 1182-FR-010 — Every read route answered with a session MUST answer `200` with exactly `Cache-Control: private, no-cache`; a route whose own story names `no-store` keeps it.

_From 1182-cache-service._

### 1182-FR-011 — Every `200` read answer MUST carry a weak validator that changes when the answer changes, and a repeat of the request with `If-None-Match` naming the current validator MUST answer `304` with no body and the same `Cache-Control`; a problem answer is never `304`.

_From 1182-cache-service._

### 1182-FR-012 — No API answer MUST carry a `Vary` member other than `Accept-Encoding` (a redirect keeps Express's own `Vary: Accept`: it is no read answer and carries no public policy); the language is in the path, never negotiated. The server-sent event routes MUST stay uncompressed end to end (the API adds no compression; the web edge keeps relaying them unbuffered) and keep `Cache-Control: no-cache`.

_From 1182-cache-service._

### 1182-FR-013 — Once per release, the first instance to come up MUST warm, through the cache service, the profile (no brand in context) of the 200 most-read approved garages and the brand pages (the Home answer of each popular brand without a place, and the popular tiles), guarded by a once-per-release key set with `NX` and a one-day expiry so that another instance or a restart of the same release warms nothing; it runs after the API listens without delaying readiness, and is skipped when the release id is `dev` (no release); a warm-up that fails logs one warning and never stops the instance from serving.

_From 1182-cache-service._

### 1182-FR-015 — Redis MUST never hold the only copy (Constitution VI): while it fails, every read answers from PostgreSQL as it would without a cache, no lock is taken, the first failing call warns once and the first success after an outage logs the recovery; the HTTP headers of FR-009 to FR-012 do not depend on Redis.

_From 1182-cache-service._

### 1182-FR-016 — FR-001 to FR-015 MUST each have failing-first automated tests beside the code they exercise (Constitution II), on real PostgreSQL and Redis where the read reaches them; the single-flight test counts the database reads under 50 concurrent requests for one key on one instance and across two instances sharing Redis, and sees one.

_From 1182-cache-service._

### 1230-FR-001 — The QA run MUST launch the worker with `PUBLIC_WEB_URL` set to the booted web app's address, the same value the API and the web app are launched with, so every notification consumer is on during the flows. (Item 1.)

_From 1230-qa-harness-laps._

### 1230-FR-003 — `dispatch.mjs` MUST refuse, before dispatching anything, every route the workflow's own check would refuse, with the same rule, one line per route naming it and why, exit non-zero. (Item 2.)

_From 1230-qa-harness-laps._

### 1230-FR-004 — A route MAY start with a `/:lang` segment, and only there: the sweep MUST substitute the language under test into it (`ro` for Romanian, `en` for English) before parsing the rest, report the route as written, and still read a trailing `:<status>` (`/:lang/x:404`); the route parser and the shared route rule MUST accept it, and refuse a `:` anywhere else in the path. (Item 3.)

_From 1230-qa-harness-laps._

### 1230-FR-005 — `dispatch.mjs` and `run.mjs` MUST refuse, before any run is dispatched or any browser started, a route whose path is under `/app/` and carries no `@role`, with one line naming the route; `/app` itself and paths merely starting with `/app` (`/apple-pay`) are not under `/app/`. (Item 4.)

_From 1230-qa-harness-laps._

### 1230-FR-006 — The arguments a flows file receives, from the run and from `--check` alike, MUST include a shared helper set next to the existing ones: `waitForText(page, text)` (resolves when the text is visible within a bounded wait, 10 s unless the caller gives another, rejects naming the text and the wait), `openSheet(page, trigger)` (clicks the trigger and resolves when the sheet's content is visible, never judging the overlay container's box), `stepButton(page, label)` (the step's control that is visible at the current viewport, phone step list hidden or not), and `accounts` (the seeded role-to-e-mail map the API calls use). The set is one module, exported once, used by both callers. (Item 5.)

_From 1230-qa-harness-laps._

### 1230-FR-007 — `precheck.mjs` MUST offer `--check --base-url <url> --api-url <url>`: it loads the flows file, calls it with the same arguments the run gives (FR-006), including a real `signIn` that signs the seeded accounts in with the seed password, against the app and API already serving there (defaults `http://localhost:4200`, the dev server, and `http://localhost:3000`), runs it under FR-008's rejection handler, prints one line per finding, thrown error or unhandled rejection, exits 1 on any and 0 on none; it dispatches nothing and starts no server; an unreachable app or API is one line and exit 1, and so are flows still running after ten minutes (review amendment: a hung flow must not hold the laptop). (Item 5.)

_From 1230-qa-harness-laps._

### 1230-FR-008 — The run's flows step MUST turn an unhandled promise rejection the flows file leaves during the step into one `high` finding per rejection, naming the error, and continue to the remaining steps; the handler is installed for the flows step only and removed when it ends; a run-wide handler turns any other unhandled rejection into one `high` finding, so the run always reaches its report and teardown (review amendment). (Item 5; folds #1147.)

_From 1230-qa-harness-laps._

### 1230-FR-009 — The PR QA workflow MUST, when its run is cancelled after it set `agent-review` pending, replace that status on its head with `error`, description `PR QA lap cancelled`, the same target URL, only when the head's current `agent-review` entry in its combined status has this run as its target URL; a status a newer run set is left as it is. (Item 6.)

_From 1230-qa-harness-laps._

### 1230-FR-010 — The CI wait MUST end, within one poll interval and with one line naming the stale status, exit non-zero, when an `agent-review` check is pending and the run its `link` names is cancelled or has completed, whatever other checks are still pending, instead of waiting out the 120-minute limit; `gh.mjs` MUST supply `link` for `pr checks` over REST as `gh` does. (Item 6.)

_From 1230-qa-harness-laps._

### 1230-FR-011 — The sweep MUST open an `@role` route in the language under test whatever language the seeded account stored, by setting the account's `language` through the API before each signed-in context, so the English sweep of a signed-in screen is in English and the Romanian one in Romanian, without changing the seed. (Folds #1146 and #619.)

_From 1230-qa-harness-laps._

### 1230-FR-012 — The PR tester's skill, `AGENTS.md` and the PR tester's agent definition (which states the route grammar today) MUST state, in a few lines, how to write a route (`path[@role][:status]`, a `:lang` segment, a query string, `@role` required under `/app/`) and a flow (the helpers of FR-006, `--check` before dispatch). (Done when, third line.)

_From 1230-qa-harness-laps._

### 1175-FR-002 — Every health check and every binary the repository runs against the store MUST be Valkey's: the workflows' health command `valkey-cli ping`; the no-Docker path of `.claude/scripts/pr-test/services.mjs` starting `valkey-server` and stopping it with `valkey-cli`, with its pid-file process name updated to match.

_From 1175-valkey._

### 1175-FR-003 — Wherever the repository can pass the server its configuration (the compose service's command, the local fallback's command line, the drill's `docker run`), the server MUST run with `maxmemory-policy noeviction`; one integration spec MUST assert the policy of the store it runs against is `noeviction` (a refused `CONFIG GET` fails it naming the store), so the CI service containers, which take no command line, are checked by their default; the local fallback's command line is asserted by a unit test.

_From 1175-valkey._

### 1175-FR-004 — No file in this repository (outside `node_modules`; the specs repo's archived feature folders are not part of it) MUST name a Redis image or binary (`redis:7`, `redis:<n>`, `redis-server`, `redis-cli`) afterwards, documentation included; the harness specs that assert the old strings (`scripts/ci-workflow.adversary.spec.ts`, `scripts/mutation-workflow*.spec.ts`, `.claude/scripts/pr-test/services.spec.mjs`, `adversary.spec.mjs`, `.claude/scripts/cloud-setup*.spec.mjs`) MUST assert the Valkey ones.

_From 1175-valkey._

### 1175-FR-005 — Every cache key MUST carry a time to live: the entries, tags, locks and purge marks of the cache service, the garage-search cache, the active-brands cache, the OAuth flow keys, the rate-limit and attempt counters and the profile-view counters keep theirs, and a key these paths write without one is a defect. A check MUST enforce it: one self-contained integration spec that, under a key prefix of its own, drives each of those write paths itself, then scans that prefix and fails naming every key whose time to live is unset, except keys an allowlist in the check names with a reason (the garage-search generation counter, a version number that must not expire). BullMQ's own `bull:*` keys are out of scope: the check drives only the cache paths named here, and BullMQ bounds its keys by job retention, not by TTL. A lint rule is not practical (a TTL is an argument, not a syntax) and is not added.

_From 1175-valkey._

### 1175-FR-007 — Each process MUST open one command client to the store, created with `enableAutoPipelining: true`, with `connectTimeout: 2000`, `commandTimeout: 2000` and `maxRetriesPerRequest: 1` (the offline queue left on), shared by every command path of that process and closed once, after the paths using it have stopped, at shutdown (api: auth attempts, OAuth flows, the cache service, the search cache, the brand cache, profile views, the live publisher, the health check; worker: the relay's publisher, the insight counters, the data-store reader, the health check); the api MUST open exactly one further connection, the live subscriber; the end-to-end suite's global set-up and the tests keep their own clients. The time limits and failure semantics the existing requirements give those paths (422-FR-009's 2 seconds, 878-FR-007's failed reading that affects no job, 253-FR-011's open stream, ST-1182's fallback to PostgreSQL) MUST be met per call on the shared client, not by a second connection, and their existing tests MUST stay green.

_From 1175-valkey._

### 1175-FR-008 — Every BullMQ connection option, Queue and Worker alike, MUST carry `maxRetriesPerRequest: null`; BullMQ keeps its own connections (a Worker duplicates whatever it is given).

_From 1175-valkey._

### 1175-FR-010 — The integration suite and the live-update tests MUST be green on Valkey 9 before the PR is ready: an on-demand CI run on this branch (`gh workflow run ci.yml --ref 1175-valkey`) with every job green, named in the PR body's test evidence.

_From 1175-valkey._

### 1175-FR-011 — The constitution MUST be amended (`/speckit-constitution`, MINOR bump to 3.3.0) so Principle III names Valkey (the Redis-compatible, BSD-licensed store; the code speaks the Redis protocol and the names `redis` and `REDIS_URL` stay) in place of Redis, and Principles II, IV and VI say Valkey where they say Redis; the Sync Impact Report names ST-1175. Existing capability requirements that say "Redis" are not rewritten: one requirement of this feature states that "Redis" in them means the Valkey server reached through the Redis protocol (Principle I).

_From 1175-valkey._

### 1175-FR-012 — The documentation that names Redis as the given store MUST say Valkey 9 with a dated note naming ST-1175: the specs repo's `docs/reference/stack.md` (the cache, background-work, live-channel, hosting and tests rows), `docs/explanation/architecture/system-overview.md`, decisions A01, A16 and A25 and their index rows, and AGENTS.md's Product and stack paragraph. Decision A07 (the outbox carried by Redis) keeps its text; the store it names is the same role.

_From 1175-valkey._

### 1175-FR-013 — The Railway change, which the repository cannot make, MUST be recorded as the owner's step in `specs/1175-valkey/handoff.md`, the PR's finish comment and a how-to section in the specs repo (`docs/how-to/release.md`): replace the Redis template service with Valkey 9 (`valkey/valkey:9`), set `maxmemory-policy noeviction`, point api's and worker's `REDIS_URL` at it on staging and then production, and watch the `motorfix-redis` dashboard for the swap. The swap empties the store (Principle VI: PostgreSQL is the truth, the outbox relay re-reads from it), so the owner does it in a quiet window with no waiting or delayed BullMQ jobs, or accepts their loss knowingly.

_From 1175-valkey._

### 1175-FR-014 — In the living capabilities, "Redis" names the store role (cache, queues, fan-out, counters) reached through the Redis protocol at `REDIS_URL`; from this feature on, that store is Valkey 9, and a requirement naming Redis is read as naming it.

_From 1175-valkey._
### 1200-FR-001 — In the browser the generated API client MUST address the API absolutely at the page's own origin (`location.origin`), so the server's and the browser's requests for one read share one address once the server's origin is mapped (FR-002); the request path, method, parameters and body are unchanged.

_From 1200-transfer-cache-origin._

### 1200-FR-002 — On the server, when `PUBLIC_WEB_URL` is set, the app MUST map the API's private origin (the origin of `API_INTERNAL_URL`) onto the public origin (the origin of `PUBLIC_WEB_URL`) in the transfer cache's origin map, so a read the server made at the private address is stored under the key the browser will ask for; the map is provided on the server only and never in the browser. With `PUBLIC_WEB_URL` unset, no map is provided and the behaviour is today's.

_From 1200-transfer-cache-origin._

### 1200-FR-003 — The auth interceptor MUST decide by the request's path, resolved against the page's origin, not by the raw address string: "is this the API" (`/api/`), "is this an auth route" (`/api/v1/auth/`), the two as-the-person auth calls and "who am I" (`GET /api/v1/me`) MUST give the same answer for a relative and an absolute address of the same path; a request to any other origin (another host, scheme or port, including the server's private API origin) is not the API, carries no token and never opens the dialog. Every other rule of the interceptor (token, renewal on 401, the dialog once, the maintenance flag) is unchanged.

_From 1200-transfer-cache-origin._

### 1200-FR-004 — The public reads a server-rendered page makes on the server MUST be marked as public on the request (one request-context mark), and the interceptor MUST send a marked request without the `Authorization` header, token or no token, with no 401 renewal and no sign-in dialog, so the cache can serve them to signed-in visitors too; a 503 `maintenance` answer to a marked read still turns the maintenance page on. The marked reads are the popular-brand tiles and the public garage profile. An unmarked API call carries the token exactly as today.

_From 1200-transfer-cache-origin._

### 1200-FR-005 — After hydration of a server-rendered page, the browser MUST NOT repeat a read the server made for that render: the server's answer is served from the transfer cache once, and only once, per hydration; a read the server did not make (the Home read for the selected brand, the Results search) is issued by the browser as today.

_From 1200-transfer-cache-origin._

### 1200-FR-007 — A Playwright test MUST open each public server-rendered route that reads on the server (Home, a garage profile), signed out and signed in, record the `/api/` requests the browser makes before the app is stable, and fail when any of them repeats a read the server carried (the tiles, the profile); signed out it also fails on any request outside the browser-only list (the platform status, Home's count read, `/api/v1/live/`, the profile's view count `POST /api/v1/garages/<slug>/views`), each of the first two at most once; the test runs in CI's end-to-end suite.

_From 1200-transfer-cache-origin._

### 1200-FR-008 — Signed-in calls MUST still carry the token: the interceptor's unit tests cover absolute addresses for every rule of FR-003, and the existing signed-in end-to-end flows pass unchanged.

_From 1200-transfer-cache-origin._

### 1169-FR-001 — The API MUST have one warm-cache library built on the cache service (`libs/domain/src/cache/`): `warm` stores a read's answer under a kind, a key and tags with a life of 90 s (jittered ×0.9–1.1, so 81–99 s, inside the issue's 60–120 s), served never stale and never refreshed; `take` returns a matching entry once and removes it, or nothing (the read and the removal are one atomic step, so two simultaneous reads get the entry once between them); a `take` that finds the same key's warm still in flight in this process awaits it (the cache service's single-flight) and counts a `hit`, so a home read that overtakes the warm is not a miss and the sign-in answer is never delayed. Warm entries use the cache service's keys, tags, lock, fail-open and metrics; no second cache, no second Redis client.

_From 1169-prefetch-intent._

### 1169-FR-006 — A write that changes a warmed answer MUST evict it before its next read: the outbox relay's purge (`purgeAudience`) MUST purge the tag `warm:{key}` for every `account:{id}` and `garage:{id}` audience key of the relayed event, on every relayed event, whatever its kind (no kind table: over-eviction is safe and short), so car added/updated/removed, request created/cancelled/updated, a decline (which carries only `garage:{id}` and changes no driver list) and quote created/sent/accepted/closed evict the driver's and the garage's warm entries by the same path that drops the public cache. A purge Redis refuses retries with the event as today.

_From 1169-prefetch-intent._

### 1169-FR-009 — No pre-fetch and no route preload MUST run when the browser reports `Save-Data`, an effective connection type of `2g` or `slow-2g`, or when the document is not visible, each judged afresh at every signal; none runs during server-side rendering. A pre-fetch is a read only: it sends no beacon, writes nothing and records no profile view.

_From 1169-prefetch-intent._

### 1169-FR-010 — The warm entries are private: stored only after the token or identity was verified, keyed by the account or garage they belong to, held in Redis only (PostgreSQL stays the truth), and gone after 120 s at most. Public data (the profile) may be pre-fetched in the browser; no private read is ever pre-fetched in the browser.

_From 1169-prefetch-intent._

### 1169-FR-014 — FR-001 to FR-012 MUST each have failing-first automated tests beside the code they exercise (Constitution II): the API ones on real PostgreSQL and Redis, including a test that an existing and an unknown account get the same refused sign-in path with nothing warmed (FR-002), that no warm entry reaches an unauthenticated or another account's request (FR-005, FR-010), that a write evicts the entry so the next read is fresh (FR-006), and that a warm entry is taken once (FR-001); the web ones in Jest for the card's signals, the cap, the cancel, the guards and the store's age rule.

_From 1169-prefetch-intent._

### 1176-FR-001 — No tracked file of the repository (outside `specs/`, which is its own repository, the dated history entries of `.specify/capabilities/`, and `scripts/banned-words.json`, the list that bans the word; requirement bodies are not exempt) MUST contain the retired store's name, in any case (the second word of `scripts/banned-words.json`): `docker-compose.yml`, both workflows, the PR tester's scripts, their specs and agent definition, the restore drill, `.env.example` and the skills all name the replacement instead. A test fails on any match.

_From 1176-replace-object-store._

### 1176-FR-002 — `docker compose up -d --wait postgres redis storage` MUST start the replacement as the service `storage` on the endpoint, bucket and keys the apps read today (`http://localhost:9000`, `motorfix`, `motorfix` / `motorfix-secret`; the host port overridable through `STORAGE_PORT`, as `POSTGRES_PORT` and `REDIS_PORT` are). The store MUST create the `motorfix` bucket itself as it starts (no separate setup service), its compose health check MUST report healthy only once the bucket exists, and that check MUST be bounded (interval × retries plus start period at most 120 seconds) so `up --wait` fails naming the service instead of hanging. The store's image MUST be pinned by digest.

_From 1176-replace-object-store._

### 1176-FR-003 — Against the running replacement, an integration test MUST perform and pass, each as its own case: the presigned POST policy upload (the fields and the file, the file last), a conditional copy pinning the upload's ETag, a signed download address with an `inline` and with an `attachment` disposition, the bucket probe, the multi-key delete, a presigned PUT and a presigned multipart upload (create, parts, complete), each reading back the uploaded bytes; and, on a bucket of its own that it removes after, MUST set a CORS rule for the local web origin (POST and PUT, `ETag` exposed), read it back, and assert the preflight from that origin is allowed with `ETag` exposed and from a foreign origin is refused. The storage unit tests keep the in-memory test store.

_From 1176-replace-object-store._

### 1176-FR-004 — The CI Compose stack step (which also runs the FR-003 test) and the E2E job's object storage step, the CI integration job (which starts the store so the FR-003 test runs there), the PR QA workflow's boot (`up --wait` bounded by the store's health check), the PR tester's compose plan and its local plan (the replacement's binary on the PATH, started inside the run directory on the lap's ports with the apps' keys, its pid file, stopped at teardown; 450-FR-001 and 450-FR-009, reworded in place to name the store generically) and the restore drill MUST boot the replacement in place of the retired store, and their existing specs MUST describe the replacement.

_From 1176-replace-object-store._

### 1323-FR-001 — `ghRun` (`gh-rest.mjs`) MUST answer `gh pr view`, `gh pr list` and `gh pr checks` over REST on the laptop as in the cloud, so `lifecycle.mjs` and the `stop:pr-lifecycle` gate read PRs, check runs and commit statuses over REST; the writes it translates (pr create/edit/ready/comment, label create) stay plain gh outside the cloud.

_From 1323-rest-not-graphql._

### 1323-FR-002 — The merge gate MUST read a PR named by number or URL over REST on the laptop as in the cloud; `lifecycle.mjs merge` MUST merge through `gh api -X PUT …/pulls/<n>/merge` and read the PR and its merge commit over REST everywhere.

_From 1323-rest-not-graphql._

### 1323-FR-003 — `dispatch.mjs` and `ci-wait.mjs` MUST read the PR's state, head, mergeability and checks over REST everywhere.

_From 1323-rest-not-graphql._

### 1323-FR-005 — `ci-wait.mjs` MUST poll at most once every 60 s, and a QA run already completed when the wait starts MUST return at once, before any other read.

_From 1323-rest-not-graphql._

### 1323-FR-007 — AGENTS.md MUST say REST is the default for these reads everywhere, in the "Agent replies" CI line and the cloud section.

_From 1323-rest-not-graphql._

### 1324-FR-001 — AGENTS.md MUST name no `deferred.md` route and MUST replace the "Technical debt a review defers" paragraph with the rule that every verified review, QA or harden finding is fixed in the current task's PR before ready or merge, and one needing an owner decision becomes a `needs-confirmation` question on the task; the hand-off note's listed contents MUST drop "deferred items"; the "Ready to work stays current" paragraph MUST keep only the finish comment rule, under the lead "A finished task says what happened"; a decision finding is a comment and the `needs-confirmation` label on the task's issue, with the task Blocked on it.

_From 1324-retire-debt-and-ready._

### 1324-FR-002 — The constitution MUST drop Principle VII's `ready to work` label sentence and replace the Agent Execution Rules' defer clause with FR-001's rule, bumping to 4.0.0 (a rule removed), with the card and CLAUDE.local.md's version line updated and `constitution-card.spec.mjs` green.

_From 1324-retire-debt-and-ready._

### 1324-FR-003 — `speckit-review`, `speckit-auto` (`phases-close.md`, `hand-off.md`, `tail.md`), `speckit-pr-test` and `speckit-harden` MUST route every verified finding to fix-now or a `needs-confirmation` question, name no `deferred.md`, carry no `Deferred:` line in the hand-off note and run no `debt` event.

_From 1324-retire-debt-and-ready._

### 1324-FR-004 — `spec-reviewer.md` and `code-reviewer.md` MUST offer only `patch` and `decision`; `agent-replies.spec.mjs` and the reviewer fixtures MUST pass.

_From 1324-retire-debt-and-ready._

### 1324-FR-006 — `lifecycle.mjs ready` MUST no longer file `deferred.md` bullets nor write a `Deferred:` line to `handoff.md`; `lifecycle.mjs merge` MUST no longer report `ready_logged`.

_From 1324-retire-debt-and-ready._

### 1324-FR-007 — The merge gate's carry check (`carry.mjs judgeCarry`) MUST refuse a range that touches any path whose file name is `deferred.md`, whatever else it touches; a spec case MUST cover it.

_From 1324-retire-debt-and-ready._

### 1324-FR-009 — `speckit-archive` MUST no longer require `tracker/ready.mjs check -`.

_From 1324-retire-debt-and-ready._

### 1324-FR-010 — A case-insensitive grep of AGENTS.md and `.claude` (worktrees excluded) for the retired ready label or the name of its old helper script MUST print nothing.

_From 1324-retire-debt-and-ready._

### 1344-FR-001 — `/speckit-harden` MUST NOT launch `mutation-runner`, dispatch a Mutation workflow run, read a mutation score or wait for a run: its step 1 launches nothing beside the audits, step 2b is removed, the report table has no mutation row, the Done-When has no mutation line, and its argument hint and size rule no longer offer a mutation waiver.

_From 1344-no-mutation-wait._

### 1344-FR-002 — `/speckit-auto`'s build phases and report checklist MUST state that the run dispatches no Mutation workflow run and waits for none, and MUST NOT hold a background wait on one.

_From 1344-no-mutation-wait._

### 1344-FR-003 — No harness script, hook, skill or context under `.claude/` or `.specify/contexts/` that a task's lifecycle runs (auto, harden, review, pr-test, watch, lifecycle, doctor, the evals) MUST dispatch `mutation.yml`, read a Mutation run's report or wait for a Mutation run; `.specify/contexts/harden.md` MUST describe harden without a mutation score and without the `gh workflow run mutation.yml` instruction.

_From 1344-no-mutation-wait._

### 1344-FR-006 — AGENTS.md MUST say that mutation testing is never part of a task's lifecycle, that the Mutation workflow's schedule on `main` and its manual `workflow_dispatch` are the only places it runs, and that follow-up on surviving mutants is picked from the Project like any task.

_From 1344-no-mutation-wait._

### 1344-FR-007 — The constitution's Principle II MUST carry the same rule in one bullet; the version MUST be 4.1.0 with its amendment entry and date, and the constitution card MUST reflect it.

_From 1344-no-mutation-wait._

### 1344-FR-010 — Every reader of a PR's checks that a lifecycle step or gate uses — `merge-gate.mjs`, `pr-lifecycle-gate.mjs`, `.claude/scripts/pr-test/ci-wait.mjs`, `watch.mjs`'s PR summary, and the REST translation in `lib/gh-rest.mjs` that feeds them in a cloud session — MUST leave out the checks of the workflow named `Mutation` (`.github/workflows/mutation.yml`), whatever their state, so that a Mutation run on the PR head neither holds a wait nor refuses or delays the merge.

_From 1344-no-mutation-wait._

### 430-FR-001 — Every production and staging web address MUST resolve to the CDN, serve TLS only and answer plain HTTP with a redirect to HTTPS; the origin is reached only through the CDN's own origin address.

_From 430-cdn-waf._

### 430-FR-002 — The edge MUST keep a content-hashed static file for one year and a public page (home, brand pages, city pages, garage profiles, the sitemap) for 60 seconds, after which it fetches the page from the origin again; the origin MUST tell the browser to keep a public page for 0 seconds and revalidate while telling the edge its own 60-second lifetime (`Cache-Control: public, max-age=0, s-maxage=60, must-revalidate`).

_From 430-cdn-waf._

### 430-FR-003 — Every public page response MUST carry its purge tag — `garage:<id>` on a garage profile, `search` on the home, brand and city pages, and the sitemap — in the header the provider reads (one tag per response), and the purge sender MUST send to the CDN every `garage:<id>` and `search` tag that `purgeTags`/`purgeAudience` hand to their hook; a `warm:*` tag MUST never be sent.

_From 430-cdn-waf._

### 430-FR-004 — The purge sender MUST queue tags, batch them and send them from the worker at or under the provider's rate, keep a tag that could not be sent for the next batch, and the release workflow MUST purge the zone after each environment's deploy health check passed; a failed or skipped purge there (no key yet) is a notice or warning, never a failed release, because the 60-second edge lifetime bounds the stale window.

_From 430-cdn-waf._

### 430-FR-005 — A request carrying the session cookie (`mf_refresh`) or an `Authorization` header, and every request under `/api/` or `/app/`, MUST never be served from or stored at the edge.

_From 430-cdn-waf._

### 430-FR-006 — Server-sent event streams (`/api/v1/live` and the public live streams) MUST pass through the edge unbuffered and MUST stay open at least as long as the origin keeps them.

_From 430-cdn-waf._

### 430-FR-007 — When an origin secret is configured, the web server MUST answer 403 to a request that lacks the secret header or carries a value not in the configured comma-separated list, before any page, API proxy or static file handling, except `/health/live` and `/health/ready`; with no secret configured it MUST behave exactly as today.

_From 430-cdn-waf._

### 430-FR-008 — The provider's managed firewall rules MUST be on, and edge rate limits MUST answer 429 to a burst from one client address on sign-in (`POST /api/v1/auth/sign-in`, `/api/v1/auth/phone-sign-in`, the OAuth completion), sign-up (`POST /api/v1/auth/sign-up`), code sending (`POST /api/v1/auth/phone-code`, `/api/v1/auth/password-reset`, `/api/v1/me/email`, `/api/v1/me/phone`) and quote requests (`POST /api/v1/quote-requests`); the limits are 20 requests per minute per client address on the first three groups together and 10 per minute on quote requests (the provider's two free rules, plan R5); the API's own limits stay unchanged.

_From 430-cdn-waf._

### 430-FR-009 — The provider's configuration MUST live in the repo as one declarative file, with a script that applies the pull zone and its edge rules and checks the live state against them (non-zero exit naming each difference; the Shield section is recorded, not applied, FR-008); both MUST be tested against recorded provider answers without reaching the provider.

_From 430-cdn-waf._

### 430-FR-010 — The change MUST ship its observability: purge sends and failures as metrics with a dashboard panel and an alert on failures, origin refusals as a metric, logs for a failed send and a refusal, and the new entries in `infra/observability/inventory.json`.

_From 430-cdn-waf._

### 430-FR-011 — The specs repo MUST gain a how-to for setting the CDN up (account, pull zone, DNS, the secret, applying the configuration) and a how-to for rolling back (addresses pointed straight at the origin by hand, the secret unset), and `docs/reference/stack.md`'s Edge row MUST move from Proposed to the decided provider.

_From 430-cdn-waf._

### 1019-FR-007 — The release's staging job MUST run the check after the deploy against the staging MCP address, before the core flows, when the staging environment names both the MCP service and the MCP address (`MCP_URL`), and its failure MUST fail the job; when either is missing it MUST skip the check with one notice naming what is missing.

_From 1019-staging-mcp-connect._

### 1174-FR-001 — The repository MUST hold one database image definition (`infra/postgres/Dockerfile`), `FROM ghcr.io/railwayapp-templates/postgres-ssl:18` plus the distribution's `postgresql-18-postgis-3` package (PostGIS 3.6.x) from the base image's pgdg repository, nothing else added, with `PGDATA` set under `/var/lib/postgresql/data` so the base entrypoint starts; it MUST be published to `ghcr.io/george-hutanu/motor-fix-postgres` for amd64 and arm64, tagged with the commit sha on every publish and `18` from `main` (from another branch only when the dispatch sets its `move_18` input, so nothing moves the tag compose, CI and staging pull by accident), by a workflow (`postgres-image.yml`) that runs on `workflow_dispatch` from any branch and on a push to `main` that changes `infra/postgres/**` or the workflow itself, and builds both architectures without pushing on a pull request that changes them (the proof before merge, and what registers the workflow for a dispatch from a branch); the package is public, as the application images are, so compose, CI and Railway pull it with no login (making a new package public is an owner step if GitHub creates it private); a failed publish run is its alert.

_From 1174-postgres-18-pitr._

### 1174-FR-002 — `docker-compose.yml`, CI's Integration and E2E service containers (`ci.yml`), the mutation matrix jobs (`mutation.yml`) and the dump drill's throwaway MUST name that image's `18` tag, so the PR QA boot (the PR's own compose file) and `scripts/test-services.ts` use it with no change of their own; a unit spec MUST assert that these files name one and the same image, and that the image definition's base, package and `PGDATA` are as FR-001 says.

_From 1174-postgres-18-pitr._

### 1174-FR-003 — Because the image preloads `pg_stat_statements` on a fresh database, the compose service's `command` and CI's "Preload pg_stat_statements" step (the `ALTER SYSTEM` and restart) MUST be removed; the data-store metric specs that read the view MUST still pass.

_From 1174-postgres-18-pitr._

### 1174-FR-004 — An integration spec MUST assert the server is PostgreSQL 18 (`version()`) and that PostGIS 3.6 is available to install (`pg_available_extensions`), so the suite fails on any environment that boots another image.

_From 1174-postgres-18-pitr._

### 1174-FR-006 — Point-in-time recovery on Railway MUST be configured, not implemented: the image's own archiving and backups, turned on by `WAL_ARCHIVE_BUCKET`, `WAL_ARCHIVE_ENDPOINT`, `WAL_ARCHIVE_REGION`, `WAL_ARCHIVE_KEY` and `WAL_ARCHIVE_SECRET` with its defaults (archive at most 60 s behind, full backup every 168 h, differential every 24 h, four fulls and fourteen differentials kept). The PR's Notes and the how-to MUST list each owner step with the exact service, setting and value or secret name: switch the staging PostgreSQL service to the published image, create the archive bucket, set those five variables, and set the GitHub `staging` environment secrets of FR-008. The code MUST NOT wait on any of them. Rolling the service back is an owner step too, named in the Notes: set it to the previous image's sha tag; the archive variables stay set and harmless. The drill prints no archive key or secret: staging's reach the job only as GitHub secrets (masked in logs), the self-contained mode's are throwaway.

_From 1174-postgres-18-pitr._

### 1174-FR-007 — A point-in-time drill script (`scripts/backup/pitr-drill.sh`) MUST restore from a write-ahead-log archive into a throwaway sibling of the image on the machine it runs on, to a target moment, using the image's own restore variables (`WAL_RECOVER_FROM_*`, `POSTGRES_RECOVERY_TARGET_TIME`); check that a change committed before the target is present and the next one after it is absent; print the restore time (from the sibling's `docker run`, the image already pulled, until it has promoted, `pg_is_in_recovery()` false) and the archive lag (from the second marker's commit until the archive holds its log segment, per pgBackRest's `info`: the data at risk); fail naming the check when a marker check fails, the lag is over 15 min or the sibling has not promoted within 600 s (the script's `READY_SECONDS`; the lag wait is bounded at 900 s, the 15 min target); and remove everything it started however it ends.

_From 1174-postgres-18-pitr._

### 1174-FR-008 — The drill MUST run in two modes: self-contained (`--self-contained`: it starts a throwaway source database of the image archiving to an S3-compatible store it starts on the same machine, commits the two markers itself around the target, and so needs no secret) and staging (the archive's bucket, endpoint, region, key and secret from the GitHub `staging` environment, named `WAL_ARCHIVE_*` like Railway's; the two markers are empty transactions, `SELECT pg_current_xact_id()`, committed on staging over `railway ssh` as `backup.sh` reaches the service, with the same `RAILWAY_API_TOKEN` and service variables; they write no row). In both modes the target is the first marker's commit time (`pg_xact_commit_timestamp`), and the check is `pg_xact_status` on the sibling: the first `committed`, the second still in its future. A workflow (`pitr-drill.yml`) MUST run the self-contained mode on `workflow_dispatch`, on the first day of every quarter and on a pull request that changes `infra/postgres/**`, the drill script or the workflow (drilling the image that commit's Dockerfile builds), and the staging mode on the first two triggers only, its job bound to the `staging` environment and ending green with a notice, its drill steps skipped, while that environment holds no `WAL_ARCHIVE_BUCKET` (until the owner sets it); a failed run is the alert.

_From 1174-postgres-18-pitr._

### 1174-FR-010 — `scripts/backup/restore-drill.sh` MUST restore into `ghcr.io/george-hutanu/motor-fix-postgres:<the copy's major version>` by default (`DRILL_IMAGE` still overrides), so a dump that holds the PostGIS extension restores; its header and the how-to MUST say so. `scripts/backup/dump.sh` and `backup.yml` MUST stay as they are: the nightly encrypted off-platform copy.

_From 1174-postgres-18-pitr._

### 1174-FR-012 — The specs repo's `docs/how-to/back-up-and-restore-the-database.md` MUST describe point-in-time recovery (the variables, what the image does with them, the defaults, how to restore for real with Railway's point-in-time restore into a new service and when to use the dump instead), the point-in-time drill (both modes, how to run it, what it checks), the dump drill's new image, and MUST say under "Timings and targets" that the 15-minute data-loss target is met by the archive (at most 60 s plus the heartbeat behind, as the self-contained drill measured), never again "not met"; `docs/reference/stack.md` MUST record PostgreSQL 18 + PostGIS 3.6 on our image as decided (ST-1174), and `llms.txt`'s summary of the how-to MUST mention point-in-time recovery.

_From 1174-postgres-18-pitr._

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

- `481-FR-002` — superseded by `977-FR-010` (2026-10-08)
- `464-FR-007` — superseded by `977-FR-010` (2026-10-08)
- `974-FR-003` — superseded by `977-FR-007` (2026-10-08)
- `623-FR-002` — superseded by `887-FR-001` (2026-10-08)

- `516-FR-001` — superseded by `000-FR-001` (2026-10-09)
- `516-FR-002` — superseded by `000-FR-014` (2026-10-09)
- `421-FR-032` — superseded by `000-FR-002` (2026-10-09)

- `815-FR-001` — superseded by `1018-FR-002` (2026-10-09)
- `815-FR-005` — superseded by `1018-FR-005` (2026-10-09)
- `977-FR-003` — superseded by `1018-FR-005` (2026-10-09)
- `960-FR-001` — superseded by `1018-FR-018` (2026-10-09)

- `1018-FR-008` — removed by 1026-diataxis-docs (2026-10-09)
- `1018-FR-009` — removed by 1026-diataxis-docs (2026-10-09)
- `1018-FR-010` — removed by 1026-diataxis-docs (2026-10-09)
- `1018-FR-011` — removed by 1026-diataxis-docs (2026-10-09)
- `1018-FR-012` — removed by 1026-diataxis-docs (2026-10-09)
- `1018-FR-013` — removed by 1026-diataxis-docs (2026-10-09)
- `1018-FR-001` — superseded by `1026-FR-004` (2026-10-09)
- `1018-FR-007` — superseded by `1026-FR-026` (2026-10-09)
- `1018-FR-014` — superseded by `1026-FR-020` (2026-10-09)
- `1018-FR-015` — superseded by `1026-FR-022` (2026-10-09)
- `1018-FR-016` — superseded by `1026-FR-023` (2026-10-09)
- `1018-FR-017` — superseded by `1026-FR-018` (2026-10-09)

- `693-FR-001` — removed by 1037-remove-notion (2026-10-10)
- `693-FR-002` — removed by 1037-remove-notion (2026-10-10)
- `693-FR-003` — removed by 1037-remove-notion (2026-10-10)
- `693-FR-004` — removed by 1037-remove-notion (2026-10-10)
- `693-FR-005` — removed by 1037-remove-notion (2026-10-10)
- `693-FR-006` — removed by 1037-remove-notion (2026-10-10)
- `678-FR-011` — removed by 1037-remove-notion (2026-10-10)
- `678-FR-013` — removed by 1037-remove-notion (2026-10-10)
- `745-FR-005` — removed by 1037-remove-notion (2026-10-10)
- `849-FR-001` — removed by 1037-remove-notion (2026-10-10)
- `849-FR-005` — removed by 1037-remove-notion (2026-10-10)
- `696-FR-005` — removed by 1037-remove-notion (2026-10-10)
- `725-FR-002` — removed by 1037-remove-notion (2026-10-10)
- `1026-FR-020` — superseded by `1037-FR-005` (2026-10-10)
- `1026-FR-021` — superseded by `1037-FR-016` (2026-10-10)
- `1026-FR-022` — superseded by `1037-FR-015` (2026-10-10)

- `745-FR-001` — removed by 1119-drop-tracker-import (2026-10-10)
- `745-FR-002` — removed by 1119-drop-tracker-import (2026-10-10)
- `745-FR-003` — removed by 1119-drop-tracker-import (2026-10-10)
- `745-FR-004` — removed by 1119-drop-tracker-import (2026-10-10)
- `745-FR-006` — removed by 1119-drop-tracker-import (2026-10-10)
- `745-FR-007` — removed by 1119-drop-tracker-import (2026-10-10)
- `745-FR-008` — removed by 1119-drop-tracker-import (2026-10-10)

- `431-FR-007` — superseded by `1159-FR-014` (2026-10-11)
- `431-FR-008` — superseded by `1159-FR-019` (2026-10-11)

- `450-FR-012` — superseded by `1230-FR-002` (2026-10-15)

- `421-FR-026` — superseded by `1175-FR-001` (2026-10-15)
- `421-FR-019` — superseded by `1200-FR-006` (2026-10-15)

- `696-FR-002` — superseded by `1324-FR-012` (2026-10-16)
- `1324-FR-011` — removed by 1324-retire-debt-and-ready (2026-10-16): a process check, not a behaviour; SC-004's doctor run is the check

- `431-FR-011` — superseded by `1344-FR-004` (2026-10-17)
