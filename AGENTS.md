# AGENTS.md

Guidance for AI agents (and humans) working in motor-fix. The spec-kit
workflow and its gates are in [CLAUDE.local.md](./CLAUDE.local.md). Each rule
here names its gate and the skill that holds the how-to; read that skill when
you run the step.

## Identity — personal repo, not work

Every commit and push here is **george-hutanu <hutanugeorge40@gmail.com>** on
GitHub account **george-hutanu**. Never the work identity (the work e-mail and
work GitHub account), which is this machine's global default and must stay
that way for `~/code`.

- `sh .husky/identity.sh apply` writes the repo-local author and pins
  credentials to george-hutanu's gh token (`npm install` runs it via
  `prepare`); `check` reports drift. `.husky/pre-commit` refuses any commit
  not authored as george-hutanu.
- `gh` follows gh's active account, which stays the work one. Agent sessions get
  `GH_TOKEN` for george-hutanu from the SessionStart hook; in your own
  terminal, prefix: `GH_TOKEN=$(gh auth token -u george-hutanu) gh …`.
- Never `gh auth switch` to george-hutanu, and never edit `~/.gitconfig` for
  this repo — both would change every work repo under `~/code` too.
- In a cloud session (`CLAUDE_CODE_REMOTE=true`) a proxy carries GitHub's
  credentials: the hook exports nothing, `apply` sets the author only, and
  `check` skips credential pinning.

## The tracker is GitHub, and design comes first

The rules below hold for every story, task, bug, epic or plan, through
spec-kit or by hand. The how-to of each step is in
`.claude/skills/speckit-auto/lifecycle.md`, `hand-off.md` and `tail.md`.

The tracker is GitHub: each story, task and epic is an issue in the private
`george-hutanu/motor-fix-specs`, its ST or EP id first in the title, with its
Status, dates and PR in Project "MotorFix" (#11); `speckit-tracker-sync` writes
them, logging to `specs/<feature>/tracker-sync.md`.

- **Check the design before starting:** the story's mock boards and the Build
  brief's Screens, into `specs/<feature>/design.md` (`speckit-design-check`).
- **Every task follows the same lifecycle, in this order** (Constitution VII;
  gates `stop:pr-lifecycle` and `pre:bash:merge-gate`):
  1. Take the task: Planning (`speckit-tracker-sync start`), then
     Implementing when `/speckit-implement` begins.
  2. Open a draft PR for its branch at once, its body from
     `.github/pull_request_template.md` (`--body-file`, never `--body` or
     `--fill`), and link it on the issue (`speckit-tracker-sync pr <n>`).
  3. Do the work, pushing every commit to that branch: never forced, never
     `main`, and only once the CI-only checks and the affected typecheck and
     unit tests pass locally (`lifecycle.mjs`).
  4. When done (green, no CRITICAL/HIGH review finding left), fill every
     section of the template, mark the PR ready and set QA
     (`lifecycle.mjs ready`); there is no In review stage. The story's agent
     then dispatches the PR QA run with `--no-wait`, writes
     `specs/<feature>/handoff.md` and returns `NEXT: tail #<n> after QA run
     <id>`. The session dispatches a fresh **tail agent** at once, which
     waits for the QA run and CI itself (`ci-wait.mjs`, in the background);
     the session waits for nothing and relays nothing: one task *being
     built* per session, plus any number waiting on QA and CI. The story's
     agent, the tail and every
     `/speckit-watch` fix run as `task-runner` (`.claude/agents/`), never
     `general-purpose`.
  5. Get CI green: merge `origin/main` only when
     `merge-main.mjs --needed` finds an overlap, never a rebase; checks
     are waited for in the background, never in a foreground `sleep`.
  6. QA, beside step 5: the PR tester (`/speckit-pr-test <n>`) reviews the
     finished run. A blocker or high finding fails the lap: fix every
     finding tests first, push, dispatch the new head's run and end; each
     such lap counts toward `SPECKIT_MAX_REPAIR_ITERATIONS` (10), and at the
     cap the task is Blocked. A lap with neither ends the testing: fix its
     medium and low findings tests first, push, carry its verdict
     (`pr-test/carry.mjs`) and merge on green CI, the finish comment listing
     them under "Fixed after QA"; no lap is counted. A merge of
     `origin/main` that changes none of the PR's files carries the verdict
     too (`merge of main`).
  7. Merge on `agent-review` success with every other check green, at once;
     a failing, pending or missing check is never merged. Then Done
     (`speckit-tracker-sync finish`), and the orchestrating session
     fast-forwards the main checkout (or `/speckit-watch`'s `ff-main`).
     Dependabot's own PRs skip step 6.

  Every verified review, QA or harden finding is fixed in the current task's
  PR before ready or merge; one needing an owner decision becomes a
  needs-confirmation question on the task, which goes to Blocked. That holds
  for a pre-existing or adjacent problem too. There are no
  tech-debt tickets. Whatever stops the work (a Hard Stop, red CI the agent
  cannot fix, the repair cap) sets the task to Blocked with the reason
  (`speckit-tracker-sync blocked <reason>`). The PR's one stage label follows
  the tracker (`planning`, `in development`, `QA`, plus `blocked`).

  No step waits for the user: the draft, pushes, ready, the merge on green CI
  and the tracker writes are standing instructions.
- **A finished task says what happened:** its `finish`
  comments on the task when there is something to record: deviations,
  decisions taken for the owner, open questions.
- **Plans:** each epic's build plan is a file in the specs repo's
  `docs/reference/build-plans/` (`speckit-tracker-sync plan`).
- **Observability ships with the change:** a new service, resource, queue,
  outside call, endpoint or product action adds its metrics, logs, traces,
  panel and alert in the same PR and in `infra/observability/inventory.json`
  (`scripts/observability-inventory.ts`).
- **Every PR uses the template**, `.github/pull_request_template.md`, checked
  by `scripts/pr-body-check.ts`; `N/A` with the reason where a section does
  not apply.
- A tracker or mock failure never blocks the build: it is logged and retried.

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
  `node .claude/scripts/pr-test/ci-wait.mjs <n>` (`--run <id>` waits for the
  QA run only), which also waits while a fresh head has no checks yet
  (empty output means green). It reads over REST, as every PR and check
  read does on the laptop too (`.claude/scripts/lib/gh-rest.mjs`), polls at
  most once a minute and returns at once for a run already finished; the
  GraphQL quota is left to the Project writes, which back off on a rate
  limit. A failing job: `gh run view <run-id> --log-failed | tail -n 80`.
- Jest, Playwright, Nx: run into a log file, then read the exit code, the
  summary and the failures — `<command> > <log> 2>&1; echo "exit $?"; tail -n 40 <log>`,
  and `grep -nE '✕|●|FAIL|Error' <log> | head -n 40` when it failed.

## Reviewing a change that has screens

Phones first: 320 px, 390 px, a tablet and a desktop, light and dark,
Romanian and English, and a screen that scrolls sideways at 320 px is a
finding. QA runs in CI and its artifact's screenshots are the evidence; no
images in the repo. How-to: `.claude/skills/speckit-pr-test/SKILL.md`.
A route is `path[?query][@role][:status]` (`/:lang` first only; `@role` under `/app/`).
A flow pushes each finding into `findings` as found (pushed or returned, never both),
waits on a visible element, `waitForText` or the stream's open state, never `networkidle`,
and is proven with `precheck.mjs --check` before dispatch.

## Specs live in their own repo

motor-fix is public and does not track the specs. Every checkout holds its own
clone of the private `george-hutanu/motor-fix-specs` at `.motor-fix-specs/`
(branch `trunk`, never a submodule), `specs/` links to its feature folders and
its `docs/` holds the product documentation (start at its `llms.txt`). Commit
there through `specs-repo.mjs`, never `git add specs/`; the how-to is in
`.claude/skills/speckit-auto/lifecycle.md`.

## Cloud sessions

A story can run in a Claude Code cloud session (`CLAUDE_CODE_REMOTE=true`);
every cloud difference in the scripts is gated on that variable. One story per
cloud session, single-repo sessions only, and never `watch.mjs` there. Read
`.claude/skills/speckit-auto/cloud.md` at the start of such a run.

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
  theme; NestJS, PostgreSQL, Valkey 9 (Redis protocol); TypeScript everywhere. Front-end
  dependencies stay free and open source: no PrimeNG (licence key since v22).
- Repo: one Nx monorepo — apps `web` (Angular SSR), `api`, `worker` (NestJS),
  `mcp`, `web-e2e` (Playwright); libs `contracts` (DTOs, env), `domain`
  (NestJS modules, Prisma schema per module), `data-access` (Angular client
  generated from `apps/api/openapi.json`: `npx nx run data-access:generate`,
  never edited by hand). A lib is created by the story that first needs it.
- Heavy commands (npm ci/install, nx build/test/typecheck/e2e, Jest over more
  than a few files, docker compose, Playwright) go through `scripts/heavy.sh`
  (4 slots machine-wide, 2 in a cloud session); a dev server never holds a
  slot, and mutation tests never run locally.
  `lifecycle.mjs check`'s Jest: `JEST_MAX_WORKERS=1`, `JEST_IDLE_MEMORY=1GB`, 3072 MB heap; env wins.
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
  With no session open, `sh scripts/watch-schedule.sh install --gate-only`
  loads a launchd agent that runs the gate every 15 minutes and logs its plan
  lines; after a week with none a person would refuse, `install --dispatch`
  also runs `watch.mjs --dispatch`, which starts each plan entry as a
  detached `task-runner`. Both
  sides share the claim: `watch.mjs claim` refuses a worktree whose claim is
  still live, so the schedule and a session's wait never dispatch it twice.
- Fable usage limit hit: `node .claude/scripts/fable.mjs off` remaps `fable`
  to Opus for sessions started afterwards (`on` restores, `status` tells).
- Every API route needs a session: `ActorGuard` runs app-wide (`APP_GUARD`
  in `AuthModule`). A route open to visitors carries `@Public()` and joins
  the list in `apps/api/src/public-routes.integration.spec.ts`. The web
  interceptor answers a `sign_in_required` 401 with the sign-in dialog over
  the screen, then sends the call again once.
- Lint and format: Biome only, root `biome.jsonc` (no eslint, no prettier).
  Tests: Jest from the root config, Playwright for end-to-end; a spec that
  needs PostgreSQL or Redis is named `*.integration.spec.ts`. Mutation is never
  part of a task's lifecycle.
- CI, the test suites, mutation and release are described in
  `.claude/skills/speckit-auto/lifecycle.md` ("CI, tests and release") and
  in the headers of `.github/workflows/ci.yml`, `release.yml` and
  `mutation.yml`.
