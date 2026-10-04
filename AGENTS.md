# AGENTS.md

Guidance for AI agents (and humans) working in motor-fix. The spec-kit
workflow and its gates are in [CLAUDE.local.md](./CLAUDE.local.md).

## Identity — personal repo, not QLOG

Every commit and push here is **george-hutanu <hutanugeorge40@gmail.com>** on
GitHub account **george-hutanu**. Never the QLOG identity (`georgeh@qlog.co`,
`george-hutanu-qlog`), which is this machine's global default and must stay
that way for `~/code`.

- `sh .husky/identity.sh apply` writes the repo-local git config: author, and
  credentials pinned to george-hutanu's gh token. `npm install` runs it via
  `prepare`, so a fresh clone is covered.
- `.husky/pre-commit` refuses any commit not authored as george-hutanu.
- `gh` follows gh's active account, which stays QLOG. Agent sessions get
  `GH_TOKEN` for george-hutanu from the SessionStart hook; in your own
  terminal, prefix: `GH_TOKEN=$(gh auth token -u george-hutanu) gh …`.
- Never `gh auth switch` to george-hutanu, and never edit `~/.gitconfig` for
  this repo — both would change every QLOG repo under `~/code` too.

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
  1. Take the task and set it to In progress in Notion (`speckit-notion-sync start`).
  2. Open a draft PR for its branch (`speckit-git-commit`, at the first commit),
     its body made from `.github/pull_request_template.md`:
     `gh pr create --draft --body-file <body>`, never `--body` or `--fill`.
  3. Do the work, pushing every commit to that branch: never forced, never `main`.
  4. When it is done (tests, typecheck and lint green, review with no
     CRITICAL/HIGH left), fill in every section of the template
     (`node scripts/pr-body-check.ts --body-file <body> --title "<title>"`
     passes, then `gh pr edit <n> --body-file <body>`), mark the PR ready for
     review (`gh pr ready`) and set the task to In review in Notion
     (`speckit-notion-sync review`).
  5. Get CI green: merge `origin/main` into the branch if it is behind and
     push, wait for the checks (`gh pr checks <n> --watch`); a failing check is
     fixed on the branch and waited for again.
  6. QA: run the PR tester (`/speckit-pr-test <n>`, the `pr-tester` subagent)
     and set the task to QA (`speckit-notion-sync qa`). It boots the PR head in
     its own worktree, tests it in a browser and against the API, reviews the
     diff, posts a review, fills the template's "Agent review" section and sets
     the `agent-review` status on the head commit. Fix every blocking finding
     (tests first), push, and run it again; each lap counts toward
     `SPECKIT_MAX_REPAIR_ITERATIONS` (5), and at the cap the task goes to
     Blocked and the PR stays unmerged.
  7. Merge on `agent-review` success with every other check green
     (`gh pr merge <n> --merge`); a PR with a failing, pending or missing check
     is never merged. Then set the task to Done (`speckit-notion-sync finish`).

  Technical debt a review defers (`specs/<feature>/deferred.md`) is filed as
  a To do task in Notion (`speckit-notion-sync debt`) before the merge; each
  bullet carries its task's URL so it is never filed twice.

  Whenever the work cannot go on without something outside it (a Hard Stop,
  red CI the agent cannot fix, the repair cap, an unresolved Blocked by), set
  the task to Blocked with the reason as a Notion comment and a PR comment
  (`speckit-notion-sync blocked <reason>`); `speckit-notion-sync unblock`
  returns it to where it was.

  No step waits for the user: opening the draft, pushing, marking it ready,
  merging on green CI and the Notion writes are all standing instructions. The
  Notion writes cover the story, its row in the epic's build timeline under
  Delivery › Plans, and the epic itself (In progress at its first story, Done
  at its last).
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
  through `scripts/heavy.sh` (3 slots machine-wide); a dev server
  (`nx serve`) never holds a slot for as long as it lives, and mutation tests
  never run locally, only in CI.
- Lint and format: Biome only, root `biome.json` (no eslint, no prettier).
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
  and `REDIS_URL` from `.env.example`.
- PR CI: `.github/workflows/ci.yml`, one job per check, in parallel: PR
  title (Conventional Commit), Biome, Typecheck, Unit tests, Integration
  tests (PostgreSQL+PostGIS and Redis services), E2E tests (Playwright
  `web-e2e`, servers started in the job), Build, Harness, Contract check,
  Dependency audit, Docker build (`web`, `node-app`), then `CI OK`, which
  fails when any of them did. A PR that changes documentation only
  (`scripts/docs-only.ts`: Markdown outside `.claude/`, `.specify/` and
  `.github/`, or `docs/`) runs only the PR title, Changes and `CI OK` jobs;
  the others are skipped. PRs run `nx affected`; `release.yml` calls the
  same workflow, which then runs every project. Mutation testing never runs
  in PR CI: `.github/workflows/mutation.yml` runs it nightly on `main` and on
  `workflow_dispatch`.
- Release: `.github/workflows/release.yml` builds one image per app (root
  `Dockerfile`), deploys staging through `scripts/railway-deploy.ts`, runs the
  end-to-end suite there, and promotes the same digests to production after
  approval.
