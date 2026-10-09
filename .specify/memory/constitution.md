<!--
Sync Impact Report (v1.11.1)
- Version change: 1.11.0 → 1.11.1 (PATCH: the documentation source moves —
  Additional Constraints names the Architecture pages as exported to the
  specs repo's `docs/` instead of the Notion space; no rule added, removed or
  redefined)
- Source: ST-1018 (move the documentation from Notion to the specs repo).
- Templates:
  - ✅ .specify/memory/constitution-card.md — the version line
  - ✅ CLAUDE.local.md — the version line and the `/speckit-context` entry
  - ✅ AGENTS.md — "Product and stack", "Specs live in their own repo", Plans
  - ✅ .claude/skills/speckit-context, speckit-design-check,
    speckit-notion-sync (plan); .claude/agents/org-researcher.md,
    spec-reviewer.md — read `docs/`, the Notion space only as a tagged
    fallback
  - ✅ .claude/scripts/docs-source.spec.mjs — keeps them agreeing

Previous report (v1.11.0)
- Version change: 1.10.0 → 1.11.0 (MINOR: Principle II gains one allowed
  form of requirement id in source — a whole-line `// @traces
  <feature>-FR-<n>` comment in a test file, read by `trace-matrix.mjs`. The
  prohibition stays for every other place and every other identifier;
  nothing removed)
- Source: ST-960 (supersedes the 1.9.0 figure in ST-952 and ST-925 comments).
- Templates:
  - ✅ .specify/memory/constitution-card.md — v1.11.0, II line
  - ✅ CLAUDE.local.md — the version line
  - ✅ .claude/scripts/lib/traces.mjs — the one parser; trace-matrix.mjs and
    config-protection.mjs read ids through it
  - ✅ .claude/skills/speckit-tests, speckit-implement, speckit-review,
    speckit-harden, speckit-bug-fix, speckit-auto (phases-build, report,
    commit-protocol) — state the exception
  - ✅ .claude/agents/code-reviewer.md, spec-reviewer.md, test-adversary.md
  - ✅ .claude/hooks/red-first-gate.mjs, pre-commit-check.sh — comment and
    message
  - ✅ .claude/scripts/traces-rule.spec.mjs — keeps the files agreeing
- Follow-ups: ST-817 (eval-case id prefixes) and ST-733 (matrix test roots)
  stay their own tasks.

Previous report (v1.10.0)
- Version change: 1.9.0 → 1.10.0 (MINOR: the Agent Execution Rule "Scope is
  the deliverable" gains the review clause — a verified review, harden, QA or
  PR-tester finding with a small or medium fix is fixed in the same PR,
  pre-existing or adjacent included; only a large fix, by the size test, is
  deferred. Implementation scope is unchanged; nothing removed)
- Source: ST-966, the owner's rule of 2026-10-08 (fewer tech-debt tickets).
  1.9.0 belongs to ST-893; ST-960 takes the next free version.
- Templates:
  - ✅ .specify/templates/deferred-template.md — large fixes only, size test
  - ✅ .claude/agents/code-reviewer.md, spec-reviewer.md — routing table
  - ✅ .claude/skills/speckit-review, speckit-harden, speckit-auto,
    speckit-pr-test, speckit-notion-sync — the route by fix size
  - ✅ AGENTS.md — "Technical debt a review defers"; CLAUDE.local.md — the
    defer bullet and the version line
  - ✅ .specify/memory/constitution-card.md — v1.10.0
  - ✅ .claude/scripts/fix-in-pr-rule.spec.mjs — keeps the files agreeing

Previous report (v1.9.0)
- Version change: 1.8.3 → 1.9.0 (MINOR: Principle IV gains the folder rules —
  a module's submodules get their own subfolder, and a web component is a
  `<name>/` folder holding `<name>.ts`, `<name>.html` and `<name>.css` — and
  Enforcement gains `scripts/structure-check.ts` with its shrink-only
  baseline. Nothing removed or redefined)
- Source: ST-893, the owner's folder rules.
- Templates:
  - ✅ .specify/templates/plan-template.md — Project Structure note
  - ✅ .specify/templates/tasks-template.md — Path Conventions line
  - ✅ .claude/skills/speckit-implement/SKILL.md — step 3 names the layout
  - ✅ AGENTS.md — "Folder structure" section
  - ✅ .specify/memory/constitution-card.md — IV line, v1.9.0

Previous report (v1.8.3)
- Version change: 1.8.2 → 1.8.3 (PATCH: Additional Constraints gains the
  observability rule — a change that adds a service, resource, queue, outside
  call, endpoint or product action ships its metrics, logs, traces, dashboard
  panel and alert, or says why not, in the same PR — and Enforcement gains the
  check that keeps `infra/observability/inventory.json` in step with the code.
  No principle changed)
- Source: ST-881 (Observability epic ST-875..881), owner decision for the
  Grafana Cloud free tier.
- Templates:
  - ✅ .github/pull_request_template.md — `## Observability` section
  - ✅ .specify/templates/plan-template.md — `## Observability` section
  - ✅ AGENTS.md — rule line under "Notion is the tracker"
  - ✅ .specify/memory/constitution-card.md names v1.8.3
  - ⚠ CLAUDE.local.md (untracked, owner's copy) still names v1.8.2
-->
<!--
Sync Impact Report (v1.8.2)
- Version change: 1.8.1 → 1.8.2 (PATCH: IV names the root Biome config by
  its real name, `biome.jsonc`, since PR #99 (ST-609) renamed it so a disabled
  rule can carry its reason as a comment. No rule changed)
- Source: ST-613, deferred from the PR tester's review of PR #99.
- Templates:
  - ✅ .specify/contexts/implement.md, .claude/agents/spec-reviewer.md,
    .claude/hooks/post-edit-check.sh (comment) name `biome.jsonc`
  - ✅ .specify/memory/constitution-card.md and CLAUDE.local.md name v1.8.2
-->
<!--
Sync Impact Report (v1.8.1)
- Version change: 1.8.0 → 1.8.1 (PATCH: VII step 5 clarified — the PR tester
  boots the change on a GitHub Actions runner (the PR QA workflow,
  `.github/workflows/pr-qa.yml`) instead of in a worktree on the owner's
  laptop, and posts its verdict from the run's report; `--local` keeps the
  laptop run, behind the heavy lock, for when Actions is unavailable. No step,
  gate or check removed: the QA step, the agent-review merge gate and the
  repair cap are unchanged; the unit and end-to-end suites stay CI's)
- Source: owner decision 2026-10-04: the repo is public, so Actions is free;
  move the PR tester's heavy part off the 16 GB laptop.
- Templates:
  - ✅ AGENTS.md — lifecycle step 6, "Reviewing a change that has screens"
    (the sweep runs in CI, the artifact's screenshots are the evidence, the
    built-in browser walk is optional, no laptop limit on QA), heavy commands
    and the watcher
  - ✅ .claude/agents/pr-tester.md, speckit-pr-test (`--local`), speckit-auto
    (hand-off step 5), speckit-watch, .claude/scripts/watch.mjs,
    scripts/heavy.sh (comment)
  - ✅ CLAUDE.local.md and .claude/skills/speckit-auto name v1.8.1

Sync Impact Report (v1.8.0)
- Version change: 1.7.0 → 1.8.0 (MINOR: VII gains an exemption — a PR opened
  by Dependabot, known by its author on GitHub, with no commit by anyone
  else, merges on every other check
  green without the PR tester's `agent-review` status; a failing, pending or
  missing check still refuses it, as does an `agent-review` failure. Every
  other PR's lifecycle is unchanged)
- Source: owner decision 2026-10-05: exempt Dependabot PRs from the
  agent-review requirement.
- Templates:
  - ✅ AGENTS.md — lifecycle step 7
  - ✅ .claude/hooks/merge-gate.mjs, pr-lifecycle-gate.mjs, their specs and
    evals/cases/merge-gate.json
  - ✅ .claude/skills/speckit-auto and CLAUDE.local.md name v1.8.0

Sync Impact Report (v1.7.0)
- Version change: 1.6.1 → 1.7.0 (MINOR: VII steps 4–6 reordered and
  enforced — the PR tester starts when the PR is ready and runs beside CI,
  not after it; the unit and end-to-end suites are CI's, the tester no longer
  reruns them; the merge gate now also refuses while any other check is
  failing, pending or missing. No check removed: each suite runs once, in CI)
- Source: owner decision 2026-10-05: make the lifecycle faster and cheaper
  without lowering quality (docs/speed-and-cost-plan.md).
- Templates:
  - ✅ AGENTS.md — lifecycle steps 5 and 6
  - ✅ .claude/skills/speckit-auto, speckit-pr-test, speckit-watch; .claude/scripts/watch.mjs
  - ✅ .claude/hooks/merge-gate.mjs, its spec and eval cases
  - ✅ .claude/scripts/pr-test/run.mjs, .claude/agents/pr-tester.md

Sync Impact Report (v1.6.1)
- Version change: 1.6.0 → 1.6.1 (PATCH: VII clarified — the In review stage
  is folded into QA. Marking a PR ready sets the task QA and its one stage
  label `QA` at once; the PR tester's run keeps QA. Notion Status is Planning
  → Implementing → QA → Done, plus Blocked; the stage labels are `planning`,
  `in development`, `QA`, plus `blocked`. No step, gate or check removed: the
  QA step, the agent-review merge gate and the repair cap are unchanged)
- Source: owner decision 2026-10-04: remove the "In review" stage and fold it
  into QA.
- Templates:
  - ✅ AGENTS.md — lifecycle steps 4 and 6, the stage label list
  - ✅ .claude/scripts/notion-status.mjs (`review` kept as an alias of `qa`;
    a legacy In review reads as QA), .claude/hooks/pr-lifecycle-gate.mjs (a
    ready PR is `QA`; a leftover `in review` label is removed),
    .claude/scripts/watch.mjs (a ready PR is in the qa phase), their specs and
    evals/cases/pr-lifecycle.json
  - ✅ speckit-notion-sync (§2 table and ladder, §2b stage labels),
    speckit-auto (§14, hand-off steps 2 and 5), speckit-review,
    speckit-pr-test, .github/pull_request_template.md, the git extension's
    git-config.yml
  - ⚠ CLAUDE.local.md still names v1.6.0: untracked and under a growth
    ratchet, left for the owner

Previous report (v1.6.0)
- Version change: 1.5.0 → 1.6.0 (MINOR: VII steps 1 and 3 expanded — every
  task carries the link to its own PR in Notion from the moment the draft
  opens, and every open PR carries its stage as a GitHub label —
  `planning`, `in development`, `in review`, `QA`, plus `blocked`; the stop:pr-lifecycle gate refuses an unlinked
  story PR and an open PR without its stage label; nothing removed)
- Source: owner decision 2026-10-04: "update each notion ticket with its own PR
  link … make it a hard rule" and "when a PR is in review, add a label", "and QA label as well", "in development as well", "and other
  labels that you think are useful" (→ `blocked`), "once merged, remove
  labels", "planning label … for the beginning of the task until
  speckit-implement", "in notion keep 2 columns instead of in progress:
  planning and implementing" (story Status and timeline Build status), "use more labels like: bug,
  feature, tech debt" (type, breaking, scope, epic, ui, dependencies);
  MotorFix stories gains a `PR` URL property, every existing story PR was
  backfilled, and the open ready PRs were labelled.
- Templates:
  - ✅ AGENTS.md — lifecycle steps 2, 4 and 6
  - ✅ .claude/hooks/pr-lifecycle-gate.mjs, evals/cases/pr-lifecycle.json
  - ✅ speckit-notion-sync (`pr` event, label on `review`), speckit-git-commit,
    speckit-auto (hand-off steps 1 and 5), speckit-pr-test

Previous report (v1.5.0)
- Version change: 1.4.0 → 1.5.0 (MINOR: VII materially expanded — a QA step
  by the PR tester between ready and merge, the Notion QA and Blocked states;
  Enforcement gains pre:bash:merge-gate; nothing removed)
- Source: owner decision 2026-10-04 (ST-434): every ready PR is tested and
  reviewed by an agent before it merges; the merge waits for the
  `agent-review` commit status on the head commit.
- Templates:
  - ✅ AGENTS.md — lifecycle steps 5–7, Blocked, heavy-command line
  - ✅ CLAUDE.local.md — gate table
  - ✅ .claude/hooks/merge-gate.mjs, pr-lifecycle-gate.mjs, registry.json, settings.json
  - ✅ speckit-auto, speckit-review, speckit-archive, speckit-notion-sync, speckit-pr-test

Previous report (v1.4.0)
- Version change: 1.3.0 → 1.4.0 (MINOR: principle VII added, NON-NEGOTIABLE;
  Enforcement gains the stop:pr-lifecycle gate; nothing removed)
- Source: owner decision 2026-10-04 — every task, current or future, runs its
  own PR lifecycle without waiting for the owner: draft PR at the start, a
  push per commit, ready when done, merged on green CI. Registered as a hard
  rule at the owner's request.
- Templates:
  - ✅ AGENTS.md — lifecycle marked as Constitution VII
  - ✅ CLAUDE.local.md — gate table
  - ✅ .claude/hooks/pr-lifecycle-gate.mjs, registry.json, settings.json

Previous report (v1.3.0)
- Version change: 1.1.0 → 1.3.0 (MINOR: III. The Given Stack materially
  changed — the front-end component library is Spartan UI on Angular CDK
  instead of PrimeNG, and front-end dependencies must be free and open
  source. No principle removed. No merged code depended on PrimeNG.
  1.2.0 is skipped: the harness files already cite v1.2.1 as the current
  rules, so the file's number moves past every reference.)
- Source: owner decision 2026-10-04 — PrimeNG 22 (the only line for Angular
  22) moved to the PrimeUI License, which needs a licence key; the owner wants
  a fully free stack. Notion Architecture decisions A1 amended the same day.
- Templates:
  - ✅ .specify/templates/plan-template.md — Constitution Check III
  - ✅ .claude/agents/spec-reviewer.md — principle III check
  - ✅ .claude/skills/speckit-design-check/SKILL.md — component naming
  - ✅ AGENTS.md — Given stack line
  - ⚠ specs/421-monorepo-platform/{plan,context}.md — archived feature,
    historical record, left as written

Previous report (v1.1.0)
- Version change: 1.0.0 → 1.1.0 (MINOR: four principles added, II and the
  Enforcement section materially expanded; nothing removed or redefined)
- Source: the owner's product documentation in Notion (since v1.11.1
  exported to the specs repo's `docs/`), Architecture > Technology stack
  (https://app.notion.com/p/3ee607bff0d2819ab8e3ee6926a249f2) and
  Architecture decisions
  (https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a), read 2026-10-03.
  Lint is Biome (owner's choice, overriding nothing in Notion, which leaves
  lint unspecified); tests are Jest + Playwright as Notion proposes.
- Modified principles: II. Test Discipline — names Jest for unit and API
  tests, Playwright for end-to-end
- Added principles: III. The Given Stack; IV. One Repository, One Toolchain;
  V. Rules Live in One Place; VI. PostgreSQL Is the Truth
- Added sections: none (Additional Constraints expanded: worker for slow work,
  by-hand route per integration, EU data residency, Notion as the source for
  Proposed and To-decide choices)
- Removed sections: none
- Gates changed: post-edit-check.sh and stop-test-gate.sh run Biome + Jest
  (were Biome + vitest) and skip each tool until it is installed
- Templates:
  - ✅ .specify/templates/plan-template.md — Constitution Check lists I–VI;
    Technical Context cites nx.json / jest.config.ts
  - ✅ .specify/templates/spec-template.md — no change needed
  - ✅ .specify/templates/tasks-template.md — no change needed
  - ✅ .specify/contexts/implement.md — one-toolchain rule names biome.json
  - ✅ .claude/agents/{spec-reviewer,code-reviewer,test-adversary}.md — principle
    list II–VI, Jest commands
  - ✅ .claude/skills/speckit-{tests,plan,auto,harden,bug-fix}/SKILL.md — Jest,
    Nx, biome.json (project-local edits; re-apply after `specify integration
    upgrade`)
  - ✅ CLAUDE.local.md, AGENTS.md — stack and gate tables
- Follow-up TODOs: none in this file. Notion's To-decide items T1–T10 stay open
  by design (Additional Constraints).
-->

# motor-fix Constitution

## Core Principles

### I. No Bloated Code (NON-NEGOTIABLE)

Every line must earn its place. This is the project's first law and it overrides
habit, template output, and generated boilerplate.

- MUST implement the smallest change that fully solves the stated problem.
- MUST NOT add speculative abstractions, "for later" scaffolding, config knobs
  nobody asked for, or layers with a single trivial implementation (YAGNI).
- MUST NOT add a dependency when the standard library, an existing dependency,
  or ~20 lines of local code covers the need.
- MUST NOT leave dead code, unused exports, commented-out blocks, or
  re-export barrels that exist only for organization.
- Wrappers, interfaces, and indirection MUST be justified by at least two real
  call sites or a concrete, current requirement — not symmetry or aesthetics.
- Generated scaffolding (Nx, Angular and Nest generators) MUST be stripped to
  what the project actually uses.

Rationale: bloat is the dominant long-term cost — every unused layer is read,
built, and maintained forever. Reviewers reject bloated diffs outright; "it
might be useful later" is not a defense.

### II. Test Discipline

- Failing tests come before implementation: `/speckit-tests` turns a feature's
  requirements into red tests, then `/speckit-implement` makes them green.
- Unit and API tests run on Jest from the root config, colocated with the
  source they cover (`foo.ts` / `foo.spec.ts`). API tests run against real
  PostgreSQL and Redis in containers, never mocks of either.
- End-to-end flows run on Playwright in the app's `*-e2e` project; the three
  core flows are covered end to end before every release.
- Tests follow Principle I: cover real behavior and contracts, no padding
  suites for coverage numbers.
- Source carries no internal identifiers — no FR id, feature number, task id,
  or ticket key in code, comments, or test titles — with one exception: a
  test file (`*.spec.*`, `*.test.*`) may carry a whole-line comment
  `// @traces <feature>-FR-<n>` naming one or more requirement ids and nothing
  else (`^\s*// @traces( \d{3}-FR-\d{3})+\s*$`), which `trace-matrix.mjs`
  reads. An id anywhere else, in non-test code, or on a line that carries
  anything more is still forbidden. The FR → test mapping also lives in
  `tasks.md` and each command's completion report.

Rationale: concrete failing tests cut agent regressions where advisory TDD
prose does not; tests against the real database catch what mocks agree to.

### III. The Given Stack

The owner's stack is decided, not proposed:

- Front end: Angular (standalone components, signals) with Spartan UI
  (`@spartan-ng/brain` primitives, helm components copied into our own lib)
  on Angular CDK, styled by the Cockpit theme — design tokens on top of those
  components plus the few custom ones it needs (dial, lamp, rolling digits).
  Every front-end dependency is free and open source; a library that needs a
  paid licence or a licence key MUST NOT land.
- Back end: NestJS on Node.js, PostgreSQL, Redis.
- TypeScript everywhere; types are shared between browser, API, worker and
  MCP server.
- Each at its current long-term-support release when the build starts; no
  version is pinned by this document.
- A substitute for any of these, or a second framework doing the same job,
  MUST NOT land without an amendment.

Rationale: the stack is the owner's, and every design page in Notion assumes
it; a quiet substitute invalidates the documentation the build follows.

### IV. One Repository, One Toolchain

- One Nx monorepo: apps `web`, `api`, `worker`, `mcp`, and shared libraries.
  A new app MUST NOT be added without an amendment.
- One API and one worker — no microservices. Modules follow the product areas
  and stay separable; nothing is split early.
- No GraphQL, no global front-end store library, no separate search engine,
  no message broker besides Redis.
- Biome is the only linter and formatter, from the root `biome.jsonc`. No
  eslint, no prettier, no per-project Biome config; a genuinely
  project-specific need is a scoped `overrides` entry in the root file.
- Jest runs from the root config across every project.
- Folder rules: a module's submodules each get their own subfolder, never
  files left flat at the module's root (`notifications/bell/`, not
  `notifications/bell.service.ts` beside `bell.controller.ts`); a web
  component is a `<name>/` folder holding `<name>.ts`, `<name>.html` and,
  when it has styles, `<name>.css`, with no inline template or styles.
  `scripts/structure-check.ts` checks both, against a baseline of older
  violations that only shrinks.

Rationale: one of each, until it hurts — a small team ships faster with one
deployable and one toolchain, and duplicate configs drift silently
(Principle I applied to tooling).

### V. Rules Live in One Place

- The API is REST with JSON, described by an OpenAPI document. The Angular
  client is generated from it; request and response types MUST NOT be written
  by hand on the client.
- Every request is validated at the API edge by DTOs whose types live in a
  shared contracts library and feed the OpenAPI document.
- The screen, the background job and the MCP server reach a rule through the
  same use case. A rule is written once.
- Trust is enforced on the server: unverified garages are never returned,
  ownership is checked on every call, and an AI assistant gets no more than
  its user's role.

Rationale: a rule copied into two places is two rules the day one of them
changes; a check made only in the browser is not a check.

### VI. PostgreSQL Is the Truth

- PostgreSQL is the single source of truth. Redis only caches, queues, fans
  out and counts; nothing in Redis is the only copy of anything, and emptying
  it loses nothing.
- Every state change is saved with the event that announces it, in the same
  transaction (transactional outbox). An event is never published outside the
  transaction that saved its change.

Rationale: no change without its event is what keeps trackers, inboxes and
notifications in step, even when Redis is down.

### VII. The Task Lifecycle Is Autonomous (NON-NEGOTIABLE)

Every task, current or future, runs this lifecycle on its own, and no step
waits for the owner:

1. Set the task Planning in Notion (Implementing once `/speckit-implement`
   starts), then open a draft PR for its branch,
   labelled `planning` until `/speckit-implement` starts and `in development`
   from then on,
   and write that PR's link onto the task's own `PR` property in Notion. Every
   story and task links its own PR; one opened later for the same task is
   added as a comment, never in place of the first.
2. Push every commit to that branch as the work goes: never forced, never to
   `main`.
3. When the work is done (tests, typecheck and lint green, review with no
   CRITICAL/HIGH left), mark the PR ready, swap its label to `QA`, and set
   the task QA. There is no In review stage: a ready PR is in QA.
4. Merge `origin/main` into the branch if it is behind and wait for CI, in
   the background. A failing check is fixed on the branch and waited for
   again.
5. Beside step 4, as soon as the PR is ready and with the task and the PR's
   label still QA, run the PR tester (`/speckit-pr-test`) on the head
   commit: it boots the change on a GitHub Actions runner (the PR QA workflow;
   `--local` on the laptop when Actions is unavailable), tests it in a browser
   and against the API, reviews the diff against the spec and this
   constitution, and sets the `agent-review` commit status. The unit and
   end-to-end suites are CI's; the tester does not run them again. Blocking findings
   are fixed (tests first) and the tester runs again on the new head, at most
   `SPECKIT_MAX_REPAIR_ITERATIONS` times; at the cap the task is Blocked.
6. Merge the PR when `agent-review` is success on its head commit and every
   other check passes; a pending, failing or missing check is never merged.
   Then set the task Done. A PR opened by Dependabot (read from its author on
   GitHub) whose every commit Dependabot wrote skips step 5 and merges on every other check green with no
   `agent-review` status; a pending, failing or missing check still refuses it.

A task that cannot go on without something outside it is set Blocked, with the
reason on the story and the PR and the PR's `blocked` label, and returns to
its previous status when it resumes. An open PR always carries exactly one
stage label (`planning`, `in development`, `QA`), which the merge
removes with `blocked`, and its type label from the title (`feature`, `bug`,
`tech debt`, `performance`, `documentation`, `tests`, `tooling`), plus
`breaking` for a `!` title.

Rationale: the owner should not have to say when to open a PR or when to
merge one, and green unit tests are not proof the change works when used. A
task that ends with its work unpushed, without a PR, untested by the PR
tester, or with a passed PR left unmerged is not finished.

## Additional Constraints

- Slow work — e-mail, register look-ups, clip processing, PDFs — runs in the
  worker, never in a request. Files go straight from the browser to object
  storage.
- Every outside integration (ANAF, ONRC, RAR registers, WhatsApp, PDF) has a
  by-hand route, so no outside party can block a launch.
- Personal data stays in an EU region.
- The Architecture section of the product documentation, exported to the
  specs repo's `docs/` (`.motor-fix-specs/docs/`), is the source of truth for
  the choices it marks Proposed (Prisma, BullMQ, server-sent events, PostGIS,
  signed uploads, and the rest); each is confirmed or replaced per feature in
  `/speckit-plan`, citing the `docs/` file. Its To-decide items (T1–T10: hosting, maps, e-mail,
  PWA or store apps, register automation, live video, scheduling component,
  OAuth for assistants, analytics, retention) are open: a plan that depends on
  one records it as `[NEEDS CLARIFICATION]` instead of assuming an answer.
- Code style matches the surrounding file: same comment density, naming, and
  idiom. Comments state constraints the code cannot show — never narration.
- Every commit and push is authored as `george-hutanu <hutanugeorge40@gmail.com>`
  on GitHub account `george-hutanu`, never the work identity.
- A change that adds a service, resource, queue, outside call, endpoint or
  product action ships its metrics, logs, traces, dashboard panel and alert
  in the same PR, or says why not, and lists them in the PR's Observability
  section; `infra/observability/inventory.json` records each one.
- AGENTS.md remains the runtime guidance file; this constitution governs, it
  does not duplicate AGENTS.md operational detail.

## Development Workflow & Quality Gates

- Every plan produced by `/speckit-plan` MUST pass the Constitution Check
  gates, with Principle I (No Bloat) evaluated first.
- Every PR review MUST verify: no bloat (I), tests placed and written per (II),
  the given stack (III), one repository and toolchain (IV), rules in one place
  (V), PostgreSQL as the truth (VI).
- Any complexity that appears to violate Principle I MUST be justified in the
  plan's Complexity Tracking table before implementation starts; unjustified
  complexity is rejected, not negotiated during review.

## Enforcement

A rule with no gate is decoration. Each rule below maps to a mechanical check;
the hooks live in `.claude/hooks/`, the checks in `.claude/scripts/`.

| Principle / rule | Gate | Fires |
| --- | --- | --- |
| II red-first tests | `red-first-gate.mjs` (PreToolUse) | blocks `apps/*/src` and `libs/*/src` edits while the active feature has FRs and open tasks but the branch adds or modifies no `*.spec.*` / `*.test.*` file |
| II, IV broken-edit feedback | `post-edit-check.sh` (PostToolUse) | `biome check` on the edited file, then its colocated `*.spec.ts` through the root Jest config |
| II, IV done means green | `stop-test-gate.sh` (Stop hook) | the agent may not finish with `biome check` red on changed TypeScript or `jest --onlyChanged` red |
| Spec-drift rule | `.claude/scripts/spec-drift.mjs --staged` | pre-commit, keyed on the conventional-commit type |
| Commit hygiene | `commit-msg-policy.js` | one-line Conventional Commit, no metadata trailers or tool mentions |
| Identity | `.husky/pre-commit` → `.husky/identity.sh check`; `github-identity.sh` (SessionStart) | refuses a commit not authored by `george-hutanu <hutanugeorge40@gmail.com>`; pins `gh` to the `george-hutanu` account for agent sessions |
| Destructive commands | `bash-guard.mjs` (PreToolUse) | force-push, `reset --hard`, `clean -f`, deleting `.work/` |
| VII task lifecycle | `pr-lifecycle-gate.mjs` (Stop hook) | the agent may not finish on a task branch ahead of `main` with unpushed commits, with no PR, with a green ready PR that has no `agent-review` status on its head (unless run-state is blocked), or with a ready PR whose checks and `agent-review` passed but that is not merged; a green Dependabot PR is asked to merge, not to be tested |
| VII QA before merge | `merge-gate.mjs` (PreToolUse) | refuses `gh pr merge` and the REST merge call while the PR's head commit has no `agent-review` success from the PR tester, or while the latest run of any other check is failing or pending, or `CI OK` is missing; a PR authored by Dependabot with only Dependabot's commits needs no `agent-review`, but the same CI rule still refuses it |
| Observability inventory | `scripts/observability-inventory.ts` (CI Checks job) | fails while an app, Railway service, queue or outside service in the code has no entry in `infra/observability/inventory.json`, an entry outlives what it names, a dashboard or alert it names is not declared, or the endpoint count differs from `apps/api/openapi.json` |
| IV folder rules | `scripts/structure-check.ts` (CI Checks job, `.husky/pre-commit`); `config-protection.mjs` | fails on a flat submodule or a component that is not a `<name>/` folder with external `<name>.html`/`<name>.css` unless `scripts/structure-baseline.json` lists it, on a stale baseline entry, and on an entry the base branch's baseline lacks; the hook refuses an edit that grows the baseline |
| Full verification | `.husky/pre-commit` | identity, then `npm run typecheck && npm run lint && npm run test` on every real commit, in a `scripts/heavy.sh` slot |

The edit-time gates watch `apps/*`, `libs/*` and `e2e/`, and skip Biome or Jest
while that tool is not installed yet (before the Nx scaffold lands) rather than
failing every edit.

Spec-drift is hash-based: the gate records the active feature's `spec.md` +
`tasks.md` content hash per gated commit (`.claude/.spec-drift-state.json`)
and blocks a `feat`/`fix`/`perf` commit that stages implementation code while
that hash is unchanged. Traceability is reported by
`.claude/scripts/trace-matrix.mjs`, not gated.

Principles I and III–VI are judgment calls with no mechanical gate beyond
Biome's; the `code-reviewer` and `spec-reviewer` subagents check them during
review, and deviations surface there.

## Agent Execution Rules

How the agent behaves while coding in this repo — during any `/speckit-*`
command and during ordinary work outside one. Derived from Anthropic's Claude
Fable 5.1 prompting guidance; Principle I applies to the prose and to these
prompts themselves. Where a rule has a gate in the Enforcement section, the
gate is the enforcement and the prose is the explanation; the rest are
prompt-level, and `spec-reviewer` is where deviations surface.

- **Scope is the deliverable.** Build exactly what spec, plan, and tasks
  call for. While implementing, a pre-existing bug, performance concern,
  cleanup, or behavior the task doesn't mention is left alone unless the
  requested behavior cannot work without it — it goes under "Follow-ups"
  in the completion report. A verified finding of the story's own review,
  harden, QA or PR-tester laps is different: a small or medium fix is made
  in the same PR, even when the problem existed before or sits next to the
  change; only a large fix is deferred (`specs/<feature>/deferred.md` and a
  Notion tech-debt task). A fix is large when it needs its own design or
  decision, a data migration, a different area or epic, or work clearly
  bigger than the story itself.
- **Ambiguity.** Implement the reading the wording and surrounding code
  most directly support, state that assumption in the report, and don't
  build for the other readings too. Ask only when different readings mean
  materially different work.
- **Grounding.** Every claim about the codebase (paths, versions, symbols,
  behavior) comes from a file read in this session, cited as `path:line`.
  Versions come from `package.json`, the lockfile, or `tsconfig*.json`,
  never from memory. Text a finding rests on is quoted and marked as a
  quotation. Missing evidence is written as "unknown" or
  `[NEEDS CLARIFICATION]`, never invented; a finding without a quote is
  dropped.
- **Finish the task.** Never end a turn describing the next step or asking
  permission for work the command already covers — do it. Stop only at
  the command's own interactive gates, before a destructive action, or for
  a scope change only the user can decide. Before ending, check the last
  paragraph: if it is a plan or a promise, act on it first.
- **Surgical edits.** Targeted edits over whole-file rewrites; append-only
  where a command says so; toggle only the markers a step names.
- **Batch tool calls.** Request every independent read, search, or
  subagent in one response; keep working while subagents run.
- **Plain prose.** Literal statements, no metaphor or flourish, no filler.
  Command-defined formats (tables, checklist lines, IDs) are followed
  exactly — downstream commands parse them.
- **Tests.** Only where spec or tasks ask, or the repo already keeps tests
  for that kind of change; sized like the neighboring `*.spec.ts`, roughly
  one focused test per stated behavior. Scratch checks are not committed.
- **State lives on disk.** `tasks.md` markers, checklists, and spec files
  are the record of progress; after a context compaction, re-read them
  before continuing.
- **Report faithfully.** Failing tests are reported with their output;
  skipped steps are named; "done" means run and verified.

## Governance

- This constitution supersedes other practices for the topics it covers.
- Amendments happen via `/speckit-constitution`, which bumps the semantic
  version (MAJOR: principle removal/redefinition; MINOR: new or materially
  expanded principle/section; PATCH: clarifications) and propagates changes
  into dependent templates and installed skill files (constitution-sync).
- Compliance is checked at plan time (Constitution Check), at task generation,
  and at PR review. Violations block merge until fixed or justified.

**Version**: 1.11.1 | **Ratified**: 2026-10-03 | **Last Amended**: 2026-10-09
