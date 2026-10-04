# Feature Specification: Test and review every ready PR like a QA engineer before it merges

**Feature Branch**: `434-agent-pr-review`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "ST-434 https://app.notion.com/p/3ef607bff0d2812185effb0ff2095302 — Test and review every ready PR like a QA engineer before it merges", epic [Foundations (EP-1)](https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707). Two owner additions relayed during the run: (a) the shared heavy-command lock is wired into the pre-commit hook and the edit/stop gates; (b) the Notion workflow gains the statuses QA and Blocked, which the spec-kit workflow must use.

**Sources**: the Notion story ST-434 (acceptance criteria and Build brief, written 2026-10-04), the owner's task statement for this run, `.specify/memory/constitution.md` v1.4.0, and this repository at `origin/main` 8cb1882.

The users of this feature are the agents that build MotorFix and the owner who reads Notion and GitHub. No MotorFix end user sees it.

## Clarifications

### Session 2026-10-04

- Q: The PR author and the reviewer are the same GitHub account, so GitHub refuses APPROVE and REQUEST_CHANGES. What carries the verdict? → A: A commit status `agent-review` (success or failure) on the PR head commit is the machine-readable verdict. The tester still tries the real review event first and falls back to a COMMENT review whose first line states the verdict.
- Q: A PR that touches no UI (a harness change) shows findings on pages it did not change, for example an accessibility issue already on `main`. Do they block it? → A: No. When the diff touches no web code, sweep findings are reported as pre-existing and capped at medium; only a failed boot, a failed health check, a page that does not load or a failing test blocks. When the diff touches web code, every finding keeps its own severity.
- Q: How is "the merge waits for the verdict" enforced, given a Stop hook cannot stop a merge? → A: Twice. A PreToolUse gate refuses `gh pr merge` (and the REST merge call) while the PR head commit has no `agent-review` success. The Stop gate refuses to end a session on a ready PR whose other checks passed but that has no `agent-review` success on its head, telling the agent to run the tester.
- Q: Where does the tester's evidence go? → A: Under `.work/pr-test/<pr>-<sha7>/` in the checkout that ran it (git-ignored): `report.json`, `report.md`, one screenshot per route × viewport × scheme × language. The implementing agent copies the report and a screenshot per viewport into `specs/<feature>/pr-review/`.
- Q: Which Notion status holds during the test, fix and retest loop? → A: QA (owner addition). In progress → In review (PR ready, spec and code review) → QA (tester starts) → Done (merged). Blocked whenever the run cannot proceed; resuming returns to the status before Blocked.
- Q: A blocked run leaves a ready PR with an `agent-review` failure or none; does the Stop gate trap it? → A: No. With a failure on the head it lets the session end (the fix loop owns the PR); with no review at all it refuses unless run-state says `blocked`.
- Q: Which paths are "web code", and does the cap reach the API calls? → A: `apps/web`, `libs/ui-cockpit`, `libs/i18n`, `libs/data-access`, `libs/media`. The cap applies to browser-sweep findings only; the API calls and test runs exercise the change itself and keep their severity.
- Q: Do third-party requests and console warnings count? → A: Only requests to the tester's own web and API origins rank by status; a failed request to another host is `low`. Only `console.error` messages count.
- Q: How long do the gates wait for the lock? → A: post-edit 60 s, Stop 300 s, pre-commit without limit. A skipped check says so in the hook output.
- Q: On a re-run, is the "Agent review" section appended to? → A: Replaced with the latest summary, the tested commit and the lap; earlier laps stay as reviews and statuses.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A ready PR is tested and reviewed before it merges (Priority: P1)

An agent finishes a task, marks its PR ready and moves the story to In review. Before merging it starts the PR tester on the PR. The tester checks the head commit out into its own worktree, boots the services and apps, drives the web app in a real browser, calls the API, runs the relevant tests, reviews the diff against the spec and the constitution, posts a review and sets `agent-review` on the head commit, then removes everything it started.

**Why this priority**: it is the step the owner asked for; nothing else here matters without it.

**Independent Test**: run the tester on a ready PR and observe the worktree, containers and servers come and go, the report and screenshots on disk, the review on the PR and the status on the head commit.

**Acceptance Scenarios**:

1. **Given** a ready PR, **When** the tester runs, **Then** it works in a new worktree at the PR head commit, never in the implementer's checkout, and removes that worktree when it ends.
2. **Given** the tester starts PostgreSQL, Redis and object storage, **When** other sessions use the default ports, **Then** it uses free host ports and its own compose project, and removes those containers and volumes when it ends.
3. **Given** the tester boots the apps the change needs, **When** they answer their health URLs, **Then** the sweep starts; **When** one does not answer within its time limit, **Then** that is a blocking finding and the run still tears down.
4. **Given** a running web app, **When** the sweep runs, **Then** it visits each route at desktop 1440×900, tablet 834×1194 and mobile 390×844 with touch, in light and dark colour schemes, in Romanian and English, with one browser and one page at a time, and stores a screenshot of each.
5. **Given** a page in the sweep, **Then** console errors, uncaught page errors, failed requests and 4xx/5xx responses, axe accessibility violations and horizontal overflow are each recorded as a finding with a severity, the route, the viewport, the scheme, the language, reproduction steps and the screenshot path.
6. **Given** the diff changes API endpoints (the committed `apps/api/openapi.json` differs from the base), **When** the API is up, **Then** each changed GET endpoint without path parameters is called and a 5xx answer is a `high` finding; the readiness check is always called.
7. **Given** the tester process is killed or a step throws, **Then** servers, containers and the worktree are still removed.

---

### User Story 2 - The verdict decides the merge (Priority: P1)

**Why this priority**: a review nobody has to wait for is decoration (constitution, Enforcement).

**Independent Test**: harness eval cases feed the gates a PR state with and without an `agent-review` success.

**Acceptance Scenarios**:

1. **Given** findings, **When** any is `blocker` or `high`, **Then** the verdict is failure; otherwise it is success.
2. **Given** a verdict, **When** the tester posts, **Then** it tries a REQUEST_CHANGES (failure) or APPROVE (success) review, and when GitHub refuses it because the author is the reviewer, posts a COMMENT review that starts with the verdict; it sets the commit status `agent-review` to failure or success on the head commit; it writes the report summary into the PR description's "Agent review" section, or as a PR comment when the description has no such section.
3. **Given** `--dry-run`, **Then** nothing is posted to GitHub and the review, status and section are printed instead.
4. **Given** a ready PR whose head commit has no `agent-review` success, **When** an agent runs `gh pr merge` on it, **Then** the merge gate refuses; **Given** the success exists, **Then** the gate lets the command run.
5. **Given** a ready PR whose checks other than `agent-review` all passed and that has no `agent-review` success on its head, **When** the session tries to end, **Then** the Stop gate refuses and says to run the tester; with the success present it says to merge.

---

### User Story 3 - Blocking findings loop back to the implementer, capped (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a failure verdict, **When** the implementing agent fixes the blocking findings (tests first) and pushes, **Then** the tester runs again on the new head commit; the new commit has no status until it does.
2. **Given** each fix-and-retest lap, **Then** it is counted by `run-state.mjs repair`; **When** the count passes `SPECKIT_MAX_REPAIR_ITERATIONS` (5), **Then** the run is blocked with `repair-loop-exceeded`, the reason is posted on the PR and in Notion, the story goes to Blocked, and the PR is not merged.
3. **Given** a success verdict and every other check green, **Then** the agent merges and runs `speckit-notion-sync finish`.

---

### User Story 4 - Notion shows QA and Blocked (Priority: P2)

**Acceptance Scenarios**:

1. **Given** the tester starts on a ready PR, **Then** the story and its timeline row go to QA and stay there through the fix and retest loop.
2. **Given** a run that cannot proceed (a Hard Stop, a blocking condition in run-state, the repair cap, red CI the agent cannot fix, an unresolved Blocked by), **Then** the story and its timeline row go to Blocked, the reason is a comment on the story and on the PR, and the status before Blocked is kept in run-state.
3. **Given** a blocked run resumes, **Then** the story returns to the status it had before Blocked; that is the only backwards move.
4. **Given** a Done story, **Then** no event moves it.

---

### User Story 5 - Heavy commands share one lock (Priority: P2)

**Acceptance Scenarios**:

1. **Given** `scripts/heavy.sh <command>`, **Then** it waits for the lock file (`MOTOR_FIX_HEAVY_LOCK`, default `/tmp/motor-fix-heavy.lock`) and for the free-memory floor (`MOTOR_FIX_HEAVY_MIN_FREE`, default 30 %), runs the command and returns its exit code.
2. **Given** a command already running under the lock (`MOTOR_FIX_HEAVY_HELD=1`), **When** it calls `heavy.sh` again, **Then** the inner call runs at once instead of waiting on itself.
3. **Given** `MOTOR_FIX_HEAVY_WAIT=<seconds>`, **When** the lock or the memory floor is not had in that time, **Then** `heavy.sh` exits 75 without running the command.
4. **Given** a real commit, **Then** `.husky/pre-commit` runs its typecheck, lint and test under the lock with one Nx task at a time and two Jest workers.
5. **Given** the Stop gate or the post-edit gate needs Jest, **Then** it runs under the lock with a bounded wait and two workers; when the lock is not had in time it reports that the check was skipped and does not block.

### Edge Cases

- The PR is closed or merged when the tester starts: it stops with a message, posts nothing.
- The PR head moved while the tester ran: the status is set on the commit it tested, which is no longer the head, so the gates still refuse until it runs on the new head.
- Docker is not running: the boot fails with a blocking finding, teardown still runs.
- A dependency install fails in the tester worktree: blocking finding.
- The PR description has no "Agent review" section (the PR template has not landed): the summary goes in a comment.
- The `gh` call that posts the review fails: the status is still attempted; a failed status call makes the tester exit non-zero so the caller does not read silence as success.
- Two testers on the same machine: the lock serialises them; ports and compose project names never collide.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The tester MUST check the PR head commit out into a new worktree outside the implementer's checkout, and MUST remove that worktree when it ends, on success, failure or interruption.
- **FR-002**: The tester MUST pick free host ports for every service and app it starts and MUST run its containers as their own compose project, removing them and their volumes when it ends.
- **FR-003**: The tester MUST boot the API and the web app (built for production, server-side rendered) for every PR, and the worker when the diff touches the worker or a lib it uses, and MUST wait for each health URL with a time limit; a timeout is a blocking finding.
- **FR-004**: The sweep MUST visit each route in every combination of three viewports (desktop 1440×900, tablet 834×1194, mobile 390×844 with touch), two colour schemes and two languages, with one browser and one page at a time, and MUST store one screenshot per combination.
- **FR-005**: The sweep MUST record console errors, uncaught page errors, failed requests, 4xx/5xx responses, axe violations and horizontal overflow as findings, each with severity, route, viewport, scheme, language, reproduction steps and screenshot.
- **FR-006**: Severity MUST follow one table: uncaught page error, failed boot, failed health, page not loading and failing test are `blocker`; `console.error`, a 5xx or failed request to the tester's own origins, axe critical/serious and mobile overflow are `high`; 4xx on its own origins, axe moderate and overflow at other widths are `medium`; axe minor and any failed request to another host are `low`. When the diff touches no web code (`apps/web`, `libs/ui-cockpit`, `libs/i18n`, `libs/data-access`, `libs/media`), browser-sweep findings other than a page not loading are capped at `medium` and marked pre-existing.
- **FR-007**: The tester MUST call the readiness URL of each app it booted and each changed GET endpoint without path parameters (from the diff of `apps/api/openapi.json`); a 5xx answer is `high`.
- **FR-008**: The tester MUST run the affected projects' tests and the end-to-end suite against the apps it booted; a failing test is `blocker`.
- **FR-009**: The verdict MUST be failure when any finding is `blocker` or `high`, and success otherwise.
- **FR-010**: Posting MUST try the real review event, fall back to a COMMENT review that starts with the verdict when GitHub refuses it, set the commit status `agent-review` on the tested commit, and replace the PR description's "Agent review" section with the latest summary (tested commit, lap) or add a comment; `--dry-run` MUST post nothing and may target a PR in any state.
- **FR-011**: The merge gate MUST refuse `gh pr merge` and the REST merge call for a PR whose head commit has no `agent-review` success, and allow it otherwise.
- **FR-012**: The Stop gate MUST refuse to end a session on a ready, mergeable PR whose other checks passed but whose head commit has no `agent-review` status, naming the tester, unless run-state is `blocked`; with an `agent-review` failure it lets the session end; with the success present it keeps its existing "merge it" refusal.
- **FR-013**: The whole boot-test-teardown sequence MUST run inside one hold of the shared lock, and the tester MUST re-run itself through `scripts/heavy.sh` when started outside it.
- **FR-014**: `scripts/heavy.sh` MUST serialise on a configurable lock file, wait for a configurable free-memory floor, be re-entrant under `MOTOR_FIX_HEAVY_HELD`, support a bounded wait that exits 75, and return the command's exit code.
- **FR-015**: `.husky/pre-commit` MUST run under the lock with one Nx task at a time and two Jest workers; the post-edit gate (60 s) and the Stop gate (300 s) MUST run Jest under the lock with that bounded wait and two workers, and skip with a report when the lock is not had.
- **FR-016**: The Notion status decision MUST be scripted: events `start`, `review`, `qa`, `finish`, `blocked`, `unblock` map to story and timeline statuses on the order To do < In progress < In review < QA < Done, with Blocked outside it; no event moves a story backwards; `blocked` records the status it left (a second `blocked` keeps the first record); only `unblock` leaves Blocked, returning to the recorded status; nothing moves a Done story.
- **FR-017**: `/speckit-auto`, `/speckit-review`, AGENTS.md and Constitution VII MUST put the tester between "ready" and "merge", with the fix-and-retest loop counted by `run-state.mjs repair` and the story in QA during it.

## Spec Delta

### Capability: `harness`

- **Adds**: FR-001–FR-017

### Key Entities

- **Finding**: severity, kind, title, route, viewport, scheme, language, steps, evidence path, pre-existing flag.
- **Report**: PR number, tested commit, base, findings, verdict, started and ended times, what was booted.
- **Verdict**: `success` or `failure`, carried by the commit status `agent-review`.

## Success Criteria *(mandatory)*

- **SC-001**: Every merge of a ready PR after this lands has an `agent-review` success on the merged head commit (checked by the merge gate).
- **SC-002**: After a tester run, no container, server process or worktree it started remains (checked by the run's teardown log and `docker ps`, `git worktree list`).
- **SC-003**: A dry run against PR #14 (it touches `apps/web`) produces `report.json` with one screenshot per route × viewport × scheme × language and makes no GitHub write.

## Assumptions

- Tablet viewport 834×1194 (iPad Air portrait) *(autonomous default; the owner said "tablet" without a size)*.
- Routes swept by default: `/` and `/cockpit`; the pr-tester agent adds `--routes` from changed route files, and records a changed route it cannot reach (guarded `/app/*` areas need a session) as a `medium` "not swept" finding *(autonomous default)*.
- Language is chosen through the `mf.lang` local-storage key the language switch uses, and the browser locale *(autonomous default; read from PR #14's `libs/i18n/src/switch.ts`)*.
- `agent-review` is not made a required check in GitHub branch protection; that is a repository setting for the owner *(autonomous default)*.
