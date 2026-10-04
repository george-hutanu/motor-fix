# Auto run — 431-mutation-testing

- Description: ST-431 Set up mutation testing across every app and lib in the monorepo — https://app.notion.com/p/3ef607bff0d28172bf64e2e2cdb952f4
- Started: 2026-10-04, in worktree `.claude/worktrees/mutation-testing` (user asked for a worktree: another session holds the main checkout, whose tree is dirty on `stack-spartan-ui`)
- Start commit: b53f57ae667f5f37506d644f9d98137b2a4d9bc4 (`origin/main`, pulled at the user's request: already up to date)
- Branch: 431-mutation-testing

## Preflight
- Clean tree in the worktree. `npm ci` (install scripts blocked by npm's allow-list; ran the project's own `postinstall` = `prisma generate`, and `.husky/identity.sh apply`).
- typecheck: green (10/10). lint: green (biome + harness `node --check`).
- tests: first uncached run red in `domain` — `relation "account" does not exist`: the local `postgres` database lacked migration `20261004053640_accounts`. Applied it with `prisma migrate deploy` (the same step CI runs before tests, `.github/workflows/*.yml:42`); then `nx run-many -t test --skip-nx-cache`: 8/8 projects green. Environment gap, not a code failure.
- spec-drift: no active feature at start.
- Constitution on main: v1.1.0, no placeholders. (The main checkout's uncommitted edit to v1.3.0 is not on main and does not apply here.)

## Phase 0 — Size
- Level 2 (feature): intent is defined by the story, but design has choices (runner flags, incremental mode, floors, CI shape). `level.mjs set 2`.

## Phase 2 — Specify
- Branch via hook: `GIT_BRANCH_NAME=431-mutation-testing` (repo convention: story number + slug, as `421-monorepo-platform`, `079-account-model`).
- Clarification table self-answered, no markers left. Autonomous defaults (all in spec Assumptions):
  - `libs/media` and `scripts` in scope — Build brief rule "every project that has a `jest.config.cts`" (8 projects found).
  - Runner options follow the `test` targets as inferred (`nx show project api`: plain `jest`, CommonJS via `TS_NODE_COMPILER_OPTIONS`, no `--experimental-vm-modules`), contradicting the story's scenario 3 / AGENTS.md wording — carried to clarify.
  - Incremental mode in CI, no scheduled full run (owner's open question).
- Hook `after_specify`: notion-sync start → ST-431 In progress; no timeline row; EP-1 unchanged. design-check → no screens.
- Optional git-commit hooks: answered yes; artifacts are tracked in this repo (`specs/421-*` is on main), so they are committed together in one `docs` commit before implementation rather than one commit per phase (each commit runs the full pre-commit suite).

## Phase 3 — Org context
- `org-researcher` subagent: `[UNAVAILABLE: notion]` — its tool list names a different Notion connector id than this session's. Fallback: the session's own connector, read-only calls only (fetch story/epic/decisions, get-comments, search). context.md written: 4 decisions, 4 constraints, 0 prior art, 1 open (nightly full run), 2 contradictions (runner flag; 6 vs 8 projects). Story has no comments.
- Follow-up: the org-researcher agent's tool list does not include this session's Notion connector (`mcp__828510aa-…`).

## Phase 4 — Clarify (spec-challenger + self-answered, all Recommended)
1. Runner flags → follow the `test` targets exactly (no `--experimental-vm-modules`); evidence `nx show project api` (plain `jest`, CommonJS), Principle I.
2. Worker floor → `break: 0`; spec-file check before Stryker, exit 0.
3. PR scope → Nx affected incl. dependants (mirrors `.github/workflows/ci.yml:45`), incremental.
4. Time-out → one `timeout-minutes` on the step; `--parallel=1`, each run prints its project first; number from measured runs.
5. SC-004 → dropped (no source; score not stored in repo).
- `scripts` in scope kept as an assumption (Build brief rule). Checklist 16/16 unchanged.

## Phase 5 — Plan
- Spikes (2026-10-04): `contracts` 100% in 7 s from the repo root; `domain` 1,071 mutants, 514-test initial run 28 s, static mutants ~67% of time → `ignoreStatic`. Stryker API keeps the CLI's break exit code (`mutation-test-report-helper.js:130-139`) → one small runner script (Complexity Tracking).
- Found: harness evals already red on main (41/46): the floor cases named `apps/server`, which does not exist here.

## Phase 6 — Checklist
- `checklists/tooling.md`, 18 items; 3 gaps fixed in spec first (missing config, undefined score, "a few points" = 5, static mutants). 0 unchecked.

## Phase 7–8 — Tasks, Analyze
- 14 tasks. artifact-lint: Spec Delta missing → added; FR-005 untasked → mapped to T003/T009. Re-run: 0 errors, 0 warnings. No CRITICAL.

## Owner change (mid-run, 2026-10-04)
- "the running on mutation testing is pretty expensive for this laptop. create the task for fixing the mutants but do not run it again now, open the draft pr tho"
- Stopped the `domain` spike (killed Stryker and its workers, removed `.stryker-tmp`). Spec FR-009/SC-001 + tasks T005/T007/T009 amended (recorded in Clarifications). Floors 0 except contracts 95. CI timeout 60 min (unmeasured).
- Follow-up task created in Notion: https://app.notion.com/p/3ef607bff0d28123bf09dc9243e3570d (Task, High, 5 pts, EP-1).
- Draft PR: https://github.com/george-hutanu/motor-fix/pull/8

## Phase 9 — Tests (red)
- `scripts/mutation.spec.ts`: suite failed (module missing), 15 tests; later +1 scoping test, red on TS2554. `doctor.spec.mjs`: 1 failed / 19.

## Phase 10 — Implement
- Green: `jest -c scripts/jest.config.cts scripts` 38/38; vitest doctor 19/19; `tsc -p scripts/tsconfig.json` clean; `nx show projects --with-target test:mutation` = 8; `nx run worker:test:mutation` → skipped, exit 0; harness-eval 43/46 (was 41; remaining 3 pre-existing, unrelated); doctor 16 ok / 0 warn.
- Commits: 836ab02 feat(mutation), 4f71eee ci(mutation), 3075a16 chore(harness). Pushed.

## Phase 11 — Converge
- Every task [X]; no unbuilt FR found against the files (FR-001…FR-012 each mapped). No new tasks.

## Phase 12 — Harden
- Mutation step waived by the owner. diff-audit: 0 errors, 3 warnings (the three Stryker dev deps — named by the story, justified in plan). artifact-lint: clean. test-adversary not run (tooling script with a full unit spec; owner asked to keep the machine light) — noted in report.
