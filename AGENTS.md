# AGENTS.md

Guidance for AI agents (and humans) working in motor-fix. The spec-kit
workflow and its gates are in [CLAUDE.local.md](./CLAUDE.local.md).

## Identity — personal repo, not work

Every commit and push here is **george-hutanu <hutanugeorge40@gmail.com>** on
GitHub account **george-hutanu**. Never the work identity (the work e-mail and
work GitHub account), which is this machine's global default and must stay
that way for `~/code`.

- `sh .husky/identity.sh apply` writes the repo-local git config: author, and
  credentials pinned to george-hutanu's gh token. `npm install` runs it via
  `prepare`, so a fresh clone is covered. It also drops the desktop app's
  pin of a new worktree's `core.hooksPath` to the main checkout once the
  worktree has its own `.husky/_`, and `check` reports a checkout whose
  hooks run from elsewhere.
- `.husky/pre-commit` refuses any commit not authored as george-hutanu.
- `gh` follows gh's active account, which stays the work one. Agent sessions get
  `GH_TOKEN` for george-hutanu from the SessionStart hook; in your own
  terminal, prefix: `GH_TOKEN=$(gh auth token -u george-hutanu) gh …`.
- Never `gh auth switch` to george-hutanu, and never edit `~/.gitconfig` for
  this repo — both would change every work repo under `~/code` too.
- In a cloud session (`CLAUDE_CODE_REMOTE=true`) a proxy carries GitHub's
  credentials: the hook exports nothing, `apply` sets the author only, and
  `check` skips credential pinning (see "Cloud sessions").

## The tracker is GitHub, and design comes first

These hold for every piece of work in this repo: a story, a task, a bug, an
epic or a plan, whether run through spec-kit or by hand.

The tracker is GitHub: each story, task and epic is an issue in the private
`george-hutanu/motor-fix-specs`, its ST or EP id first in the title, with
its Status, dates and PR in Project "MotorFix" (#11); `speckit-tracker-sync`
(`.claude/scripts/tracker-sync.mjs`, log `specs/<feature>/tracker-sync.md`)
writes them. A task that started on Notion (its folder holds
`notion-sync.md` and no `tracker-sync.md`) finishes there through
`speckit-notion-sync`; `lifecycle.mjs` picks the same on its own.

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
     before CI is waited for and QA starts.

     Then the story's agent starts QA and hands off. It dispatches the PR QA
     run for the head without waiting for it
     (`.claude/scripts/pr-test/dispatch.mjs <n> --no-wait`), writes
     `specs/<feature>/handoff.md` (PR, branch, worktree, head sha, the story's
     issue, the `QA run:` line, open decisions, deferred items; git
     ignores it) and returns `NEXT: tail #<n> after QA run <id>`, its last
     action. No agent is alive while CI and the run work: a context that
     sleeps past the 5-minute prompt cache is written again in full. The
     session holds one background wait until both have finished, then
     dispatches a fresh **tail agent**, given only the PR number, the
     worktree and that path, which runs steps 5–7 and the finish. The
     orchestrating session does this on that NEXT (a story run in the owner's
     own session does its own); `/speckit-watch` shows such a PR `waiting`,
     with no fix, until both have finished, and then dispatches one (its
     `tail` fix) when nobody holds it. It implements
     QA fixes, so it keeps the default model (Opus). It deletes the note
     when the task is Done. The story's agent, the tail agent and every
     `/speckit-watch` fix run as `task-runner` (`.claude/agents/`), never
     `general-purpose`: it denies the heavy tools those runs never use, and
     its prompt names no re-read of this file or CLAUDE.local.md, which are
     already in its context.
  5. Get CI green: merge `origin/main` into the branch if it is behind and
     push; the checks are waited for in the background (`run_in_background`),
     by the session before the tail starts, never in a foreground `sleep`
     loop and never by an agent that would sleep through it. A failing check
     is fixed on the branch like a failing QA lap (step 6).
  6. QA, started as soon as the PR is ready, beside step 5 rather than after
     it: its run is dispatched at ready, and the PR tester
     (`/speckit-pr-test <n>`, the `pr-tester` subagent) reviews it once it
     has finished (`--run <id>`);
     the task and the PR's stage label stay QA. It leaves the unit and
     end-to-end suites to CI, which runs them on the merge result. The run is
     the PR QA workflow (`.github/workflows/pr-qa.yml`), where a
     GitHub runner boots the PR head, tests it in a browser and against the
     API and uploads the report and screenshots; then, locally, the tester reviews the
     diff, posts a review, fills the template's "Agent review" section and sets
     the `agent-review` status on the head commit (`--local` boots on the
     laptop instead, behind the heavy lock, when Actions is unavailable). Fix
     every blocking finding
     (tests first), push, dispatch the new head's run with `--no-wait` and
     end, as at ready; each lap counts toward
     `SPECKIT_MAX_REPAIR_ITERATIONS` (10), and at the cap the task goes to
     Blocked and the PR stays unmerged. A head that differs from the last
     tested commit by documentation only (`scripts/docs-only.ts`, e.g. the
     `deferred.md` task URLs) carries that verdict instead of a new lap
     (`.claude/scripts/pr-test/carry.mjs`); the merge gate verifies the carry.
  7. Merge on `agent-review` success with every other check green
     (`gh pr merge <n> --merge`); a PR with a failing, pending or missing check
     is never merged. Then set the task to Done (`speckit-tracker-sync finish`, which closes its issue).
     The orchestrating session then fast-forwards the main checkout
     (`git -C <main> merge --ff-only origin/main`); when the watch reports it
     `behind`, `/speckit-watch`'s `ff-main` safe fix does it. The main
     checkout holds no edits to tracked files (`pre:edit:main-checkout`).
     What only exists after the merge (the merge sha, the finish, ready and
     comment lines) goes to the tracker and into one comment on the merged PR
     (`gh pr comment <n>`), never a commit of its own; whatever must reach a
     file rides on the next PR.
     A PR opened by Dependabot (its author on GitHub, not its title or branch)
     and holding only Dependabot's commits skips step 6: it merges on every
     other check green, `CI OK` included, with no `agent-review` status; a
     failing, pending or missing check still refuses it.

  Technical debt a review defers is only a large fix. A verified finding from
  review, harden, QA or the PR tester (code-reviewer, spec-reviewer,
  test-adversary, a mutation survivor, pr-tester) whose fix is small or medium
  is fixed in the same PR (route `patch`), even when the problem existed
  before the change or sits next to it. The size test: A fix is large when it
  needs its own design or decision, a data migration, a different area or
  epic, or work clearly bigger than the story itself. A different area is an
  Nx project or harness area the branch does not touch; the file or module
  the change touches is never one. Only a large fix is routed `defer`: a
  bullet in `specs/<feature>/deferred.md` naming the arm it meets, filed as a
  To do issue in the tracker (`speckit-tracker-sync debt`) before the merge; each
  bullet carries its issue's URL so it is never filed twice.

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
  `speckit-notion-sync`, §2b, which `speckit-tracker-sync` shares); the merge removes the stage labels.

  No step waits for the user: opening the draft, pushing, marking it ready,
  merging on green CI and the tracker writes are all standing instructions. The
  tracker writes cover the story's issue and the epic's (Implementing at its
  first story, Done and closed at its last).
- **Ready to work stays current, and a finished task says what happened.**
  Every `start` and `finish` ends with a ready refresh, which puts the
  `ready to work` label on the To do issues whose every dependency is now
  closed or Done (after the hold review) and takes it off the one that
  started. Every `finish` also
  comments on the task when there is something to record: deviations from
  the Build brief, decisions taken on the owner's behalf, deferred follow-ups,
  open questions. `/speckit-archive` will not close a feature until the
  refresh is logged after its finish, in `tracker-sync.md` or the merged
  PR's finish comment (`notion-ready.mjs check -`).
- **Plans:** one build-timeline database per epic under Delivery › Plans in
  Notion, and its build plan as a file in the specs repo's
  `docs/reference/build-plans/` (`speckit-notion-sync plan`).
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

## Agent replies

Every reply is re-read by its caller on each later turn, so it is short and
the same shape everywhere. Every subagent in `.claude/agents/` and every
dispatched task agent (a `task-runner` for a story, its tail or a
speckit-watch fix, a skill's `general-purpose` helper) opens its final reply with these four lines,
nothing before them:

```
STATUS: success | failure | blocked | partial — <one line: what happened>
PR: #<n> <draft|ready|merged> <sha7> | none
NEXT: <the one action the caller should take> | none
FILES: <paths written, comma-separated> | none
```

Then the agent's own body (a reviewer's `VERDICT:` line and table, which
`subagent-verdict.mjs` and the callers parse, stay as they are). The whole
reply is at most 25 lines, or the agent's lower cap: no prose, praise or
restated diff. Anything longer goes to a file named in `FILES`
(`specs/<feature>/auto-run.md`, the tester's `report.md`) and is not pasted.
Agents cannot include files, so each definition and dispatch template repeats
the block verbatim; `.claude/agents/agent-replies.spec.mjs` keeps them equal.

Read only what decides the next step; every check still runs:

- CI: the background wait prints only what did not pass —
  `node .claude/scripts/pr-test/ci-wait.mjs <n>` (`--run <id>` to wait for a
  QA run too), which also waits while a fresh head has no checks yet
  (empty output means green). A failing job: `gh run view <run-id> --log-failed | tail -n 80`.
- Jest, Playwright, Nx: run into a log file, then read the exit code, the
  summary and the failures — `<command> > <log> 2>&1; echo "exit $?"; tail -n 40 <log>`,
  and `grep -nE '✕|●|FAIL|Error' <log> | head -n 40` when it failed.

## Reviewing a change that has screens

- **Phones first.** Every review of a screen covers a 320 px phone, a 390 px
  phone, a tablet and a desktop, in light and dark, Romanian and English. The
  PR tester's sweep (`.claude/scripts/pr-test/sweep.mjs`) runs all four, in
  CI: the PR QA workflow (`.github/workflows/pr-qa.yml`) boots the PR head on
  a GitHub runner. A reviewer or agent checking by hand does the same, and a
  screen that scrolls sideways at 320 px is a finding.
- **The artifact's screenshots are the evidence.** The PR QA run uploads
  `report.md`, `report.json` and a screenshot per route, size, scheme and
  language as its `pr-qa-<n>` artifact, and the tester reads them before it
  posts. Walking the changed screens in the built-in browser pane (the
  `mcp__Claude_Browser__*` tools) is optional: do it when the owner wants to
  watch, serving the PR head under `scripts/heavy.sh` and stopping the server
  after.
- **QA runs in CI, not on the laptop.** A QA run holds no heavy slot, so ready
  PRs are not queued behind the 16 GB laptop; only a `--local` run (Actions
  unavailable) waits for a `scripts/heavy.sh` slot. After a merge, a PR
  waiting in QA merges `origin/main` and is tested again only if it now
  conflicts with `main` or shares changed files with what merged (never a
  rebase, which would need a forced push); its CI already runs on the merge
  result.
- **No images in the repo.** Screenshots are evidence for a chat, a review
  or a PR comment, never a commit: QA copies only `report.md` and
  `report.json` into `pr-review/`, and `specs/.gitignore` refuses images there. Real
  app assets, such as the web app's icons, are the only images git holds.

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
`docs/index.json` maps each old Notion id to its file. Its
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

## Cloud sessions

A story can run in a Claude Code cloud session (claude.ai/code), where
`CLAUDE_CODE_REMOTE=true`. Every cloud difference in the scripts is gated on
that variable, so the laptop behaves as before.

- **Environment.** Setup script: `bash scripts/cloud-setup.sh` (Node 24,
  `npm ci`, the Docker daemon, `docker compose pull postgres redis` unless
  both images are there; it is idempotent and unverified until the first
  real cloud run). Variables, by
  name only: `NOTION_TOKEN`, `JEV`, and from `.env.example` the ones the
  tests read (`DATABASE_URL`, `REDIS_URL`, `AUTH_TOKEN_SECRET`; CI's job env
  in `.github/workflows/ci.yml` lists the end-to-end set). Network level
  Trusted, or a custom list that allows `api.notion.com` and
  `api.typesafe.ai`.
- **Node and Playwright.** The image puts Node 22 first on PATH;
  `cloud-setup.sh` puts an installed Node 24 first instead (one marked line
  at the top of `~/.bashrc`, and in `CLAUDE_ENV_FILE` when set) and installs
  the chromium revision the installed `playwright-core` pins.
- **GitHub.** `GH_TOKEN` and `GITHUB_TOKEN` hold the proxy's placeholder
  `proxy-injected`; nothing overwrites them, and no gh login is needed.
  The proxy refuses `workflow_dispatch`, commit statuses and GraphQL (so
  every `gh pr …` fails); REST pushes, reviews, comments, labels, ready and
  merge go through. `lifecycle.mjs`, the `stop:pr-lifecycle` gate and
  `notion-sync.mjs` fall back to REST on their own
  (`.claude/scripts/lib/gh-rest.mjs`); by hand, run
  `node .claude/scripts/gh.mjs` in place of `gh` for `pr
  list|view|create|edit|ready|comment|checks` (`--watch` too) and `label
  create`.
- **QA and merge.** QA starts by itself: the PR QA workflow also runs on
  `pull_request` (ready, a push, reopened) for a non-draft PR of this
  repository, one run per PR (a newer one cancels the older), and sets
  `agent-review` on the head it tested with its own token: pending, then
  success only when the run passed with no blocking findings, else failure.
  `dispatch.mjs <n> --no-wait` dispatches nothing there and finds that run
  for the head over REST; `post.mjs` posts the review and writes no status.
  A blocking finding of the tester's own is fixed and pushed, which runs QA
  again. The merge goes over REST, `lifecycle.mjs merge --pr <n>`, which
  runs `gh api -X PUT repos/{owner}/{repo}/pulls/<n>/merge -f merge_method=merge`;
  the merge gate reads the PR over REST and judges that call as it judges
  `gh pr merge`.
- **Single-repo sessions only:** a multi-repo session loads no hooks, so no
  gate would run.
- **One story per cloud session.** Never arm `watch.mjs` there; the
  orchestrating session and `/speckit-watch` stay on the laptop.
- **A resumed session is a fresh VM** with none of the gitignored files.
  In a cloud session only, the hand-off note is also posted on the PR as a
  `<!-- speckit-handoff -->` comment, and the tail runs `lifecycle.mjs handoff --restore --pr <n>`
  before reading it.
- **Tools.** The Workflow and Artifact tools are unverified in the cloud:
  `/speckit-review` falls back to Agent-tool reviewers, and
  `/speckit-design-check` logs a mock it cannot open. The Notion tool lists
  in `.claude/agents/org-researcher.md`, `spec-reviewer.md` and
  `.claude/settings.json` name connector-id prefixes; a cloud session's
  connector prefix may differ and must be added to them.

## Folder structure

Two rules for `apps/*/src` and `libs/*/src` (Constitution IV), checked by
`node scripts/structure-check.ts` in CI's Checks job and in `.husky/pre-commit`:

- **Submodules get their own subfolder.** A module's own files sit at its
  root: `index.ts` and files named after the folder (`notifications.module.ts`).
  Any other group of files sharing a name (`bell.service.ts`,
  `bell.controller.ts`) is a submodule and moves to `notifications/bell/`.
  Files inside that subfolder are named after it (`bell/bell.service.ts`),
  not after the parent module.
- **A web component is a folder.** A `@Component` in `apps/web/src` lives at
  `<name>/<name>.ts`, with `templateUrl: './<name>.html'` and, when it has
  styles, `styleUrl: './<name>.css'`: no inline `template` or `styles`.
  Generate one with `npx nx g @nx/angular:component --path <area>/<name>/<name>`
  (`nx.json` already turns inline templates and styles off); delete an empty
  stylesheet together with its `styleUrl`.

Out of scope: `libs/ui-cockpit` (Spartan's copied helm components),
`libs/data-access` and `libs/domain/src/generated` (generated), `web-e2e`.
`scripts/structure-baseline.json` lists the violations older than the check;
it only shrinks (`config-protection.mjs`), an entry goes in the change that
fixes it, and on a PR the check refuses an entry the base branch lacks.

A Biome a11y override for an external template lists the files it covers and
why, never `apps/web/**/*.html`; template accessibility is still covered by
the axe checks in the QA sweep (`.claude/scripts/pr-test/sweep.mjs`) and
`web-e2e`.

## Product and stack

MotorFix: drivers in Romania find a garage or mechanic for their car. The
product and architecture documentation lives in the specs repo's
`.motor-fix-specs/docs/` (start at its `llms.txt`; the backlog stays in the
tracker) — `docs/reference/stack.md` and `docs/explanation/decisions/` are the
source for anything the constitution does not fix.

- Given: Angular (standalone, signals) + Spartan UI (brain primitives, helm
  components copied into `libs/ui-cockpit`, Angular CDK) with the Cockpit
  theme; NestJS, PostgreSQL, Redis; TypeScript everywhere. Front-end
  dependencies stay free and open source: no PrimeNG (licence key since v22).
- Repo: one Nx monorepo — apps `web` (Angular SSR), `api`, `worker` (NestJS),
  `mcp`, `web-e2e` (Playwright); libs `contracts` (DTOs, env), `domain`
  (NestJS modules, Prisma schema per module), `data-access` (Angular client
  generated from `apps/api/openapi.json`: `npx nx run data-access:generate`,
  never edited by hand). A lib is created by the story that first needs it.
- Heavy commands (npm ci/install, nx build/test/typecheck/e2e, Jest over more
  than a few files, docker compose, Playwright, a boot-test-teardown run) go
  through `scripts/heavy.sh` (4 slots machine-wide, 2 in a cloud session); a dev server
  (`nx serve`) never holds a slot for as long as it lives, and mutation tests
  never run locally, only in CI. QA (`/speckit-pr-test`) runs on GitHub
  Actions and holds no slot; its `--local` fallback holds one.
- Parallel work is watched: `node .claude/scripts/watch.mjs` lists every
  worktree with its feature, phase, holder (a live agent or not), last
  activity, PR and the one fix a stale item needs. `/speckit-watch` applies the
  safe fixes and dispatches an agent per stale item (QA re-runs up to
  `SPECKIT_QA_CAP`, by default Actions' 20 concurrent jobs; at most 2 other
  agents at once). The orchestrating session (the main
  checkout, the one that dispatches tasks) keeps it armed as soon as two or
  more tasks or worktrees are active: one background
  `node .claude/scripts/watch.mjs --wait` (never a second), which runs the
  model-free `--gate` every 15 minutes and wakes the session only when a pass
  has something to do, or after 110 idle minutes to be re-armed; and one pass
  right away. A worktree session never arms it. The SessionStart reminder
  `session:start:watch-reminder` catches a resumed session whose wait was lost.
- A worktree goes once its PR merges or closes, or after 7 idle days with no
  PR: `.claude/scripts/worktree-remove.mjs` backs up its specs and changes
  under `.work/worktree-backfill/`, then removes it and its branch
  (`lifecycle.mjs merge`, the tail, `/speckit-watch`'s `remove` fix); it
  refuses the main checkout, an open PR, a session still holding it and
  unpushed commits.
- Fable usage limit hit: `node .claude/scripts/fable.mjs off` remaps `fable`
  to Opus for sessions started afterwards (`on` restores, `status` tells).
- Every API route needs a session: `ActorGuard` runs app-wide (`APP_GUARD`
  in `AuthModule`). A route open to visitors carries `@Public()` and joins
  the list in `apps/api/src/public-routes.integration.spec.ts`. The web
  interceptor answers a `sign_in_required` 401 with the sign-in dialog over
  the screen, then sends the call again once.
- Lint and format: Biome only, root `biome.jsonc` (no eslint, no prettier).
  Tests: Jest from the root config, Playwright for end-to-end. NestJS 12 is
  ESM-only, so the Nest projects' `test` targets run Jest with
  `--experimental-vm-modules`.
- Root scripts: `typecheck`, `lint`, `test`, `build`, `e2e` run across every
  project; the harness specs keep `npm run test:harness`; `test:mutation`
  and `test:mutation:affected` run Stryker one project at a time, against the
  floor in each project's `stryker.config.json`, which only rises. A spec that
  needs PostgreSQL or Redis is named `*.integration.spec.ts`;
  `npm run test:unit` leaves those out and `npm run test:integration` runs
  only them (`JEST_SUITE` in `jest.preset.cjs`; unset runs all). Integration
  tests need `docker compose up -d` (or local servers), with `DATABASE_URL`
  and `REDIS_URL` from `.env.example`. The pre-commit hook needs neither: when
  an affected project has integration specs it starts and migrates the
  worktree's own PostgreSQL and Redis (`scripts/test-services.ts`, compose
  project `mf-test-<worktree>-<hash>`, left running between commits; Docker
  required), and it refuses a commit with `JEST_SUITE` set. Removing a
  worktree takes its stack down with its volumes, and each `/speckit-watch`
  pass runs `test-services.ts sweep`, which stops those of merged, closed or
  deleted worktrees; neither fails on Docker. By hand,
  `node scripts/test-services.ts down [<worktree>] [--volumes]` stops one
  stack (the current checkout's by default).
- PR CI: `.github/workflows/ci.yml`, six jobs, so a PR holds at most eight
  of the free plan's 20 concurrent runners: Checks (one runner and one
  install: Biome, Dependency audit, Typecheck, Build, Contract check, Harness,
  and Compose stack, where `docker-compose.yml` boots and creates the bucket;
  each step runs even after an earlier one failed), Unit and integration tests
  (PostgreSQL+PostGIS and Redis services), E2E tests (Playwright `web-e2e`,
  four workers, servers started in the job; a test that passes only on a
  retry fails), Docker build (`web`, `node-app`, reading the layer cache that
  `release.yml` writes on `main`, and `keycloak`), then `CI OK`, which
  fails when any of them did. A PR that changes documentation only
  (`scripts/docs-only.ts`: Markdown outside `.claude/`, `.specify/` and
  `.github/`, or `docs/`) runs only the Changes and `CI OK` jobs; the
  others are skipped. The PR title (Conventional Commit) is checked by its
  own workflow, `.github/workflows/pr-title.yml`, which also runs when the
  PR is edited, so a corrected title re-checks without re-running CI. PRs
  run `nx affected`; `release.yml` calls the
  same workflow, which then runs every project. Mutation testing never runs
  in PR CI: `.github/workflows/mutation.yml` runs it nightly on `main` and on
  `workflow_dispatch`.
- Release: `.github/workflows/release.yml` builds one image per app (root
  `Dockerfile`), deploys staging through `scripts/railway-deploy.ts`, runs the
  end-to-end suite there, and promotes the same digests to production with
  no manual approval: a merge reaches production only when CI and staging
  both passed. Release checks run one at a time (`release-checks`); a waiting
  one is replaced by the newest merge, which carries it.
