# Auto run — 435-pr-ci-jobs

- Description: ST-435 Run PR CI as parallel standard checks, and mutation testing in its own workflow.
- Start commit: 8cb1882 (origin/main), branch `435-pr-ci-jobs`, own worktree.
- Notion: https://app.notion.com/p/3ef607bff0d2818992b3cd348695ed53

## Decisions

- Story: no PR-CI story existed (searched by creation date and title); created ST-435 under EP-1 Foundations, filed like ST-431/ST-433 (Task, System, labels backend + front end).
- Size: level 1. The owner's task states what done means, what is out of scope and how it is proven; no product call is open. Phases run: specify (spec.md written directly from the story), tasks, tests, implement, harden, review, retro evidence. Skipped: org context, clarify, plan, checklist, analyze.
- Preflight full suite (`npm run typecheck && lint && jest`) not run locally: the owner's resource rules allow only targeted local checks on this shared laptop; main was green on its last merge, and this PR's own CI is the full-suite proof.
- Unit vs integration split: by file name `*.integration.spec.ts` and `JEST_SUITE` in the shared Jest preset. Real distinction: those specs open PostgreSQL/Redis connections (`process.env['DATABASE_URL']` / `REDIS_URL`) or run the seed. Unset `JEST_SUITE` runs everything, so local `npm test`, the pre-commit hook and the agent gates are unchanged.
- PR title check: inline regex in the workflow (no third-party action, no token); optional scope because merged PR #1 had none.
- Docker check: matrix of the `web` and `node-app` (APP=api) targets, no push, GitHub Actions cache; worker and mcp reuse `node-app`.
- Concurrency: per PR with cancel-in-progress; on non-PR events the group is the run id, so release runs on main never cancel each other.
- `ci.yml` added to `sharedGlobals` (the Nx default) so a CI change marks every project affected and the PR proves every job on itself.
- Mutation: PR #8 (ST-431) open at start, adding mutation steps inside ci.yml and no mutation.yml; Stryker is not on main yet.
- Coordinator (mid-run): PR #8 now ships `.github/workflows/mutation.yml` and takes mutation out of ci.yml. This branch does not create or edit mutation.yml; before merge it checks #8 landed, origin/main's ci.yml has no mutation steps and the merged ci.yml keeps it that way, and reports #8's own dispatch run. If #8 is not merged when this is ready, merge anyway and note it open.

## Tests (red first)

- `scripts/test-suites.spec.ts` before the split: 8 failed, 2 passed (the two that pass only assert the unit suite drops integration specs, which held vacuously with no such files). After: 10 passed.

## Implement

- One commit for the split and the CI jobs together: each commit runs the full husky typecheck+lint+test on this shared laptop, so the run keeps commits few.

## Review

- First CI run on PR #18 (run 37189061812): all 13 checks green.
- spec-reviewer: APPROVE (LOW only). code-reviewer: one HIGH (web-e2e did not depend on api, so api/domain-only PRs skipped e2e) fixed with `implicitDependencies: ["api", "web"]`. Also fixed: docker job only on pull_request (release.yml `images` is the build on main), `--passWithNoTests` on the unit run, no full clone in the harness job, the setup action as a shared global, a comment on the spec's ts-node env, the title error says to push again. The rest is in deferred.md.
- Mutation: PR #8 merged (mutation.yml on main); origin/main's ci.yml has no mutation steps and this branch's ci.yml has none. Verification run (owned by the #8 session): https://github.com/george-hutanu/motor-fix/actions/runs/37189204423, success, contracts score 100 vs floor 95.
