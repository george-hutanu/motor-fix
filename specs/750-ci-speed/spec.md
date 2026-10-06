# Feature Specification: CI finishes faster and queues less on the free runner cap

**Feature Branch**: `750-ci-speed`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "how can you make the CI complete faster? what tasks can be run in parallel? also take into consideration other versions of node because im on a free tier on github and sometimes i have to wait to get a container to run my ci, in the evening especially being very crowded"

Notion: ST-750 https://app.notion.com/p/3f1607bff0d2816784b9c0634b1a5b83 (Task, High, Role System, epic Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707). User story on the card: "As the owner on GitHub's free plan, I want each PR's CI to finish sooner and hold fewer runners, so that evening pushes stop waiting up to 30 minutes for a runner." The card has no Build brief Screens section; its Design and Design boards rollups are empty (no screens).

## Evidence, measured (GitHub API, runs of 2026-10-03..06)

Every number in this spec comes from this section or from the repo; a number with no source is an assumption and sits in Assumptions.

- **Jobs per PR push.** `.github/workflows/ci.yml` already runs its 14 jobs in parallel: Changes, Biome, Typecheck, Unit tests, Integration tests, E2E tests, Build, Harness, Contract check, Dependency audit, Docker build (web), Docker build (api), Compose stack, CI OK. Seven of them each run `./.github/actions/setup` (setup-node with the npm cache, then `npm ci`), about 60 s each. Every push also runs the PR title and PR template workflows.
- **Critical path.** E2E tests: about 10–11 min when `web` is affected, of which about 9 min is the Playwright run. `nxE2EPreset` (`node_modules/@nx/playwright/dist/src/utils/preset.js`) sets `workers: process.env.CI ? 1 : undefined`, so the suite's 178 tests run one at a time on the 4-vCPU runner a public repo gets. Locally the same suite runs in parallel (`workers` undefined, `fullyParallel` true); CI keeps `retries: 2`.
- **Next longest.** Docker build (api): 2–4.5 min. PR builds use `cache-from: type=gha,scope=<app>`, but `release.yml`'s `images` job builds web, api, worker and mcp with no cache, and GitHub's cache scoping lets a PR branch read only caches written on `main`: every PR's first Docker build is cold.
- **Evening queueing.** UTC 19–20: average 144 s, longest 1823 s (about 30 min) from a job's creation to its start. At the moment each long-queued job was created, 18–27 of this account's own jobs were running: the free plan's account-wide cap of 20 concurrent jobs. Contributors: 14 CI jobs per push, the PR title and PR template jobs per push and edit, the PR QA runs, and on every merge `release.yml`, which re-runs the whole of `ci.yml` (`run-many`) plus `images`, `staging` and `production`; six releases started between 19:57 and 20:26 UTC on 2026-10-05.
- **Node versions.** CI runs one Node, `.nvmrc` = 24, with no matrix. A Node matrix would add jobs, not slots; a different runner label (`ubuntu-24.04-arm`, `ubuntu-slim`) draws from the same account-wide cap.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A PR's CI finishes sooner (Priority: P1)

The owner pushes to a PR that touches the web app and gets a green or red CI OK in less wall time than today, because the end-to-end suite uses the runner's cores instead of one.

**Why this priority**: E2E is the critical path of every PR that affects `web`; nothing else shortens the wait as much.

**Independent Test**: Push a web change to a PR; the E2E job's duration in the run's job list is below the target in SC-002, and every end-to-end test still ran (the run's test count equals the suite's).

**Acceptance Scenarios**:

1. **Given** a PR that affects `web`, **When** CI runs, **Then** the E2E job runs the whole suite with more than one worker and finishes in the time SC-002 names.
2. **Given** a test that fails under parallel execution but passed alone, **When** the run fails, **Then** the failure is visible as an E2E failure (not hidden by retries) and is fixed in the suite before this feature closes.

---

### User Story 2 - A push holds fewer runners (Priority: P1)

A push to a PR occupies fewer of the account's 20 concurrent job slots, so other work (QA runs, releases, a second PR) starts sooner in the evening, while every check that runs today still runs and still fails CI OK when it fails.

**Why this priority**: The queueing the owner hits is the account cap, not slow runners; fewer jobs per push is the only lever that touches it.

**Independent Test**: Count the jobs a non-docs PR push creates across `ci.yml`; compare with the 14 of today (SC-001). Break one of the folded checks on a branch (a Biome violation, a failing contract check); CI OK fails.

**Acceptance Scenarios**:

1. **Given** a non-docs PR push, **When** CI runs, **Then** it creates at most the number of jobs SC-001 names, and the set of checks performed (Biome, typecheck, unit, integration, e2e, build, harness, contract, audit, docker web, docker api, compose) is unchanged.
2. **Given** a check that fails, **When** it runs inside a shared job, **Then** the shared job fails, its log names the check that failed, and CI OK fails.
3. **Given** a docs-only PR, **When** CI runs, **Then** only the change detector and CI OK run, as today.
4. **Given** a non-docs push, **When** the run completes, **Then** dependencies were installed fewer times than today's seven (SC-003).

---

### User Story 3 - PR Docker builds start warm (Priority: P2)

A PR's Docker builds reuse layers written by a build on `main`, so a PR whose dependencies did not change does not rebuild them.

**Why this priority**: Docker build (api) is the second-longest job; today every PR's first build is cold.

**Independent Test**: After a merge to `main`, open a PR that changes a source file only; its Docker build logs show cached layers for the dependency stages.

**Acceptance Scenarios**:

1. **Given** `main` has built the images since the last dependency change, **When** a PR's Docker build runs, **Then** its dependency layers are cache hits.
2. **Given** a PR that changes `package-lock.json`, **When** its Docker build runs, **Then** the dependency layers rebuild and the image is correct.

---

### User Story 4 - Stacked releases collapse (Priority: P2)

When several merges land close together, only the newest pending release goes on to build and deploy; a release already running is never cancelled, and production still deploys only after staging passed for the same commit.

**Why this priority**: Six releases in 30 minutes each took the full CI run plus images plus two deploys from the same 20 slots the PRs needed.

**Independent Test**: Merge three PRs within a few minutes; the release workflow runs for the last one, the superseded pending ones stop, and the one already deploying finishes.

**Acceptance Scenarios**:

1. **Given** a release is pending (queued, not yet deploying) and a newer merge lands, **When** the newer release starts, **Then** the pending older one is superseded.
2. **Given** a release is deploying to staging or production, **When** a newer merge lands, **Then** the running deploy completes and the newer release waits.
3. **Given** staging failed for a commit, **When** that release reaches the production step, **Then** production does not deploy.

---

### User Story 5 - The documentation matches the layout (Priority: P3)

Someone reading AGENTS.md's PR CI bullet or `docs/speed-and-cost-plan.md` sees the jobs CI actually runs and why they are grouped as they are.

**Why this priority**: Agents read AGENTS.md to interpret a red check; a stale job list sends them to a job that no longer exists.

**Independent Test**: The job names in AGENTS.md's PR CI bullet equal the job names in `ci.yml`; the speed-and-cost plan has a row for this change with its measured before and after.

**Acceptance Scenarios**:

1. **Given** the new layout is merged, **When** AGENTS.md is read, **Then** its CI bullet lists the jobs of `ci.yml` and no job that was removed.

### Edge Cases

- A test that only fails in parallel (shared seeded account, shared mailbox or OpenID stand-in, port collision) must be found and fixed, not retried into green: the suite's `retries: 2` on CI can mask it.
- A folded check that fails must still be attributable: the job's log and the check's name on the PR must say which check failed, so `gh run view --log-failed` and the fix-ci flow still work.
- Grouping checks into one job changes the names reported to the PR; the merge gate (`merge-gate.mjs`) and the tail's CI wait read check buckets, and CI OK must still fail when any grouped check fails.
- A cache written on `main` with a different base image or lockfile must not produce a stale image: cache keys follow the Dockerfile's inputs.
- Collapsing releases must never skip a commit's production deploy that staging already passed, and must never cancel a running Railway deploy.
- `release.yml` calls `ci.yml` with `run-many`; a change to `ci.yml`'s job layout applies to releases too and must keep the full run on `main`.
- A docs-only PR keeps its two-job run.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The end-to-end suite on CI MUST run its tests in parallel across the runner's cores, and every test in the suite MUST still run on every non-docs PR that affects `web`.
- **FR-002**: A non-docs PR push MUST create fewer runner jobs than today's 14, and every check that CI performs today (Biome, typecheck, unit, integration, e2e, build, harness, contract check, dependency audit, Docker build of web and api, compose stack) MUST still run and MUST still fail CI OK when it fails.
- **FR-003**: A failing check inside a shared job MUST be identifiable by name from the job's failed log and from the PR's checks.
- **FR-004**: A non-docs PR push MUST install dependencies fewer times than today's seven.
- **FR-005**: PR Docker builds MUST reuse a layer cache written by builds on `main`, and a change to the build's inputs (lockfile, Dockerfile, base image) MUST invalidate the affected layers.
- **FR-006**: Of several releases pending for `main`, only the newest MUST run; a release whose deploy is already running MUST never be cancelled; production MUST deploy only after staging passed for the same commit.
- **FR-007**: The semantics the merge gate relies on MUST be unchanged: CI OK fails when any check fails, is skipped-aware for docs-only PRs, and a PR with a failing, pending or missing check is never merged.
- **FR-008**: The documentation MUST describe the new layout: AGENTS.md's PR CI bullet lists the jobs as they are, and `docs/speed-and-cost-plan.md` records this change with the measured baseline and the measured result.
- **FR-009**: A docs-only PR MUST keep running only the change detector and CI OK.

### Out of Scope

- **Other Node versions.** A Node matrix adds jobs under the same account-wide cap and the product runs one Node (`.nvmrc` = 24); switching runner labels (`ubuntu-24.04-arm`, `ubuntu-slim`) does not add slots either. Recorded here because the description asked; nothing changes the Node version or the runner label.
- Removing any check, or moving unit, integration or e2e suites out of PR CI.
- Mutation testing (`mutation.yml`, nightly) and the PR QA workflow's own job count.
- Paid runners or a larger concurrency plan.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Jobs per non-docs PR push in `ci.yml`: at most 8, from the measured 14 (the PR title and PR template workflows are not counted; they are separate workflows).
- **SC-002**: E2E job wall time on a PR that affects `web`: at most 6 min, from the measured 10–11 min (Playwright run about 9 min at one worker). The target assumes the 4-vCPU runner gives at least a 2x speed-up at 4 workers (autonomous default; verified on the first run and adjusted in the plan if the measurement disagrees).
- **SC-003**: Dependency installs (`setup` runs) per non-docs PR push: at most 4, from the measured 7.
- **SC-004**: A PR Docker build after a `main` build with the same lockfile reports cache hits for its dependency layers (measured from the build log; today 0 on a PR's first build).
- **SC-005**: Three merges to `main` within 10 minutes produce one completed release for the newest commit and no cancelled running deploy (today: one full release per merge).
- **SC-006**: Every check that fails today still fails CI OK: breaking one check per group on a branch turns CI OK red each time.

## Assumptions

- The PR title and PR template workflows stay as separate workflows; they are cheap and re-run on edit without re-running CI (autonomous default).
- The 4-vCPU `ubuntu-latest` runner can run 4 Playwright workers with the api, worker and web dev server alongside; the worker count is tuned on the measured run rather than fixed here (autonomous default).
- Checks are grouped by shared setup and runtime (the quick Node checks together; the service-backed suites keep their own jobs) so that a group's failure is still attributable; the exact grouping is the plan's decision (autonomous default).
- Docker layer caching across branches uses the registry or the Actions cache written on `main`; which one is the plan's decision (autonomous default).
- "Only the newest pending release runs" is read as: superseded releases stop before deploying; a deploy in progress always completes (autonomous default).
- No Notion page other than ST-750 describes this work; the card's Direction section is the only product input beyond the owner's description.
- Evidence numbers are from the GitHub API over 2026-10-03..06 as supplied to this run; they are not re-measured here.

## Spec Delta

- **Adds**: `ci` capability — PR CI runs its checks in fewer, grouped jobs with a parallel end-to-end suite and a Docker cache shared from `main`; stacked releases collapse to the newest pending one.
- **Modifies**: none.
- **Removes**: none.
