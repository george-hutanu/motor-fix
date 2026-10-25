# speckit-auto: the lifecycle in full

AGENTS.md keeps each rule in a sentence and points here for the how-to. Read
the part you are about to run: the story's agent at the draft PR and at ready
(`hand-off.md`), the tail at QA and merge (`tail.md` repeats what it needs).

## The tracker is GitHub, and design comes first

These hold for every piece of work in this repo: a story, a task, a bug, an
epic or a plan, whether run through spec-kit or by hand.

The tracker is GitHub: each story, task and epic is an issue in the private
`george-hutanu/motor-fix-specs`, its ST or EP id first in the title, with
its Status, dates and PR in Project "MotorFix" (#11); `speckit-tracker-sync`
(`.claude/scripts/tracker-sync.mjs`, log `specs/<feature>/tracker-sync.md`)
writes them, for every task. A folder that still holds an older log moves
to `tracker-sync.md` at its next event.

- **Check the design before starting.** Before any code, read the story's
  boards in the clickable mock (the story's `Design` and `Design boards`
  fields) and the Build brief's Screens section, and write
  `specs/<feature>/design.md`. Skill: `speckit-design-check`.
- **Every task follows the same lifecycle, in this order.** This is a hard
  rule, Constitution VII, enforced by the `stop:pr-lifecycle` and
  `pre:bash:merge-gate` gates:
  1. Take the task and set it to Planning (`speckit-tracker-sync start`);
     it moves to Implementing when `/speckit-implement` begins
     (`speckit-tracker-sync implement`, the `before_implement` hook).
  2. Open a draft PR for its branch at the start (`speckit-git-commit`; before
     planning has a commit, an empty `chore(<scope>): ST-<n> start …` one),
     its body made from `.github/pull_request_template.md`:
     `gh pr create --draft --label planning --body-file <body>`, never
     `--body` or `--fill`.
     Then write the PR's link onto the issue's `PR` field and the PR's
     `Closes` line (`speckit-tracker-sync pr <n>`): every task links its own PR.
  3. Do the work, pushing every commit to that branch: never forced, never `main`.
     Before each push, `node .claude/scripts/lifecycle.mjs check` runs the
     CI-only checks (observability inventory, PR template, folder rules),
     lint and the affected typecheck and unit tests; a refusal is fixed first.
  4. When it is done (tests, typecheck and lint green, review with no
     CRITICAL/HIGH left), fill in every section of the template
     (`node scripts/pr-body-check.ts --body-file <body> --title "<title>"`
     passes, then `gh pr edit <n> --body-file <body>`), mark the PR ready for
     review (`gh pr ready`) and set the task to QA
     (`speckit-tracker-sync qa`, which also sets the PR's one stage label
     to `QA`). There is no In review stage: ready is QA. A feature's own
     records go out before it is ready: the Spec Delta merge
     (`.specify/capabilities/`) is committed on the branch, and the
     archive's status line, a retrospective if one was written and
     `specs/<feature>/tracker-sync.md` are pushed to the specs repo (see
     "Specs live in their own repo"); the `qa` line follows right after,
     before CI is waited for and QA starts. A level-1 story's agent ends at phase 10 and a closer
     carries it to this step (`phases-close.md`).

     Then the story's agent starts QA and hands off. It dispatches the PR QA
     run for the head without waiting for it
     (`.claude/scripts/pr-test/dispatch.mjs <n> --no-wait`), writes
     `specs/<feature>/handoff.md` (PR, branch, worktree, head sha, the story's
     issue, the `QA run:` line, open decisions; git ignores it) and returns `NEXT: tail #<n> after QA run <id>`, its last
     action: a context that sleeps past the 5-minute prompt cache is
     written again in full. On that NEXT the session dispatches a fresh
     **tail agent** at once, whatever the run's and CI's state, given only
     the PR number, the worktree and that path; the session waits for
     nothing and relays nothing, and starts the next task's build: one task
     being built per session, any number waiting on QA and CI. The tail
     holds the waits itself, in the background (`ci-wait.mjs <n> --run <id>`,
     then `ci-wait.mjs <n>`), and runs steps 5–7 and the finish. The
     orchestrating session dispatches it (a story run in the owner's
     own session does its own); `/speckit-watch` shows such a PR `waiting`,
     with no fix, until the run has finished, and then dispatches one (its
     `tail` fix) when nobody holds it. It implements
     QA fixes, so it keeps the default model (Opus). It deletes the note
     when the task is Done. The story's agent, the tail agent and every
     `/speckit-watch` fix run as `task-runner` (`.claude/agents/`), never
     `general-purpose`: it denies the heavy tools those runs never use, and
     its prompt names no re-read of AGENTS.md or CLAUDE.local.md, which are
     already in its context.
  5. Get CI green: a branch behind `main` merges `origin/main` in only when
     `node .claude/scripts/merge-main.mjs --needed` says so (exit 0, or
     exit 2 when git cannot answer); on exit 1 nothing is merged and the head
     keeps its QA run and `agent-review`. The merge is
     `node .claude/scripts/merge-main.mjs`, which resolves the capability
     specs, the hook registry and the generated client itself, then a
     push. It runs also at hand-off, before ready and the QA dispatch
     (`hand-off.md` step 1): the story's agent merges only on an overlap and
     reaches green CI first. The checks are waited for in the background
     (`run_in_background`), by the tail before the merge, never in a
     foreground `sleep` loop. A failing check is fixed on the branch like a
     failing QA lap (step 6).
  6. QA, started as soon as the PR is ready, beside step 5 rather than after
     it: its run is dispatched at ready, and the PR tester
     (`/speckit-pr-test <n>`, the `pr-tester` subagent) reviews it once it
     has finished (`--run <id>`), while CI may still be running; a pending
     check holds only the merge;
     the task and the PR's stage label stay QA. It leaves the unit suites to
     CI, which runs them on the merge result, the integration suite to its
     on-demand run and the release, and the end-to-end suite to its
     on-demand run and the release's core flows. The run is
     the PR QA workflow (`.github/workflows/pr-qa.yml`), where a
     GitHub runner boots the PR head, tests it in a browser and against the
     API and uploads the report and screenshots; then, locally, the tester reviews the
     diff, posts a review, fills the template's "Agent review" section and sets
     the `agent-review` status on the head commit (`--local` boots on the
     laptop instead, behind the heavy lock, when Actions is unavailable).
     Its routes are `path[?query][@role][:status]` (`/:lang` first only,
     `@role` required under `/app/`, each served by the router), and its
     flows are pre-checked statically; a live proof
     (`precheck.mjs --flows <f> --check`, then `dispatch.mjs --proof`) is
     taken only when the story changed flows (the skill's "Routes and
     flows"). A blocker or high finding fails the lap: fix every
     finding (tests first), push, dispatch the new head's run with `--no-wait` and
     end, as at ready; each such lap counts toward
     `SPECKIT_MAX_REPAIR_ITERATIONS` (10), and at the cap the task goes to
     Blocked and the PR stays unmerged. A head that differs from the last
     tested commit by documentation only (`scripts/docs-only.ts`), or by a
     merge of `origin/main` that changes none of the PR's files (`merge of
     main`), carries that verdict instead of a new lap
     (`.claude/scripts/pr-test/carry.mjs`); the merge gate verifies the carry.
     A lap with no blocker or high finding ends QA: its medium and low
     findings are fixed (tests first), listed under "Fixed after QA" in
     `finish-comment.md`, and its verdict carried to the fixed head
     (`carried from <sha>: QA fixes`), with no lap counted (tail.md step 3).
     Each line names its severity and where the fix is, made after the
     lap's verdict: a PR commit's sha, `specs@<sha>` for a commit on the
     specs repo's trunk, or `qa-flows-<n>.mjs` for a change to the
     git-ignored QA flows file only (its modification time is the proof).
  7. Merge on `agent-review` success with every other check green, at once
     (`node .claude/scripts/lifecycle.mjs merge --pr <n>`, which also checks
     the "Fixed after QA" list; with a check still pending the tail holds
     the CI wait itself and merges when it is green); a PR with a failing, pending or missing check
     is never merged. Then set the task to Done (`speckit-tracker-sync finish`, which closes its issue).
     The orchestrating session then fast-forwards the main checkout
     (`git -C <main> merge --ff-only origin/main`); when the watch reports it
     `behind`, `/speckit-watch`'s `ff-main` safe fix does it. The main
     checkout holds no edits to tracked files (`pre:edit:main-checkout`).
     What only exists after the merge (the merge sha, the finish, ready and
     comment lines) goes to the tracker and into one comment on the merged PR
     (`gh pr comment <n>`), never a commit of its own; whatever must reach a
     file rides on the next PR.
     `agent-review` and `CI OK` are required status checks on `main`, for
     administrators too (`node .claude/scripts/branch-protection.mjs check`;
     `apply` sets them with the owner's token), so GitHub refuses the merge
     the gate would. A PR opened by Dependabot (its author on GitHub, not its
     title or branch) and holding only Dependabot's commits skips step 6:
     `.github/workflows/dependabot-review.yml` (base branch's copy, on
     `pull_request_target`) writes its `agent-review` success after the
     gates' rule, and it merges on every other check green, `CI OK`
     included; a failing, pending or missing check still refuses it.

  Every verified review, QA or harden finding is fixed in the current task's
  PR before ready or merge; one needing an owner decision becomes a
  needs-confirmation question on the task. That holds for every source
  (code-reviewer, spec-reviewer, test-adversary, pr-tester) and for a problem that existed before the change or sits next
  to it (route `patch`). The question is a comment on the task's issue with
  the `needs-confirmation` label, and the task goes to Blocked
  (`speckit-tracker-sync blocked <question>`) until the owner answers. There
  are no tech-debt tickets.

  Whenever the work cannot go on without something outside it (a Hard Stop,
  red CI the agent cannot fix, the repair cap, an unresolved Blocked by), set
  the task to Blocked with the reason as an issue comment and a PR comment
  (`speckit-tracker-sync blocked <reason>`); `speckit-tracker-sync unblock`
  returns it to where it was. Each step also moves the PR's label —
  `planning` until `/speckit-implement`, then `in development`, then `QA`
  from the moment it is ready, plus `blocked` — so GitHub shows the
  same stage as the tracker. Next to its one stage label a PR carries its type
  (`feature`, `bug`, `tech debt`, …, from the title), `breaking`, its scope,
  its epic, `ui` and `dependencies` where they apply (table in
  `speckit-tracker-sync`, §2a); the merge removes the stage labels.

  No step waits for the user: opening the draft, pushing, marking it ready,
  merging on green CI and the tracker writes are all standing instructions. The
  tracker writes cover the story's issue and the epic's (Implementing at its
  first story, Done and closed at its last).
- **A finished task says what happened.** Every `finish`
  comments on the task when there is something to record: deviations from
  the Build brief, decisions taken on the owner's behalf, open questions.
- **Plans:** each epic's build plan is a file in the specs repo's
  `docs/reference/build-plans/`, written with `llms.txt` in one specs-repo
  commit (`speckit-tracker-sync plan`, §6); its waves and blocked-by edges
  are the epic's sub-issues and their "blocked by" links.
- **The spec-kit hooks do this automatically** (`.specify/extensions.yml`:
  `after_specify`, `before_plan`, `before_implement`), and so do
  `/speckit-review` and `/speckit-archive`. Outside spec-kit, run the skills
  yourself. After every merge to `main`, run `speckit-tracker-sync finish`.
- **Observability ships with the change.** A story that adds a service,
  resource, queue, outside call, endpoint or product action adds its metrics,
  logs, traces, dashboard panel and alert (or says why not) in the same PR,
  lists them in its Observability section and in
  `infra/observability/inventory.json`; `scripts/observability-inventory.ts`
  fails CI on one left out.
- **Every PR uses the template**, `.github/pull_request_template.md`, whoever
  opens it. The `PR template` workflow (`scripts/pr-body-check.ts`, whose
  header lists the rules) checks a draft's headings and a ready PR's every
  section, and names what is missing. Write `N/A` and the reason where a
  section does not apply. Agent review is filled in by the automated reviewer.
- A tracker or mock failure never blocks the build. It is logged in
  `specs/<feature>/tracker-sync.md` or `design.md` and retried on the next run.


## Specs live in their own repo

motor-fix is public and does not track the specs (`.gitignore`:
`/.motor-fix-specs/`, `/specs`). Every checkout, the main one and each
worktree, holds its own clone of the private `george-hutanu/motor-fix-specs`
at `.motor-fix-specs/` (`cloneDir`), on `trunk`; never a submodule. Its
`specs/` holds the feature folders and `specs` in the checkout links to it;
its `docs/` holds the product documentation, organised by Diátaxis
(`tutorials/`, `how-to/`, `reference/`, `explanation/`, decisions one file
each in `explanation/decisions/`), the repo its only source; `llms.txt` at
its root lists every page with its summary, so an agent reads it first, and
`docs/index.json` maps each old page id to its file. Its
`scripts/docs-lint.mjs` checks the pages; `specs-repo.mjs commit` runs it before a docs change goes in, and no Actions workflow runs it.
`node .claude/scripts/specs-repo.mjs ensure` clones, adopts, moves an older
clone at `specs/` into place or fast-forwards it (npm `prepare` and
SessionStart run it `--soft`); `commit "<message>" -- <feature>` (or a
`docs/…` path) commits and pushes to `trunk`, rebasing and retrying when
another session pushed first. `migrate-trunk` moved trunk's feature folders
under `specs/` once. `lifecycle.mjs`
ready and merge use it, and `stop:pr-lifecycle` refuses unpushed specs
commits. Workflows do not read specs; `SPECS_DEPLOY_KEY` (read-only) is
there for one that will.


## CI, tests and release

- Lint and format: Biome only, root `biome.jsonc` (no eslint, no prettier).
  Tests: Jest from the root config, Playwright for end-to-end. NestJS 12 is
  ESM-only, so the Nest projects' `test` targets run Jest with
  `--experimental-vm-modules`.
- Root scripts: `typecheck`, `lint`, `test`, `build`, `e2e` run across every
  project; the harness specs keep `npm run test:harness`. Stryker runs only
  in the Mutation workflow, never on a laptop: one job per project or per
  shard of one (each project's `test:mutation` target, the shards in
  `scripts/mutation-shards.json`), against the floor in each project's
  `stryker.config.json`, which only rises. The root `test:mutation` and
  `test:mutation:affected` scripts stay, never for a laptop.
  The waits for a handed-off PR are the tail's own, in the background
  inside its run: `node .claude/scripts/pr-test/ci-wait.mjs <n> --run <id>`
  for the QA run, then `ci-wait.mjs <n>` for CI before the merge
  (`tail.md` "The wait"); the session waits for nothing and relays nothing.
  Mutation is never part of a task's lifecycle: no task dispatches, reads or
  waits for a Mutation run, and no wait or gate counts its check on a PR head
  (`.claude/scripts/lib/mutation-check.mjs`). Its schedule on `main` and
  `workflow_dispatch` are the only places it runs; a surviving mutant is
  picked from the Project like any task. A spec that
  needs PostgreSQL or Redis is named `*.integration.spec.ts`;
  `npm run test:unit` leaves those out and `npm run test:integration` runs
  only them (`JEST_SUITE` in `jest.preset.cjs`; unset runs all). Integration
  tests need `docker compose up -d` (or local servers), with `DATABASE_URL`
  and `REDIS_URL` from `.env.example`. Like the end-to-end suite they run on
  demand, never per PR or per commit: `lifecycle.mjs check` sets
  `JEST_SUITE=unit` and needs no Docker, and the pre-commit hook runs no tests. To run them by hand, `eval
  "$(node scripts/test-services.ts origin/main)"` starts and migrates the
  worktree's own PostgreSQL and Redis (compose project
  `mf-test-<worktree>-<hash>`, left running), then
  `JEST_SUITE=integration npx nx affected -t test`. Removing a
  worktree takes its stack down with its volumes, and each `/speckit-watch`
  pass runs `test-services.ts sweep`, which stops those of merged, closed or
  deleted worktrees; neither fails on Docker. By hand,
  `node scripts/test-services.ts down [<worktree>] [--volumes]` stops one
  stack (the current checkout's by default).
- PR CI: `.github/workflows/ci.yml`, seven jobs, so a PR holds at most seven
  of the free plan's 20 concurrent runners: Checks (one runner and one
  install: Biome, Dependency audit, Typecheck, Build, Contract check, Harness,
  and Compose stack, where `docker-compose.yml` boots and creates the bucket;
  each step runs even after an earlier one failed), Unit tests (no
  services), Docker build (`web`, `node-app`,
  reading the layer cache that `release.yml` writes on `main`, and
  `keycloak`), then `CI OK`, which fails when any of them did; a skipped
  job or step counts as passed there and at the merge gate. A PR that
  changes documentation only (`scripts/docs-only.ts`: Markdown outside
  `.claude/`, `.specify/` and `.github/`, or `docs/`) runs only the
  Changes and `CI OK` jobs. `scripts/ci-paths.ts` filters the rest by path:
  Docker build only on an image input (a Dockerfile, `package*.json`,
  `.nvmrc`, `docker/`, `infra/keycloak/`, `libs/domain/prisma/`,
  `apps/*/project.json`, build config), Compose stack only on `docker-compose*.yml` or `infra/`, Harness
  and its browser only on `.claude/`, `.specify/`, `.husky/`, `.github/`,
  `scripts/` or `package*.json`; a change to `ci.yml` runs all three. Integration tests
  (PostgreSQL+PostGIS and Redis services, the migrations applied) runs only
  on demand and when a caller asks for it (the `workflow_call` input
  `integration`, which `release.yml` sets, so a release runs the suite before
  anything is built). The seventh job, E2E tests (Playwright `web-e2e`, four workers, servers started
  in the job; a test that passes only on a retry fails; the report uploaded),
  runs only on demand: `gh workflow run ci.yml --ref <branch>` runs every
  job on every project, Integration, E2E and Docker build included. Locally the suite is
  `npx nx run web-e2e:e2e` under `scripts/heavy.sh`. The PR title (Conventional Commit) is checked by its
  own workflow, `.github/workflows/pr-title.yml`, which also runs when the
  PR is edited, so a corrected title re-checks without re-running CI. PRs
  run `nx affected`; `release.yml` calls the
  same workflow, which then runs every project. Mutation testing never runs
  in PR CI: `.github/workflows/mutation.yml` runs it every 3 days on `main`
  and on `workflow_dispatch` (`projects`, `shards`, `full`), one job per
  project or per shard of one split in `scripts/mutation-shards.json`, five
  at a time, each with its own PostgreSQL, Redis, cache and report and its
  own time limit; a summary job holds each project's combined score to its
  floor.
- Release: `.github/workflows/release.yml` builds one image per app (root
  `Dockerfile`), deploys staging through `scripts/railway-deploy.ts`, runs the
  core flows there (tests tagged `@core`: search to a quote request, the
  quote, a listing to its approval; `--grep @core`), and promotes the same
  digests to production while the repository variable `PRODUCTION_ENABLED`
  is `true` (the owner sets it; unset is off, and the production job is
  skipped before it binds its environment): a merge reaches production only
  when CI and staging both passed. Release checks run one at a time (`release-checks`); a waiting
  one is replaced by the newest merge, which carries it. The full suite
  against staging runs by hand: `BASE_URL=<staging> E2E_PASSWORD=<seed
  password> npx nx run web-e2e:e2e`.
