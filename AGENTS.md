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

## Notion is the tracker, and design comes first

These hold for every piece of work in this repo: a story, a task, a bug, an
epic or a plan, whether run through spec-kit or by hand.

- **Check the design before starting.** Before any code, read the story's
  boards in the clickable mock (the `Design` and `Design boards` properties
  in Notion) and the Build brief's Screens section, and write
  `specs/<feature>/design.md`. Skill: `speckit-design-check`.
- **Every task follows the same lifecycle, in this order.** This is a hard
  rule, Constitution VII, enforced by the `stop:pr-lifecycle` and
  `pre:bash:merge-gate` gates:
  1. Take the task and set it to Planning in Notion (`speckit-notion-sync start`);
     it moves to Implementing when `/speckit-implement` begins
     (`speckit-notion-sync implement`, the `before_implement` hook).
  2. Open a draft PR for its branch at the start (`speckit-git-commit`; before
     planning has a commit, an empty `chore(<scope>): ST-<n> start …` one),
     its body made from `.github/pull_request_template.md`:
     `gh pr create --draft --label planning --body-file <body>`, never
     `--body` or `--fill`.
     Then write the PR's link onto the task's `PR` property in Notion
     (`speckit-notion-sync pr <n>`): every task links its own PR.
  3. Do the work, pushing every commit to that branch: never forced, never `main`.
  4. When it is done (tests, typecheck and lint green, review with no
     CRITICAL/HIGH left), fill in every section of the template
     (`node scripts/pr-body-check.ts --body-file <body> --title "<title>"`
     passes, then `gh pr edit <n> --body-file <body>`), mark the PR ready for
     review (`gh pr ready`) and set the task to QA
     (`speckit-notion-sync qa`, which also sets the PR's one stage label
     to `QA`). There is no In review stage: ready is QA.
  5. Get CI green: merge `origin/main` into the branch if it is behind and
     push, then wait for the checks (`gh pr checks <n> --watch`) in the
     background (`run_in_background`), never in a foreground `sleep` loop; a
     failing check is fixed on the branch and waited for again.
  6. QA, started as soon as the PR is ready, beside step 5 rather than after
     it: run the PR tester (`/speckit-pr-test <n>`, the `pr-tester` subagent);
     the task and the PR's stage label stay QA. It leaves the unit and
     end-to-end suites to CI, which runs them on the merge result. It
     dispatches the PR QA workflow (`.github/workflows/pr-qa.yml`), where a
     GitHub runner boots the PR head, tests it in a browser and against the
     API and uploads the report and screenshots; then, locally, it reviews the
     diff, posts a review, fills the template's "Agent review" section and sets
     the `agent-review` status on the head commit (`--local` boots on the
     laptop instead, behind the heavy lock, when Actions is unavailable). Fix
     every blocking finding
     (tests first), push, and run it again; each lap counts toward
     `SPECKIT_MAX_REPAIR_ITERATIONS` (5), and at the cap the task goes to
     Blocked and the PR stays unmerged.
  7. Merge on `agent-review` success with every other check green
     (`gh pr merge <n> --merge`); a PR with a failing, pending or missing check
     is never merged. Then set the task to Done (`speckit-notion-sync finish`).
     A PR opened by Dependabot (its author on GitHub, not its title or branch)
     and holding only Dependabot's commits skips step 6: it merges on every
     other check green, `CI OK` included, with no `agent-review` status; a
     failing, pending or missing check still refuses it.

  Technical debt a review defers (`specs/<feature>/deferred.md`) is filed as
  a To do task in Notion (`speckit-notion-sync debt`) before the merge; each
  bullet carries its task's URL so it is never filed twice.

  Whenever the work cannot go on without something outside it (a Hard Stop,
  red CI the agent cannot fix, the repair cap, an unresolved Blocked by), set
  the task to Blocked with the reason as a Notion comment and a PR comment
  (`speckit-notion-sync blocked <reason>`); `speckit-notion-sync unblock`
  returns it to where it was. Each step also moves the PR's label —
  `planning` until `/speckit-implement`, then `in development`, then `QA`
  from the moment it is ready, plus `blocked` — so GitHub shows the
  same stage as Notion. Next to its one stage label a PR carries its type
  (`feature`, `bug`, `tech debt`, …, from the title), `breaking`, its scope,
  its epic, `ui` and `dependencies` where they apply (table in
  `speckit-notion-sync`, §2b); the merge removes the stage labels.

  No step waits for the user: opening the draft, pushing, marking it ready,
  merging on green CI and the Notion writes are all standing instructions. The
  Notion writes cover the story, its row in the epic's build timeline under
  Delivery › Plans, and the epic itself (In progress at its first story, Done
  at its last).
- **Ready to work stays current, and a finished task says what happened.**
  Every `start` and `finish` ends with `notion-ready <epic>`, which ticks the
  Ready to work checkbox on the tasks that just became unblocked and unticks
  the one that started; readiness never goes in Labels. Every `finish` also
  comments on the task when there is something to record: deviations from
  the Build brief, decisions taken on the owner's behalf, deferred follow-ups,
  open questions. `/speckit-archive` will not close a feature until the
  refresh is logged after its finish.
- **Plans live under Delivery › Plans in Notion:** one execution-plan page and
  one build-timeline database per epic (`speckit-notion-sync plan`).
- **The spec-kit hooks do this automatically** (`.specify/extensions.yml`:
  `after_specify`, `before_plan`, `before_implement`), and so do
  `/speckit-review` and `/speckit-archive`. Outside spec-kit, run the skills
  yourself. After every merge to `main`, run `speckit-notion-sync finish`.
- **Every PR uses the template**, `.github/pull_request_template.md`, whoever
  opens it. The `PR template` workflow (`scripts/pr-body-check.ts`, whose
  header lists the rules) checks a draft's headings and a ready PR's every
  section, and names what is missing. Write `N/A` and the reason where a
  section does not apply. Agent review is filled in by the automated reviewer.
- A Notion or mock failure never blocks the build. It is logged in
  `specs/<feature>/notion-sync.md` or `design.md` and retried on the next run.

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
  `report.json` into `pr-review/`, and `.gitignore` refuses images there. Real
  app assets, such as the web app's icons, are the only images git holds.

## Product and stack

MotorFix: drivers in Romania find a garage or mechanic for their car. The
product, architecture and backlog live in the Notion space **MotorFix —
Product documentation** — Architecture > Technology stack and Architecture
decisions are the source for anything the constitution does not fix.

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
  through `scripts/heavy.sh` (4 slots machine-wide); a dev server
  (`nx serve`) never holds a slot for as long as it lives, and mutation tests
  never run locally, only in CI. QA (`/speckit-pr-test`) runs on GitHub
  Actions and holds no slot; its `--local` fallback holds one.
- Parallel work is watched: `node .claude/scripts/watch.mjs` lists every
  worktree with its feature, phase, holder (a live agent or not), last
  activity, PR and the one fix a stale item needs. `/speckit-watch` applies the
  safe fixes and dispatches an agent per stale item (QA re-runs up to
  `SPECKIT_QA_CAP`, by default Actions' 20 concurrent jobs; at most 2 other
  agents at once). The orchestrating session (the main
  checkout, the one that dispatches tasks) schedules it as soon as two or more
  tasks or worktrees are active: `CronList` first so it never doubles up, then
  `/speckit-watch` every 15 minutes off the round minutes
  (`4,19,34,49 * * * *`), and one pass right away. A worktree session never
  schedules it. The SessionStart reminder `session:start:watch-reminder`
  catches a resumed session whose schedule was lost.
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
  required), and it refuses a commit with `JEST_SUITE` set.
- PR CI: `.github/workflows/ci.yml`, one job per check, in parallel:
  Biome, Typecheck, Unit tests, Integration
  tests (PostgreSQL+PostGIS and Redis services), E2E tests (Playwright
  `web-e2e`, servers started in the job), Build, Harness, Contract check,
  Dependency audit, Docker build (`web`, `node-app`), Compose stack
  (`docker-compose.yml` boots and creates the bucket), then `CI OK`, which
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
  both passed.
