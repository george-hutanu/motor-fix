# Auto run — 440-pr-title-edited

- Description: ST-440, tech debt from ST-435 (PR #18), code-reviewer MEDIUM: CI's `pull_request` trigger keeps its default types, so a corrected PR title is only re-checked on the next push. Fix it so a corrected title re-checks without re-running every job on a body edit.
- Start commit: 2aa27d2 (origin/main), branch 440-pr-title-edited, worktree .worktrees/440-pr-title-edited
- PR: #118 (draft, planning)

## Preflight
- Tree clean; `sh scripts/heavy.sh sh -c 'npm run typecheck && npm run lint && npm run test'` exit 0 ("Successfully ran target test for 11 projects").
- spec-drift --status: no active feature at the time (the feature pointer was written just after).

## 0. Size
- Level 1 (one-session): intent clear ("done" = a title fix re-runs only the title check; a body edit re-runs no CI job). Phases: 2, 7, 9, 10, 12, 14, 16.

## 1. Constitution
- v1.8.1, no placeholders. Principle I drives the choice: move one job, add no script.

## 2. Specify
- `speckit.git.feature` (before_specify): skipped, the branch already existed (created by the orchestrator from origin/main).
- Gate answers (autonomous defaults, in spec Assumptions): a separate workflow rather than `edited` on ci.yml (ci.yml's concurrency cancels the run in progress on every PR event); CI OK no longer needs the title check (merge-gate judges every check); no branch protection (404).
- after_specify: notion-sync start (Planning, PR #118 linked), design check (no screens), quality checklist passed on the first iteration.

## 7. Tasks
- tasks.md written in the level-1 form (no plan.md, as in specs/436-docs-only-ci). 5 tasks; analyze not run at level 1.

## 9. Tests
- scripts/pr-title-workflow.spec.ts before any implementation: "Tests: 13 failed, 1 passed, 14 total" (the passing one guards that ci.yml keeps its default trigger, which is already true).

## 10. Implement
- pr-title.yml added, the title job and its CI OK need removed from ci.yml, AGENTS.md updated. Spec: "Tests: 14 passed, 14 total".
